-- KHO-1 — Cấp quyền TẦNG NGOÀI cho schema kho, để RLS thành cổng thật (thay vì bị chặn ở tầng quyền).
-- NGUYÊN TẮC: cấp TỐI THIỂU. Chỗ RLS đủ sức lọc (theo DÒNG) -> cấp. Chỗ RLS KHÔNG phủ (giấu CỘT giá vốn
--   khỏi thợ) -> KHÔNG cấp cột đó (RLS row-level + 3 vai trò chung role `authenticated` không giấu cột được).
begin;

grant usage on schema kho to anon, authenticated;

-- ── Bảng KHÔNG chứa giá vốn: cấp SELECT cả cột. RLS 'doc_dang_nhap' (auth.uid() not null) lọc dòng. ──
grant select on kho.nhom, kho.kho, kho.nha_cung_cap, kho.nguoi_dung,
                kho.phieu, kho.giao_dich, kho.cai_dat, kho.chuoi_so
  to anon, authenticated;

-- ── vat_tu (DANH MỤC): thợ CHỈ ĐỌC. Cấp SELECT (không có giá vốn ở bảng này). ──
--   KHÔNG cấp insert/update ở lô này (danh mục sửa = tính năng sau; minh giữ tối thiểu).
grant select on kho.vat_tu to anon, authenticated;

-- ── ton: chứa gia_von_bq (GIÁ VỐN — thợ KHÔNG được xem). RLS không giấu cột được -> ──
--   cấp SELECT LOẠI TRỪ gia_von_bq. Ai cũng thấy SỐ LƯỢNG tồn, KHÔNG ai đọc giá vốn qua bảng này.
grant select (id, vat_tu_id, kho_id, so_luong, tao_luc, sua_luc) on kho.ton to anon, authenticated;

-- ── lo_nhap: chứa gia_von_lo (giá vốn từng lô). Cấp SELECT LOẠI TRỪ gia_von_lo. ──
grant select (id, vat_tu_id, kho_id, phieu_id, so_luong_nhap, con_lai, ngay, tao_luc, nguoi_thao_tac)
  on kho.lo_nhap to anon, authenticated;

-- ── phieu_dong: chứa don_gia, thanh_tien (giá nhập). Cấp SELECT LOẠI TRỪ 2 cột đó. ──
grant select (id, phieu_id, vat_tu_id, so_luong, ncc_id, ly_do, tao_luc)
  on kho.phieu_dong to anon, authenticated;

-- ── giao_dich: THỢ quét tem tạo lay/tra; ceo/kho ghi mọi. RLS gate. Cấp insert/update cho authenticated. ──
--   (giao_dich KHÔNG có cột giá -> đọc cả cột OK; select đã cấp ở khối trên.)
grant insert, update on kho.giao_dich to authenticated;

-- ── Bảng mới sau này trong kho: mặc định cấp SELECT (RLS vẫn phải tự khai). ──
alter default privileges in schema kho grant select on tables to anon, authenticated;

-- ── VIEW giá vốn CHỈ ceo/kho (thợ -> 0 dòng) ─────────────────────────────
--   Cột gia_von_bq bị giấu khỏi authenticated (không grant). View security_definer (owner đọc cột) +
--   WHERE current_vai_tro() in (ceo,kho) tự lọc theo vai trò. App hiện "Giá BQ" qua view này.
create or replace view kho.v_ton_gia_von
  with (security_invoker = false) as
  select vat_tu_id, kho_id, so_luong, gia_von_bq, (so_luong * gia_von_bq) as tien_ton
  from kho.ton
  where kho.current_vai_tro() in ('ceo','kho');
grant select on kho.v_ton_gia_von to authenticated;   -- WHERE lọc theo vai trò; thợ ra 0 dòng

commit;
