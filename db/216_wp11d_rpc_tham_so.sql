-- WP-11d [B] · 2 RPC cho kho.tham_so_tai_chinh — CHỈ THÊM, KHÔNG revoke, KHÔNG đụng UI/grant/RLS.
-- Sau lệnh này đường .update cũ (taichinh.js:1263 / sale.js:319) VẪN chạy được (grant còn nguyên).
-- Bề mặt ghi = ĐÚNG 20/45 cột đo ở L-11d-1 (13 luuKy + 8 sale c2:cfg, trùng `vat`). 25 cột kia
-- KHÔNG có trong chữ ký — kể cả he_so_m (do RPC tinh_he_so_m tính, không nhập tay).
-- 0a: kỳ tạo ngoài client (seed db/028 / SQL owner) → RPC chỉ UPDATE theo ma_ky, KHÔNG upsert.
-- 0b: không có cột khoá/đóng dấu, không trigger → không theo luật khoá nào (không tự đẻ luật).
-- 0c: không có cột vết sửa (nguoi_sua/sua_luc) → KHÔNG thêm cột, ghi PHÁT SINH.
-- Ngữ nghĩa NULL giữ Y NGUYÊN UI: UI luôn gửi ĐỦ bộ key → SET thẳng col=p_col (null→null).

-- ══ RPC #1 · app Tài chính luuKy (13 cột) ══
create or replace function kho.luu_tham_so_ban_hang(
  p_ma_ky text,
  p_dt_muc_tieu numeric, p_so_don_ke_hoach int, p_vat numeric,
  p_hh_sale numeric, p_hh_quan_ly numeric, p_hh_thiet_ke numeric,
  p_phi_don_le numeric, p_phi_don_combo numeric, p_phi_don_thiet_ke numeric,
  p_chi_phi_nang_luc numeric, p_tran_sale numeric, p_tran_truong_nhom numeric,
  p_ghi_chu text
) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $$
declare v_n int; v_vai text;
begin
  v_vai := coalesce(kho.current_vai_tro(), '');
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'luu_tham_so_ban_hang: vai "%" không được sửa tham số (chỉ ceo/ke_toan)', v_vai; end if;
  update kho.tham_so_tai_chinh set
    dt_muc_tieu = p_dt_muc_tieu, so_don_ke_hoach = p_so_don_ke_hoach, vat = p_vat,
    hh_sale = p_hh_sale, hh_quan_ly = p_hh_quan_ly, hh_thiet_ke = p_hh_thiet_ke,
    phi_don_le = p_phi_don_le, phi_don_combo = p_phi_don_combo, phi_don_thiet_ke = p_phi_don_thiet_ke,
    chi_phi_nang_luc = p_chi_phi_nang_luc, tran_sale = p_tran_sale, tran_truong_nhom = p_tran_truong_nhom,
    ghi_chu = p_ghi_chu
   where ma_ky = p_ma_ky;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'luu_tham_so_ban_hang: kỳ "%" chưa có tham số — tạo kỳ trước', p_ma_ky; end if;
  return jsonb_build_object('ok', true, 'ma_ky', p_ma_ky, 'so_cot', 13);
end $$;

-- ══ RPC #2 · app Sale c2:cfg (8 cột) ══
create or replace function kho.luu_cau_hinh_van_hanh(
  p_ma_ky text,
  p_vat numeric, p_gio_mo_cua jsonb, p_ghi_de int,
  p_n_ads numeric, p_n_cac numeric, p_n_kg numeric, p_n_no numeric, p_n_giam numeric
) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $$
declare v_n int; v_vai text;
begin
  v_vai := coalesce(kho.current_vai_tro(), '');
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'luu_cau_hinh_van_hanh: vai "%" không được sửa cấu hình (chỉ ceo/ke_toan)', v_vai; end if;
  update kho.tham_so_tai_chinh set
    vat = p_vat, gio_mo_cua = p_gio_mo_cua, ghi_de = p_ghi_de,
    n_ads = p_n_ads, n_cac = p_n_cac, n_kg = p_n_kg, n_no = p_n_no, n_giam = p_n_giam
   where ma_ky = p_ma_ky;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'luu_cau_hinh_van_hanh: kỳ "%" chưa có tham số — tạo kỳ trước', p_ma_ky; end if;
  return jsonb_build_object('ok', true, 'ma_ky', p_ma_ky, 'so_cot', 8);
end $$;

alter function kho.luu_tham_so_ban_hang(text,numeric,int,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) owner to postgres;
alter function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) owner to postgres;
revoke execute on function kho.luu_tham_so_ban_hang(text,numeric,int,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon;
revoke execute on function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function kho.luu_tham_so_ban_hang(text,numeric,int,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
grant execute on function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) to authenticated;
