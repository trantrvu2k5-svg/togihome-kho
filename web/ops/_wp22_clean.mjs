// Nuke chain demo don_mua theo id (dưới replica: xoá giao_dich/lô/phiếu/HĐ/đơn) + tính lại ton cho vật tư ảnh hưởng.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const id = process.argv[2]
try {
  if (!id) throw new Error('cần don_mua_id')
  await c.query(`set session_replication_role='replica'`)
  const ph = (await c.query(`select id from kho.phieu where don_mua_id=$1`, [id])).rows.map(r => r.id)
  const vk = (await c.query(`select distinct vat_tu_id, kho_id from kho.giao_dich where phieu_id = any($1)`, [ph])).rows
  if (ph.length) {
    await c.query(`delete from kho.giao_dich where phieu_id = any($1)`, [ph])
    await c.query(`delete from kho.lo_nhap where phieu_id = any($1)`, [ph])
    await c.query(`delete from kho.phieu_dong where phieu_id = any($1)`, [ph])
    await c.query(`delete from kho.phieu where id = any($1)`, [ph])
  }
  await c.query(`delete from kho.phieu_chi_ncc where hoa_don_ncc_id in (select id from kho.hoa_don_ncc where don_mua_id=$1)`, [id])
  await c.query(`delete from kho.hoa_don_ncc_dong where hoa_don_ncc_id in (select id from kho.hoa_don_ncc where don_mua_id=$1)`, [id])
  await c.query(`delete from kho.hoa_don_ncc where don_mua_id=$1`, [id])
  await c.query(`delete from kho.don_mua_lich_su where don_mua_id=$1`, [id])
  await c.query(`delete from kho.don_mua_dong where don_mua_id=$1`, [id])
  await c.query(`delete from kho.don_mua where id=$1`, [id])
  // tính lại ton cho vật tư ảnh hưởng (so_luong = Σ sổ còn lại; gia_von_bq từ lô sống)
  for (const r of vk) {
    await c.query(`update kho.ton set so_luong = coalesce((select sum(so_luong) from kho.giao_dich where vat_tu_id=$1 and kho_id=$2),0), sua_luc=now() where vat_tu_id=$1 and kho_id=$2`, [r.vat_tu_id, r.kho_id])
    await c.query(`select kho.tinh_lai_gia_von_bq($1,$2)`, [r.vat_tu_id, r.kho_id])
  }
  await c.query(`set session_replication_role='origin'`)
  console.log('CLEAN OK:', id, 'vật tư tính lại:', vk.length)
} catch (e) { console.error('CLEAN_ERR', e.message); process.exit(1) }
finally { await c.end() }
