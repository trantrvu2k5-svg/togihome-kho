// WP-70 L-06 · Cloudflare Worker cron — kéo lead Pancake mỗi phút (thay launchd laptop).
//   Thuật toán: DÙNG CHUNG keo_lead_core.mjs (không viết lại). Nối DB qua Hyperdrive = phiên OWNER + cửa GUC như cũ.
//   BẮT BUỘC (L-05/L-06): khoá chống chồng (kho.keo_lead_runner.held_at) · lùi dần 429 (trong core) ·
//     5 lỗi LIÊN TIẾP → ngủ 15' · 1 dòng log/lượt (giờ · lead mới · lỗi) · KHÔNG in token.
import postgres from 'postgres'
import { keoMotPage } from '../../ops/keo_lead_core.mjs'

// shim client kiểu pg: .query(text, params) -> {rows}, chạy trên postgres.js.
//   OBJECT param → sql.json() (postgres.js đòi vậy cho jsonb; JSON-string trần bị nó băm sai). Date/nguyên thuỷ giữ nguyên.
const makeClient = sql => ({
  query: async (text, params = []) => {
    const p = params.map(v => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? sql.json(v) : v)
    return { rows: await sql.unsafe(text, p) }
  }
})

async function chayLuot(env) {
  let pages = []
  try { pages = JSON.parse(env.PANCAKE_PAGES || '[]') } catch { return { skip: 'pages-loi' } }
  if (!pages.length) return { skip: 'khong-pages' }
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false })
  const client = makeClient(sql)
  try {
    await sql`update kho.keo_lead_runner set so_luot = so_luot + 1 where id = 1`   // đếm MỌI lượt cron (kể cả bỏ/ngủ)
    // BACKOFF: đang ngủ (sau 5 lỗi liên tiếp)?
    const st = (await sql`select loi_lien_tiep, ngu_toi from kho.keo_lead_runner where id=1`)[0]
    if (st && st.ngu_toi && new Date(st.ngu_toi) > new Date()) return { skip: 'ngu', ngu_toi: st.ngu_toi }
    // KHOÁ chống chồng: chiếm held_at nếu rảnh / lượt trước treo quá 90s
    const lock = await sql`update kho.keo_lead_runner set held_at = now(), cap_nhat_luc = now()
      where id = 1 and (held_at is null or held_at < now() - interval '90 seconds') returning held_at`
    if (!lock.length) return { skip: 'chong' }        // lượt trước đang giữ → bỏ, không xếp hàng
    try {
      let tongGhi = 0
      // [L-09] Kéo MỖI TRANG trong 1 TRANSACTION: Hyperdrive multiplex backend giữa các câu rời → cờ GUC
      //   set_config bị đánh rơi (~43% lượt lỗi "chỉ ceo/ke_toan… GUC"). Transaction GHIM 1 backend cho cả
      //   set_config + lead_ghi + lead_moc_ghi → cờ giữ nguyên. (pg local ổn định nên core không đổi.)
      const keoTatCa = (async () => {
        for (const p of pages) {
          const T = await sql.begin(async txs => keoMotPage(makeClient(txs), p.page_id, p.token || p.page_access_token))
          tongGhi += T.ghi
        }
      })()
      // CẮT 50s: lượt chạy quá lâu thì bỏ, không đè sang nhịp 60s sau (kết nối rớt → transaction tự rollback).
      const cat50s = new Promise((_, rej) => setTimeout(() => rej(new Error('lượt quá 50s — tự cắt')), 50000))
      await Promise.race([keoTatCa, cat50s])
      await sql`update kho.keo_lead_runner set loi_lien_tiep = 0, ngu_toi = null, held_at = null, cap_nhat_luc = now() where id = 1`
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

function log(r) {
  const gio = new Date().toISOString().slice(11, 19)
  if (r.skip === 'ngu') console.log(`${gio} · đang ngủ tới ${String(r.ngu_toi).slice(11, 19)} — bỏ lượt`)
  else if (r.skip === 'chong') console.log(`${gio} · bỏ qua: lượt trước chưa xong`)
  else if (r.skip) console.log(`${gio} · bỏ (${r.skip})`)
  else if (r.ok) console.log(`${gio} · +${r.ghi} lead mới · ok`)
  else console.log(`${gio} · lỗi (${r.fails}/5): ${r.loi}${r.ngu_toi ? ' — NGỦ 15 phút' : ''}`)
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil((async () => { const r = await chayLuot(env); log(r) })()) },
  // GET / = KÉO TAY (nút "Kéo ngay" app Sale) hoặc smoke-test. CORS mở để app gọi được. Khoá + GUC như cron.
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    const r = await chayLuot(env); log(r)
    return new Response(JSON.stringify(r), { headers: { ...cors, 'content-type': 'application/json' } })
  }
}
