// WP-70 L-06 · Cloudflare Worker cron — kéo lead Pancake mỗi phút (thay launchd laptop).
//   Thuật toán: DÙNG CHUNG keo_lead_core.mjs (không viết lại). Nối DB qua Hyperdrive = phiên OWNER + cửa GUC như cũ.
//   BẮT BUỘC (L-05/L-06): khoá chống chồng (kho.keo_lead_runner.held_at) · lùi dần 429 (trong core) ·
//     5 lỗi LIÊN TIẾP → ngủ 15' · 1 dòng log/lượt (giờ · lead mới · lỗi) · KHÔNG in token.
import postgres from 'postgres'
import { keoMotPage, MET, metReset } from '../../ops/keo_lead_core.mjs'
import { keoChiAdsMetaNhip } from '../../ops/keo_chi_ads_meta.mjs'   // [WP-91 L-91.3] kéo chi ads (cron daily)

// [L-70r7 ĐO] đếm câu SQL + thời-gian-trôi-qua DB mỗi lượt (KHÔNG phải CPU). Reset đầu mỗi chayLuot.
const MET_DB = { ms: 0, n: 0 }

// shim client kiểu pg: .query(text, params) -> {rows}, chạy trên postgres.js.
//   OBJECT param → sql.json() (postgres.js đòi vậy cho jsonb; JSON-string trần bị nó băm sai). Date/nguyên thuỷ giữ nguyên.
const makeClient = sql => ({
  query: async (text, params = []) => {
    const p = params.map(v => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? sql.json(v) : v)
    const _t0 = Date.now()
    const r = { rows: await sql.unsafe(text, p) }
    MET_DB.ms += Date.now() - _t0; MET_DB.n++
    return r
  }
})

async function chayLuot(env) {
  let pages = []
  try { pages = JSON.parse(env.PANCAKE_PAGES || '[]') } catch { return { skip: 'pages-loi' } }
  if (!pages.length) return { skip: 'khong-pages' }
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false })
  const client = makeClient(sql)
  const t_run = Date.now()
  metReset(); MET_DB.ms = 0; MET_DB.n = 0
  let ket_noi_ms = 0
  try {
    const t_conn0 = Date.now()
    const upd = await sql`update kho.keo_lead_runner set so_luot = so_luot + 1 where id = 1 returning so_luot`   // đếm MỌI lượt
    ket_noi_ms = Date.now() - t_conn0                              // câu ĐẦU gồm bắt tay kết nối (TLS+SCRAM)
    // [L-70r7] XOAY VÒNG thứ tự page theo so_luot → igo không vĩnh viễn cuối hàng (chết đói). Vá đúng bất kể CPU.
    const off = Number(upd[0].so_luot) % pages.length
    pages = pages.slice(off).concat(pages.slice(0, off))
    // BACKOFF: đang ngủ (sau 5 lỗi liên tiếp)?
    const st = (await sql`select loi_lien_tiep, ngu_toi from kho.keo_lead_runner where id=1`)[0]
    if (st && st.ngu_toi && new Date(st.ngu_toi) > new Date()) return { skip: 'ngu', ngu_toi: st.ngu_toi }
    // KHOÁ chống chồng: chiếm held_at nếu rảnh / lượt trước TREO quá 3 phút.
    //   [L-70r2] Phát hiện + GHI LOG khoá treo: trước đây nhả sau 90s NHƯNG IM LẶNG → sự cố CPU-kill sống 8h
    //   mà loi_lien_tiep=0 không ai biết. Nay hễ thu hồi khoá treo là hét ra một dòng.
    const treo = (await sql`select held_at from kho.keo_lead_runner where id=1 and held_at is not null and held_at < now() - interval '3 minutes'`)[0]
    const lock = await sql`update kho.keo_lead_runner set held_at = now(), cap_nhat_luc = now()
      where id = 1 and (held_at is null or held_at < now() - interval '3 minutes') returning held_at`
    if (!lock.length) return { skip: 'chong' }        // lượt trước đang giữ → bỏ, không xếp hàng
    if (treo) console.warn(`  ⚠ thu hồi khoá treo (lượt trước chết không nhả, giữ từ ${new Date(treo.held_at).toISOString()})`)
    try {
      let tongGhi = 0
      // [L-09] Kéo MỖI TRANG trong 1 TRANSACTION: Hyperdrive multiplex backend giữa các câu rời → cờ GUC
      //   set_config bị đánh rơi (~43% lượt lỗi "chỉ ceo/ke_toan… GUC"). Transaction GHIM 1 backend cho cả
      //   set_config + lead_ghi + lead_moc_ghi → cờ giữ nguyên. (pg local ổn định nên core không đổi.)
      const client = makeClient(sql)                                   // pool cho ĐỌC mốc (không cần transaction)
      const keoTatCa = (async () => {
        for (const p of pages) {
          try {
            // [L-70r2] MỖI TRANG 1 transaction (ghim backend cho GUC). Một page hỏng → BỎ QUA, đi tiếp page sau.
            const tx = (fn) => sql.begin(txs => fn(makeClient(txs)))
            const T = await keoMotPage(client, p.page_id, p.token || p.page_access_token, { tx })
            tongGhi += T.ghi
          } catch (e) {
            console.error(`  ✗ page ${p.page_id} lỗi (BỎ QUA, đi tiếp): ${(e && e.message || String(e)).slice(0, 90)}`)
          }
        }
      })()
      // CẮT 50s: lượt chạy quá lâu thì bỏ, không đè sang nhịp 60s sau (kết nối rớt → transaction tự rollback).
      const cat50s = new Promise((_, rej) => setTimeout(() => rej(new Error('lượt quá 50s — tự cắt')), 50000))
      await Promise.race([keoTatCa, cat50s])
      // [L-09 WP-79 QD-85] Sau khi kéo xong: KHỚP click↔lead cửa-sổ-1:1 trên window gần (60'), KHÔNG cron thứ hai.
      //   MỘT transaction ghim 1 backend cho GUC lead_he_thong (Hyperdrive multiplex rơi cờ — cùng bài học kéo trên).
      //   Lỗi khớp KHÔNG được đánh sập lượt kéo (kéo đã xong, durable) → nuốt + log.
      try {
        await sql.begin(async txs => {
          await txs`select set_config('kho.lead_he_thong','1',true)`
          await txs`select 1 from kho.khop_click_lead(now() - interval '60 minutes', now(), false)`
        })
      } catch (e) { console.error(`  ✗ khop_click_lead lỗi (BỎ QUA, kéo đã xong): ${(e && e.message || String(e)).slice(0, 90)}`) }
      await sql`update kho.keo_lead_runner set loi_lien_tiep = 0, ngu_toi = null, held_at = null, cap_nhat_luc = now() where id = 1`
      console.log(`  [do] ket_noi=${ket_noi_ms}ms goi_pancake=${MET.pancakeMs}ms parse_json=${MET.parseMs}ms ghi_db=${MET_DB.ms}ms tong=${Date.now() - t_run}ms cauSQL=${MET_DB.n} hoiThoai=${tongGhi} pancakeN=${MET.pancakeN} (troi-qua, KHONG phai CPU)`)
      return { ok: true, ghi: tongGhi }
    } catch (e) {
      let fails = null, ngu = null
      try {
        const r = (await sql`update kho.keo_lead_runner
          set loi_lien_tiep = loi_lien_tiep + 1,
              ngu_toi = case when loi_lien_tiep + 1 >= 5 then now() + interval '15 minutes' else null end,
              held_at = null, cap_nhat_luc = now()
          where id = 1 returning loi_lien_tiep, ngu_toi`)[0]
        fails = r.loi_lien_tiep; ngu = r.ngu_toi
      } catch {}
      return { loi: (e && e.message || String(e)).slice(0, 90), fails, ngu_toi: ngu }
    }
  } finally { try { await sql.end() } catch {} }
}

