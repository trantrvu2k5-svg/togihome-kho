-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 259 — WP-113 lô 2C: bộ kéo Meta xin thêm 5 SỐ HÀNH ĐỘNG + cờ dạng, vào chi_chien_dich_ngay (cùng cấp trang đọc).
--   CHỈ cấu trúc + ngưỡng — KHÔNG ghi số liệu (bộ kéo dry-run trong test, chạy thật ở lệnh sau).
--   Cột NULL='chưa kéo' (KHÔNG default 0). Giữ nguyên cột cũ + on-conflict KHÔNG đè NULL (như luot_bam_link).
--   HOÀN TÁC: alter table drop 6 cột · drop table ads_nhom_quang_cao · chạy lại bản chi_chien_dich_ngay_ghi cũ · xoá 3 ngưỡng.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- [1a] 6 cột đếm (NULL='chưa kéo'). kiem_dang: 'du'|'la' (dòng dạng lạ).
alter table kho.chi_chien_dich_ngay
  add column if not exists luot_vao_trang  integer,   -- landing_page_view
  add column if not exists bam_ra_web      integer,   -- outbound_clicks / outbound_click
  add column if not exists cuoc_tro_chuyen integer,   -- onsite_conversion.messaging_conversation_started_7d
  add column if not exists lien_he_pixel   integer,   -- offsite_conversion.fb_pixel_lead
  add column if not exists mua_pixel       integer,   -- offsite_conversion.fb_pixel_purchase (kéo, CHƯA hiện)
  add column if not exists kiem_dang       text;      -- 'du' | 'la'
alter table kho.chi_chien_dich_ngay drop constraint if exists chi_chien_dich_ngay_kiem_dang_chk;
alter table kho.chi_chien_dich_ngay add constraint chi_chien_dich_ngay_kiem_dang_chk
  check (kiem_dang is null or kiem_dang in ('du','la'));

-- [1b] bảng nhóm quảng cáo (adset) — cho kiểm loại chiến dịch + luật "sửa nhiều tầng".
create table if not exists kho.ads_nhom_quang_cao (
  adset_id          text primary key,
  campaign_id       text,
  tai_khoan_id      text,
  optimization_goal text,
  custom_event_type text,
  cap_nhat_luc      timestamptz not null default now()
);
alter table kho.ads_nhom_quang_cao enable row level security;
drop policy if exists ads_nhom_doc on kho.ads_nhom_quang_cao;
create policy ads_nhom_doc on kho.ads_nhom_quang_cao for select
  using (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan','ads_user'));

-- [2] chi_chien_dich_ngay_ghi: nhận thêm 6 trường; on-conflict KHÔNG đè bằng NULL cho 5 số.
create or replace function kho.chi_chien_dich_ngay_ghi(p_ds jsonb)
 returns integer language plpgsql security definer set search_path to 'kho' as $function$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_chien_dich_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)'; end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, campaign_id text, campaign_name text, objective text, ngay date,
      chi_tieu numeric, hien_thi bigint, luot_bam bigint, luot_bam_link integer, tien_te text,
      luot_vao_trang integer, bam_ra_web integer, cuoc_tro_chuyen integer, lien_he_pixel integer, mua_pixel integer, kiem_dang text))
  , up as (
    insert into kho.chi_chien_dich_ngay(act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, tien_te, nguon, nhan_vat, keo_luc,
        luot_vao_trang, bam_ra_web, cuoc_tro_chuyen, lien_he_pixel, mua_pixel, kiem_dang)
    select act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, coalesce(nullif(tien_te,''),'VND'), 'meta_insights', 'chua_ro_vat', now(),
        luot_vao_trang, bam_ra_web, cuoc_tro_chuyen, lien_he_pixel, mua_pixel, kiem_dang
    from e where act_id is not null and campaign_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, campaign_id, ngay) do update set
      campaign_name=excluded.campaign_name, objective=excluded.objective, chi_tieu=excluded.chi_tieu,
      hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam,
      luot_bam_link=coalesce(excluded.luot_bam_link, kho.chi_chien_dich_ngay.luot_bam_link),
      luot_vao_trang=coalesce(excluded.luot_vao_trang, kho.chi_chien_dich_ngay.luot_vao_trang),
      bam_ra_web=coalesce(excluded.bam_ra_web, kho.chi_chien_dich_ngay.bam_ra_web),
      cuoc_tro_chuyen=coalesce(excluded.cuoc_tro_chuyen, kho.chi_chien_dich_ngay.cuoc_tro_chuyen),
      lien_he_pixel=coalesce(excluded.lien_he_pixel, kho.chi_chien_dich_ngay.lien_he_pixel),
      mua_pixel=coalesce(excluded.mua_pixel, kho.chi_chien_dich_ngay.mua_pixel),
      kiem_dang=coalesce(excluded.kiem_dang, kho.chi_chien_dich_ngay.kiem_dang),
      tien_te=excluded.tien_te, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $function$;

-- [1c] 3 ngưỡng (khuôn QD-93, hieu_luc_tu + ly_do [TẠM]). Không sửa khoá cũ.
insert into kho.ads_nguong (ma, gia_tri, hieu_luc_tu, ly_do)
  select * from (values
    ('ty_le_toi_trang_toi_thieu', 70,  date '2026-09-01', '[TẠM] xem-trang/bấm-ra-web < 70% = nghi LỖI WEB (WP-113)'),
    ('gia_cuoc_tro_chuyen_he_so', 1.5, date '2026-09-01', '[TẠM] chi/cuộc-trò-chuyện 7 ngày > nền 30 ngày × 1,5 → xét (WP-113)'),
    ('gia_lien_he_he_so',         1.5, date '2026-09-01', '[TẠM] chi/liên-hệ 7 ngày > nền 30 ngày × 1,5 → xét (WP-113)')
  ) v(ma,gia_tri,tu,ly)
  where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma);

commit;
