-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 154 — WP-47 (QD-68): LỊCH nguồn/suy. nang_luc_to + moc_lich = NGUỒN (người nhập qua RPC);
--   xep_lich = SUY (client KHÔNG ghi được). Nới bảng nguồn + 3 RPC + bật RLS.
--   ⚠ "quan_doc" trong đầu bài = vai 'xuong' (quản đốc) — KHÔNG có role 'quan_doc' trong CHECK vai_tro;
--     quản đốc là vai 'xuong' theo db/043. nl_ghi mở cho ('xuong','ceo').
--
--   FORCE RLS — QUYẾT (2 dòng): các hàm ghi/đọc (luu_xep_lich·tl_doi_viec·_sched·nang_luc_to_tuan…)
--   là SECURITY DEFINER OWNER=postgres, tức chạy BẰNG CHỦ BẢNG. Chủ bảng BỎ QUA RLS khi KHÔNG force →
--   ta ENABLE RLS *KHÔNG FORCE*: hàm DEFINER vẫn ghi/đọc, client (authenticated) chỉ có policy SELECT →
--   INSERT/UPDATE/DELETE xep_lich bị chặn. (chứng minh: test_wp47 4.7 luu_xep_lich vẫn ghi sau khi bật.)
--
--   HOÀN TÁC:
--     drop function kho.nl_ds(); drop function kho.nl_ghi(text,int,numeric,int,numeric,date,text);
--     drop function kho.moc_lich_ghi(int,int);
--     alter table kho.nang_luc_to disable row level security; drop policy nl_doc on kho.nang_luc_to;
--     alter table kho.moc_lich disable row level security; drop policy ml_doc on kho.moc_lich;
--     alter table kho.xep_lich disable row level security; drop policy xl_doc on kho.xep_lich;
--     alter table kho.nang_luc_to drop column sua_boi, drop column sua_luc, drop column ly_do, drop column xac_nhan;
--     alter table kho.moc_lich drop column sua_boi, drop column sua_luc;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────── 1 · NỚI BẢNG NGUỒN (không thêm bảng mới; khoảng ngày nang_luc_to = lịch sử) ───────────
alter table kho.nang_luc_to
  add column if not exists sua_boi  uuid,
  add column if not exists sua_luc  timestamptz default now(),
  add column if not exists ly_do    text,
  add column if not exists xac_nhan boolean not null default false;   -- 7 seed cũ nhận false

alter table kho.moc_lich
  add column if not exists sua_boi uuid,
  add column if not exists sua_luc timestamptz default now();

-- ─────────── 2 · BA RPC (SECURITY DEFINER, vai theo current_vai_tro()→auth_uid) ───────────
-- nl_ds: 7 tổ, khoảng đang hiệu lực (den_ngay null), giờ/tuần tính sẵn, cờ xac_nhan.
create or replace function kho.nl_ds()
  returns table(ma_to text, ten text, so_nguoi int, gio_moi_ngay numeric, ngay_moi_tuan int,
    he_so_huu_ich numeric, tu_ngay date, den_ngay date, gio_tuan numeric,
    xac_nhan boolean, ly_do text, sua_luc timestamptz)
  language sql stable security definer set search_path = kho as $$
  select t.ma_to, t.ten, n.so_nguoi, n.gio_moi_ngay, n.ngay_moi_tuan, n.he_so_huu_ich,
    n.tu_ngay, n.den_ngay,
    round(coalesce(n.so_nguoi,0) * coalesce(n.gio_moi_ngay,0) * coalesce(n.ngay_moi_tuan,0) * coalesce(n.he_so_huu_ich,0), 1) gio_tuan,
    coalesce(n.xac_nhan,false), n.ly_do, n.sua_luc
  from kho.to_san_xuat t
  left join lateral (
    select * from kho.nang_luc_to n2 where n2.ma_to = t.ma_to and n2.den_ngay is null
    order by n2.tu_ngay desc limit 1
  ) n on true
  order by t.ma_to;
$$;
grant execute on function kho.nl_ds() to authenticated;

-- nl_ghi: quản đốc(xuong)+ceo. Đóng khoảng mở (den = p_tu_ngay-1), mở khoảng mới den NULL, xac_nhan=true.
--   p_tu_ngay < CURRENT_DATE → RAISE. p_ngay_moi_tuan=0 HỢP LỆ (khai nghỉ Tết/lễ).
create or replace function kho.nl_ghi(p_ma_to text, p_so_nguoi int, p_gio_moi_ngay numeric,
    p_ngay_moi_tuan int, p_he_so numeric, p_tu_ngay date, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); v_id bigint;
