-- 121 — VÁ CỜ DEMO THEO KHÁCH (WP-02a / L-60): don_hang.la_demo tự động khi KHÁCH của đơn là demo.
--   VÌ SAO: app Sale sinh mã đơn kiểu 'DH-…' (không có ô nhập mã) → trigger cũ (chỉ bắt ma_don ILIKE 'DEMO-%')
--   KHÔNG BAO GIỜ bắt đơn tạo qua UI. Khách 'DEMO Phòng họp' có la_demo=true nhưng đơn thì false → tài chính
--   KHÔNG loại đơn demo. Nay bắt thêm: ten_khach ILIKE 'DEMO%' HOẶC khách (nối theo sdt_khach → khach.la_demo).
--   don_hang KHÔNG có khach_id — liên kết khách bằng sdt_khach = khach.sdt (đọc schema, không đoán).
--   ⚠ IDEMPOTENT: create or replace hàm · drop+create lại trigger (mở rộng cột theo dõi: +ten_khach, +sdt_khach).
-- HOÀN TÁC: chạy lại db/120 (bản trigger chỉ bắt ma_don).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.tu_danh_dau_demo_don() returns trigger language plpgsql as $$
begin
  if new.ma_don ilike 'DEMO-%'
     or new.ten_khach ilike 'DEMO%'
     or exists (select 1 from kho.khach k where k.sdt = new.sdt_khach and k.la_demo)
  then new.la_demo := true; end if;
  return new;
end $$;

-- trigger phải chạy lại khi ĐỔI ten_khach/sdt_khach (không chỉ ma_don), nếu không đổi khách sang demo sẽ không bắt.
drop trigger if exists don_hang_tu_danh_dau_demo on kho.don_hang;
create trigger don_hang_tu_danh_dau_demo before insert or update of ma_don, ten_khach, sdt_khach on kho.don_hang
  for each row execute function kho.tu_danh_dau_demo_don();

comment on function kho.tu_danh_dau_demo_don() is
  'QD-46: la_demo tự động khi mã đơn DEMO-* HOẶC khách demo (ten_khach DEMO* / sdt_khach→khach.la_demo)';

commit;
