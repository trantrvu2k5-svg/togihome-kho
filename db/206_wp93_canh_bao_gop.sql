-- db/206 · WP-93 L-02 · Sửa luật cảnh báo ads (QD-92/93). KHÔNG đụng UI.
--   A1: luật "chi cao mà 0 hội thoại" BỎ QUA chiến dịch den='khong_do_duoc' (dẫn web) — nổ hàng loạt cho cả 6 web campaign
--       = báo động giả giết mọi cảnh báo khác (Garrison ch.10, quản trị theo NGOẠI LỆ). Hai luật kia (tăng đột biến · ad mới)
--       VẪN áp cho web — chi gấp đôi vẫn phải biết dù không đo được hội thoại.
--   A2: thêm khối canh_bao_gop (MỘT dòng SỐ, không phải danh sách việc): so_chien_dich · tong_chi · loai='khong_do_duoc'.
--       RPC chỉ trả SỐ; câu lời-thường do UI ghép (đổi chữ sau không phải migrate). 0 web campaign → NULL (UI ẩn dòng).
--   ⚠ Cổng backup QD-61. IDEMPOTENT (create or replace). HOÀN TÁC: chạy lại db/205 (bản ads_viec_phai_lam cũ).
begin;

create or replace function kho.ads_viec_phai_lam(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_chicao numeric; v_tpct numeric; v_ttd numeric; v_moingay numeric; v_len int; v_ptu date; v_pden date; v_res jsonb; v_gop jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_viec_phai_lam: chỉ ceo/ke_toan/ads_user'; end if;
  v_chicao := kho.ads_nguong_lay('chi_cao_khong_hoi_thoai', p_den_ngay);
  v_tpct   := kho.ads_nguong_lay('tang_dot_bien_pct', p_den_ngay);
  v_ttd    := kho.ads_nguong_lay('tang_dot_bien_tuyet_doi', p_den_ngay);
  v_moingay:= kho.ads_nguong_lay('ad_moi_du_ngay', p_den_ngay);
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  with cur as (
    select campaign_id, max(campaign_name) ten, max(objective) obj, sum(chi_tieu) chi, min(ngay) tu
    from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id
  ),
  prev as ( select campaign_id, sum(chi_tieu) chi from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden group by campaign_id ),
  v1 as (  -- chi cao mà chưa thấy hội thoại quy về — A1: CHỈ chiến dịch KHÔNG dẫn web (den≠khong_do_duoc). Web bỏ qua (gộp ở canh_bao_gop).
    select 'chi_cao_khong_hoi_thoai' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" chi '||to_char(c.chi,'FM999,999,999')||'đ mà chưa thấy hội thoại nào quy về — kiểm quảng cáo có chạy đúng không.' cau
    from cur c where not kho.ads_obj_web(c.obj) and c.chi > v_chicao
  ),
  v2 as (  -- chi tăng đột biến so kỳ trước — ÁP CHO CẢ web (chi gấp đôi vẫn phải biết)
    select 'chi_tang_dot_bien' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" chi tăng '||round((c.chi-p.chi)*100.0/p.chi)||'% (+'||to_char(c.chi-p.chi,'FM999,999,999')||'đ) so kỳ trước — xem có chủ đích không.' cau
    from cur c join prev p on p.campaign_id=c.campaign_id
    where p.chi > 0 and (c.chi-p.chi)*100.0/p.chi > v_tpct and (c.chi-p.chi) > v_ttd
  ),
  v3 as (  -- ad/chiến dịch mới chưa đủ ngày — ÁP CHO CẢ web
    select 'ad_moi_chua_du_ngay' loai, c.campaign_id, c.ten, c.chi,
      'Chiến dịch "'||coalesce(c.ten,c.campaign_id)||'" mới xuất hiện '||(p_den_ngay - c.tu + 1)||' ngày — chưa đủ '||v_moingay::int||' ngày để đánh giá, theo dõi thêm.' cau
    from cur c where (p_den_ngay - c.tu + 1) < v_moingay
  )
  select coalesce(jsonb_agg(jsonb_build_object('loai',loai,'campaign_id',campaign_id,'ten',ten,'chi',chi,'cau',cau)),'[]'::jsonb)
    into v_res from (select * from v1 union all select * from v2 union all select * from v3) x;

  -- A2: canh_bao_gop — gộp CÁC chiến dịch dẫn web (khong_do_duoc) đang tiêu. Chỉ SỐ, câu do UI ghép. 0 → NULL.
  select case when count(*) > 0 then jsonb_build_object('loai','khong_do_duoc','so_chien_dich',count(*),'tong_chi',coalesce(sum(chi),0)) else null end
    into v_gop
  from (select campaign_id, max(objective) obj, sum(chi_tieu) chi from kho.chi_chien_dich_ngay
        where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id) z
  where kho.ads_obj_web(z.obj) and z.chi > 0;

  return jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,
    'nguong', jsonb_build_object('chi_cao_khong_hoi_thoai',v_chicao,'tang_dot_bien_pct',v_tpct,'tang_dot_bien_tuyet_doi',v_ttd,'ad_moi_du_ngay',v_moingay),
    'viec', v_res, 'canh_bao_gop', v_gop);
end $$;
revoke execute on function kho.ads_viec_phai_lam(date,date) from public, anon;
grant  execute on function kho.ads_viec_phai_lam(date,date) to authenticated;
comment on function kho.ads_viec_phai_lam(date,date) is
  'WP-93/QD-92: việc-phải-làm ads. A1 (L-02): luật "chi cao 0 hội thoại" BỎ QUA den=khong_do_duoc (dẫn web) — nổ hàng loạt = báo động giả giết cảnh báo khác (Garrison ch.10). Web gộp một dòng canh_bao_gop (chỉ SỐ). Ngưỡng đọc từ ads_nguong.';

do $$ begin
  if to_regprocedure('kho.ads_viec_phai_lam(date,date)') is null then raise exception 'THIẾU ads_viec_phai_lam'; end if;
  raise notice 'db/206 OK: ads_viec_phai_lam A1 (bỏ qua web) + A2 canh_bao_gop.';
end $$;
commit;
