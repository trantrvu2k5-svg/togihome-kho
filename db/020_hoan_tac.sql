-- HOÀN TÁC 020 — gỡ RPC quy_doi_export (anon hết đọc được bảng quy đổi qua web).
--   node ops/run_sql.mjs ../db/020_hoan_tac.sql
begin;
drop function if exists kho.quy_doi_export();
commit;
