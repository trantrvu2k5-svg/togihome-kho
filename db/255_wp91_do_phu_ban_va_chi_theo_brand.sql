-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 255 — WP-91 N-13: (1) SỬA ads_do_phu_brand đếm ĐỘ PHỦ chỉ trên brand DIỆN BÁN (thuong_hieu_ban) →
--   brand ẩn (Thử nghiệm) KHÔNG làm tử số đẹp lên. (2) THÊM ads_chi_theo_brand cho màn "Chi quảng cáo theo
--   thương hiệu" (tab Kênh & CAC): tổng · từng brand (tên/số mẫu/tiền, diện-bán giảm dần rồi brand ẩn cuối) ·
--   tiền chưa gán + fanpage. Σ dòng + chưa gán ≠ tổng → RAISE (không trả số im lặng).
--   Đọc bảng chứng từ (chi_ads_ngay) — KHÔNG phải bảng sổ. HOÀN TÁC ở cuối lệnh L-91j.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ══════════ (1) ads_do_phu_brand: tử/mẫu CHỈ đếm brand diện bán ══════════
create or replace function kho.ads_do_phu_brand()
 returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare v_co int; v_ban int; v_treo numeric; v_tk_treo int; v_ds jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_do_phu_brand: chỉ ceo/ke_toan/ads_user'; end if;
  -- [WP-91 N-13] CHỈ đếm brand ĐANG BÁN (thuong_hieu_ban): brand ẩn (ngung/không mã 3 chữ) KHÔNG vào tử số.
  select count(distinct tb.page_id_brand) into v_co from (
    select distinct brand_id page_id_brand from kho.ads_trang_brand
    where hieu_luc_den is null and brand_id in (select ma from kho.thuong_hieu_ban)) tb;
  select count(*) into v_ban from kho.thuong_hieu_ban;
  with ab as (select n.act_id, n.chi_tieu, kho.ads_brand_cua_ad(n.ad_id) brand from kho.chi_ads_ngay n)
  select coalesce(sum(chi_tieu) filter (where brand='chưa rõ'),0),
         count(distinct act_id) filter (where brand='chưa rõ')
    into v_treo, v_tk_treo from ab;
  with ab as (select n.act_id, n.chi_tieu, kho.ads_brand_cua_ad(n.ad_id) brand from kho.chi_ads_ngay n)
  select coalesce(jsonb_agg(jsonb_build_object('brand_id',brand,'ten',th.ten,'so_tk',so_tk,'tong_chi',tong)
                            order by brand),'[]'::jsonb) into v_ds
  from (select brand, count(distinct act_id) so_tk, sum(chi_tieu) tong from ab where brand<>'chưa rõ' group by brand) b
  left join kho.thuong_hieu th on th.ma=b.brand;
  return jsonb_build_object('brand_co_ban_do', v_co, 'brand_dang_ban', v_ban,
    'do_phu', v_co::text||'/'||v_ban::text, 'chi_treo_chua_gan', v_treo, 'so_tk_chua_gan', v_tk_treo, 'ds_brand_phu', v_ds);
end $function$;

-- ══════════ (2) ads_chi_theo_brand: số cho MÀN "Chi quảng cáo theo thương hiệu" ══════════
create or replace function kho.ads_chi_theo_brand()
 returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare v_tu date; v_den date; v_tong numeric; v_brands jsonb; v_sum_brand numeric;
        v_chua numeric; v_chua_tk int; v_fp jsonb; v_n int; v_mau int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_chi_theo_brand: chỉ ceo/ke_toan/ads_user'; end if;
  select min(ngay), max(ngay), coalesce(sum(chi_tieu),0) into v_tu, v_den, v_tong from kho.chi_ads_ngay;

  -- từng brand: tên · số MẪU (creative phân biệt) · tiền · cờ ẩn (không thuộc diện bán)
  with ab as (select n.ad_id, n.chi_tieu, kho.ads_brand_cua_ad(n.ad_id) brand from kho.chi_ads_ngay n),
  per as (
    select ab.brand, sum(ab.chi_tieu) tien, count(distinct ma.creative_id) so_mau
    from ab left join kho.ads_mau_ad ma on ma.ad_id = ab.ad_id
    where ab.brand <> 'chưa rõ' group by ab.brand)
  select jsonb_agg(jsonb_build_object('ma', p.brand, 'ten', coalesce(th.ten,p.brand),
           'an', (tb.ma is null), 'so_mau', p.so_mau, 'tien', p.tien)
           order by (tb.ma is null), p.tien desc),          -- diện bán (an=false) trước, giảm dần tiền; brand ẩn xuống CUỐI
         coalesce(sum(p.tien),0),
         count(*) filter (where tb.ma is not null)           -- n = brand diện bán CÓ chi
    into v_brands, v_sum_brand, v_n
  from per p left join kho.thuong_hieu th on th.ma=p.brand
             left join kho.thuong_hieu_ban tb on tb.ma=p.brand;
  select count(*) into v_mau from kho.thuong_hieu_ban;       -- mẫu số độ phủ = số brand đang bán (9)

  -- chưa gán: tiền + số TK + fanpage (page_id qua ads_mau, sau L-91h đã có page_id)
  with cr as (select n.ad_id, n.act_id, n.chi_tieu from kho.chi_ads_ngay n where kho.ads_brand_cua_ad(n.ad_id)='chưa rõ')
  select coalesce(sum(chi_tieu),0), count(distinct act_id) into v_chua, v_chua_tk from cr;
  with cr as (select n.ad_id, n.act_id, n.chi_tieu from kho.chi_ads_ngay n where kho.ads_brand_cua_ad(n.ad_id)='chưa rõ'),
  fp as (select coalesce(m.page_id, 'THIEU_PAGE') page_id, sum(cr.chi_tieu) tien, count(distinct cr.act_id) so_tk
         from cr left join kho.ads_mau_ad ma on ma.ad_id=cr.ad_id left join kho.ads_mau m on m.creative_id=ma.creative_id
         group by coalesce(m.page_id,'THIEU_PAGE'))
  select coalesce(jsonb_agg(jsonb_build_object('page_id',page_id,'tien',tien,'so_tk',so_tk) order by tien desc),'[]'::jsonb)
    into v_fp from fp;

  -- KIỂM CHÉO (QD-110): Σ brand + chưa gán = tổng, lệch → RAISE
  if round(v_sum_brand + v_chua) <> round(v_tong) then
    raise exception 'ads_chi_theo_brand LỆCH: Σbrand % + chưa gán % = % ≠ tổng %', v_sum_brand, v_chua, v_sum_brand+v_chua, v_tong;
  end if;

  return jsonb_build_object(
    'tu', v_tu, 'den', v_den, 'tong', v_tong,
    'do_phu_n', v_n, 'do_phu_mau', v_mau,
    'brands', coalesce(v_brands,'[]'::jsonb),
    'chua_gan', jsonb_build_object('tien', v_chua, 'so_tk', v_chua_tk, 'fanpages', v_fp));
end $function$;

revoke execute on function kho.ads_chi_theo_brand() from public, anon;
grant  execute on function kho.ads_chi_theo_brand() to authenticated;

commit;
