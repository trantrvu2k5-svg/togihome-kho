// Trả DANH SÁCH TRẠM theo ĐÚNG thứ tự đồ thị quy trình (buoc_truoc, QD-01) cho MỘT đơn — cho harness bước 8.
//   node ops/trams_don.mjs <ma_don>  → in JSON [{thu_tu, hoat_dong, nhanh, ma_tram}] (topo, non-tu_chay, 1 trạm/bước).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const MA = process.argv[2]
const c = new pg.Client(await docConfig()); await c.connect()
const rows = (await c.query(`
with recursive
qt as (
  select m.id as mon_id, kho.qt_hieu_luc(m.id) as ma_quy_trinh
  from kho.don_hang d join kho.don_hang_mon m on m.don_id = d.id where d.ma_don = $1
),
b as (
  select qt.mon_id, qb.thu_tu, qb.buoc_truoc, qb.hoat_dong, qb.nhanh,
         coalesce(qb.loai_buoc,'nguoi') as loai_buoc
  from qt join kho.quy_trinh_buoc qb on qb.ma_quy_trinh = qt.ma_quy_trinh
),
topo as (
  select mon_id, thu_tu, hoat_dong, nhanh, loai_buoc, 0 as lvl from b where cardinality(buoc_truoc)=0
  union all
  select b.mon_id, b.thu_tu, b.hoat_dong, b.nhanh, b.loai_buoc, t.lvl+1
  from b join topo t on t.mon_id=b.mon_id and t.thu_tu = any(b.buoc_truoc)
),
rk as (select mon_id, thu_tu, hoat_dong, nhanh, loai_buoc, max(lvl) lvl from topo group by mon_id,thu_tu,hoat_dong,nhanh,loai_buoc)
select min(rk.lvl) as lvl, rk.thu_tu, rk.hoat_dong, rk.nhanh, min(tr.ma_tram) as ma_tram
from rk join kho.tram tr on tr.hoat_dong=rk.hoat_dong and tr.dang_dung
where rk.loai_buoc <> 'tu_chay'
group by rk.thu_tu, rk.hoat_dong, rk.nhanh
order by lvl, rk.thu_tu`, [MA])).rows
console.log(JSON.stringify(rows))
await c.end()
