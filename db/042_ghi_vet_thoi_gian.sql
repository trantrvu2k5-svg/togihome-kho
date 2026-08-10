-- 042 — GHI VẾT THỜI GIAN: nhật ký MÓN tự động · nhật ký ĐƠN qua trigger (chống trùng) · mốc ngày tách bạch
--   · ngay_xong THỰC TẾ tự ghi · hàm mon_dung_yen / lead_time / do_lech_uoc.
--   Mở khoá lead time, món đứng yên, công suất. KHÔNG có lô này thì đơn chạy qua = mất dữ liệu vĩnh viễn.
--   ⚠ CHỜ TEST XANH. CHƯA áp prod.
--
--   PHÁT HIỆN (khác giả định đề bài): ngay_du_kien = "Ngày dự kiến sản xuất XONG" (nhãn app sale) = ƯỚC XUẤT
--   XƯỞNG (thiết kế đoán), KHÔNG phải hẹn-khách. => ngay_uoc_xuat_xuong DÙNG LẠI ngay_du_kien; ngay_hen_khach
--   (sale hứa giao khách) nghĩa KHÔNG khớp -> THÊM CỘT MỚI.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.do_lech_hen_khach(text,text), kho.do_lech_uoc(text,text), kho.lead_time(text,text,int), kho.mon_dung_yen(int);
--   drop trigger if exists trg_ghi_nk_mon on kho.don_hang_mon;           drop function if exists kho.ghi_nhat_ky_mon();
--   drop trigger if exists trg_ghi_nk_don on kho.don_hang;              drop function if exists kho.ghi_nhat_ky_don();
--   drop trigger if exists trg_chong_trung_nk_don on kho.don_hang_nhat_ky; drop function if exists kho.chong_trung_nhat_ky_don();
--   drop trigger if exists trg_chan_go_moc on kho.don_hang;            drop function if exists kho.chan_go_tay_moc_thuc_te();
--   drop trigger if exists trg_giu_hen_ban_dau on kho.don_hang;         drop function if exists kho.giu_hen_khach_ban_dau();
--   drop table if exists kho.don_hang_mon_nhat_ky;
--   alter table kho.don_hang drop column if exists ngay_hen_khach;   alter table kho.don_hang drop column if exists ngay_hen_khach_ban_dau;
--   -- (KHÔI PHỤC read policy nhật ký đơn về cũ nếu cần: drop policy dhnk_doc; create ... ceo/kho/sale)
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. NHẬT KÝ MÓN (tự động qua trigger) ═══════════════
create table if not exists kho.don_hang_mon_nhat_ky (
  id       uuid primary key default gen_random_uuid(),
  mon_id   uuid not null references kho.don_hang_mon(id) on delete cascade,
  don_id   uuid,
  tu       text,
  den      text,
  luc      timestamptz not null default now(),
  nguoi_id uuid references kho.nguoi_dung(id),
  ly_do    text
);
create index if not exists idx_dhmnk_mon on kho.don_hang_mon_nhat_ky(mon_id, luc);
create index if not exists idx_dhmnk_don on kho.don_hang_mon_nhat_ky(don_id);

-- Trigger AFTER UPDATE OF trang_thai: ghi vết + (nếu MÓN CUỐI xong_sx) tự ghi don_hang.ngay_xong.
create or replace function kho.ghi_nhat_ky_mon() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_uid uuid; v_con int;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.don_hang_mon_nhat_ky(mon_id, don_id, tu, den, nguoi_id)
    values(new.id, new.don_id, old.trang_thai, new.trang_thai, v_uid);
  -- MÓN ĐẦU -> da_cat = VÀO CHUYỀN (bắt đầu LÀM). ngay_vao_chuyen ghi 1 lần (coalesce giữ mốc đầu, không đè).
  --   Tách lead time: ngay_chot→ngay_vao_chuyen = CHỜ (xếp hàng); ngay_vao_chuyen→ngay_xong = LÀM.
  if new.trang_thai = 'da_cat' then
    perform set_config('moc.auto_xong','1',true);
    update kho.don_hang set ngay_vao_chuyen = coalesce(ngay_vao_chuyen, current_date) where id = new.don_id;
    perform set_config('moc.auto_xong','',true);
  end if;
  -- MÓN CUỐI xong_sx -> ngay_xong THỰC TẾ (auto). Cờ moc.auto_xong=1 để qua chốt cấm-gõ-tay.
  if new.trang_thai = 'xong_sx' then
    select count(*) into v_con from kho.don_hang_mon m where m.don_id = new.don_id and m.trang_thai <> 'xong_sx';
    if v_con = 0 then
      perform set_config('moc.auto_xong','1',true);
      update kho.don_hang set ngay_xong = coalesce(ngay_xong, current_date) where id = new.don_id;
      perform set_config('moc.auto_xong','',true);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ghi_nk_mon on kho.don_hang_mon;
