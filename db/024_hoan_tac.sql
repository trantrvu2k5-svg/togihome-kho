-- HOÀN TÁC 024 — gỡ 6 bảng danh mục + FK nối đơn + trigger bịt cột tiền. Về đúng sau lô 023.
--   node ops/run_sql.mjs ../db/024_hoan_tac.sql   ·   chạy nhiều lần an toàn (IF EXISTS).
--   KHÔNG đụng schema public. KHÔNG đổi dữ liệu kho. don_hang đang RỖNG.
begin;

-- VIỆC 5 (gỡ): trigger + hàm bịt cột tiền.
drop trigger  if exists tg_chan_ghi_cot_tien on kho.don_hang;
drop function if exists kho.chan_ghi_cot_tien();

-- VIỆC 3 (gỡ): FK nối đơn hàng -> danh mục + cột khach_sdt.
alter table kho.don_hang     drop constraint if exists fk_dh_thuong_hieu;
alter table kho.don_hang     drop constraint if exists fk_dh_dvvc;
alter table kho.don_hang     drop constraint if exists fk_dh_khach;
alter table kho.don_hang     drop column     if exists khach_sdt;
alter table kho.don_hang_mon drop constraint if exists fk_dhm_sp;
alter table kho.don_hang_mon drop constraint if exists fk_dhm_mau;

-- VIỆC 2 (gỡ): 6 bảng danh mục (drop tự gỡ RLS/policy/grant/index của chúng).
drop table if exists kho.khach;
drop table if exists kho.vat_lieu_ban;
drop table if exists kho.don_vi_van_chuyen;
drop table if exists kho.mau_sac;
drop table if exists kho.san_pham_mau;
drop table if exists kho.thuong_hieu;

commit;
