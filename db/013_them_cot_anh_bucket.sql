-- THÊM CỘT 013 — kho.vat_tu.anh_file: tên file ảnh trong bucket kho-images (đường app SẼ dùng sau).
--   KHÔNG đụng cột anh_ma (nguồn ảnh app đang chạy). Chạy lại nhiều lần được.
-- Bảng vat_tu cấp quyền theo CỘT (007) -> cột mới KHÔNG tự có quyền, phải cấp tay.
--   Cấp ĐÚNG như cột text sửa được hiện có (vd 'ten'): authenticated SELECT+INSERT+UPDATE, anon SELECT.
--   KHÔNG cấp rộng hơn (anon KHÔNG được INSERT/UPDATE).
begin;

alter table kho.vat_tu add column if not exists anh_file text;
comment on column kho.vat_tu.anh_file is 'tên file trong bucket kho-images, ví dụ kho/BL-03_1781168125635.jpg';

grant select (anh_file)                 on kho.vat_tu to anon, authenticated;
grant insert (anh_file), update (anh_file) on kho.vat_tu to authenticated;

-- KIỂM tự RAISE: ceo/kho (role authenticated) phải ĐỌC+GHI; anon chỉ ĐỌC (không ghi).
do $$
begin
  if not has_column_privilege('authenticated','kho.vat_tu','anh_file','SELECT') then raise exception 'HỎNG: authenticated mất SELECT anh_file'; end if;
  if not has_column_privilege('authenticated','kho.vat_tu','anh_file','INSERT') then raise exception 'HỎNG: authenticated mất INSERT anh_file'; end if;
  if not has_column_privilege('authenticated','kho.vat_tu','anh_file','UPDATE') then raise exception 'HỎNG: authenticated mất UPDATE anh_file'; end if;
  if not has_column_privilege('anon','kho.vat_tu','anh_file','SELECT')          then raise exception 'HỎNG: anon mất SELECT anh_file'; end if;
  if has_column_privilege('anon','kho.vat_tu','anh_file','UPDATE')              then raise exception 'HỎNG: anon KHÔNG được có UPDATE anh_file (rộng hơn cột hiện có)'; end if;
  if has_column_privilege('anon','kho.vat_tu','anh_file','INSERT')              then raise exception 'HỎNG: anon KHÔNG được có INSERT anh_file'; end if;
  raise notice 'OK 013: thêm cột anh_file + grant (authenticated RW, anon R) đúng như cột ten';
end $$;

commit;
