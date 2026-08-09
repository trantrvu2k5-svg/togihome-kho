-- 030 — TRẦN GIẢM GIÁ phân tầng + nới trần (sản phẩm/kỳ) + CHẶN CỨNG bằng trigger.
--   node ops/run_sql.mjs ../db/030_tran_giam_gia.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod; cần 027-029 trước)
--
-- Mô hình:
--   tran_giam_gia(sku,dong,ngay) = TRẦN không-cần-duyệt (%). Mặc định = tran_sale; nới bởi bảng SP/kỳ (LẤY MỨC NỚI NHẤT).
--   Giảm ≤ trần            → sale tự lưu (hoặc đã tiền-duyệt qua dòng nới).
--   trần < giảm ≤ tran_truong_nhom → cần người duyệt cấp ≥ trưởng nhóm.
--   giảm > tran_truong_nhom        → cần CEO.
--   gia_chot < giá sàn (gia_san_don) → CHẶN CỨNG, không ai qua kể cả CEO.
--   Số CHƯA VAT. Người duyệt = nguoi_dung.id; thẩm quyền theo vai_tro (ceo | sale_truong).
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop trigger if exists trg_chan_giam_gia on kho.don_hang;
--   drop trigger if exists trg_chan_giam_gia_mon on kho.don_hang_mon;
--   drop function if exists kho.chan_giam_gia();
--   drop function if exists kho.chan_giam_gia_mon();
--   drop function if exists kho.kiem_giam_gia(kho.don_hang);
--   drop function if exists kho.nguoi_duyet_giam();
--   drop function if exists kho.tran_giam_gia(text, text, date);
--   drop function if exists kho.gia_san_don_i(jsonb, text);
--   drop table if exists kho.quyen_duyet_giam;
--   drop table if exists kho.noi_tran_sp;
--   drop table if exists kho.noi_tran_ky;
--   alter table kho.don_hang drop column if exists gia_cong_thuc, drop column if exists gia_chot,
--     drop column if exists ma_ns_duyet_giam, drop column if exists ly_do_giam;
--   alter table kho.tham_so_tai_chinh drop column if exists tran_sale, drop column if exists tran_truong_nhom;
--   -- (cau_hinh_sale khôi phục bản 029 nếu cần — xem git)
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. Trần mặc định theo kỳ
alter table kho.tham_so_tai_chinh
  add column if not exists tran_sale        numeric,   -- % sale tự quyết
  add column if not exists tran_truong_nhom numeric;   -- % tối đa trưởng nhóm duyệt; trên = CEO
update kho.tham_so_tai_chinh set tran_sale = coalesce(tran_sale,5), tran_truong_nhom = coalesce(tran_truong_nhom,8)
  where ma_ky = '2026-07';

-- 2. Nới trần theo SẢN PHẨM (sku HOẶC nhom). hieu_luc_den BẮT BUỘC.
create table if not exists kho.noi_tran_sp (
  id           uuid primary key default gen_random_uuid(),
  sku          text references kho.san_pham_mau(ma) on delete cascade,
  nhom         text,
  tran_moi     numeric not null check (tran_moi >= 0 and tran_moi < 100),
  ma_ns_duyet  text not null,
  ly_do        text not null check (btrim(ly_do) <> ''),
  hieu_luc_tu  date not null,
  hieu_luc_den date not null,
  constraint chk_sp_khoa   check (sku is not null or nhom is not null),
  constraint chk_sp_ngay   check (hieu_luc_den >= hieu_luc_tu)
);

-- 3. Nới trần theo KỲ (chiến dịch). hieu_luc_den BẮT BUỘC.
create table if not exists kho.noi_tran_ky (
  id           uuid primary key default gen_random_uuid(),
  ma_ky        text not null,
  dong         text not null,
  tran_moi     numeric not null check (tran_moi >= 0 and tran_moi < 100),
  ma_ns_duyet  text not null,
  ly_do        text not null check (btrim(ly_do) <> ''),
  hieu_luc_tu  date not null,
  hieu_luc_den date not null,
  constraint chk_ky_ngay check (hieu_luc_den >= hieu_luc_tu)
);

