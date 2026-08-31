// WP-79 L-79c · Cloudflare Worker RIÊNG — tuyến CÔNG KHAI GET /chat (chuyển hướng chat + ghi sổ click).
//   TÁCH HẲN worker-keo-lead, KHÔNG nhét chung, có chủ đích:
//     (1) /chat là tuyến CÔNG KHAI — không được đứng chung isolate với secret PANCAKE_PAGES của bộ kéo lead;
//     (2) sửa /chat KHÔNG phải deploy lại cron kéo lead đang chạy mỗi phút.
//   Dùng LẠI đúng Hyperdrive id sẵn có (binding HYPERDRIVE) — KHÔNG tạo Hyperdrive mới.
//   Đích chat suy TỪ ENV (ZALO_URL/MESS_URL/IG_URL/HOME_URL) — TUYỆT ĐỐI không lấy từ query (open redirect).
//   Thứ tự BẮT BUỘC: chuyển hướng TRƯỚC (302 no-store), ghi sổ SAU trong ctx.waitUntil (khách không chờ DB).
import postgres from 'postgres'

const DICH = { zalo: 'ZALO_URL', messenger: 'MESS_URL', instagram: 'IG_URL' }

// L-79h · Mã GTM nhúng THẲNG vào Worker (Worker không có ổ đĩa, không đọc file lúc chạy). GTM chỉ giữ 1 dòng
//   <script src=".../gtm.js"> → không có thân JS để GTM biên dịch → không thể parse error. Đây là bản min
//   (byte y hệt web/ops/gtm_ref_chat.min.js). Regex viết \\.(\\d+) để template literal cho ra đúng \.(\d+).
const GTM_JS = `(function(){try{var WORKER="https://togihome-chat.togihome-keo-lead.workers.dev/chat";var K="togi_click";var UT=["source","medium","campaign","content","term"];var UK={source:"us",medium:"um",campaign:"uc",content:"uo",term:"ut"};try{var q=new URLSearchParams(location.search);var fb=q.get("fbclid"),gc=q.get("gclid");var cur={};try{cur=JSON.parse(sessionStorage.getItem(K)||"{}");}catch(e){}if(fb){cur.mc=fb;cur.mt="fbclid";}else if(gc){cur.mc=gc;cur.mt="gclid";}var any=fb||gc;UT.forEach(function(u){var v=q.get("utm_"+u);if(v){cur[u]=v;any=1;}});if(any){try{sessionStorage.setItem(K,JSON.stringify(cur));}catch(e){}}}catch(e){}function kenhTuHref(h){if(!h)return null;if(h.indexOf("zalo.me/0908386258")>=0)return "zalo";if(h.indexOf("m.me")>=0||h.indexOf("messenger.com")>=0)return "messenger";if(h.indexOf("ig.me")>=0)return "instagram";return null;}function idWebTuPath(path){var m=(path||"").match(/\\.(\\d+)$/);return m?m[1]:"0";}function nonce6(){var s="";var abc="abcdefghijklmnopqrstuvwxyz0123456789";for(var i=0;i<6;i++)s+=abc.charAt(Math.floor(Math.random()*abc.length));return s;}document.addEventListener("click",function(e){try{var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var href=a.getAttribute("href")||"";if(href.indexOf("tel:")===0)return;var kenh=kenhTuHref(href);if(!kenh)return;var path=location.pathname||"/";var ref="w-"+idWebTuPath(path)+"-"+nonce6();var st={};try{st=JSON.parse(sessionStorage.getItem(K)||"{}");}catch(e){}var dich=WORKER+"?kenh="+encodeURIComponent(kenh)+"&ref="+encodeURIComponent(ref)+"&dd="+encodeURIComponent(path)+"&src=gtm";if(st.mc){dich+="&mc="+encodeURIComponent(st.mc)+"&mt="+encodeURIComponent(st.mt||"");}UT.forEach(function(u){if(st[u])dich+="&"+UK[u]+"="+encodeURIComponent(st[u]);});dich+="&td="+encodeURIComponent(location.href);e.preventDefault();location.href=dich;}catch(err){}},true);}catch(e){}})();`

