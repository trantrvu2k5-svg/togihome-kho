// Seed demo don_mua tới da_nhan (qua RPC, ceo) để chụp ảnh (c). In id/so_don. Dọn bằng _wp22_clean.mjs <id>.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
try {
  const ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  const ncc = (await one(`select id from kho.nha_cung_cap order by ten limit 1`)).id
  const kho = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const vt = (await one(`select id, ma from kho.vat_tu where ngung_dung=false and dvt=don_vi_co_so order by ma limit 1`))
  await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ceo, role: 'authenticated' })])
  const don = (await one(`select kho.dm_tao($1,$2,null,'DEMO WP-22 ảnh',$3::jsonb,false) g`, [ncc, kho, JSON.stringify([{ vat_tu_id: vt.id, so_luong: 20, don_gia: 150000 }])])).g
  const dong = (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [don.id])).id
  await c.query(`select kho.dm_chuyen_trang_thai($1,'da_gui')`, [don.id])
  await c.query(`select kho.dm_chuyen_trang_thai($1,'xac_nhan')`, [don.id])
  await c.query(`select kho.dm_nhan_hang($1,$2::jsonb)`, [don.id, JSON.stringify([{ dong_id: dong, so_luong: 20 }])])
  await c.query("select set_config('request.jwt.claims','',false)")
  console.log(JSON.stringify({ id: don.id, so_don: don.so_don, vat_tu: vt.ma }))
} catch (e) { console.error('SEED_ERR', e.message); process.exit(1) }
finally { await c.end() }
