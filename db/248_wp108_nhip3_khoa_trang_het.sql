-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 248 — WP-108 nhịp 3: (1) BỎ MỐC CẮT 01/08 ở tầng dữ liệu; (2) lọc BRAND cho 3 RPC còn lại.
--   Garrison: quảng cáo = chi phí THỜI KỲ, ghi vào kỳ phát sinh, không hoãn. Trang vốn luôn là brand đó →
--   chi tháng 6–7 về đúng tháng, không treo. ads_brand_cua_ad vốn KHÔNG gate hieu_luc_tu; đưa hieu_luc_tu về
--   đầu dữ liệu để BẢN GHI khớp hành vi (không còn con số 2026-08-01 nào gợi ý mốc cắt).
--   3 RPC thêm lọc brand qua kho.ads_brand_cua_ad (drop+create vì đổi chữ ký/return):
--   • ads_tong_so_sanh(+p_brand)      — lọc chiến dịch theo brand qua bảng nối ad↔campaign.
--   • chi_ads_nen_tang_tong(+p_brand) — chi_ads_nen_tang_ngay có ad_id → lọc thẳng theo brand.
--   • ads_ad_ngay(+cột brand)         — thêm cột brand để client lọc (mức từng ad, grain ad×ngày).
--   Idempotent. HOÀN TÁC: chạy lại bản db/205/207/208 (so_sanh, nen_tang) + db/199 (ad_ngay); hieu_luc_tu về 2026-08-01.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (1) bỏ mốc cắt ở dữ liệu: brand có hiệu lực TỪ đầu dữ liệu quảng cáo
update kho.ads_trang_brand set hieu_luc_tu = date '2026-06-01' where hieu_luc_den is null and hieu_luc_tu > date '2026-06-01';

-- (2a) ads_tong_so_sanh + p_brand ─────────────────────────────────────────────
drop function if exists kho.ads_tong_so_sanh(date, date);
create function kho.ads_tong_so_sanh(p_tu_ngay date, p_den_ngay date, p_brand text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off' as $function$
declare v_len int; v_ptu date; v_pden date; v_a record; v_b record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_tong_so_sanh: chỉ ceo/ke_toan/ads_user'; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  -- chiến dịch hợp brand? (p_brand null = mọi) — brand của chiến dịch qua bảng nối ad↔campaign → trang
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl
    into v_a from kho.chi_chien_dich_ngay cd where cd.ngay >= p_tu_ngay and cd.ngay <= p_den_ngay
      and (p_brand is null or exists (select 1 from kho.ads_ad_campaign ac where ac.campaign_id=cd.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)=p_brand));
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl
    into v_b from kho.chi_chien_dich_ngay cd where cd.ngay >= v_ptu and cd.ngay <= v_pden
      and (p_brand is null or exists (select 1 from kho.ads_ad_campaign ac where ac.campaign_id=cd.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)=p_brand));
  return jsonb_build_object('do_dai_ngay', v_len,
    'ky_nay', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'chi',v_a.chi,'hien_thi',v_a.ht,'luot_bam',v_a.lb,'luot_bam_link',v_a.lbl,
       'ctr', case when v_a.ht>0 and v_a.lbl is not null then round(v_a.lbl::numeric*100/v_a.ht,2) else null end,
       'cpm', case when v_a.ht>0 then round(v_a.chi*1000/v_a.ht) else null end,
       'cpc', case when v_a.lbl>0 then round(v_a.chi/v_a.lbl) else null end, 'ctr_cpc_thieu_link', (v_a.lbl is null)),
    'ky_truoc', jsonb_build_object('tu',v_ptu,'den',v_pden,'chi',v_b.chi,'hien_thi',v_b.ht,'luot_bam',v_b.lb,'luot_bam_link',v_b.lbl,
       'ctr', case when v_b.ht>0 and v_b.lbl is not null then round(v_b.lbl::numeric*100/v_b.ht,2) else null end,
       'cpm', case when v_b.ht>0 then round(v_b.chi*1000/v_b.ht) else null end,
       'cpc', case when v_b.lbl>0 then round(v_b.chi/v_b.lbl) else null end, 'ctr_cpc_thieu_link', (v_b.lbl is null)),
    'lech_pct', jsonb_build_object(
       'chi', case when v_b.chi>0 then round((v_a.chi-v_b.chi)*100.0/v_b.chi,1) else null end,
       'hien_thi', case when v_b.ht>0 then round((v_a.ht-v_b.ht)*100.0/v_b.ht,1) else null end,
       'luot_bam', case when v_b.lb>0 then round((v_a.lb-v_b.lb)*100.0/v_b.lb,1) else null end,
       'ctr', case when v_b.ht>0 and v_a.ht>0 and v_a.lbl is not null and v_b.lbl is not null then round((v_a.lbl::numeric*100/v_a.ht - v_b.lbl::numeric*100/v_b.ht),2) else null end,
       'cpm', case when v_b.ht>0 and v_a.ht>0 and v_b.chi>0 then round(((v_a.chi*1000/v_a.ht)-(v_b.chi*1000/v_b.ht))*100.0/(v_b.chi*1000/v_b.ht),1) else null end,
       'cpc', case when v_b.lbl>0 and v_a.lbl>0 and v_b.chi>0 then round(((v_a.chi/v_a.lbl)-(v_b.chi/v_b.lbl))*100.0/(v_b.chi/v_b.lbl),1) else null end));