create trigger trg_ghi_nk_mon after update of trang_thai on kho.don_hang_mon
  for each row execute function kho.ghi_nhat_ky_mon();

-- ═══════════════ 2. NHẬT KÝ ĐƠN qua TRIGGER + CHỐNG TRÙNG với đường ghi tay (sale.js) ═══════════════
create or replace function kho.ghi_nhat_ky_don() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_uid uuid;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.don_hang_nhat_ky(don_id, tu, den, nguoi_id) values(new.id, old.trang_thai, new.trang_thai, v_uid);
  return new;
end $$;
drop trigger if exists trg_ghi_nk_don on kho.don_hang;
create trigger trg_ghi_nk_don after update of trang_thai on kho.don_hang
  for each row execute function kho.ghi_nhat_ky_don();

-- Chống trùng: đường ghi TAY (sale.js) chèn lại đúng lần đổi trigger đã ghi -> BỎ (skip), 1 lần đổi = 1 dòng.
--   Nhận diện trùng: cùng (don_id, den) + luc lệch ≤ 10 phút với dòng đã có. Backfill lịch sử cũ (luc xa) -> vẫn chèn.
create or replace function kho.chong_trung_nhat_ky_don() returns trigger
  language plpgsql security definer set search_path = kho as $$
begin
  if exists (select 1 from kho.don_hang_nhat_ky k
             where k.don_id = new.don_id and k.den is not distinct from new.den
               and abs(extract(epoch from (k.luc - new.luc))) <= 600) then
    return null;   -- trùng -> KHÔNG chèn (app KHÔNG lỗi, chỉ bỏ dòng thừa)
  end if;
  return new;
end $$;
drop trigger if exists trg_chong_trung_nk_don on kho.don_hang_nhat_ky;
create trigger trg_chong_trung_nk_don before insert on kho.don_hang_nhat_ky
  for each row execute function kho.chong_trung_nhat_ky_don();

-- ═══════════════ 3. MỐC NGÀY TÁCH BẠCH ═══════════════
-- ngay_hen_khach: sale hứa giao khách, gõ lúc chốt. ĐOÁN, VẪN SỬA được (khách đổi ý là thật).
alter table kho.don_hang add column if not exists ngay_hen_khach date;
comment on column kho.don_hang.ngay_hen_khach is 'ĐOÁN — sale hứa ngày giao khách (gõ lúc chốt; SỬA được khi khách đổi ý)';
-- ngay_hen_khach_ban_dau: LỜI HỨA ĐẦU TIÊN với khách. GHI MỘT LẦN (tự bắt từ ngay_hen_khach lần đầu), CHẶN sửa.
--   LÝ DO: sale hứa 15/08 không kịp rồi sửa 20/08 -> đo lại thành "đúng hẹn"; phải giữ hứa đầu mới đo được uy tín.
alter table kho.don_hang add column if not exists ngay_hen_khach_ban_dau date;
comment on column kho.don_hang.ngay_hen_khach_ban_dau is 'ĐOÁN (bất biến) — lời hứa giao khách ĐẦU TIÊN; tự bắt lần đầu, KHÔNG sửa';
-- ngay_du_kien = ƯỚC XUẤT XƯỞNG (thiết kế đoán "ngày dự kiến sản xuất xong"). DÙNG LẠI, không thêm cột.
comment on column kho.don_hang.ngay_du_kien is 'ĐOÁN — thiết kế ước ngày xuất xưởng (=ngày dự kiến sản xuất xong), gõ lúc nhận đơn';
-- ngay_xong = THỰC TẾ xuất xưởng (trigger tự ghi khi món cuối xong_sx). CẤM gõ tay.
comment on column kho.don_hang.ngay_xong is 'THỰC TẾ — xuất xưởng, tự ghi khi món CUỐI xong_sx. KHÔNG gõ tay';
-- ngay_vao_chuyen = THỰC TẾ vào chuyền (tự ghi khi món ĐẦU da_cat). CẤM gõ tay.
comment on column kho.don_hang.ngay_vao_chuyen is 'THỰC TẾ — vào chuyền (bắt đầu LÀM), tự ghi khi món ĐẦU da_cat. KHÔNG gõ tay';
-- sua_luc: CỘT CHẾT — không ai ghi (nhật ký đã thay vai trò "sửa lần cuối"). CEO chốt: BỎ, KHÔNG xoá cột (bảng đang chạy).
comment on column kho.don_hang.sua_luc is '[BỎ 2026-08-10] cột chết — không ai ghi, nhật ký thay thế. Giữ cột để không đụng bảng đang chạy.';
-- ngay_thu: để LÔ SAU (việc kế toán) — chưa nối dây.

