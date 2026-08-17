-- db/105 — L-77 PHẦN 2: TẦNG DÒNG sản phẩm. Idempotent.
--   Bảng dong_san_pham (ma_dong 2-3 chữ · ten · thu_tu) + cột san_pham_loi.dong_id.
--   10 dòng đề xuất: đọc từ luật cấu tạo (togihome-plugin) + mô hình D2C nội thất (CEO chốt L-77).
-- ═════ HOÀN TÁC: alter table san_pham_loi drop column dong_id; drop table dong_san_pham; ═════
begin;

create table if not exists kho.dong_san_pham (
  ma_dong  text primary key,
  ten      text not null,
  thu_tu   int  not null default 0,
  tao_luc  timestamptz default now()
);

-- 10 dòng (idempotent — cập nhật tên/thứ tự nếu chạy lại)
insert into kho.dong_san_pham(ma_dong, ten, thu_tu) values
  ('TA','Tủ quần áo',1), ('GN','Giường ngủ',2), ('BLV','Bàn làm việc',3),
  ('HB','Hệ bàn',4),    ('BT','Bàn trà',5),    ('HK','Hộc kéo module',6),
  ('KE','Kệ',7),        ('TG','Tủ giày',8),    ('BA','Bàn ăn',9),
  ('TD','Tab đầu giường',10)
on conflict (ma_dong) do update set ten = excluded.ten, thu_tu = excluded.thu_tu;

-- lõi gắn dòng (nullable — 6 lõi thật hiện chưa gán, gán khi dựng bộ chuẩn)
alter table kho.san_pham_loi add column if not exists dong_id text references kho.dong_san_pham(ma_dong);
create index if not exists idx_spl_dong on kho.san_pham_loi(dong_id);

-- đọc: reference data, mọi vai đăng nhập xem được (RPC/app đọc để chọn dòng)
alter table kho.dong_san_pham enable row level security;
drop policy if exists dong_san_pham_doc on kho.dong_san_pham;
create policy dong_san_pham_doc on kho.dong_san_pham for select to authenticated using (true);
grant select on kho.dong_san_pham to authenticated;

do $$ declare v int; begin
  select count(*) into v from kho.dong_san_pham;
  if v < 10 then raise exception 'db/105: thiếu dòng (có %/10)', v; end if;
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='san_pham_loi' and column_name='dong_id') then
    raise exception 'db/105: THIẾU cột san_pham_loi.dong_id'; end if;
  raise notice 'db/105 OK: dong_san_pham (% dòng) + san_pham_loi.dong_id.', v;
end $$;
commit;
