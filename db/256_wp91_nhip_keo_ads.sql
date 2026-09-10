-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 256 — WP-91 L-91k: nhịp kéo chi ads 1 lần/ngày → 6 lần/ngày, mỗi vòng đọc lùi 3 ngày.
--   (BƯỚC 3) THAM SỐ đọc-lùi để trong BẢNG, không chôn code: keoAdsLuot đọc kho.tham_so_van_hanh
--     ma='ads_doc_lui_ngay'; thiếu → RAISE (luật ngưỡng-không-dự-phòng-im-lặng). L-91f3 đo cửa sổ quy kết
--     Meta: ngày cuối còn chênh ~26%, ngày kế +459đ, từ ngày thứ 3 đứng yên → 3 ngày là đủ.
--   (BƯỚC 6) nhịp 24h→4h: ngưỡng đèn trễ cũ (vàng 8h / đỏ 26h) không bao giờ đỏ nữa. Hạ theo nhịp mới.
--     [GĐ] vàng 6h (>~1 nhịp), đỏ 10h (>~2-3 nhịp) — số giả định theo nhịp 4h, CEO chỉnh 1 chỗ ở bảng ads_nguong.
--   Idempotent. HOÀN TÁC ở cuối lệnh L-91k.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

insert into kho.tham_so_van_hanh (ma, gia_tri, don_vi, ghi_chu)
  select 'ads_doc_lui_ngay', '3', 'ngay',
         'WP-91 L-91k: mỗi vòng kéo ads đọc lùi N ngày (cửa sổ quy kết Meta). keoAdsLuot đọc; thiếu → RAISE, cấm nền ngầm.'
  where not exists (select 1 from kho.tham_so_van_hanh where ma = 'ads_doc_lui_ngay');

update kho.ads_nguong set gia_tri = '6'  where ma = 'keo_tre_vang_gio' and hieu_luc_den is null;
update kho.ads_nguong set gia_tri = '10' where ma = 'keo_tre_do_gio'   and hieu_luc_den is null;

commit;
