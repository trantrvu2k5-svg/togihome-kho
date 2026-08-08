-- HOÀN TÁC 015 — gỡ mọi thứ lô huỷ-phiếu thêm vào, đưa DB về đúng trạng thái trước 015.
-- Phao cứu sinh. Chạy lại nhiều lần được. KHÔNG xoá dòng dữ liệu nào.
--   node ops/run_sql.mjs ../db/015_hoan_tac.sql   (hoặc Supabase SQL Editor)
-- (Giả định: chưa có phiếu nào ở trạng thái 'da_huy' khi hoàn tác — đúng vì migration + test đều không để lại da_huy.)
begin;

drop function if exists kho.huy_phieu(text, text);

alter table kho.lo_nhap drop column if exists lo_da_huy;   -- gỡ cột (kèm mọi grant trên cột)

-- trả ràng buộc trang_thai về (nhap, ghi_so)
alter table kho.phieu drop constraint if exists phieu_trang_thai_check;
alter table kho.phieu add  constraint phieu_trang_thai_check check (trang_thai in ('nhap','ghi_so'));

commit;
