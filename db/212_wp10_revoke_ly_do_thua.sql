-- db/212 · WP-10 · QD-95 · SIẾT cửa hậu: revoke UPDATE(ly_do_thua, ghi_chu_thua) khỏi client.
--   Cửa hậu: db/150 grant UPDATE theo kiểu "mọi cột TRỪ trang_thai" nên ly_do_thua/ghi_chu_thua (db/036) tự lọt ra tầng API.
--   Đường ghi HỢP LỆ DUY NHẤT = doi_trang_thai_don (SECURITY DEFINER — prosecdef=true, đã kiểm cổng 0). Họ QD-64/66/67.
--   L-10A nghiệm thu bằng dữ liệu: sale PATCH thẳng ly_do_thua THÀNH CÔNG (cửa hậu mở), không để lại vết ai; 0 client còn ghi
--     2 cột (sale.js L-72d đã xoá khỏi payload; cửa "Đánh dấu thua" đi qua RPC). anon: 0 grant 2 cột (kiểm 02/09) → không revoke anon.
--   ⚠ Cổng backup QD-61 (CẤM BO_QUA_BACKUP). HOÀN TÁC: grant update(ly_do_thua, ghi_chu_thua) on kho.don_hang to authenticated.
begin;
revoke update (ly_do_thua, ghi_chu_thua) on kho.don_hang from authenticated;
-- anon: 0 grant hai cột này, đã kiểm ngày 02/09 — không có gì để revoke.
do $$ begin
  if exists (select 1 from information_schema.column_privileges
             where table_schema='kho' and table_name='don_hang' and privilege_type='UPDATE'
               and grantee='authenticated' and column_name in ('ly_do_thua','ghi_chu_thua'))
  then raise exception 'REVOKE CHƯA ĂN: authenticated vẫn UPDATE được ly_do_thua/ghi_chu_thua'; end if;
  raise notice 'db/212 OK: revoke ly_do_thua+ghi_chu_thua khỏi authenticated (còn 68 cột UPDATE, trừ trang_thai).';
end $$;
commit;
