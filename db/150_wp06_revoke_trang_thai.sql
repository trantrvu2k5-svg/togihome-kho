-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 150 — WP-06 tầng 4 (QD-66): ĐÓNG lỗ TRẦN — bỏ quyền UPDATE cột trang_thai của client.
--   Đo L-06c3: PATCH /don_hang {"trang_thai":"da_giao"} bằng JWT sale → HTTP 200 (nhảy tắt bỏ cổng).
--   UI prod (edf983b0) đã bỏ trang_thai khỏi upsert → revoke bây giờ an toàn thứ tự (lưu đơn không 403).
--
--   TRƯỜNG HỢP (đo L-06d bước 1): grant UPDATE là TABLE-LEVEL (relacl authenticated=arw), 0 cột attacl riêng.
--   → REVOKE UPDATE(trang_thai) VÔ TÁC DỤNG (table-level trùm mọi cột). Phải:
--     (1) REVOKE UPDATE table-level, (2) GRANT UPDATE lại trên MỌI cột TRỪ trang_thai (sinh từ info_schema).
--   GIỮ INSERT (table-level 'a') → đơn mới vẫn tạo kèm trang_thai (trigger kiem_chuyen gác). KHÔNG đụng
--   RLS / trigger / db/148 / db/149. RPC SECURITY DEFINER chạy bằng owner → không ảnh hưởng (xác nhận bước 3).
--
--   HOÀN TÁC (khôi phục nguyên trạng table-level UPDATE):
--     GRANT UPDATE ON kho.don_hang TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (1) bỏ UPDATE mức bảng (arw -> ar). INSERT/SELECT giữ nguyên.
revoke update on kho.don_hang from authenticated;

-- (2) cấp lại UPDATE theo CỘT = mọi cột TRỪ trang_thai (sinh động, không gõ tay 69 cột).
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'kho' and table_name = 'don_hang' and column_name <> 'trang_thai';
  execute format('grant update (%s) on kho.don_hang to authenticated', v_cols);
end $$;

commit;
