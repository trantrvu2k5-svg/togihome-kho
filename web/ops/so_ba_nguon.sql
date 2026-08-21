-- so_ba_nguon.sql — SO BA NGUỒN TỒN (script chuẩn dùng chung, WP-11 về sau). CHỈ ĐỌC.
-- Sắp theo tao_luc, KHÔNG sắp theo id UUID (L-53 dương tính giả BL-03: id UUID ngẫu nhiên → bốc nhầm "dòng mới nhất").
--   A = ton.so_luong
--   B = so_du_sau của dòng giao_dich CUỐI  (ORDER BY tao_luc DESC, id DESC · DISTINCT ON (vat_tu_id,kho_id))
--   C = Σ lo_nhap.con_lai  WHERE lo_da_huy = false
-- Khớp khi A = B = C (coalesce về A khi thiếu B/C). Chạy trên DB thật kỳ vọng: 199/199.

with lastgd as (
  select distinct on (vat_tu_id, kho_id) vat_tu_id, kho_id, so_du_sau
  from kho.giao_dich
  order by vat_tu_id, kho_id, tao_luc desc, id desc          -- tao_luc, KHÔNG id UUID
),
lo as (
  select vat_tu_id, kho_id, sum(con_lai) sc
  from kho.lo_nhap where lo_da_huy = false
  group by vat_tu_id, kho_id
),
cmp as (
  select v.ma,
         t.so_luong                        as a_ton,
         g.so_du_sau                        as b_so_du_sau,
         l.sc                               as c_con_lai,
         (t.so_luong = coalesce(g.so_du_sau, t.so_luong)
          and t.so_luong = coalesce(l.sc, t.so_luong))  as khop
  from kho.ton t
  join kho.vat_tu v on v.id = t.vat_tu_id
  left join lastgd g on g.vat_tu_id = t.vat_tu_id and g.kho_id = t.kho_id
  left join lo     l on l.vat_tu_id = t.vat_tu_id and l.kho_id = t.kho_id
)
-- Dòng tổng:
select 'TỔNG'::text as ma,
       count(*)::text                       as a_ton,
       count(*) filter (where khop)::text   as b_so_du_sau,
       count(*) filter (where not khop)::text as c_con_lai,
       (count(*) = count(*) filter (where khop)) as khop
from cmp
union all
-- Danh sách mã LỆCH (rỗng nếu khớp hết):
select ma, a_ton::text, b_so_du_sau::text, c_con_lai::text, khop
from cmp where not khop
order by khop desc, ma;
