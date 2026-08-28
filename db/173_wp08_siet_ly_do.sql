-- db/173 (WP-08 L-06) — SIẾT LÝ DO khi sửa mẫu đang có món chạy (đi CÙNG UI trong một lệnh — 06 §1c).
--   Đổi tiêu chí copy-on-write: dùng so_mon_dang_chay (đang chạy) thay "exists any neo" (khớp L-05, MỘT công thức).
--   so_mon_dang_chay > 0 + lý do rỗng → RAISE (UI có ô lý do). = 0 → sửa tại chỗ, lý do không bắt buộc.
begin;

-- Dọn overload cũ: CREATE OR REPLACE với +p_ly_do (db/171) TẠO HÀM MỚI, để lại bản 6/2-tham-số cũ → gọi bị nhập nhằng.
drop function if exists kho.qt_luu_buoc(text, integer, text, integer[], text, numeric);
drop function if exists kho.qt_xoa_buoc(text, integer);

CREATE OR REPLACE FUNCTION kho.qt_luu_buoc(p_qt text, p_thu_tu integer, p_hoat_dong text, p_buoc_truoc integer[], p_nhanh text, p_phut numeric, p_ly_do text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_loi jsonb; v_gio numeric; v_hh int; v_sc int; v_new int; v_nguoi text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_qt) then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  if not exists (select 1 from kho.don_gia_baseline where hoat_dong = p_hoat_dong) then raise exception 'qt: hoạt động "%" không có trong danh mục', p_hoat_dong; end if;
  if coalesce(p_nhanh,'chung') not in ('thùng','cánh','chung') then raise exception 'qt: nhánh "%" không hợp lệ', p_nhanh; end if;
  if p_phut is null or p_phut < 0 then raise exception 'qt: phút phải >= 0'; end if;
  v_gio := round((p_phut / 60.0)::numeric, 6);
  v_nguoi := kho.current_vai_tro() || ':' || coalesce(kho.current_ns()::text, '?');

  select phien_ban into v_hh from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt and trang_thai = 'hien_hanh';
  if v_hh is null then
    v_hh := coalesce((select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt), 1);
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, ly_do) values (p_qt, v_hh, 'hien_hanh', 'tự đăng ký lúc dựng mẫu') on conflict do nothing;
  end if;
  v_sc := kho.so_mon_dang_chay(p_qt);
  if v_sc > 0 and coalesce(btrim(p_ly_do),'') = '' then
    raise exception 'Mẫu này đang có % món chạy — nhập lý do sửa để phát hành bản mới', v_sc; end if;

  if v_sc > 0 then
    -- COPY-ON-WRITE: chép toàn bộ bước sang v_new (giữ thu_tu), áp thay đổi, phát hành
    v_new := (select max(phien_ban) + 1 from kho.quy_trinh_buoc where ma_quy_trinh = p_qt);
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu)
      select ma_quy_trinh, v_new, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu
      from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_hh;
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam)
      values (p_qt, v_new, p_thu_tu, p_hoat_dong, coalesce(p_buoc_truoc, array[]::int[]), coalesce(p_nhanh,'chung'), 'nguoi', 0, v_gio, true)
      on conflict (ma_quy_trinh, phien_ban, thu_tu) do update
        set hoat_dong = excluded.hoat_dong, buoc_truoc = excluded.buoc_truoc, nhanh = excluded.nhanh, gio_moi_don_vi = excluded.gio_moi_don_vi;
    v_loi := kho.kiem_quy_trinh(p_qt, v_new);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    update kho.quy_trinh_phien_ban set trang_thai = 'cu' where ma_quy_trinh = p_qt and phien_ban = v_hh;
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, phat_hanh_luc, nguoi_phat_hanh, ly_do)
      values (p_qt, v_new, 'hien_hanh', now(), v_nguoi, p_ly_do);
    return jsonb_build_object('ok', true, 'che_do', 'da_phat_hanh_phien_ban', 'phien_ban_moi', v_new, 'phien_ban_cu', v_hh, 'so_mon_dang_chay', v_sc, 'thu_tu', p_thu_tu, 'gio_moi_don_vi', v_gio);
  else
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam)
      values (p_qt, v_hh, p_thu_tu, p_hoat_dong, coalesce(p_buoc_truoc, array[]::int[]), coalesce(p_nhanh,'chung'), 'nguoi', 0, v_gio, true)
      on conflict (ma_quy_trinh, phien_ban, thu_tu) do update
        set hoat_dong = excluded.hoat_dong, buoc_truoc = excluded.buoc_truoc, nhanh = excluded.nhanh, gio_moi_don_vi = excluded.gio_moi_don_vi;
    v_loi := kho.kiem_quy_trinh(p_qt, v_hh);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    return jsonb_build_object('ok', true, 'che_do', 'sua_tai_cho', 'phien_ban', v_hh, 'thu_tu', p_thu_tu, 'gio_moi_don_vi', v_gio);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION kho.qt_xoa_buoc(p_qt text, p_thu_tu integer, p_ly_do text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_loi jsonb; v_hh int; v_sc int; v_new int; v_nguoi text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  v_nguoi := kho.current_vai_tro() || ':' || coalesce(kho.current_ns()::text, '?');
  select phien_ban into v_hh from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt and trang_thai = 'hien_hanh';
  if v_hh is null then v_hh := coalesce((select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt), 1);
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, ly_do) values (p_qt, v_hh, 'hien_hanh', 'tự đăng ký lúc dựng mẫu') on conflict do nothing; end if;
  v_sc := kho.so_mon_dang_chay(p_qt);
  if v_sc > 0 and coalesce(btrim(p_ly_do),'') = '' then
    raise exception 'Mẫu này đang có % món chạy — nhập lý do sửa để phát hành bản mới', v_sc; end if;

  if v_sc > 0 then
    v_new := (select max(phien_ban) + 1 from kho.quy_trinh_buoc where ma_quy_trinh = p_qt);
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu)
      select ma_quy_trinh, v_new, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu
      from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_hh and thu_tu <> p_thu_tu;
    v_loi := kho.kiem_quy_trinh(p_qt, v_new);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    update kho.quy_trinh_phien_ban set trang_thai = 'cu' where ma_quy_trinh = p_qt and phien_ban = v_hh;
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, phat_hanh_luc, nguoi_phat_hanh, ly_do)
      values (p_qt, v_new, 'hien_hanh', now(), v_nguoi, p_ly_do);
    return jsonb_build_object('ok', true, 'che_do', 'da_phat_hanh_phien_ban', 'phien_ban_moi', v_new, 'phien_ban_cu', v_hh, 'so_mon_dang_chay', v_sc, 'xoa', p_thu_tu);
  else
    delete from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_hh and thu_tu = p_thu_tu;
    v_loi := kho.kiem_quy_trinh(p_qt, v_hh);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    return jsonb_build_object('ok', true, 'che_do', 'sua_tai_cho', 'xoa', p_thu_tu);
  end if;
