-- db/208 · WP-93 L-05 · SỬA NGUỒN "Bấm": thêm luot_bam_link (inline_link_clicks) — số bấm-vào-LINK, dùng cho CTR/CPC.
--   BỆNH (A3 L-04): luot_bam = Meta 'clicks' (mọi lượt bấm: thả cảm xúc, bình luận, bấm vào trang) ≠ bấm-vào-link.
--     GIUONG 27/08–02/09: clicks 1.078 vs inline_link_clicks 488 → CTR/CPC cũ tính từ số sai (gấp ~2,2×).
--   CHỮA: thêm CỘT MỚI luot_bam_link, GIỮ NGUYÊN luot_bam (clicks tổng) — hai số đo hai thứ, giữ cả hai = bản sự thật đủ.
--     CTR = luot_bam_link/hien_thi · CPC = chi/luot_bam_link · CPM giữ nguyên (chi/hien_thi, vốn ĐÚNG). link NULL → NULL + cờ.
--   A2: chi_ads_ngay (mức ad) CÙNG BỆNH (luot_bam=clicks) → làm y hệt.
--   C3: tắt cờ chi_so_ty_le_dang_ngo (bật oan ở db/207) — đóng khoảng cũ + mở khoảng mới =0 (khuôn QD-68).
--   ⚠ Cổng backup QD-61. IDEMPOTENT (add col if not exists · c-or-r func · cờ guard). HOÀN TÁC: chạy lại db/199+db/200+db/207;
--     alter table drop column luot_bam_link (2 bảng); đóng khoảng cờ =0, mở lại =1.
begin;

-- ══════════ A1 + A2 · cột luot_bam_link (2 bảng) + comment phân biệt hai số ══════════
alter table kho.chi_chien_dich_ngay add column if not exists luot_bam_link integer;
alter table kho.chi_ads_ngay        add column if not exists luot_bam_link integer;
comment on column kho.chi_chien_dich_ngay.luot_bam is      'Meta clicks = MỌI lượt bấm (thả cảm xúc, bình luận, bấm vào trang…). KHÔNG dùng cho CTR/CPC.';
comment on column kho.chi_chien_dich_ngay.luot_bam_link is 'Meta inline_link_clicks = bấm vào ĐƯỜNG DẪN. Đây là số dùng cho CTR/CPC. NULL = Meta chưa trả (ad cũ).';
comment on column kho.chi_ads_ngay.luot_bam is            'Meta clicks = MỌI lượt bấm (thả cảm xúc, bình luận, bấm vào trang…). KHÔNG dùng cho CTR/CPC.';
comment on column kho.chi_ads_ngay.luot_bam_link is       'Meta inline_link_clicks = bấm vào ĐƯỜNG DẪN. Đây là số dùng cho CTR/CPC. NULL = Meta chưa trả (ad cũ).';

-- ══════════ Cửa GHI: nhận thêm luot_bam_link · KHÔNG đè NULL (ad cũ Meta thiếu trường → giữ số đã có) ══════════
create or replace function kho.chi_ads_ngay_ghi(p_ds jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_ads_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, ad_id text, ad_name text, ngay date, chi_tieu numeric, hien_thi bigint, luot_bam bigint, luot_bam_link integer, tien_te text))
  , up as (
    insert into kho.chi_ads_ngay(act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, tien_te, nguon, nhan_vat, keo_luc)
    select act_id, ad_id, ad_name, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, coalesce(nullif(tien_te,''),'VND'), 'meta_insights', 'chua_ro_vat', now()
    from e where act_id is not null and ad_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, ad_id, ngay) do update set
      ad_name=excluded.ad_name, chi_tieu=excluded.chi_tieu, hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam,
      luot_bam_link=coalesce(excluded.luot_bam_link, kho.chi_ads_ngay.luot_bam_link),   -- KHÔNG đè bằng NULL
      tien_te=excluded.tien_te, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $fn$;
revoke execute on function kho.chi_ads_ngay_ghi(jsonb) from public, anon;
grant  execute on function kho.chi_ads_ngay_ghi(jsonb) to authenticated;

