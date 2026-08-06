-- KHO-1 — Schema hệ kho Togihome. Chạy TRONG Supabase SQL Editor (CEO duyệt trước).
-- Nguyên tắc: mọi bảng có id uuid · tao_luc/sua_luc · nguoi_thao_tac · RLS BẬT.
-- 3 tháng đầu: CHỈ GHI, không chặn (cai_dat.chan_ton_am=false). Tồn âm -> cảnh báo, vẫn ghi.
-- MỘT dự án Supabase, tách bằng SCHEMA: kho vào "kho" (sau: crm, erp) -> nối chung được.

create extension if not exists pgcrypto;
create schema if not exists kho;
set search_path = kho, public;   -- mọi create table/policy/function dưới đây VÀO schema kho

-- ── NGƯỜI DÙNG + vai trò ──────────────────────────────────────────────
create table nguoi_dung (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid unique,                       -- map Supabase Auth
  ho_ten text not null,
  vai_tro text not null check (vai_tro in ('ceo','kho','tho')),
  dang_hoat_dong boolean not null default true,
  tao_luc timestamptz not null default now(),
  sua_luc timestamptz
);

create or replace function current_vai_tro() returns text
  language sql stable security definer set search_path = kho, public as $$
  select vai_tro from nguoi_dung where auth_uid = auth.uid() and dang_hoat_dong limit 1 $$;

-- ── DANH MỤC ──────────────────────────────────────────────────────────
create table nhom (
  id uuid primary key default gen_random_uuid(),
  ten text not null unique,
  loai text not null default 'pk' check (loai in ('pk','van')),
  thu_tu int, tao_luc timestamptz not null default now(), sua_luc timestamptz,
  nguoi_thao_tac uuid references nguoi_dung(id)
);

create table kho (
  id uuid primary key default gen_random_uuid(),
  ten text not null unique, dia_chi text,
  la_mac_dinh boolean not null default false,
  tao_luc timestamptz not null default now(), sua_luc timestamptz,
  nguoi_thao_tac uuid references nguoi_dung(id)
);

create table nha_cung_cap (
  id uuid primary key default gen_random_uuid(),
  ten text not null, dien_thoai text, dia_chi text,
  lead_time_ngay int,          -- BẮT BUỘC cho gợi ý đặt mức 3
  moq_sl numeric,              -- số lượng đặt tối thiểu
  tao_luc timestamptz not null default now(), sua_luc timestamptz,
  nguoi_thao_tac uuid references nguoi_dung(id)
);

-- ── VẬT TƯ (mã dùng chung pk + ván) ───────────────────────────────────
create table vat_tu (
  id uuid primary key default gen_random_uuid(),
  ma text not null unique,
  ten text not null,
  loai text not null check (loai in ('pk','van')),   -- ('btp' để dành MTS sau)
  nhom_id uuid references nhom(id),
  dvt text,                    -- đơn vị tính (cái/bộ/túi/tấm…)
  so_moi_dvt numeric,          -- 1 đơn vị mua = mấy cái (pk)
  dvt_goc text,
  -- ── riêng VÁN (driver tính tiền) ──
  do_day_mm numeric,           -- NULL nếu không bóc được (CS-VER) -> can_kiem_tra
  vat_lieu text,               -- Gỗ MDF / cao su min / plywood…
  hoan_thien text,             -- '🅰 Chà→Sơn' | '🅱 Dán'  (driver: sơn PU vs dán cạnh)
  ma_van_ncc text,             -- mã vân nhà cung cấp (347PL, 4012…)
  anh_ma text,                 -- mã ảnh Google Drive (cột P)
  ton_toi_thieu numeric default 0,
  can_kiem_tra boolean not null default false,       -- cờ dữ liệu bẩn/giá nghi
  ghi_chu_co text[] default '{}',                    -- lý do gắn cờ
  tao_luc timestamptz not null default now(), sua_luc timestamptz,
  nguoi_thao_tac uuid references nguoi_dung(id)
);
create index on vat_tu(loai);
create index on vat_tu(nhom_id);

-- ── TỒN (mã × kho) + LÔ (giữ giá vốn từng lô) ─────────────────────────
create table ton (
  id uuid primary key default gen_random_uuid(),
  vat_tu_id uuid not null references vat_tu(id),
  kho_id uuid not null references kho(id),
  so_luong numeric not null default 0,
  gia_von_bq numeric,          -- bình quân gia quyền; NULL nếu chưa có giá (cấm 0)
  tao_luc timestamptz not null default now(), sua_luc timestamptz,
  unique (vat_tu_id, kho_id)
);

create table lo_nhap (
  id uuid primary key default gen_random_uuid(),
  vat_tu_id uuid not null references vat_tu(id),
  kho_id uuid not null references kho(id),
  phieu_id uuid,               -- lô mở đầu = null hoặc phiếu NK gốc
  so_luong_nhap numeric not null,
  gia_von_lo numeric,          -- NULL nếu chưa có giá
  con_lai numeric not null,
  ngay date not null default current_date,
  tao_luc timestamptz not null default now(),
  nguoi_thao_tac uuid references nguoi_dung(id)
);

-- ── CHỨNG TỪ (phiếu nhiều dòng, số tự sinh, nháp -> ghi sổ) ────────────
create table chuoi_so (
  loai text not null, nam int not null, so_hien_tai int not null default 0,
  primary key (loai, nam)
);
create or replace function cap_so_phieu(p_loai text) returns text
  language plpgsql set search_path = kho, public as $$
declare y int := extract(year from now()); n int;
begin
  insert into chuoi_so(loai,nam,so_hien_tai) values (p_loai,y,0)
    on conflict (loai,nam) do nothing;
  update chuoi_so set so_hien_tai = so_hien_tai + 1
    where loai=p_loai and nam=y returning so_hien_tai into n;
  return p_loai||'-'||y||'-'||lpad(n::text,4,'0');   -- NK-2026-0001