end $function$;

-- qt_chi_tiet +p_phien_ban (NULL=hien_hanh) để XEM BẢN CŨ chỉ đọc; chữ ký 1-tham-số web cũ vẫn chạy (default).
drop function if exists kho.qt_chi_tiet(text);
CREATE OR REPLACE FUNCTION kho.qt_chi_tiet(p_qt text, p_phien_ban int DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_buoc jsonb; v_chua int; v_da int; v_ten text; v_pb int; v_hh int; v_tt text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select ten into v_ten from kho.quy_trinh where ma_quy_trinh = p_qt;
  if not found then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  v_hh := coalesce((select pb.phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh = p_qt and pb.trang_thai = 'hien_hanh'),
                   (select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt));
  v_pb := coalesce(p_phien_ban, v_hh);
  select trang_thai into v_tt from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt and phien_ban = v_pb;
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
    where b.ma_quy_trinh = p_qt and b.phien_ban = v_pb;
  select count(*) filter (where dh.trang_thai not in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao')),
         count(*) filter (where dh.trang_thai     in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'))
    into v_chua, v_da
    from kho.don_hang_mon m join kho.don_hang dh on dh.id = m.don_id
    where kho.qt_hieu_luc(m.id) = p_qt;
  return jsonb_build_object('ma_quy_trinh', p_qt, 'ten', v_ten,
    'phien_ban', v_pb, 'phien_ban_hien_hanh', v_hh, 'la_ban_cu', (v_pb <> v_hh), 'trang_thai_ban', v_tt,
    'so_mon_dang_chay', kho.so_mon_dang_chay(p_qt),
    'cac_phien_ban', coalesce((select jsonb_agg(jsonb_build_object('phien_ban', phien_ban, 'trang_thai', trang_thai, 'ly_do', ly_do) order by phien_ban desc) from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt), '[]'::jsonb),
    'so_buoc', jsonb_array_length(v_buoc), 'so_mon_dung', v_chua + v_da,
    'mon_chua_ban_giao', v_chua, 'mon_da_ban_giao', v_da, 'buoc', v_buoc);
end $function$;
grant execute on function kho.qt_chi_tiet(text, int) to authenticated;

commit;
