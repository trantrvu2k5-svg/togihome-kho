-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 260 — WP-113 L-113-3: PHẦN TÍNH. ads_bang_ky (tách loại + số web/nhắn-tin), ads_suc_khoe_mau
--   (+ket_luan_ma), ads_viec_phai_lam (+dòng keo_do/gia_cuoc_cao/loi_web/mau_can_doi + đọc cuoc thật).
--   CHỈ THÊM trường trả về — trường cũ giữ nguyên tên/kiểu/ý nghĩa (màn cũ chạy y như trước).
--   Cột NULL (chưa kéo) → NULL, CẤM coalesce 0. mua_pixel KHÔNG trả ra. Ngưỡng qua ads_nguong_lay; vắng → RAISE.
--   HOÀN TÁC: chạy lại 3 bản hàm cũ (git trước 260).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ══════════════════ [1] ads_bang_ky — THÊM tách loại + số web/nhắn-tin ══════════════════
create or replace function kho.ads_bang_ky(p_tu_ngay date, p_den_ngay date)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off'
as $function$
declare v_sat numeric; v_dong jsonb; v_tong jsonb; v_lien_brand jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_bang_ky: chỉ ceo/ke_toan/ads_user'; end if;
  v_sat := kho.ads_nguong_lay('den_sat_tran_pct', p_den_ngay);
  -- [WP-113] cờ web_chua_co_su_kien_lien_he theo THƯƠNG HIỆU: 30 ngày kết ở p_den_ngay, Σlien_he_pixel = 0.
  with cd30 as (
    select campaign_id, sum(lien_he_pixel) lh from kho.chi_chien_dich_ngay
    where ngay between (p_den_ngay - 29) and p_den_ngay group by campaign_id)
  select coalesce(jsonb_object_agg(brand, (s = 0)), '{}'::jsonb) into v_lien_brand
  from (select brand, coalesce(sum(lh),0) s from
         (select coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
                   where ac.campaign_id=cd30.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand, lh
          from cd30) z group by brand) q;

  with cds as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) objective, max(c.act_id) act_id,
           sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.luot_bam) lb, sum(c.luot_bam_link) lbl,
           sum(c.luot_vao_trang) vt, sum(c.bam_ra_web) rw, sum(c.cuoc_tro_chuyen) cuoc, sum(c.lien_he_pixel) lh
    from kho.chi_chien_dich_ngay c where c.ngay >= p_tu_ngay and c.ngay <= p_den_ngay group by c.campaign_id
  ),
  og as (   -- adset optimization_goal → có mục tiêu nhắn-tin / web
    select campaign_id,
      bool_or(optimization_goal = 'CONVERSATIONS') co_msg,
      bool_or(optimization_goal is not null and optimization_goal <> 'CONVERSATIONS') co_web
    from kho.ads_nhom_quang_cao group by campaign_id
  ),
  j as (
    select cds.*, kho.ads_obj_web(cds.objective) web, m.ten_hien_thi, m.ten_tai_khoan,
      case when kho.ads_obj_web(cds.objective) then 0 else null end so_hoi_thoai,
      coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
                where ac.campaign_id=cds.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1), 'chưa rõ') brand,
      case
        when (kho.ads_obj_web(cds.objective) and coalesce(og.co_msg,false))
          or ((not kho.ads_obj_web(cds.objective)) and coalesce(og.co_web,false)) then 'chua_xep'
        when kho.ads_obj_web(cds.objective) then 'dan_vao_web' else 'nhan_tin'
      end loai_cd
    from cds left join kho.ads_tai_khoan_brand m on m.act_id = cds.act_id and m.hieu_luc_den is null
             left join og on og.campaign_id = cds.campaign_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', campaign_id, 'campaign_name', ten, 'objective', objective, 'nhom_gop', objective, 'brand', brand,
      'act_id', act_id, 'ten_tai_khoan', coalesce(ten_hien_thi, ten_tai_khoan),
      'chi', chi, 'luot_hien_thi', ht, 'luot_bam', lbl, 'luot_bam_tong', lb,
      'ctr', case when ht > 0 and lbl is not null then round(lbl::numeric * 100 / ht, 2) else null end,
      'cpm', case when ht > 0 then round(chi * 1000 / ht) else null end,
      'cpc', case when lbl > 0 then round(chi / lbl) else null end,
      'ctr_cpc_thieu_link', (lbl is null), 'so_hoi_thoai', so_hoi_thoai,
      'chi_moi_hoi_thoai', case when coalesce(so_hoi_thoai,0) > 0 then round(chi / so_hoi_thoai) else null end,
      'den', case when web then 'khong_do_duoc' else 'chua_du_so' end,
      'co_an', (coalesce(chi,0) = 0),
      'hoi_thoai_theo_chien_dich', case when web then 'nen_khong_dong' else 'chua_co_map' end,
      -- [WP-113] tách loại + số hành động
      'loai_chien_dich', loai_cd,
      'toi_trang_100_bam', case when rw > 0 then round(vt::numeric * 100 / rw, 2) else null end,
      'gia_1_luot_vao',    case when vt > 0 then round(chi / vt) else null end,
      'luot_lien_he',      (lh + cuoc),
      'gia_1_lien_he',     case when (lh + cuoc) > 0 then round(chi / (lh + cuoc)) else null end,
      'cuoc_tro_chuyen',   cuoc,
      'gia_1_cuoc',        case when cuoc > 0 then round(chi / cuoc) else null end,
      'web_chua_co_su_kien_lien_he', coalesce((v_lien_brand ->> brand)::boolean, null)
    ) order by chi desc nulls last), '[]'::jsonb),
    jsonb_build_object('chi', coalesce(sum(chi),0), 'luot_hien_thi', coalesce(sum(ht),0),
      'luot_bam', sum(lbl), 'luot_bam_tong', coalesce(sum(lb),0),
      'ctr', case when sum(ht) > 0 and sum(lbl) is not null then round(sum(lbl)::numeric * 100 / sum(ht), 2) else null end,
      'cpm', case when sum(ht) > 0 then round(sum(chi) * 1000 / sum(ht)) else null end,
      'cpc', case when sum(lbl) > 0 then round(sum(chi) / sum(lbl)) else null end,
      'ctr_cpc_thieu_link', (sum(lbl) is null), 'so_chien_dich', count(*),
      -- [WP-113] Σchi theo loại (đối soát: 3 loại = Σchi kỳ)
      'chi_theo_loai', jsonb_build_object(
        'dan_vao_web', coalesce(sum(chi) filter (where loai_cd='dan_vao_web'),0),
        'nhan_tin',    coalesce(sum(chi) filter (where loai_cd='nhan_tin'),0),
        'chua_xep',    coalesce(sum(chi) filter (where loai_cd='chua_xep'),0)))
  into v_dong, v_tong from j;
  return jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay, 'nhom', 'objective', 'dong', v_dong, 'tong', v_tong);
