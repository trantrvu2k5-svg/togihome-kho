-- 265 — WP-91 L-91.2-6 D-06: gỡ VIEW compat DEPRECATED kho.quy_doi (pass-through plugin_ma_map, QD-53).
--   Đếm lại: 0 hàm DB đọc · 0 pg_depend · chỉ test_134 C12 (đã sửa đọc bảng thật). Nguồn thật = plugin_ma_map.
--   HOÀN TÁC: create view kho.quy_doi as select * from kho.plugin_ma_map (nếu cần lại).
begin;
drop view if exists kho.quy_doi;
commit;
