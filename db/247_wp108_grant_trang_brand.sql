-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 247 — WP-108 vá: ads_trang_brand THIẾU grant SELECT cho authenticated (db/242 revoke all rồi chỉ thêm
--   policy — policy lọc DÒNG nhưng KHÔNG cấp quyền bảng). Client đọc THẲNG bảng (bộ chọn thương hiệu) →
--   403/rỗng → picker chỉ hiện 2 nút. Bảng cũ ads_tai_khoan_brand có 'authenticated:SELECT' — mirror.
--   (Đã thêm cùng dòng vào db/242 cho cài mới; migration này vá DB đã chạy db/242 bản cũ.) Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;
grant select on kho.ads_trang_brand to authenticated;
commit;