create or replace function kho.chi_chien_dich_ngay_ghi(p_ds jsonb)
returns int language plpgsql security definer set search_path to 'kho' as $fn$
declare n int;
begin
  if not (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan') or coalesce(current_setting('kho.meta_he_thong',true),'')='1') then
    raise exception 'chi_chien_dich_ngay_ghi: chỉ ceo/ke_toan hoặc tiến trình hệ thống (GUC kho.meta_he_thong)';
  end if;
  with e as (select * from jsonb_to_recordset(p_ds) as x(
      act_id text, campaign_id text, campaign_name text, objective text, ngay date,
      chi_tieu numeric, hien_thi bigint, luot_bam bigint, luot_bam_link integer, tien_te text))
  , up as (
    insert into kho.chi_chien_dich_ngay(act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, tien_te, nguon, nhan_vat, keo_luc)
    select act_id, campaign_id, campaign_name, objective, ngay, chi_tieu, hien_thi, luot_bam, luot_bam_link, coalesce(nullif(tien_te,''),'VND'), 'meta_insights', 'chua_ro_vat', now()
    from e where act_id is not null and campaign_id is not null and ngay is not null and chi_tieu is not null
    on conflict (act_id, campaign_id, ngay) do update set
      campaign_name=excluded.campaign_name, objective=excluded.objective, chi_tieu=excluded.chi_tieu,
      hien_thi=excluded.hien_thi, luot_bam=excluded.luot_bam,
      luot_bam_link=coalesce(excluded.luot_bam_link, kho.chi_chien_dich_ngay.luot_bam_link),   -- KHÔNG đè bằng NULL
      tien_te=excluded.tien_te, keo_luc=now()
    returning 1)
  select count(*)::int into n from up;
  return n;
end $fn$;
revoke execute on function kho.chi_chien_dich_ngay_ghi(jsonb) from public, anon;
grant  execute on function kho.chi_chien_dich_ngay_ghi(jsonb) to authenticated;

-- ══════════ C1 + C2 · ads_bang_ky — CTR/CPC theo luot_bam_link · cột "Bấm"=link, thêm luot_bam_tong ══════════
create or replace function kho.ads_bang_ky(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_sat numeric; v_dong jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_bang_ky: chỉ ceo/ke_toan/ads_user'; end if;
  v_sat := kho.ads_nguong_lay('den_sat_tran_pct', p_den_ngay);
  with cds as (
    select c.campaign_id, max(c.campaign_name) ten, max(c.objective) objective, max(c.act_id) act_id,
           sum(c.chi_tieu) chi, sum(c.hien_thi) ht, sum(c.luot_bam) lb, sum(c.luot_bam_link) lbl
    from kho.chi_chien_dich_ngay c
    where c.ngay >= p_tu_ngay and c.ngay <= p_den_ngay
    group by c.campaign_id
  ),
  attr as ( select campaign_id, 0::int don_qua_ket, null::numeric cac, null::numeric tran from cds ),
  j as (
    select cds.*, a.don_qua_ket, a.cac, a.tran,
      kho.ads_obj_web(cds.objective) web, m.ten_hien_thi, m.ten_tai_khoan,
      case when kho.ads_obj_web(cds.objective) then 0 else null end so_hoi_thoai
    from cds join attr a on a.campaign_id = cds.campaign_id
      left join kho.ads_tai_khoan_brand m on m.act_id = cds.act_id and m.hieu_luc_den is null
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', campaign_id, 'campaign_name', ten, 'objective', objective, 'nhom_gop', objective,
      'act_id', act_id, 'ten_tai_khoan', coalesce(ten_hien_thi, ten_tai_khoan),
      'chi', chi, 'luot_hien_thi', ht,
      'luot_bam', lbl,                 -- CỘT "Bấm" = bấm-vào-link (nhãn UI "Bấm vào link" ở L-06)
      'luot_bam_tong', lb,             -- clicks tổng — L-06 hiện phụ nếu cần
      'ctr', case when ht > 0 and lbl is not null then round(lbl::numeric * 100 / ht, 2) else null end,
      'cpm', case when ht > 0 then round(chi * 1000 / ht) else null end,           -- CPM theo hien_thi (không đụng)
      'cpc', case when lbl > 0 then round(chi / lbl) else null end,
      'ctr_cpc_thieu_link', (lbl is null),   -- cờ: chưa có bấm-vào-link → CTR/CPC để trống, KHÔNG rơi về clicks tổng
      'so_hoi_thoai', so_hoi_thoai,
      'chi_moi_hoi_thoai', case when coalesce(so_hoi_thoai,0) > 0 then round(chi / so_hoi_thoai) else null end,
      'den', case when web then 'khong_do_duoc'
                  when coalesce(don_qua_ket,0) = 0 then 'chua_du_so'
                  when cac <  tran * v_sat/100.0 then 'con_du'
                  when cac <= tran then 'sat_tran'
                  else 'vuot_tran' end,
      'co_an', (coalesce(chi,0) = 0),
      'hoi_thoai_theo_chien_dich', case when web then 'nen_khong_dong' else 'chua_co_map' end
    ) order by chi desc nulls last), '[]'::jsonb),
    jsonb_build_object(
      'chi', coalesce(sum(chi),0), 'luot_hien_thi', coalesce(sum(ht),0),
      'luot_bam', sum(lbl), 'luot_bam_tong', coalesce(sum(lb),0),
      'ctr', case when sum(ht) > 0 and sum(lbl) is not null then round(sum(lbl)::numeric * 100 / sum(ht), 2) else null end,
      'cpm', case when sum(ht) > 0 then round(sum(chi) * 1000 / sum(ht)) else null end,
      'cpc', case when sum(lbl) > 0 then round(sum(chi) / sum(lbl)) else null end,
      'ctr_cpc_thieu_link', (sum(lbl) is null),
      'so_chien_dich', count(*))
  into v_dong, v_tong from j;
  return jsonb_build_object('tu', p_tu_ngay, 'den', p_den_ngay, 'nhom', 'objective', 'dong', v_dong, 'tong', v_tong);
