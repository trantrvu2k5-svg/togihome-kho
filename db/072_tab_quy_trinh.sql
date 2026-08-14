-- 072 — RPC cho TAB QUY TRÌNH (app sản phẩm). THUẦN DB (read + sửa bước). Guard ceo/thiet_ke.
--   Sửa bước LUÔN gọi kiem_quy_trinh → lỗi thì raise (rollback) = fail-đóng. Nhập PHÚT → gio_moi_don_vi = phút/60.
--   Chạy: cd web && node ops/run_sql.mjs ../db/072_tab_quy_trinh.sql
begin;

-- helper NỘI BỘ (không grant): quy trình HIỆU LỰC của 1 món (gán ở món > gợi ý lõi)
create or replace function kho.qt_hieu_luc(p_mon uuid) returns text
  language sql stable security definer set search_path = kho as $$
  select coalesce(m.ma_quy_trinh,
    (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))
  from kho.don_hang_mon m where m.id = p_mon;
$$;

-- ─────────── cột trái: danh sách quy trình ───────────
create or replace function kho.qt_ds()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'ma_quy_trinh', q.ma_quy_trinh, 'ten', q.ten,
      'so_buoc', (select count(*)::int from kho.quy_trinh_buoc b where b.ma_quy_trinh = q.ma_quy_trinh),
      'so_mon_dung', (select count(*)::int from kho.don_hang_mon m where kho.qt_hieu_luc(m.id) = q.ma_quy_trinh)
    ) order by q.ma_quy_trinh), '[]'::jsonb) into v
    from kho.quy_trinh q where coalesce(q.dang_dung, true);
  return v;
end $$;
grant execute on function kho.qt_ds() to authenticated;

-- ─────────── cột phải khối 1: chi tiết quy trình + bước + số món (2 vế bàn giao) ───────────
create or replace function kho.qt_chi_tiet(p_qt text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_buoc jsonb; v_chua int; v_da int; v_ten text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select ten into v_ten from kho.quy_trinh where ma_quy_trinh = p_qt;
  if not found then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'thu_tu', b.thu_tu, 'hoat_dong', b.hoat_dong,
      'ten_hoat_dong', d.ten, 'ma_to', d.ma_to, 'don_gia', d.don_gia,
      'buoc_truoc', to_jsonb(coalesce(b.buoc_truoc, array[]::int[])),
      'nhanh', coalesce(b.nhanh,'chung'), 'loai_buoc', coalesce(b.loai_buoc,'nguoi'),
      'gio_co_dinh', b.gio_co_dinh,
      'phut', case when b.loai_buoc = 'tu_chay' then null else round((coalesce(b.gio_moi_don_vi,0) * 60)::numeric, 1) end,
      'la_tam', coalesce(b.la_tam, false)
    ) order by b.thu_tu), '[]'::jsonb) into v_buoc
    from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
    where b.ma_quy_trinh = p_qt;
  -- số món dùng, tách CHƯA bàn giao (sẽ đổi) vs ĐÃ bàn giao (giữ nguyên)
  select count(*) filter (where dh.trang_thai not in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao')),
         count(*) filter (where dh.trang_thai     in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'))
    into v_chua, v_da
    from kho.don_hang_mon m join kho.don_hang dh on dh.id = m.don_id
    where kho.qt_hieu_luc(m.id) = p_qt;
  return jsonb_build_object('ma_quy_trinh', p_qt, 'ten', v_ten,
    'so_buoc', jsonb_array_length(v_buoc), 'so_mon_dung', v_chua + v_da,
    'mon_chua_ban_giao', v_chua, 'mon_da_ban_giao', v_da, 'buoc', v_buoc);
end $$;
grant execute on function kho.qt_chi_tiet(text) to authenticated;

-- ─────────── "Xem N món": danh sách món dùng quy trình, tách hai vế ───────────
create or replace function kho.qt_so_mon(p_qt text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ma_don', dh.ma_don, 'ten', m.ten,
      'da_ban_giao', dh.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'),
      'trang_thai', dh.trang_thai) order by dh.ma_don), '[]'::jsonb) into v
    from kho.don_hang_mon m join kho.don_hang dh on dh.id = m.don_id
    where kho.qt_hieu_luc(m.id) = p_qt;
  return v;
end $$;
grant execute on function kho.qt_so_mon(text) to authenticated;

