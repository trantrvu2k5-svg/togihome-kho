-- db/172 (WP-08 L-05) — TÊN ĐỌC ĐƯỢC cho mẫu + số món đang chạy (một-chỗ) + màn sửa tên.
--   kho.quy_trinh ĐÃ CÓ cột `ten` (NOT NULL) + đã đặt tên đọc được → KHÔNG thêm cột, KHÔNG backfill.
--   Thêm: helper so_mon_dang_chay (tính MỘT chỗ) · qt_ds/qt_chi_tiet +ten/phien_ban_hien_hanh/so_mon_dang_chay
--   (giữ mọi trường cũ, không đổi chữ ký) · qt_doi_ten cho màn sửa tên.
begin;

-- ═══ so_mon_dang_chay: số món neo vào bản hien_hanh & CHƯA xong SX (nguồn DUY NHẤT — UI + copy-on-write đọc) ═══
create or replace function kho.so_mon_dang_chay(p_qt text)
 returns int language sql stable security definer set search_path to 'kho' as $fn$
  select count(*)::int
  from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
  where m.quy_trinh_phien_ban = (select pb.phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh = p_qt and pb.trang_thai = 'hien_hanh')
    and (select qm.ma_quy_trinh from kho.quy_trinh_cua_mon(m.id) qm) = p_qt
    and d.trang_thai in ('cho_cat','da_cat','dang_lam')   -- đã bàn giao, chưa xong SX
$fn$;
grant execute on function kho.so_mon_dang_chay(text) to authenticated;

-- ═══ qt_ds — +phien_ban_hien_hanh, +so_mon_dang_chay; so_buoc theo bản hien_hanh (giữ ten/so_mon_dung cũ) ═══
CREATE OR REPLACE FUNCTION kho.qt_ds()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'ma_quy_trinh', q.ma_quy_trinh, 'ten', q.ten,
      'phien_ban_hien_hanh', hh.pb,
      'so_buoc', (select count(*)::int from kho.quy_trinh_buoc b where b.ma_quy_trinh = q.ma_quy_trinh and b.phien_ban = coalesce(hh.pb, b.phien_ban)),
      'so_mon_dung', (select count(*)::int from kho.don_hang_mon m where kho.qt_hieu_luc(m.id) = q.ma_quy_trinh),
      'so_mon_dang_chay', kho.so_mon_dang_chay(q.ma_quy_trinh)
    ) order by q.ma_quy_trinh), '[]'::jsonb) into v
    from kho.quy_trinh q
    left join lateral (select pb.phien_ban pb from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh = q.ma_quy_trinh and pb.trang_thai = 'hien_hanh') hh on true
    where coalesce(q.dang_dung, true);
  return v;
end $function$;

-- ═══ qt_chi_tiet — lọc bước theo bản hien_hanh + +phien_ban_hien_hanh, +so_mon_dang_chay (giữ trường cũ) ═══
CREATE OR REPLACE FUNCTION kho.qt_chi_tiet(p_qt text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_buoc jsonb; v_chua int; v_da int; v_ten text; v_pb int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  select ten into v_ten from kho.quy_trinh where ma_quy_trinh = p_qt;
  if not found then raise exception 'qt: không có quy trình "%"', p_qt; end if;
  v_pb := coalesce((select pb.phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh = p_qt and pb.trang_thai = 'hien_hanh'),
                   (select min(phien_ban) from kho.quy_trinh_buoc where ma_quy_trinh = p_qt));
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
    'phien_ban_hien_hanh', v_pb, 'so_mon_dang_chay', kho.so_mon_dang_chay(p_qt),
    'so_buoc', jsonb_array_length(v_buoc), 'so_mon_dung', v_chua + v_da,
    'mon_chua_ban_giao', v_chua, 'mon_da_ban_giao', v_da, 'buoc', v_buoc);
end $function$;

-- ═══ qt_doi_ten — màn sửa tên (vai như qt_*); tên rỗng → RAISE ═══
CREATE OR REPLACE FUNCTION kho.qt_doi_ten(p_ma text, p_ten text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  if coalesce(btrim(p_ten),'') = '' then raise exception 'qt_doi_ten: tên không được rỗng'; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_ma) then raise exception 'qt_doi_ten: không có quy trình "%"', p_ma; end if;
  update kho.quy_trinh set ten = btrim(p_ten) where ma_quy_trinh = p_ma;
  return jsonb_build_object('ok', true, 'ma_quy_trinh', p_ma, 'ten', btrim(p_ten));
end $function$;
grant execute on function kho.qt_doi_ten(text, text) to authenticated;

commit;
