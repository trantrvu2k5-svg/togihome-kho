-- 115 — KÊNH & CAC theo THƯƠNG HIỆU + bảng chi_ads + gác ép thuong_hieu tại cổng chốt (L-48).
--   ⚠ IDEMPOTENT: drop+create cm_don_raw (thêm cột thuong_hieu) · create or replace các hàm · create table if not exists.
--   VAT ADS (CEO chốt 18/08, KHÔNG thuế nhà thầu): kế toán nhập số GỒM VAT vào so_tien_nhap; chi ads THẬT = so_tien_nhap
--     ÷ (1+vat/100) SUY trong RPC (vat đọc tham_so_tai_chinh đúng kỳ, KHÔNG hardcode). Không lưu cột thứ hai.
--   KHÁCH MỚI THEO BRAND: sdt lần đầu có đơn da_giao của brand đó (min ngay_giao theo sdt×thuong_hieu rơi vào kỳ) —
--     KHÁC cờ khach_moi toàn cty (QD-34, giữ cho P/L). CAC = chi ads thật(brand,kênh) ÷ khách mới(brand,kênh).
--   CM kênh = Σ cm từ cm_don_raw (MỘT nguồn số, CHỈ đơn trọn) gom brand×kênh; cm_sau_ads = cm − ads đúng cặp (không rải).
--   Đơn thiếu thuong_hieu/nguon_khach → dòng "(chưa ghi …)" — hiện thật.
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop function if exists kho.kenh_cac_ky(text,text), kho.ads_ghi(text,jsonb), kho.ads_ds(text);
--   drop table if exists kho.chi_ads;
--   -- cm_don_raw: chạy lại bản db/113 (bỏ cột thuong_hieu). kiem_chuyen_trang_thai: chạy lại db/111 (bỏ gác brand). commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. cm_don_raw — THÊM cột thuong_hieu (drop+create vì đổi return type). cm_don_ky (db/113) dùng lại OK. ═══════════════
drop function if exists kho.cm_don_raw(text, numeric, numeric, text[]);
drop function if exists kho.cm_don_raw(text, numeric, numeric);   -- dọn overload 3-param orphan (cruft dev L-47b) → 3-arg call hết ambiguous
create function kho.cm_don_raw(p_ky text, p_vat numeric, p_hh numeric, p_ma text[] default null)
  returns table(ma_don text, khach text, dong text, nguon_khach text, thuong_hieu text, seg text,
                gia_chot numeric, dt_thuan numeric, k1 numeric, k2 numeric, k3 numeric,
                ship_lap numeric, hoa_hong numeric, cm numeric, thieu_gv boolean, thieu_ship boolean)
  language sql stable as $$
  select
    d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)'), d.dong, d.nguon_khach, d.thuong_hieu,
    case when d.dong in ('le','combo','du_an') then d.dong else 'khac' end,
    coalesce(d.gia_chot,0), coalesce(d.gia_chot,0)/(1+p_vat/100.0),
    coalesce(gv.khoi_1,0), coalesce(gv.khoi_2,0), coalesce(gv.khoi_3,0),
    coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0),
    (coalesce(d.gia_chot,0)/(1+p_vat/100.0))*p_hh,
    coalesce(d.gia_chot,0)/(1+p_vat/100.0) - (coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0))
      - (coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0)) - (coalesce(d.gia_chot,0)/(1+p_vat/100.0))*p_hh,
    (gv.ma_don is null), (d.ship_thuc_tra is null and d.lap_thuc_tra is null)
  from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
  where d.trang_thai='da_giao' and d.ngay_giao >= to_date(p_ky||'-01','YYYY-MM-DD')
    and d.ngay_giao < (to_date(p_ky||'-01','YYYY-MM-DD') + interval '1 month')::date
    and (p_ma is null or d.ma_don = any(p_ma))
$$;
revoke all on function kho.cm_don_raw(text,numeric,numeric,text[]) from public;

-- ═══════════════ 2. GÁC ép thuong_hieu tại cổng chốt (mở rộng db/109+111): cùng nguon_khach, vai thật, GUC bypass, không hồi tố ═══════════════
create or replace function kho.kiem_chuyen_trang_thai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_thieu text;
  v_day   text[] := array['nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'];
