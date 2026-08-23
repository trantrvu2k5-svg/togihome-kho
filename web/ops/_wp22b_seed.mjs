// Seed demo cho ảnh (c) app Tài chính: đơn da_nhan + HĐ + 1 phiếu chi (kỳ 2026-08). Dọn bằng _wp22_clean.mjs <id>.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
try {
  const ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  const ncc = (await one(`select id, ten from kho.nha_cung_cap order by ten limit 1`))
  const kho = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const vt = (await one(`select id from kho.vat_tu where ngung_dung=false and dvt=don_vi_co_so order by ma limit 1`)).id
  await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ceo, role: 'authenticated' })])
  const don = (await one(`select kho.dm_tao($1,$2,null,'DEMO WP-22 tài chính',$3::jsonb,false) g`, [ncc.id, kho, JSON.stringify([{ vat_tu_id: vt, so_luong: 20, don_gia: 150000 }])])).g
  const dong = (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [don.id])).id
  await c.query(`select kho.dm_chuyen_trang_thai($1,'da_gui')`, [don.id])
  await c.query(`select kho.dm_chuyen_trang_thai($1,'xac_nhan')`, [don.id])
  await c.query(`select kho.dm_nhan_hang($1,$2::jsonb)`, [don.id, JSON.stringify([{ dong_id: dong, so_luong: 20 }])])
  const hd = (await one(`select kho.hd_ncc_ghi($1,'DEMO-HD-B01','hoa_don_vat','2026-08-15'::date,'2026-09-14'::date,10,'demo',$2::jsonb) g`,
    [don.id, JSON.stringify([{ don_mua_dong_id: dong, so_luong: 20, don_gia_hd: 150000 }])])).g
  await c.query("select set_config('request.jwt.claims','',false)")   // KHÔNG ghi phiếu chi ở seed — robot ghi qua MÀN
  console.log(JSON.stringify({ id: don.id, so_don: don.so_don, ncc: ncc.ten, tong: hd.tong_gom_vat }))
} catch (e) { console.error('SEED_ERR', e.message); process.exit(1) }
finally { await c.end() }
