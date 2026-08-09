-- 032 — VÁ BẪY NULL trong guard vai trò: current_vai_tro()=NULL không được LỌT nữa.
--   Bẫy: `if current_vai_tro() not in ('ceo','ke_toan')` — khi NULL, `NULL not in (...)` = NULL -> if-false -> KHÔNG raise -> LỌT.
--   Vá: `coalesce(current_vai_tro(),'') not in (...)` -> NULL luôn CHẶN (fail-đóng).
--   node ops/run_sql.mjs ../db/032_va_bay_null_guard.sql
--
--   PHẠM VI: 2 hàm SECURITY DEFINER mà guard là lớp bảo vệ DUY NHẤT (không có RLS đỡ):
--     • tinh_he_so_m   — đọc giá vốn, trả he_so_m ("chìa khoá tính ngược giá vốn")
--     • dat_ship_du_toan — ghi tham_so_tai_chinh (SECURITY DEFINER bỏ qua RLS)
--   KHÔNG đụng:
--     • quy_doi_export  — GIỮ ngoại lệ 026 (auth.uid() IS NULL = plugin anon được đọc); NULL-vt đã CHẶN sẵn.
--     • chan_ghi_cot_tien — blacklist TRIGGER; NULL-vt = superuser/service (hợp lệ). RLS don_hang (dh_them/dh_sua)
--       đã chặn null-vt authenticated ghi đơn -> vá sẽ phá đường migration/script mà không đóng lỗ nào.
--     • ghi_so_phieu / huy_phieu / quet_giao_dich — đã có `vt is null` (fail-đóng); là hàm kho/tho (CẤM đụng).
--
-- ══════════ HOÀN TÁC (trả về guard cũ — bẫy NULL) ══════════
--   begin;
--   -- tinh_he_so_m: đổi lại `if kho.current_vai_tro() not in ('ceo','ke_toan')`
--   -- dat_ship_du_toan: đổi lại `if kho.current_vai_tro() not in ('ceo','ke_toan')`
--   -- (chạy lại 028/029 hoặc create-or-replace bản cũ — xem git v-kho-25 trở về trước)
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. tinh_he_so_m — chỉ đổi 1 dòng guard, thân giữ nguyên.
create or replace function kho.tinh_he_so_m(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare
  t record; v_hh numeric; v_gcg_tb numeric; v_ship_tb numeric;
  v_sum_gcg numeric; v_sum_ship numeric; v_sum_phi numeric; v_thieu text := '';
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then   -- VÁ: NULL luôn CHẶN
    raise exception 'tinh_he_so_m: chỉ ceo/ke_toan';
  end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if not found then raise notice 'tinh_he_so_m(%): chưa có dòng tham số cho kỳ', p_ma_ky; return null; end if;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  select avg(g.gia_chuyen_giao) into v_gcg_tb
    from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky;
  select avg(d.ship_thuc_tra) into v_ship_tb
    from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky;
  if t.dt_muc_tieu     is null then v_thieu := v_thieu || 'dt_muc_tieu, '; end if;
  if t.so_don_ke_hoach is null or t.so_don_ke_hoach = 0 then v_thieu := v_thieu || 'so_don_ke_hoach, '; end if;
  if t.phi_don_le      is null then v_thieu := v_thieu || 'phi_don_le, '; end if;
  if v_gcg_tb is null then v_thieu := v_thieu || 'đơn có gia_chuyen_giao đóng dấu kỳ (gcg_TB rỗng), '; end if;
  if v_thieu <> '' then
    raise notice 'tinh_he_so_m(%): THIẾU %', p_ma_ky, rtrim(v_thieu, ', ');
    return null;
  end if;
  v_sum_gcg  := v_gcg_tb              * t.so_don_ke_hoach;
  v_sum_ship := coalesce(v_ship_tb,0) * t.so_don_ke_hoach;
  v_sum_phi  := t.phi_don_le          * t.so_don_ke_hoach;
  return (t.dt_muc_tieu * (1 - v_hh) - v_sum_ship - v_sum_phi) / v_sum_gcg;
end $$;

-- 2. dat_ship_du_toan — chỉ đổi 1 dòng guard.
create or replace function kho.dat_ship_du_toan(p_ma_ky text, p_dong text, p_val numeric)
  returns void language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then   -- VÁ: NULL luôn CHẶN
    raise exception 'dat_ship_du_toan: chỉ ceo/ke_toan';
  end if;
  update kho.tham_so_tai_chinh
    set ship_du_toan = ship_du_toan || jsonb_build_object(p_dong, p_val)
    where ma_ky = p_ma_ky;
end $$;

commit;
