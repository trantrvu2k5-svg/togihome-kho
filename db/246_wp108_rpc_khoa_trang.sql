-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 246 — WP-108 nhịp 2 (số): CHUYỂN GÁN THƯƠNG HIỆU từ TÀI KHOẢN → TRANG (kho.ads_brand_cua_ad).
--   Ad không nối được trang → 'chưa rõ'. CẤM rơi về brand mặc định (không nhét tiền vào sconcept như cũ).
--   • ads_do_phu_brand  — độ phủ + chi treo tính theo BRAND-qua-trang (thay join act_id→ads_tai_khoan_brand).
--   • chi_ads_gop_meta  — gộp (kỳ, brand) vào chi_ads theo ad→trang→brand. OpenLiving nay tách khỏi Sophia.
--   • ads_bang_ky       — THÊM 'brand' mỗi chiến dịch (qua bảng nối ads_ad_campaign → ad → trang) cho bộ lọc.
--                         Tổng chi KHÔNG đổi (vẫn gộp theo chiến dịch); brand chỉ là NHÃN để lọc. Tên tài khoản
--                         giữ đọc ads_tai_khoan_brand (nhãn tài khoản, KHÔNG phải gán brand — xem §5 báo cáo).
--   • ads_thay_doi_gan_day — KHÔNG đổi: sổ đổi ở mức TÀI KHOẢN (không có ad → không có trang); bảng cũ chỉ cấp
--                         NHÃN tài khoản. Vẫn đọc ads_tai_khoan_brand (name-only). Liệt kê ở §5.
--   Idempotent (create or replace). HOÀN TÁC: chạy lại bản db/205 (bang_ky/do_phu) + bản gốc chi_ads_gop_meta.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ══════════ ads_do_phu_brand — độ phủ theo TRANG ══════════
create or replace function kho.ads_do_phu_brand()
 returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare v_co int; v_ban int; v_treo numeric; v_tk_treo int; v_ds jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then
    raise exception 'ads_do_phu_brand: chỉ ceo/ke_toan/ads_user'; end if;
  select count(distinct brand_id) into v_co from kho.ads_trang_brand where hieu_luc_den is null;   -- TRANG-brand
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

-- ══════════ chi_ads_gop_meta — gộp chi_ads theo (kỳ, brand-qua-trang) ══════════
create or replace function kho.chi_ads_gop_meta()
 returns jsonb language plpgsql security definer set search_path to 'kho' as $function$
declare v_moc date; v_moc_ky text; v_n int; v_treo numeric; v_tk_treo int; v_bo_tay int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_gop_meta: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)'; end if;
  select min(ngay) into v_moc from kho.chi_ads_ngay;
  if v_moc is null then return jsonb_build_object('ok',true,'moc',null,'so_dong',0,'ghi_chu','chi_ads_ngay rỗng — không gộp'); end if;
  v_moc_ky := to_char(v_moc,'YYYY-MM');
  delete from kho.chi_ads where nguon='meta_tu_dong' and ma_ky >= v_moc_ky;
  with g as (
    select to_char(n.ngay,'YYYY-MM') ky, kho.ads_brand_cua_ad(n.ad_id) brand, sum(n.chi_tieu) chi, count(distinct n.act_id) so_tk
    from kho.chi_ads_ngay n where to_char(n.ngay,'YYYY-MM') >= v_moc_ky group by 1,2
  ), ins as (
    insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap,nguon,nhan_vat,ghi_chu,nguoi_nhap)
    select g.ky, g.brand, 'quang_cao', g.chi, 'meta_tu_dong', 'chua_ro_vat',
           'Tự gộp từ chi_ads_ngay ('||g.so_tk||' TK Meta, gán theo trang)', 'he_thong'
    from g
    where g.brand <> 'chưa rõ'                                       -- brand chưa rõ → treo, KHÔNG nhét bừa
      and not exists (select 1 from kho.chi_ads t where t.ma_ky=g.ky and t.thuong_hieu=g.brand and t.kenh='quang_cao' and t.nguon='nhap_tay')
    returning 1)
  select count(*)::int into v_n from ins;
  select count(*)::int into v_bo_tay from (
    select g.ky, g.brand from (
      select to_char(n.ngay,'YYYY-MM') ky, kho.ads_brand_cua_ad(n.ad_id) brand
      from kho.chi_ads_ngay n where to_char(n.ngay,'YYYY-MM') >= v_moc_ky group by 1,2) g
    where g.brand<>'chưa rõ' and exists (select 1 from kho.chi_ads t where t.ma_ky=g.ky and t.thuong_hieu=g.brand and t.kenh='quang_cao' and t.nguon='nhap_tay')
  ) x;
  with ab as (select n.act_id, n.chi_tieu, kho.ads_brand_cua_ad(n.ad_id) brand from kho.chi_ads_ngay n)
  select coalesce(sum(chi_tieu) filter (where brand='chưa rõ'),0), count(distinct act_id) filter (where brand='chưa rõ')
    into v_treo, v_tk_treo from ab;
  return jsonb_build_object('ok',true,'moc',v_moc,'moc_ky',v_moc_ky,'so_dong_gop',v_n,
    'bo_qua_vi_nhap_tay',v_bo_tay,'chi_treo_chua_gan',v_treo,'so_tk_chua_gan',v_tk_treo);
end $function$;

-- ══════════ ads_bang_ky — thêm NHÃN brand mỗi chiến dịch (tổng chi KHÔNG đổi) ══════════
create or replace function kho.ads_bang_ky(p_tu_ngay date, p_den_ngay date)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off' as $function$
declare v_sat numeric; v_dong jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_bang_ky: chỉ ceo/ke_toan/ads_user'; end if;
  v_sat := kho.ads_nguong_lay('den_sat_tran_pct', p_den_ngay);
  with cds as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) objective, max(c.act_id) act_id,
           sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.luot_bam) lb, sum(c.luot_bam_link) lbl
    from kho.chi_chien_dich_ngay c where c.ngay >= p_tu_ngay and c.ngay <= p_den_ngay group by c.campaign_id
  ),
  j as (
    select cds.*, kho.ads_obj_web(cds.objective) web, m.ten_hien_thi, m.ten_tai_khoan,
      case when kho.ads_obj_web(cds.objective) then 0 else null end so_hoi_thoai,
      coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac        -- [L-108-4] brand qua bảng nối → trang
                where ac.campaign_id=cds.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1), 'chưa rõ') brand
    from cds left join kho.ads_tai_khoan_brand m on m.act_id = cds.act_id and m.hieu_luc_den is null   -- name-only (nhãn TK)
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
      'hoi_thoai_theo_chien_dich', case when web then 'nen_khong_dong' else 'chua_co_map' end
    ) order by chi desc nulls last), '[]'::jsonb),
    jsonb_build_object('chi', coalesce(sum(chi),0), 'luot_hien_thi', coalesce(sum(ht),0),
      'luot_bam', sum(lbl), 'luot_bam_tong', coalesce(sum(lb),0),
      'ctr', case when sum(ht) > 0 and sum(lbl) is not null then round(sum(lbl)::numeric * 100 / sum(ht), 2) else null end,
      'cpm', case when sum(ht) > 0 then round(sum(chi) * 1000 / sum(ht)) else null end,
      'cpc', case when sum(lbl) > 0 then round(sum(chi) / sum(lbl)) else null end,
      'ctr_cpc_thieu_link', (sum(lbl) is null), 'so_chien_dich', count(*))
  into v_dong, v_tong from j;
  return jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay, 'nhom', 'objective', 'dong', v_dong, 'tong', v_tong);
end $function$;

commit;
