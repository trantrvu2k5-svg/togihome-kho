-- 067 — L-09: CEO chỉnh tay giờ 'goi'. KHÔNG đổi gì khác.
--   goi (Đóng gói): 1,248 → 0,7667 giờ/kiện (74,88' → 46'/kiện). Giữ driver.
--   Mọi quy trình. la_tam=true. Nguồn = 'CEO chinh tay 14/08 — tu san luong to dong goi 682 don/11 ngay, ~1 kien/don'.
--   node ops/run_sql.mjs ../db/067_sua_gio_goi.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin; update kho.quy_trinh_buoc set gio_moi_don_vi=1.248 where hoat_dong='goi'; commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

update kho.quy_trinh_buoc set
  gio_moi_don_vi = 0.7667, la_tam = true,
  ghi_chu = 'gio_moi_don_vi = CEO chinh tay 14/08 — tu san luong to dong goi 682 don/11 ngay, ~1 kien/don · gio_co_dinh = uoc theo nghe · [TẠM]'
where hoat_dong = 'goi';

commit;
