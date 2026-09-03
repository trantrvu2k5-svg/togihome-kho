-- DỮ LIỆU VIỆC TAY (KHÔNG phải WP-14b) · L-9 · Tạo kỳ tham số 2026-09 = CHÉP ĐỦ 45 cột từ 2026-08.
-- Lý do: kỳ mới sinh ở tầng owner (không có RPC chép kỳ tham_so_tai_chinh — đo L-11d-3). CEO sẽ sửa số thật sau.
-- KHÔNG đụng dòng kỳ 08 và mọi kỳ khác. Chỉ override 3 cột: ma_ky · ngay_ap_dung · ghi_chu.
-- An toàn ràng buộc db/218: ngay_ap_dung=2026-09-01 (UNIQUE chưa dùng) · to_char='2026-09'=ma_ky (CHECK khớp).

do $$
declare v_cols text; v_sel text; v_n int;
begin
  if exists (select 1 from kho.tham_so_tai_chinh where ma_ky='2026-09') then
    raise exception 'kỳ 2026-09 ĐÃ có — không đè'; end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(
           case column_name
             when 'ma_ky'        then '''2026-09'''
             when 'ngay_ap_dung' then 'date ''2026-09-01'''
             when 'ghi_chu'      then '''[TẠM] copy 08 — CEO sửa số thật sau'''
             else quote_ident(column_name)
           end, ', ' order by ordinal_position)
    into v_cols, v_sel
    from information_schema.columns
    where table_schema='kho' and table_name='tham_so_tai_chinh';

  execute format(
    'insert into kho.tham_so_tai_chinh (%s) select %s from kho.tham_so_tai_chinh where ma_ky=''2026-08''',
    v_cols, v_sel);

  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'L-9: chèn % dòng (phải 1)', v_n; end if;
  raise notice 'L-9: tạo kỳ 2026-09 (chép 45 cột từ 2026-08, override ma_ky/ngay_ap_dung/ghi_chu)';
end $$;
