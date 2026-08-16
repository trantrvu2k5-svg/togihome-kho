-- db/092 — CHỖ CHỨA cho form "Báo giá mới" v5 (L-53). Idempotent.
--   Ánh xạ trường form ↔ cột (đã soi don_hang 66 cột, DÙNG LẠI chỗ có nghĩa tương đương):
--     Thương hiệu→thuong_hieu · Loại→loai · Ngày hỏi giá→ngay_tao_bao_gia · SĐT/Tên/Tỉnh→sdt_khach/ten_khach/tinh_khach
--     Link tham khảo→link (đã có, ="Link sản phẩm") · Yêu cầu riêng→ghi_chu (đã có, trùng nghĩa)
--   THÊM 3 cột thật sự thiếu (không đẻ trùng):
alter table kho.don_hang add column if not exists phong_cach      text;
alter table kho.don_hang add column if not exists ngan_sach_trieu numeric check (ngan_sach_trieu is null or ngan_sach_trieu >= 0);
alter table kho.don_hang add column if not exists tu_dung         boolean not null default false;
comment on column kho.don_hang.tu_dung is 'Sale tự dựng bản 3D (không qua thiết kế). Đo cuối tháng: sale tự dựng chốt bao nhiêu %.';

do $$ begin raise notice 'db/092 OK: +phong_cach +ngan_sach_trieu +tu_dung (dùng lại link/ghi_chu/thuong_hieu/loai/ngay_tao_bao_gia/sdt_khach/ten_khach/tinh_khach)'; end $$;
