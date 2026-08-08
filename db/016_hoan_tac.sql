-- HOÀN TÁC 016 — thu lại quyền đọc phieu_dong của authenticated (trả về trạng thái trước 016).
--   node ops/run_sql.mjs ../db/016_hoan_tac.sql
begin;
revoke select on kho.phieu_dong from authenticated;
commit;
