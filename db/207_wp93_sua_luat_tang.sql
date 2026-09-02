-- db/207 · WP-93 L-04 · Kiểm nguồn Meta + sửa báo động giả "chi tăng đột biến" + 3 tỷ lệ so tuần + 2 số độ phủ. KHÔNG UI.
--   A4: luot_bam đang lấy Meta 'clicks' (tổng) chứ KHÔNG phải 'inline_link_clicks' (đo GIUONG 27/08–02/09: DB 1.078 = clicks 1.081,
--       KHÁC inline_link_clicks 488) → CTR/CPC tính từ số sai. hien_thi=impressions ĐÚNG (17.301≈17.305, không phải reach 10.799).
--       → cờ chi_so_ty_le_dang_ngo=1 để L-05 ẩn CTR/CPM/CPC (thà thiếu còn hơn số sai). Sửa nguồn là lệnh riêng.
--   B: "chi tăng đột biến" so với NHỊP CHUNG (Garrison ch.10), không so với 0. Kỳ trước=0 → 'moi_bat'. ≥3 cùng nổ → gộp một dòng.
--   ⚠ Cổng backup QD-61. IDEMPOTENT. HOÀN TÁC: chạy lại db/206 (ads_viec_phai_lam) + db/205 (ads_tong_so_sanh); drop ads_do_phu; xoá 3 ngưỡng.
begin;