-- RLS: chỉ ceo/ke_toan đọc/ghi (sale KHÔNG đọc thẳng -> không thấy ly_do/ma_ns_duyet của SP khác).
do $$ begin perform 1; end $$;
grant select, insert, update, delete on kho.noi_tran_sp to authenticated;
grant select, insert, update, delete on kho.noi_tran_ky to authenticated;
revoke all on kho.noi_tran_sp from anon; revoke all on kho.noi_tran_ky from anon;
alter table kho.noi_tran_sp enable row level security;
alter table kho.noi_tran_ky enable row level security;
drop policy if exists nts_all on kho.noi_tran_sp;  drop policy if exists ntk_all on kho.noi_tran_ky;
create policy nts_all on kho.noi_tran_sp for all
  using (kho.current_vai_tro() = any(array['ceo','ke_toan'])) with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));
create policy ntk_all on kho.noi_tran_ky for all
  using (kho.current_vai_tro() = any(array['ceo','ke_toan'])) with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- 3b. Thẩm quyền DUYỆT giảm giá — tách khỏi vai_tro (không đụng nguoi_dung). ns_id = nguoi_dung.id.
--     'ceo' duyệt tới sàn · 'truong_nhom' duyệt tới tran_truong_nhom. ceo tự động có quyền 'ceo'.
create table if not exists kho.quyen_duyet_giam (
  ns_id uuid primary key references kho.nguoi_dung(id),
  cap   text not null check (cap in ('truong_nhom','ceo'))
);
insert into kho.quyen_duyet_giam(ns_id, cap)
  select id, 'ceo' from kho.nguoi_dung where vai_tro = 'ceo' on conflict (ns_id) do nothing;
