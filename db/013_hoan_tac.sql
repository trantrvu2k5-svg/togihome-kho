-- HOÀN TÁC 013 — xoá cột anh_file, đưa kho.vat_tu về đúng trạng thái trước khi thêm.
-- Phao cứu sinh. Chạy lại nhiều lần được. DROP COLUMN tự thu hồi mọi grant trên cột đó.
-- KHÔNG đụng cột anh_ma hay cột nào khác.
--   node ops/run_sql.mjs ../db/013_hoan_tac.sql   (hoặc Supabase SQL Editor)
begin;

alter table kho.vat_tu drop column if exists anh_file;

commit;
