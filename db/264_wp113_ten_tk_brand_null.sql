-- 264 — WP-113 L-113-5: cho phép dòng ads_tai_khoan_brand CHỈ CÓ TÊN (thương hiệu để trống).
--   brand_id nới NULLABLE (FK vẫn giữ, chỉ khác cho NULL). Thương hiệu chi ads vẫn lấy theo FANPAGE (ads_brand_cua_ad).
--   HOÀN TÁC: alter column brand_id set not null (sau khi xoá dòng brand_id null).
begin;
alter table kho.ads_tai_khoan_brand alter column brand_id drop not null;
commit;