begin
  if v_vai not in ('xuong','ceo') then
    raise exception 'nl_ghi: chỉ quản đốc (xuong) / ceo (vai "%")', v_vai; end if;
  if p_tu_ngay is null then raise exception 'nl_ghi: thiếu p_tu_ngay'; end if;
  if p_tu_ngay < current_date then
    raise exception 'nl_ghi: p_tu_ngay (%) < hôm nay — cấm sửa ngược quá khứ (lịch cũ đã tính bằng số cũ)', p_tu_ngay; end if;
  if not exists (select 1 from kho.to_san_xuat where ma_to = p_ma_to) then
    raise exception 'nl_ghi: không có tổ "%"', p_ma_to; end if;
  -- đóng khoảng đang mở tại p_tu_ngay-1 (chỉ khoảng bắt đầu TRƯỚC p_tu_ngay để den>=tu).
  update kho.nang_luc_to
     set den_ngay = p_tu_ngay - 1, sua_boi = v_ns, sua_luc = now()
   where ma_to = p_ma_to and den_ngay is null and tu_ngay <= p_tu_ngay - 1;
  -- mở khoảng mới (nếu còn khoảng mở bắt đầu >= p_tu_ngay chưa đóng → EXCLUDE sẽ nổ, đúng: chặn chồng).
  insert into kho.nang_luc_to(ma_to, tu_ngay, den_ngay, so_nguoi, gio_moi_ngay, ngay_moi_tuan,
      he_so_huu_ich, xac_nhan, sua_boi, sua_luc, ly_do)
    values(p_ma_to, p_tu_ngay, null, p_so_nguoi, p_gio_moi_ngay, p_ngay_moi_tuan,
      p_he_so, true, v_ns, now(), p_ly_do)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ma_to', p_ma_to, 'tu_ngay', p_tu_ngay,
    'ngay_moi_tuan', p_ngay_moi_tuan);
end $$;
grant execute on function kho.nl_ghi(text, int, numeric, int, numeric, date, text) to authenticated;

-- moc_lich_ghi: CEO-only, 0 ≤ mỗi số ≤ 8.
create or replace function kho.moc_lich_ghi(p_dong_bang int, p_vung_chac int)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns();
begin
  if v_vai <> 'ceo' then raise exception 'moc_lich_ghi: chỉ ceo (vai "%")', v_vai; end if;
  if p_dong_bang is null or p_vung_chac is null
     or p_dong_bang < 0 or p_dong_bang > 8 or p_vung_chac < 0 or p_vung_chac > 8 then
    raise exception 'moc_lich_ghi: mỗi số phải trong 0..8 (dong_bang=%, vung_chac=%)', p_dong_bang, p_vung_chac; end if;
  update kho.moc_lich set so_tuan = p_dong_bang, sua_boi = v_ns, sua_luc = now() where ma = 'dong_bang';
  update kho.moc_lich set so_tuan = p_vung_chac, sua_boi = v_ns, sua_luc = now() where ma = 'vung_chac';
  return jsonb_build_object('ok', true, 'dong_bang', p_dong_bang, 'vung_chac', p_vung_chac);
end $$;
grant execute on function kho.moc_lich_ghi(int, int) to authenticated;

-- ─────────── 3 · BẬT HÀNG RÀO — policy SELECT TRƯỚC, rồi mới ENABLE RLS (KHÔNG force) ───────────
-- a. policy SELECT cho authenticated trên cả 3 bảng.
drop policy if exists nl_doc on kho.nang_luc_to;
create policy nl_doc on kho.nang_luc_to for select to authenticated using (true);
drop policy if exists ml_doc on kho.moc_lich;
create policy ml_doc on kho.moc_lich for select to authenticated using (true);
drop policy if exists xl_doc on kho.xep_lich;
create policy xl_doc on kho.xep_lich for select to authenticated using (true);
-- b. ENABLE RLS (KHÔNG FORCE — chủ bảng postgres = role DEFINER bỏ qua RLS, hàm ghi vẫn sống).
alter table kho.nang_luc_to enable row level security;
alter table kho.moc_lich   enable row level security;
alter table kho.xep_lich   enable row level security;
-- c. xep_lich: KHÔNG policy INSERT/UPDATE/DELETE nào cho client → client chỉ đọc; ghi chỉ qua RPC DEFINER.

-- ─────────── 4 · KIỂM nhanh trong migration ───────────
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies where schemaname='kho' and tablename in ('nang_luc_to','moc_lich','xep_lich') and cmd='SELECT';
  if v_n <> 3 then raise exception 'WP-47: thiếu policy SELECT (có %)', v_n; end if;
  if (select count(*) from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname='kho' and cl.relname in ('nang_luc_to','moc_lich','xep_lich') and relrowsecurity) <> 3 then
    raise exception 'WP-47: RLS chưa bật đủ 3 bảng'; end if;
  if (select bool_or(relforcerowsecurity) from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname='kho' and cl.relname='xep_lich') then
    raise exception 'WP-47: xep_lich KHÔNG được FORCE (sẽ giết luu_xep_lich DEFINER)'; end if;
  raise notice 'db/154 OK: 3 policy SELECT, RLS bật 3 bảng, xep_lich KHÔNG force.';
end $$;

commit;
