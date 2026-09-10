-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 253 — WP-91 N-06 (CEO quyết 09/09): đơn HẾT ĐƯỜNG SẢN XUẤT (huỷ / thua báo giá) → RỜI khỏi xep_lich
--   NGAY TẠI CỔNG ĐỔI TRẠNG THÁI. xep_lich là bảng SUY nuôi tải tổ (tai_theo_to_tuan) + nút thắt
--   (nut_that_ghi) + ngày giao hứa; giữ phút của đơn đã chết = bơm TẢI MA.
--
--   BỆNH (L-91a): db/036 chuyển đơn sang thua KHÔNG đụng xep_lich; xep_lich chỉ bị xoá khi RE-XẾP.
--   nut_that_ghi + vung_cua_tuan đọc THẲNG xep_lich, KHÔNG lọc trạng thái → đơn đã xếp rồi huỷ/thua
--   để phút ở lại tải VĨNH VIỄN. (tai_theo_to_tuan tự lọc trạng thái nên KHÔNG rò cho HUỶ — xem QD.)
--
--   Đi qua HỌ ĐƯỜNG ghi xep_lich hiện có (delete-per-đơn, y như luu_xep_lich/ban_giao_xuong dùng);
--   KHÔNG đẻ đường ghi thứ hai (QD-03). Noi theo mẫu trg_huy_giu_cho → huy_giu_cho_don (cùng cổng, cùng cách).
--
--   tam_ngung KHÔNG rời (QD-52: tạm ngưng giữ nguyên giữ chỗ + lịch). Idempotent. KHÔNG ghi giao_dich
--   (gỡ lịch là việc SUY, không phải sổ tiền). KHÔNG đụng giu_cho (huỷ đã có trg_huy_giu_cho lo).
--
--   HOÀN TÁC: drop trigger trg_go_lich_don_chet on kho.don_hang; drop function kho.go_lich_don_chet();
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.go_lich_don_chet() returns trigger
  language plpgsql security definer set search_path to 'kho' as $function$
begin
  -- Đơn vào trạng thái HẾT ĐƯỜNG SẢN XUẤT → rời xep_lich. is distinct from: chạy 1 lần khi VÀO trạng thái đó.
  if new.trang_thai in ('huy','bao_gia_thua')
     and new.trang_thai is distinct from old.trang_thai then
    delete from kho.xep_lich where ma_don = new.ma_don;   -- idempotent: 0 dòng = no-op; gọi lại không lỗi/không âm
  end if;
  return new;
end $function$;

drop trigger if exists trg_go_lich_don_chet on kho.don_hang;
create trigger trg_go_lich_don_chet
  after insert or update of trang_thai on kho.don_hang
  for each row execute function kho.go_lich_don_chet();

commit;
