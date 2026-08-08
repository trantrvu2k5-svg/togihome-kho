-- 023 — HỢP NHẤT VAI TRÒ, mở 4 -> 7 (thêm thiet_ke, xuong, ke_toan). CEO chốt.
--   Idempotent (drop-recreate policy, drop-add constraint) -> chạy lại KHÔNG nhân policy.
--   NGUYÊN TẮC AN TOÀN:
--     • KHÔNG đụng nguoi_dung.tu_doc / ceo_sua_nd (khoá vòng đăng nhập).
--     • KHÔNG đụng bảng kho CŨ + KHÔNG đụng don_hang_gia_von -> vai trò mới 0 quyền ở đó (whitelist).
--     • ceo/kho GIỮ NGUYÊN mọi quyền (đều nằm trong mọi danh sách).
--   node ops/run_sql.mjs ../db/023_vai_tro.sql   ·   gỡ: 023_hoan_tac.sql
begin;

-- ══════════ VIỆC 3 — mở ràng buộc vai_tro: +thiet_ke +xuong +ke_toan (CHƯA tạo tài khoản nào) ══════════
--   current_vai_tro() KHÔNG cần đổi (chỉ đọc cột). Mọi policy/hàm cũ dùng WHITELIST -> vai trò mới mặc nhiên bị chặn.
alter table kho.nguoi_dung drop constraint if exists nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add  constraint nguoi_dung_vai_tro_check
  check (vai_tro = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan']));

-- ══════════ VIỆC 5 — cấp quyền vai trò mới CHỈ trên 3 bảng đơn hàng ══════════
-- ── don_hang: thiet_ke/xuong/ke_toan ĐỌC + UPDATE. KHÔNG cho INSERT (dh_them giữ ceo/kho/sale — chỉ họ tạo đơn).
--    RLS là theo DÒNG, KHÔNG ép được theo CỘT: "thiet_ke ghi nhóm thiết kế / xuong nhóm sản xuất / ke_toan nhóm
--    thu tiền" -> ba vai trò đều UPDATE được MỌI cột phi-giá-vốn ở tầng DB; giới hạn theo NHÓM CỘT phải ép ở GIAO DIỆN.
drop policy if exists dh_doc on kho.don_hang;
drop policy if exists dh_sua on kho.don_hang;
create policy dh_doc on kho.don_hang for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));
create policy dh_sua on kho.don_hang for update
  using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));
-- dh_them (INSERT) GIỮ NGUYÊN ceo/kho/sale — KHÔNG đụng.
-- don_hang_gia_von GIỮ NGUYÊN ceo/kho — sale + 3 vai trò mới KHÔNG thấy giá vốn.

-- ── don_hang_mon: cả 3 mới ĐỌC; thiet_ke+xuong GHI; ke_toan CHỈ ĐỌC. Tách dhm_all -> dhm_doc + dhm_ghi.
--    (policy PERMISSIVE OR nhau: ke_toan đọc qua dhm_doc, ghi bị chặn vì không nằm trong dhm_ghi.)
drop policy if exists dhm_all on kho.don_hang_mon;
drop policy if exists dhm_doc on kho.don_hang_mon;
drop policy if exists dhm_ghi on kho.don_hang_mon;
create policy dhm_doc on kho.don_hang_mon for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));
create policy dhm_ghi on kho.don_hang_mon for all
  using      (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong']));

-- ── don_hang_nhat_ky: cả 3 mới ĐỌC + THÊM. Append-only giữ nguyên (không policy update/delete).
drop policy if exists dhnk_doc  on kho.don_hang_nhat_ky;
drop policy if exists dhnk_them on kho.don_hang_nhat_ky;
create policy dhnk_doc  on kho.don_hang_nhat_ky for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));
create policy dhnk_them on kho.don_hang_nhat_ky for insert
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));

-- GRANT: 3 bảng đơn hàng đã grant cho `authenticated` (021/022); vai trò mới LÀ authenticated nên grant sẵn có,
--   RLS ở trên gác. anon đã revoke ở 021/022 -> vai trò mới không đụng anon. KHÔNG cấp gì trên bảng kho cũ.
commit;
