-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 262 — WP-113 L-113-3c: [2] mau_can_doi CHỈ đếm lỗi chất lượng mẫu · [3] MỐC TIN PIXEL (sửa pixel 11/09,
--   tin từ 12/09). Số pixel (lien_he_pixel, mua_pixel, luot_vao_trang + suy ra) trước mốc = CHƯA TIN.
--   Số vẫn tin: cuoc_tro_chuyen, chi, hiển thị, bấm, bam_ra_web.
--   HOÀN TÁC: chạy lại db/261 + drop table ads_moc_tin_pixel + drop ads_moc_pixel.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- [3a] MỐC TIN PIXEL theo thương hiệu. Vắng mốc → coi như không có mốc (đọc trả NULL, KHÔNG raise).
create table if not exists kho.ads_moc_tin_pixel (
  thuong_hieu text primary key,
  moc_ngay    date not null,
  ly_do       text,
  ghi_luc     timestamptz not null default now(),
  nguoi       text
);
alter table kho.ads_moc_tin_pixel enable row level security;
drop policy if exists ads_moc_pixel_doc on kho.ads_moc_tin_pixel;
create policy ads_moc_pixel_doc on kho.ads_moc_tin_pixel for select
  using (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan','ads_user'));

insert into kho.ads_moc_tin_pixel(thuong_hieu, moc_ngay, ly_do, nguoi) values
  ('sconcept',   date '2026-09-12', 'pixel hai web gắn nhầm, CEO sửa 11/09', 'ceo'),
  ('openliving', date '2026-09-12', 'pixel hai web gắn nhầm, CEO sửa 11/09', 'ceo')
on conflict (thuong_hieu) do update set moc_ngay=excluded.moc_ngay, ly_do=excluded.ly_do, ghi_luc=now(), nguoi=excluded.nguoi;

create or replace function kho.ads_moc_pixel(p_brand text)
 returns date language sql stable security definer set search_path to 'kho'
as $function$ select moc_ngay from kho.ads_moc_tin_pixel where thuong_hieu = p_brand $function$;

-- ══════════════════ [3c/3d] ads_bang_ky — 3 trạng thái liên hệ + so_pixel_chua_tin ══════════════════
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
                kho.ads_moc_pixel(brand) moc
        from j0 where p_brand is null or j0.brand = p_brand)
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
      'so_pixel_chua_tin', (moc is not null and p_tu_ngay < moc)
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

