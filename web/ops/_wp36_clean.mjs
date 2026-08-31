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
  // [L-05f/QD-86] KHÔNG tắt trigger, KHÔNG xoá vat_tu_tham_so_lich_su (SỔ append-only WP-36 — trg_vttsls_ao).
  //   Lịch sử đổi tham số ván là log thô, để NGUYÊN (0 tác động ≠ 0 dấu vết, QD-46). Chỉ reset CẤU HÌNH HIỆN TẠI của
  //   ván (bảng thường vat_tu / vat_tu_don_vi) về nguyên trạng — chạy với trigger BẬT.
  for (const v of vans) {
    await c.query(`delete from kho.vat_tu_don_vi where vat_tu_id=$1 and don_vi='m2'`, [v])
    await c.query(`update kho.vat_tu set kho_dai_mm=null, kho_rong_mm=null, hao_hut_pct=10 where id=$1`, [v])
  }
  console.log('CLEAN: đơn', dons.length, '· ván reset', vans.length, '· vat_tu_don_vi còn', (await one(`select count(*) c from kho.vat_tu_don_vi`)).c,
    '· (vat_tu_tham_so_lich_su GIỮ nguyên — sổ append-only)')
} catch (e) { console.error('CLEAN_ERR', e.message) }
finally { await c.end() }