-- Chặn gõ tay ngay_xong + ngay_vao_chuyen (chỉ đường auto moc.auto_xong=1 được đổi).
create or replace function kho.chan_go_tay_moc_thuc_te() returns trigger
  language plpgsql set search_path = kho as $$
begin
  if coalesce(current_setting('moc.auto_xong', true),'') = '1' then return new; end if;   -- đường auto
  if new.ngay_xong is distinct from old.ngay_xong then
    raise exception 'ngay_xong là cột THỰC TẾ (tự ghi khi món cuối xong_sx) — KHÔNG gõ tay'; end if;
  if new.ngay_vao_chuyen is distinct from old.ngay_vao_chuyen then
    raise exception 'ngay_vao_chuyen là cột THỰC TẾ (tự ghi khi món đầu da_cat) — KHÔNG gõ tay'; end if;
  return new;
end $$;
drop trigger if exists trg_chan_go_ngay_xong on kho.don_hang;
drop trigger if exists trg_chan_go_moc on kho.don_hang;
create trigger trg_chan_go_moc before update on kho.don_hang
  for each row execute function kho.chan_go_tay_moc_thuc_te();

-- ngay_hen_khach_ban_dau: tự BẮT lần đầu (từ ngay_hen_khach), CHẶN sửa sau đó.
create or replace function kho.giu_hen_khach_ban_dau() returns trigger
  language plpgsql set search_path = kho as $$
begin
  if tg_op = 'UPDATE' and old.ngay_hen_khach_ban_dau is not null
     and new.ngay_hen_khach_ban_dau is distinct from old.ngay_hen_khach_ban_dau then
    raise exception 'ngay_hen_khach_ban_dau ghi MỘT LẦN (lời hứa đầu với khách) — KHÔNG sửa';
  end if;
  -- tự bắt lần đầu từ ngay_hen_khach
  if new.ngay_hen_khach_ban_dau is null and new.ngay_hen_khach is not null then
    new.ngay_hen_khach_ban_dau := new.ngay_hen_khach;
  end if;
  return new;
end $$;
drop trigger if exists trg_giu_hen_ban_dau on kho.don_hang;
create trigger trg_giu_hen_ban_dau before insert or update on kho.don_hang
  for each row execute function kho.giu_hen_khach_ban_dau();

-- ═══════════════ 4. (cột chết: đề xuất ở phần KẾT — sua_luc BỎ (comment), ngay_thu để lô sau) ═══════════════

-- ═══════════════ 5. mon_dung_yen(N) — món chưa đổi trạng thái quá N ngày ═══════════════
create or replace function kho.mon_dung_yen(p_ngay int)
  returns table(mon_id uuid, don_id uuid, ma_don text, ten text, trang_thai text, so_ngay_dung int)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'mon_dung_yen: chỉ ceo/ke_toan/xuong'; end if;
  return query
  select m.id, m.don_id, d.ma_don, m.ten, m.trang_thai,
    (current_date - (coalesce((select max(k.luc) from kho.don_hang_mon_nhat_ky k where k.mon_id = m.id), m.tao_luc))::date) as so_ngay
  from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
  where m.trang_thai <> 'xong_sx'
    and (current_date - (coalesce((select max(k.luc) from kho.don_hang_mon_nhat_ky k where k.mon_id = m.id), m.tao_luc))::date) > p_ngay
  order by so_ngay desc;
end $$;
grant execute on function kho.mon_dung_yen(int) to authenticated;