-- ══════════════════ [2]+[3e] ads_viec_phai_lam — mau_can_doi CHỈ 4 mã lỗi + loi_web dùng NGÀY TIN ══════════════════
create or replace function kho.ads_viec_phai_lam(p_tu_ngay date, p_den_ngay date, p_brand text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'kho' set jit to 'off'
as $function$
declare
  v_chicao numeric; v_ttd numeric; v_moingay numeric; v_vuotchung numeric; v_gop int;
  v_ty numeric; v_hesocuoc numeric; v_hienmin numeric;
  v_len int; v_ptu date; v_pden date; v_tc numeric; v_tp numeric; v_muc numeric;
  v_tang jsonb; v_gopblk jsonb; v_new jsonb; v_keo_do jsonb; v_suc jsonb; v_maurow jsonb; v_pixnote jsonb;
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

  with cur as (select campaign_id, max(campaign_name) ten, max(objective) obj, sum(chi_tieu) chi, sum(cuoc_tro_chuyen) cuoc, min(ngay) tu,
                 coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
                   where ac.campaign_id=c.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand
               from kho.chi_chien_dich_ngay c where ngay >= p_tu_ngay and ngay <= p_den_ngay group by campaign_id),
       prev as (select campaign_id, sum(chi_tieu) chi from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden group by campaign_id),
       cls as (
         select c.campaign_id, c.ten, c.obj, c.chi, c.cuoc, c.tu, c.brand, coalesce(p.chi,0) pchi,
           case when coalesce(p.chi,0) = 0 then 'moi_bat'
                when v_muc is not null and (c.chi - p.chi) * 100.0 / p.chi >= v_muc + v_vuotchung and (c.chi - p.chi) >= v_ttd then 'chi_tang_dot_bien'
                else null end loai,
           case when coalesce(p.chi,0) > 0 then round((c.chi - p.chi) * 100.0 / p.chi) else null end tang_pct
         from cur c left join prev p on p.campaign_id = c.campaign_id
         where p_brand is null or c.brand = p_brand),
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

  select trang_thai, loi_van_ban into v_kd_tt, v_kd_loi from kho.ads_moc_keo where nguon='meta_chi_chien_dich' order by bat_dau_luc desc limit 1;
  if v_kd_tt = 'loi' then
    v_ok := nullif((regexp_match(coalesce(v_kd_loi,''),'ok (\d+)/(\d+)'))[1],'')::int;
    v_tong_tk := nullif((regexp_match(coalesce(v_kd_loi,''),'ok (\d+)/(\d+)'))[2],'')::int;
    v_keo_do := jsonb_build_array(jsonb_build_object('loai','keo_do','keu',true,'ten_chien_dich','[]'::jsonb,
      'cau','Số Meta đang thiếu '||coalesce((v_tong_tk - v_ok)::text,'?')||'/'||coalesce(v_tong_tk::text,'?')||' tài khoản — các dòng dưới có thể sai.'));
  else v_keo_do := '[]'::jsonb; end if;

  -- [3e] loi_web dùng CHỈ ngày >= mốc pixel của thương hiệu. Không còn ngày tin → im-note (kêu lại từ mốc).
  with camp as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) obj,
      sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.cuoc_tro_chuyen) cuoc
    from kho.chi_chien_dich_ngay c where c.ngay between p_tu_ngay and p_den_ngay group by c.campaign_id),
  seen as (select campaign_id, (p_den_ngay - min(ngay) + 1) tuoi from kho.chi_chien_dich_ngay
           where hien_thi > 0 and ngay <= p_den_ngay group by campaign_id),
  brand_c as (select cp.campaign_id, coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
     where ac.campaign_id=cp.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand from camp cp),
  trust as (  -- tổng theo NGÀY TIN (>= mốc; vắng mốc → mọi ngày tin)
    select c.campaign_id, sum(c.hien_thi) ht_tin, sum(c.luot_vao_trang) vt_tin, sum(c.bam_ra_web) rw_tin, count(*) so_tin
    from kho.chi_chien_dich_ngay c join brand_c bc using(campaign_id)
    where c.ngay between p_tu_ngay and p_den_ngay
      and (kho.ads_moc_pixel(bc.brand) is null or c.ngay >= kho.ads_moc_pixel(bc.brand))
    group by c.campaign_id),
  nen_msg as (select b.brand, sum(c.chi_tieu) chi, sum(c.cuoc_tro_chuyen) cuoc
    from kho.chi_chien_dich_ngay c
    cross join lateral (select coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
        where ac.campaign_id=c.campaign_id and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') brand) b
    where c.ngay between (p_den_ngay-29) and p_den_ngay and not kho.ads_obj_web(c.objective) group by b.brand),
  enr as (select camp.*, seen.tuoi, bc.brand, coalesce(t.so_tin,0) so_tin, t.ht_tin, t.vt_tin, t.rw_tin,
             (nm.chi / nullif(nm.cuoc,0)) nen_gia_cuoc
    from camp join seen using(campaign_id) join brand_c bc using(campaign_id)
    left join trust t using(campaign_id) left join nen_msg nm on nm.brand = bc.brand
    where p_brand is null or bc.brand = p_brand),
  gcuoc as (select coalesce(jsonb_agg(jsonb_build_object('loai','gia_cuoc_tro_chuyen_cao','campaign_id',campaign_id,'ten',ten,'chi',chi,
      'gia_1_cuoc',round(chi/cuoc),'nen_gia_1_cuoc',round(nen_gia_cuoc),'ten_chien_dich',jsonb_build_array(ten),
      'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" giá 1 cuộc trò chuyện '||round(chi/cuoc)||'đ — cao hơn nền thương hiệu ('||round(nen_gia_cuoc)||'đ × '||v_hesocuoc||') — xem lại nhắm/nội dung.')),'[]'::jsonb) j
    from enr where not kho.ads_obj_web(obj) and tuoi >= v_moingay and ht >= v_hienmin
      and cuoc > 0 and nen_gia_cuoc is not null and (chi/cuoc) > nen_gia_cuoc * v_hesocuoc),
  lweb as (select coalesce(jsonb_agg(jsonb_build_object('loai','loi_web','keu',true,'campaign_id',campaign_id,'ten',ten,'chi',chi,
      'toi_trang_100_bam',round(vt_tin*100.0/rw_tin,2),'nguong',v_ty,'ten_chien_dich',jsonb_build_array(ten),
      'cau','Chiến dịch "'||coalesce(ten,campaign_id)||'" chỉ '||round(vt_tin*100.0/rw_tin,2)||' lượt vào trang / 100 bấm ra web (dưới '||v_ty||') — nghi web lỗi hoặc tải chậm.')),'[]'::jsonb) j
    from enr where kho.ads_obj_web(obj) and so_tin > 0 and tuoi >= v_moingay and ht_tin >= v_hienmin and rw_tin > 0 and (vt_tin*100.0/rw_tin) < v_ty),
  pixim as (select case when count(*) > 0 then jsonb_build_array(jsonb_build_object('loai','loi_web','keu',false,'ten_chien_dich','[]'::jsonb,
      'cau','Số pixel chưa tin (sửa pixel 11/09) — kêu lại từ 12/09.')) else '[]'::jsonb end j
    from enr where kho.ads_obj_web(obj) and so_tin = 0)
  select (select j from gcuoc) || (select j from lweb) || (select j from pixim) into v_new;

  -- [2] mau_can_doi CHỈ đếm lỗi chất lượng: ctr_duoi_nen · xep_hang_duoi_tb · tan_suat_cao · luot_phat_giam.
  v_suc := kho.ads_suc_khoe_mau(p_tu_ngay, p_den_ngay);
  with m as (select (e->>'ad_id') ad_id, (e->>'ten') ten from jsonb_array_elements(v_suc->'mau') e
             where (e->>'ket_luan_ma') in ('ctr_duoi_nen','xep_hang_duoi_tb','tan_suat_cao','luot_phat_giam')
               and (p_brand is null or (e->>'brand') = p_brand)),
       mc as (select m.ad_id, (select ac.campaign_id from kho.ads_ad_campaign ac where ac.ad_id=m.ad_id limit 1) cid from m),
       nm as (select mc.cid, (select max(campaign_name) from kho.chi_chien_dich_ngay c where c.campaign_id=mc.cid) ten from mc where cid is not null group by cid)
  select case when (select count(*) from m) > 0 then jsonb_build_array(jsonb_build_object(
      'loai','mau_can_doi','keu',true,'so_mau',(select count(*) from m),'so_chien_dich',(select count(*) from nm),
      'ten_chien_dich', coalesce((select jsonb_agg(ten) from nm),'[]'::jsonb),
      'cau',(select count(*) from m)||' mẫu cần đổi (CTR dưới nền / xếp hạng dưới TB / tần suất cao / lượt phát giảm) ở '||(select count(*) from nm)||' chiến dịch — mở bảng xem từng cái.'))
    else '[]'::jsonb end into v_maurow;

  return jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,
    'nhip_chung_pct', v_muc,
    'nguong', jsonb_build_object('chi_cao_khong_hoi_thoai',v_chicao,'tang_dot_bien_tuyet_doi',v_ttd,'ad_moi_du_ngay',v_moingay,'vuot_muc_tang_chung_pct',v_vuotchung,'gop_canh_bao_khi_tu',v_gop,
      'ty_le_toi_trang_toi_thieu',v_ty,'gia_cuoc_tro_chuyen_he_so',v_hesocuoc,'hien_thi_toi_thieu_doc',v_hienmin),
    'viec', v_keo_do || v_tang || v_new || v_maurow,
    'canh_bao_gop', v_gopblk);
end $function$;

commit;
