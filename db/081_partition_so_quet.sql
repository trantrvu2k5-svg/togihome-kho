-- db/081 — PARTITION su_kien_quet theo THÁNG + index L-25 (L-26, GẤP)
-- Bối cảnh: L-25 đo su_kien_quet → 345 tr dòng/3 năm ở quy mô đích. Bảng ĐANG RỖNG → đổi bây giờ vài phút;
--   có đơn thật rồi thì phải dừng hệ di trú. Range partition theo cột `luc`.
-- GIỮ NGUYÊN: force RLS · chỉ INSERT+SELECT · không ai UPDATE/DELETE (kể cả ceo). Khoá chính gồm cột phân mảnh.
-- THUẦN DB. ⚠ KHÔNG idempotent hoàn toàn (drop+create bảng) — chạy MỘT LẦN khi bảng rỗng.
begin;

-- sq_luc nhận TYPE kho.su_kien_quet → drop trước khi drop bảng, tạo lại sau (bảng phân mảnh vẫn có rowtype).
drop function if exists kho.sq_luc(kho.su_kien_quet);
drop table if exists kho.su_kien_quet;    -- RỖNG (0 dòng) — an toàn

-- ─────────── bảng CHA phân mảnh theo range(luc) ───────────
create table kho.su_kien_quet (
  id          uuid not null default gen_random_uuid(),
  tem_ma      text not null,
  ma_tram     text not null references kho.tram(ma_tram),
  nguoi_id    uuid references kho.nguoi_dung(id),
  luc         timestamptz not null default now(),
  loai        text not null check (loai in ('vao','ra')),
  ket_qua     text not null check (ket_qua in ('nhan','chan')),
  ly_do_chan  text,
  nguon       text not null default 'quet' check (nguon in ('quet','tay')),
  ghi_bu_cho  timestamptz,
  so_hong     numeric not null default 0 check (so_hong >= 0),
  so_lam_lai  numeric not null default 0 check (so_lam_lai >= 0),
  primary key (id, luc)                    -- khoá chính GỒM cột phân mảnh (id vẫn duy nhất: uuid ngẫu nhiên)
) partition by range (luc);

create index idx_sq_tem  on kho.su_kien_quet (tem_ma, luc);
create index idx_sq_tram on kho.su_kien_quet (ma_tram, luc);

-- ─────────── RLS: force + chỉ INSERT/SELECT (KHÔNG update/delete → mọi vai bị chặn sửa/xoá) ───────────
alter table kho.su_kien_quet enable row level security;
alter table kho.su_kien_quet force  row level security;
create policy sq_insert on kho.su_kien_quet for insert with check (kho.current_vai_tro() is not null);
create policy sq_select on kho.su_kien_quet for select using      (kho.current_vai_tro() is not null);
grant select, insert on kho.su_kien_quet to authenticated;

-- ─────────── hàm thêm phân mảnh tháng (chạy MỖI NĂM thêm 12 tháng — xem docs/so_no.md) ───────────
create or replace function kho.tao_phan_manh_thang(p_nam int, p_thang int)
  returns text language plpgsql security definer set search_path = kho as $$
declare v_from date; v_to date; v_name text;
begin
  v_from := make_date(p_nam, p_thang, 1);
  v_to   := (v_from + interval '1 month')::date;
  v_name := format('su_kien_quet_%s_%s', p_nam, lpad(p_thang::text, 2, '0'));
  execute format('create table if not exists kho.%I partition of kho.su_kien_quet for values from (%L) to (%L)',
                 v_name, v_from, v_to);
  return v_name;
end $$;

-- tạo phân mảnh THÁNG HIỆN TẠI (2026-08) → hết 2027-12 (17 tháng)
do $$ declare d date := date '2026-08-01';
begin while d <= date '2027-12-01' loop
  perform kho.tao_phan_manh_thang(extract(year from d)::int, extract(month from d)::int);
  d := (d + interval '1 month')::date;
end loop; end $$;

-- phân mảnh DEFAULT: dòng ngoài khoảng KHÔNG bị từ chối im lặng (rơi vào đây, chậm dần — cảnh báo ở docs/so_no.md)
create table kho.su_kien_quet_default partition of kho.su_kien_quet default;

-- ─────────── tạo lại sq_luc (luc hiệu lực) ───────────
create or replace function kho.sq_luc(s kho.su_kien_quet) returns timestamptz
  language sql immutable as $$ select coalesce(s.ghi_bu_cho, s.luc); $$;

-- ─────────── VIỆC 2: index L-25 (idx_sq_tram ĐÃ = (ma_tram,luc); chỉ thêm 2 index tem_ban_ve) ───────────
create index if not exists idx_tem_mon   on kho.tem_ban_ve (mon_id);
create index if not exists idx_tem_matam on kho.tem_ban_ve (ma_tam);

commit;
