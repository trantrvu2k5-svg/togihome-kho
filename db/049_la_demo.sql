-- 049 — CỜ la_demo: đơn/dữ liệu DEMO hiện Ở MÀN VẬN HÀNH (kanban/đơn/tem) nhưng LOẠI khỏi MỌI hàm BÁO CÁO
--   TÀI CHÍNH (kẻo báo cáo ăn số giả). Rà đủ 8 hàm order-linked + phieu_dem_ngay. driver_tu_kho dùng
--   giao_dich (kho) — demo KHÔNG seed giao_dich nên không đụng (giữ nguyên).
--   node ops/run_sql.mjs ../db/049_la_demo.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin; -- chạy lại 8 hàm bản cũ (db/046 _lead_time_core+lead_time · db/042 do_lech_* · db/028 tinh_he_so_m
--     -- · db/048 ty_le_truy_duoc · db/038 ty_le_cat_lai+don_gia_hoat_dong_thuc+driver_tu_tem);
--     alter table kho.don_hang drop column if exists la_demo;
--     alter table kho.phieu_dem_ngay drop column if exists la_demo; commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table kho.don_hang       add column if not exists la_demo boolean not null default false;
alter table kho.phieu_dem_ngay add column if not exists la_demo boolean not null default false;
create index if not exists idx_don_hang_demo on kho.don_hang(la_demo) where la_demo;

-- ── _lead_time_core: loại demo (dh) ──
create or replace function kho._lead_time_core(p_dong text, p_sku text, p_so_don integer)
  returns table(cho_tb numeric, lam_tb numeric, tong_tb numeric, tong_nhanh integer, tong_cham integer, so_don integer, canh_bao text)
  language sql stable security definer set search_path = kho as $$
  with d as (
    select (dh.ngay_vao_chuyen - dh.ngay_chot) cho, (dh.ngay_xong - dh.ngay_vao_chuyen) lam, (dh.ngay_xong - dh.ngay_chot) tong
    from kho.don_hang dh
    where dh.ngay_chot is not null and dh.ngay_xong is not null and dh.ngay_vao_chuyen is not null
      and coalesce(dh.la_demo,false) = false
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%'))
    order by dh.ngay_xong desc limit greatest(p_so_don, 1))
  select round(avg(cho),1), round(avg(lam),1), round(avg(tong),1), min(tong)::int, max(tong)::int, count(*)::int,
         case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end from d;
$$;

