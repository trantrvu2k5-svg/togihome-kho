-- db/090 — VÁ BUG huỷ đơn (L-48 phát hiện · L-50 phần 4)
--   ghi_nhat_ky_don (db/042) chèn don_hang_nhat_ky KHÔNG có ly_do → khi den='huy'/'tam_ngung' vướng
--   chk_nk_huy_ly_do (db/022) → MỌI lệnh huỷ/tạm ngưng bị chặn. Vá: chép new.ly_do_huy vào nhật ký.
--   KHÔNG nới constraint. don_hang đã có check (db/021): huy/tam_ngung PHẢI có ly_do_huy → huỷ KHÔNG lý do
--   vẫn bị chặn (ở tầng don_hang, trước trigger). Idempotent (create or replace, chữ ký giữ nguyên).
--   Chạy: cd web && node ops/run_sql.mjs ../db/090_va_nhat_ky_huy.sql
--
-- ══════════ HOÀN TÁC ══════════ (khôi phục bản db/042 — bỏ nhánh ly_do)
--   ... không cần: bản mới bao trùm bản cũ; chỉ thêm chép ly_do.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.ghi_nhat_ky_don() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_uid uuid;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.don_hang_nhat_ky(don_id, tu, den, nguoi_id, ly_do)
    values(new.id, old.trang_thai, new.trang_thai, v_uid,
           case when new.trang_thai in ('huy','tam_ngung') then new.ly_do_huy else null end);
  return new;
end $$;

do $$ begin raise notice 'db/090 OK: ghi_nhat_ky_don chép ly_do_huy cho huy/tam_ngung'; end $$;
commit;
