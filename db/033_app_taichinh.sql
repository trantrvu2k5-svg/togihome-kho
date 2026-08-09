-- 033 — HÀM cho app TÀI CHÍNH (nối dây). Tính toán ở DB (giá vốn không rời DB), guard fail-đóng ceo/ke_toan.
--   node ops/run_sql.mjs ../db/033_app_taichinh.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.bang_gia(text, date);
--   drop function if exists kho.gia_bac_tu_gv(numeric, text, numeric);
--   drop function if exists kho.chot_niem_yet(text);
--   drop function if exists kho.niem_yet_info(text);
--   alter table kho.gia_niem_yet drop column if exists chot_luc, drop column if exists chot_boi;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table kho.gia_niem_yet
  add column if not exists chot_luc timestamptz,
  add column if not exists chot_boi uuid references kho.nguoi_dung(id);

-- ③ BẢNG GIÁ — 1 hàm trả cả bảng (giá vốn + tầng1 + giá sàn + có VAT + trần). Server-side → giá vốn KHÔNG rời DB.
create or replace function kho.bang_gia(p_dong text default 'le', p_ngay date default current_date)
  returns table (sku text, ten text, gia_von numeric, tang_1 numeric, gia_san numeric, bao_khach numeric, tran numeric)
  language plpgsql security definer set search_path = kho stable as $$
declare t record; v_m numeric; v_hh numeric; v_phi numeric; v_vat numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'bang_gia: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  v_m := t.he_so_m;
  v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke else t.phi_don_le end;
  v_vat := coalesce(t.vat,0)/100;
  return query
    select s.ma, s.ten, g.gia_von,
      case when v_m is null then null else round(g.gia_von * v_m) end,
      case when v_m is null then null else round((g.gia_von*v_m + v_phi)/(1-v_hh)) end,
      case when v_m is null then null else round((g.gia_von*v_m + v_phi)/(1-v_hh)*(1+v_vat)) end,
      kho.tran_giam_gia(s.ma, p_dong, p_ngay)
    from kho.san_pham_mau s join kho.san_pham_mau_gia_von g on g.ma = s.ma
    where not s.ngung order by g.gia_von;
end $$;
grant execute on function kho.bang_gia(text, date) to authenticated;

-- Ô TÍNH NHANH — cascade từ 1 giá vốn bất kỳ (không đọc bảng giá vốn; chỉ dùng tham số).
create or replace function kho.gia_bac_tu_gv(p_gv numeric, p_dong text default 'le', p_nhom numeric default 1)
  returns jsonb language plpgsql security definer set search_path = kho stable as $$
declare t record; v_m numeric; v_hh numeric; v_phi numeric; v_vat numeric; v_t1 numeric; v_san numeric; v_mult numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'gia_bac_tu_gv: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  if t.he_so_m is null then return jsonb_build_object('he_so_m', null); end if;
  v_m := t.he_so_m;
  v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke else t.phi_don_le end;
  v_vat := coalesce(t.vat,0)/100;
  v_mult := 1 + (v_m - 1) * coalesce(p_nhom,1);
  v_t1 := round(p_gv * v_mult);
  v_san := round((v_t1 + v_phi) / (1 - v_hh));
  return jsonb_build_object('he_so_m', v_m, 'mult', v_mult, 'tang_1', v_t1, 'phi', v_phi, 'hh', v_hh,
    'gia_san', v_san, 'bao_khach', round(v_san * (1 + v_vat)), 'vat', t.vat, 'tran_sale', t.tran_sale);
end $$;
grant execute on function kho.gia_bac_tu_gv(numeric, text, numeric) to authenticated;

-- ④ CHỐT NIÊM YẾT — ghi tang_1 + gia_le (giá lẻ CHƯA VAT) cho MỌI mẫu vào gia_niem_yet, kèm ai/lúc nào.
create or replace function kho.chot_niem_yet(p_ma_ky text)
  returns integer language plpgsql security definer set search_path = kho as $$
declare v_m numeric; v_hh numeric; v_phi numeric; v_ngay date; v_uid uuid; n int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'chot_niem_yet: chỉ ceo/ke_toan'; end if;
  select he_so_m, coalesce(hh_sale,0)+coalesce(hh_quan_ly,0)+coalesce(hh_thiet_ke,0), phi_don_le, coalesce(ngay_ap_dung, current_date)
    into v_m, v_hh, v_phi, v_ngay from kho.tham_so_tai_chinh where ma_ky = p_ma_ky;
  if v_m is null then raise exception 'chot_niem_yet: he_so_m chưa tính cho kỳ % — chưa chốt được', p_ma_ky; end if;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.gia_niem_yet(ma_ky, sku_mau, tang_1, gia_le, he_so_nhom, ngay_ap_dung, chot_luc, chot_boi)
    select p_ma_ky, g.ma, round(g.gia_von*v_m), round((g.gia_von*v_m + v_phi)/(1-v_hh)), 1, v_ngay, now(), v_uid
    from kho.san_pham_mau_gia_von g join kho.san_pham_mau s on s.ma = g.ma where not s.ngung
  on conflict (ma_ky, sku_mau) do update set
    tang_1 = excluded.tang_1, gia_le = excluded.gia_le, ngay_ap_dung = excluded.ngay_ap_dung,
    chot_luc = excluded.chot_luc, chot_boi = excluded.chot_boi;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function kho.chot_niem_yet(text) to authenticated;

-- Trạng thái niêm yết của kỳ (đã chốt lúc nào, ai) — cho app hiện sau khi chốt.
create or replace function kho.niem_yet_info(p_ma_ky text)
  returns jsonb language sql security definer set search_path = kho stable as $$
  select jsonb_build_object('so_dong', count(*), 'chot_luc', max(y.chot_luc),
    'chot_boi', (select n.ho_ten from kho.gia_niem_yet y2 join kho.nguoi_dung n on n.id = y2.chot_boi
                 where y2.ma_ky = p_ma_ky order by y2.chot_luc desc limit 1))
  from kho.gia_niem_yet y where y.ma_ky = p_ma_ky;
$$;
grant execute on function kho.niem_yet_info(text) to authenticated;

commit;
