-- db/211 · WP-72 L-72c · GRANT UPDATE(han_tra_loi) — sale sửa hạn qua app (dh_sua RLS gác dòng nào).
--   don_hang có grant UPDATE THEO CỘT (WP-06 revoke trang_thai để chặn ghi thẳng). Cột mới han_tra_loi (db/209) CHƯA nằm
--   trong grant → saleApi.datHan (sb.from update) bị 403 câm → robot L-72c B2 sửa hạn không ăn. Thêm cột này vào grant.
--   ⚠ Cổng backup QD-61. HOÀN TÁC: revoke update(han_tra_loi) on kho.don_hang from authenticated.
begin;
grant update(han_tra_loi) on kho.don_hang to authenticated;
do $$ begin
  if not exists (select 1 from information_schema.column_privileges
                 where table_name='don_hang' and grantee='authenticated' and privilege_type='UPDATE' and column_name='han_tra_loi')
  then raise exception 'THIẾU grant update(han_tra_loi)'; end if;
  raise notice 'db/211 OK: authenticated UPDATE được han_tra_loi (dh_sua RLS vẫn gác dòng).';
end $$;
commit;