end $function$;

-- ══════════════════ [2] ads_suc_khoe_mau — THÊM ket_luan_ma (mã cố định, suy từ ĐIỀU KIỆN) ══════════════════
create or replace function kho.ads_suc_khoe_mau(p_tu_ngay date, p_den_ngay date)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off'
as $function$
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
  v_cut := v_duoi_nen / 100.0; v_cut_bat_dau := v_bat_dau_nen / 100.0; v_cut_cpm := v_cpm_tren / 100.0;

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
      round(sum(chi) filter (where ht > 0) * 1000 / nullif(sum(ht) filter (where ht > 0), 0)) nen_cpm,
      avg(lp::numeric / nullif(ht,0)) filter (where co_video and ht > 0) nen_bat_dau,
      avg(tp::numeric / nullif(lp,0)) filter (where co_video and lp > 0) nen_giu,
      count(*) filter (where ht > 0) so_nen,
      count(*) filter (where co_video and ht > 0) so_nen_video
    from per where brand <> 'chưa rõ' group by brand) z;

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
    from kho.chi_ads_ngay where ngay between p_tu_ngay and p_den_ngay group by ad_id),
  t as (
    select g.*,
      case when ht > 0 then link::numeric / ht end ctr,
      case when ht > 0 then round(chi / ht * 1000) end cpm,
      case when co_video and ht > 0 then lp::numeric / ht end r_bat_dau,
      case when co_video and lp > 0 then tp::numeric / lp end r_giu,
      (v_nen_brand -> g.brand ->> 'ctr_link')::numeric   nb_ctr,
      (v_nen_brand -> g.brand ->> 'cpm')::numeric        nb_cpm,
      (v_nen_brand -> g.brand ->> 'bat_dau_xem')::numeric nb_bat_dau
    from g),
  k as (
    select t.*,
      case
        when t.brand = 'chưa rõ' then 'chưa rõ thương hiệu'
        when ht is null or ht < v_hien_min then 'chưa đủ số để đọc'
        when co_video and nb_bat_dau is not null and r_bat_dau is not null
             and r_bat_dau < nb_bat_dau * v_cut_bat_dau then 'bắt đầu xem tụt so nền'
        when nb_ctr is not null and ctr is not null and ctr < nb_ctr * v_cut then 'CTR dưới nền 7 ngày'
        when xh_cl like 'BELOW_AVERAGE%' or xh_tt like 'BELOW_AVERAGE%' or xh_cd like 'BELOW_AVERAGE%'
             then 'xếp hạng dưới trung bình'
        when tan_suat is not null and tan_suat > v_tan_suat_do
             then 'tệp đã mỏi (tần suất ' || to_char(tan_suat, 'FM990.0') || ')'
        else 'đang tốt'
      end ket_luan,
      -- [WP-113] MÃ cố định suy từ ĐÚNG điều kiện trên (KHÔNG đọc chuỗi). 5 mã: dang_tot/ctr_duoi_nen/
      --   tan_suat_cao/luot_phat_giam/chua_du_so. ('chưa rõ'→chua_du_so; xếp-hạng-dưới→ctr_duoi_nen.)
      case
        when t.brand = 'chưa rõ' then 'chua_du_so'
        when ht is null or ht < v_hien_min then 'chua_du_so'
        when co_video and nb_bat_dau is not null and r_bat_dau is not null
             and r_bat_dau < nb_bat_dau * v_cut_bat_dau then 'luot_phat_giam'
        when nb_ctr is not null and ctr is not null and ctr < nb_ctr * v_cut then 'ctr_duoi_nen'
        when xh_cl like 'BELOW_AVERAGE%' or xh_tt like 'BELOW_AVERAGE%' or xh_cd like 'BELOW_AVERAGE%'
             then 'ctr_duoi_nen'
        when tan_suat is not null and tan_suat > v_tan_suat_do then 'tan_suat_cao'
        else 'dang_tot'
      end ket_luan_ma,
      case when t.brand <> 'chưa rõ' and nb_cpm is not null and cpm is not null and cpm > nb_cpm * v_cut_cpm
           then 'giá đấu đang đắt hơn nền' end ghi_chu
    from t)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ad_id', ad_id, 'ten', ten, 'brand', brand, 'chi', chi, 'hien_thi', ht,
      'tan_suat', tan_suat,
      'ty_le_bat_dau_xem', case when co_video then to_jsonb(r_bat_dau) else to_jsonb('không đo được'::text) end,
      'ty_le_giu_xem',     case when co_video then to_jsonb(r_giu)     else to_jsonb('không đo được'::text) end,
      'ctr_link', ctr, 'cpm', cpm,
      'xep_hang_chat_luong', xh_cl, 'xep_hang_tuong_tac', xh_tt, 'xep_hang_chuyen_doi', xh_cd,
      'ket_luan', ket_luan, 'ket_luan_ma', ket_luan_ma, 'ghi_chu', ghi_chu,
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
    'nen_7ngay', v_nen_all, 'nen_theo_brand', v_nen_brand, 'mau', v_mau);
