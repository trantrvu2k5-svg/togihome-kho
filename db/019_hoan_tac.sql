-- HOÀN TÁC 019 — xoá BẢNG ĐỘC LẬP kho.quy_doi + mọi index/policy/grant của nó.
--   Bảng này CHỈ trỏ tới mã kho, KHÔNG chứa dữ liệu kho -> xoá nó KHÔNG đụng vat_tu/ton/lo_nhap/phieu/giao_dich.
--   DROP TABLE ... CASCADE gỡ luôn unique index + RLS policy + quyền cấp trên bảng.
--   Chạy lại nhiều lần được.
--   node ops/run_sql.mjs ../db/019_hoan_tac.sql
begin;
drop table if exists kho.quy_doi cascade;
commit;
