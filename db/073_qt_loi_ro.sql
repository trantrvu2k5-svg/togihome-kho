-- 073 — Thông báo lỗi quy trình NÊU TÊN BƯỚC (L-13c SỬA 3). Idempotent.
--   qt_luu_buoc/qt_xoa_buoc raise câu ĐÚNG lỗi thật + tên bước, thay vì liệt kê ba lỗi chung chung.
--   Chạy: cd web && node ops/run_sql.mjs ../db/073_qt_loi_ro.sql
begin;

-- format mảng lỗi kiem_quy_trinh → câu tiếng Việt, nêu số thứ tự bước. Nhiều lỗi → mỗi cái một dòng.
create or replace function kho.qt_loi_text(p_loi jsonb) returns text
  language plpgsql immutable set search_path = kho as $$
declare e jsonb; parts text[] := '{}'; cyc int[];
begin
  -- chu trình: gom mọi 'tai' vào MỘT câu
  select array_agg(distinct (v->>'tai')::int order by (v->>'tai')::int) into cyc
    from jsonb_array_elements(p_loi) v where v->>'loai' = 'chu_trinh';
  if cyc is not null and cardinality(cyc) > 0 then
    if cardinality(cyc) = 1 then parts := array_append(parts, 'Bước ' || cyc[1] || ' chờ vòng lại chính nó.');
    else parts := array_append(parts, 'Bước ' || array_to_string(cyc, ' và ') || ' chờ vòng lại nhau.'); end if;
  end if;
  for e in select * from jsonb_array_elements(p_loi) loop
    if e->>'loai' = 'khong_co_buoc_khoi_dau' then parts := array_append(parts, 'Không bước nào là bước đầu tiên.');
    elsif e->>'loai' = 'buoc_truoc_khong_ton_tai' then parts := array_append(parts, 'Bước ' || (e->>'thu_tu') || ' trỏ tới bước ' || (e->>'thieu') || ' không tồn tại.');
    -- "không đi tới được" thường LÀ HỆ QUẢ của chu trình → có chu trình thì ẩn, chỉ báo cái gốc
    elsif e->>'loai' = 'khong_voi_toi' and (cyc is null or cardinality(cyc) = 0) then parts := array_append(parts, 'Bước ' || (e->>'thu_tu') || ' không đi tới được từ bước đầu.');
    end if;
  end loop;
  return array_to_string(parts, E'\n');
end $$;

-- qt_luu_buoc: raise câu lỗi ĐÚNG + tên bước
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
  v_gio := round((p_phut / 60.0)::numeric, 6);
  insert into kho.quy_trinh_buoc(ma_quy_trinh, thu_tu, hoat_dong, buoc_truoc, nhanh, loai_buoc, gio_co_dinh, gio_moi_don_vi, la_tam)
    values (p_qt, p_thu_tu, p_hoat_dong, coalesce(p_buoc_truoc, array[]::int[]), coalesce(p_nhanh,'chung'), 'nguoi', 0, v_gio, true)
    on conflict (ma_quy_trinh, thu_tu) do update
      set hoat_dong = excluded.hoat_dong, buoc_truoc = excluded.buoc_truoc, nhanh = excluded.nhanh, gio_moi_don_vi = excluded.gio_moi_don_vi;
  v_loi := kho.kiem_quy_trinh(p_qt);
  if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
  return jsonb_build_object('ok', true, 'thu_tu', p_thu_tu, 'phut', p_phut, 'gio_moi_don_vi', v_gio);
end $$;

create or replace function kho.qt_xoa_buoc(p_qt text, p_thu_tu int)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_loi jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'qt: chỉ ceo/thiet_ke'; end if;
  delete from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and thu_tu = p_thu_tu;
  v_loi := kho.kiem_quy_trinh(p_qt);
  if jsonb_array_length(v_loi) > 0 then raise exception 'QT_LOI: %', kho.qt_loi_text(v_loi); end if;
  return jsonb_build_object('ok', true, 'xoa', p_thu_tu);
end $$;

commit;
