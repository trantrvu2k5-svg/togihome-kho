-- 122 — VÁ CỜ DEMO (WP-02a/L-63): backfill đơn cũ + trigger bắt trên MỌI update.
--   CHẨN (probe L-63): trigger db/121 ĐÚNG trên đường sống của Sale — INSERT ten DEMO* → true; UPSERT ON CONFLICT
--     DO UPDATE SET ten_khach → true; INSERT khách-đã-demo → true. Không phải lỗi logic.
--   NHƯNG hai lỗ:
--     (1) đơn tạo TRƯỚC khi db/121 áp (vd T8-017, tao_luc 06:40 hôm nay dưới db/120 chỉ bắt ma_don DEMO-*) còn
--         la_demo=false, chưa write nào đụng lại → BACKFILL 1 lần (migration, KHÔNG phải INSERT tắt).
--     (2) nếu khách bị đánh demo SAU khi đơn tồn tại và update sau KHÔNG đụng ten_khach/sdt_khach → 'UPDATE OF <cột>'
--         không kích. Mở rộng trigger BEFORE INSERT OR UPDATE (mọi cột) cho chắc — đơn giá rẻ, don_hang update thưa.
--   IDEMPOTENT: create or replace hàm (thân giữ nguyên) · drop+create trigger · backfill WHERE not la_demo (chạy lại vô hại).
-- HOÀN TÁC: chạy lại db/121 (trigger BEFORE INSERT OR UPDATE OF ma_don, ten_khach, sdt_khach).
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

drop trigger if exists don_hang_tu_danh_dau_demo on kho.don_hang;
create trigger don_hang_tu_danh_dau_demo before insert or update on kho.don_hang
  for each row execute function kho.tu_danh_dau_demo_don();

comment on function kho.tu_danh_dau_demo_don() is
  'QD-46: la_demo tự động khi mã đơn DEMO-* HOẶC khách demo (ten_khach DEMO* / sdt_khach→khach.la_demo)';

-- BACKFILL 1 lần: đơn của khách demo / ten_khach DEMO* nhưng chưa gắn cờ (rows trước db/121).
do $$ declare n int; begin
  update kho.don_hang d set la_demo = true
   where not d.la_demo
     and (d.ten_khach ilike 'DEMO%'
          or exists (select 1 from kho.khach k where k.sdt = d.sdt_khach and k.la_demo));
  get diagnostics n = row_count;
  raise notice 'BACKFILL la_demo: % dòng don_hang', n;
end $$;

commit;
