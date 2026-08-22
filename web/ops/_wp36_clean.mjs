// Dọn demo WP-36: xoa_demo mọi đơn DEMO-WP36 + gỡ m2 unit/khổ/lịch sử đã thêm cho các ván (prod về nguyên trạng).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
try {
  const ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  // ván nào bị demo này chạm (có BOM trong đơn DEMO-WP36)
  const vans = (await c.query(`select distinct b.vat_tu_id from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id join kho.don_hang dh on dh.id=m.don_id where dh.ma_don like 'DEMO-WP36-%'`)).rows.map(r => r.vat_tu_id)
  const dons = (await c.query(`select ma_don from kho.don_hang where ma_don like 'DEMO-WP36-%'`)).rows
  await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ceo, role: 'authenticated' })])
  for (const d of dons) { try { await c.query(`select kho.xoa_demo($1)`, [d.ma_don]) } catch (e) { console.log('xoa_demo', d.ma_don, 'ERR', e.message.slice(0, 50)) } }
  await c.query("select set_config('request.jwt.claims','',false)")
  await c.query(`set session_replication_role='replica'`)
  for (const v of vans) {
    await c.query(`delete from kho.vat_tu_don_vi where vat_tu_id=$1 and don_vi='m2'`, [v])
    await c.query(`update kho.vat_tu set kho_dai_mm=null, kho_rong_mm=null, hao_hut_pct=10 where id=$1`, [v])
    await c.query(`delete from kho.vat_tu_tham_so_lich_su where vat_tu_id=$1`, [v])
  }
  await c.query(`set session_replication_role='origin'`)
  console.log('CLEAN: đơn', dons.length, '· ván reset', vans.length, '· vat_tu_don_vi còn', (await one(`select count(*) c from kho.vat_tu_don_vi`)).c)
} catch (e) { console.error('CLEAN_ERR', e.message) }
finally { await c.end() }
