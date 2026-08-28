-- db/171 (WP-08 L-04) — COPY-ON-WRITE khi sửa mẫu (đã có món neo) + MỘT CỔNG GHI + đổi phiên bản tường minh.
--   Sửa mẫu mà bản hien_hanh ĐÃ có món neo → KHÔNG sửa tại chỗ; chép sang phien_ban max+1, phát hành, bản cũ 'cu'
--   (MES 4.2.5: bản cũ phải còn đọc được). Chưa món nào neo → sửa tại chỗ (tránh rác phiên bản lúc dựng mẫu).
--   Chốt chặn client: revoke I/U/D quy_trinh_buoc/quy_trinh_phien_ban khỏi authenticated; chỉ RPC DEFINER ghi.
begin;

-- ═══ 4a. Bảng lịch sử đổi phiên bản của MÓN (append-only) ═══
create table if not exists kho.mon_doi_phien_ban (
  id            bigserial primary key,
  mon_id        uuid not null references kho.don_hang_mon(id),
  tu_phien_ban  int,
  den_phien_ban int not null,
  ly_do         text not null,
  nguoi         text,
  luc           timestamptz not null default now()
);
comment on table kho.mon_doi_phien_ban is 'WP-08: lịch sử kéo món sang phiên bản mẫu khác (ERP 6.5.5). Append-only, client chỉ đọc.';
grant select on kho.mon_doi_phien_ban to authenticated;

-- ═══ 1. qt_luu_buoc — copy-on-write có điều kiện ═══
CREATE OR REPLACE FUNCTION kho.qt_luu_buoc(p_qt text, p_thu_tu integer, p_hoat_dong text, p_buoc_truoc integer[], p_nhanh text, p_phut numeric, p_ly_do text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_loi jsonb; v_gio numeric; v_hh int; v_co_neo boolean; v_new int; v_nguoi text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_qt) then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  if not exists (select 1 from kho.don_gia_baseline where hoat_dong = p_hoat_dong) then raise exception 'qt: hoạt động "%" không có trong danh mục', p_hoat_dong; end if;
  if coalesce(p_nhanh,'chung') not in ('thùng','cánh','chung') then raise exception 'qt: nhánh "%" không hợp lệ', p_nhanh; end if;
  if p_phut is null or p_phut < 0 then raise exception 'qt: phút phải >= 0'; end if;
  v_gio := round((p_phut / 60.0)::numeric, 6);
  v_nguoi := kho.current_vai_tro() || ':' || coalesce(kho.current_ns()::text, '?');

  -- hien_hanh; mẫu chưa đăng ký phiên bản → tự đăng ký v1 (nợ L-03)
  select phien_ban into v_hh from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt and trang_thai = 'hien_hanh';
  if v_hh is null then
    v_hh := coalesce((select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt), 1);
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, ly_do) values (p_qt, v_hh, 'hien_hanh', 'tự đăng ký lúc dựng mẫu') on conflict do nothing;
  end if;
  v_co_neo := exists (select 1 from kho.don_hang_mon m where m.quy_trinh_phien_ban = v_hh and (select ma_quy_trinh from kho.quy_trinh_cua_mon(m.id)) = p_qt);

  if v_co_neo then
    -- COPY-ON-WRITE: chép toàn bộ bước sang v_new (GIỮ NGUYÊN thu_tu), áp thay đổi, phát hành
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
    return jsonb_build_object('ok', true, 'che_do', 'da_phat_hanh_phien_ban', 'phien_ban_moi', v_new, 'phien_ban_cu', v_hh, 'thu_tu', p_thu_tu, 'gio_moi_don_vi', v_gio);
  else
    -- SỬA TẠI CHỖ (mẫu chưa món nào neo)
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam)
      values (p_qt, v_hh, p_thu_tu, p_hoat_dong, coalesce(p_buoc_truoc, array[]::int[]), coalesce(p_nhanh,'chung'), 'nguoi', 0, v_gio, true)
      on conflict (ma_quy_trinh, phien_ban, thu_tu) do update
        set hoat_dong = excluded.hoat_dong, buoc_truoc = excluded.buoc_truoc, nhanh = excluded.nhanh, gio_moi_don_vi = excluded.gio_moi_don_vi;
    v_loi := kho.kiem_quy_trinh(p_qt, v_hh);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    return jsonb_build_object('ok', true, 'che_do', 'sua_tai_cho', 'phien_ban', v_hh, 'thu_tu', p_thu_tu, 'gio_moi_don_vi', v_gio);
  end if;
