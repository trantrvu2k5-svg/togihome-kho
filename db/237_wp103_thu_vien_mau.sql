-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 237 — WP-103: THƯ VIỆN MẪU QUẢNG CÁO (creative). TRA SÁCH: ba sách không nói về thư viện mẫu QC —
--   cấu trúc suy từ Meta Marketing API v21.0 (đã thử thật L-103-1).
--   KHOÁ = creative_id (một creative chạy ở NHIỀU ad); bảng nối ads_mau_ad giữ ad_id để nối chi_ads_ngay.
--   Giữ NGUYÊN VĂN JSON creative vào cột jsonb `tho` bên cạnh cột đã bóc (sai cột thì bóc lại từ tho, không kéo lại Meta).
--   Ảnh/video: CHỈ URL Meta + keo_luc (URL có hạn → mỗi vòng kéo GHI ĐÈ). page_id chỉ từ object_story_spec.page_id,
--   không có → NULL + ĐẾM RIÊNG "chưa xác định", CẤM gán bừa. Link bài FB KHÔNG lưu cột — dựng từ story_id lúc đọc.
--   ⚠ KHÔNG IDEMPOTENT (create table). Cổng backup QD-61 (run_sql.mjs tự dump).
--   HOÀN TÁC: drop table kho.ads_mau_ad, kho.ads_mau cascade; drop 4 function ads_mau_*.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── 0) MỞ RỘNG nguồn moc_keo cho lượt kéo mẫu (đèn trễ nhận diện 'meta_mau') ──
alter table kho.ads_moc_keo drop constraint if exists ads_moc_keo_nguon_check;
alter table kho.ads_moc_keo add  constraint ads_moc_keo_nguon_check
  check (nguon in ('meta_chi_ad','meta_chi_chien_dich','gop_ky','meta_thay_doi','meta_nen_tang','meta_mau'));

-- ── 1) BẢNG mẫu (khoá creative_id) ──
create table kho.ads_mau (
  creative_id   text primary key,
  ten           text,
  tieu_de       text,          -- title
  body          text,
  nut           text,          -- call_to_action_type
  dinh_dang     text,          -- object_type
  page_id       text,          -- object_story_spec.page_id (NULL = chưa xác định)
  story_id      text,          -- effective_object_story_id (dựng link FB lúc đọc)
  ig_link       text,          -- instagram_permalink_url (có sẵn từ Meta)
  anh_url       text,          -- image_url
  thumbnail_url text,
  video_id      text,
  tho           jsonb not null,-- JSON creative NGUYÊN VĂN
  keo_luc       timestamptz not null default now()
);

-- ── bảng NỐI creative ⇄ ad (một creative nhiều ad) — nối sang chi_ads_ngay bằng ad_id ──
create table kho.ads_mau_ad (
  creative_id text not null references kho.ads_mau(creative_id) on delete cascade,
  ad_id       text not null,
  tai_khoan_id text,           -- act_id
  keo_luc     timestamptz not null default now(),
  primary key (creative_id, ad_id)
);
create index ads_mau_ad_adid on kho.ads_mau_ad(ad_id);

