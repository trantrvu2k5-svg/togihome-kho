-- 065 — L-07: CEO chỉnh tay 2 con số gio_moi_don_vi. KHÔNG đổi gì khác.
--   dan (Dán cạnh):      0,075   → 0,025   giờ/mét (4,5' → 1,5'/mét)
--   cam (Khoan cam/chốt): 0,0122 → 0,00333 giờ/lỗ (44s → 12s/lỗ)
--   Mọi quy trình. Giữ la_tam=true. Nguồn = 'CEO chinh tay 14/08'. KHÔNG đụng 10 hoạt động kia.
--   node ops/run_sql.mjs ../db/065_sua_2_gio.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin; update kho.quy_trinh_buoc set gio_moi_don_vi=0.0755 where hoat_dong='dan';
--   update kho.quy_trinh_buoc set gio_moi_don_vi=0.0122 where hoat_dong='cam'; commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

update kho.quy_trinh_buoc set
  gio_moi_don_vi = 0.025, la_tam = true,
  ghi_chu = 'gio_moi_don_vi = CEO chinh tay 14/08 · gio_co_dinh = uoc theo nghe · [TẠM]'
where hoat_dong = 'dan';

update kho.quy_trinh_buoc set
  gio_moi_don_vi = 0.00333, la_tam = true,
  ghi_chu = 'gio_moi_don_vi = CEO chinh tay 14/08 · gio_co_dinh = uoc theo nghe · [TẠM]'
where hoat_dong = 'cam';

commit;
