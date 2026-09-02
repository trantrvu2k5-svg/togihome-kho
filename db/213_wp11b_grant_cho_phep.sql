-- db/213 · WP-11b · QD-96 · ĐẢO grant UPDATE don_hang: danh-sách-CẤM → danh-sách-CHO-PHÉP.
--   Bệnh (db/150, QD-66): grant UPDATE sinh động "mọi cột TRỪ trang_thai" từ information_schema → MỌI cột nghiệp vụ sinh SAU
--   tự hở ra tầng API. Đã trả giá 2 lần: ly_do_thua (db/212), han_tra_loi (db/209 vá riêng db/211). Nay cột mới mặc định ĐÓNG.
--   Whitelist = 63 cột (VIẾT TAY, không sinh từ information_schema — đó là điểm của WP). Đồng bộ db/grant_don_hang_whitelist.txt.
--   REVOKE 5 cột (đều 0 client ghi): id·ma_don·tao_luc (định danh/mốc DB) + la_demo·sale_phu_trach (hệ-tự-ghi, ngoài payload donToRow).
--   nguoi_tao GIỮ MỞ: hệ-tự-ghi (db/153) nhưng donToRow:74 còn gửi (null) trong payload → revoke sẽ gãy sale.js:255; gỡ khỏi payload rồi revoke ở lô UI sau.
--   trang_thai/ly_do_thua/ghi_chu_thua vẫn NGOÀI (db/150/212). KHÔNG đụng UI (40 cột donToRow + han_tra_loi đều còn grant).
--   ⚠ Cổng backup QD-61 (CẤM BO_QUA_BACKUP). HOÀN TÁC: chạy lại db/150 (grant động mọi-cột-trừ-trang_thai) + db/212 (revoke ly_do_thua/ghi_chu_thua).
begin;

-- (1) DỌN: bỏ hết grant UPDATE theo cột của db/150 (đặt lại nền)
revoke update on kho.don_hang from authenticated;

-- (2) CẤP LẠI theo DANH SÁCH CHO-PHÉP — 63 cột viết tay (KHÔNG information_schema)
grant update (
  ngay_chot, sdt_khach, ten_khach, dia_chi_khach, dong, so_mon, khach_moi, cap_thiet_ke,
  gia_goc, chiet_khau, doanh_thu, ma_ky_ap_dung, gio_thiet_ke, so_to_hop_vat_lieu,
  ngay_vao_chuyen, ngay_xong, khoi_luong_kg, dia_ban, don_vi_van_chuyen, ship_thuc_tra,
  lap_thuc_tra, ngay_thu, so_tien_thuc_thu, thuong_hieu, tk_coc, nguoi_tao, sua_luc,
  ly_do_huy, tien_coc, loai, link, lap_ai, file_tk, nguoi_tk, lo, ghi_chu, ngay_du_kien,
  ngay_di_hang, ngay_giao, kgs, hoa_don, tinh_khach, gia_cong_thuc, gia_chot,
  ma_ns_duyet_giam, ly_do_giam, ngay_tao_bao_gia, ngay_ket_thuc_bao_gia, ngay_hen_khach,
  ngay_hen_khach_ban_dau, danh_dau_gap, ma_ns_danh_dau, ly_do_gap, gap_luc, ma_ns_thiet_ke,
  luc_nhan_thiet_ke, buoc_thiet_ke, ma_ns_tk_ban_hang, phong_cach, ngan_sach_trieu,
  tu_dung, nguon_khach, han_tra_loi
) on kho.don_hang to authenticated;

-- (3) KIỂM: đúng 63 cột · 5 cột đã rớt · 3 cột cổng vẫn ngoài
do $$
declare v_n int;
begin
  select count(*) into v_n from information_schema.column_privileges
    where table_schema='kho' and table_name='don_hang' and privilege_type='UPDATE' and grantee='authenticated';
  if v_n <> 63 then raise exception 'SAI SỐ CỘT: authenticated UPDATE % cột (mong 63)', v_n; end if;
  if exists (select 1 from information_schema.column_privileges
             where table_schema='kho' and table_name='don_hang' and privilege_type='UPDATE' and grantee='authenticated'
               and column_name in ('id','ma_don','tao_luc','la_demo','sale_phu_trach','trang_thai','ly_do_thua','ghi_chu_thua'))
  then raise exception 'CỘT LẼ RA ĐÃ RỚT VẪN CÒN grant'; end if;
  raise notice 'db/213 OK: don_hang authenticated UPDATE = 63 cột (danh-sách-CHO-PHÉP). Rớt: id/ma_don/tao_luc/la_demo/sale_phu_trach.';
end $$;
commit;
