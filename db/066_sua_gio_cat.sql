-- 066 — L-08: CEO chỉnh tay giờ 'cat'. KHÔNG đổi gì khác.
--   cat (Cắt CNC): 0,1165 → 0,0333 giờ/mảnh (7' → 2'/mảnh). Giữ driver đếm MẢNH.
--   Mọi quy trình. la_tam=true. Nguồn = 'CEO chinh tay 14/08 — tu san luong 2 may CNC 55 tam/ngay'.
--   node ops/run_sql.mjs ../db/066_sua_gio_cat.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin; update kho.quy_trinh_buoc set gio_moi_don_vi=0.1165 where hoat_dong='cat'; commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

update kho.quy_trinh_buoc set
  gio_moi_don_vi = 0.0333, la_tam = true,
  ghi_chu = 'gio_moi_don_vi = CEO chinh tay 14/08 — tu san luong 2 may CNC 55 tam/ngay · gio_co_dinh = uoc theo nghe · [TẠM]'
where hoat_dong = 'cat';

commit;