-- ══════════ A4 + B1 · thêm ngưỡng/cờ (hieu_luc_tu 2026-01-01 [GĐ] để bao data) ══════════
insert into kho.ads_nguong(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select v.ma, v.gt, date '2026-01-01', v.ld, 'he_thong'
from (values
  ('chi_so_ty_le_dang_ngo',  1, 'SAI NGUỒN L-04: luot_bam=clicks(tổng) không phải inline_link_clicks → CTR/CPC sai, ẩn [TẠM]'),
  ('vuot_muc_tang_chung_pct',50, 'sửa báo động giả L-04 [TẠM]'),
  ('gop_canh_bao_khi_tu',     3, 'sửa báo động giả L-04 [TẠM]')
) as v(ma, gt, ld)
where not exists (select 1 from kho.ads_nguong n where n.ma = v.ma and n.hieu_luc_den is null);

-- ══════════ B2/B3/B4 · ads_viec_phai_lam — tăng so NHỊP CHUNG · moi_bat · gộp ≥3 ══════════
create or replace function kho.ads_viec_phai_lam(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  v_chicao numeric; v_ttd numeric; v_moingay numeric; v_vuotchung numeric; v_gop int;
  v_len int; v_ptu date; v_pden date; v_tc numeric; v_tp numeric; v_muc numeric;
  n_tang int; n_moi int; v_tang jsonb; v_moi jsonb; v_chi jsonb; v_am jsonb; v_gopblk jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_viec_phai_lam: chỉ ceo/ke_toan/ads_user'; end if;
  v_chicao := kho.ads_nguong_lay('chi_cao_khong_hoi_thoai', p_den_ngay);
  v_ttd    := kho.ads_nguong_lay('tang_dot_bien_tuyet_doi', p_den_ngay);
  v_moingay:= kho.ads_nguong_lay('ad_moi_du_ngay', p_den_ngay);
  v_vuotchung := kho.ads_nguong_lay('vuot_muc_tang_chung_pct', p_den_ngay);
  v_gop    := kho.ads_nguong_lay('gop_canh_bao_khi_tu', p_den_ngay)::int;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) into v_tc from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay;
  select coalesce(sum(chi_tieu),0) into v_tp from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden;
  v_muc := case when v_tp > 0 then round((v_tc - v_tp) * 100.0 / v_tp) else null end;   -- nhịp chung (% tăng tổng chi)

  -- Một câu SQL (KHÔNG temp table — STABLE + gọi nhiều lần/tx an toàn). Gộp ≥ v_gop bằng CASE trên đếm.
  with cur as (select campaign_id, max(campaign_name) ten, max(objective) obj, sum(chi_tieu) chi, min(ngay) tu
               from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id),
       prev as (select campaign_id, sum(chi_tieu) chi from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden group by campaign_id),
       cls as (
         select c.campaign_id, c.ten, c.obj, c.chi, c.tu, coalesce(p.chi,0) pchi,
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
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" chi '||to_char(chi,'FM999,999,999')||'đ mà chưa thấy hội thoại nào quy về — kiểm quảng cáo có chạy đúng không.')),'[]'::jsonb) j from cls where not kho.ads_obj_web(obj) and chi > v_chicao),
       am_j as (select coalesce(jsonb_agg(jsonb_build_object('loai','ad_moi_chua_du_ngay','campaign_id',campaign_id,'ten',ten,'chi',chi,
                'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" mới xuất hiện '||(p_den_ngay - tu + 1)||' ngày — chưa đủ '||v_moingay::int||' ngày để đánh giá, theo dõi thêm.')),'[]'::jsonb) j from cls where (p_den_ngay - tu + 1) < v_moingay),
       gop_j as (select case when count(*) > 0 then jsonb_build_object('loai','khong_do_duoc','so_chien_dich',count(*),'tong_chi',coalesce(sum(chi),0)) else null end j from cls where kho.ads_obj_web(obj) and chi > 0)
  select (select j from tang) || (select j from moi) || (select j from chi_j) || (select j from am_j), (select j from gop_j)
    into v_tang, v_gopblk;

  return jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,
    'nhip_chung_pct', v_muc,
    'nguong', jsonb_build_object('chi_cao_khong_hoi_thoai',v_chicao,'tang_dot_bien_tuyet_doi',v_ttd,'ad_moi_du_ngay',v_moingay,'vuot_muc_tang_chung_pct',v_vuotchung,'gop_canh_bao_khi_tu',v_gop),
    'viec', v_tang,
    'canh_bao_gop', v_gopblk);
end $$;
revoke execute on function kho.ads_viec_phai_lam(date,date) from public, anon;
grant  execute on function kho.ads_viec_phai_lam(date,date) to authenticated;

-- ══════════ C · ads_tong_so_sanh + ctr/cpm/cpc ══════════
create or replace function kho.ads_tong_so_sanh(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_len int; v_ptu date; v_pden date; v_a record; v_b record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_tong_so_sanh: chỉ ceo/ke_toan/ads_user'; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb
    into v_a from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb
    into v_b from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden;
  return jsonb_build_object(
    'do_dai_ngay', v_len,
    'ky_nay', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'chi',v_a.chi,'hien_thi',v_a.ht,'luot_bam',v_a.lb,
       'ctr', case when v_a.ht>0 then round(v_a.lb::numeric*100/v_a.ht,2) else null end,
       'cpm', case when v_a.ht>0 then round(v_a.chi*1000/v_a.ht) else null end,
       'cpc', case when v_a.lb>0 then round(v_a.chi/v_a.lb) else null end),
    'ky_truoc', jsonb_build_object('tu',v_ptu,'den',v_pden,'chi',v_b.chi,'hien_thi',v_b.ht,'luot_bam',v_b.lb,
       'ctr', case when v_b.ht>0 then round(v_b.lb::numeric*100/v_b.ht,2) else null end,
       'cpm', case when v_b.ht>0 then round(v_b.chi*1000/v_b.ht) else null end,
       'cpc', case when v_b.lb>0 then round(v_b.chi/v_b.lb) else null end),
    'lech_pct', jsonb_build_object(
       'chi', case when v_b.chi>0 then round((v_a.chi-v_b.chi)*100.0/v_b.chi,1) else null end,
       'hien_thi', case when v_b.ht>0 then round((v_a.ht-v_b.ht)*100.0/v_b.ht,1) else null end,
       'luot_bam', case when v_b.lb>0 then round((v_a.lb-v_b.lb)*100.0/v_b.lb,1) else null end,
       'ctr', case when v_b.ht>0 and v_b.lb>0 and v_a.ht>0 then round((v_a.lb::numeric*100/v_a.ht - v_b.lb::numeric*100/v_b.ht),2) else null end,
       'cpm', case when v_b.ht>0 and v_a.ht>0 and v_b.chi>0 then round(((v_a.chi*1000/v_a.ht)-(v_b.chi*1000/v_b.ht))*100.0/(v_b.chi*1000/v_b.ht),1) else null end,
       'cpc', case when v_b.lb>0 and v_a.lb>0 and v_b.chi>0 then round(((v_a.chi/v_a.lb)-(v_b.chi/v_b.lb))*100.0/(v_b.chi/v_b.lb),1) else null end));
end $$;
revoke execute on function kho.ads_tong_so_sanh(date,date) from public, anon;
grant  execute on function kho.ads_tong_so_sanh(date,date) to authenticated;

-- ══════════ D · ads_do_phu — % hội thoại có mã quảng cáo: khoảng đang xem + toàn bộ lịch sử (kèm nhãn) ══════════
create or replace function kho.ads_do_phu(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_k record; v_l record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_do_phu: chỉ ceo/ke_toan/ads_user'; end if;
  select count(*) filter (where nullif(btrim(ad_id),'') is not null) co_ma, count(*) tong
    into v_k from kho.v_lead_hien_hanh
    where thoi_diem_hoi_thoai >= p_tu_ngay::timestamptz and thoi_diem_hoi_thoai < (p_den_ngay + 1)::timestamptz;
  select count(*) filter (where nullif(btrim(ad_id),'') is not null) co_ma, count(*) tong,
         min(thoi_diem_hoi_thoai)::date tu, max(thoi_diem_hoi_thoai)::date den
    into v_l from kho.v_lead_hien_hanh;
  return jsonb_build_object(
    'khoang', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'co_ma',v_k.co_ma,'tong',v_k.tong,
       'pct', case when v_k.tong>0 then round(v_k.co_ma*100.0/v_k.tong,1) else null end),
    'lich_su', jsonb_build_object('tu',v_l.tu,'den',v_l.den,'co_ma',v_l.co_ma,'tong',v_l.tong,
       'pct', case when v_l.tong>0 then round(v_l.co_ma*100.0/v_l.tong,1) else null end));
end $$;
revoke execute on function kho.ads_do_phu(date,date) from public, anon;
grant  execute on function kho.ads_do_phu(date,date) to authenticated;

do $$ begin
  if to_regprocedure('kho.ads_do_phu(date,date)') is null then raise exception 'THIẾU ads_do_phu'; end if;
  raise notice 'db/207 OK: cờ chi_so_ty_le_dang_ngo + luật tăng so nhịp chung + so_sanh(ctr/cpm/cpc) + ads_do_phu.';
end $$;
commit;
