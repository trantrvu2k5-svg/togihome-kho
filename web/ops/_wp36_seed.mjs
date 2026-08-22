// Seed demo WP-36 (committed, la_demo) cho robot chụp ảnh: đơn + 2 món + BOM m² CHỜ + tem + ca test_tho. In JSON.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const MA = 'DEMO-WP36-' + Math.floor(Date.now() / 1000 % 100000)
try {
  const tho = (await one(`select id from kho.nguoi_dung where ho_ten='test_tho'`)).id
  const VAN = await one(`select id, ma from kho.vat_tu where kho.la_nhom_van(nhom_id) and don_vi_co_so='tam' and ngung_dung=false
    and not exists(select 1 from kho.vat_tu_don_vi u where u.vat_tu_id=vat_tu.id and u.don_vi='m2') order by ma limit 1`)
  await c.query(`set session_replication_role='replica'`)
  // 2 ĐƠN riêng (mỗi đơn 1 món 12 m²) → thu_quy_doi_bom (đơn-level) = 12 m² → 5 tấm mỗi đơn (khớp toast per-món)
  const tems = []
  for (const n of [1, 2]) {
    const md = `${MA}-${n}`
    const donId = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO WP-36 ảnh',true,'le','cho_cat','khac') returning id`, [md])).id
    const m = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,$2,'KE-HO-MELAMINE',false) returning id`, [donId, 'kệ WP36 ' + n])).id
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,so_luong_co_so,he_so_ap_dung,don_vi,nguon,moc,chot_luc) values($1,$2,12,null,null,'m2','cutlist','chuan',now())`, [m, VAN.id])
    const tem = `${md}#1`; tems.push(tem)
    await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values($1,1,$2,'than',$3)`, [md, tem, m])
  }
  await c.query(`update kho.ca_lam set ket_thuc=now() where nguoi_id=$1 and ket_thuc is null`, [tho])
  await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram,bat_dau) values($1,'TRAM-CAT-01',now())`, [tho])
  await c.query(`set session_replication_role='origin'`)
  console.log(JSON.stringify({ ma_don: MA, van: VAN.ma, tems }))
} catch (e) { console.error('SEED_ERR', e.message); process.exit(1) }
finally { await c.end() }
