-- WP-11d [A] · siết kho.luong_to: thu INSERT/UPDATE/DELETE của client (authenticated,anon).
-- Đo L-11d-1: mọi đường GHI đi qua RPC ghi_so_tham_so_xuong (SECURITY DEFINER, owner=postgres,
-- FORCE RLS tắt → owner ghi vô tư sau revoke). Client CHỈ .select thẳng (taichinh.js:1372)
-- → GIỮ NGUYÊN SELECT. Không đụng tham_so_tai_chinh, không đụng RLS/policy/RPC.

-- 1a · revoke MỨC BẢNG
revoke insert, update, delete on kho.luong_to from authenticated, anon;

-- 1b · revoke MỨC CỘT quét sạch (chiều ĐÓNG — sinh vòng từ catalog được phép, WP-11b chỉ cấm
--      SINH DANH SÁCH CHO-PHÉP). DELETE không có mức cột; chỉ INSERT/UPDATE.
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema='kho' and table_name='luong_to';
  execute format('revoke insert (%s), update (%s) on kho.luong_to from authenticated, anon', v_cols, v_cols);
end $$;

-- 1c · SELECT giữ nguyên (không revoke) — taichinh.js:1372 đọc thẳng.

-- 1d · KIỂM NGAY, sai thì RAISE (không để migration "chạy xong" mà quyền còn hở)
do $$
declare n_ghi int; n_doc int;
begin
  select count(*) into n_ghi
    from information_schema.column_privileges
   where table_schema='kho' and table_name='luong_to'
     and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE');
  select count(*) into n_doc
    from information_schema.column_privileges
   where table_schema='kho' and table_name='luong_to'
     and grantee='authenticated' and privilege_type='SELECT';
  if n_ghi <> 0 then raise exception 'WP-11d: còn % quyền INSERT/UPDATE/DELETE hở trên luong_to (phải 0)', n_ghi; end if;
  if n_doc <> 7 then raise exception 'WP-11d: SELECT của authenticated = % cột (phải 7 — cắt SELECT là mù màn)', n_doc; end if;
  raise notice 'WP-11d luong_to OK: ghi(auth+anon)=0 · select(auth)=7';
end $$;