end $$;

create table phieu (
  id uuid primary key default gen_random_uuid(),
  so_phieu text not null unique,
  loai text not null check (loai in ('nhap','xuat','dieu_chinh')),
  kho_id uuid not null references kho(id),
  trang_thai text not null default 'nhap' check (trang_thai in ('nhap','ghi_so')),
  ncc_id uuid references nha_cung_cap(id),   -- phiếu nhập
  ly_do text,                                -- phiếu xuất
  phieu_goc_id uuid references phieu(id),     -- điều chỉnh trỏ phiếu bị sửa
  ghi_so_luc timestamptz, ghi_so_boi uuid references nguoi_dung(id),
  tao_luc timestamptz not null default now(), sua_luc timestamptz,
  nguoi_thao_tac uuid references nguoi_dung(id)
);

create table phieu_dong (
  id uuid primary key default gen_random_uuid(),
  phieu_id uuid not null references phieu(id) on delete cascade,
  vat_tu_id uuid not null references vat_tu(id),
  so_luong numeric not null,
  don_gia numeric,
  thanh_tien numeric,
  ncc_id uuid references nha_cung_cap(id),
  ly_do text,
  tao_luc timestamptz not null default now()
);

-- ── THẺ KHO (sổ cái — mỗi giao dịch 1 dòng, số dư sau) ─────────────────
create table giao_dich (
  id uuid primary key default gen_random_uuid(),
  vat_tu_id uuid not null references vat_tu(id),
  kho_id uuid not null references kho(id),
  loai text not null check (loai in ('nhap','xuat','lay','tra','dieu_chinh')),
  so_luong numeric not null,                 -- ± (nhập/tra dương, xuất/lay âm)
  phieu_id uuid references phieu(id),
  lo_nhap_id uuid references lo_nhap(id),
  so_du_sau numeric not null,
  nguon text not null default 'phieu' check (nguon in ('phieu','quet_tem')),
  canh_bao text,                             -- 'ton_am' khi ghi mà tồn < 0 (không chặn)
  nguoi_thao_tac uuid references nguoi_dung(id),
  tao_luc timestamptz not null default now()
);
create index on giao_dich(vat_tu_id, tao_luc);   -- thẻ kho

-- ── CẤU HÌNH ──────────────────────────────────────────────────────────
create table cai_dat (khoa text primary key, gia_tri jsonb not null,
  sua_luc timestamptz not null default now());
insert into cai_dat(khoa,gia_tri) values ('chan_ton_am','false'::jsonb);

-- ════ RLS — bật MỌI bảng, 3 vai trò ═══════════════════════════════════
alter table nguoi_dung   enable row level security;
alter table nhom         enable row level security;
alter table kho          enable row level security;
alter table nha_cung_cap enable row level security;
alter table vat_tu       enable row level security;
alter table ton          enable row level security;
alter table lo_nhap      enable row level security;
alter table phieu        enable row level security;
alter table phieu_dong   enable row level security;
alter table giao_dich    enable row level security;
alter table cai_dat      enable row level security;
alter table chuoi_so     enable row level security;

-- ĐỌC: mọi vai trò đăng nhập đọc danh mục + tồn + thẻ kho.
do $$ declare t text;
begin
  foreach t in array array['nhom','kho','nha_cung_cap','vat_tu','ton','lo_nhap',
                           'phieu','phieu_dong','giao_dich','cai_dat'] loop
    execute format('create policy "doc_dang_nhap" on %I for select using (auth.uid() is not null);', t);
  end loop;
end $$;

-- nguoi_dung: tự đọc mình; ceo đọc/sửa mọi.
create policy "tu_doc" on nguoi_dung for select using (auth_uid = auth.uid() or current_vai_tro()='ceo');
create policy "ceo_sua_nd" on nguoi_dung for all using (current_vai_tro()='ceo') with check (current_vai_tro()='ceo');

-- GHI danh mục + vật tư + tồn + lô: ceo | kho.
do $$ declare t text;
begin
  foreach t in array array['nhom','kho','nha_cung_cap','vat_tu','ton','lo_nhap','cai_dat','chuoi_so'] loop
    execute format($f$create policy "ghi_ceo_kho" on %I for all
      using (current_vai_tro() in ('ceo','kho')) with check (current_vai_tro() in ('ceo','kho'));$f$, t);
  end loop;
end $$;

-- PHIẾU: ceo|kho lập/sửa NHÁP; phiếu đã ghi sổ KHÔNG sửa (trừ ceo, để điều chỉnh hệ thống).
create policy "phieu_doc" on phieu for select using (auth.uid() is not null);
create policy "phieu_them" on phieu for insert with check (current_vai_tro() in ('ceo','kho'));
create policy "phieu_sua_nhap" on phieu for update
  using (current_vai_tro() in ('ceo','kho') and trang_thai='nhap')
  with check (current_vai_tro() in ('ceo','kho'));
create policy "phdong_ghi" on phieu_dong for all
  using (current_vai_tro() in ('ceo','kho')) with check (current_vai_tro() in ('ceo','kho'));

-- GIAO DỊCH: ceo|kho ghi mọi; THỢ chỉ tạo lay/tra qua quét tem.
create policy "gd_ceo_kho" on giao_dich for all
  using (current_vai_tro() in ('ceo','kho')) with check (current_vai_tro() in ('ceo','kho'));
create policy "gd_tho_quet" on giao_dich for insert
  with check (current_vai_tro()='tho' and nguon='quet_tem' and loai in ('lay','tra'));
