-- KHO-1 sửa — SIẾT quyền: grant rộng thừa hưởng từ public (theo bảng khi dời 004) khiến THỢ đọc được
--   giá vốn. Grant cột KHÔNG đè grant bảng -> phải REVOKE sạch rồi grant lại tối thiểu.
begin;

-- 1) REVOKE sạch mọi quyền anon/authenticated trên MỌI bảng + view + sequence trong kho (giữ usage schema).
revoke all on all tables in schema kho from anon, authenticated;
revoke all on all sequences in schema kho from anon, authenticated;

-- 2) GRANT lại TỐI THIỂU
--   Bảng KHÔNG chứa giá: select cả cột (RLS lọc dòng).
grant select on kho.nhom, kho.kho, kho.nha_cung_cap, kho.nguoi_dung, kho.phieu,
                kho.giao_dich, kho.cai_dat, kho.chuoi_so, kho.vat_tu to anon, authenticated;
--   ton/lo_nhap/phieu_dong: select LOẠI TRỪ cột giá (gia_von_bq / gia_von_lo / don_gia,thanh_tien).
grant select (id,vat_tu_id,kho_id,so_luong,tao_luc,sua_luc) on kho.ton to anon, authenticated;
grant select (id,vat_tu_id,kho_id,phieu_id,so_luong_nhap,con_lai,ngay,tao_luc,nguoi_thao_tac) on kho.lo_nhap to anon, authenticated;
grant select (id,phieu_id,vat_tu_id,so_luong,ncc_id,ly_do,tao_luc) on kho.phieu_dong to anon, authenticated;
--   giao_dich: thợ/kho ghi trực tiếp được (RLS gate); dù app đi qua RPC.
grant insert, update on kho.giao_dich to authenticated;
--   VIEW giá vốn: ceo/kho đọc giá vốn qua đây (định nghĩa lọc current_vai_tro); thợ ra 0 dòng.
grant select on kho.v_ton_gia_von to authenticated;
--   bảng mới sau này: mặc định chỉ select.
alter default privileges in schema kho grant select on tables to anon, authenticated;

-- 3) KIỂM tự RAISE — thợ/anon KHÔNG đọc được cột giá; ceo/kho GIỮ được việc chính.
do $$
begin
  -- (a) giá vốn phải BỊ CHẶN cho anon + authenticated (thợ là authenticated)
  if has_column_privilege('authenticated','kho.ton','gia_von_bq','SELECT') then raise exception 'HỎNG: authenticated đọc được ton.gia_von_bq'; end if;
  if has_column_privilege('anon','kho.ton','gia_von_bq','SELECT')          then raise exception 'HỎNG: anon đọc được ton.gia_von_bq'; end if;
  if has_column_privilege('authenticated','kho.lo_nhap','gia_von_lo','SELECT')   then raise exception 'HỎNG: authenticated đọc được lo_nhap.gia_von_lo'; end if;
  if has_column_privilege('anon','kho.lo_nhap','gia_von_lo','SELECT')            then raise exception 'HỎNG: anon đọc được lo_nhap.gia_von_lo'; end if;
  if has_column_privilege('authenticated','kho.phieu_dong','don_gia','SELECT')   then raise exception 'HỎNG: authenticated đọc được phieu_dong.don_gia'; end if;
  if has_column_privilege('authenticated','kho.phieu_dong','thanh_tien','SELECT')then raise exception 'HỎNG: authenticated đọc được phieu_dong.thanh_tien'; end if;
  -- (b) việc chính PHẢI còn: ceo/kho đọc giá vốn qua view + đọc số lượng + danh mục
  if not has_table_privilege('authenticated','kho.v_ton_gia_von','SELECT')       then raise exception 'HỎNG: mất quyền đọc view giá vốn'; end if;
  if not has_column_privilege('authenticated','kho.ton','so_luong','SELECT')     then raise exception 'HỎNG: mất quyền đọc ton.so_luong'; end if;
  if not has_table_privilege('authenticated','kho.vat_tu','SELECT')              then raise exception 'HỎNG: mất quyền đọc vat_tu'; end if;
  if not has_function_privilege('authenticated','kho.ghi_so_phieu(text,uuid,text,text,jsonb)','EXECUTE') then raise exception 'HỎNG: mất quyền ghi_so_phieu'; end if;
  raise notice 'OK SIẾT: giá vốn (ton/lo_nhap/phieu_dong) CHẶN với anon+authenticated; ceo/kho giữ view giá vốn + số lượng + danh mục + RPC ghi';
end $$;

commit;