// Ghi sổ qua RPC — MỘT câu SQL trong MỘT transaction (ghim 1 backend Hyperdrive). KHÔNG set_config/GUC
//   (bài học L-09: Hyperdrive multiplex backend giữa 2 câu rời → GUC rơi ~43% lượt). DB lỗi/chậm → nuốt, chỉ log.
async function ghiSo(env, { ref, kenh, dich, nguon, ua, dd, mc, mt, us, um, uc, uo, ut, td }) {
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false })
  try {
    // RPC 15 tham số (db/193): +mã click nguyên văn (mc/mt) + utm + trang_dat (td). id_web tách từ dd (p_id_web=null).
    await sql.begin(t => t.unsafe(
      'select kho.ghi_click_chat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [ref ?? '', kenh, dich, nguon, ua, dd ?? null, null, mc ?? null, mt ?? null, us ?? null, um ?? null, uc ?? null, uo ?? null, ut ?? null, td ?? null]))
  } finally { try { await sql.end() } catch {} }
}

export default {
  async fetch(req, env, ctx) {
    // Chỉ GET/HEAD — tuyến chuyển hướng, không body, không CORS.
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 })
    const url = new URL(req.url)

    // Tuyến phục vụ mã GTM (tĩnh). Cache 5' — sửa xong 5' web ăn bản mới, không đập cache mỗi lượt tải trang.
    if (url.pathname === '/gtm.js') {
      return new Response(GTM_JS, { headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      } })
    }

    const kenh = (url.searchParams.get('kenh') || '').toLowerCase()
    const ref  = url.searchParams.get('ref')

    // kenh thiếu/lạ → 302 về HOME, KHÔNG ghi sổ (CHECK db/183 sẽ RAISE), chỉ cảnh báo. Không bao giờ trả trang lỗi cho khách.
    if (!DICH[kenh]) {
      console.warn(`chat: kenh không hợp lệ "${kenh}" — về HOME, không ghi sổ`)
      return new Response(null, { status: 302, headers: { Location: env.HOME_URL, 'Cache-Control': 'no-store' } })
    }

    // Đích LẤY TỪ ENV (không bao giờ từ query). messenger mang được ?ref (thứ L-79d đi soi ở Pancake); zalo/ig đích trần.
    const base = env[DICH[kenh]]
    const dich = (kenh === 'messenger' && ref)
      ? base + (base.includes('?') ? '&' : '?') + 'ref=' + encodeURIComponent(ref)
      : base

    // 302 (KHÔNG 301 — 301 bị CF/trình duyệt cache, click sau không chạm Worker, sổ chết âm thầm) + no-store.
    const res = new Response(null, { status: 302, headers: { Location: dich, 'Cache-Control': 'no-store' } })

    // Ghi sổ SAU khi đã trả hướng đi. HEAD (prefetch/preview) KHÔNG ghi — tránh phồng sổ bằng lượt máy.
    if (req.method === 'GET') {
      const nguon = url.searchParams.get('src') || req.headers.get('Referer') || null   // src= để đánh dấu lượt kiểm thử
      const dd = url.searchParams.get('dd')                                              // pathname trang khách click (GTM gửi)
      const g = k => url.searchParams.get(k)                                             // mã click + utm (nguyên văn, GTM gửi)
      const mc = g('mc'), mt = g('mt'), us = g('us'), um = g('um'), uc = g('uc'), uo = g('uo'), ut = g('ut'), td = g('td')
      const ua = req.headers.get('User-Agent')
      ctx.waitUntil(ghiSo(env, { ref, kenh, dich, nguon, ua, dd, mc, mt, us, um, uc, uo, ut, td }).catch(e =>
        console.error('chat: ghi sổ lỗi (vẫn đã chuyển hướng) —', (e && e.message || String(e)).slice(0, 120))))
    }
    return res
  }
}
