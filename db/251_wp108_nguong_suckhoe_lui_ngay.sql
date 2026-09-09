-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 251 — WP-108 L-14 vá 400: 3 ngưỡng sức khoẻ (hien_thi_toi_thieu_doc · tan_suat_do · ctr_duoi_nen_phan_tram)
--   chỉ có hieu_luc_tu = 2026-09-05 → ads_suc_khoe_mau RAISE "thiếu ngưỡng" cho mọi khoảng TRƯỚC 05/09 (xem tháng 6-8)
--   → HTTP 400 (client bắt qua okD nhưng console vẫn kêu). Ngưỡng là HẰNG SỐ áp cho MỌI dữ liệu → lùi về 2026-01-01
--   (ngang bat_dau_xem/cpm_tren) để phủ cả kỳ theo dõi. Idempotent. HOÀN TÁC: set lại 2026-09-05.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;
update kho.ads_nguong set hieu_luc_tu = date '2026-01-01'
 where ma in ('hien_thi_toi_thieu_doc','tan_suat_do','ctr_duoi_nen_phan_tram')
   and hieu_luc_tu = date '2026-09-05';
commit;