end $$;
revoke execute on function kho.ads_bang_ky(date,date) from public, anon;
grant  execute on function kho.ads_bang_ky(date,date) to authenticated;

-- ══════════ C1 · ads_tong_so_sanh — CTR/CPC theo luot_bam_link (giữ luot_bam tổng để so; CPM không đụng) ══════════
create or replace function kho.ads_tong_so_sanh(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_len int; v_ptu date; v_pden date; v_a record; v_b record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','ads_user') then raise exception 'ads_tong_so_sanh: chỉ ceo/ke_toan/ads_user'; end if;
  v_len := (p_den_ngay - p_tu_ngay) + 1; v_ptu := p_tu_ngay - v_len; v_pden := p_tu_ngay - 1;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl
    into v_a from kho.chi_chien_dich_ngay where ngay >= p_tu_ngay and ngay <= p_den_ngay;
  select coalesce(sum(chi_tieu),0) chi, coalesce(sum(hien_thi),0) ht, coalesce(sum(luot_bam),0) lb, sum(luot_bam_link) lbl
    into v_b from kho.chi_chien_dich_ngay where ngay >= v_ptu and ngay <= v_pden;
  return jsonb_build_object(
    'do_dai_ngay', v_len,
    'ky_nay', jsonb_build_object('tu',p_tu_ngay,'den',p_den_ngay,'chi',v_a.chi,'hien_thi',v_a.ht,'luot_bam',v_a.lb,'luot_bam_link',v_a.lbl,
       'ctr', case when v_a.ht>0 and v_a.lbl is not null then round(v_a.lbl::numeric*100/v_a.ht,2) else null end,
       'cpm', case when v_a.ht>0 then round(v_a.chi*1000/v_a.ht) else null end,
       'cpc', case when v_a.lbl>0 then round(v_a.chi/v_a.lbl) else null end,
       'ctr_cpc_thieu_link', (v_a.lbl is null)),
    'ky_truoc', jsonb_build_object('tu',v_ptu,'den',v_pden,'chi',v_b.chi,'hien_thi',v_b.ht,'luot_bam',v_b.lb,'luot_bam_link',v_b.lbl,
       'ctr', case when v_b.ht>0 and v_b.lbl is not null then round(v_b.lbl::numeric*100/v_b.ht,2) else null end,
       'cpm', case when v_b.ht>0 then round(v_b.chi*1000/v_b.ht) else null end,
       'cpc', case when v_b.lbl>0 then round(v_b.chi/v_b.lbl) else null end,
       'ctr_cpc_thieu_link', (v_b.lbl is null)),
    'lech_pct', jsonb_build_object(
       'chi', case when v_b.chi>0 then round((v_a.chi-v_b.chi)*100.0/v_b.chi,1) else null end,
       'hien_thi', case when v_b.ht>0 then round((v_a.ht-v_b.ht)*100.0/v_b.ht,1) else null end,
       'luot_bam', case when v_b.lb>0 then round((v_a.lb-v_b.lb)*100.0/v_b.lb,1) else null end,
       'ctr', case when v_b.ht>0 and v_a.ht>0 and v_a.lbl is not null and v_b.lbl is not null then round((v_a.lbl::numeric*100/v_a.ht - v_b.lbl::numeric*100/v_b.ht),2) else null end,
       'cpm', case when v_b.ht>0 and v_a.ht>0 and v_b.chi>0 then round(((v_a.chi*1000/v_a.ht)-(v_b.chi*1000/v_b.ht))*100.0/(v_b.chi*1000/v_b.ht),1) else null end,
       'cpc', case when v_b.lbl>0 and v_a.lbl>0 and v_b.chi>0 then round(((v_a.chi/v_a.lbl)-(v_b.chi/v_b.lbl))*100.0/(v_b.chi/v_b.lbl),1) else null end));
end $$;
revoke execute on function kho.ads_tong_so_sanh(date,date) from public, anon;
grant  execute on function kho.ads_tong_so_sanh(date,date) to authenticated;

-- ══════════ C3 · tắt cờ chi_so_ty_le_dang_ngo (khuôn QD-68: đóng khoảng cũ + mở mới =0) ══════════
update kho.ads_nguong set hieu_luc_den = date '2026-09-01'
  where ma = 'chi_so_ty_le_dang_ngo' and gia_tri = 1 and hieu_luc_den is null;
insert into kho.ads_nguong(ma, gia_tri, hieu_luc_tu, ly_do, nguoi_ghi)
select 'chi_so_ty_le_dang_ngo', 0, date '2026-09-02', 'đã sửa nguồn bấm-vào-link, db/208', 'he_thong'
where not exists (select 1 from kho.ads_nguong where ma = 'chi_so_ty_le_dang_ngo' and hieu_luc_den is null);

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='chi_chien_dich_ngay' and column_name='luot_bam_link') then raise exception 'THIẾU luot_bam_link'; end if;
  raise notice 'db/208 OK: luot_bam_link (2 bảng) + 2 cửa ghi + ads_bang_ky/ads_tong_so_sanh theo link + cờ ngờ=0.';
end $$;
commit;
