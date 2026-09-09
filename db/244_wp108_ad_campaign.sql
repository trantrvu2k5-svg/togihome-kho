-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 244 — WP-108 nhịp 1: BẢNG NỐI ad_id ↔ campaign_id (vá chỗ hụt cấu trúc của chi_chien_dich_ngay).
--   QUYẾT ĐỊNH: chi_chien_dich_ngay là số GỘP THEO CHIẾN DỊCH (1 dòng/chiến dịch/ngày, KHÔNG có ad đơn lẻ)
--   → KHÔNG thêm cột ad_id được (thêm vào hàng gộp là vô nghĩa). Bộ kéo chiến dịch cũng lấy insights mức
--   campaign, KHÔNG có ad_id. Vì vậy chọn CÁCH (b): bảng nối riêng, kéo ad→campaign từ Meta. Nhờ L-108-1
--   đo 34/34 chiến dịch một trang, campaign → 1 trang là xác định → chi_chien_dich_ngay nối được sang page
--   GIÁN TIẾP qua bảng này (campaign → ad → ads_mau.page_id).
--   Client chỉ SELECT (RLS); ghi qua DEFINER + GUC kho.meta_he_thong (khuôn ads_mau_ghi). Backfill: ops/keo_ad_campaign_meta.mjs.
--   ⚠ KHÔNG IDEMPOTENT (create table). Cổng backup QD-61. HOÀN TÁC: drop table ads_ad_campaign + drop function.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table kho.ads_ad_campaign (
  ad_id         text primary key,
  campaign_id   text not null,
  campaign_name text,
  tai_khoan_id  text,
  keo_luc       timestamptz not null default now()
);
comment on table kho.ads_ad_campaign is 'WP-108: nối ad_id ↔ campaign_id (kéo Meta). Cho phép chi_chien_dich_ngay nối sang page qua ad.';

alter table kho.ads_ad_campaign enable row level security;
revoke all on kho.ads_ad_campaign from public, anon, authenticated;
create policy ad_campaign_doc on kho.ads_ad_campaign
  for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

create or replace function kho.ads_ad_campaign_ghi(p jsonb) returns int
language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan')
          or coalesce(current_setting('kho.meta_he_thong', true), '') = '1') then
    raise exception 'ads_ad_campaign_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p) as x(ad_id text, campaign_id text, campaign_name text, tai_khoan_id text)),
  up as (
    insert into kho.ads_ad_campaign (ad_id, campaign_id, campaign_name, tai_khoan_id, keo_luc)
    select ad_id, campaign_id, campaign_name, tai_khoan_id, now()
      from e where ad_id is not null and campaign_id is not null
    on conflict (ad_id) do update set
      campaign_id=excluded.campaign_id, campaign_name=excluded.campaign_name,
      tai_khoan_id=excluded.tai_khoan_id, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $fn$;
revoke execute on function kho.ads_ad_campaign_ghi(jsonb) from public, anon;
grant  execute on function kho.ads_ad_campaign_ghi(jsonb) to authenticated;

commit;
