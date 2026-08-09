-- 029 — 3 khoá chặn deploy (tho · khong_gian · cfg) + VAT tầng cuối. GỘP dsvc. (Cụm ads để lô sau.)
--   node ops/run_sql.mjs ../db/029_cau_hinh_vat.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod; cần 027+028 trước)
--
-- Nội dung:
--   1. Bảng kho.tho (danh mục thợ) — seed từ THO0. sale ĐỌC, không ghi.
--   2. Bảng kho.khong_gian (seed từ KG0) + cột don_hang_mon.khong_gian. sale đọc danh mục, ghi cột trên món.
--   3. cfg → tham_so_tai_chinh theo ma_ky: vat, gio_mo_cua, ghi_de, ngưỡng (NGUONG0). GỘP dsvc → ship_du_toan.
--      sale ĐỌC vat + ngưỡng qua hàm cau_hinh_sale() (KHÔNG lộ cột tiền của 028).
--   4. VAT tầng CUỐI: gia_bao_khach() = gia_san_don() × (1 + vat/100). KHÔNG nhét vat vào gia_san_don/tinh_he_so_m.
--      LUẬT LƯU TRỮ: DB luôn lưu số CHƯA VAT; màn hình hiện số CÓ VAT (app ÷(1+vat) khi lưu). (app: BƯỚC 2)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.gia_bao_khach(jsonb, text);
--   drop function if exists kho.cau_hinh_sale();
--   drop function if exists kho.ship_du_toan_map();
--   drop function if exists kho.dat_ship_du_toan(text, text, numeric);
--   alter table kho.don_hang_mon drop column if exists khong_gian;
--   drop table if exists kho.khong_gian;
--   drop table if exists kho.tho;
--   alter table kho.tham_so_tai_chinh
--     drop column if exists vat, drop column if exists gio_mo_cua, drop column if exists ghi_de,
--     drop column if exists n_ads, drop column if exists n_cac, drop column if exists n_kg,
--     drop column if exists n_no, drop column if exists n_giam, drop column if exists ship_du_toan;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. DANH MỤC THỢ — seed THO0. sale ĐỌC, ceo/ke_toan GHI.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.tho (
  id       uuid primary key default gen_random_uuid(),
  ten      text not null unique,
  dang_lam boolean not null default true
);
insert into kho.tho(ten)
  select unnest(array['Kiên','Xòe','Tiến','Huy','Bình','Trường','Bái','Định'])
  on conflict (ten) do nothing;
