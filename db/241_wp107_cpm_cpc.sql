-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 241 — WP-107 L-1f: ads_mau_ds() trả thêm CPM + CPC LINK, TÍNH LÚC ĐỌC (chi/hiển thị đổi mỗi ngày → không lưu cột).
--   • cpm_7ngay = chi_7ngay / hien_thi_7ngay * 1000 · cpc_link_7ngay = chi_7ngay / bam_7ngay (bam = luot_bam_link)
--   • cpm_doi / cpc_link_doi = CỘNG DỒN CẢ ĐỜI (cho nhóm Đã nghỉ, không tiêu 7 ngày).
--   Mẫu số 0 → NULL (UI "—"). CẤM chia 0, CẤM lấy 0 làm nền. KHÔNG kéo thêm gì từ Meta.
--   ⚠ CHƯA LÀM (lô riêng — cần kéo unique_clicks + actions): Unique CTR · Cost per unique link click ·
--     Cost per unique content view — đụng bộ kéo, phải kéo lại lịch sử.
--   Idempotent (drop+create). HOÀN TÁC: chạy lại ads_mau_ds() bản db/240.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists kho.ads_mau_ds();
create function kho.ads_mau_ds()
returns table(
  creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text, dinh_dang_that text,
  page_id text, link_fb text, ig_link text, anh_url text, thumbnail_url text, anh_net_url text, anh_dai_url jsonb, video_id text,
  so_ad int, chi numeric, hien_thi bigint, bam bigint, keo_luc timestamptz,
  chi_7ngay numeric, hien_thi_7ngay bigint, bam_7ngay bigint, dang_chay boolean,
  cpm_7ngay numeric, cpc_link_7ngay numeric, cpm_doi numeric, cpc_link_doi numeric,
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
    case when m.ht7  > 0 then round(m.chi7 / m.ht7 * 1000) end,      -- cpm_7ngay (đ/1000 hiển thị)
    case when m.bam7 > 0 then round(m.chi7 / m.bam7) end,            -- cpc_link_7ngay (đ/bấm link)
    case when m.ht_tong  > 0 then round(m.chi_tong / m.ht_tong * 1000) end,  -- cpm_doi (cộng dồn cả đời)
    case when m.bam_tong > 0 then round(m.chi_tong / m.bam_tong) end,        -- cpc_link_doi (cộng dồn cả đời)
    m.ngay_dau, m.ngay_cuoi, m.tuoi,
    round(m.ctr_td, 6), round(m.ctr_7, 6),
    case when coalesce(m.tuoi,0) >= 7 and m.ctr_td is not null and m.ctr_td > 0 and m.ctr_7 is not null
         then round((m.ctr_7 - m.ctr_td) / m.ctr_td, 4) end
  from m order by m.chi7 desc, m.keo_luc desc;
end $fn$;
revoke execute on function kho.ads_mau_ds() from public, anon;
grant  execute on function kho.ads_mau_ds() to authenticated;

commit;