end $function$;

-- ══════════════════ [3] ads_viec_phai_lam — THÊM dòng keo_do/gia_cuoc_cao/loi_web/mau_can_doi + đọc cuoc thật ══════════════════
create or replace function kho.ads_viec_phai_lam(p_tu_ngay date, p_den_ngay date)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off'
as $function$
declare
  v_chicao numeric; v_ttd numeric; v_moingay numeric; v_vuotchung numeric; v_gop int;
  v_ty numeric; v_hesocuoc numeric; v_hienmin numeric;
  v_len int; v_ptu date; v_pden date; v_tc numeric; v_tp numeric; v_muc numeric;
  v_tang jsonb; v_gopblk jsonb; v_new jsonb; v_keo_do jsonb; v_suc jsonb; v_maurow jsonb;
  v_kd_tt text; v_kd_loi text; v_ok int; v_tong_tk int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_viec_phai_lam: chỉ ceo/ke_toan/ads_user'; end if;
  v_chicao := kho.ads_nguong_lay('chi_cao_khong_hoi_thoai', p_den_ngay);
  v_ttd    := kho.ads_nguong_lay('tang_dot_bien_tuyet_doi', p_den_ngay);
  v_moingay:= kho.ads_nguong_lay('ad_moi_du_ngay', p_den_ngay);
  v_vuotchung := kho.ads_nguong_lay('vuot_muc_tang_chung_pct', p_den_ngay);
  v_gop    := kho.ads_nguong_lay('gop_canh_bao_khi_tu', p_den_ngay)::int;
  v_ty     := kho.ads_nguong_lay('ty_le_toi_trang_toi_thieu', p_den_ngay);
  v_hesocuoc := kho.ads_nguong_lay('gia_cuoc_tro_chuyen_he_so', p_den_ngay);
  v_hienmin := kho.ads_nguong_lay('hien_thi_toi_thieu_doc', p_den_ngay);
  if v_ty is null or v_hesocuoc is null or v_hienmin is null then
    raise exception 'ads_viec_phai_lam: thiếu ngưỡng (ty_le_toi_trang=% gia_cuoc_he_so=% hien_thi_min=%)', v_ty, v_hesocuoc, v_hienmin; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) into v_tc from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay;
  select coalesce(sum(chi_tieu),0) into v_tp from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden;
  v_muc := case when v_tp > 0 then round((v_tc - v_tp) * 100.0 / v_tp) else null end;

  -- việc CŨ (giữ nguyên) — 3e: 'chi cao chưa hội thoại' nay đọc Σcuoc_tro_chuyen THẬT (=0 mới kêu; NULL→im).
  with cur as (select campaign_id, max(campaign_name) ten, max(objective) obj, sum(chi_tieu) chi, sum(cuoc_tro_chuyen) cuoc, min(ngay) tu
               from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id),
       prev as (select campaign_id, sum(chi_tieu) chi from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden group by campaign_id),
       cls as (
         select c.campaign_id, c.ten, c.obj, c.chi, c.cuoc, c.tu, coalesce(p.chi,0) pchi,
           case when coalesce(p.chi,0) = 0 then 'moi_bat'
                when v_muc is not null and (c.chi - p.chi) * 100.0 / p.chi >= v_muc + v_vuotchung and (c.chi - p.chi) >= v_ttd then 'chi_tang_dot_bien'
                else null end loai,
           case when coalesce(p.chi,0) > 0 then round((c.chi - p.chi) * 100.0 / p.chi) else null end tang_pct
         from cur c left join prev p on p.campaign_id = c.campaign_id),
       ta as (select count(*) n, coalesce(sum(chi-pchi),0) chenh from cls where loai='chi_tang_dot_bien'),
       ti as (select coalesce(jsonb_agg(jsonb_build_object('loai','chi_tang_dot_bien','campaign_id',campaign_id,'ten',ten,'chi',chi,
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" chi tăng '||tang_pct||'% (+'||to_char(chi-pchi,'FM999,999,999')||'đ), trong khi cả tài khoản chỉ tăng '||coalesce(v_muc::text,'—')||'% — vượt hẳn nhịp chung, xem có chủ đích không.')),'[]'::jsonb) j from cls where loai='chi_tang_dot_bien'),
       tang as (select case when (select n from ta) >= v_gop
                  then jsonb_build_array(jsonb_build_object('loai','chi_tang_dot_bien','gop',true,'so_chien_dich',(select n from ta),
                       'cau', (select n from ta)||' chiến dịch tăng vượt nhịp chung (tổng chênh +'||to_char((select chenh from ta),'FM999,999,999')||'đ; cả tài khoản tăng '||coalesce(v_muc::text,'—')||'%) — mở bảng xem từng cái.'))
                  else (select j from ti) end j),
       ma as (select count(*) n from cls where loai='moi_bat'),
       mi as (select coalesce(jsonb_agg(jsonb_build_object('loai','moi_bat','campaign_id',campaign_id,'ten',ten,'chi',chi,
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" mới bật trong kỳ, chưa có kỳ trước để so — theo dõi thêm.')),'[]'::jsonb) j from cls where loai='moi_bat'),
       moi as (select case when (select n from ma) >= v_gop
                  then jsonb_build_array(jsonb_build_object('loai','moi_bat','gop',true,'so_chien_dich',(select n from ma),
                       'cau', (select n from ma)||' chiến dịch mới bật trong kỳ, chưa có kỳ trước để so — theo dõi thêm.'))
                  else (select j from mi) end j),
       chi_j as (select coalesce(jsonb_agg(jsonb_build_object('loai','chi_cao_khong_hoi_thoai','campaign_id',campaign_id,'ten',ten,'chi',chi,
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" chi '||to_char(chi,'FM999,999,999')||'đ mà chưa thấy hội thoại nào quy về — kiểm quảng cáo có chạy đúng không.')),'[]'::jsonb) j from cls where not kho.ads_obj_web(obj) and chi > v_chicao and cuoc = 0),
       am_j as (select coalesce(jsonb_agg(jsonb_build_object('loai','ad_moi_chua_du_ngay','campaign_id',campaign_id,'ten',ten,'chi',chi,
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" mới xuất hiện '||(p_den_ngay - tu + 1)||' ngày — chưa đủ '||v_moingay::int||' ngày để đánh giá, theo dõi thêm.')),'[]'::jsonb) j from cls where (p_den_ngay - tu + 1) < v_moingay),
       gop_j as (select case when count(*) > 0 then jsonb_build_object('loai','khong_do_duoc','so_chien_dich',count(*),'tong_chi',coalesce(sum(chi),0)) else null end j from cls where kho.ads_obj_web(obj) and chi > 0)
  select (select j from tang) || (select j from moi) || (select j from chi_j) || (select j from am_j), (select j from gop_j)
    into v_tang, v_gopblk;

  -- [WP-113 3a] keo_do: mốc kéo chi Meta mới nhất = 'loi' → dòng ĐẦU.
  select trang_thai, loi_van_ban into v_kd_tt, v_kd_loi from kho.ads_moc_keo where nguon='meta_chi_chien_dich' order by bat_dau_luc desc limit 1;
  if v_kd_tt = 'loi' then
    v_ok := nullif((regexp_match(coalesce(v_kd_loi,''),'ok (\d+)/(\d+)'))[1],'')::int;
    v_tong_tk := nullif((regexp_match(coalesce(v_kd_loi,''),'ok (\d+)/(\d+)'))[2],'')::int;
    v_keo_do := jsonb_build_array(jsonb_build_object('loai','keo_do','keu',true,'ten_chien_dich','[]'::jsonb,
      'cau','Số Meta đang thiếu '||coalesce((v_tong_tk - v_ok)::text,'?')||'/'||coalesce(v_tong_tk::text,'?')||' tài khoản — các dòng dưới có thể sai.'));
  else v_keo_do := '[]'::jsonb; end if;

  -- [WP-113 3b/3c] gia_cuoc_cao + loi_web. Chặn chung: tuổi < ad_moi_du_ngay HOẶC hiển thị kỳ < hien_thi_min → không kết luận.
  with camp as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) obj,
      sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.cuoc_tro_chuyen) cuoc, sum(c.luot_vao_trang) vt, sum(c.bam_ra_web) rw
    from kho.chi_chien_dich_ngay c where c.ngay between p_tu_ngay and p_den_ngay group by c.campaign_id),
  seen as (select campaign_id, (p_den_ngay - min(ngay) + 1) tuoi from kho.chi_chien_dich_ngay
           where hien_thi > 0 and ngay <= p_den_ngay group by campaign_id),
  brand_c as (select cp.campaign_id, coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
     where ac.campaign_id=cp.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand from camp cp),
  nen_msg as (select b.brand, sum(c.chi_tieu) chi, sum(c.cuoc_tro_chuyen) cuoc
    from kho.chi_chien_dich_ngay c
    cross join lateral (select coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
        where ac.campaign_id=c.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand) b
    where c.ngay between (p_den_ngay-29) and p_den_ngay and not kho.ads_obj_web(c.objective) group by b.brand),
  enr as (select camp.*, seen.tuoi, bc.brand, (nm.chi / nullif(nm.cuoc,0)) nen_gia_cuoc
    from camp join seen using(campaign_id) join brand_c bc using(campaign_id)
    left join nen_msg nm on nm.brand = bc.brand),
  gcuoc as (select coalesce(jsonb_agg(jsonb_build_object('loai','gia_cuoc_tro_chuyen_cao','campaign_id',campaign_id,'ten',ten,'chi',chi,
      'gia_1_cuoc',round(chi/cuoc),'nen_gia_1_cuoc',round(nen_gia_cuoc),'ten_chien_dich',jsonb_build_array(ten),
      'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" giá 1 cuộc trò chuyện '||round(chi/cuoc)||'đ — cao hơn nền thương hiệu ('||round(nen_gia_cuoc)||'đ × '||v_hesocuoc||') — xem lại nhắm/nội dung.')),'[]'::jsonb) j
    from enr where not kho.ads_obj_web(obj) and tuoi >= v_moingay and ht >= v_hienmin
      and cuoc > 0 and nen_gia_cuoc is not null and (chi/cuoc) > nen_gia_cuoc * v_hesocuoc),
  lweb as (select coalesce(jsonb_agg(jsonb_build_object('loai','loi_web','campaign_id',campaign_id,'ten',ten,'chi',chi,
      'toi_trang_100_bam',round(vt*100.0/rw,2),'nguong',v_ty,'ten_chien_dich',jsonb_build_array(ten),
      'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" chỉ '||round(vt*100.0/rw,2)||' lượt vào trang / 100 bấm ra web (dưới '||v_ty||') — nghi web lỗi hoặc tải chậm.')),'[]'::jsonb) j
    from enr where kho.ads_obj_web(obj) and tuoi >= v_moingay and ht >= v_hienmin and rw > 0 and (vt*100.0/rw) < v_ty)
  select (select j from gcuoc) || (select j from lweb) into v_new;

  -- [WP-113 3d] mau_can_doi: đếm mẫu ket_luan_ma ∈ (ctr_duoi_nen,tan_suat_cao,luot_phat_giam) + số chiến dịch.
  v_suc := kho.ads_suc_khoe_mau(p_tu_ngay, p_den_ngay);
  with m as (select (e->>'ad_id') ad_id, (e->>'ten') ten from jsonb_array_elements(v_suc->'mau') e
             where (e->>'ket_luan_ma') in ('ctr_duoi_nen','tan_suat_cao','luot_phat_giam')),
       mc as (select m.ad_id, (select ac.campaign_id from kho.ads_ad_campaign ac where ac.ad_id=m.ad_id limit 1) cid from m),
       nm as (select mc.cid, (select max(campaign_name) from kho.chi_chien_dich_ngay c where c.campaign_id=mc.cid) ten from mc where cid is not null group by cid)
  select case when (select count(*) from m) > 0 then jsonb_build_array(jsonb_build_object(
      'loai','mau_can_doi','keu',true,'so_mau',(select count(*) from m),'so_chien_dich',(select count(*) from nm),
      'ten_chien_dich', coalesce((select jsonb_agg(ten) from nm),'[]'::jsonb),
      'cau',(select count(*) from m)||' mẫu cần đổi (CTR dưới nền / tần suất cao / lượt phát giảm) ở '||(select count(*) from nm)||' chiến dịch — mở bảng xem từng cái.'))
    else '[]'::jsonb end into v_maurow;

  return jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,
    'nhip_chung_pct', v_muc,
    'nguong', jsonb_build_object('chi_cao_khong_hoi_thoai',v_chicao,'tang_dot_bien_tuyet_doi',v_ttd,'ad_moi_du_ngay',v_moingay,'vuot_muc_tang_chung_pct',v_vuotchung,'gop_canh_bao_khi_tu',v_gop,
      'ty_le_toi_trang_toi_thieu',v_ty,'gia_cuoc_tro_chuyen_he_so',v_hesocuoc,'hien_thi_toi_thieu_doc',v_hienmin),
    'viec', v_keo_do || v_tang || v_new || v_maurow,
    'canh_bao_gop', v_gopblk);
end $function$;

commit;
