-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 250 — WP-108 L-14 (3): ads_tong_so_sanh PHÂN BIỆT "0đ chi" vs "CHƯA CÓ DỮ LIỆU".
--   Kỳ trước tháng 6 = tháng 5 → hệ KHÔNG có dữ liệu tháng 5 (chi từ 01/06) nhưng trả chi=0 → màn hiện "0đ" (SAI:
--   không phải tháng 5 chi 0đ, mà là chưa kéo tháng 5). Thêm cờ khong_co_du_lieu = (số dòng trong khoảng = 0).
--   Client: khong_co_du_lieu → hiện "chưa có dữ liệu", cột lệch gạch ngang. Idempotent. HOÀN TÁC: bản db/248.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.ads_tong_so_sanh(p_tu_ngay date, p_den_ngay date, p_brand text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off' as $function$
declare v_len int; v_ptu date; v_pden date; v_a record; v_b record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_tong_so_sanh: chỉ ceo/ke_toan/ads_user'; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl, count(*) nd
    into v_a from kho.chi_chien_dich_ngay cd where cd.ngay >= p_tu_ngay and cd.ngay <= p_den_ngay
      and (p_brand is null or exists (select 1 from kho.ads_ad_campaign ac where ac.campaign_id=cd.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)=p_brand));
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl, count(*) nd
    into v_b from kho.chi_chien_dich_ngay cd where cd.ngay >= v_ptu and cd.ngay <= v_pden
      and (p_brand is null or exists (select 1 from kho.ads_ad_campaign ac where ac.campaign_id=cd.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)=p_brand));
  return jsonb_build_object('do_dai_ngay', v_len,
    'ky_nay', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'chi',v_a.chi,'hien_thi',v_a.ht,'luot_bam',v_a.lb,'luot_bam_link',v_a.lbl,
       'khong_co_du_lieu', (v_a.nd = 0),
       'ctr', case when v_a.ht>0 and v_a.lbl is not null then round(v_a.lbl::numeric*100/v_a.ht,2) else null end,
       'cpm', case when v_a.ht>0 then round(v_a.chi*1000/v_a.ht) else null end,
       'cpc', case when v_a.lbl>0 then round(v_a.chi/v_a.lbl) else null end, 'ctr_cpc_thieu_link', (v_a.lbl is null)),
    'ky_truoc', jsonb_build_object('tu',v_ptu,'den',v_pden,'chi',v_b.chi,'hien_thi',v_b.ht,'luot_bam',v_b.lb,'luot_bam_link',v_b.lbl,
       'khong_co_du_lieu', (v_b.nd = 0),
       'ctr', case when v_b.ht>0 and v_b.lbl is not null then round(v_b.lbl::numeric*100/v_b.ht,2) else null end,
       'cpm', case when v_b.ht>0 then round(v_b.chi*1000/v_b.ht) else null end,
       'cpc', case when v_b.lbl>0 then round(v_b.chi/v_b.lbl) else null end, 'ctr_cpc_thieu_link', (v_b.lbl is null)),
    'lech_pct', jsonb_build_object(
       'chi', case when v_b.nd>0 and v_b.chi>0 then round((v_a.chi-v_b.chi)*100.0/v_b.chi,1) else null end,
       'hien_thi', case when v_b.nd>0 and v_b.ht>0 then round((v_a.ht-v_b.ht)*100.0/v_b.ht,1) else null end,
       'luot_bam', case when v_b.nd>0 and v_b.lb>0 then round((v_a.lb-v_b.lb)*100.0/v_b.lb,1) else null end,
       'ctr', case when v_b.nd>0 and v_b.ht>0 and v_a.ht>0 and v_a.lbl is not null and v_b.lbl is not null then round((v_a.lbl::numeric*100/v_a.ht - v_b.lbl::numeric*100/v_b.ht),2) else null end,
       'cpm', case when v_b.nd>0 and v_b.ht>0 and v_a.ht>0 and v_b.chi>0 then round(((v_a.chi*1000/v_a.ht)-(v_b.chi*1000/v_b.ht))*100.0/(v_b.chi*1000/v_b.ht),1) else null end,
       'cpc', case when v_b.nd>0 and v_b.lbl>0 and v_a.lbl>0 and v_b.chi>0 then round(((v_a.chi/v_a.lbl)-(v_b.chi/v_b.lbl))*100.0/(v_b.chi/v_b.lbl),1) else null end));
end $function$;
revoke execute on function kho.ads_tong_so_sanh(date,date,text) from public, anon;
grant  execute on function kho.ads_tong_so_sanh(date,date,text) to authenticated;

commit;
