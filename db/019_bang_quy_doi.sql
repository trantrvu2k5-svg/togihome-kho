-- 019 — BẢNG QUY ĐỔI mô tả thiết kế (plugin) ↔ mã kho. BẢNG ĐỘC LẬP: chỉ TRỎ tới vat_tu(ma),
--   KHÔNG sửa/không chứa dữ liệu kho. CẤM lưu giá vốn kho vào đây — giá đọc động lúc xuất.
--   Idempotent: create table/index if not exists, drop policy if exists. Chạy lại nhiều lần được.
--   node ops/run_sql.mjs ../db/019_bang_quy_doi.sql
begin;

create table if not exists kho.quy_doi (
  id             uuid primary key default gen_random_uuid(),
  mo_ta_thiet_ke text not null,                    -- khoá thiết kế: chữ thường không dấu (ban_le_phu_toan, van_mdf_17_5)
  ten_mo_ta      text not null,                    -- mô tả kỹ thuật đầy đủ cho người đọc
  ma_plugin      text not null,                    -- mã bên plugin
  dvt_plugin     text,                             -- đơn vị plugin (đối chiếu)
  gia_plugin     numeric,                          -- giá plugin đang dùng (đối chiếu)
  nhom_dinh_muc  text check (nhom_dinh_muc in ('A','B','C')),   -- A hình học · B mét/m² · C khách chọn
  ma_kho         text references kho.vat_tu(ma),   -- TRỎ vat_tu.ma (unique). NULL = chưa ghép được
  he_so_quy_doi  numeric not null default 1 check (he_so_quy_doi > 0),  -- 1 đơn vị kho = ? đơn vị plugin
  muc_tin_cay    text not null default 'CHUA_RO' check (muc_tin_cay in ('CHAC','NGO','CHUA_RO')),
  la_mac_dinh    boolean not null default false,
  trang_thai     text not null default 'CHUA_DUYET' check (trang_thai in ('CHUA_DUYET','DA_DUYET','KHONG_GHEP')),
  ghi_chu        text,
  nguoi_duyet    uuid references kho.nguoi_dung(id),
  duyet_luc      timestamptz,
  tao_luc        timestamptz not null default now(),
  sua_luc        timestamptz,
  -- DA_DUYET bắt buộc có ma_kho
  constraint quy_doi_daduyet_co_makho check (trang_thai <> 'DA_DUYET' or ma_kho is not null),
  -- KHONG_GHEP bắt buộc ma_kho NULL + có ghi_chu
  constraint quy_doi_khongghep_null  check (trang_thai <> 'KHONG_GHEP'
                                            or (ma_kho is null and ghi_chu is not null and btrim(ghi_chu) <> ''))
);

-- TỐI ĐA MỘT dòng la_mac_dinh=true / mỗi mo_ta_thiet_ke (chỉ mục duy nhất MỘT PHẦN)
create unique index if not exists quy_doi_mot_mac_dinh
  on kho.quy_doi (mo_ta_thiet_ke) where la_mac_dinh;

-- Khoá idempotent cho công cụ nạp: (mô tả, mã kho) — NULL coi là TRÙNG nhau (nulls not distinct, PG15+)
--   -> mỗi mô tả chỉ 1 dòng ma_kho NULL; nạp lại on conflict do nothing, không nhân dòng.
create unique index if not exists quy_doi_key
  on kho.quy_doi (mo_ta_thiet_ke, ma_kho) nulls not distinct;

-- RLS: đọc + ghi CHỈ ceo/kho (theo style bảng khác trong schema: FOR ALL).
alter table kho.quy_doi enable row level security;
drop policy if exists quy_doi_ceo_kho on kho.quy_doi;
create policy quy_doi_ceo_kho on kho.quy_doi for all
  using (kho.current_vai_tro() in ('ceo','kho'))
  with check (kho.current_vai_tro() in ('ceo','kho'));

-- Quyền: bảng KHÔNG có cột nhạy cảm (không chứa giá vốn) -> cấp theo BẢNG (không theo cột) cho authenticated;
--   RLS lọc còn ceo/kho. anon KHÔNG cấp.
grant select, insert, update, delete on kho.quy_doi to authenticated;

commit;