grant select, insert, update, delete on kho.quyen_duyet_giam to authenticated;
revoke all on kho.quyen_duyet_giam from anon;
alter table kho.quyen_duyet_giam enable row level security;
drop policy if exists qdg_all on kho.quyen_duyet_giam;
create policy qdg_all on kho.quyen_duyet_giam for all
  using (kho.current_vai_tro() = any(array['ceo','ke_toan'])) with check (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- 4. HÀM tran_giam_gia — TRẦN không-cần-duyệt (%). LẤY MỨC NỚI NHẤT còn hiệu lực; không có -> mặc định.
--    SECURITY DEFINER: sale gọi được, chỉ trả 1 SỐ (không lộ ly_do/ma_ns_duyet).
create or replace function kho.tran_giam_gia(p_sku text, p_dong text, p_ngay date)
  returns numeric language sql security definer set search_path = kho stable as $$
  select greatest(
    coalesce((select tran_sale from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1), 0),
    coalesce((select max(tran_moi) from kho.noi_tran_sp
       where (sku = p_sku or (nhom is not null and nhom = p_dong)) and p_ngay between hieu_luc_tu and hieu_luc_den), 0),
    coalesce((select max(tran_moi) from kho.noi_tran_ky
       where dong = p_dong and p_ngay between hieu_luc_tu and hieu_luc_den), 0)
  );
$$;
grant execute on function kho.tran_giam_gia(text, text, date) to authenticated;

-- cau_hinh_sale: THÊM tran_sale/tran_truong_nhom (sale cần biết mình được tới đâu). Vẫn KHÔNG cột tiền.
create or replace function kho.cau_hinh_sale()
  returns jsonb language sql security definer set search_path = kho stable as $$
  select jsonb_build_object(
    'vat', t.vat, 'gio_mo_cua', t.gio_mo_cua, 'ghi_de', t.ghi_de,
    'n_ads', t.n_ads, 'n_cac', t.n_cac, 'n_kg', t.n_kg, 'n_no', t.n_no, 'n_giam', t.n_giam,
    'tran_sale', t.tran_sale, 'tran_truong_nhom', t.tran_truong_nhom)
  from kho.tham_so_tai_chinh t order by t.ngay_ap_dung desc nulls last, t.ma_ky desc limit 1;
$$;
grant execute on function kho.cau_hinh_sale() to authenticated;

-- 5. Cột kiểm soát giá vào don_hang (CHƯA VAT).
alter table kho.don_hang
  add column if not exists gia_cong_thuc    numeric check (gia_cong_thuc is null or gia_cong_thuc >= 0),
  add column if not exists gia_chot         numeric check (gia_chot is null or gia_chot >= 0),
  add column if not exists ma_ns_duyet_giam text,
  add column if not exists ly_do_giam       text;

-- Bản NỘI BỘ của gia_san_don — KHÔNG guard auth (trigger chạy cả khi không có JWT: service/superuser).
--   Chỉ trigger dùng (revoke khỏi public); vẫn chỉ trả 1 SỐ, không lộ giá vốn.
create or replace function kho.gia_san_don_i(p_mon jsonb, p_dong text)
  returns numeric language plpgsql security definer set search_path = kho stable as $$
declare
  v_m numeric; v_hh numeric; v_nhom_default numeric; v_phi numeric; t record;
  v_sum numeric := 0; it jsonb; v_gv numeric; v_nhom numeric; v_ship numeric;
begin
  select * into t from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  if t.he_so_m is null then return null; end if;   -- chưa có he_so_m -> không tính được sàn
  v_m := t.he_so_m; v_nhom_default := t.he_so_nhom;
  v_hh := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  v_phi := case p_dong when 'combo' then t.phi_don_combo when 'du_an' then t.phi_don_thiet_ke
             when 'thiet_ke' then t.phi_don_thiet_ke else t.phi_don_le end;
  for it in select value from jsonb_array_elements(p_mon) loop
    select gia_von into v_gv from kho.san_pham_mau_gia_von where ma = (it->>'sku');
    if v_gv is null then continue; end if;
    v_ship := coalesce((it->>'ship')::numeric, 0);
    v_nhom := coalesce((it->>'he_so_nhom')::numeric, v_nhom_default, 1);
    v_sum := v_sum + v_gv * (1 + (v_m - 1) * v_nhom) + v_ship;
  end loop;
  return round((v_sum + v_phi) / (1 - v_hh));
end $$;
revoke all on function kho.gia_san_don_i(jsonb, text) from public;

-- 6. CHẶN CỨNG — validate DÙNG CHUNG cho cả don_hang lẫn don_hang_mon (đơn MỚI ghi món SAU đơn -> phải
--    chặn khi món tới nữa, không chỉ lúc ghi đơn). 3 chốt độc lập (test bỏ từng chốt qua GUC chan.off_*).
create or replace function kho.kiem_giam_gia(d kho.don_hang)
  returns void language plpgsql security definer set search_path = kho as $$
declare
  v_pct numeric; v_tran numeric; v_tran_tn numeric; v_san numeric; v_vt text; v_mon jsonb; v_hesom numeric;
begin
  if d.gia_cong_thuc is null or d.gia_cong_thuc <= 0 then return; end if;
  v_pct := (coalesce(d.chiet_khau,0) / d.gia_cong_thuc) * 100;

  -- CHỐT 3: có giảm mà thiếu lý do
  if current_setting('chan.off_lydo', true) is distinct from '1'
     and v_pct > 0 and coalesce(btrim(d.ly_do_giam),'') = '' then
    raise exception 'Giảm giá phải có lý do (ly_do_giam)';
  end if;

  -- CHỐT 1: dưới giá sàn (nếu tính được) — KHÔNG ai qua, kể cả CEO
  if current_setting('chan.off_san', true) is distinct from '1' and d.gia_chot is not null then
    select jsonb_agg(jsonb_build_object('sku', m.sp_id)) into v_mon
      from kho.don_hang_mon m
      where m.don_id = d.id and m.sp_id in (select ma from kho.san_pham_mau_gia_von);
    select he_so_m into v_hesom from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
    if v_mon is not null and v_hesom is not null then
      v_san := kho.gia_san_don_i(v_mon, coalesce(d.dong,'le'));
      if v_san is not null and d.gia_chot < v_san then
        raise exception 'Giá chốt % dưới giá sàn — không thể chốt (kể cả CEO duyệt)', d.gia_chot;
      end if;
    end if;
  end if;

  -- CHỐT 2: trần + thẩm quyền duyệt
  if current_setting('chan.off_tran', true) is distinct from '1' and v_pct > 0 then
    select coalesce(max(kho.tran_giam_gia(m.sp_id, d.dong, coalesce(d.ngay_chot, current_date))),
                    kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)))
      into v_tran from kho.don_hang_mon m where m.don_id = d.id and m.sp_id is not null;
    v_tran := coalesce(v_tran, kho.tran_giam_gia(null, d.dong, coalesce(d.ngay_chot, current_date)));
    if v_pct > v_tran + 1e-9 then
      if d.ma_ns_duyet_giam is null then
        raise exception 'Giảm % vượt trần % — cần người duyệt', round(v_pct,2)||'%', round(v_tran,2)||'%';
      end if;
      select cap into v_vt from kho.quyen_duyet_giam where ns_id = d.ma_ns_duyet_giam::uuid;
      select tran_truong_nhom into v_tran_tn from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
      if v_vt = 'ceo' then
        null;  -- CEO duyệt tới sàn (đã chặn floor ở CHỐT 1)
      elsif v_vt = 'truong_nhom' then
        if v_pct > coalesce(v_tran_tn,8) + 1e-9 then
          raise exception 'Giảm % vượt quyền trưởng nhóm (%) — cần CEO', round(v_pct,2)||'%', round(v_tran_tn,2)||'%';
        end if;
      else
        raise exception 'Người duyệt "%" không đủ thẩm quyền giảm giá', coalesce(v_vt,'(không rõ)');
      end if;
    end if;
  end if;
