// WP-70 · CLI local bộ kéo Pancake (chạy tay trên máy). Thuật toán ở keo_lead_core.mjs (dùng CHUNG với Worker).
//   2 chế độ: --moi (mặc định, xuôi) · --lui (kéo lùi phủ kỳ cũ). Đọc PANCAKE_PAGES từ .env; nối DB qua pg/conn.mjs.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { keoMotPage, keoLuiTronTrang, LUOT_LUI_TRAN, NGUONG_KY } from './keo_lead_core.mjs'

// re-export lõi để test (test_keo_lead) import từ đây không đổi
export { dungURL, hoiThoaiToLead, ghiLoLead, keoMotPage, keoLuiMotPage, keoLuiTronTrang } from './keo_lead_core.mjs'

async function main() {
  const lui = process.argv.includes('--lui')
  const root = new URL('../../', import.meta.url).pathname
  let raw = ''
  try { raw = (readFileSync(root + '.env', 'utf8').split('\n').find(l => l.startsWith('PANCAKE_PAGES=')) || '').slice('PANCAKE_PAGES='.length).trim() } catch (_) {}
  raw = raw || process.env.PANCAKE_PAGES || ''
  if (!raw) { console.log('chưa có token (PANCAKE_PAGES), bỏ qua bước chạy thật'); process.exit(0) }
  let pages
  try { pages = JSON.parse(raw) } catch (e) { console.error('PANCAKE_PAGES không phải JSON hợp lệ'); process.exit(1) }
  const client = new pg.Client(await docConfig()); await client.connect()
  const t0 = Date.now()
  for (const p of pages) {
    const token = p.token || p.page_access_token
    if (lui) {
      console.log(`── page ${p.page_id} · KÉO LÙI ──`)
      const G = await keoLuiTronTrang(client, p.page_id, token)
      const kq = G.skip ? 'BỎ QUA (chưa kéo xuôi)' : G.dat_dich ? 'ĐẠT ĐÍCH (moc_cu < 01/08)' : G.cham_san ? 'CHẠM SÀN 01/01' : G.het ? 'HẾT DỮ LIỆU' : G.cham_tran_luot ? `HẾT ${LUOT_LUI_TRAN} LƯỢT, CHƯA TỚI 01/08` : '?'
      const conThieu = (G.moc_cu && !G.dat_dich && !G.cham_san) ? ` · còn thiếu ~${Math.max(0, Math.round((Date.parse(G.moc_cu) - NGUONG_KY) / 86400000))} ngày (moc_cu ${G.moc_cu.slice(0, 10)})` : ''
      console.log(`  lượt ${G.luot}/${LUOT_LUI_TRAN} · hội thoại ${G.hoi_thoai} · ghi mới ${G.ghi} · ${kq}${conThieu}`)
    } else {
      console.log(`── page ${p.page_id} ──`)
      const T = await keoMotPage(client, p.page_id, token)
      console.log(`  trang ${T.trang} · hội thoại ${T.hoi_thoai} · ghi mới ${T.ghi} · khong_doi ${T.khong_doi} · có ad ${T.co_ad} · có sđt ${T.co_sdt} · chạm trần ${T.cham_tran} · mốc ${T.max_cap_nhat || '(không đổi)'}`)
      const bc = (await client.query(`select left(hoi_thoai_id,10) ht, thoi_diem_hoi_thoai, muc_chac_chan, (sdt is not null) co_sdt from kho.lead where page_id=$1 order by stt desc limit 5`, [p.page_id])).rows
      console.table(bc)
    }
  }
  console.log(`⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await client.end()
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('LỖI:', e.message); process.exit(1) })