-- ═══════════════ 6. lead_time — TÁCH HAI KHÚC: CHỜ (chốt→vào chuyền) + LÀM (vào chuyền→xong). cho+lam=tong ═══════════════
create or replace function kho.lead_time(p_dong text default null, p_sku text default null, p_so_don int default 20)
  returns table(cho_tb numeric, lam_tb numeric, tong_tb numeric, tong_nhanh int, tong_cham int, so_don int, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'lead_time: chỉ ceo/ke_toan/xuong'; end if;
  return query
  with d as (
    select (dh.ngay_vao_chuyen - dh.ngay_chot) cho,     -- CHỜ (xếp hàng)
           (dh.ngay_xong - dh.ngay_vao_chuyen)  lam,     -- LÀM
           (dh.ngay_xong - dh.ngay_chot)        tong
    from kho.don_hang dh
    where dh.ngay_chot is not null and dh.ngay_xong is not null and dh.ngay_vao_chuyen is not null
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%'))
    order by dh.ngay_xong desc
    limit greatest(p_so_don, 1)
  )
  select round(avg(cho),1), round(avg(lam),1), round(avg(tong),1), min(tong)::int, max(tong)::int, count(*)::int,
         case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end
  from d;
end $$;
grant execute on function kho.lead_time(text, text, int) to authenticated;

-- ═══════════════ 7. do_lech_uoc(dong, sku) — lệch giữa ước xuất xưởng (ngay_du_kien) và thực (ngay_xong) ═══════════════
create or replace function kho.do_lech_uoc(p_dong text default null, p_sku text default null)
  returns table(lech_tb_ngay numeric, so_don int, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'do_lech_uoc: chỉ ceo/ke_toan/xuong'; end if;
  return query
  with d as (
    select (dh.ngay_xong - dh.ngay_du_kien) lech
    from kho.don_hang dh
    where dh.ngay_du_kien is not null and dh.ngay_xong is not null
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%'))
  )
  select round(avg(lech),1), count(*)::int,
         case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end
  from d;
end $$;
grant execute on function kho.do_lech_uoc(text, text) to authenticated;

-- ═══════════════ 7b. do_lech_hen_khach — UY TÍN VỚI KHÁCH: lệch giữa HỨA ĐẦU (ban_dau) và ngay_giao ═══════════════
--   Quan trọng hơn do_lech_uoc: đo mình có giữ lời với khách không. (+ = giao TRỄ so với hứa đầu)
create or replace function kho.do_lech_hen_khach(p_dong text default null, p_sku text default null)
  returns table(lech_tb_ngay numeric, so_don int, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'do_lech_hen_khach: chỉ ceo/ke_toan/xuong'; end if;
  return query
  with d as (
    select (dh.ngay_giao - dh.ngay_hen_khach_ban_dau) lech
    from kho.don_hang dh
    where dh.ngay_hen_khach_ban_dau is not null and dh.ngay_giao is not null
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%'))
  )
  select round(avg(lech),1), count(*)::int,
         case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end
  from d;
end $$;
grant execute on function kho.do_lech_hen_khach(text, text) to authenticated;

-- ═══════════════ RLS ═══════════════
-- Nhật ký MÓN: đọc ceo/ke_toan/xuong/sale (sale trả lời khách đơn ở đâu). GHI chỉ qua trigger (SECURITY DEFINER).
grant select on kho.don_hang_mon_nhat_ky to authenticated;
revoke insert, update, delete on kho.don_hang_mon_nhat_ky from authenticated;
revoke all on kho.don_hang_mon_nhat_ky from anon;
alter table kho.don_hang_mon_nhat_ky enable row level security;
drop policy if exists dhmnk_doc on kho.don_hang_mon_nhat_ky;
create policy dhmnk_doc on kho.don_hang_mon_nhat_ky for select
  using (kho.current_vai_tro() = any(array['ceo','ke_toan','xuong','sale']));

-- Nhật ký ĐƠN: MỞ đọc thêm ke_toan + xuong (giữ ceo/kho/sale sẵn có — KHÔNG bỏ kho). Trigger ghi (definer).
drop policy if exists dhnk_doc on kho.don_hang_nhat_ky;
create policy dhnk_doc on kho.don_hang_nhat_ky for select
  using (kho.current_vai_tro() = any(array['ceo','kho','ke_toan','xuong','sale']));

commit;
