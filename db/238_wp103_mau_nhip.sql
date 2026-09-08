-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 238 — WP-103: NHỊP MẪU. Mở rộng ads_mau_ds() trả thêm chi/hiển thị/bấm 7 NGÀY, tuổi mẫu, và
--   CTR SO VỚI TUẦN ĐẦU CỦA CHÍNH NÓ (cấm so trung bình tài khoản). TRA SÁCH: cách "so với chính nó"
--   từ tài liệu công cụ ads ngoài, sách không nói.
--   • CTR dùng luot_bam_link (KHÔNG luot_bam tổng — vết 6,32% vs 2,93%).
--   • Chưa đủ 7 ngày số (tuổi < 7) hoặc CTR tuần đầu = 0 → ctr_lech_pct = NULL (UI hiện "chưa đủ 7 ngày").
--     CẤM lấy 0 làm nền, cấm dự phòng im lặng (luật 00).
--   • KHÔNG đèn, KHÔNG ngưỡng (ngưỡng để WP-105 đo từ chính mình sau 8 tuần).
--   Idempotent (drop+create function). HOÀN TÁC: chạy lại ads_mau_ds() bản db/237.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists kho.ads_mau_ds();
create function kho.ads_mau_ds()
returns table(
  creative_id text, ten text, tieu_de text, body text, nut text, dinh_dang text,
  page_id text, link_fb text, ig_link text, anh_url text, thumbnail_url text, video_id text,
  so_ad int, chi numeric, hien_thi bigint, bam bigint, keo_luc timestamptz,
  chi_7ngay numeric, hien_thi_7ngay bigint, bam_7ngay bigint, dang_chay boolean,
  ngay_dau date, ngay_cuoi date, tuoi_ngay int,
  ctr_tuan_dau numeric, ctr_7ngay numeric, ctr_lech_pct numeric
) language plpgsql security definer set search_path to 'kho' as $fn$
#variable_conflict use_column
declare v_hom date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;   -- hôm nay giờ VN (QD-99)
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_mau_ds: chỉ ceo/ke_toan/ads_user';
  end if;
  return query
  with lk as (   -- mỗi (creative, ngày) một dòng chi phí, nối creative ⇄ ad ⇄ chi_ads_ngay
    select ma.creative_id, ca.ngay, ca.chi_tieu, ca.hien_thi, coalesce(ca.luot_bam_link,0) bam_link
    from kho.ads_mau_ad ma join kho.chi_ads_ngay ca on ca.ad_id = ma.ad_id
  ),
  agg as (   -- toàn thời gian + mốc ngày
    select creative_id,
      min(ngay) ngay_dau, max(ngay) ngay_cuoi,
      sum(chi_tieu) chi, sum(hien_thi) hien_thi, sum(bam_link) bam
    from lk group by creative_id
  ),
  soad as (select creative_id, count(distinct ad_id)::int so_ad from kho.ads_mau_ad group by creative_id),
  w7 as (   -- 7 NGÀY LỊCH gần nhất
    select creative_id, sum(chi_tieu) chi7, sum(hien_thi) ht7, sum(bam_link) bam7
    from lk where ngay >= (v_hom - 6) group by creative_id
  ),
  td as (   -- 7 ngày ĐẦU của chính mẫu (từ ngày có số đầu tiên)
    select l.creative_id, sum(l.hien_thi) ht0, sum(l.bam_link) bam0
    from lk l join agg a on a.creative_id = l.creative_id
    where l.ngay <= a.ngay_dau + 6 group by l.creative_id
  ),
  m as (
    select mm.*,
      a.ngay_dau, a.ngay_cuoi,
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
    m.ig_link, m.anh_url, m.thumbnail_url, m.video_id,
    m.so_ad, m.chi_tong, m.ht_tong::bigint, m.bam_tong::bigint, m.keo_luc,
    m.chi7, m.ht7::bigint, m.bam7::bigint, (m.chi7 > 0),
    m.ngay_dau, m.ngay_cuoi, m.tuoi,
    round(m.ctr_td, 6), round(m.ctr_7, 6),
    case when coalesce(m.tuoi,0) >= 7 and m.ctr_td is not null and m.ctr_td > 0 and m.ctr_7 is not null
         then round((m.ctr_7 - m.ctr_td) / m.ctr_td, 4) end   -- SO VỚI CHÍNH NÓ; chưa đủ 7 ngày → NULL
  from m
  order by m.chi7 desc, m.keo_luc desc;   -- sắp theo CHI 7 NGÀY giảm dần (mẫu CEO duyệt)
end $fn$;
revoke execute on function kho.ads_mau_ds() from public, anon;
grant  execute on function kho.ads_mau_ds() to authenticated;

commit;
