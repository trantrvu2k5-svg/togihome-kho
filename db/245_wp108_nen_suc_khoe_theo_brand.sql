-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 245 — WP-108 nhịp 2 (số): SỬA NỀN sức khoẻ mẫu — ba lỗi cùng chỗ, một lượt.
--   (a) round() CPM per-ad VÀ nền — tiền đồng không có phần lẻ (trước để "94.489,738đ").
--   (b) nền CPM đổi avg(cpm từng dòng) → POOLED sum(chi)/sum(hiển thị)*1000.
--       LÝ DO: mẫu ít hiển thị mà đắt kéo nền avg lên ~48k trong khi mặt bằng thật (pooled) ~35k → báo "đắt" oan.
--       (CTR/bắt-đầu-xem/giữ-xem GIỮ avg từng dòng — chỉ CPM đổi cách gộp theo lệnh; nhưng nay tính RIÊNG TỪNG BRAND.)
--   (c) nền tính RIÊNG TỪNG THƯƠNG HIỆU qua kho.ads_brand_cua_ad: Sophia so Sophia, OpenLiving so OpenLiving.
--       brand 'chưa rõ' → KHÔNG có nền → ket_luan 'chưa rõ thương hiệu', ghi_chu để TRỐNG (không so bừa).
--   Trả thêm: mỗi mẫu có 'brand'; 'nen_theo_brand' (mảng nền từng brand); 'nen_7ngay' = nền POOLED cả hệ (cho lọc "Mọi thương hiệu").
--   Idempotent (create or replace). HOÀN TÁC: chạy lại bản db/234.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.ads_suc_khoe_mau(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  v_tan_suat_do numeric; v_duoi_nen numeric; v_hien_min numeric; v_cut numeric;
  v_bat_dau_nen numeric; v_cut_bat_dau numeric; v_cpm_tren numeric; v_cut_cpm numeric;
  v_nen_all jsonb; v_nen_brand jsonb; v_mau jsonb;
begin
  v_tan_suat_do := kho.ads_nguong_lay('tan_suat_do', p_den_ngay);
  v_duoi_nen    := kho.ads_nguong_lay('ctr_duoi_nen_phan_tram', p_den_ngay);
  v_hien_min    := kho.ads_nguong_lay('hien_thi_toi_thieu_doc', p_den_ngay);
  v_bat_dau_nen := kho.ads_nguong_lay('bat_dau_xem_duoi_nen_phan_tram', p_den_ngay);
  v_cpm_tren    := kho.ads_nguong_lay('cpm_tren_nen_phan_tram', p_den_ngay);
  if v_tan_suat_do is null or v_duoi_nen is null or v_hien_min is null or v_bat_dau_nen is null or v_cpm_tren is null then
    raise exception 'ads_suc_khoe_mau: thiếu ngưỡng trong ads_nguong cho ngày % (tan_suat_do=% ctr_duoi_nen=% hien_thi_min=% bat_dau_nen=% cpm_tren=%)',
      p_den_ngay, v_tan_suat_do, v_duoi_nen, v_hien_min, v_bat_dau_nen, v_cpm_tren;
  end if;
  v_cut         := v_duoi_nen / 100.0;
  v_cut_bat_dau := v_bat_dau_nen / 100.0;
  v_cut_cpm     := v_cpm_tren / 100.0;

  -- ── NỀN 7 NGÀY. CPM = POOLED + round; CTR/bắt-đầu/giữ = avg từng dòng. Video-only cho 2 thước video. ──
  -- (per = gộp per-ad 7 ngày + brand; lặp CTE ở 2 select để KHÔNG dùng temp table trong hàm STABLE.)
  -- nền TỪNG BRAND (bỏ 'chưa rõ' — không có nền cho brand chưa rõ)
  with per as (
    select ad_id, kho.ads_brand_cua_ad(ad_id) brand,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp, bool_or(luot_phat is not null) co_video
    from kho.chi_ads_ngay where ngay between (p_den_ngay - 6) and p_den_ngay group by ad_id)
  select coalesce(jsonb_object_agg(brand, jsonb_build_object(
           'ctr_link', nen_ctr, 'cpm', nen_cpm, 'bat_dau_xem', nen_bat_dau, 'giu_xem', nen_giu,
           'so_mau_trong_nen', so_nen, 'so_mau_video_trong_nen', so_nen_video)), '{}'::jsonb)
    into v_nen_brand
  from (
    select brand,
      avg(link::numeric / nullif(ht,0)) filter (where ht > 0) nen_ctr,
      round(sum(chi) filter (where ht > 0) * 1000 / nullif(sum(ht) filter (where ht > 0), 0)) nen_cpm,  -- POOLED+round
      avg(lp::numeric / nullif(ht,0)) filter (where co_video and ht > 0) nen_bat_dau,
      avg(tp::numeric / nullif(lp,0)) filter (where co_video and lp > 0) nen_giu,
      count(*) filter (where ht > 0) so_nen,
      count(*) filter (where co_video and ht > 0) so_nen_video
    from per where brand <> 'chưa rõ' group by brand) z;

  -- nền POOLED cả hệ (cho lọc "Mọi thương hiệu")
  with per as (
    select ad_id,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp, bool_or(luot_phat is not null) co_video
    from kho.chi_ads_ngay where ngay between (p_den_ngay - 6) and p_den_ngay group by ad_id)
  select jsonb_build_object(
      'ctr_link', avg(link::numeric / nullif(ht,0)) filter (where ht > 0),
      'cpm', round(sum(chi) filter (where ht > 0) * 1000 / nullif(sum(ht) filter (where ht > 0), 0)),
      'bat_dau_xem', avg(lp::numeric / nullif(ht,0)) filter (where co_video and ht > 0),
      'giu_xem', avg(tp::numeric / nullif(lp,0)) filter (where co_video and lp > 0),
      'so_mau_trong_nen', count(*) filter (where ht > 0),
      'so_mau_video_trong_nen', count(*) filter (where co_video and ht > 0))
    into v_nen_all from per;

  with g as (
    select ad_id, kho.ads_brand_cua_ad(ad_id) brand,
      (array_agg(ad_name order by ngay desc) filter (where ad_name is not null))[1] ten,
      sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link,
      sum(luot_phat) lp, sum(thruplay) tp,
      avg(tan_suat) filter (where tan_suat is not null) tan_suat,
      bool_or(luot_phat is not null) co_video,
      (array_agg(xep_hang_chat_luong order by ngay desc) filter (where xep_hang_chat_luong is not null))[1] xh_cl,
      (array_agg(xep_hang_tuong_tac  order by ngay desc) filter (where xep_hang_tuong_tac  is not null))[1] xh_tt,
      (array_agg(xep_hang_chuyen_doi order by ngay desc) filter (where xep_hang_chuyen_doi is not null))[1] xh_cd
    from kho.chi_ads_ngay
    where ngay between p_tu_ngay and p_den_ngay
    group by ad_id),
  t as (
    select g.*,
      case when ht > 0 then link::numeric / ht end ctr,
      case when ht > 0 then round(chi / ht * 1000) end cpm,   -- [L-108-4] round per-ad CPM
      case when co_video and ht > 0 then lp::numeric / ht end r_bat_dau,
      case when co_video and lp > 0 then tp::numeric / lp end r_giu,
      -- nền CỦA CHÍNH BRAND này (null nếu brand 'chưa rõ')
      (v_nen_brand -> g.brand ->> 'ctr_link')::numeric   nb_ctr,
      (v_nen_brand -> g.brand ->> 'cpm')::numeric        nb_cpm,
      (v_nen_brand -> g.brand ->> 'bat_dau_xem')::numeric nb_bat_dau
    from g),
  k as (
    select t.*,
      case
        when t.brand = 'chưa rõ' then 'chưa rõ thương hiệu'            -- không có nền → không xếp
        when ht is null or ht < v_hien_min then 'chưa đủ số để đọc'
        when co_video and nb_bat_dau is not null and r_bat_dau is not null
             and r_bat_dau < nb_bat_dau * v_cut_bat_dau then 'bắt đầu xem tụt so nền'
        when nb_ctr is not null and ctr is not null
             and ctr < nb_ctr * v_cut then 'CTR dưới nền 7 ngày'
        when xh_cl like 'BELOW_AVERAGE%' or xh_tt like 'BELOW_AVERAGE%' or xh_cd like 'BELOW_AVERAGE%'
             then 'xếp hạng dưới trung bình'
        when tan_suat is not null and tan_suat > v_tan_suat_do
             then 'tệp đã mỏi (tần suất ' || to_char(tan_suat, 'FM990.0') || ')'
        else 'đang tốt'
      end ket_luan,
      case when t.brand <> 'chưa rõ' and nb_cpm is not null and cpm is not null and cpm > nb_cpm * v_cut_cpm
           then 'giá đấu đang đắt hơn nền' end ghi_chu   -- brand chưa rõ → NULL (ghi chú trống)
    from t)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ad_id', ad_id, 'ten', ten, 'brand', brand, 'chi', chi, 'hien_thi', ht,
      'tan_suat', tan_suat,
      'ty_le_bat_dau_xem', case when co_video then to_jsonb(r_bat_dau) else to_jsonb('không đo được'::text) end,
      'ty_le_giu_xem',     case when co_video then to_jsonb(r_giu)     else to_jsonb('không đo được'::text) end,
      'ctr_link', ctr, 'cpm', cpm,
      'xep_hang_chat_luong', xh_cl, 'xep_hang_tuong_tac', xh_tt, 'xep_hang_chuyen_doi', xh_cd,
      'ket_luan', ket_luan, 'ghi_chu', ghi_chu,
      'tach_nen_tang', (
        select case when count(*) = 0 then null else jsonb_build_object(
          'la_uoc_tinh', true, 'ghi_chu', 'số tách nền tảng là ƯỚC TÍNH; tổng chi lấy từ bảng chính',
          'theo_nen_tang', jsonb_agg(jsonb_build_object('nen_tang', nt, 'chi', c) order by nt))
        end
        from (select nen_tang nt, sum(chi_tieu) c from kho.chi_ads_nen_tang_ngay ntg
              where ntg.ad_id = k.ad_id and ntg.ngay between p_tu_ngay and p_den_ngay
              group by nen_tang) s)
    ) order by chi desc nulls last), '[]'::jsonb) into v_mau from k;

  return jsonb_build_object(
    'khoang', jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay),
    'nguong', jsonb_build_object('tan_suat_do', v_tan_suat_do, 'ctr_duoi_nen_phan_tram', v_duoi_nen,
      'hien_thi_toi_thieu_doc', v_hien_min, 'bat_dau_xem_duoi_nen_phan_tram', v_bat_dau_nen, 'cpm_tren_nen_phan_tram', v_cpm_tren),
    'nen_7ngay', v_nen_all,          -- POOLED cả hệ (khi lọc "Mọi thương hiệu")
    'nen_theo_brand', v_nen_brand,   -- nền riêng từng brand (khi lọc 1 thương hiệu)
    'mau', v_mau);
end $$;

commit;