end $function$;

-- ═══ 1b. qt_xoa_buoc — copy-on-write có điều kiện ═══
CREATE OR REPLACE FUNCTION kho.qt_xoa_buoc(p_qt text, p_thu_tu integer, p_ly_do text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_loi jsonb; v_hh int; v_co_neo boolean; v_new int; v_nguoi text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  v_nguoi := kho.current_vai_tro() || ':' || coalesce(kho.current_ns()::text, '?');
  select phien_ban into v_hh from kho.quy_trinh_phien_ban where ma_quy_trinh = p_qt and trang_thai = 'hien_hanh';
  if v_hh is null then v_hh := coalesce((select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt), 1);
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, ly_do) values (p_qt, v_hh, 'hien_hanh', 'tự đăng ký lúc dựng mẫu') on conflict do nothing; end if;
  v_co_neo := exists (select 1 from kho.don_hang_mon m where m.quy_trinh_phien_ban = v_hh and (select ma_quy_trinh from kho.quy_trinh_cua_mon(m.id)) = p_qt);

  if v_co_neo then
    v_new := (select max(phien_ban) + 1 from kho.quy_trinh_buoc where ma_quy_trinh = p_qt);
    insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu)
      select ma_quy_trinh, v_new, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, to_phu_trach, ghi_chu
      from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_hh and thu_tu <> p_thu_tu;   -- chép TRỪ bước xoá
    v_loi := kho.kiem_quy_trinh(p_qt, v_new);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    update kho.quy_trinh_phien_ban set trang_thai = 'cu' where ma_quy_trinh = p_qt and phien_ban = v_hh;
    insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, phat_hanh_luc, nguoi_phat_hanh, ly_do)
      values (p_qt, v_new, 'hien_hanh', now(), v_nguoi, p_ly_do);
    return jsonb_build_object('ok', true, 'che_do', 'da_phat_hanh_phien_ban', 'phien_ban_moi', v_new, 'phien_ban_cu', v_hh, 'xoa', p_thu_tu);
  else
    delete from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_hh and thu_tu = p_thu_tu;
    v_loi := kho.kiem_quy_trinh(p_qt, v_hh);
    if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
    return jsonb_build_object('ok', true, 'che_do', 'sua_tai_cho', 'xoa', p_thu_tu);
  end if;
end $function$;

-- ═══ 2. qt_chep — đăng ký v1 hien_hanh + chỉ chép bản hien_hanh của nguồn ═══
CREATE OR REPLACE FUNCTION kho.qt_chep(p_ma_moi text, p_ten_moi text, p_nguon text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare n int; v_nguon_hh int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if coalesce(btrim(p_ma_moi),'') = '' or coalesce(btrim(p_ten_moi),'') = '' then raise exception 'qt: cần mã và tên mới'; end if;
  if exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_ma_moi) then raise exception 'MA_TRUNG: đã có quy trình mã "%"', p_ma_moi; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_nguon) then raise exception 'qt: không có quy trình nguồn "%"', p_nguon; end if;
  v_nguon_hh := coalesce((select phien_ban from kho.quy_trinh_phien_ban where ma_quy_trinh = p_nguon and trang_thai = 'hien_hanh'),
                         (select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_nguon), 1);
  insert into kho.quy_trinh(ma_quy_trinh, ten, mo_ta, dang_dung) values (p_ma_moi, p_ten_moi, 'Chép từ '||p_nguon, true);
  insert into kho.quy_trinh_buoc(ma_quy_trinh, phien_ban, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, ghi_chu)
    select p_ma_moi, 1, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam, ghi_chu
    from kho.quy_trinh_buoc where ma_quy_trinh = p_nguon and phien_ban = v_nguon_hh;
  insert into kho.quy_trinh_phien_ban(ma_quy_trinh, phien_ban, trang_thai, ly_do) values (p_ma_moi, 1, 'hien_hanh', 'chép từ '||p_nguon);
  select count(*) into n from kho.quy_trinh_buoc where ma_quy_trinh = p_ma_moi;
  return jsonb_build_object('ok', true, 'ma_quy_trinh', p_ma_moi, 'so_buoc', n);