end $$;

-- trigger trên don_hang (lúc ghi đơn)
create or replace function kho.chan_giam_gia() returns trigger language plpgsql
  security definer set search_path = kho as $$ begin perform kho.kiem_giam_gia(new); return new; end $$;
drop trigger if exists trg_chan_giam_gia on kho.don_hang;
create trigger trg_chan_giam_gia before insert or update on kho.don_hang
  for each row execute function kho.chan_giam_gia();

-- trigger trên don_hang_mon (lúc ghi món — chặn cả khi món tới SAU đơn)
create or replace function kho.chan_giam_gia_mon() returns trigger language plpgsql
  security definer set search_path = kho as $$
declare d kho.don_hang;
begin
  select * into d from kho.don_hang where id = coalesce(new.don_id, old.don_id);
  if found then perform kho.kiem_giam_gia(d); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_chan_giam_gia_mon on kho.don_hang_mon;
create trigger trg_chan_giam_gia_mon after insert or update or delete on kho.don_hang_mon
  for each row execute function kho.chan_giam_gia_mon();

-- 7. Danh sách người duyệt cho picker của sale (id + tên + cấp) — KHÔNG lộ ly_do/giá vốn.
create or replace function kho.nguoi_duyet_giam()
  returns table (ns_id uuid, ten text, cap text)
  language sql security definer set search_path = kho stable as $$
  select q.ns_id, n.ho_ten, q.cap from kho.quyen_duyet_giam q join kho.nguoi_dung n on n.id = q.ns_id order by q.cap desc, n.ho_ten;
$$;
grant execute on function kho.nguoi_duyet_giam() to authenticated;

commit;
