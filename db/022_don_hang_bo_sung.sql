-- 022 — BỔ SUNG don_hang cho khớp giao diện lên đơn (web/public/togihome_sale.html).
--   Idempotent (IF NOT EXISTS / drop-recreate constraint+policy) -> chạy lại KHÔNG nhân cột/policy.
--   Bảng don_hang RỖNG nên đổi kiểu an toàn. Trạng thái GIỮ 12 giá trị của bảng (CEO chốt).
--   node ops/run_sql.mjs ../db/022_don_hang_bo_sung.sql   ·   gỡ: 022_hoan_tac.sql
begin;

-- ══════════ VIỆC 2 — tk_coc = MÃ TÀI KHOẢN nhận cọc (text) + tien_coc riêng (số tiền) ══════════
--   File: tkCoc là MÃ (hkd_huan/hkd_vu/hkd_khanh/hkd_thuan/cty) quyết pháp nhân xuất hoá đơn — KHÔNG phải tiền.
alter table kho.don_hang drop constraint if exists don_hang_tk_coc_check;   -- check numeric cũ (lô 021)
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema='kho' and table_name='don_hang' and column_name='tk_coc') <> 'text' then
    alter table kho.don_hang alter column tk_coc type text using tk_coc::text;   -- 0 dòng -> an toàn
  end if;
end $$;
alter table kho.don_hang drop constraint if exists chk_tk_coc;
alter table kho.don_hang add  constraint chk_tk_coc
  check (tk_coc is null or tk_coc in ('hkd_huan','hkd_vu','hkd_khanh','hkd_thuan','cty'));

alter table kho.don_hang add column if not exists tien_coc numeric;   -- SỐ TIỀN cọc (tách khỏi tk_coc)
alter table kho.don_hang drop constraint if exists chk_tien_coc;
alter table kho.don_hang add  constraint chk_tien_coc check (tien_coc is null or tien_coc >= 0);

-- ══════════ VIỆC 3 — cột còn thiếu (khớp trường file) ══════════
--   kgs = text[]: danh sách MÃ nhóm phòng đồng nhất -> mảng gọn, truy vấn @>/= ANY + GIN được (hơn jsonb cho mảng chuỗi thuần).
--   hoa_don = jsonb: nhóm 4 trường VAT (ten/mst/dc/em) TUỲ CHỌN + thưa (chỉ đơn hoá đơn công ty), kho không lọc theo trường con -> 1 cột jsonb gọn hơn 4 cột thưa.
--   tinh_khach: file có khach.tinh (tỉnh/thành) quyết dia_ban + lắp được không — chưa có chỗ lưu, thêm nốt.
alter table kho.don_hang
  add column if not exists loai         text,
  add column if not exists link         text,
  add column if not exists lap_ai       text,
  add column if not exists file_tk      text,
  add column if not exists nguoi_tk     text,
  add column if not exists lo           text,
  add column if not exists ghi_chu      text,
  add column if not exists ngay_du_kien date,
  add column if not exists ngay_di_hang date,
  add column if not exists ngay_giao    date,
  add column if not exists kgs          text[],
  add column if not exists hoa_don      jsonb,
  add column if not exists tinh_khach   text;
alter table kho.don_hang drop constraint if exists chk_loai;
alter table kho.don_hang add  constraint chk_loai
  check (loai is null or loai in ('le_sang','le_rieng','combo','combo_moi','full_can','bao_hanh','cat_lai'));

-- ══════════ VIỆC 4 — bảng MÓN (ct trong file). gia = giá BÁN (sale xem được, KHÔNG phải giá vốn) ══════════
create table if not exists kho.don_hang_mon (
  id       uuid primary key default gen_random_uuid(),
  don_id   uuid not null references kho.don_hang(id) on delete cascade,   -- xoá đơn -> xoá món theo
  sp_id    text,                                   -- mã sản phẩm mẫu (SP0) nếu lấy từ danh mục
  ten      text,
  vl       text,                                   -- mã vật liệu
  kt       text,                                   -- kích thước
  so_luong numeric not null default 1 check (so_luong >= 0),
  gia      numeric check (gia is null or gia >= 0),
  tho      text,
  ma_mau   text,
  chi_tiet text,
  dung_moi boolean,                                -- cờ dựng mới (chưa từng làm)
  anh      jsonb not null default '[]'::jsonb,     -- danh sách ảnh
  tao_luc  timestamptz not null default now()
);
create index if not exists idx_don_hang_mon_don on kho.don_hang_mon(don_id);

-- ══════════ VIỆC 5 — bảng NHẬT KÝ trạng thái (ls trong file). CHỈ THÊM (append-only) ══════════
--   den/tu dùng ĐÚNG 12 trạng thái của don_hang. Append-only: chỉ cấp SELECT+INSERT, không UPDATE/DELETE.
create table if not exists kho.don_hang_nhat_ky (
  id       uuid primary key default gen_random_uuid(),
  don_id   uuid not null references kho.don_hang(id) on delete cascade,
  tu       text check (tu is null or tu in
             ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
              'dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy')),
  den      text not null check (den in
             ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
              'dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy')),
  nguoi_id uuid references kho.nguoi_dung(id),
  luc      timestamptz not null default now(),
  ly_do    text,
  constraint chk_nk_huy_ly_do check (
    den not in ('huy','tam_ngung') or (ly_do is not null and btrim(ly_do) <> ''))
);
create index if not exists idx_don_hang_nk_don on kho.don_hang_nhat_ky(don_id);

-- ══════════ GRANT (theo bảng; anon KHÔNG cấp gì — gỡ default privilege của schema) ══════════
grant select, insert, update, delete on kho.don_hang_mon     to authenticated;
grant select, insert                 on kho.don_hang_nhat_ky to authenticated;  -- append-only: KHÔNG update/delete
revoke all on kho.don_hang_mon     from anon;
revoke all on kho.don_hang_nhat_ky from anon;

-- ══════════ VIỆC 6 — RLS (đọc/ghi ceo·kho·sale; món+nhật ký KHÔNG chứa giá vốn) ══════════
alter table kho.don_hang_mon     enable row level security;
alter table kho.don_hang_nhat_ky enable row level security;

drop policy if exists dhm_all on kho.don_hang_mon;
create policy dhm_all on kho.don_hang_mon for all
  using      (kho.current_vai_tro() = any (array['ceo','kho','sale']))
  with check (kho.current_vai_tro() = any (array['ceo','kho','sale']));

-- Nhật ký: chỉ đọc + thêm (không policy update/delete -> không ai sửa/xoá được, kể cả ceo qua API).
drop policy if exists dhnk_doc  on kho.don_hang_nhat_ky;
drop policy if exists dhnk_them on kho.don_hang_nhat_ky;
create policy dhnk_doc  on kho.don_hang_nhat_ky for select
  using (kho.current_vai_tro() = any (array['ceo','kho','sale']));
create policy dhnk_them on kho.don_hang_nhat_ky for insert
  with check (kho.current_vai_tro() = any (array['ceo','kho','sale']));

commit;
