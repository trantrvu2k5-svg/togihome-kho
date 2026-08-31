// WP-70 L-70r3 · CỨU sđt cho lead sdt='[object Object]'. GHI DÒNG MỚI qua ghiLoLead (idempotent), KHÔNG UPDATE.
//   Số CHỈ lấy từ Pancake (conversation-list). Không suy từ tên/đơn cũ. Không tìm thấy → để trống.
//   Mặc định --dry-run (chỉ đếm). Truyền  cuu  để GHI THẬT (chờ CEO). KHÔNG commit file này.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { laySdt, ghiLoLead } from './keo_lead_core.mjs'

const THAT = process.argv.includes('cuu')          // có 'cuu' = ghi thật; không = dry-run
const TRAN_TRANG = 60                               // trần quét conversation-list mỗi page (60×60=3600 hội thoại)
const OBJ = '[object Object]'
const BASE = 'https://pages.fm/api/public_api/v2'
const raw = (readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env', 'utf8').split('\n').find(l => l.startsWith('PANCAKE_PAGES=')) || '').slice('PANCAKE_PAGES='.length).trim()
const pages = JSON.parse(raw || '[]')
const tokenOf = pid => { const p = pages.find(x => String(x.page_id) === String(pid)); return p && (p.token || p.page_access_token) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
// fetch chịu 429/5xx: lùi dần, tối đa 6 lần. Giãn nhịp giữa trang để không đập rate-limit Pancake.
async function layAn(url) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url)
    if (res.ok) return res
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * Math.pow(2, i)); continue }
    return res
  }
  return { ok: false, status: 429 }
}

const c = new pg.Client(await docConfig()); await c.connect()
const hong = (await c.query(`select page_id, hoi_thoai_id from kho.v_lead_hien_hanh where sdt=$1`, [OBJ])).rows
const theoPage = {}
for (const r of hong) (theoPage[r.page_id] = theoPage[r.page_id] || new Set()).add(r.hoi_thoai_id)

console.log(`Chế độ: ${THAT ? '⚠ GHI THẬT' : 'DRY-RUN (chỉ đếm)'} · tổng lead hỏng: ${hong.length}\n`)
const tong = { cuu: 0, khong_thay: 0, thay_khong_so: 0 }

for (const [pid, ids] of Object.entries(theoPage)) {
  const token = tokenOf(pid)
  const conv = new Map()                            // hoi_thoai_id → conversation
  let cursor = null, trang = 0
  while (trang < TRAN_TRANG && conv.size < ids.size + 0) {
    const u = new URL(`${BASE}/pages/${pid}/conversations`); u.searchParams.set('page_access_token', token); if (cursor) u.searchParams.set('last_conversation_id', cursor)
    const res = await layAn(u.toString()); if (!res.ok) { console.log(`  page ${pid}: HTTP ${res.status} — dừng quét (rate-limit dai)`); break }
    const j = await res.json(); const ds = j.conversations || j.data || []; trang++
    if (!ds.length) break
    for (const h of ds) if (ids.has(String(h.id))) conv.set(String(h.id), h)
    await sleep(400)   // giãn nhịp tránh 429
    // dừng sớm nếu đã gom đủ mọi id hỏng của page
    let du = true; for (const id of ids) if (!conv.has(id)) { du = false; break }
    if (du) break
    cursor = String(ds[ds.length - 1].id); if (ds.length < 60) break
  }
  // phân loại
  let cuu = 0, thay_khong_so = 0, khong_thay = 0
  const cuuList = []
  for (const id of ids) {
    const h = conv.get(id)
    if (!h) { khong_thay++; continue }
    const rp = (Array.isArray(h.recent_phone_numbers) && h.recent_phone_numbers.length) ? h.recent_phone_numbers : (Array.isArray(h.phone_numbers) ? h.phone_numbers : [])
    const sdt = laySdt(rp)
    if (sdt) { cuu++; cuuList.push(h) } else thay_khong_so++
  }
  tong.cuu += cuu; tong.khong_thay += khong_thay; tong.thay_khong_so += thay_khong_so
  console.log(`page ${pid}: hỏng ${ids.size} · quét ${trang} trang · CỨU ĐƯỢC ${cuu} · thấy-không-số ${thay_khong_so} · KHÔNG thấy ${khong_thay}`)
  if (THAT && cuuList.length) {
    const r = await ghiLoLead(c, pid, cuuList)      // ghi DÒNG MỚI, sdt đã đúng (idempotent)
    console.log(`   → đã ghi ${r.ghi} dòng mới (khong_doi ${r.khong_doi})`)
  }
}
console.log(`\n╔═ TỔNG ═╗ CỨU ĐƯỢC ${tong.cuu} · thấy-không-số ${tong.thay_khong_so} · KHÔNG thấy (mất hẳn) ${tong.khong_thay}`)
if (!THAT) console.log('→ DRY-RUN xong. Chờ CEO gõ "cứu" để ghi thật.')
await c.end()
