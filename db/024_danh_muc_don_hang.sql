-- 024 — 6 BẢNG DANH MỤC cho app lên đơn + nối FK + TRIGGER bịt lỗ ghi cột tiền.
--   Idempotent (IF NOT EXISTS / drop-recreate) -> chạy lại KHÔNG nhân bảng/policy.
--   KHÔNG đụng schema public / bảng kho cũ / dữ liệu kho. don_hang RỖNG nên đổi thoải mái.
--   node ops/run_sql.mjs ../db/024_danh_muc_don_hang.sql   ·   gỡ: 024_hoan_tac.sql
begin;

-- ══════════ VIỆC 2 — 6 bảng danh mục (mỗi bảng có cột `ngung` = ngừng dùng, KHÔNG xoá cứng) ══════════
create table if not exists kho.thuong_hieu (          -- từ BRAND0 {c,n,dom,nguoiId}
  ma text primary key, ten text not null, domain text,
  nguoi_ads text,                                     -- BRAND0.nguoiId — nhóm quảng cáo (làm sau, chưa FK)
  ngung boolean not null default false);
create table if not exists kho.san_pham_mau (         -- từ SP0 {ma,ten,kt,vl,fileTK,toHop,cnc,giaVon}
  ma text primary key, ten text not null, kich_thuoc text, vat_lieu text,
  file_tk text, to_hop int, cnc int, gia_von numeric check (gia_von is null or gia_von >= 0),
  ngung boolean not null default false);
create table if not exists kho.mau_sac (              -- từ MAU0 {c,n,hex} (MAU là bảng VAI TRÒ; màu là MAU0)
  ma text primary key, ten text not null, hex text,
  ngung boolean not null default false);
create table if not exists kho.don_vi_van_chuyen (    -- từ VC0 (mảng chuỗi) — khoá tự nhiên = tên
  ten text primary key,
  ngung boolean not null default false);
create table if not exists kho.vat_lieu_ban (         -- từ VL0 {c,n,tho}. Tên 'vat_lieu_ban' để KHÔNG lẫn vat_tu kho
  ma text primary key, ten text not null, tho text,
  ngung boolean not null default false);
create table if not exists kho.khach (                -- từ khoá khach — QUAN TRỌNG NHẤT, sdt là khoá tự nhiên
  sdt text primary key, ten text, tinh text, dia_chi text,
  ngay_mua_dau date,                                  -- giải nợ "ngày mua đầu" đã ghi sổ
  ngung boolean not null default false);

-- ══════════ VIỆC 3 — nối đơn hàng sang danh mục ══════════
-- thuong_hieu + don_vi_van_chuyen: chọn KHOÁ NGOẠI (không phải chữ tự do + CHECK) — lý do: danh mục CỐ ĐỊNH,
--   FK cho toàn vẹn tham chiếu + chặn gõ sai, và bảng đơn đang rỗng nên gắn FK không vướng dữ liệu cũ.
alter table kho.don_hang drop constraint if exists fk_dh_thuong_hieu;
alter table kho.don_hang add  constraint fk_dh_thuong_hieu foreign key (thuong_hieu) references kho.thuong_hieu(ma);
alter table kho.don_hang drop constraint if exists fk_dh_dvvc;
alter table kho.don_hang add  constraint fk_dh_dvvc foreign key (don_vi_van_chuyen) references kho.don_vi_van_chuyen(ten);

-- khach: GIỮ CẢ HAI — sdt_khach/ten_khach INLINE (ảnh chụp lúc chốt đơn, bất biến kể cả khi master đổi;
--   khỏi JOIN cho mọi truy vấn; đơn nhanh chưa cần master) + THÊM khoá trỏ khach_sdt (nullable FK) để liên
--   kết master khi có (lặp lại khách, ngay_mua_dau). Lý do: đơn là bản ghi lịch sử, master là dữ liệu sống.
alter table kho.don_hang add column if not exists khach_sdt text;
alter table kho.don_hang drop constraint if exists fk_dh_khach;
alter table kho.don_hang add  constraint fk_dh_khach foreign key (khach_sdt) references kho.khach(sdt);