begin
  if new.trang_thai = 'moi_len_don'
     and (tg_op = 'INSERT' or old.trang_thai is distinct from 'moi_len_don')
     and coalesce(kho.current_vai_tro(),'') <> '' then
    if current_setting('chan.off_nguon', true) is distinct from '1'
       and coalesce(nullif(btrim(new.nguon_khach),''),'') = '' then
      raise exception 'Chưa chọn nguồn khách — chọn rồi mới chốt đơn.'; end if;
    if current_setting('chan.off_thuonghieu', true) is distinct from '1'
       and coalesce(nullif(btrim(new.thuong_hieu),''),'') = '' then
      raise exception 'Chưa chọn thương hiệu — chọn rồi mới chốt đơn.'; end if;
  end if;
  if tg_op = 'UPDATE' and old.trang_thai = 'bao_gia' and new.trang_thai <> 'bao_gia' then
    if current_setting('chan.off_nhay', true) is distinct from '1' and new.trang_thai = any (v_day) then
      raise exception 'Đơn báo giá "%" phải LÊN ĐƠN (moi_len_don) trước — không nhảy thẳng sang %', new.ma_don, new.trang_thai; end if;
    if new.trang_thai = 'moi_len_don' then
      if current_setting('chan.off_mon_gia', true) is distinct from '1' then
        select string_agg(coalesce(nullif(btrim(m.ten),''), m.sp_id, '(món chưa tên)'), ', ')
          into v_thieu from kho.don_hang_mon m where m.don_id = new.id and coalesce(m.gia,0) <= 0;
        if v_thieu is not null then raise exception 'Chưa lên đơn được — món thiếu giá: %', v_thieu; end if; end if;
      if current_setting('chan.off_von_chuyen', true) is distinct from '1' and new.dong = 'du_an'
         and not exists (select 1 from kho.don_hang_gia_von g where g.ma_don = new.ma_don and g.gia_chuyen_giao is not null) then
        raise exception E'Đơn thiết kế "%" cần GIÁ VỐN mới lên đơn được. Ba cách gỡ:\n  1) Thiết kế dựng hình rồi ĐẨY GIÁ VỐN từ plugin.\n  2) ceo/kho NHẬP GIÁ VỐN TAY ở app tài chính (tab Giá vốn theo đơn).\n  3) Nếu đơn KHÔNG cần dựng hình (mua ngoài/giường gỗ), ĐỔI LOẠI ĐƠN sang Lẻ.', new.ma_don; end if;
    end if;
  end if;
  return new;
end $$;

-- ═══════════════ 3. BẢNG chi_ads (số gốc GỒM VAT — giữ vết; chi thật SUY khi đọc) ═══════════════
create table if not exists kho.chi_ads (
  id           bigserial primary key,
  ma_ky        text not null,
  thuong_hieu  text not null references kho.thuong_hieu(ma),
  kenh         text not null check (kenh in ('quang_cao','gioi_thieu','cua_hang','san_tmdt','khach_cu','khac')),
  so_tien_nhap numeric not null check (so_tien_nhap >= 0),   -- GỒM VAT, đúng hoá đơn
  ghi_chu      text, nguoi_nhap text, cap_nhat_luc timestamptz default now()
);
create index if not exists idx_chi_ads_ma_ky on kho.chi_ads(ma_ky);
grant select on kho.chi_ads to authenticated; revoke all on kho.chi_ads from anon;
alter table kho.chi_ads enable row level security;
drop policy if exists chi_ads_doc on kho.chi_ads;
create policy chi_ads_doc on kho.chi_ads for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ═══════════════ 4. ads_ds / ads_ghi ═══════════════
create or replace function kho.ads_ds(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v jsonb; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ads_ds: chỉ ceo/ke_toan'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.thuong_hieu, x.kenh),'[]'::jsonb), coalesce(sum(x.so_tien_nhap),0)
    into v, v_tong
  from (select id,ma_ky,thuong_hieu,kenh,so_tien_nhap,ghi_chu,nguoi_nhap,cap_nhat_luc from kho.chi_ads where ma_ky=p_ky order by thuong_hieu,kenh limit 300) x;
  return jsonb_build_object('ma_ky',p_ky,'ds',v,'tong_nhap',v_tong);
end $$;
grant execute on function kho.ads_ds(text) to authenticated;

create or replace function kho.ads_ghi(p_ky text, p_dong jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; v_n int := 0; v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id=kho.current_ns()),'');
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ads_ghi: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky='' then raise exception 'ads_ghi: thiếu ma_ky'; end if;
  delete from kho.chi_ads where ma_ky = p_ky;
  for r in select * from jsonb_array_elements(coalesce(p_dong,'[]'::jsonb)) loop
    insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap,ghi_chu,nguoi_nhap)
      values(p_ky, r->>'thuong_hieu', r->>'kenh', coalesce(nullif(r->>'so_tien_nhap','')::numeric,0),
             nullif(r->>'ghi_chu',''), coalesce(nullif(r->>'nguoi_nhap',''), v_nguoi));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok',true,'ma_ky',p_ky,'so_dong',v_n);
