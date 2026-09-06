-- db/233 · WP-100 L-100.3 · nối dây KÉO THẬT: mở nguồn mốc cho sổ thay đổi + tách nền tảng,
--   và mở rộng chi_ads_ngay_ghi nhận 10 thước mẫu (idempotent, KHÔNG đè NULL — mẫu ảnh giữ NULL).

begin;

-- ── C/D: thêm nguồn mốc meta_thay_doi (sổ thay đổi) + meta_nen_tang (tách FB/IG) ──
alter table kho.ads_moc_keo drop constraint ads_moc_keo_nguon_check;
alter table kho.ads_moc_keo add constraint ads_moc_keo_nguon_check
  check (nguon in ('meta_chi_ad', 'meta_chi_chien_dich', 'gop_ky', 'meta_thay_doi', 'meta_nen_tang'));

-- ── B: chi_ads_ngay_ghi nhận thêm 10 cột thước. GIỮ idempotent + KHÔNG đè bằng NULL (mẫu ảnh, hoặc
--   Meta chốt muộn field video). Xếp hạng là CHỮ — coalesce-giữ để chuỗi "chưa đủ dữ liệu" không bị NULL wipe.
create or replace function kho.chi_ads_ngay_ghi(p_ds jsonb)
  returns integer language plpgsql security definer set search_path = kho as $function$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, ad_id text, ad_name text, ngay date, chi_tieu numeric, hien_thi bigint, luot_bam bigint,
      luot_bam_link integer, tien_te text,
      tan_suat numeric, luot_phat bigint, thruplay bigint, xem_p25 bigint, xem_p50 bigint, xem_p75 bigint, xem_p100 bigint,
      xep_hang_chat_luong text, xep_hang_tuong_tac text, xep_hang_chuyen_doi text))
  , up as (
    insert into kho.chi_ads_ngay(act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, tien_te,
        nguon, nhan_vat, keo_luc,
        tan_suat, luot_phat, thruplay, xem_p25, xem_p50, xem_p75, xem_p100,
        xep_hang_chat_luong, xep_hang_tuong_tac, xep_hang_chuyen_doi)
    select act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, coalesce(nullif(tien_te,''),'VND'),
        'meta_insights', 'chua_ro_vat', now(),
        tan_suat, luot_phat, thruplay, xem_p25, xem_p50, xem_p75, xem_p100,
        xep_hang_chat_luong, xep_hang_tuong_tac, xep_hang_chuyen_doi
    from e where act_id is not null and ad_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, ad_id, ngay) do update set
      ad_name=excluded.ad_name, chi_tieu=excluded.chi_tieu, hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam,
      luot_bam_link=coalesce(excluded.luot_bam_link, kho.chi_ads_ngay.luot_bam_link),
      tien_te=excluded.tien_te, keo_luc=now(),
      -- KHÔNG đè bằng NULL: mẫu ảnh trả NULL video, hoặc Meta tạm rơi field → giữ số cũ.
      tan_suat=coalesce(excluded.tan_suat, kho.chi_ads_ngay.tan_suat),
      luot_phat=coalesce(excluded.luot_phat, kho.chi_ads_ngay.luot_phat),
      thruplay=coalesce(excluded.thruplay, kho.chi_ads_ngay.thruplay),
      xem_p25=coalesce(excluded.xem_p25, kho.chi_ads_ngay.xem_p25),
      xem_p50=coalesce(excluded.xem_p50, kho.chi_ads_ngay.xem_p50),
      xem_p75=coalesce(excluded.xem_p75, kho.chi_ads_ngay.xem_p75),
      xem_p100=coalesce(excluded.xem_p100, kho.chi_ads_ngay.xem_p100),
      xep_hang_chat_luong=coalesce(excluded.xep_hang_chat_luong, kho.chi_ads_ngay.xep_hang_chat_luong),
      xep_hang_tuong_tac=coalesce(excluded.xep_hang_tuong_tac, kho.chi_ads_ngay.xep_hang_tuong_tac),
      xep_hang_chuyen_doi=coalesce(excluded.xep_hang_chuyen_doi, kho.chi_ads_ngay.xep_hang_chuyen_doi)
    returning 1)
  select count(*)::int into n from up;
  return n;
end $function$;

-- ── C: RPC ghi sổ thay đổi (client không ghi thẳng — QD-96). Idempotent qua khoá duy nhất (ON CONFLICT DO NOTHING). ──
create or replace function kho.ads_thay_doi_ghi(p_ds jsonb)
  returns integer language plpgsql security definer set search_path = kho as $function$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'ads_thay_doi_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, event_time timestamptz, event_type text, doi_tuong text, ma_doi_tuong text, mo_ta text, nguoi_thuc_hien text))
  , up as (
    insert into kho.ads_thay_doi(act_id, event_time, event_type, doi_tuong, ma_doi_tuong, mo_ta, nguoi_thuc_hien)
    select act_id, event_time, event_type, doi_tuong, ma_doi_tuong, mo_ta, nguoi_thuc_hien
    from e where act_id is not null and event_time is not null and event_type is not null
    on conflict (act_id, event_time, event_type, coalesce(ma_doi_tuong,'')) do nothing
    returning 1)
  select count(*)::int into n from up;
  return n;
end $function$;

-- ── D: RPC ghi tách nền tảng (idempotent qua khoá duy nhất act_id+ad_id+ngay+nen_tang). ──
create or replace function kho.chi_ads_nen_tang_ghi(p_ds jsonb)
  returns integer language plpgsql security definer set search_path = kho as $function$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_nen_tang_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, ad_id text, ngay date, nen_tang text, chi_tieu numeric, hien_thi bigint, luot_bam_link integer, tien_te text))
  , up as (
    insert into kho.chi_ads_nen_tang_ngay(act_id, ad_id, ngay, nen_tang, chi_tieu, hien_thi, luot_bam_link, tien_te, la_uoc_tinh)
    select act_id, ad_id, ngay, nen_tang, chi_tieu, hien_thi, luot_bam_link, coalesce(nullif(tien_te,''),'VND'), true
    from e where act_id is not null and ad_id is not null and ngay is not null and nen_tang is not null and chi_tieu is not null
    on conflict (act_id, ad_id, ngay, nen_tang) do update set
      chi_tieu=excluded.chi_tieu, hien_thi=excluded.hien_thi,
      luot_bam_link=coalesce(excluded.luot_bam_link, kho.chi_ads_nen_tang_ngay.luot_bam_link), tien_te=excluded.tien_te
    returning 1)
  select count(*)::int into n from up;
  return n;
end $function$;

grant execute on function kho.ads_thay_doi_ghi(jsonb), kho.chi_ads_nen_tang_ghi(jsonb) to service_role;

commit;
