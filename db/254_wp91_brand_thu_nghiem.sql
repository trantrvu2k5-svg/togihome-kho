-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 254 — WP-91 N-13 (CEO quyết 10/09): đóng 4.351.354đ chi ads TREO bằng thương hiệu "Thử nghiệm" ở MỨC FANPAGE.
--   2 fanpage (1189129987617712 · 100276159846147) là chi THẬT của công ty chạy thử ngành khác, đã thất bại,
--   KHÔNG thuộc thương hiệu nội thất nào. Gắn brand riêng "Thử nghiệm" thay vì rải vào 9 brand (Garrison ch.6:
--   chi không do segment gây ra thì không phân bổ vào segment). Chi vẫn nằm trong TỔNG chi ads, chỉ tách ở chiều brand.
--
--   ẨN KHỎI MÀN BÁN — dùng cơ chế SẴN CÓ (không đẻ nhánh mới):
--     • ngung=true  → loại khỏi VIEW thuong_hieu_ban (Sale/Sản phẩm/Tài chính đều đọc view này) VÀ khỏi sp_loc_options
--                     (lọc `loai='thuong_hieu' and not ngung`).
--     • ma_3chu=NULL → loại thêm khỏi thuong_hieu_ban (view đòi ma_3chu IS NOT NULL); cũng đúng nghĩa "không có mã bán".
--     • loai='thuong_hieu' (CHECK chỉ cho 'thuong_hieu'|'kenh_ban'; KHÔNG phải kênh bán nên không dùng kenh_ban).
--   ads_do_phu_brand join thuong_hieu (master, không lọc ngung) → "Thử nghiệm" vẫn hiện ở chiều brand cùng 4.351.354đ.
--
--   Idempotent (WHERE NOT EXISTS). CHỈ 2 page này, KHÔNG đụng 2 map cũ (openliving/sconcept), KHÔNG đụng chi_ads_ngay.
--   HOÀN TÁC: xem cuối lệnh L-91i (câu gỡ).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

insert into kho.thuong_hieu (ma, ten, loai, ngung, ma_3chu)
  select 'thu_nghiem', 'Thử nghiệm', 'thuong_hieu', true, null
  where not exists (select 1 from kho.thuong_hieu where ma = 'thu_nghiem');

insert into kho.ads_trang_brand (page_id, brand_id, ten_hien_thi, hieu_luc_tu, hieu_luc_den, ghi_chu)
  select v.page_id, 'thu_nghiem', null, date '2026-06-01', null,
         'WP-91 N-13: hoạt động thử ngoài ngành nội thất (gắn ở mức fanpage, đúng WP-112)'
  from (values ('1189129987617712'), ('100276159846147')) v(page_id)
  where not exists (
    select 1 from kho.ads_trang_brand tb
    where tb.page_id = v.page_id and tb.brand_id = 'thu_nghiem' and tb.hieu_luc_den is null);

commit;