end $$;
grant execute on function kho.ads_ghi(text, jsonb) to authenticated;

-- ═══════════════ 5. kenh_cac_ky(p_ky, p_brand) — bảng brand×kênh + CAC + cờ + cm_sau_ads + dòng "chưa ghi" ═══════════════
create or replace function kho.kenh_cac_ky(p_ky text, p_brand text default null)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  t record; v_vat numeric; v_hh numeric; v_from date; v_to date; v_ds jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'kenh_cac_ky: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then raise exception 'kenh_cac_ky: kỳ % chưa có tham số tài chính (vat)', p_ky; end if;
  v_vat := t.vat; v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  with cm as (   -- CHỈ ĐƠN TRỌN trong kỳ, gom brand×kênh (nguồn: cm_don_raw)
    select coalesce(nullif(btrim(r.thuong_hieu),''),'(chưa ghi TH)') brand,
           coalesce(nullif(btrim(r.nguon_khach),''),'(chưa ghi nguồn)') kenh,
           count(*) don_giao, sum(r.dt_thuan) dt, sum(r.cm) cm
    from kho.cm_don_raw(p_ky, v_vat, v_hh) r
    where not (r.thieu_gv or r.thieu_ship)
    group by 1,2
  ),
  fb as (   -- khách MỚI theo brand: đơn ĐẦU TIÊN (distinct on, 1 sort) mỗi sdt×brand → nếu rơi vào kỳ = khách mới
    select brand, kenh, count(*) khach_moi from (
      select distinct on (d.sdt_khach, d.thuong_hieu)
             d.thuong_hieu brand, d.nguon_khach kenh, d.ngay_giao first_giao
      from kho.don_hang d
      where d.trang_thai='da_giao' and nullif(btrim(d.sdt_khach),'') is not null
        and nullif(btrim(d.thuong_hieu),'') is not null and d.ngay_giao is not null
      order by d.sdt_khach, d.thuong_hieu, d.ngay_giao
    ) x where x.first_giao >= v_from and x.first_giao < v_to and nullif(btrim(x.kenh),'') is not null
    group by brand, kenh
  ),
  ads as (   -- chi ads THẬT = Σ so_tien_nhap ÷ (1+vat/100)
    select thuong_hieu brand, kenh, sum(so_tien_nhap)/(1+v_vat/100.0) chi_that
    from kho.chi_ads where ma_ky=p_ky group by 1,2
  ),
  gop as (
    select coalesce(cm.brand, fb.brand, ads.brand) brand, coalesce(cm.kenh, fb.kenh, ads.kenh) kenh,
      coalesce(cm.don_giao,0) don_giao, coalesce(cm.dt,0) dt, coalesce(cm.cm,0) cm,
      coalesce(fb.khach_moi,0) khach_moi, coalesce(ads.chi_that,0) chi_that
    from cm full outer join fb on fb.brand=cm.brand and fb.kenh=cm.kenh
            full outer join ads on ads.brand=coalesce(cm.brand,fb.brand) and ads.kenh=coalesce(cm.kenh,fb.kenh)
  ),
  loc as ( select * from gop where p_brand is null or brand = p_brand )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'brand',brand,'kenh',kenh,'don_giao',don_giao,'khach_moi_brand',khach_moi,
      'chi_ads_that',chi_that,'cac', case when khach_moi>0 then chi_that/khach_moi else null end,
      'vo_han', (chi_that>0 and khach_moi=0), 'mau_mong', (khach_moi>0 and khach_moi<3),
      'dt_thuan',dt,'cm_kenh',cm,'cm_sau_ads', cm - chi_that
    ) order by brand, kenh),'[]'::jsonb),
    jsonb_build_object('don_giao',coalesce(sum(don_giao),0),'khach_moi_brand',coalesce(sum(khach_moi),0),
      'chi_ads_that',coalesce(sum(chi_that),0),'dt_thuan',coalesce(sum(dt),0),
      'cm_kenh',coalesce(sum(cm),0),'cm_sau_ads',coalesce(sum(cm),0)-coalesce(sum(chi_that),0))
  into v_ds, v_tong from loc;

  return jsonb_build_object('ma_ky',p_ky,'vat',v_vat,'brand_loc',p_brand,'dong',v_ds,'tong',v_tong);
end $$;
grant execute on function kho.kenh_cac_ky(text, text) to authenticated;

do $$ begin
  if to_regprocedure('kho.kenh_cac_ky(text,text)') is null then raise exception 'THIẾU kenh_cac_ky'; end if;
  raise notice 'db/115 OK: chi_ads + ads_ds/ads_ghi/kenh_cac_ky + cm_don_raw(+thuong_hieu) + gác thuong_hieu.';
end $$;
commit;