// [WP-91 L-91.3] KÉO CHI ADS (cron daily). Dùng lại keoChiAdsMetaNhip (auto-backfill ngày trống + cửa sổ 7 ngày
//   + gộp kỳ). tx = sql.begin ghim backend cho GUC meta_he_thong (Hyperdrive multiplex rơi cờ — khuôn L-09).
//   KHÔNG nuốt lỗi: lỗi → mốc ads đã ghi trang_thai='loi' (trong keoChiAdsMetaCoSo) + trả {loi_ads} để log.
async function chayLuotAds(env) {
  const token = env.META_CAPI_TOKEN
  if (!token) return { skip_ads: 'thieu-token' }
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false })
  const client = makeClient(sql)
  const tx = (fn) => sql.begin(txs => fn(makeClient(txs)))
  const t0 = Date.now()
  try {
    const r = await keoChiAdsMetaNhip(client, { token, tx })
    return { ok_ads: true, so_dong: (r && r.tongDong) || 0, ms: Date.now() - t0 }
  } catch (e) {
    return { loi_ads: (e && e.message || String(e)).slice(0, 120), ms: Date.now() - t0 }
  } finally { try { await sql.end() } catch {} }
}
function logAds(r) {
  const gio = new Date().toISOString().slice(11, 19)
  if (r.skip_ads) console.log(`${gio} · ADS bỏ (${r.skip_ads})`)
  else if (r.ok_ads) console.log(`${gio} · ADS ok · ${r.so_dong} dòng · ${r.ms}ms`)
  else console.log(`${gio} · ADS LỖI: ${r.loi_ads} (${r.ms}ms)`)   // KHÔNG nuốt — hét ra
}

function log(r) {
  const gio = new Date().toISOString().slice(11, 19)
  if (r.skip === 'ngu') console.log(`${gio} · đang ngủ tới ${String(r.ngu_toi).slice(11, 19)} — bỏ lượt`)
  else if (r.skip === 'chong') console.log(`${gio} · bỏ qua: lượt trước chưa xong`)
  else if (r.skip) console.log(`${gio} · bỏ (${r.skip})`)
  else if (r.ok) console.log(`${gio} · +${r.ghi} lead mới · ok`)
  else console.log(`${gio} · lỗi (${r.fails}/5): ${r.loi}${r.ngu_toi ? ' — NGỦ 15 phút' : ''}`)
}

export default {
  async scheduled(event, env, ctx) {
    // [WP-91 L-91.3] rẽ theo cron: "0 19 * * *" = kéo CHI ADS (1 lần/ngày); còn lại (mỗi phút) = kéo LEAD.
    if (event.cron === '0 19 * * *') ctx.waitUntil((async () => { const r = await chayLuotAds(env); logAds(r) })())
    else ctx.waitUntil((async () => { const r = await chayLuot(env); log(r) })())
  },
  // GET / = KÉO TAY (nút "Kéo ngay" app Sale) hoặc smoke-test. CORS mở để app gọi được. Khoá + GUC như cron.
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    // [WP-91 L-91.4] ?job=ads → kích nhánh ADS thủ công (chạy QUA worker+Hyperdrive để nghiệm thu vá GUC). Mặc định = lead.
    if (new URL(req.url).searchParams.get('job') === 'ads') {
      const r = await chayLuotAds(env); logAds(r)
      return new Response(JSON.stringify(r), { headers: { ...cors, 'content-type': 'application/json' } })
    }
    const r = await chayLuot(env); log(r)
    return new Response(JSON.stringify(r), { headers: { ...cors, 'content-type': 'application/json' } })
  }
}
