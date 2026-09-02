-- db/210 · WP-72 L-72c · sale_bao_gia_han_dem ĐẾM MỌI đơn bao_gia (bỏ lọc la_demo) — khớp population với sale_bao_gia_ds.
--   Lý do (L-72c B3): khối đầu màn phải đếm đúng các đơn báo giá đang hiện trong danh sách; danh sách (sale_bao_gia_ds)
--   VỐN hiện cả đơn demo. Lọc demo ở L-72b làm robot không đếm được (test_ chỉ tạo được đơn demo) + khối lệch danh sách.
--   "0 đơn thật → trống" vẫn đúng: khi 0 đơn bao_gia (thật hay demo) thì tong_don=0 → UI hiện trạng thái trống.
--   ⚠ Cổng backup QD-61. Chỉ REPLACE 1 hàm. HOÀN TÁC: chạy lại db/209 (bản có lọc la_demo).
begin;
create or replace function kho.sale_bao_gia_han_dem()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); r jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'sale_bao_gia_han_dem: chỉ sale/truong_nhom_sale/ceo/ke_toan (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select jsonb_build_object(
    'qua_han',     jsonb_build_object('so', count(*) filter (where han_tra_loi is not null and han_tra_loi < current_date),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is not null and han_tra_loi < current_date),0)),
    'sap_het_han', jsonb_build_object('so', count(*) filter (where han_tra_loi is not null and han_tra_loi >= current_date and han_tra_loi - current_date <= 3),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is not null and han_tra_loi >= current_date and han_tra_loi - current_date <= 3),0)),
    'con_han',     jsonb_build_object('so', count(*) filter (where han_tra_loi is null or han_tra_loi - current_date > 3),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is null or han_tra_loi - current_date > 3),0)),
    'tong_don', count(*)
  ) into r
  from (select d.han_tra_loi, coalesce(d.doanh_thu, d.gia_goc, 0) tien
        from kho.don_hang d
        where d.trang_thai = 'bao_gia'                                   -- ĐẾM MỌI đơn bao_gia (kể cả demo) — khớp danh sách
          and (v_vai <> 'sale' or d.sale_phu_trach = v_ns)) x;
  return r;
end $$;
revoke all on function kho.sale_bao_gia_han_dem() from anon;
grant execute on function kho.sale_bao_gia_han_dem() to authenticated;
do $$ begin raise notice 'db/210 OK: sale_bao_gia_han_dem đếm mọi đơn bao_gia (bỏ lọc demo).'; end $$;
commit;
