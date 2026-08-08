-- HOÀN TÁC 023 — trả phân quyền về đúng trạng thái sau lô 022 (4 vai trò: ceo/kho/tho/sale).
--   node ops/run_sql.mjs ../db/023_hoan_tac.sql   ·   chạy nhiều lần an toàn (IF EXISTS).
--   KHÔNG đụng nguoi_dung.tu_doc / ceo_sua_nd. KHÔNG đụng bảng kho cũ. KHÔNG đổi dữ liệu kho.
begin;

-- LƯU Ý: nếu ĐÃ có tài khoản mang vai trò mới (thiet_ke/xuong/ke_toan) thì thu hẹp CHECK sẽ LỖI.
--   Xử lý: đổi các tài khoản đó về 'tho' (vai trò CŨ, ít quyền nhất) TRƯỚC khi thu hẹp ràng buộc.
--   (Lô 023 CHƯA tạo tài khoản mới nên bình thường đây là no-op.)
update kho.nguoi_dung set vai_tro = 'tho' where vai_tro in ('thiet_ke','xuong','ke_toan');

-- Trả policy 3 bảng đơn hàng về ceo/kho/sale.
drop policy if exists dh_doc on kho.don_hang;
drop policy if exists dh_sua on kho.don_hang;
create policy dh_doc on kho.don_hang for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale']));
create policy dh_sua on kho.don_hang for update
  using      (kho.current_vai_tro() = any(array['ceo','kho','sale']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale']));

drop policy if exists dhm_doc on kho.don_hang_mon;
drop policy if exists dhm_ghi on kho.don_hang_mon;
drop policy if exists dhm_all on kho.don_hang_mon;
create policy dhm_all on kho.don_hang_mon for all
  using      (kho.current_vai_tro() = any(array['ceo','kho','sale']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale']));

drop policy if exists dhnk_doc  on kho.don_hang_nhat_ky;
drop policy if exists dhnk_them on kho.don_hang_nhat_ky;
create policy dhnk_doc  on kho.don_hang_nhat_ky for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale']));
create policy dhnk_them on kho.don_hang_nhat_ky for insert
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale']));

-- Thu hẹp ràng buộc vai_tro về 4 giá trị cũ.
alter table kho.nguoi_dung drop constraint if exists nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add  constraint nguoi_dung_vai_tro_check
  check (vai_tro = any(array['ceo','kho','tho','sale']));

commit;
