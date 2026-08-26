-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 152 — WP-07 tầng 4 (QD-67, vế cuối): ĐÓNG lỗ TẠO — bỏ quyền INSERT cột trang_thai của client.
--   L-131 đo: authenticated INSERT được 70/70 cột (gồm trang_thai) → client tự chọn trạng thái khởi tạo.
--   L-133: UI đã chuyển sang RPC tao_don (server ÉP trang_thai='bao_gia'), kiểm nút prod xanh → nay
--   rút thang an toàn thứ tự (đúng khuôn WP-06 L-06c→d, xem db/150).
--
--   GIỐNG db/150 (grant INSERT cũng TABLE-LEVEL 'a' → revoke cột đơn lẻ vô tác dụng). Phải:
--     (1) REVOKE INSERT table-level, (2) GRANT INSERT lại trên MỌI cột TRỪ trang_thai (sinh từ info_schema).
--   GIỮ UPDATE (69 cột, db/150) + SELECT nguyên. KHÔNG đụng RLS / trigger / db/148·149·151.
--   RPC tao_don (SECURITY DEFINER, owner) KHÔNG bị ảnh hưởng — đường tạo hợp lệ vẫn sống (xác nhận bước 2c).
--
--   HOÀN TÁC (khôi phục nguyên trạng table-level INSERT):
--     GRANT INSERT ON kho.don_hang TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (1) bỏ INSERT mức bảng. UPDATE (69 cột)/SELECT giữ nguyên.
revoke insert on kho.don_hang from authenticated;

-- (2) cấp lại INSERT theo CỘT = mọi cột TRỪ trang_thai (sinh động, không gõ tay 69 cột).
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'kho' and table_name = 'don_hang' and column_name <> 'trang_thai';
  execute format('grant insert (%s) on kho.don_hang to authenticated', v_cols);
end $$;

-- (3) KIỂM ngay trong migration: INSERT của authenticated = 69 cột & trang_thai KHÔNG còn.
do $$
declare v_n int; v_co_tt boolean;
begin
  select count(*), bool_or(column_name = 'trang_thai')
    into v_n, v_co_tt
  from information_schema.column_privileges
  where table_schema = 'kho' and table_name = 'don_hang'
    and privilege_type = 'INSERT' and grantee = 'authenticated';
  if v_n <> 69 or coalesce(v_co_tt, false) then
    raise exception 'WP-07 revoke SAI: INSERT còn % cột, trang_thai=%', v_n, v_co_tt;
  end if;
  raise notice 'WP-07 OK: authenticated INSERT % cột, trang_thai đã rớt', v_n;
end $$;

commit;