-- ── RLS: client CHỈ SELECT (ceo/ke_toan/ads_user). Client GHI = 0 CỘT (ghi qua RPC hệ thống). QD-96/97 ──
alter table kho.ads_mau    enable row level security;
alter table kho.ads_mau_ad enable row level security;
revoke all on kho.ads_mau    from public, anon, authenticated;
revoke all on kho.ads_mau_ad from public, anon, authenticated;
create policy mau_doc    on kho.ads_mau    for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));
create policy mau_ad_doc on kho.ads_mau_ad for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- ── 2) CỬA GHI (bộ kéo hệ thống gọi: GUC kho.meta_he_thong, khuôn chi_ads_ngay_ghi) — upsert cả hai bảng ──
create or replace function kho.ads_mau_ghi(p_mau jsonb, p_ad jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'ads_mau_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_mau) as x(
      creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
      page_id text, story_id text, ig_link text, anh_url text, thumbnail_url text, video_id text, tho jsonb))
  , up as (
    insert into kho.ads_mau(creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id, tho, keo_luc)
    select creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id, tho, now()
      from e where creative_id is not null and tho is not null
    on conflict (creative_id) do update set
      ten=excluded.ten, tieu_de=excluded.tieu_de, body=excluded.body, nut=excluded.nut, dinh_dang=excluded.dinh_dang,
      page_id=excluded.page_id, story_id=excluded.story_id, ig_link=excluded.ig_link, anh_url=excluded.anh_url,
      thumbnail_url=excluded.thumbnail_url, video_id=excluded.video_id, tho=excluded.tho, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  -- bảng nối
  insert into kho.ads_mau_ad(creative_id, ad_id, tai_khoan_id, keo_luc)
  select creative_id, ad_id, tai_khoan_id, now()
    from jsonb_to_recordset(p_ad) as y(creative_id text, ad_id text, tai_khoan_id text)
    where creative_id is not null and ad_id is not null
  on conflict (creative_id, ad_id) do update set tai_khoan_id=excluded.tai_khoan_id, keo_luc=now();
  return n;
end $fn$;
revoke execute on function kho.ads_mau_ghi(jsonb, jsonb) from public, anon;
grant  execute on function kho.ads_mau_ghi(jsonb, jsonb) to authenticated;

-- ── 3) ĐỌC lưới: mẫu + link FB dựng sẵn + ig + chi/hiển thị/bấm cộng dồn từ chi_ads_ngay + số ad dùng chung ──
create or replace function kho.ads_mau_ds()
returns table(
  creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
  page_id text, link_fb text, ig_link text, anh_url text, thumbnail_url text, video_id text,
  so_ad int, chi numeric, hien_thi bigint, bam bigint, keo_luc timestamptz
) language plpgsql security definer set search_path to 'kho' as $fn$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_mau_ds: chỉ ceo/ke_toan/ads_user';
  end if;
  return query
  with sm as (   -- cộng dồn chi phí theo creative qua bảng nối → chi_ads_ngay (ad_id)
    select ma.creative_id,
      count(distinct ma.ad_id)::int so_ad,
      coalesce(sum(ca.chi_tieu),0) chi,
      coalesce(sum(ca.hien_thi),0)::bigint hien_thi,
      coalesce(sum(coalesce(ca.luot_bam_link, ca.luot_bam)),0)::bigint bam
    from kho.ads_mau_ad ma left join kho.chi_ads_ngay ca on ca.ad_id = ma.ad_id
    group by ma.creative_id
  )
  select m.creative_id, m.ten, m.tieu_de, m.body, m.nut, m.dinh_dang,
    m.page_id,
    case when m.story_id is not null then 'https://www.facebook.com/' || m.story_id else null end,   -- MỘT nguồn: dựng từ story_id
    m.ig_link, m.anh_url, m.thumbnail_url, m.video_id,
    coalesce(sm.so_ad,0), coalesce(sm.chi,0), coalesce(sm.hien_thi,0), coalesce(sm.bam,0), m.keo_luc
  from kho.ads_mau m left join sm on sm.creative_id = m.creative_id
  order by coalesce(sm.chi,0) desc, m.keo_luc desc;
end $fn$;
revoke execute on function kho.ads_mau_ds() from public, anon;
grant  execute on function kho.ads_mau_ds() to authenticated;

-- ── TÓM TẮT: đếm TỪ DỮ LIỆU (không tham số). SỐ FANPAGE = count(distinct page_id) ──
create or replace function kho.ads_mau_tom_tat()
returns table(tong_mau int, so_fanpage int, so_mau_chua_xac_dinh int, so_tai_khoan int)
language plpgsql security definer set search_path to 'kho' as $fn$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_mau_tom_tat: chỉ ceo/ke_toan/ads_user';
  end if;
  return query select
    (select count(*)::int from kho.ads_mau),
    (select count(distinct page_id)::int from kho.ads_mau where page_id is not null),
    (select count(*)::int from kho.ads_mau where page_id is null),
    (select count(distinct tai_khoan_id)::int from kho.ads_mau_ad where tai_khoan_id is not null);
end $fn$;
revoke execute on function kho.ads_mau_tom_tat() from public, anon;
grant  execute on function kho.ads_mau_tom_tat() to authenticated;

commit;
