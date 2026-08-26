-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 153 — WP-07 pha 5a (QD-67): khép "luôn khởi tạo bao_gia" + thu cột hệ-tự-ghi khỏi INSERT client.
--   PHÁT SINH L-134: (1) DEFAULT trang_thai='moi_len_don' → raw-INSERT (có nguồn+TH, không cột
--   trang_thai) vẫn đạt moi_len_don, LÁCH tao_don. (2) client còn INSERT được 5 cột hệ-tự-ghi.
--   → (1) đổi DEFAULT sang 'bao_gia'; (2) thu grant INSERT: bỏ id, tao_luc, la_demo, sale_phu_trach,
--   nguoi_tao (69 → 64). Theo đúng khuôn db/150/152 (sinh cột từ information_schema, không gõ tay).
--   Các cột thu = do TRIGGER / DEFAULT / RPC tao_don server điền (id gen_random_uuid, tao_luc now(),
--   la_demo trg tu_danh_dau_demo_don, sale_phu_trach trg gan_sale_phu_trach, nguoi_tao tao_don current_ns).
--
--   HOÀN TÁC:
--     alter table kho.don_hang alter column trang_thai set default 'moi_len_don';
--     grant insert (id, tao_luc, la_demo, sale_phu_trach, nguoi_tao) on kho.don_hang to authenticated;
--   HOÀN NGUYÊN RIÊNG phần thu cột (giữ DEFAULT mới) — nếu tao_don vỡ vì thu cột:
--     grant insert (id, tao_luc, la_demo, sale_phu_trach, nguoi_tao) on kho.don_hang to authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- (1) DEFAULT khởi tạo = 'bao_gia' (mọi đơn vào ở báo giá; lên đơn chỉ qua chot_don).
alter table kho.don_hang alter column trang_thai set default 'bao_gia';

-- (2) thu INSERT: cấp lại theo CỘT = mọi cột TRỪ trang_thai + 5 cột hệ-tự-ghi (sinh động, không gõ tay).
--     Vì grant INSERT là TABLE-LEVEL không còn (db/152 đã revoke table-level), chỉ cần revoke 5 cột rồi
--     cấp lại tập đúng — nhưng để BẤT BIẾN với trạng thái grant hiện tại, revoke sạch rồi grant lại tập 64.
revoke insert on kho.don_hang from authenticated;
do $$
declare v_cols text;
  v_thu text[] := array['trang_thai','id','tao_luc','la_demo','sale_phu_trach','nguoi_tao'];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'kho' and table_name = 'don_hang' and not (column_name = any(v_thu));
  execute format('grant insert (%s) on kho.don_hang to authenticated', v_cols);
end $$;

-- (3) KIỂM ngay: DEFAULT mới + INSERT còn 64 cột + 5 cột đã rớt.
do $$
declare v_def text; v_n int; v_con text;
begin
  select column_default into v_def from information_schema.columns
    where table_schema='kho' and table_name='don_hang' and column_name='trang_thai';
  select count(*) into v_n from information_schema.column_privileges
    where table_schema='kho' and table_name='don_hang' and privilege_type='INSERT' and grantee='authenticated';
  select string_agg(column_name, ', ') into v_con from information_schema.column_privileges
    where table_schema='kho' and table_name='don_hang' and privilege_type='INSERT' and grantee='authenticated'
      and column_name = any(array['trang_thai','id','tao_luc','la_demo','sale_phu_trach','nguoi_tao']);
  if v_def not like '%bao_gia%' then raise exception 'DEFAULT SAI: %', v_def; end if;
  if v_n <> 64 or v_con is not null then
    raise exception 'THU CỘT SAI: INSERT % cột, còn sót: %', v_n, coalesce(v_con,'(không)');
  end if;
  raise notice 'db/153 OK: DEFAULT=% · INSERT % cột · 5 cột hệ-tự-ghi + trang_thai đã rớt', v_def, v_n;
end $$;

commit;
