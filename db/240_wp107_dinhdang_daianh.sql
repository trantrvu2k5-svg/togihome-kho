-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 240 — WP-107 L-1c: (a) HÀM SUY ĐỊNH DẠNG dùng chung (một chỗ) → cột dinh_dang_that; nhãn object_type
--   (VIDEO/SHARE) SAI (bộ sưu tập đặt theo phần tử đầu) nên bỏ khỏi thẻ. (b) cột anh_dai_url jsonb (mảng url
--   ảnh cho mẫu XOAY VÒNG — kéo cả dải thẻ con). CHỈ thêm cột + hàm suy — KHÔNG đụng RPC số/quyền/đường ghi.
--   HOÀN TÁC: alter drop 2 cột + drop ads_suy_dinh_dang; chạy lại ghi/ds bản db/239.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table kho.ads_mau add column if not exists anh_dai_url jsonb not null default '[]'::jsonb;   -- mảng url ảnh (xoay vòng)
alter table kho.ads_mau add column if not exists dinh_dang_that text;                              -- suy từ tho (không phải object_type)

-- ── HÀM SUY ĐỊNH DẠNG (MỘT CHỖ DUY NHẤT) — thứ tự & luật y hệt rà L-107-1b ──
create or replace function kho.ads_suy_dinh_dang(p_tho jsonb) returns text
language plpgsql immutable set search_path to 'kho' as $fn$
declare oss jsonb; vd jsonb; ld jsonb; nchild int; afs jsonb; link text; appdest text;
begin
  oss := p_tho->'object_story_spec';
  vd  := oss->'video_data'; ld := oss->'link_data';
  nchild := case when jsonb_typeof(ld->'child_attachments')='array' then jsonb_array_length(ld->'child_attachments') else 0 end;
  afs := p_tho->'asset_feed_spec';
  link := coalesce(ld->>'link', vd->'call_to_action'->'value'->>'link', ld->'call_to_action'->'value'->>'link', '');
  appdest := coalesce(vd->'call_to_action'->'value'->>'app_destination', ld->'call_to_action'->'value'->>'app_destination');
  if (vd->>'video_id' is not null or vd->>'image_hash' is not null) and nchild < 2 then return 'video đơn'; end if;
  if (ld->>'image_hash' is not null) and nchild < 2 then return 'ảnh đơn'; end if;
  if nchild >= 2 then return 'ảnh xoay vòng'; end if;
  if link ~* 'canvas_doc' then return 'trải nghiệm tức thì'; end if;
  if appdest = 'MESSENGER' or afs->'message_extensions' is not null then return 'chạy tin nhắn'; end if;
  if afs is not null then return 'mẫu linh hoạt'; end if;
  if p_tho->>'effective_object_story_id' is not null and vd is null and ld is null then return 'đẩy bài có sẵn'; end if;
  return 'chưa rõ';
end $fn$;

-- điền dinh_dang_that cho dữ liệu đã có (một lần)
update kho.ads_mau set dinh_dang_that = kho.ads_suy_dinh_dang(tho);