grant select, insert, update on kho.tho to authenticated;
revoke all on kho.tho from anon;
alter table kho.tho enable row level security;
drop policy if exists tho_doc on kho.tho;  drop policy if exists tho_ghi on kho.tho;
create policy tho_doc on kho.tho for select using (auth.uid() is not null);         -- sale ĐỌC
create policy tho_ghi on kho.tho for all
  using      (kho.current_vai_tro() = any(array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. DANH MỤC KHÔNG GIAN + cột trên món. sale đọc danh mục; ghi khong_gian trên món.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.khong_gian (
  ma    text primary key,
  ten   text not null,
  ngung boolean not null default false
);
insert into kho.khong_gian(ma, ten) values
  ('phong_khach','Phòng khách'), ('phong_ngu','Phòng ngủ'), ('phong_bep','Phòng bếp'), ('van_phong','Văn phòng')
  on conflict (ma) do nothing;
grant select, insert, update on kho.khong_gian to authenticated;
revoke all on kho.khong_gian from anon;
alter table kho.khong_gian enable row level security;
drop policy if exists kg_doc on kho.khong_gian;  drop policy if exists kg_ghi on kho.khong_gian;
create policy kg_doc on kho.khong_gian for select using (auth.uid() is not null);
create policy kg_ghi on kho.khong_gian for all
  using      (kho.current_vai_tro() = any(array['ceo','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- cột trên món: mảng mã không gian (sale ghi được — RLS don_hang_mon hiện có đã cho sale ghi món)
alter table kho.don_hang_mon add column if not exists khong_gian jsonb not null default '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. cfg → tham_so_tai_chinh (theo ma_ky): vat, gio_mo_cua, ghi_de, ngưỡng (NGUONG0), ship_du_toan (dsvc).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table kho.tham_so_tai_chinh
  add column if not exists vat         numeric check (vat is null or (vat >= 0 and vat < 100)),  -- % (khớp cfg.vat)
  add column if not exists gio_mo_cua  jsonb   not null default '["01:00","13:00"]'::jsonb,
  add column if not exists ghi_de      integer not null default 7,
  add column if not exists n_ads       numeric,   -- ngưỡng: chi QC / doanh thu (%)
  add column if not exists n_cac       numeric,   -- ngưỡng: chi phí thu hút mỗi khách (đ)
  add column if not exists n_kg        numeric,   -- ngưỡng: kg / triệu doanh thu
  add column if not exists n_no        numeric,   -- ngưỡng: công nợ đã giao chưa thu (đ)
  add column if not exists n_giam      numeric,   -- ngưỡng: giảm giá / giá gốc (%)
  add column if not exists ship_du_toan jsonb not null default '{}'::jsonb;  -- GỘP dsvc: {dong: số} theo kỳ

-- seed giá trị hiện hành vào kỳ 2026-07 (vat + NGUONG0 từ togihome_sale.html)
update kho.tham_so_tai_chinh
  set vat = coalesce(vat, 10),
      n_ads = coalesce(n_ads, 22), n_cac = coalesce(n_cac, 1500000), n_kg = coalesce(n_kg, 16),
      n_no  = coalesce(n_no, 100000000), n_giam = coalesce(n_giam, 8)
  where ma_ky = '2026-07';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. HÀM CẤU HÌNH cho sale — CHỈ vat + giờ + ghi_de + ngưỡng. KHÔNG trả cột tiền (he_so_m/phi/dg_gio…).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.cau_hinh_sale()
  returns jsonb language sql security definer set search_path = kho stable as $$
  select jsonb_build_object(
    'vat', t.vat, 'gio_mo_cua', t.gio_mo_cua, 'ghi_de', t.ghi_de,
    'n_ads', t.n_ads, 'n_cac', t.n_cac, 'n_kg', t.n_kg, 'n_no', t.n_no, 'n_giam', t.n_giam)
  from kho.tham_so_tai_chinh t
  order by t.ngay_ap_dung desc nulls last, t.ma_ky desc
  limit 1;
$$;
grant execute on function kho.cau_hinh_sale() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. VAT tầng CUỐI: gia_bao_khach = gia_san_don × (1 + vat/100). KHÔNG đụng gia_san_don/tinh_he_so_m.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.gia_bao_khach(p_mon jsonb, p_dong text default 'le')
  returns numeric language plpgsql security definer set search_path = kho stable as $$
declare v_vat numeric; v_san numeric;
begin
  select vat into v_vat from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  if v_vat is null then raise exception 'gia_bao_khach: chưa nhập vat'; end if;
  v_san := kho.gia_san_don(p_mon, p_dong);        -- giá sàn CHƯA VAT
  return round(v_san * (1 + v_vat/100.0));         -- CÓ VAT — tầng ngoài cùng
end $$;
grant execute on function kho.gia_bao_khach(jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. dsvc (ship dự toán) — đọc phẳng {ma_ky|dong: số} cho app; ghi qua hàm (ceo/ke_toan).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function kho.ship_du_toan_map()
  returns jsonb language sql security definer set search_path = kho stable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select t.ma_ky || '|' || e.key as k, e.value as v
    from kho.tham_so_tai_chinh t, jsonb_each(t.ship_du_toan) e
  ) s;
$$;
grant execute on function kho.ship_du_toan_map() to authenticated;

create or replace function kho.dat_ship_du_toan(p_ma_ky text, p_dong text, p_val numeric)
  returns void language plpgsql security definer set search_path = kho as $$
begin
  if kho.current_vai_tro() not in ('ceo','ke_toan') then raise exception 'dat_ship_du_toan: chỉ ceo/ke_toan'; end if;
  update kho.tham_so_tai_chinh
    set ship_du_toan = ship_du_toan || jsonb_build_object(p_dong, p_val)
    where ma_ky = p_ma_ky;
end $$;
grant execute on function kho.dat_ship_du_toan(text, text, numeric) to authenticated;

commit;
