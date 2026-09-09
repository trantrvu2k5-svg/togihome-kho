-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 243 — WP-108 nhịp 1: HÀM ad → brand (MỘT CHỖ DUY NHẤT). Mọi RPC sau gọi hàm này, không tự nối lại.
--   Đường: ad_id → ads_mau_ad → ads_mau.page_id → ads_trang_brand (dòng đang hiệu lực, hieu_luc_den null).
--   KHÔNG nối được (ad chưa có creative · creative không page_id · trang chưa gán brand) → trả 'chưa rõ'.
--   TUYỆT ĐỐI KHÔNG trả brand mặc định — 'chưa rõ' để đo được phần hụt, không giấu tiền vào một brand.
--   Idempotent (create or replace). HOÀN TÁC: drop function.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.ads_brand_cua_ad(p_ad_id text) returns text
language sql stable security definer set search_path to 'kho' as $fn$
  select coalesce((
    select tb.brand_id
    from kho.ads_mau_ad ma
    join kho.ads_mau m        on m.creative_id = ma.creative_id
    join kho.ads_trang_brand tb on tb.page_id = m.page_id and tb.hieu_luc_den is null
    where ma.ad_id = p_ad_id
    limit 1
  ), 'chưa rõ');
$fn$;

revoke execute on function kho.ads_brand_cua_ad(text) from public, anon;
grant  execute on function kho.ads_brand_cua_ad(text) to authenticated;

commit;
