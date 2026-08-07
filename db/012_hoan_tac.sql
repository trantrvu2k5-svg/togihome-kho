-- HOÀN TÁC 012 — đưa policy bucket kho-images về ĐÚNG trạng thái trước khi vá:
--   một policy DUY NHẤT kho_images_all (ALL · role public · bucket_id='kho-images').
-- Phao cứu sinh. Chạy lại nhiều lần được. CHỈ đụng policy của kho-images. KHÔNG đụng catalog-images.
--   node ops/run_sql.mjs ../db/012_hoan_tac.sql   (hoặc Supabase SQL Editor)
begin;

drop policy if exists "kho_images_doc"     on storage.objects;
drop policy if exists "kho_images_tai_len" on storage.objects;
drop policy if exists "kho_images_sua"     on storage.objects;
drop policy if exists "kho_images_xoa"     on storage.objects;
drop policy if exists "kho_images_all"     on storage.objects;

create policy "kho_images_all" on storage.objects
  for all
  using (bucket_id = 'kho-images')
  with check (bucket_id = 'kho-images');

commit;
