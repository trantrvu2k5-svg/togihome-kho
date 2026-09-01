-- db/200 · WP-78 L-20 · Đổi trục app ads sang CHIẾN DỊCH × ngày (mức ad_id thành khối phụ). QD-89.
--   CĂN CỨ (L-19 đo thật): 6 ad đang tiêu đều OUTCOME_SALES/OFFSITE_CONVERSIONS — KHÔNG đóng ad_id lên hội thoại,
--     giao với 21 ad có hội thoại = 0 mã (cấu trúc). Trục ad_id chỉ đúng cho ad TIN NHẮN (đã tắt). Chi phí có ở MỌI mức.
--   chi_chien_dich_ngay = bảng ĐỒNG BỘ cùng khuôn chi_ads_ngay (upsert theo khoá, Meta chốt muộn) — số Meta cấp campaign
--     là NGUỒN GỐC (không suy từ tổng ad → không hai bản đá nhau). objective NGUYÊN TRẠNG (không dịch, không phân loại lại).
--   Đơn/doanh thu/CAC ở trục chiến dịch: để NULL + nhãn 'cho_capi' — quy kết ad chuyển đổi đi qua CAPI (vế a), CHƯA có.
--     CẤM ghép tạm bằng ad_id, CẤM chia doanh thu theo tỷ lệ chi.
--   GIỮ NGUYÊN chi_ads_ngay (cấp ad) + ads_ad_ngay (chữ ký, app đang gọi) — KHÔNG đụng.
--   ⚠ KHÔNG IDEMPOTENT (create table). Cổng backup QD-61.
--   HOÀN TÁC: drop table kho.chi_chien_dich_ngay; drop function kho.chi_chien_dich_ngay_ghi(jsonb), kho.ads_chien_dich_ngay(date,date);
begin;

create table kho.chi_chien_dich_ngay (
  id            bigserial primary key,
  act_id        text not null,
  campaign_id   text not null,
  campaign_name text,
  objective     text,                                 -- NGUYÊN TRẠNG: OUTCOME_SALES/OUTCOME_ENGAGEMENT/...
  ngay          date not null,
  chi_tieu      numeric not null,                      -- nguyên trạng Meta (không +VAT)
  hien_thi      bigint,
  luot_bam      bigint,
  tien_te       text not null default 'VND',
  nhan_vat      text not null default 'chua_ro_vat',
  keo_luc       timestamptz not null default now(),
  nguon         text not null default 'meta_insights',
  unique (act_id, campaign_id, ngay)                    -- kéo lại cùng ngày = CẬP NHẬT
);
create index ix_ccn_ngay on kho.chi_chien_dich_ngay (ngay, act_id);
comment on table kho.chi_chien_dich_ngay is 'WP-78/QD-89: chi phí Meta cấp CHIẾN DỊCH × ngày (trục chính app ads). Bảng ĐỒNG BỘ (upsert), objective nguyên trạng, nhan_vat=chua_ro_vat.';
alter table kho.chi_chien_dich_ngay enable row level security;
revoke all on kho.chi_chien_dich_ngay from public, anon, authenticated;
create policy ccn_doc on kho.chi_chien_dich_ngay for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- Cửa GHI upsert lô (khuôn chi_ads_ngay_ghi) — bộ kéo owner/hệ thống gọi (GUC meta_he_thong).
create or replace function kho.chi_chien_dich_ngay_ghi(p_ds jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_chien_dich_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, campaign_id text, campaign_name text, objective text, ngay date,
      chi_tieu numeric, hien_thi bigint, luot_bam bigint, tien_te text))
  , up as (
    insert into kho.chi_chien_dich_ngay(act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, tien_te, nguon, nhan_vat, keo_luc)
    select act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, coalesce(nullif(tien_te,''),'VND'), 'meta_insights', 'chua_ro_vat', now()
    from e where act_id is not null and campaign_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, campaign_id, ngay) do update set
      campaign_name=excluded.campaign_name, objective=excluded.objective, chi_tieu=excluded.chi_tieu,
      hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam, tien_te=excluded.tien_te, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $fn$;
revoke execute on function kho.chi_chien_dich_ngay_ghi(jsonb) from public, anon;
grant  execute on function kho.chi_chien_dich_ngay_ghi(jsonb) to authenticated;

-- RPC TRỤC CHÍNH: chiến dịch × ngày. Đơn/doanh thu/CAC = NULL + nhãn 'cho_capi' (quy kết qua CAPI, chưa có).
create or replace function kho.ads_chien_dich_ngay(p_tu_ngay date, p_den_ngay date)
returns table(
  act_id text, campaign_id text, campaign_name text, objective text, ngay date,
  chi numeric, hien_thi bigint, luot_bam bigint, nhan_vat text,
  don int, doanh_thu numeric, nguon_don text, cac numeric
) language plpgsql security definer set search_path to 'kho'
as $fn$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_chien_dich_ngay: chỉ ceo/ke_toan/ads_user';
  end if;
  return query
  select ca.act_id, ca.campaign_id, ca.campaign_name, ca.objective, ca.ngay,
    ca.chi_tieu, ca.hien_thi, ca.luot_bam, ca.nhan_vat,
    null::int    as don,           -- quy kết đi qua CAPI (vế a), CHƯA có — KHÔNG ghép ad_id, KHÔNG chia theo chi
    null::numeric as doanh_thu,
    'cho_capi'::text as nguon_don,
    null::numeric as cac           -- không đơn → không CAC (không chia 0)
  from kho.chi_chien_dich_ngay ca
  where ca.ngay >= p_tu_ngay and ca.ngay <= p_den_ngay
  order by ca.ngay desc, ca.chi_tieu desc;
end $fn$;
revoke execute on function kho.ads_chien_dich_ngay(date,date) from public, anon;
grant  execute on function kho.ads_chien_dich_ngay(date,date) to authenticated;

do $$ begin
  if to_regclass('kho.chi_chien_dich_ngay') is null then raise exception 'THIẾU chi_chien_dich_ngay'; end if;
  raise notice 'db/200 OK: chi_chien_dich_ngay + chi_chien_dich_ngay_ghi + ads_chien_dich_ngay (trục chính). ad_id giữ nguyên.';
end $$;
commit;
