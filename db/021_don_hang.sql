-- 021 — SỔ ĐƠN HÀNG kho.don_hang (xương sống nối Sales · Thiết kế · Kho · Xưởng · Kế toán).
--   Theo KIENTRUC_tong_the.md §4.1 (8 nhóm cột). Idempotent (IF NOT EXISTS / drop-recreate policy)
--   -> chạy lại KHÔNG nhân bảng, KHÔNG nhân policy. KHÔNG đụng dữ liệu kho khác.
--   node ops/run_sql.mjs ../db/021_don_hang.sql   ·   gỡ: 021_hoan_tac.sql
--
-- GIẤU GIÁ VỐN KHỎI SALE (VIỆC 5): mọi vai trò (ceo/kho/tho/sale) đều là DB-role `authenticated`,
--   nên GRANT theo cột KHÔNG tách được sale khỏi ceo. RLS là ROW-level, không giấu được CỘT.
--   => Tách 5 cột giá vốn (khoi_1/2/3, gia_chuyen_giao, hash_ky) sang bảng RIÊNG kho.don_hang_gia_von,
--      RLS chỉ ceo/kho đọc/ghi. Sale không có policy trên bảng đó -> 0 dòng -> không thể thấy/ghi giá vốn.
--   LỢI: RLS thật sự chặn (không lộ qua SELECT cột); đúng mô hình Postgres. HẠI: 1:1 hai bảng, đọc gộp
--        phải JOIN theo ma_don (Engine ghi giá vốn vào bảng phụ). Chấp nhận: đúng yêu cầu bảo mật > tiện.
begin;

-- ══════════ VIỆC 2 — mở giá trị vai_tro 'sale' (CHƯA tạo tài khoản nào) ══════════
--   current_vai_tro() KHÔNG cần đổi (nó chỉ đọc cột vai_tro, không liệt kê giá trị).
--   Policy các bảng cũ liệt kê ('ceo','kho'[,'tho']) -> 'sale' không nằm trong -> sale KHÔNG chạm
--   bảng kho cũ (đúng ý). Thêm giá trị vào CHECK không phá policy/hàm nào.
alter table kho.nguoi_dung drop constraint if exists nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add  constraint nguoi_dung_vai_tro_check
  check (vai_tro = any (array['ceo'::text, 'kho'::text, 'tho'::text, 'sale'::text]));

-- ══════════ VIỆC 3 — bảng don_hang (KHÔNG chứa 5 cột giá vốn; xem bảng phụ) ══════════
create table if not exists kho.don_hang (
  id             uuid primary key default gen_random_uuid(),

  -- ① Nhận diện
  ma_don         text not null unique,
  ngay_chot      date,
  sdt_khach      text,
  ten_khach      text,
  dia_chi_khach  text,

  -- ② Phân loại
  dong           text    check (dong in ('le','combo','du_an')),
  so_mon         integer check (so_mon is null or so_mon >= 0),
  khach_moi      boolean,                              -- cho phép NULL (chưa suy được mới/cũ)
  cap_thiet_ke   text    check (cap_thiet_ke in
                    ('co_file_san','thiet_ke_rieng','toan_mon_co_san','co_mon_dung_moi','full_can','bao_hanh','cat_lai')),

  -- ③ Tiền bán  (mọi cột tiền: NULL được, nhưng có thì phải >= 0)
  gia_goc        numeric check (gia_goc    is null or gia_goc    >= 0),
  chiet_khau     numeric check (chiet_khau is null or chiet_khau >= 0),
  doanh_thu      numeric check (doanh_thu  is null or doanh_thu  >= 0),
  ma_ky_ap_dung  text,

  -- ④ Thiết kế
  gio_thiet_ke        numeric check (gio_thiet_ke       is null or gio_thiet_ke       >= 0),
  so_to_hop_vat_lieu  integer check (so_to_hop_vat_lieu is null or so_to_hop_vat_lieu >= 0),

  -- ⑤ Giá vốn: TÁCH sang kho.don_hang_gia_von (VIỆC 5) — KHÔNG để ở đây.

  -- ⑥ Sản xuất
  trang_thai     text not null default 'moi_len_don'
                 check (trang_thai in
                   ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat',
                    'da_cat','dang_lam','xong_sx','cho_giao','da_giao','tam_ngung','huy')),
  ngay_vao_chuyen date,
  ngay_xong       date,

  -- ⑦ Giao hàng
  khoi_luong_kg     numeric check (khoi_luong_kg  is null or khoi_luong_kg  >= 0),
  dia_ban           text    check (dia_ban in ('noi_thanh','tinh')),
  don_vi_van_chuyen text,
  ship_thuc_tra     numeric check (ship_thuc_tra  is null or ship_thuc_tra  >= 0),
  lap_thuc_tra      numeric check (lap_thuc_tra   is null or lap_thuc_tra   >= 0),

  -- ⑧ Thu tiền
  ngay_thu          date,
  so_tien_thuc_thu  numeric check (so_tien_thuc_thu is null or so_tien_thuc_thu >= 0),

  -- Thêm
  thuong_hieu    text,
  tk_coc         numeric check (tk_coc is null or tk_coc >= 0),
  nguoi_tao      uuid references kho.nguoi_dung(id),
  tao_luc        timestamptz not null default now(),
  sua_luc        timestamptz,
  ly_do_huy      text,

  -- Ràng buộc nghiệp vụ
  --   doanh_thu = gia_goc - chiet_khau: dùng CHECK (không GENERATED) vì THIẾT KẾ ghi 'doanh_thu' do
  --   Sales nhập tay; cột GENERATED sẽ CẤM Sales ghi cột này. CHECK là NULL-tolerant: đơn mới thiếu
  --   số -> qua; đủ 3 số mà lệch -> chặn.
  constraint chk_doanh_thu check (doanh_thu = gia_goc - chiet_khau),
  --   huy / tam_ngung bắt buộc có lý do.
  constraint chk_huy_ly_do check (
    trang_thai not in ('huy','tam_ngung') or (ly_do_huy is not null and btrim(ly_do_huy) <> ''))
);

