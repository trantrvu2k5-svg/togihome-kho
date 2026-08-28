-- db/161 (WP-45 L-19, hỗ trợ UI) — dữ liệu cho hàng rào ở màn Tải & lịch.
--   ① don_lich_meta(ma_don): UI biết TRƯỚC trạng thái + hẹn + đã khoá lịch chưa → hỏi lý do đúng lúc,
--      chọn kiểu theo dữ liệu (không để người bấm rồi mới ăn RAISE).
--   ② tl_viec_trong_o +cột khoa_lich_luc → gắn nhãn "đã bàn giao · lịch đã chốt" ngay trong ô lưới.
begin;

create or replace function kho.don_lich_meta(p_ma_don text) returns jsonb
  language sql stable security definer set search_path = kho as $$
  select case when kho.current_vai_tro() not in ('ceo','xuong') then
      jsonb_build_object('loi','chỉ ceo/xuong')
    else (select jsonb_build_object(
      'ma_don', d.ma_don, 'trang_thai', d.trang_thai, 'ngay_hen_khach', d.ngay_hen_khach,
      'khoa_lich_luc', d.khoa_lich_luc,
      -- đã vào sản xuất (từ cho_cat trở đi) → người bấm phải ghi lý do (planning fence db/160)
      'da_san_xuat', d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'))
      from kho.don_hang d where d.ma_don = p_ma_don) end;
$$;
grant execute on function kho.don_lich_meta(text) to authenticated;

-- tl_viec_trong_o: thêm cột khoa_lich_luc (để hiện nhãn khoá trong ô lưới) — đổi RETURNS TABLE nên phải DROP trước
drop function if exists kho.tl_viec_trong_o(text, date, int, int);
create or replace function kho.tl_viec_trong_o(p_ma_to text, p_tuan_bat_dau date, p_gioi_han int default 12, p_bo_qua int default 0)
  returns table(viec_id bigint, ma_don text, ten_khach text, ten_san_pham text,
                buoc_thu_tu int, ten_buoc text, gio numeric, la_hang_lam_san boolean,
                don_sap_tre boolean, khoa_lich_luc timestamptz, tong_so bigint)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_viec_trong_o: chỉ ceo/xuong'; end if;
  return query
  select xl.id, xl.ma_don, d.ten_khach, coalesce(dm.ten, d.ma_don),
         xl.buoc_thu_tu, coalesce(xl.hoat_dong,'—'), xl.gio,
         (coalesce(d.ten_khach,'') = '') as lms,
         kho.tl_don_sap_tre(xl.ma_don),
         d.khoa_lich_luc,
         count(*) over() as tong_so
  from kho.xep_lich xl
  join kho.don_hang d on d.ma_don = xl.ma_don
  left join kho.don_hang_mon dm on dm.id = xl.mon_id
  where xl.ma_to = p_ma_to and xl.tuan_bat_dau = p_tuan_bat_dau
  order by (coalesce(d.ten_khach,'') = '') desc, xl.buoc_thu_tu, xl.ma_don
  limit p_gioi_han offset p_bo_qua;
end $$;
grant execute on function kho.tl_viec_trong_o(text, date, int, int) to authenticated;

commit;
-- HOÀN TÁC: drop function kho.don_lich_meta(text); chạy lại db/085 (tl_viec_trong_o cũ, không cột khoa_lich_luc).
