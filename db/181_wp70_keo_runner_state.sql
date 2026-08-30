-- db/181 · WP-70 L-06 · Trạng thái RUNNER bộ kéo (khoá chống chồng + backoff) cho Cloudflare Worker cron.
--   Worker stateless giữa các lượt cron → khoá + đếm lỗi phải nằm ở DB (không file như launchd cũ).
--   MỘT dòng duy nhất (id=1). Worker nối qua Hyperdrive = phiên OWNER (như puller local) + cửa GUC như cũ.
--     · held_at   = đang giữ khoá lúc nào (NULL = rảnh). Lượt sau chỉ chạy nếu held_at NULL / quá 90s (lượt trước treo).
--     · loi_lien_tiep = số lỗi LIÊN TIẾP. ngu_toi = ngủ tới lúc nào (sau 5 lỗi → +15 phút).
--   HOÀN TÁC: drop table kho.keo_lead_runner;
--   ⚠ migration ≥177 LUÔN backup.
begin;
create table if not exists kho.keo_lead_runner (
  id            int primary key default 1 check (id = 1),
  held_at       timestamptz,
  loi_lien_tiep int not null default 0,
  ngu_toi       timestamptz,
  cap_nhat_luc  timestamptz not null default now()
);
insert into kho.keo_lead_runner(id) values (1) on conflict (id) do nothing;
alter table kho.keo_lead_runner add column if not exists so_luot bigint not null default 0;   -- đếm TỔNG lượt cron đã bắn (đo ≤60s)
-- chỉ OWNER/định-danh hệ thống đụng (worker nối owner). Client thường KHÔNG cần đọc.
revoke all on kho.keo_lead_runner from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from kho.keo_lead_runner where id=1) then raise exception 'THIẾU dòng keo_lead_runner'; end if;
  raise notice 'db/181 OK: keo_lead_runner (khoá + backoff cho worker).';
end $$;
commit;
