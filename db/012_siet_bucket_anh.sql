-- SIẾT 012 — bucket ẢNH kho (kho-images): thay policy ALL "public làm mọi thứ" bằng 4 policy tách theo thao tác.
--   ĐỌC : giữ CÔNG KHAI (app dựng <img> trực tiếp; ảnh vật tư không bí mật; siết đọc sẽ đòi ký URL tạm — chưa cần).
--   GHI (tải lên/sửa/xoá): CHỈ ceo | kho, qua kho.current_vai_tro().
-- Chỉ áp cho bucket 'kho-images'. TUYỆT ĐỐI KHÔNG đụng bucket dự án plugin (không nhắc tên nó ở đây).
-- Chạy lại nhiều lần được (drop-if-exists rồi create). KHÔNG xoá file, KHÔNG xoá bucket.
begin;

-- Bỏ policy ALL cũ + mọi policy tách (để chạy lại không nhân đôi).
drop policy if exists "kho_images_all"     on storage.objects;
drop policy if exists "kho_images_doc"     on storage.objects;
drop policy if exists "kho_images_tai_len" on storage.objects;
drop policy if exists "kho_images_sua"     on storage.objects;
drop policy if exists "kho_images_xoa"     on storage.objects;

-- ĐỌC: công khai (mọi vai trò kể cả anon) — chỉ trong bucket kho-images.
create policy "kho_images_doc" on storage.objects
  for select
  using (bucket_id = 'kho-images');

-- TẢI LÊN: chỉ ceo | kho.
create policy "kho_images_tai_len" on storage.objects
  for insert
  with check (bucket_id = 'kho-images' and kho.current_vai_tro() in ('ceo','kho'));

-- SỬA: chỉ ceo | kho.
create policy "kho_images_sua" on storage.objects
  for update
  using (bucket_id = 'kho-images' and kho.current_vai_tro() in ('ceo','kho'))
  with check (bucket_id = 'kho-images' and kho.current_vai_tro() in ('ceo','kho'));

-- XOÁ: chỉ ceo | kho.
create policy "kho_images_xoa" on storage.objects
  for delete
  using (bucket_id = 'kho-images' and kho.current_vai_tro() in ('ceo','kho'));

commit;
