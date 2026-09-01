-- db/202 · WP-76 mục A (L-76b, phần GIỮ sau khi CEO dừng mục B/C/D/E) · Đường nối MÓN → CHỦ ĐỀ (loai_thuong_mai).
--   CHỈ dựng VIEW — đường nối đã đủ khoá (WP-70 db/182): món.sp_id → san_pham_mau.ma_loi → san_pham_loi.dong_id
--     → dong_loai.dong_ma → loai_thuong_mai.ma. KHÔNG đẻ bảng mới.
--   Mỗi món ra ĐÚNG 0 hoặc 1 loại. Món không nối được → GIỮ dòng, loai_ma NULL (dòng "chưa gán chủ đề" của màn đọc từ đây).
--   nguon_chu_de = sp_id / ma_sp_goc (đường thực nối được), để sau truy được. (Đường "niem_yet" KHÔNG khả thi:
--     don_hang_mon.sp_id có FK fk_dhm_sp → san_pham_mau(ma), sp_id KHÔNG THỂ là mã niêm yết — bỏ path đó.)
--   Món "không nối được" = biến thể mà lõi/dòng CHƯA có dong_loai (14/44 san_pham_mau) HOẶC sp_id NULL.
--   CẤM trộn loại suy từ v_lead_hien_hanh (đó là trục LEAD, khác trục MÓN — db/182 dòng 156). Hai trục không cộng.
--   Không QD (mục C bỏ), không RPC cac_toi_da_ky (mục B bỏ) — CEO dừng vì công thức khối ③ chưa tách xong.
--   ⚠ Cổng backup QD-61 (run_sql.mjs). IDEMPOTENT: create or replace view. HOÀN TÁC: drop view kho.v_mon_chu_de;
begin;

create or replace view kho.v_mon_chu_de with (security_invoker = true) as
with r as (
  select dm.id as mon_id, dm.don_id, dm.sp_id, dm.ma_sp_goc,
    -- (1) sp_id là BIẾN THỂ (san_pham_mau.ma)
    (select dl.loai_ma from kho.san_pham_mau sm
       join kho.san_pham_loi sl on sl.ma_loi = sm.ma_loi
       join kho.dong_loai dl    on dl.dong_ma = sl.dong_id
       where sm.ma = dm.sp_id limit 1) as l_sp,
    -- (2) ma_sp_goc là BIẾN THỂ (cột ngủ đông db/058, FK→san_pham_mau — vẫn đỡ, phòng dữ liệu sau)
    (select dl.loai_ma from kho.san_pham_mau sm
       join kho.san_pham_loi sl on sl.ma_loi = sm.ma_loi
       join kho.dong_loai dl    on dl.dong_ma = sl.dong_id
       where sm.ma = dm.ma_sp_goc limit 1) as l_goc
  from kho.don_hang_mon dm
)
select
  r.mon_id, r.don_id, r.sp_id, r.ma_sp_goc,
  coalesce(r.l_sp, r.l_goc) as loai_ma,
  case when r.l_sp  is not null then 'sp_id'
       when r.l_goc is not null then 'ma_sp_goc'
       else null end as nguon_chu_de,
  lt.ten as loai_ten
from r
left join kho.loai_thuong_mai lt on lt.ma = coalesce(r.l_sp, r.l_goc);

grant select on kho.v_mon_chu_de to authenticated;

do $$ begin
  if to_regclass('kho.v_mon_chu_de') is null then raise exception 'THIẾU v_mon_chu_de'; end if;
  raise notice 'db/202 OK: view v_mon_chu_de (món→chủ đề, 0/1 loại, giữ dòng chưa gán).';
end $$;
commit;
