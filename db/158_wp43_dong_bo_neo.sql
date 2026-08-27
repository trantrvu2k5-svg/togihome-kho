-- db/158 (WP-43 L-14) — ĐỒNG BỘ NEO XUÔI của luu_xep_lich với ban_giao_xuong (db/157).
--   GỐC lệch: nút "Xếp lại đơn" (luu_xep_lich, kiểu xuoi) neo tuan_cua(current_date) = tuần ĐÓNG BĂNG
--   → đơn không hẹn (xếp được tự động) bị đẩy sang "cần CEO". Đường tự động (ban_giao_xuong) đã neo
--   VƯỢT đóng băng từ db/157. L-14 copy NGUYÊN công thức đó sang luu_xep_lich → hai đường cùng kết quả.
--   Kiểu 'nguoc' GIỮ NGUYÊN (neo = tuan_cua(ngay_hen_khach)). p_ngoai_le GIỮ NGUYÊN (CEO vẫn ép được).
--   KHÔNG đụng _sched, KHÔNG nới hàng rào đóng băng.
begin;

CREATE OR REPLACE FUNCTION kho.luu_xep_lich(p_ma_don text, p_kieu text, p_ngoai_le boolean DEFAULT false, p_ly_do text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_vai text; r jsonb; e jsonb; i int; v_tuan date; v_vung text; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'luu_xep_lich: chỉ ceo/xuong (sale chỉ gọi atp)'; end if;
  if p_kieu not in ('nguoc','xuoi') then raise exception 'luu_xep_lich: kiểu phải nguoc/xuoi'; end if;
  if p_kieu='nguoc' then
    r := kho._sched(p_ma_don,'nguoc', kho.tuan_cua((select ngay_hen_khach from kho.don_hang where ma_don=p_ma_don)));
  else
    -- [db/158] neo xuôi ĐỒNG BỘ với ban_giao_xuong (db/157): tuần đầu NGOÀI vùng đóng băng, đọc động moc_lich
    r := kho._sched(p_ma_don,'xuoi',
           kho.tuan_cua(current_date) + (coalesce((select so_tuan from kho.moc_lich where ma='dong_bang'),0) * 7));
  end if;
  if (r->>'ok')::boolean is not true then return r; end if;
  for i in 0 .. jsonb_array_length(r->'lich')-1 loop
    v_tuan := (r->'lich'->i->>'tuan')::date; v_vung := kho.vung_cua_tuan(v_tuan);
    if v_vung = 'dong_bang' then
      if not p_ngoai_le then raise exception 'luu_xep_lich: bước rơi vào tuần ĐÓNG BĂNG (%) — cần ngoại lệ', v_tuan; end if;
      if v_vai <> 'ceo' then raise exception 'luu_xep_lich: chỉ CEO mới xếp vào tuần đóng băng'; end if;
      if coalesce(btrim(p_ly_do),'') = '' then raise exception 'luu_xep_lich: ngoại lệ đóng băng BẮT BUỘC có lý do'; end if;
    end if;
  end loop;
  delete from kho.xep_lich where ma_don = p_ma_don;
  for i in 0 .. jsonb_array_length(r->'lich')-1 loop
    e := r->'lich'->i;
    insert into kho.xep_lich(ma_don,mon_id,buoc_thu_tu,hoat_dong,loai_buoc,tuan_bat_dau,ma_to,gio,kieu_xep,xep_boi,ly_do)
      values (p_ma_don, (e->>'mon_id')::uuid, (e->>'thu_tu')::int, e->>'hoat_dong', e->>'loai_buoc',
              (e->>'tuan')::date, e->>'ma_to', coalesce((e->>'gio')::numeric,0), p_kieu, kho.current_ns(), p_ly_do);
    n := n + 1;
  end loop;
  -- [WP-43] xếp lại thành công → DỌN cờ chua_xep_duoc (dải cảnh báo tắt)
  update kho.don_hang set chua_xep_duoc = false, ly_do_chua_xep = null, thu_xep_luc = now() where ma_don = p_ma_don;
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'kieu',p_kieu,'so_dong',n);
end $function$;
grant execute on function kho.luu_xep_lich(text, text, boolean, text) to authenticated;

-- [db/158] tl_don_chua_xep TRẢ THÊM ngay_hen_khach → client chọn kiểu xếp GIỐNG HỆT ban_giao_xuong
--   (có hẹn → 'nguoc' · không hẹn → 'xuoi'). Một luật, hai chỗ dùng.
create or replace function kho.tl_don_chua_xep() returns jsonb
  language sql stable security definer set search_path = kho as $$
  select coalesce(jsonb_agg(jsonb_build_object('ma_don', ma_don, 'ten_khach', ten_khach,
    'ly_do', ly_do_chua_xep, 'thu_xep_luc', thu_xep_luc, 'ngay_hen_khach', ngay_hen_khach)
    order by thu_xep_luc desc nulls last), '[]'::jsonb)
  from kho.don_hang where chua_xep_duoc;
$$;
grant execute on function kho.tl_don_chua_xep() to authenticated;

commit;

-- HOÀN TÁC: chạy lại db/156 (khối luu_xep_lich) để trả neo xuôi về tuan_cua(current_date).
