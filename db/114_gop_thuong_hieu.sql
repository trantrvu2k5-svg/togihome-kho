-- 114 — DỌN THƯƠNG HIỆU TRÙNG: gộp 7 biến thể Togihome về `togihome`, tắt (ngung) không xoá; view danh mục chung (L-48a PHA 2).
--   ⚠ IDEMPOTENT: create or replace view + UPDATE điều kiện + set ngung → chạy 1 lần vẫn an toàn chạy lại.
--
--   NHẬT KÝ GỘP (rà PHA 1, số bản ghi TRỎ tại thời điểm gộp — tất cả = 0, gộp không phải chuyển bản ghi nào):
--     togihome-kr (TKR) → togihome : don_hang 0 · niem_yet 0 · bo_san_pham 0
--     togihome-bcc (TBC) → togihome : 0 · 0 · 0
--     togihome-gaming (TGG) → togihome : 0 · 0 · 0
--     togihome-hd (THD) → togihome : 0 · 0 · 0
--     togihome-office (TOF) → togihome : 0 · 0 · 0
--     togihome-bh (TBH) → togihome : 0 · 0 · 0
--     togihome-vp (TVP) → togihome : 0 · 0 · 0
--   GIỮ: togihome (TGH, gốc) + 8 brand khác (Haigo/Khanh Concept/Mulig/Open Living/Sophia Concept/Thago/Togismart/Vufurni).
--   Showroom (ma=showroom, loai='kenh_ban'): GIỮ dòng làm KÊNH — view danh mục thương hiệu tự loại (loai≠kenh_ban).
--   KHÔNG SKU nào chứa mã 3 chữ biến thể (kiểm PHA 2) → định danh niêm yết không gãy.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   update kho.thuong_hieu set ngung=false where ma in ('togihome-kr','togihome-bcc','togihome-gaming','togihome-hd','togihome-office','togihome-bh','togihome-vp');
--   drop view if exists kho.thuong_hieu_ban;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. Chuyển MỌI bản ghi trỏ 7 biến thể → togihome (an toàn/idempotent; hiện 0 dòng, phòng dữ liệu phát sinh sau).
do $$
declare v_bt text[] := array['togihome-kr','togihome-bcc','togihome-gaming','togihome-hd','togihome-office','togihome-bh','togihome-vp'];
begin
  update kho.don_hang     set thuong_hieu    = 'togihome' where thuong_hieu    = any(v_bt);
  update kho.niem_yet     set ma_thuong_hieu = 'togihome' where ma_thuong_hieu = any(v_bt);
  update kho.bo_san_pham  set ma_thuong_hieu = 'togihome' where ma_thuong_hieu = any(v_bt);
  -- 2. TẮT 7 biến thể (không xoá — giữ lịch sử, tránh mồ côi FK).
  update kho.thuong_hieu  set ngung = true where ma = any(v_bt);
end $$;

-- 3. VIEW danh mục thương hiệu ĐANG BÁN — nguồn CHUNG cho dropdown app Sale + Sản phẩm (cùng danh sách).
--    Điều kiện gom một chỗ: đang bật + KHÔNG phải kênh bán + có mã 3 chữ (brand thật). security_invoker: theo RLS người gọi.
create or replace view kho.thuong_hieu_ban with (security_invoker = true) as
  select ma, ten, ma_3chu, loai, domain, nguoi_ads, ten_tren_web, mo_ta, ngung
  from kho.thuong_hieu
  where coalesce(ngung, false) = false and coalesce(loai, '') <> 'kenh_ban' and nullif(btrim(ma_3chu), '') is not null;
grant select on kho.thuong_hieu_ban to authenticated;
revoke all on kho.thuong_hieu_ban from anon;

do $$
declare v_con int;
begin
  select count(*) into v_con from kho.thuong_hieu where ngung=false and coalesce(loai,'')<>'kenh_ban'
    and ma = any(array['togihome-kr','togihome-bcc','togihome-gaming','togihome-hd','togihome-office','togihome-bh','togihome-vp']);
  if v_con > 0 then raise exception 'db/114 LỖI: còn % biến thể chưa tắt', v_con; end if;
  raise notice 'db/114 OK: 7 biến thể Togihome đã tắt + view thuong_hieu_ban (% brand bán).',
    (select count(*) from kho.thuong_hieu_ban);
end $$;
commit;