-- don_hang_mon.sp_id -> san_pham_mau(ma) ; ma_mau -> mau_sac(ma). Nullable (món tự do: để NULL, KHÔNG để "").
alter table kho.don_hang_mon drop constraint if exists fk_dhm_sp;
alter table kho.don_hang_mon add  constraint fk_dhm_sp foreign key (sp_id) references kho.san_pham_mau(ma);
alter table kho.don_hang_mon drop constraint if exists fk_dhm_mau;
alter table kho.don_hang_mon add  constraint fk_dhm_mau foreign key (ma_mau) references kho.mau_sac(ma);

-- ══════════ VIỆC 5 — TRIGGER bịt lỗ ghi CỘT TIỀN (chặn THẬT ở DB, không phụ thuộc giao diện) ══════════
-- thiet_ke/xuong/ke_toan KHÔNG được đổi gia_goc/chiet_khau/doanh_thu. ceo/kho/sale đổi bình thường.
--   (Giá vốn khoi_1/2/3 + gia_chuyen_giao đã nằm bảng don_hang_gia_von ceo/kho -> 3 vai trò này không chạm.)
create or replace function kho.chan_ghi_cot_tien()
  returns trigger language plpgsql security definer set search_path = kho as $$
declare vt text := kho.current_vai_tro();
begin
  if vt in ('thiet_ke','xuong','ke_toan') then
    if NEW.gia_goc    is distinct from OLD.gia_goc
    or NEW.chiet_khau is distinct from OLD.chiet_khau
    or NEW.doanh_thu  is distinct from OLD.doanh_thu then
      raise exception 'Vai trò "%" KHÔNG được sửa cột tiền bán (gia_goc / chiet_khau / doanh_thu) của đơn hàng.', vt;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists tg_chan_ghi_cot_tien on kho.don_hang;
create trigger tg_chan_ghi_cot_tien before update on kho.don_hang
  for each row execute function kho.chan_ghi_cot_tien();

-- ══════════ VIỆC 6 — GRANT + RLS ══════════
-- Danh mục (5 bảng): mọi vai trò ĐĂNG NHẬP đọc; chỉ ceo/kho ghi. khach: đọc ceo/kho/sale/thiet_ke/xuong/ke_toan
--   (KHÔNG tho); ghi ceo/kho/sale. anon: revoke (schema kho có default privilege tự cấp anon SELECT).
do $$
declare t text;
begin
  foreach t in array array['thuong_hieu','san_pham_mau','mau_sac','don_vi_van_chuyen','vat_lieu_ban','khach'] loop
    execute format('grant select, insert, update, delete on kho.%I to authenticated', t);
    execute format('revoke all on kho.%I from anon', t);
    execute format('alter table kho.%I enable row level security', t);
  end loop;
end $$;

-- 5 danh mục: đọc = 7 vai trò đăng nhập ; ghi = ceo/kho
do $$
declare t text;
begin
  foreach t in array array['thuong_hieu','san_pham_mau','mau_sac','don_vi_van_chuyen','vat_lieu_ban'] loop
    execute format('drop policy if exists dm_doc on kho.%I', t);
    execute format('drop policy if exists dm_ghi on kho.%I', t);
    execute format($f$create policy dm_doc on kho.%I for select using (kho.current_vai_tro() = any(array['ceo','kho','tho','sale','thiet_ke','xuong','ke_toan']))$f$, t);
    execute format($f$create policy dm_ghi on kho.%I for all using (kho.current_vai_tro() = any(array['ceo','kho'])) with check (kho.current_vai_tro() = any(array['ceo','kho']))$f$, t);
  end loop;
end $$;

-- khach: đọc ceo/kho/sale/thiet_ke/xuong/ke_toan (KHÔNG tho) ; ghi ceo/kho/sale
drop policy if exists khach_doc on kho.khach;
drop policy if exists khach_ghi on kho.khach;
create policy khach_doc on kho.khach for select
  using (kho.current_vai_tro() = any(array['ceo','kho','sale','thiet_ke','xuong','ke_toan']));
create policy khach_ghi on kho.khach for all
  using      (kho.current_vai_tro() = any(array['ceo','kho','sale']))
  with check (kho.current_vai_tro() = any(array['ceo','kho','sale']));

commit;
