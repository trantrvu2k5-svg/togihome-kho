-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 239 — WP-107 LÔ 1: ẢNH NÉT. thumbnail_url của creative là ảnh xem trước 64×64 (phóng lên VỠ — lỗi WP-103).
--   ĐO THẬT (3 mẫu video): (a) /{video_id}/thumbnails → (#10) app thiếu quyền · (b) oss image_url → 404 ·
--   (c) thumbnail_url cũ → 64×64. Cách CHẠY: object_story_spec.video_data.image_hash → /act_{act}/adimages
--   → url ảnh 1440×1440 (fbcdn signed, có hạn → ghi đè mỗi vòng như các URL Meta khác, QD-c WP-103).
--   Mẫu SHARE/không image_hash → anh_net_url NULL → UI giữ ô xám "Meta không trả ảnh cho mẫu này" (cấm bịa).
--   CHỈ thêm cột + nối dây ghi/đọc — KHÔNG đụng RPC số, quyền, đường ghi. Số hiện ra y hệt.
--   HOÀN TÁC: alter table drop column anh_net_url; chạy lại ads_mau_ghi/ads_mau_ds bản db/237-238.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table kho.ads_mau add column if not exists anh_net_url text;   -- URL ảnh nét (adimages 1440px), có hạn → ghi đè mỗi vòng

-- ── cửa GHI: thêm anh_net_url vào recordset + upsert ──
create or replace function kho.ads_mau_ghi(p_mau jsonb, p_ad jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'ads_mau_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_mau) as x(
      creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
      page_id text, story_id text, ig_link text, anh_url text, thumbnail_url text, video_id text, anh_net_url text, tho jsonb))
  , up as (
    insert into kho.ads_mau(creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id, anh_net_url, tho, keo_luc)
    select creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id, anh_net_url, tho, now()
      from e where creative_id is not null and tho is not null
    on conflict (creative_id) do update set
      ten=excluded.ten, tieu_de=excluded.tieu_de, body=excluded.body, nut=excluded.nut, dinh_dang=excluded.dinh_dang,
      page_id=excluded.page_id, story_id=excluded.story_id, ig_link=excluded.ig_link, anh_url=excluded.anh_url,
      thumbnail_url=excluded.thumbnail_url, video_id=excluded.video_id, anh_net_url=excluded.anh_net_url, tho=excluded.tho, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  insert into kho.ads_mau_ad(creative_id, ad_id, tai_khoan_id, keo_luc)
  select creative_id, ad_id, tai_khoan_id, now()
    from jsonb_to_recordset(p_ad) as y(creative_id text, ad_id text, tai_khoan_id text)
    where creative_id is not null and ad_id is not null
  on conflict (creative_id, ad_id) do update set tai_khoan_id=excluded.tai_khoan_id, keo_luc=now();
  return n;
end $fn$;
revoke execute on function kho.ads_mau_ghi(jsonb, jsonb) from public, anon;
grant  execute on function kho.ads_mau_ghi(jsonb, jsonb) to authenticated;

-- ── ĐỌC: ads_mau_ds() trả THÊM anh_net_url (giữ nguyên MỌI cột + số khác của db/238) ──
drop function if exists kho.ads_mau_ds();
create function kho.ads_mau_ds()
returns table(
  creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
  page_id text, link_fb text, ig_link text, anh_url text, thumbnail_url text, anh_net_url text, video_id text,
  so_ad int, chi numeric, hien_thi bigint, bam bigint, keo_luc timestamptz,
  chi_7ngay numeric, hien_thi_7ngay bigint, bam_7ngay bigint, dang_chay boolean,
  ngay_dau date, ngay_cuoi date, tuoi_ngay int,
  ctr_tuan_dau numeric, ctr_7ngay numeric, ctr_lech_pct numeric
) language plpgsql security definer set search_path to 'kho' as $fn$
#variable_conflict use_column
declare v_hom date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_mau_ds: chỉ ceo/ke_toan/ads_user';
  end if;
  return query
  with lk as (
    select ma.creative_id, ca.ngay, ca.chi_tieu, ca.hien_thi, coalesce(ca.luot_bam_link,0) bam_link
    from kho.ads_mau_ad ma join kho.chi_ads_ngay ca on ca.ad_id = ma.ad_id
  ),
  agg as (
    select creative_id, min(ngay) ngay_dau, max(ngay) ngay_cuoi,
      sum(chi_tieu) chi, sum(hien_thi) hien_thi, sum(bam_link) bam
    from lk group by creative_id
  ),
  soad as (select creative_id, count(distinct ad_id)::int so_ad from kho.ads_mau_ad group by creative_id),
  w7 as (select creative_id, sum(chi_tieu) chi7, sum(hien_thi) ht7, sum(bam_link) bam7
    from lk where ngay >= (v_hom - 6) group by creative_id),
  td as (select l.creative_id, sum(l.hien_thi) ht0, sum(l.bam_link) bam0
    from lk l join agg a on a.creative_id = l.creative_id where l.ngay <= a.ngay_dau + 6 group by l.creative_id),
  m as (
    select mm.*, a.ngay_dau, a.ngay_cuoi,
      case when a.ngay_dau is not null then (a.ngay_cuoi - a.ngay_dau + 1) end tuoi,
      coalesce(a.chi,0) chi_tong, coalesce(a.hien_thi,0) ht_tong, coalesce(a.bam,0) bam_tong,
      coalesce(sa.so_ad,0) so_ad,
      coalesce(w7.chi7,0) chi7, coalesce(w7.ht7,0) ht7, coalesce(w7.bam7,0) bam7,
      case when coalesce(td.ht0,0) > 0 then td.bam0::numeric / td.ht0 end ctr_td,
      case when coalesce(w7.ht7,0) > 0 then w7.bam7::numeric / w7.ht7 end ctr_7
    from kho.ads_mau mm
    left join agg a  on a.creative_id  = mm.creative_id
    left join soad sa on sa.creative_id = mm.creative_id
    left join w7    on w7.creative_id  = mm.creative_id
    left join td    on td.creative_id  = mm.creative_id
  )
  select m.creative_id, m.ten, m.tieu_de, m.body, m.nut, m.dinh_dang,
    m.page_id,
    case when m.story_id is not null then 'https://www.facebook.com/' || m.story_id end,
    m.ig_link, m.anh_url, m.thumbnail_url, m.anh_net_url, m.video_id,
    m.so_ad, m.chi_tong, m.ht_tong::bigint, m.bam_tong::bigint, m.keo_luc,
    m.chi7, m.ht7::bigint, m.bam7::bigint, (m.chi7 > 0),
    m.ngay_dau, m.ngay_cuoi, m.tuoi,
    round(m.ctr_td, 6), round(m.ctr_7, 6),
    case when coalesce(m.tuoi,0) >= 7 and m.ctr_td is not null and m.ctr_td > 0 and m.ctr_7 is not null
         then round((m.ctr_7 - m.ctr_td) / m.ctr_td, 4) end
  from m
  order by m.chi7 desc, m.keo_luc desc;
end $fn$;
revoke execute on function kho.ads_mau_ds() from public, anon;
grant  execute on function kho.ads_mau_ds() to authenticated;

commit;