-- ── do_lech_uoc: loại demo ──
create or replace function kho.do_lech_uoc(p_dong text default null, p_sku text default null)
  returns table(lech_tb_ngay numeric, so_don integer, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then raise exception 'do_lech_uoc: chỉ ceo/ke_toan/xuong'; end if;
  return query with d as (
    select (dh.ngay_xong - dh.ngay_du_kien) lech from kho.don_hang dh
    where dh.ngay_du_kien is not null and dh.ngay_xong is not null and coalesce(dh.la_demo,false) = false
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%')))
  select round(avg(lech),1), count(*)::int, case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end from d;
end $$;

-- ── do_lech_hen_khach: loại demo ──
create or replace function kho.do_lech_hen_khach(p_dong text default null, p_sku text default null)
  returns table(lech_tb_ngay numeric, so_don integer, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then raise exception 'do_lech_hen_khach: chỉ ceo/ke_toan/xuong'; end if;
  return query with d as (
    select (dh.ngay_giao - dh.ngay_hen_khach_ban_dau) lech from kho.don_hang dh
    where dh.ngay_hen_khach_ban_dau is not null and dh.ngay_giao is not null and coalesce(dh.la_demo,false) = false
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%')))
  select round(avg(lech),1), count(*)::int, case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end from d;
end $$;

-- ── tinh_he_so_m: loại demo ở 2 truy vấn avg ──
create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'tinh_he_so_m: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  select avg(g.gia_chuyen_giao) into v_gcg_tb from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')
      and d.loai is distinct from 'mau_moi' and coalesce(d.la_demo,false) = false;
  select avg(d.ship_thuc_tra) into v_ship_tb from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky
    and d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo') and d.loai is distinct from 'mau_moi'
    and coalesce(d.la_demo,false) = false;
  if t.dt_muc_tieu     is null then v_thieu := v_thieu || 'dt_muc_tieu, '; end if;
  if t.so_don_ke_hoach is null or t.so_don_ke_hoach = 0 then v_thieu := v_thieu || 'so_don_ke_hoach, '; end if;
  if t.phi_don_le      is null then v_thieu := v_thieu || 'phi_don_le, '; end if;
  if v_gcg_tb is null then v_thieu := v_thieu || 'đơn có gia_chuyen_giao đóng dấu kỳ (gcg_TB rỗng), '; end if;
  if v_thieu <> '' then raise notice 'tinh_he_so_m(%): THIẾU %', p_ma_ky, rtrim(v_thieu, ', '); return null; end if;
  v_sum_gcg  := v_gcg_tb              * t.so_don_ke_hoach;
  v_sum_ship := coalesce(v_ship_tb,0) * t.so_don_ke_hoach;
  v_sum_phi  := t.phi_don_le          * t.so_don_ke_hoach;
  return (t.dt_muc_tieu * (1 - v_hh) - v_sum_ship - v_sum_phi) / v_sum_gcg;
end $$;

-- ── driver_tu_tem: loại demo (join don_hang qua tem_ban_ve.ma_don) ở cả 3 nhánh ──
create or replace function kho.driver_tu_tem(p_ma_ky text, p_hoat_dong text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_from date; v_to date; v numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then raise exception 'driver_tu_tem: chỉ ceo/ke_toan/xuong'; end if;
  v_from := to_date(p_ma_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  if p_hoat_dong = 'goi' then
    select count(distinct (t.ma_don, t.phien_ban, b.kien)) into v
    from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
    join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
    join kho.don_hang dh on dh.ma_don=b.ma_don
    where l.ngay>=v_from and l.ngay<v_to and b.kien is not null and coalesce(dh.la_demo,false)=false;
    return v;
  end if;
  if p_hoat_dong = 'dan' then
    select coalesce(sum(coalesce((e->>'dai')::numeric,0))/1000.0, 0) into v
    from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
    join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
    join kho.don_hang dh on dh.ma_don=b.ma_don
    cross join lateral jsonb_array_elements(b.canh_dan) e
    where l.ngay>=v_from and l.ngay<v_to and coalesce(dh.la_demo,false)=false;
    return v;
  end if;
  select count(*) into v
  from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
  join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
  join kho.don_hang dh on dh.ma_don=b.ma_don
  where l.ngay>=v_from and l.ngay<v_to and coalesce(dh.la_demo,false)=false
    and case p_hoat_dong when 'cat' then true
      when 'thung' then b.vai_tro = any(array['hong','vach','hau','noc','day','be'])
      when 'canh'  then b.vai_tro = any(array['canh_cua','canh_lua']) else false end;
  if p_hoat_dong not in ('cat','thung','canh') then return null; end if;
  return v;
end $$;

-- ── ty_le_cat_lai: loại demo (join don_hang qua tem_da_in.ma_don) ──
create or replace function kho.ty_le_cat_lai(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_from date; v_to date; v_lai numeric; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then raise exception 'ty_le_cat_lai: chỉ ceo/ke_toan/xuong'; end if;
  v_from := to_date(p_ma_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  select count(*) filter (where l.lan_thu > 1), count(*) into v_lai, v_tong
  from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
  join kho.don_hang dh on dh.ma_don=t.ma_don
  where l.ngay>=v_from and l.ngay<v_to and coalesce(dh.la_demo,false)=false;
  if coalesce(v_tong,0)=0 then return null; end if;
  return round(v_lai / v_tong, 4);
end $$;

-- ── ty_le_truy_duoc: loại demo (v_truy · v_kd · v_tongdon · phiếu đếm) ──
create or replace function kho.ty_le_truy_duoc(p_ma_ky text, p_hoat_dong text)
  returns table(ty_le numeric, luong_truy numeric, luong_khong_truy numeric, so_don_khong_do integer, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_truy numeric; v_tong numeric; v_luong numeric; v_r numeric; v_kd int; v_tongdon int; v_pct numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ty_le_truy_duoc: chỉ ceo/ke_toan'; end if;
  execute format('select coalesce(sum(s.%I),0) from kho.san_luong_don s join kho.don_hang d on d.ma_don=s.ma_don where d.ma_ky_ap_dung=$1 and coalesce(d.la_demo,false)=false', p_hoat_dong)
    into v_truy using p_ma_ky;
  begin v_tong := kho.driver_tu_tem(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end;
  if v_tong is null or v_tong=0 then begin v_tong := kho.driver_tu_kho(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end; end if;
  if v_tong is null or v_tong=0 then select sum(so_luong) into v_tong from kho.phieu_dem_ngay where hoat_dong=p_hoat_dong and to_char(ngay,'YYYY-MM')=p_ma_ky and coalesce(la_demo,false)=false; end if;
  select count(*) into v_kd from kho.don_hang d join kho.don_hang_gia_von g on g.ma_don=d.ma_don
    where d.ma_ky_ap_dung=p_ma_ky and g.nguon='nhap_tay' and coalesce(d.la_demo,false)=false;
  select count(*) into v_tongdon from kho.don_hang d where d.ma_ky_ap_dung=p_ma_ky and coalesce(d.la_demo,false)=false;
  so_don_khong_do := coalesce(v_kd,0);
  v_pct := case when coalesce(v_tongdon,0) > 0 then round(v_kd::numeric / v_tongdon * 100, 1) else 0 end;
  canh_bao := case when v_pct > 20 then '⚠ tỷ lệ chưa đáng tin: ' || v_pct || '% đơn nhập tay (không đo được driver)' else null end;
  if v_tong is null or v_tong=0 then ty_le := null; luong_truy := null; luong_khong_truy := null; return next; return; end if;
  v_r := round(least(v_truy/v_tong,1.0),4);
  select coalesce(sum((coalesce(lt.luong_to,0)+coalesce(lt.overhead_phan_bo,0)+coalesce(lt.bao_hiem,0))*pb.phan_tram_thoi_gian/100.0),0)
    into v_luong from kho.phan_bo_hoat_dong pb join kho.luong_to lt on lt.ma_ky=pb.ma_ky and lt.ma_to=pb.ma_to
    where pb.ma_ky=p_ma_ky and pb.hoat_dong=p_hoat_dong;
  ty_le := v_r; luong_truy := round(v_luong*v_r); luong_khong_truy := round(v_luong*(1-v_r));
  return next;
end $$;

-- ── don_gia_hoat_dong_thuc: loại demo ở phiếu đếm (mẫu số tem/kho đã lọc qua driver_tu_tem) ──
create or replace function kho.don_gia_hoat_dong_thuc(p_ma_ky text, p_hoat_dong text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_tu numeric; v_mau numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'don_gia_hoat_dong_thuc: chỉ ceo/ke_toan'; end if;
  select coalesce(sum((coalesce(lt.luong_to,0)+coalesce(lt.overhead_phan_bo,0)+coalesce(lt.bao_hiem,0)) * pb.phan_tram_thoi_gian/100.0),0)
    into v_tu from kho.phan_bo_hoat_dong pb join kho.luong_to lt on lt.ma_ky=pb.ma_ky and lt.ma_to=pb.ma_to
    where pb.ma_ky=p_ma_ky and pb.hoat_dong=p_hoat_dong;
  begin v_mau := kho.driver_tu_tem(p_ma_ky, p_hoat_dong); exception when others then v_mau := null; end;
  if v_mau is null or v_mau = 0 then begin v_mau := kho.driver_tu_kho(p_ma_ky, p_hoat_dong); exception when others then v_mau := null; end; end if;
  if v_mau is null or v_mau = 0 then
    select sum(so_luong) into v_mau from kho.phieu_dem_ngay where hoat_dong=p_hoat_dong and to_char(ngay,'YYYY-MM')=p_ma_ky and coalesce(la_demo,false)=false;
  end if;
  if v_mau is null or v_mau = 0 then
    raise notice 'don_gia_hoat_dong_thuc(%,%): THIẾU mẫu số (không nguồn nào có số) — trả NULL.', p_ma_ky, p_hoat_dong; return null;
  end if;
  return round(v_tu / v_mau);
end $$;

commit;
