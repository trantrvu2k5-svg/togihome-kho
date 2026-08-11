// XOÁ SẠCH dữ liệu demo một lệnh. KHÔNG đụng đơn thật (la_demo=false). node ops/xoa_demo.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect(); const KY='2099-08'
try {
  await c.query('begin')
  // off_100: xoá phan_bo_hoat_dong theo kỳ làm tổng tạm ≠100% giữa chừng -> tắt guard 100% khi dọn.
  for (const g of ['chan.off_lui','chan.off_vai','chan.tu_mon','chan.off_100']) await c.query(`select set_config($1,'1',true)`,[g])
  await c.query(`delete from kho.lan_in_tem where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.tem_da_in where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.loi_lam_lai where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.gio_thiet_ke_thuc where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.san_luong_don where ma_don like 'DEMO-%'`)
  await c.query(`delete from kho.phieu_dem_ngay where la_demo = true`)
  await c.query(`delete from kho.luong_to where ma_ky=$1`,[KY])
  await c.query(`delete from kho.phan_bo_hoat_dong where ma_ky=$1`,[KY])
  const n=(await c.query(`delete from kho.don_hang where la_demo = true returning ma_don`)).rowCount  // cascade món/giá vốn/tem_ban_ve
  const that=(await c.query(`select count(*)::int n from kho.don_hang where la_demo=false`)).rows[0].n
  await c.query('commit')
  console.log(`✅ Đã xoá ${n} đơn demo + dữ liệu phụ. Đơn THẬT còn nguyên: ${that}.`)
} catch(e){ await c.query('rollback').catch(()=>{}); console.error('❌',e.message); process.exit(1) }
finally { await c.end() }
