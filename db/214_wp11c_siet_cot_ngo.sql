-- WP-11c · QD-97 (kế QD-96)
-- Siết 22 cột don_hang mà client KHÔNG ghi (đo L-11cA: 0/22 nằm trong payload
-- sale.js:255 donToRow 40 cột + sale.js:379 datHan). Cột do DB/RPC ghi thì
-- client không cần cầm grant UPDATE — QD-95/96.
--
-- 3 cột tài chính (client GHI 0/3 — L-11cA):
--   doanh_thu      — DB path (db/021) ghi, client chỉ đọc.
--   ma_ky_ap_dung  — 0/6 dòng populated · KHÔNG hàm/trigger/client nào GHI (12 hàm
--                    "khả nghi" ở L-11cA đều chỉ ĐỌC làm bộ lọc kỳ giá:
--                    `where d.ma_ky_ap_dung = p_ma_ky`). Comment db/028 "đóng dấu
--                    lúc chốt" là ý định CHƯA hiện thực. Revoke an toàn tuyệt đối.
--   gia_goc        — 0 dòng, 0 writer, chỉ còn ở 1 cột CSV export. CEO chốt
--                    REVOKE, KHÔNG DROP (không xoá thứ chưa hiểu hết vòng đời).
--                    Xét drop lại ở WP-11f.
-- 19 cột mốc/người/cờ do trigger/RPC SECURITY DEFINER ghi (vd ghi_nhat_ky_mon
--   stamp ngay_vao_chuyen/ngay_xong; trg_moc_bao_gia stamp ngay_tao_bao_gia;
--   tg_gan_sale_phu_trach; chan_gap...). DEFINER chạy như owner → revoke trên
--   `authenticated` KHÔNG chạm. Client không đụng cột nào trong 19.
--
-- Whitelist db/grant_don_hang_whitelist.txt cập nhật CÙNG LÚC: 63 → 41 dòng.

revoke update (
  doanh_thu,
  gia_goc,
  ma_ky_ap_dung,
  ma_ns_thiet_ke,
  ma_ns_tk_ban_hang,
  ma_ns_danh_dau,
  buoc_thiet_ke,
  luc_nhan_thiet_ke,
  ngay_vao_chuyen,
  ngay_xong,
  ngay_thu,
  danh_dau_gap,
  ly_do_gap,
  gap_luc,
  ngay_tao_bao_gia,
  ngay_ket_thuc_bao_gia,
  ngay_hen_khach_ban_dau,
  khach_moi,
  so_mon,
  so_to_hop_vat_lieu,
  cap_thiet_ke,
  sua_luc
) on kho.don_hang from authenticated;