-- ── GHI: thêm anh_dai_url + tự tính dinh_dang_that (hàm dùng chung) ──
create or replace function kho.ads_mau_ghi(p_mau jsonb, p_ad jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'ads_mau_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_mau) as x(
      creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
      page_id text, story_id text, ig_link text, anh_url text, thumbnail_url text, video_id text,
      anh_net_url text, anh_dai_url jsonb, tho jsonb))
  , up as (
    insert into kho.ads_mau(creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id, anh_net_url, anh_dai_url, dinh_dang_that, tho, keo_luc)
    select creative_id, ten, tieu_de, body, nut, dinh_dang, page_id, story_id, ig_link, anh_url, thumbnail_url, video_id,
           anh_net_url, coalesce(anh_dai_url,'[]'::jsonb), kho.ads_suy_dinh_dang(tho), tho, now()
      from e where creative_id is not null and tho is not null
    on conflict (creative_id) do update set
      ten=excluded.ten, tieu_de=excluded.tieu_de, body=excluded.body, nut=excluded.nut, dinh_dang=excluded.dinh_dang,
      page_id=excluded.page_id, story_id=excluded.story_id, ig_link=excluded.ig_link, anh_url=excluded.anh_url,
      thumbnail_url=excluded.thumbnail_url, video_id=excluded.video_id, anh_net_url=excluded.anh_net_url,
      anh_dai_url=excluded.anh_dai_url, dinh_dang_that=excluded.dinh_dang_that, tho=excluded.tho, keo_luc=now()
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

-- ── ĐỌC: ads_mau_ds() trả thêm anh_dai_url + dinh_dang_that (giữ MỌI cột/số db/239) ──
drop function if exists kho.ads_mau_ds();
create function kho.ads_mau_ds()
returns table(
  creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text, dinh_dang_that text,
  page_id text, link_fb text, ig_link text, anh_url text, thumbnail_url text, anh_net_url text, anh_dai_url jsonb, video_id text,
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
  agg as (select creative_id, min(ngay) ngay_dau, max(ngay) ngay_cuoi, sum(chi_tieu) chi, sum(hien_thi) hien_thi, sum(bam_link) bam from lk group by creative_id),
  soad as (select creative_id, count(distinct ad_id)::int so_ad from kho.ads_mau_ad group by creative_id),
  w7 as (select creative_id, sum(chi_tieu) chi7, sum(hien_thi) ht7, sum(bam_link) bam7 from lk where ngay >= (v_hom - 6) group by creative_id),
  td as (select l.creative_id, sum(l.hien_thi) ht0, sum(l.bam_link) bam0 from lk l join agg a on a.creative_id=l.creative_id where l.ngay <= a.ngay_dau + 6 group by l.creative_id),
  m as (
    select mm.*, a.ngay_dau, a.ngay_cuoi,
      case when a.ngay_dau is not null then (a.ngay_cuoi - a.ngay_dau + 1) end tuoi,
      coalesce(a.chi,0) chi_tong, coalesce(a.hien_thi,0) ht_tong, coalesce(a.bam,0) bam_tong,
      coalesce(sa.so_ad,0) so_ad,
      coalesce(w7.chi7,0) chi7, coalesce(w7.ht7,0) ht7, coalesce(w7.bam7,0) bam7,
      case when coalesce(td.ht0,0) > 0 then td.bam0::numeric / td.ht0 end ctr_td,
      case when coalesce(w7.ht7,0) > 0 then w7.bam7::numeric / w7.ht7 end ctr_7
    from kho.ads_mau mm
    left join agg a on a.creative_id=mm.creative_id left join soad sa on sa.creative_id=mm.creative_id
    left join w7 on w7.creative_id=mm.creative_id left join td on td.creative_id=mm.creative_id
  )
  select m.creative_id, m.ten, m.tieu_de, m.body, m.nut, m.dinh_dang, m.dinh_dang_that,
    m.page_id, case when m.story_id is not null then 'https://www.facebook.com/' || m.story_id end,
    m.ig_link, m.anh_url, m.thumbnail_url, m.anh_net_url, m.anh_dai_url, m.video_id,
    m.so_ad, m.chi_tong, m.ht_tong::bigint, m.bam_tong::bigint, m.keo_luc,
    m.chi7, m.ht7::bigint, m.bam7::bigint, (m.chi7 > 0),
    m.ngay_dau, m.ngay_cuoi, m.tuoi,
    round(m.ctr_td, 6), round(m.ctr_7, 6),
    case when coalesce(m.tuoi,0) >= 7 and m.ctr_td is not null and m.ctr_td > 0 and m.ctr_7 is not null
         then round((m.ctr_7 - m.ctr_td) / m.ctr_td, 4) end
  from m order by m.chi7 desc, m.keo_luc desc;
end $fn$;
revoke execute on function kho.ads_mau_ds() from public, anon;
grant  execute on function kho.ads_mau_ds() to authenticated;

commit;
