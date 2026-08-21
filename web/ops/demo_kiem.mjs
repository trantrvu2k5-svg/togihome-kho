// WP-02a / L-58 · BƯỚC D — kiểm đơn demo sau khi chạy vòng (read-only, KHÔNG sửa). node ops/demo_kiem.mjs [MA_DON]
import pg from 'pg'; import { docConfig } from './conn.mjs'
const MA = process.argv[2] || 'DEMO-PH01'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function asCeo(sql, a = []) {
  await c.query('begin'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(sql, a)).rows } catch (x) { e = x.message }
  await c.query('rollback'); return { r, e }
}
console.log('══════ BƯỚC D · KIỂM ĐƠN', MA, '══════')
const d = await one(`select ma_don, trang_thai, la_demo, dong, ten_khach from kho.don_hang where ma_don=$1`, [MA])
console.log('don_hang:', JSON.stringify(d) || 'KHÔNG CÓ')
if (!d) { console.log('→ đơn chưa tồn tại (chưa lên đơn?).'); await c.end(); process.exit(0) }
console.log('nhật ký trạng thái:', JSON.stringify((await q(`select tu, den, luc from kho.don_hang_nhat_ky nk join kho.don_hang dh on dh.id=nk.don_id where dh.ma_don=$1 order by luc`, [MA])).map(x => `${x.tu||'?'}→${x.den}`)))
const cnt = await one(`select
  (select count(*) from kho.su_kien_quet sq where sq.tem_ma in (select ma_tam from kho.tem_ban_ve where ma_don=$1)) quet,
  (select count(*) from kho.tem_ban_ve where ma_don=$1) tem,
  (select count(*) from kho.xep_lich where ma_don=$1) lich,
  (select count(*) from kho.ban_thiet_ke where ma_don=$1) ban`, [MA])
console.log(`su_kien_quet(theo tem): ${cnt.quet} (cần ≥3) · tem_ban_ve: ${cnt.tem} · xep_lich: ${cnt.lich} (cần ≥1) · ban_thiet_ke: ${cnt.ban}`)
console.log('don_hang_gia_von:', JSON.stringify(await one(`select khoi_1, khoi_2, khoi_3, ly_do from kho.don_hang_gia_von where ma_don=$1`, [MA])) || 'CHƯA có')
console.log('phieu_thu:', JSON.stringify(await q(`select so_tien, loai, ngay from kho.phieu_thu where ma_don=$1`, [MA])))
console.log('khach DEMO Phòng họp:', JSON.stringify(await one(`select ten, sdt, la_demo from kho.khach where ten ilike 'DEMO%' order by ten limit 1`)))
// cm_don_ky 2026-08
const g0 = await asCeo(`select kho.cm_don_ky('2026-08') g`); const g1 = await asCeo(`select kho.cm_don_ky('2026-08',0,'cm_pct.asc',true) g`)
const has = (r, m) => r && JSON.stringify(r[0]?.g?.ds || []).includes(m)
console.log(`cm_don_ky 2026-08: mặc định có ${MA}? ${g0.e ? 'LỖI:' + g0.e.slice(0, 40) : has(g0.r, MA)} · gom_demo=true có? ${g1.e ? 'LỖI' : has(g1.r, MA)}`)
if (g1.r && !g1.e) { const row = (g1.r[0].g.ds || []).find(x => x.ma_don === MA); console.log('  CM đơn (gom_demo):', row ? JSON.stringify({ cm: row.cm, cm_pct: row.cm_pct, dt: row.dt_thuan }) : '(không thấy trong top-50)') }
await c.end()
