-- WP-11d [B] · siết kho.tham_so_tai_chinh: thu INSERT/UPDATE/DELETE của client (authenticated,anon).
-- Đường ghi client nay qua 2 RPC (db/216): luu_tham_so_ban_hang (13 cột) + luu_cau_hinh_van_hanh (8 cột) —
-- đã swap UI (taichinh.js:1263 / sale.js:319) + deploy + robot vòng 1 chứng minh chạy TRƯỚC revoke.
-- Kỳ mới sinh ở tầng owner (seed/SQL), KHÔNG qua client → revoke INSERT an toàn.
-- GIỮ NGUYÊN SELECT 45 cột (cả 2 màn đọc thẳng). Không đụng RLS/policy/2 RPC.

-- 6a · revoke MỨC BẢNG
revoke insert, update, delete on kho.tham_so_tai_chinh from authenticated, anon;

-- 6b · revoke MỨC CỘT quét sạch 45 cột (chiều ĐÓNG — sinh vòng từ catalog được phép)
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema='kho' and table_name='tham_so_tai_chinh';
  execute format('revoke insert (%s), update (%s) on kho.tham_so_tai_chinh from authenticated, anon', v_cols, v_cols);
end $$;

-- 6c · SELECT giữ nguyên (không revoke).

-- 6e · KIỂM NGAY, RAISE nếu sai
do $$
declare n_ghi int; n_doc int;
begin
  select count(*) into n_ghi
    from information_schema.column_privileges
   where table_schema='kho' and table_name='tham_so_tai_chinh'
     and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE');
  select count(*) into n_doc
    from information_schema.column_privileges
   where table_schema='kho' and table_name='tham_so_tai_chinh'
     and grantee='authenticated' and privilege_type='SELECT';
  if n_ghi <> 0 then raise exception 'WP-11d: còn % quyền ghi hở trên tham_so_tai_chinh (phải 0)', n_ghi; end if;
  if n_doc <> 45 then raise exception 'WP-11d: SELECT authenticated = % cột (phải 45 — cắt là mù 2 màn)', n_doc; end if;
  raise notice 'WP-11d tham_so_tai_chinh OK: ghi(auth+anon)=0 · select(auth)=45';
end $$;
