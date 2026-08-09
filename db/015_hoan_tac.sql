-- HOÀN TÁC 015 — gỡ mọi thứ lô huỷ-phiếu thêm vào, đưa DB về đúng trạng thái trước 015.
-- Phao cứu sinh. Chạy lại nhiều lần được. KHÔNG xoá dòng dữ liệu nào.
--   node ops/run_sql.mjs ../db/015_hoan_tac.sql   (hoặc Supabase SQL Editor)
--
-- [VÁ 2026-08] Trước đây chết khi DB có phiếu 'da_huy' (thu hẹp check (nhap,ghi_so) bị các dòng da_huy vi phạm).
--   Sửa: chuyển 'da_huy' -> 'ghi_so' TRƯỚC khi thu hẹp check. AN TOÀN VỀ TỒN: mỗi phiếu bị huỷ đã có PHIẾU NGƯỢC
--   ('ghi_so') bù đúng bằng tác động ngược -> cặp (gốc + ngược) net = 0 dù gốc mang 'ghi_so' hay 'da_huy'.
--   KHÔNG xoá dòng nào (chỉ đổi cờ trạng thái + con_lai giữ nguyên). Nhãn 'da_huy' mất là đúng ý (đang gỡ chính nó).
begin;

drop function if exists kho.huy_phieu(text, text);

alter table kho.lo_nhap drop column if exists lo_da_huy;   -- gỡ cột (kèm mọi grant trên cột)

-- Đưa mọi phiếu 'da_huy' về 'ghi_so' để thu hẹp check không vi phạm (phiếu ngược đã bù -> tồn không đổi).
update kho.phieu set trang_thai = 'ghi_so' where trang_thai = 'da_huy';

-- trả ràng buộc trang_thai về (nhap, ghi_so)
alter table kho.phieu drop constraint if exists phieu_trang_thai_check;
alter table kho.phieu add  constraint phieu_trang_thai_check check (trang_thai in ('nhap','ghi_so'));

commit;