-- ══════════ VIỆC 5 — 5 cột GIÁ VỐN tách riêng (chỉ ceo/kho) ══════════
create table if not exists kho.don_hang_gia_von (
  ma_don          text primary key references kho.don_hang(ma_don) on delete cascade,
  khoi_1          numeric check (khoi_1          is null or khoi_1          >= 0),
  khoi_2          numeric check (khoi_2          is null or khoi_2          >= 0),
  khoi_3          numeric check (khoi_3          is null or khoi_3          >= 0),
  gia_chuyen_giao numeric check (gia_chuyen_giao is null or gia_chuyen_giao >= 0),
  hash_ky         text,
  cap_nhat_luc    timestamptz not null default now()
);

-- Chỉ mục (VIỆC 3)
create index if not exists idx_don_hang_sdt        on kho.don_hang (sdt_khach);
create index if not exists idx_don_hang_ngay_chot  on kho.don_hang (ngay_chot);
create index if not exists idx_don_hang_trang_thai on kho.don_hang (trang_thai);
create index if not exists idx_don_hang_dong       on kho.don_hang (dong);

-- ══════════ VIỆC 4 — cột nối sang kho.phieu ══════════
--   phieu cấp SELECT theo BẢNG (attacl rỗng) -> cột mới tự thuộc grant bảng, KHÔNG cấp cột thêm.
alter table kho.phieu add column if not exists ma_don text;
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'phieu_ma_don_fkey' and conrelid = 'kho.phieu'::regclass) then
    alter table kho.phieu add constraint phieu_ma_don_fkey
      foreign key (ma_don) references kho.don_hang (ma_don);
  end if;
end $$;

-- ══════════ GRANT (theo BẢNG như kho khác; anon KHÔNG cấp gì — VIỆC 5) ══════════
grant select, insert, update on kho.don_hang         to authenticated;
grant select, insert, update on kho.don_hang_gia_von to authenticated;
-- Schema kho có ALTER DEFAULT PRIVILEGES cấp anon SELECT cho MỌI bảng mới (005_grant_kho).
--   VIỆC 5 CẤM anon mọi quyền trên hai bảng này -> REVOKE tường minh (RLS đã chặn, đây là chốt cứng).
revoke all on kho.don_hang         from anon;
revoke all on kho.don_hang_gia_von from anon;

-- ══════════ VIỆC 5 — RLS ══════════
alter table kho.don_hang         enable row level security;
alter table kho.don_hang_gia_von enable row level security;

-- don_hang: đọc/ghi ceo·kho·sale. anon/NULL/tho: không policy -> 0 dòng.
drop policy if exists dh_doc  on kho.don_hang;
drop policy if exists dh_them on kho.don_hang;
drop policy if exists dh_sua  on kho.don_hang;
create policy dh_doc  on kho.don_hang for select
  using (kho.current_vai_tro() = any (array['ceo','kho','sale']));
create policy dh_them on kho.don_hang for insert
  with check (kho.current_vai_tro() = any (array['ceo','kho','sale']));
create policy dh_sua  on kho.don_hang for update
  using      (kho.current_vai_tro() = any (array['ceo','kho','sale']))
  with check (kho.current_vai_tro() = any (array['ceo','kho','sale']));

-- don_hang_gia_von: CHỈ ceo·kho. sale không có policy -> giá vốn ẩn hoàn toàn khỏi sale.
drop policy if exists dhgv_doc  on kho.don_hang_gia_von;
drop policy if exists dhgv_them on kho.don_hang_gia_von;
drop policy if exists dhgv_sua  on kho.don_hang_gia_von;
create policy dhgv_doc  on kho.don_hang_gia_von for select
  using (kho.current_vai_tro() = any (array['ceo','kho']));
create policy dhgv_them on kho.don_hang_gia_von for insert
  with check (kho.current_vai_tro() = any (array['ceo','kho']));
create policy dhgv_sua  on kho.don_hang_gia_von for update
  using      (kho.current_vai_tro() = any (array['ceo','kho']))
  with check (kho.current_vai_tro() = any (array['ceo','kho']));

commit;
