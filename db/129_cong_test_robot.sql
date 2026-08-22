-- 129 — CỔNG AN TOÀN tài khoản robot test_: chỉ được chạm đơn DEMO (dev=prod cùng project, L-66).
--   Tài khoản ho_ten LIKE 'test_%' (L-66) INSERT/UPDATE don_hang KHÔNG la_demo → RAISE. Đơn thật miễn nhiễm (chủ không phải test_).
--   AFTER trigger → chạy SAU don_hang_tu_danh_dau_demo (db/122, BEFORE set la_demo theo ten_khach 'DEMO%') → thấy la_demo cuối cùng.
--   Đường mở GUC không có: cổng chỉ tra ho_ten của auth.uid(); service_role/postgres (auth.uid() null) KHÔNG bị chặn (script CEO).
--   Giao_dich/phieu_thu: robot demo hiện KHÔNG ghi (chỉ don_hang) → CHƯA gadd cổng; thêm khi có robot ghi (QD-51 ghi rõ).
--   ⚠ IDEMPOTENT: create or replace + drop trigger if exists.
-- HOÀN TÁC: drop trigger trg_chan_test_ngoai_demo on kho.don_hang; drop function kho.chan_test_ngoai_demo.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.chan_test_ngoai_demo() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(new.la_demo, false) = false
     and exists (select 1 from kho.nguoi_dung where auth_uid = auth.uid() and ho_ten like 'test\_%') then
    raise exception 'TEST_ROBOT_NGOAI_DEMO: tài khoản robot (test_) chỉ được thao tác đơn DEMO — đơn "%" không phải demo (la_demo=false)', new.ma_don;
  end if;
  return new;
end $$;
comment on function kho.chan_test_ngoai_demo() is 'L-66/QD-51: chặn tài khoản test_ ghi đơn KHÔNG la_demo (an toàn dev=prod)';
drop trigger if exists trg_chan_test_ngoai_demo on kho.don_hang;
create trigger trg_chan_test_ngoai_demo after insert or update on kho.don_hang
  for each row execute function kho.chan_test_ngoai_demo();

do $$ begin
  if to_regprocedure('kho.chan_test_ngoai_demo()') is null then raise exception 'chan_test_ngoai_demo CHƯA tạo'; end if;
  raise notice 'db/129 OK: cổng test_ chỉ chạm đơn demo (AFTER trigger don_hang).';
end $$;
commit;
