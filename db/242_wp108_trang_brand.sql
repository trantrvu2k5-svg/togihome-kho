-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 242 — WP-108 nhịp 1: BẢNG GÁN THƯƠNG HIỆU THEO TRANG (ads_trang_brand).
--   Khuôn giống ads_tai_khoan_brand nhưng ĐỔI KHOÁ act_id → page_id (fanpage). Vì L-108-1 đo được:
--   34/34 chiến dịch sạch một trang → gán theo TRANG là đúng mức, không phải theo tài khoản.
--   • brand_id FK → kho.thuong_hieu(ma) (đúng như bảng cũ). ten_hien_thi = tên TRANG THẬT (Meta).
--   • EXCLUDE gist chống chồng khoảng hiệu lực theo page (một trang một brand tại một thời điểm).
--   • Nạp 2 dòng CHỈ từ trang ĐÃ xuất hiện trong ads_mau (cổng `where exists`): 576…=Sophia · 279…=OpenLiving.
--     CẤM đặt brand khác brand thật của trang; CẤM gán trang chưa có trong dữ liệu.
--   • Grant CHO-PHÉP viết tay: client chỉ SELECT (qua RLS), KHÔNG cấp insert/update/delete, KHÔNG cấp sequence.
--   BẢNG CŨ ads_tai_khoan_brand GIỮ NGUYÊN chạy song song tới khi nhịp 2 chuyển xong.
--   ⚠ KHÔNG IDEMPOTENT (create table). Cổng backup QD-61 (run_sql.mjs tự dump). HOÀN TÁC: drop table ads_trang_brand.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table kho.ads_trang_brand (
  id           bigserial primary key,
  page_id      text not null,
  brand_id     text not null references kho.thuong_hieu(ma),
  ten_hien_thi text,
  hieu_luc_tu  date not null default date '2026-08-01',
  hieu_luc_den date,
  ghi_chu      text,
  tao_luc      timestamptz not null default now(),
  constraint ads_trang_brand_hl_check check (hieu_luc_den is null or hieu_luc_den >= hieu_luc_tu),
  constraint ads_trang_brand_khong_chong
    exclude using gist (page_id with =, daterange(hieu_luc_tu, coalesce(hieu_luc_den, 'infinity'::date), '[]') with &&)
);
comment on table kho.ads_trang_brand is 'WP-108: gán thương hiệu theo FANPAGE (page_id). Thay dần ads_tai_khoan_brand (theo tài khoản).';

alter table kho.ads_trang_brand enable row level security;
revoke all on kho.ads_trang_brand from public, anon, authenticated;
revoke all on sequence kho.ads_trang_brand_id_seq from public, anon, authenticated;   -- client KHÔNG cấp số
grant select on kho.ads_trang_brand to authenticated;   -- CẦN grant bảng + policy (client đọc THẲNG bảng này; policy lọc dòng)
create policy trang_brand_doc on kho.ads_trang_brand
  for select to authenticated using (kho.current_vai_tro() in ('ceo','ke_toan','ads_user'));

-- NẠP từ dữ liệu THẬT: chỉ trang đã có trong ads_mau; brand thật của trang (tên trang = ten_hien_thi Meta).
insert into kho.ads_trang_brand (page_id, brand_id, ten_hien_thi, hieu_luc_tu, ghi_chu)
select v.page_id, v.brand_id, v.ten, date '2026-08-01', 'WP-108 nhịp 1 — nạp từ dữ liệu thật (trang đã chạy)'
from (values
  ('576847645509797', 'sconcept',   'Sophia Concept'),
  ('279205171948766', 'openliving', 'OpenLiving')
) v(page_id, brand_id, ten)
where exists (select 1 from kho.ads_mau m where m.page_id = v.page_id)          -- CẤM gán trang chưa xuất hiện
  and not exists (select 1 from kho.ads_trang_brand t                            -- idempotent với dòng đang hiệu lực
                  where t.page_id = v.page_id and t.hieu_luc_den is null);

commit;