-- ─────────── cột phải khối 2: 12 hoạt động (chỉ đọc) ───────────
--   Phút/đơn vị = gio_moi_don_vi × 60 từ bước ĐẠI DIỆN (min ma_quy_trinh); hoạt động không ở QT nào → null ("—").
--   (baseline phút riêng cho hoạt động chưa vào QT = đơn giá/lô riêng — CEO chốt L-13.)
create or replace function kho.hoat_dong_ds()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'hoat_dong', d.hoat_dong, 'ten', d.ten, 'ma_to', d.ma_to, 'don_gia', d.don_gia,
      'phut', (select round((b.gio_moi_don_vi*60)::numeric,1) from kho.quy_trinh_buoc b
               where b.hoat_dong = d.hoat_dong and b.loai_buoc is distinct from 'tu_chay'
               order by b.ma_quy_trinh, b.thu_tu limit 1),
      'dung_o', (select count(distinct b.ma_quy_trinh)::int from kho.quy_trinh_buoc b where b.hoat_dong = d.hoat_dong),
      'la_tam', (select bool_or(coalesce(b.la_tam,false)) from kho.quy_trinh_buoc b where b.hoat_dong = d.hoat_dong)
    ) order by d.don_gia desc), '[]'::jsonb) into v
    from kho.don_gia_baseline d where d.hoat_dong <> 'cho_kho';   -- 12 hoạt động (bỏ cho_kho tự chạy)
  return v;
end $$;
grant execute on function kho.hoat_dong_ds() to authenticated;

-- ─────────── SỬA bước: upsert + kiem_quy_trinh (fail-đóng) ───────────
--   p_phut = phút/đơn vị người gõ → gio_moi_don_vi = phút/60. thu_tu = PK bước (mới: client gửi max+100).
create or replace function kho.qt_luu_buoc(p_qt text, p_thu_tu int, p_hoat_dong text, p_buoc_truoc int[],
                                           p_nhanh text, p_phut numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_loi jsonb; v_gio numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_qt) then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  if not exists (select 1 from kho.don_gia_baseline where hoat_dong = p_hoat_dong) then raise exception 'qt: hoạt động "%" không có trong danh mục', p_hoat_dong; end if;
  if coalesce(p_nhanh,'chung') not in ('thùng','cánh','chung') then raise exception 'qt: nhánh "%" không hợp lệ', p_nhanh; end if;
  if p_phut is null or p_phut < 0 then raise exception 'qt: phút phải >= 0'; end if;
  v_gio := round((p_phut / 60.0)::numeric, 6);   -- PHÚT → GIỜ (không bao giờ hiện 0,0333 cho người)
  insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam)
    values (p_qt, p_thu_tu, p_hoat_dong, coalesce(p_buoc_truoc, array[]::int[]), coalesce(p_nhanh,'chung'), 'nguoi', 0, v_gio, true)
    on conflict (ma_quy_trinh, thu_tu) do update
      set hoat_dong = excluded.hoat_dong, buoc_truoc = excluded.buoc_truoc, nhanh = excluded.nhanh,
          gio_moi_don_vi = excluded.gio_moi_don_vi;
  -- fail-đóng: đồ thị hỏng → KHÔNG lưu
  v_loi := kho.kiem_quy_trinh(p_qt);
  if jsonb_array_length(v_loi) > 0 then
    raise exception 'QT_LOI: quy trình hỏng sau khi sửa: %', v_loi::text; end if;
  return jsonb_build_object('ok', true, 'thu_tu', p_thu_tu, 'phut', p_phut, 'gio_moi_don_vi', v_gio);
end $$;
grant execute on function kho.qt_luu_buoc(text, int, text, int[], text, numeric) to authenticated;

create or replace function kho.qt_xoa_buoc(p_qt text, p_thu_tu int)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_loi jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  delete from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and thu_tu = p_thu_tu;
  v_loi := kho.kiem_quy_trinh(p_qt);
  if jsonb_array_length(v_loi) > 0 then
    raise exception 'QT_LOI: quy trình hỏng sau khi xoá bước: %', v_loi::text; end if;
  return jsonb_build_object('ok', true, 'xoa', p_thu_tu);
end $$;
grant execute on function kho.qt_xoa_buoc(text, int) to authenticated;

-- ─────────── CHÉP thành quy trình mới (mã trùng chặn; KHÔNG gán lõi/món nào) ───────────
create or replace function kho.qt_chep(p_ma_moi text, p_ten_moi text, p_nguon text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare n int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if coalesce(btrim(p_ma_moi),'') = '' or coalesce(btrim(p_ten_moi),'') = '' then raise exception 'qt: cần mã và tên mới'; end if;
  if exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_ma_moi) then raise exception 'MA_TRUNG: đã có quy trình mã "%"', p_ma_moi; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_nguon) then raise exception 'qt: không có quy trình nguồn "%"', p_nguon; end if;
  insert into kho.quy_trinh(ma_quy_trinh, ten, mo_ta, dang_dung) values (p_ma_moi, p_ten_moi, 'Chép từ '||p_nguon, true);
  insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, ghi_chu)
    select p_ma_moi, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, ghi_chu
    from kho.quy_trinh_buoc where ma_quy_trinh = p_nguon;
  select count(*) into n from kho.quy_trinh_buoc where ma_quy_trinh = p_ma_moi;
  return jsonb_build_object('ok', true, 'ma_quy_trinh', p_ma_moi, 'so_buoc', n);
end $$;
grant execute on function kho.qt_chep(text, text, text) to authenticated;

commit;
