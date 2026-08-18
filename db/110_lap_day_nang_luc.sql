-- 110 — LẤP ĐẦY NĂNG LỰC XƯỞNG + CHI PHÍ NĂNG LỰC BỎ TRỐNG (Garrison App.3A) (L-46).
--   ⚠ IDEMPOTENT: add column if not exists + create or replace → chạy 1 lần vẫn an toàn chạy lại.
--   Thước TIỀN cho P/L (lệnh này) SONG SONG thước GIỜ (nang_luc_to) cho xếp lịch — hai thước, không thay nhau.
--   Garrison App.3A: mẫu số overhead = practical capacity; chênh lệch (unused capacity) HIỆN thành dòng thông tin,
--   KHÔNG chôn vào giá vốn, KHÔNG trừ vào lãi (lương tổ đã nằm trong khối ②, trừ nữa là trùng).
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.lap_day_ky(text);
--   alter table kho.tham_so_tai_chinh drop column if exists chi_phi_nang_luc;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- a) Tham số kỳ mới (bảng CỘT): chi phí năng lực xưởng/kỳ (đồng). NULL = chưa chốt → RPC dùng số suy.
alter table kho.tham_so_tai_chinh add column if not exists chi_phi_nang_luc numeric
  check (chi_phi_nang_luc is null or chi_phi_nang_luc >= 0);

-- b) lap_day_ky(p_ky) — số THÔNG TIN (KHÔNG fail-đóng): số suy luôn tính được từ luong_to.
create or replace function kho.lap_day_ky(p_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  v_suy numeric; v_cpnl numeric; v_mau numeric; v_k2 numeric; v_from date; v_to date; v_chua boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'lap_day_ky: chỉ ceo/ke_toan'; end if;
  -- số SUY = Σ(lương tổ + overhead + bảo hiểm) của luong_to CÙNG kỳ
  select coalesce(sum(coalesce(luong_to,0)+coalesce(overhead_phan_bo,0)+coalesce(bao_hiem,0)),0)
    into v_suy from kho.luong_to where ma_ky = p_ky;
  -- tham số đã chốt?
  select chi_phi_nang_luc into v_cpnl from kho.tham_so_tai_chinh where ma_ky = p_ky;
  v_chua := (v_cpnl is null);
  v_mau  := coalesce(v_cpnl, v_suy);     -- chưa chốt → dùng số suy làm mẫu số
  -- Σ khoi_2 (đơn da_giao trong kỳ theo ngay_giao) — range SARGABLE
  v_from := to_date(p_ky || '-01', 'YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  select coalesce(sum(coalesce(gv.khoi_2,0)),0) into v_k2
    from kho.don_hang d join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
    where d.trang_thai = 'da_giao' and d.ngay_giao >= v_from and d.ngay_giao < v_to;
  return jsonb_build_object(
    'ma_ky', p_ky,
    'chi_phi_nang_luc', v_cpnl,                 -- tham số THÔ (null = chưa chốt)
    'so_suy_tu_luong_to', v_suy,
    'chua_chot_tham_so', v_chua,
    'mau_so_dung', v_mau,                       -- mẫu số thực dùng để tính %
    'tong_khoi_2', v_k2,
    'ty_le_lap_day', case when v_mau > 0 then v_k2 / v_mau else null end,   -- phân số (×100 ở UI)
    'tien_bo_trong', v_mau - v_k2               -- âm = VƯỢT năng lực chuẩn
  );
end $$;
grant execute on function kho.lap_day_ky(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.lap_day_ky(text)') is null then raise exception 'THIẾU lap_day_ky'; end if;
  raise notice 'db/110 OK: chi_phi_nang_luc + lap_day_ky (thước tiền lấp đầy — Garrison App.3A).';
end $$;
commit;