end $function$;
revoke execute on function kho.ads_tong_so_sanh(date,date,text) from public, anon;
grant  execute on function kho.ads_tong_so_sanh(date,date,text) to authenticated;

-- (2b) chi_ads_nen_tang_tong + p_brand ────────────────────────────────────────
drop function if exists kho.chi_ads_nen_tang_tong(date, date);
create function kho.chi_ads_nen_tang_tong(p_tu_ngay date, p_den_ngay date, p_brand text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare v jsonb; v_uoc boolean; v_tong numeric;
begin
  select bool_and(la_uoc_tinh), sum(chi_tieu) into v_uoc, v_tong
    from kho.chi_ads_nen_tang_ngay where ngay between p_tu_ngay and p_den_ngay
      and (p_brand is null or kho.ads_brand_cua_ad(ad_id)=p_brand);
  select jsonb_build_object('la_uoc_tinh', coalesce(v_uoc, true),
    'ghi_chu', 'Số tách theo nền tảng là ước tính của Meta. Tổng chi vẫn lấy từ bảng chính.',
    'dong', coalesce((select jsonb_agg(jsonb_build_object('nen_tang', nen_tang, 'chi', chi, 'hien_thi', ht,
        'ctr', case when ht > 0 then round(link::numeric / ht * 100, 2) end,
        'phan_tram_chi', case when v_tong > 0 then round(chi / v_tong * 100, 1) end) order by chi desc) from (
        select nen_tang, sum(chi_tieu) chi, sum(hien_thi) ht, sum(luot_bam_link) link
        from kho.chi_ads_nen_tang_ngay where ngay between p_tu_ngay and p_den_ngay
          and (p_brand is null or kho.ads_brand_cua_ad(ad_id)=p_brand) group by nen_tang
      ) s), '[]'::jsonb)) into v;
  return v;
end $function$;
revoke execute on function kho.chi_ads_nen_tang_tong(date,date,text) from public, anon;
grant  execute on function kho.chi_ads_nen_tang_tong(date,date,text) to authenticated;

-- (2c) ads_ad_ngay + cột brand (client lọc) ───────────────────────────────────
drop function if exists kho.ads_ad_ngay(date, date);
create function kho.ads_ad_ngay(p_tu_ngay date, p_den_ngay date)
 returns table(ad_id text, brand text, ngay date, so_hoi_thoai integer, so_co_sdt integer, don_chot integer, gia_tri_chot numeric, don_giao integer, gia_tri_giao numeric, ty_le_chot numeric, chi_ad numeric, nguon_chi text, cac_ad numeric, nhan_vat text, pheu jsonb)
 language plpgsql security definer set search_path to 'kho' as $function$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_ad_ngay: chỉ ceo/ke_toan/ads_user'; end if;
  return query
  with base as (
    select v.id lead_id, v.ad_id, v.thoi_diem_hoi_thoai::date ngay, v.sdt from kho.v_lead_hien_hanh v
    where v.thoi_diem_hoi_thoai >= p_tu_ngay::timestamptz and v.thoi_diem_hoi_thoai < (p_den_ngay + 1)::timestamptz),
  don as (
    select b.lead_id,
      count(*) filter (where dh.trang_thai <> 'bao_gia') as don_chot,
      sum(dh.doanh_thu) filter (where dh.trang_thai <> 'bao_gia') as gt_chot,
      count(*) filter (where dh.ngay_giao is not null) as don_giao,
      sum(dh.doanh_thu) filter (where dh.ngay_giao is not null) as gt_giao
    from base b join kho.don_hang dh on dh.lead_id = b.lead_id group by b.lead_id),
  chi as (
    select ca.ad_id, ca.ngay, sum(ca.chi_tieu) chi, sum(ca.hien_thi) ht, sum(ca.luot_bam) lb, max(ca.nhan_vat) nhan
    from kho.chi_ads_ngay ca where ca.ngay >= p_tu_ngay and ca.ngay <= p_den_ngay group by ca.ad_id, ca.ngay)
  select b.ad_id, kho.ads_brand_cua_ad(b.ad_id), b.ngay,
    count(*)::int, count(*) filter (where b.sdt ~ '^[0-9]{9,11}$')::int,
    coalesce(sum(d.don_chot),0)::int, sum(d.gt_chot), coalesce(sum(d.don_giao),0)::int, sum(d.gt_giao),
    case when count(*)>0 then round(coalesce(sum(d.don_chot),0)::numeric*100/count(*),1) else null end,
    max(ch.chi),
    case when max(ch.chi) is not null then 'meta_insights' else 'chua_co_nguon' end,
    case when max(ch.chi) is not null and coalesce(sum(d.don_chot),0) > 0 then round(max(ch.chi) / coalesce(sum(d.don_chot),0), 0) else null end,
    case when max(ch.chi) is not null then max(ch.nhan) else null end,
    jsonb_build_array(
      case when max(ch.ht) is not null then jsonb_build_object('bac','hien_thi','gia_tri',max(ch.ht),'nhan','that') else jsonb_build_object('bac','hien_thi','gia_tri',null,'nhan','cho_nguon_meta') end,
      case when max(ch.lb) is not null then jsonb_build_object('bac','bam','gia_tri',max(ch.lb),'nhan','that') else jsonb_build_object('bac','bam','gia_tri',null,'nhan','cho_nguon_meta') end,
      jsonb_build_object('bac','hoi_thoai','gia_tri', count(*), 'nhan','that'),
      jsonb_build_object('bac','co_sdt', 'gia_tri', count(*) filter (where b.sdt ~ '^[0-9]{9,11}$'), 'nhan','that'),
      jsonb_build_object('bac','chot', 'gia_tri', coalesce(sum(d.don_chot),0), 'nhan','that'),
      jsonb_build_object('bac','da_giao', 'gia_tri', coalesce(sum(d.don_giao),0), 'nhan','that'))
  from base b left join don d on d.lead_id = b.lead_id left join chi ch on ch.ad_id = b.ad_id and ch.ngay = b.ngay
  group by b.ad_id, b.ngay order by (b.ad_id is null), b.ad_id, b.ngay;
end $function$;
revoke execute on function kho.ads_ad_ngay(date,date) from public, anon;
grant  execute on function kho.ads_ad_ngay(date,date) to authenticated;

commit;
