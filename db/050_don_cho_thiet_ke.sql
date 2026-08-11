-- 050 — RPC don_cho_thiet_ke(): plugin KÉO đơn từ hệ đơn về để dựng hình. Bắc cầu chỗ ĐỨT: sale lên đơn
--   vào Supabase (không sinh file), plugin cần file có meta.id = mã đơn thật. RPC trả đơn + món (curated,
--   KHÔNG giá bán/tên khách/sđt/địa chỉ). Guard fail-đóng ceo/kho/thiet_ke.
--   node ops/run_sql.mjs ../db/050_don_cho_thiet_ke.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════  begin; drop function if exists kho.don_cho_thiet_ke(); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Flat: một dòng / MÓN; plugin gom theo ma_don. sp_id = mã mẫu (spec_path để dựng nếu có; rỗng = món tự do).
create or replace function kho.don_cho_thiet_ke()
  returns table(ma_don text, loai text, dong text, ngay_hen_khach date, ghi_chu_don text, la_demo boolean,
                mon_id uuid, sp_id text, ten text, kich_thuoc text, vat_lieu text, ma_mau text,
                so_luong numeric, ghi_chu_mon text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then
    raise exception 'don_cho_thiet_ke: chỉ ceo/kho/thiet_ke'; end if;
  return query
    select d.ma_don, d.loai, d.dong, d.ngay_hen_khach, d.ghi_chu, d.la_demo,
           m.id, m.sp_id, m.ten, m.kt, m.vl, m.ma_mau, m.so_luong, m.chi_tiet
    from kho.don_hang d
    join kho.don_hang_mon m on m.don_id = d.id
    where d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')
    order by d.ngay_hen_khach nulls last, d.ma_don, m.tao_luc nulls last, m.id;
end $$;
grant execute on function kho.don_cho_thiet_ke() to authenticated;

commit;
