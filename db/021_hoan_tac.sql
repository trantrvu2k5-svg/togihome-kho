-- HOÀN TÁC 021 — gỡ SẠCH mọi thứ lô sổ đơn hàng thêm vào.
--   node ops/run_sql.mjs ../db/021_hoan_tac.sql
--   An toàn chạy nhiều lần (IF EXISTS). KHÔNG đụng dữ liệu kho khác (vat_tu/ton/phieu-dữ-liệu/quy_doi).
--   Thứ tự: cột phieu -> bảng giá vốn -> bảng đơn hàng -> trả ràng buộc vai_tro.
begin;

-- VIỆC 4 (gỡ): cột nối sang kho. Bỏ FK trước rồi bỏ cột. KHÔNG xoá dòng phiếu nào.
alter table kho.phieu drop constraint if exists phieu_ma_don_fkey;
alter table kho.phieu drop column     if exists ma_don;

-- VIỆC 3+5 (gỡ): bảng giá vốn (FK trỏ don_hang) trước, rồi bảng đơn hàng.
--   drop table tự gỡ RLS policy + index + grant của bảng đó.
drop table if exists kho.don_hang_gia_von;
drop table if exists kho.don_hang;

-- VIỆC 2 (gỡ): trả ràng buộc vai_tro về ceo/kho/tho (bỏ 'sale').
--   An toàn vì lô KHÔNG tạo tài khoản sale nào (không có dòng vai_tro='sale' cản re-add).
alter table kho.nguoi_dung drop constraint if exists nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add  constraint nguoi_dung_vai_tro_check
  check (vai_tro = any (array['ceo'::text, 'kho'::text, 'tho'::text]));

commit;
