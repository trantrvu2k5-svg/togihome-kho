-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 263 — WP-113 L-113-5: dấu "đã tắt" (effective_status) + ngày chi cuối trong bảng chiến dịch.
--   Bộ kéo lưu effective_status vào ads_chien_dich_trang_thai (keoTrangThaiChienDich). ads_bang_ky +dang_chay/ngay_chi_cuoi.
--   ngay_chi_cuoi tính từ chi_chien_dich_ngay (max ngày có chi>0). CHỈ THÊM key — key cũ giữ nguyên.
--   HOÀN TÁC: chạy lại db/262 + drop table ads_chien_dich_trang_thai.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists kho.ads_chien_dich_trang_thai (
  campaign_id       text primary key,
  effective_status  text,
  cap_nhat_luc      timestamptz not null default now()
);
alter table kho.ads_chien_dich_trang_thai enable row level security;
drop policy if exists ads_cd_tt_doc on kho.ads_chien_dich_trang_thai;
create policy ads_cd_tt_doc on kho.ads_chien_dich_trang_thai for select
  using (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan','ads_user'));

create or replace function kho.ads_bang_ky(p_tu_ngay date, p_den_ngay date, p_brand text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off'
as $function$
declare v_sat numeric; v_dong jsonb; v_tong jsonb; v_lien_brand jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_bang_ky: chỉ ceo/ke_toan/ads_user'; end if;
  v_sat := kho.ads_nguong_lay('den_sat_tran_pct', p_den_ngay);
  -- [3d] trạng thái liên hệ THEO BRAND: 'co'|'khong'|'chua_tin'. Chỉ tính ngày >= mốc trong 30 ngày.
  --   Vắng mốc → hành vi cũ ('co'/'khong'). Chưa có ngày >= mốc → 'chua_tin'.
  with cd30 as (
    select coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
             where ac.campaign_id=c.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand,
           c.ngay, c.lien_he_pixel lh
    from kho.chi_chien_dich_ngay c where c.ngay between (p_den_ngay - 29) and p_den_ngay)
  select coalesce(jsonb_object_agg(brand, st), '{}'::jsonb) into v_lien_brand from (
    select brand,
      case when kho.ads_moc_pixel(brand) is null then (case when coalesce(sum(lh),0) > 0 then 'co' else 'khong' end)
           when count(*) filter (where ngay >= kho.ads_moc_pixel(brand)) = 0 then 'chua_tin'
           when coalesce(sum(lh) filter (where ngay >= kho.ads_moc_pixel(brand)),0) > 0 then 'co'
           else 'khong' end st
    from cd30 group by brand) q;

  with cds as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) objective, max(c.act_id) act_id,
           sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.luot_bam) lb, sum(c.luot_bam_link) lbl,
           sum(c.luot_vao_trang) vt, sum(c.bam_ra_web) rw, sum(c.cuoc_tro_chuyen) cuoc, sum(c.lien_he_pixel) lh
    from kho.chi_chien_dich_ngay c where c.ngay >= p_tu_ngay and c.ngay <= p_den_ngay group by c.campaign_id
  ),
  og as (
    select campaign_id, bool_or(optimization_goal = 'CONVERSATIONS') co_msg,
      bool_or(optimization_goal is not null and optimization_goal <> 'CONVERSATIONS') co_web
    from kho.ads_nhom_quang_cao group by campaign_id
  ),
  j0 as (
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
  ),
  j as (select j0.*, coalesce(v_lien_brand ->> brand, null) lh_state,
                kho.ads_moc_pixel(brand) moc, st.effective_status es,
                (select max(ccn.ngay) from kho.chi_chien_dich_ngay ccn where ccn.campaign_id=j0.campaign_id and ccn.chi_tieu>0) ngay_cuoi
        from j0 left join kho.ads_chien_dich_trang_thai st on st.campaign_id = j0.campaign_id
        where p_brand is null or j0.brand = p_brand)
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
      'loai_chien_dich', loai_cd,
      'toi_trang_100_bam', case when rw > 0 then round(vt::numeric * 100 / rw, 2) else null end,
      'gia_1_luot_vao',    case when vt > 0 then round(chi / vt) else null end,
      'luot_lien_he',      (lh + cuoc),
      -- [3d] chỉ trạng thái 'khong' (đã tin, 0 sự kiện) mới NULL giá 1 liên hệ
      'gia_1_lien_he',     case when lh_state = 'khong' then null
                                when (lh + cuoc) > 0 then round(chi / (lh + cuoc)) else null end,
      'cuoc_tro_chuyen',   cuoc,
      'gia_1_cuoc',        case when cuoc > 0 then round(chi / cuoc) else null end,
      'web_chua_co_su_kien_lien_he', lh_state,                 -- [3d] 'co'|'khong'|'chua_tin'
      'lien_he_chi_tu_quang_cao', (lh_state = 'khong'),
      -- [3c] kỳ có ngày < mốc của thương hiệu dòng → số pixel chưa tin (giá trị VẪN trả, để màn đeo nhãn)
      'so_pixel_chua_tin', (moc is not null and p_tu_ngay < moc),
      'dang_chay', case when es is null then null else (es = 'ACTIVE') end,   -- [WP-113 L-113-5]
      'ngay_chi_cuoi', ngay_cuoi
    ) order by chi desc nulls last), '[]'::jsonb),
    jsonb_build_object('chi', coalesce(sum(chi),0), 'luot_hien_thi', coalesce(sum(ht),0),
      'luot_bam', sum(lbl), 'luot_bam_tong', coalesce(sum(lb),0),
      'ctr', case when sum(ht) > 0 and sum(lbl) is not null then round(sum(lbl)::numeric * 100 / sum(ht), 2) else null end,
      'cpm', case when sum(ht) > 0 then round(sum(chi) * 1000 / sum(ht)) else null end,
      'cpc', case when sum(lbl) > 0 then round(sum(chi) / sum(lbl)) else null end,
      'ctr_cpc_thieu_link', (sum(lbl) is null), 'so_chien_dich', count(*),
      'chi_theo_loai', jsonb_build_object(
        'dan_vao_web', coalesce(sum(chi) filter (where loai_cd='dan_vao_web'),0),
        'nhan_tin',    coalesce(sum(chi) filter (where loai_cd='nhan_tin'),0),
        'chua_xep',    coalesce(sum(chi) filter (where loai_cd='chua_xep'),0)))
  into v_dong, v_tong from j;
  return jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay, 'nhom', 'objective', 'dong', v_dong, 'tong', v_tong);
end $function$;

commit;
