-- 028 — ĐƯỜNG GIÁ (theo SPEC 4 tham số V2 + 4 SỬA vòng này). Gộp cùng 027 — áp prod MỘT LẦN sau CEO duyệt.
--   node ops/run_sql.mjs ../db/027_tach_gia_von_san_pham.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod; 027 TRƯỚC)
--   node ops/run_sql.mjs ../db/028_duong_gia.sql               (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- 4 SỬA vòng này:
--   SỬA 1  tinh_he_so_m() dùng SẢN LƯỢNG KẾ HOẠCH (không trộn mục-tiêu-tương-lai với Σ-vốn-kỳ-đã-qua):
--          he_so_m = (dt_muc_tieu×(1−hh) − Σship_KH − Σphi_KH) ÷ Σgcg_KH ;  KH = TB/đơn × so_don_ke_hoach.
--          Thêm cột so_don_ke_hoach. TB/đơn (giá vốn, ship) = trung bình đơn ĐÃ ĐÓNG DẤU kỳ này.
--   SỬA 2  phi_don TÁCH 3 dòng: phi_don_le · phi_don_combo · phi_don_thiet_ke. gia_san_don() chọn theo dòng đơn
--          (khớp LOAI/loaiOf ở togihome_sale.html:856 → dong ∈ le|combo|du_an).
--   SỬA 3  hoa hồng TÁCH 3 vai: hh_sale · hh_quan_ly · hh_thiet_ke. Công thức dùng TỔNG ba cái.
--   SỬA 4  thêm ky_tinh = 'ban_hang' — tham số theo kỳ BÁN, không theo kỳ SX. Đơn đóng dấu ma_ky_ap_dung lúc chốt.
--
-- Công thức lõi (giữ từ vòng trước):
--   he_so_m_ap_dung = 1 + (he_so_m − 1) × he_so_nhom   (he_so_nhom chỉ nhân phần LÃI — V2:122 sai)
--   tang_1_mon()  = gv × he_so_m_ap_dung + ship        (theo MÓN, KHÔNG phi_don)
--   gia_san_don() = (Σ tang_1 + phi_don_<dòng>) ÷ (1 − Σhh)   (phi_don MỘT lần/đơn)
--
-- AN NINH: tham_so_tai_chinh RLS CHỈ ceo/ke_toan (sale CHẶN) · gia_niem_yet sale ĐỌC/ceo-ke_toan GHI ·
--   gio_thiet_ke() chỉ trả giờ · tang_1_mon()/gia_san_don() trả 1 SỐ, không lộ gv/tham số.
--
-- ══════════ HOÀN TÁC (gỡ sạch những gì 028 tạo — KHÔNG đụng 027) ══════════
--   begin;
--   drop function if exists kho.tinh_he_so_m(text);
--   drop function if exists kho.gia_san_don(jsonb, text);
--   drop function if exists kho.tang_1_mon(text, numeric, numeric);
--   drop function if exists kho.gio_thiet_ke();
--   drop table if exists kho.gia_niem_yet;
--   drop table if exists kho.tham_so_tai_chinh;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. SỔ THAM SỐ TÀI CHÍNH — PK = ma_ky. CHỈ ceo/ke_toan đọc+ghi.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.tham_so_tai_chinh (
  ma_ky            text primary key,                                     -- khoá theo kỳ
  ky_tinh          text not null default 'ban_hang',                     -- SỬA 4: kỳ BÁN (không phải kỳ SX)
  ngay_ap_dung     date,                                                 -- thuộc tính hiệu lực (chọn kỳ hiện hành)
  so_don_ke_hoach  integer check (so_don_ke_hoach is null or so_don_ke_hoach >= 0),  -- SỬA 1: sản lượng KẾ HOẠCH
  he_so_m          numeric check (he_so_m is null or he_so_m > 0),       -- tầng 1 — KHÔNG seed, tính bằng tinh_he_so_m()
  he_so_nhom       numeric not null default 1 check (he_so_nhom > 0),    -- hệ số nhóm MẶC ĐỊNH (nhom_nhay_gia)
  -- SỬA 2: phí đơn (tầng 2) tách theo dòng
  phi_don_le       numeric not null default 0 check (phi_don_le       >= 0),
  phi_don_combo    numeric not null default 0 check (phi_don_combo    >= 0),
  phi_don_thiet_ke numeric not null default 0 check (phi_don_thiet_ke >= 0),
  -- SỬA 3: hoa hồng (tầng 3) tách theo vai — công thức dùng TỔNG
  hh_sale          numeric not null default 0 check (hh_sale     >= 0),
  hh_quan_ly       numeric not null default 0 check (hh_quan_ly  >= 0),
  hh_thiet_ke      numeric not null default 0 check (hh_thiet_ke >= 0),
  dt_muc_tieu      numeric check (dt_muc_tieu is null or dt_muc_tieu >= 0),
  -- Tiền nội bộ (từ GV0)
  dg_gio_tk        numeric not null default 0 check (dg_gio_tk >= 0),
  gio_l1           numeric not null default 0 check (gio_l1 >= 0),
  gio_l2           numeric not null default 0 check (gio_l2 >= 0),
  gio_l3           numeric not null default 0 check (gio_l3 >= 0),
  cnc_lap_trinh    numeric not null default 0 check (cnc_lap_trinh >= 0),
  setup_to_hop     numeric not null default 0 check (setup_to_hop >= 0),  -- ⚠ CEO có thể phủ quyết
  ghi_chu          text,
  constraint chk_hh_tong check (coalesce(hh_sale,0) + coalesce(hh_quan_ly,0) + coalesce(hh_thiet_ke,0) < 1)
);

-- Dòng đầu — SEED kỳ đầu (mọi số áng chừng, KHÔNG phải số đo → cột ghi_chu).
insert into kho.tham_so_tai_chinh
  (ma_ky, ky_tinh, ngay_ap_dung, so_don_ke_hoach, he_so_m, he_so_nhom,
   phi_don_le, phi_don_combo, phi_don_thiet_ke, hh_sale, hh_quan_ly, hh_thiet_ke, dt_muc_tieu,
   dg_gio_tk, gio_l1, gio_l2, gio_l3, cnc_lap_trinh, setup_to_hop, ghi_chu)
values
  ('2026-07', 'ban_hang', date '2026-07-01', 580, null, 1.00,
   2000000, 2000000, 2000000, 0.03, 0.01, 0.01, 7000000000,
   75000, 0.3, 3, 15, 300000, 200000,
   '[TẠM — suy từ áng chừng CEO tháng 7/2026, chưa phải số đo]')
on conflict (ma_ky) do nothing;

grant select, insert, update on kho.tham_so_tai_chinh to authenticated;
revoke all on kho.tham_so_tai_chinh from anon;
alter table kho.tham_so_tai_chinh enable row level security;
drop policy if exists tstc_doc  on kho.tham_so_tai_chinh;
drop policy if exists tstc_sua  on kho.tham_so_tai_chinh;
drop policy if exists tstc_them on kho.tham_so_tai_chinh;
create policy tstc_doc  on kho.tham_so_tai_chinh for select
  using (kho.current_vai_tro() = any(array['ceo','ke_toan']));
create policy tstc_sua  on kho.tham_so_tai_chinh for update
  using      (kho.current_vai_tro() = any(array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));
create policy tstc_them on kho.tham_so_tai_chinh for insert
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. GIÁ NIÊM YẾT theo kỳ — lưu CẢ tang_1 LẪN gia_le. PK kép. sale ĐỌC; ceo/ke_toan GHI.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.gia_niem_yet (
  ma_ky        text    not null,
  sku_mau      text    not null references kho.san_pham_mau(ma) on delete cascade,   -- SPEC sku_mau → DB ma
  tang_1       numeric not null check (tang_1 >= 0),      -- gv × he_so_m_ap_dung + ship (KHÔNG phi_don)
  gia_le       numeric not null check (gia_le >= 0),      -- giá cho ĐƠN 1 MÓN = (tang_1 + phi_don_le)/(1−Σhh)
  he_so_nhom   numeric not null default 1 check (he_so_nhom > 0),
  ngay_ap_dung date    not null,
  primary key (ma_ky, sku_mau)
);
grant select, insert, update on kho.gia_niem_yet to authenticated;
revoke all on kho.gia_niem_yet from anon;
alter table kho.gia_niem_yet enable row level security;
drop policy if exists gny_doc  on kho.gia_niem_yet;
drop policy if exists gny_sua  on kho.gia_niem_yet;
drop policy if exists gny_them on kho.gia_niem_yet;
create policy gny_doc  on kho.gia_niem_yet for select
  using (auth.uid() is not null);
create policy gny_sua  on kho.gia_niem_yet for update
  using      (kho.current_vai_tro() = any(array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));
create policy gny_them on kho.gia_niem_yet for insert
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. HÀM GIỜ THIẾT KẾ — sale gọi được để hiện GỢI Ý. CHỈ 3 số giờ, KHÔNG kèm tiền.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.gio_thiet_ke()
  returns table (gio_l1 numeric, gio_l2 numeric, gio_l3 numeric)
  language sql security definer set search_path = kho stable as $$
  select t.gio_l1, t.gio_l2, t.gio_l3
  from kho.tham_so_tai_chinh t
  order by t.ngay_ap_dung desc nulls last, t.ma_ky desc
  limit 1;
$$;
grant execute on function kho.gio_thiet_ke() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. HÀM TẦNG 1 theo MÓN: gv × [1 + (he_so_m−1) × he_so_nhom] + ship. KHÔNG phi_don.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.tang_1_mon(
    p_sku text, p_ship numeric default 0, p_he_so_nhom numeric default null)
  returns numeric language plpgsql security definer set search_path = kho stable as $$
declare v_gv numeric; v_m numeric; v_nhom numeric;
begin
  if auth.uid() is null then raise exception 'tang_1_mon: cần đăng nhập'; end if;
  select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = p_sku;
  if v_gv is null then raise exception 'tang_1_mon: chưa có giá vốn cho món "%"', p_sku; end if;
  select t.he_so_m, t.he_so_nhom into v_m, v_nhom
    from kho.tham_so_tai_chinh t order by t.ngay_ap_dung desc nulls last, t.ma_ky desc limit 1;
  if v_m is null then raise exception 'tang_1_mon: he_so_m chưa tính — chạy kho.tinh_he_so_m() trước'; end if;
  v_nhom := coalesce(p_he_so_nhom, v_nhom, 1);
  return round(v_gv * (1 + (v_m - 1) * v_nhom) + coalesce(p_ship, 0));
end $$;
grant execute on function kho.tang_1_mon(text, numeric, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. HÀM GIÁ SÀN theo ĐƠN: (Σ tang_1 + phi_don_<dòng>) ÷ (1 − Σhh). phi_don ĐÚNG MỘT lần/đơn.
--    p_dong ∈ 'le' | 'combo' | 'du_an'(thiết kế) → chọn phi_don tương ứng (SỬA 2).
--    Σhh = hh_sale + hh_quan_ly + hh_thiet_ke (SỬA 3).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.gia_san_don(p_mon jsonb, p_dong text default 'le')
  returns numeric language plpgsql security definer set search_path = kho stable as $$
declare
  v_m numeric; v_hh numeric; v_nhom_default numeric; v_phi numeric;
  t record;
  v_sum numeric := 0; it jsonb; v_gv numeric; v_nhom numeric; v_ship numeric;
begin
  if auth.uid() is null then raise exception 'gia_san_don: cần đăng nhập'; end if;
  select * into t from kho.tham_so_tai_chinh
    order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  if t.he_so_m is null then raise exception 'gia_san_don: he_so_m chưa tính — chạy kho.tinh_he_so_m() trước'; end if;
  v_m := t.he_so_m; v_nhom_default := t.he_so_nhom;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong
             when 'combo'   then t.phi_don_combo
             when 'du_an'   then t.phi_don_thiet_ke
             when 'thiet_ke' then t.phi_don_thiet_ke
             else t.phi_don_le
           end;
  for it in select value from jsonb_array_elements(p_mon) loop
    select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = (it->>'sku');
    if v_gv is null then raise exception 'gia_san_don: chưa có giá vốn cho "%"', it->>'sku'; end if;
    v_ship := coalesce((it->>'ship')::numeric, 0);
    v_nhom := coalesce((it->>'he_so_nhom')::numeric, v_nhom_default, 1);
    v_sum := v_sum + v_gv * (1 + (v_m - 1) * v_nhom) + v_ship;   -- Σ TẦNG 1
  end loop;
  return round((v_sum + v_phi) / (1 - v_hh));                    -- + phi_don_<dòng> MỘT lần ; ÷ (1 − Σhh)
end $$;
grant execute on function kho.gia_san_don(jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. HÀM HIỆU CHỈNH he_so_m theo SẢN LƯỢNG KẾ HOẠCH (SỬA 1).
--    he_so_m = (dt_muc_tieu×(1−Σhh) − Σship_KH − Σphi_KH) ÷ Σgcg_KH
--      Σgcg_KH  = gcg_TB_đơn  × so_don_ke_hoach      (gcg_TB = avg gia_chuyen_giao đơn ĐÓNG DẤU kỳ)
--      Σship_KH = ship_TB_đơn × so_don_ke_hoach      (ship_TB = avg ship_thuc_tra đơn ĐÓNG DẤU kỳ)
--      Σphi_KH  = phi_don_le  × so_don_ke_hoach      -- [GIẢ ĐỊNH] dùng phi_don_le làm đại diện (dòng chủ đạo);
--                                                       khi 3 phí khác nhau cần trọng số theo mix dòng.
--    THIẾU đầu vào → RAISE NOTICE (báo thiếu gì) + trả NULL, KHÔNG đoán. CHỈ ceo/ke_toan.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql security definer set search_path = kho stable as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if kho.current_vai_tro() not in ('ceo','ke_toan') then
    raise exception 'tinh_he_so_m: chỉ ceo/ke_toan';
  end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);

  -- TB/đơn từ đơn ĐÓNG DẤU kỳ này (đơn vị kinh tế — ổn định), rồi × sản lượng KẾ HOẠCH
  select avg(g.gia_chuyen_giao) into v_gcg_tb
    from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky;
  select avg(d.ship_thuc_tra) into v_ship_tb
    from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky;

  if t.dt_muc_tieu     is null then v_thieu := v_thieu || 'dt_muc_tieu, '; end if;
  if t.so_don_ke_hoach is null or t.so_don_ke_hoach = 0 then v_thieu := v_thieu || 'so_don_ke_hoach, '; end if;
  if t.phi_don_le      is null then v_thieu := v_thieu || 'phi_don_le, '; end if;
  if v_gcg_tb is null then v_thieu := v_thieu || 'đơn có gia_chuyen_giao đóng dấu kỳ (gcg_TB rỗng), '; end if;
  if v_thieu <> '' then
    raise notice 'tinh_he_so_m(%): THIẾU %', p_ma_ky, rtrim(v_thieu, ', ');
    return null;                                                 -- KHÔNG đoán số
  end if;

  v_sum_gcg  := v_gcg_tb              * t.so_don_ke_hoach;
  v_sum_ship := coalesce(v_ship_tb,0) * t.so_don_ke_hoach;
  v_sum_phi  := t.phi_don_le          * t.so_don_ke_hoach;
  return (t.dt_muc_tieu * (1 - v_hh) - v_sum_ship - v_sum_phi) / v_sum_gcg;
end $$;
grant execute on function kho.tinh_he_so_m(text) to authenticated;

commit;
