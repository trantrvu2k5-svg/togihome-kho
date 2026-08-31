// WP-70 L-70r4 · BACKFILL cham_cuoi_luc cho lead hiện hành đang NULL. GHI DÒNG MỚI qua ghiLoLead (idempotent).
//   Chỉ lấy mốc từ Pancake (updated_at). Không tìm thấy hội thoại → để nguyên (cham_cuoi_luc NULL → WP-79
//   doi_chieu_lo tự bỏ qua vì không có khoá cửa sổ). Mặc định --dry-run; truyền  chay  để ghi thật.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { hoiThoaiToLead, ghiLoLead } from './keo_lead_core.mjs'

const CHAY = process.argv.includes('chay')
const TRAN_TRANG = 50
const BASE = 'https://pages.fm/api/public_api/v2'
const raw = (readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env', 'utf8').split('\n').find(l => l.startsWith('PANCAKE_PAGES=')) || '').slice('PANCAKE_PAGES='.length).trim()
const pages = JSON.parse(raw || '[]')
const tokenOf = pid => { const p = pages.find(x => String(x.page_id) === String(pid)); return p && (p.token || p.page_access_token) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function layAn(url) { for (let i = 0; i < 6; i++) { const r = await fetch(url); if (r.ok) return r; if (r.status === 429 || r.status >= 500) { await sleep(2000 * Math.pow(2, i)); continue } return r } return { ok: false, status: 429 } }

const c = new pg.Client(await docConfig()); await c.connect()
const need = (await c.query(`select page_id, hoi_thoai_id from kho.v_lead_hien_hanh where cham_cuoi_luc is null`)).rows
const byPage = {}
for (const r of need) (byPage[r.page_id] = byPage[r.page_id] || new Set()).add(r.hoi_thoai_id)
console.log(`Chế độ: ${CHAY ? '⚠ GHI THẬT' : 'DRY-RUN'} · lead cần sửa (cham_cuoi NULL): ${need.length}\n`)
const tong = { thay: 0, khong: 0 }

for (const [pid, ids] of Object.entries(byPage)) {
  const token = tokenOf(pid); const conv = new Map()
  let cursor = null, trang = 0
  while (trang < TRAN_TRANG) {
    const u = new URL(`${BASE}/pages/${pid}/conversations`); u.searchParams.set('page_access_token', token); if (cursor) u.searchParams.set('last_conversation_id', cursor)
    const res = await layAn(u.toString()); if (!res.ok) { console.log(`  page ${pid}: HTTP ${res.status} — dừng quét`); break }
    const j = await res.json(); const ds = j.conversations || j.data || []; trang++
    if (!ds.length) break
    for (const h of ds) if (ids.has(String(h.id))) conv.set(String(h.id), h)
    let du = true; for (const id of ids) if (!conv.has(id)) { du = false; break }
    if (du) break
    cursor = String(ds[ds.length - 1].id); if (ds.length < 60) break
    await sleep(400)
  }
  const found = [...ids].filter(id => conv.has(id))
  tong.thay += found.length; tong.khong += ids.size - found.length
  console.log(`page ${pid}: cần ${ids.size} · quét ${trang} trang · TÌM THẤY ${found.length} · không thấy ${ids.size - found.length} (giữ NULL → WP-79 bỏ qua)`)
  if (CHAY && found.length) {
    const convs = found.map(id => conv.get(id))
    const r = await ghiLoLead(c, pid, convs)   // ghi dòng mới: cham_cuoi_luc + moc_dang_ngo (parser tính)
    console.log(`   → ghi ${r.ghi} dòng mới (khong_doi ${r.khong_doi})`)
  }
}
console.log(`\n╔═ TỔNG ═╗ TÌM THẤY (sẽ có cham_cuoi) ${tong.thay} · không thấy (giữ NULL) ${tong.khong}`)
if (!CHAY) console.log('→ DRY-RUN xong. Chờ CEO gõ "chạy mốc" để ghi thật.')
await c.end()