end $function$;

-- ═══ 4b. qt_doi_phien_ban_mon (ERP 6.5.5) — kéo món đang chạy sang bản khác, tường minh ═══
CREATE OR REPLACE FUNCTION kho.qt_doi_phien_ban_mon(p_mon_id uuid, p_phien_ban int, p_ly_do text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_qt text; v_tu int; v_tt text; v_nguoi text; t record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'qt_doi_phien_ban_mon: chỉ ceo/xuong'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'qt_doi_phien_ban_mon: cần LÝ DO (không được rỗng)'; end if;
  select quy_trinh_phien_ban into v_tu from kho.don_hang_mon where id = p_mon_id;
  if not found then raise exception 'qt_doi_phien_ban_mon: không có món "%"', p_mon_id; end if;
  if v_tu is null then raise exception 'CHUA_BAN_GIAO: món "%" chưa bàn giao (chưa neo phiên bản)', p_mon_id; end if;
  select d.trang_thai into v_tt from kho.don_hang d join kho.don_hang_mon m on m.don_id = d.id where m.id = p_mon_id;
  if v_tt in ('xong_sx','cho_giao','da_giao') then raise exception 'DA_XONG_SX: món "%" đã xong SX / đã giao — không đổi phiên bản', p_mon_id; end if;
  select ma_quy_trinh into v_qt from kho.quy_trinh_cua_mon(p_mon_id);
  if not exists (select 1 from kho.quy_trinh_phien_ban where ma_quy_trinh = v_qt and phien_ban = p_phien_ban) then
    raise exception 'PHIEN_BAN_LA: mẫu "%" không có phiên bản %', v_qt, p_phien_ban; end if;
  v_nguoi := kho.current_vai_tro() || ':' || coalesce(kho.current_ns()::text, '?');
  update kho.don_hang_mon set quy_trinh_phien_ban = p_phien_ban where id = p_mon_id;   -- DEFINER: trigger chặn client vẫn đứng
  insert into kho.mon_doi_phien_ban(mon_id, tu_phien_ban, den_phien_ban, ly_do, nguoi) values (p_mon_id, v_tu, p_phien_ban, p_ly_do, v_nguoi);
  for t in select ma_tam from kho.tem_ban_ve where mon_id = p_mon_id loop perform kho.capnhat_tien_do_tem(t.ma_tam); end loop;
  return jsonb_build_object('ok', true, 'mon_id', p_mon_id, 'tu_phien_ban', v_tu, 'den_phien_ban', p_phien_ban);
end $function$;
grant execute on function kho.qt_doi_phien_ban_mon(uuid, int, text) to authenticated;

-- ═══ 3. MỘT CỔNG GHI: chỉ RPC DEFINER ghi được quy_trinh_buoc + quy_trinh_phien_ban ═══
revoke insert, update, delete on kho.quy_trinh_buoc from authenticated;
revoke insert, update, delete on kho.quy_trinh_phien_ban from authenticated;
drop policy if exists qtb_ghi on kho.quy_trinh_buoc;   -- policy ALL không còn cần (đã revoke grant)

commit;
