-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 174 — WP-75 L-1 (QD-72): TRỤC MỐC BÀN GIAO + LỊCH THU THEO ĐỢT + CỬA CỌC dự án.
--   Ba việc gộp một migration vì đều SIẾT ràng buộc quanh mốc bàn giao / dòng tiền (ngoại lệ 06 §1c.1).
--
--   §1 MỐC BÀN GIAO = trục THỨ HAI cạnh 15 trạng thái (ERP 5.3.3). don_hang.moc_ban_giao
--      (chua_giao→da_giao_chua_lap→da_lap_xong). Client KHÔNG ghi (cột mới = 0 grant, db/150 snapshot 69 cột).
--      Chỉ TIẾN 1 nấc, LÙI chỉ ceo+lý do. Vào da_giao_chua_lap TỰ ĐỘNG qua doi_trang_thai_don(da_giao) —
--      không mở đường ghi thứ hai.
--   §2 lich_thu = đợt thu (mốc + tỷ lệ). Sửa = TÁCH KHOẢNG (hieu_luc_den) + lý do, cấm ghi đè (khuôn QD-68).
--      Σ tỷ lệ đợt đang hiệu lực = 100 (constraint trigger DEFERRABLE — kiểm cuối transaction).
--      "Đã thu" lấy qua VIEW v_tien_da_thu DÙNG CHUNG với con_phai_thu (cấm chép công thức — bài học 03 §C).
--   §3 CỬA CỌC: dự án thiếu cọc (phieu_thu loai='coc') < ngưỡng % → chặn bàn giao. Cửa vượt CHỈ ceo + lý do,
--      ghi vết 3 cột. Cọc là tiền THẬT nên không vênh QD-69.
--
--   HOÀN TÁC: drop function kho.lich_thu_den_han(date), kho.lt_ghi(uuid,jsonb,text), kho.lt_sinh_mac_dinh(uuid),
--     kho.dat_moc_ban_giao(uuid,text,text), kho.gia_don(numeric,numeric,numeric), kho.lt_kiem_tong() cascade;
--     drop view kho.v_tien_da_thu; drop table kho.lich_thu;
--     alter table kho.don_hang drop column moc_ban_giao, drop column moc_dat_luc, drop column moc_nguoi,
--       drop column vuot_coc_boi, drop column vuot_coc_luc, drop column vuot_coc_ly_do;
--     alter table kho.tham_so_tai_chinh drop column coc_toi_thieu_du_an_pct;
--     (khôi phục ban_giao_xuong/doi_trang_thai_don/chot_don/con_phai_thu bản trước từ git.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §0 · HELPER DÙNG CHUNG (một nguồn suy)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- gia_don: giá đơn dùng khắp nơi (con_phai_thu cũng coalesce y hệt) — gom một chỗ.
--   Nhận 3 SCALAR (không nhận cả row kho.don_hang) để planner chỉ kéo 3 cột — tránh vác composite qua WindowAgg (đo: 1345ms→…).
drop function if exists kho.gia_don(kho.don_hang);   -- bỏ ký composite cũ (nếu có) để không thành overload
create or replace function kho.gia_don(p_gia_chot numeric, p_doanh_thu numeric, p_gia_cong_thuc numeric) returns numeric
  language sql immutable as $$ select coalesce(p_gia_chot, p_doanh_thu, p_gia_cong_thuc, 0) $$;

-- v_tien_da_thu: ĐÃ THU mỗi đơn = tổng phieu_thu.so_tien. ĐỊNH NGHĨA DUY NHẤT (con_phai_thu + lich_thu_den_han cùng đọc).
create or replace view kho.v_tien_da_thu as
  select ma_don, sum(so_tien) as da_thu from kho.phieu_thu group by ma_don;
grant select on kho.v_tien_da_thu to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §1 · TRỤC MỐC BÀN GIAO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table kho.don_hang add column if not exists moc_ban_giao text not null default 'chua_giao';
alter table kho.don_hang add column if not exists moc_dat_luc timestamptz;
alter table kho.don_hang add column if not exists moc_nguoi uuid;
alter table kho.don_hang drop constraint if exists chk_moc_ban_giao;
alter table kho.don_hang add constraint chk_moc_ban_giao
  check (moc_ban_giao in ('chua_giao','da_giao_chua_lap','da_lap_xong'));

-- Backfill: đơn ĐÃ giao (trang_thai='da_giao') coi như đã-giao-chưa-lắp (suy đoán lịch sử — ghi QD-72).
update kho.don_hang set moc_ban_giao = 'da_giao_chua_lap'
  where trang_thai = 'da_giao' and moc_ban_giao = 'chua_giao';

-- dat_moc_ban_giao: sale|ceo. TIẾN đúng 1 nấc (cấm nhảy cóc). LÙI chỉ ceo + lý do bắt buộc.
create or replace function kho.dat_moc_ban_giao(p_don_id uuid, p_moc text, p_ly_do text default null)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
  v_cur int; v_new int;
  f_i int; -- map bậc
begin
  if v_vai not in ('sale','ceo') then raise exception 'dat_moc_ban_giao: chỉ sale/ceo (vai "%")', v_vai; end if;
  if p_moc not in ('chua_giao','da_giao_chua_lap','da_lap_xong') then
    raise exception 'dat_moc_ban_giao: mốc "%" không hợp lệ', p_moc; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'dat_moc_ban_giao: không có đơn %', p_don_id; end if;
  v_cur := case v_don.moc_ban_giao when 'chua_giao' then 0 when 'da_giao_chua_lap' then 1 else 2 end;
  v_new := case p_moc when 'chua_giao' then 0 when 'da_giao_chua_lap' then 1 else 2 end;
  if v_new = v_cur then raise exception 'dat_moc_ban_giao: đơn "%" ĐÃ ở mốc "%"', v_don.ma_don, p_moc; end if;
  if v_new > v_cur then
    if v_new <> v_cur + 1 then
      raise exception 'dat_moc_ban_giao: cấm nhảy cóc từ "%" sang "%" — phải tiến từng nấc', v_don.moc_ban_giao, p_moc; end if;
  else
    if v_vai <> 'ceo' then raise exception 'dat_moc_ban_giao: LÙI mốc chỉ CEO (vai "%")', v_vai; end if;
    if coalesce(nullif(btrim(p_ly_do),''),'') = '' then
      raise exception 'dat_moc_ban_giao: LÙI mốc PHẢI có lý do'; end if;
  end if;
  update kho.don_hang set moc_ban_giao = p_moc, moc_dat_luc = now(), moc_nguoi = kho.current_ns()
    where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'moc_ban_giao', p_moc);
end $fn$;
grant execute on function kho.dat_moc_ban_giao(uuid,text,text) to authenticated;

-- doi_trang_thai_don: nhánh da_giao TỰ set moc_ban_giao.
CREATE OR REPLACE FUNCTION kho.doi_trang_thai_don(p_don_id uuid, p_trang_thai_moi text, p_ly_do text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho', 'public'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
  v_cho text[] := array['bao_gia','bao_gia_thua','bao_gia_treo','tam_ngung','huy'];        -- whitelist thường
  v_sx  text[] := array['cho_cat','da_cat','dang_lam','xong_sx','cho_giao'];               -- [db/149] BỎ da_giao (xử riêng)
begin
  -- ═══ [QD-65] NHÁNH da_giao — "Đã giao": vai sale/ke_toan/ceo, CHỈ từ cho_giao ═══
  if p_trang_thai_moi = 'da_giao' then
    if v_vai not in ('sale','ke_toan','ceo') then
      raise exception 'doi_trang_thai_don(da_giao): chỉ sale/ke_toan/ceo (vai "%")', v_vai; end if;
    select * into v_don from kho.don_hang where id = p_don_id;
    if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
    if v_don.trang_thai = 'da_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" ĐÃ giao rồi', v_don.ma_don; end if;
    if v_don.trang_thai <> 'cho_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" đang "%" — chưa ở bước CHỜ GIAO, không đánh dấu "Đã giao" được (da_giao là mốc chốt doanh thu, cấm nhảy tắt)', v_don.ma_don, v_don.trang_thai; end if;
    -- [WP-75 §1] vào da_giao_chua_lap TỰ ĐỘNG (không mở đường ghi thứ hai; đọc OLD moc_ban_giao trong cùng UPDATE)
    update kho.don_hang set trang_thai = 'da_giao',
        moc_ban_giao = case when moc_ban_giao = 'chua_giao' then 'da_giao_chua_lap' else moc_ban_giao end,
        moc_dat_luc  = case when moc_ban_giao = 'chua_giao' then now() else moc_dat_luc end,
        moc_nguoi    = case when moc_ban_giao = 'chua_giao' then kho.current_ns() else moc_nguoi end
      where id = p_don_id;   -- trg_ghi_nk_don TỰ ghi dấu vết người/lúc
    return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'da_giao');
  end if;

  -- ═══ các đích còn lại (KHÔNG da_giao) — như db/148 ═══
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'doi_trang_thai_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  if p_trang_thai_moi = any(v_sx) then
    raise exception 'doi_trang_thai_don: KHÔNG đổi sang "%" — vào sản xuất CHỈ qua bàn giao xưởng (QD-47)', p_trang_thai_moi; end if;
  if p_trang_thai_moi = 'moi_len_don' then
    raise exception 'doi_trang_thai_don: lên đơn dùng chot_don, không dùng hàm này'; end if;
  if not (p_trang_thai_moi = any(v_cho)) then
    raise exception 'doi_trang_thai_don: đích "%" không cho phép (chỉ: %, hoặc da_giao từ cho_giao)', p_trang_thai_moi, array_to_string(v_cho, ', '); end if;
  if p_trang_thai_moi in ('tam_ngung','huy') and coalesce(nullif(btrim(p_ly_do),''),'') = '' then
    raise exception 'doi_trang_thai_don: đổi sang "%" PHẢI có lý do', p_trang_thai_moi; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = p_trang_thai_moi then
    raise exception 'doi_trang_thai_don: đơn "%" ĐÃ ở "%"', v_don.ma_don, p_trang_thai_moi; end if;
  if coalesce(nullif(btrim(p_ly_do),''),'') <> '' then
    perform set_config('moc.ly_do_lui', p_ly_do, true); end if;
  update kho.don_hang
     set trang_thai = p_trang_thai_moi,
         ly_do_huy  = case when p_trang_thai_moi in ('huy','tam_ngung') then p_ly_do else ly_do_huy end
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', p_trang_thai_moi);
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §2 · LỊCH THU THEO ĐỢT
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists kho.lich_thu (
  id            bigint generated always as identity primary key,
  don_hang_id   uuid not null references kho.don_hang(id) on delete cascade,
  so_dot        int  not null,
  moc           text not null check (moc in ('chot_don','da_giao_chua_lap','da_lap_xong','ngay_co_dinh')),
  ty_le         numeric(5,2) not null check (ty_le > 0 and ty_le <= 100),
  ngay_han      date,
  hieu_luc_tu   timestamptz not null default now(),
  hieu_luc_den  timestamptz,        -- NULL = đang hiệu lực
  ly_do         text,
  nguoi         uuid,
  tao_luc       timestamptz not null default now(),
  constraint chk_lt_ngay_han check ((moc = 'ngay_co_dinh') = (ngay_han is not null))
);
drop index if exists kho.idx_lich_thu_don_hieu_luc;   -- tái tạo với (don_hang_id,so_dot) include ty_le (nếu bản cũ chỉ có don_hang_id)
create index if not exists idx_lich_thu_don_hieu_luc on kho.lich_thu(don_hang_id, so_dot) include (ty_le) where hieu_luc_den is null;   -- phủ Σty_le + thứ tự window (index-only)
grant select on kho.lich_thu to authenticated;   -- client CHỈ đọc; ghi qua RPC DEFINER

-- Σ tỷ lệ đợt ĐANG HIỆU LỰC mỗi đơn = 100 — kiểm CUỐI transaction (ghi cả bộ đợt mới xong mới đúng).
create or replace function kho.lt_kiem_tong() returns trigger
  language plpgsql set search_path to 'kho' as $fn$
declare v_don uuid; v_sum numeric; v_cnt int;
begin
  v_don := coalesce(NEW.don_hang_id, OLD.don_hang_id);
  select count(*), coalesce(sum(ty_le),0) into v_cnt, v_sum
    from kho.lich_thu where don_hang_id = v_don and hieu_luc_den is null;
  if v_cnt > 0 and round(v_sum,2) <> 100 then
    raise exception 'LICH_THU_TONG: đơn % có Σ tỷ lệ đợt đang hiệu lực = % (phải = 100)', v_don, v_sum; end if;
  return null;
end $fn$;
drop trigger if exists trg_lt_tong on kho.lich_thu;
create constraint trigger trg_lt_tong after insert or update or delete on kho.lich_thu
  deferrable initially deferred for each row execute function kho.lt_kiem_tong();

-- lt_sinh_mac_dinh: dự án 30/40/30 theo mốc chốt/đã-giao/lắp-xong; lẻ+combo 1 đợt 100% mốc đã-giao. Sinh rồi thôi.
create or replace function kho.lt_sinh_mac_dinh(p_don_id uuid)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_don kho.don_hang; v_n int;
begin
  if exists (select 1 from kho.lich_thu where don_hang_id = p_don_id) then
    return jsonb_build_object('ok', true, 'sinh', false, 'ly_do', 'da_co_lich'); end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'lt_sinh_mac_dinh: không có đơn %', p_don_id; end if;
  if coalesce(v_don.dong,'') = 'du_an' then
    insert into kho.lich_thu(don_hang_id, so_dot, moc, ty_le, nguoi) values
      (p_don_id, 1, 'chot_don', 30, kho.current_ns()),
      (p_don_id, 2, 'da_giao_chua_lap', 40, kho.current_ns()),
      (p_don_id, 3, 'da_lap_xong', 30, kho.current_ns());
    v_n := 3;
  else
    insert into kho.lich_thu(don_hang_id, so_dot, moc, ty_le, nguoi) values
      (p_don_id, 1, 'da_giao_chua_lap', 100, kho.current_ns());
    v_n := 1;
  end if;
  return jsonb_build_object('ok', true, 'sinh', true, 'so_dot', v_n);
end $fn$;
grant execute on function kho.lt_sinh_mac_dinh(uuid) to authenticated;

-- lt_ghi: đóng khoảng cũ (hieu_luc_den=now) rồi chèn bộ mới. Đơn ĐÃ chốt mà thiếu lý do → RAISE.
create or replace function kho.lt_ghi(p_don_id uuid, p_dot jsonb, p_ly_do text default null)
returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang; e jsonb; v_n int := 0; v_da_chot boolean;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'lt_ghi: chỉ ceo/ke_toan (vai "%")', v_vai; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'lt_ghi: không có đơn %', p_don_id; end if;
  if p_dot is null or jsonb_typeof(p_dot) <> 'array' or jsonb_array_length(p_dot) = 0 then
    raise exception 'lt_ghi: p_dot phải là mảng đợt không rỗng'; end if;
  v_da_chot := v_don.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo');
  if v_da_chot and exists (select 1 from kho.lich_thu where don_hang_id = p_don_id and hieu_luc_den is null)
     and coalesce(nullif(btrim(p_ly_do),''),'') = '' then
    raise exception 'lt_ghi: đơn "%" đã chốt — sửa lịch thu PHẢI có lý do', v_don.ma_don; end if;
  update kho.lich_thu set hieu_luc_den = now()
    where don_hang_id = p_don_id and hieu_luc_den is null;
  for e in select * from jsonb_array_elements(p_dot) loop
    insert into kho.lich_thu(don_hang_id, so_dot, moc, ty_le, ngay_han, ly_do, nguoi)
      values (p_don_id, (e->>'so_dot')::int, e->>'moc', (e->>'ty_le')::numeric,
              nullif(e->>'ngay_han','')::date, p_ly_do, kho.current_ns());
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'so_dot_moi', v_n);
end $fn$;
grant execute on function kho.lt_ghi(uuid,jsonb,text) to authenticated;

-- lich_thu_den_han: đợt có mốc ĐÃ ĐẠT và chưa thu đủ. Phân bổ tiền đã thu FIFO theo so_dot (dùng v_tien_da_thu).
--   HAI TẦNG để KHÔNG window cả kho: (1) owe = đơn CÒN NỢ (Σty_le×gia > đã thu) — prune đơn trả đủ TRƯỚC;
--   (2) chỉ window đợt của đơn còn nợ. Đo 100k: window chỉ chạy trên tập nợ (nhỏ) thay vì toàn bộ. work_mem cao để hash không tràn đĩa.
drop function if exists kho.lich_thu_den_han(date);   -- [L-2b] thêm p_gom_demo = ký mới → bỏ ký cũ (tránh overload, bài học WP-08)
create or replace function kho.lich_thu_den_han(p_ngay date default current_date, p_gom_demo boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'kho' set work_mem to '64MB' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_out jsonb;
begin
  if v_vai not in ('sale','ceo','ke_toan') then raise exception 'lich_thu_den_han: chỉ sale/ceo/ke_toan'; end if;   -- [WP-75 L-2a] sale xem đợt đến hạn để đòi tiền (chỉ ĐỌC)
  with lt_agg as (   -- Σ tỷ lệ mỗi đơn — CHỈ từ lich_thu (không join don_hang) → gộp nhanh
    select don_hang_id, sum(ty_le) as sum_ty from kho.lich_thu where hieu_luc_den is null group by don_hang_id
  ), owe as (        -- đơn CÒN NỢ: đã thu < tổng phải thu (prune đơn trả đủ trước khi window)
    select a.don_hang_id, coalesce(v.da_thu,0) as da_thu
    from lt_agg a join kho.don_hang d on d.id = a.don_hang_id
      left join kho.v_tien_da_thu v on v.ma_don = d.ma_don
    where (p_gom_demo or coalesce(d.la_demo,false) = false)   -- [L-2b QD-46] mặc định ẨN demo (màn ĐÒI TIỀN — dòng demo lọt = gọi nhầm khách); p_gom_demo=true mới hiện
      and coalesce(v.da_thu,0) < round(kho.gia_don(d.gia_chot,d.doanh_thu,d.gia_cong_thuc) * a.sum_ty / 100.0, 0)
  ), calc as (       -- chỉ đợt của đơn còn nợ → window nhỏ; FIFO cum_due theo so_dot
    select lt.id, o.don_hang_id, d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') as khach,
           lt.so_dot, count(*) over (partition by o.don_hang_id) as so_dot_tong, lt.moc, lt.ty_le, lt.ngay_han, o.da_thu,
           round(kho.gia_don(d.gia_chot,d.doanh_thu,d.gia_cong_thuc) * lt.ty_le / 100.0, 0) as due,
           sum(round(kho.gia_don(d.gia_chot,d.doanh_thu,d.gia_cong_thuc) * lt.ty_le / 100.0, 0))
             over (partition by o.don_hang_id order by lt.so_dot rows between unbounded preceding and current row) as cum_due,
           (case lt.moc when 'da_giao_chua_lap' then d.moc_dat_luc::date
                        when 'da_lap_xong'      then d.moc_dat_luc::date
                        when 'ngay_co_dinh'     then lt.ngay_han end) as ngay_dat_moc,
           (case lt.moc
              when 'chot_don'         then d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')
              when 'da_giao_chua_lap' then d.moc_ban_giao in ('da_giao_chua_lap','da_lap_xong')
              when 'da_lap_xong'      then d.moc_ban_giao = 'da_lap_xong'
              when 'ngay_co_dinh'     then lt.ngay_han is not null and lt.ngay_han <= p_ngay
            end) as dat_moc
    from owe o
      join kho.lich_thu lt on lt.don_hang_id = o.don_hang_id and lt.hieu_luc_den is null
      join kho.don_hang d on d.id = o.don_hang_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ma_don', ma_don, 'khach', khach, 'so_dot', so_dot, 'so_dot_tong', so_dot_tong,
           'moc', moc, 'ty_le', ty_le, 'ngay_han', ngay_han, 'ngay_dat_moc', ngay_dat_moc,
           'tuoi', case when ngay_dat_moc is not null then (p_ngay - ngay_dat_moc) else null end,
           'due', due,
           'da_thu', greatest(least(due, da_thu - (cum_due - due)), 0),   -- đã thu PHÂN BỔ vào đợt này (FIFO)
           'con_thieu', greatest(least(due, cum_due - da_thu), 0)) order by ma_don, so_dot), '[]'::jsonb)
    into v_out from calc
    where dat_moc is true and greatest(least(due, cum_due - da_thu), 0) > 0;
  return jsonb_build_object('ok', true, 'ngay', p_ngay, 'dot', v_out);
end $fn$;
grant execute on function kho.lich_thu_den_han(date, boolean) to authenticated;

-- lich_thu_cua_don: ĐỌC toàn bộ đợt của MỘT đơn cho thẻ đơn (App Sale) — tiền TỪ DB (client không nhân tỷ lệ × giá).
--   [WP-75 L-2] vá lỗ đọc: L-1 mới có lt_ghi/lich_thu_den_han(lọc); thẻ đơn cần đọc CẢ bộ đợt + mốc + Σ. Dùng chung gia_don + v_tien_da_thu.
create or replace function kho.lich_thu_cua_don(p_ma_don text)
returns jsonb language plpgsql stable security definer set search_path to 'kho' as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang; v_gia numeric; v_da numeric; v_dot jsonb;
begin
  if v_vai not in ('sale','ceo','ke_toan','thiet_ke','tk_ban_hang') then raise exception 'lich_thu_cua_don: không đủ quyền'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.id is null then raise exception 'lich_thu_cua_don: không có đơn %', p_ma_don; end if;
  v_gia := kho.gia_don(v_don.gia_chot, v_don.doanh_thu, v_don.gia_cong_thuc);
  v_da  := coalesce((select da_thu from kho.v_tien_da_thu where ma_don = p_ma_don), 0);
  select coalesce(jsonb_agg(jsonb_build_object(
      'so_dot', so_dot, 'moc', moc, 'ty_le', ty_le, 'ngay_han', ngay_han, 'due', due,
      'da_thu_dot', greatest(least(due, v_da - (cum_due - due)), 0),
      'con_thieu',  greatest(least(due, cum_due - v_da), 0),
      'dat_moc', dat_moc,
      'trang_thai', case when v_da >= cum_due then 'da_thu' when dat_moc then 'den_han' else 'chua_toi' end
    ) order by so_dot), '[]'::jsonb) into v_dot
  from (
    select so_dot, moc, ty_le, ngay_han, round(v_gia*ty_le/100.0,0) due,
      sum(round(v_gia*ty_le/100.0,0)) over (order by so_dot rows unbounded preceding) cum_due,
      (case moc when 'chot_don' then v_don.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo')
         when 'da_giao_chua_lap' then v_don.moc_ban_giao in ('da_giao_chua_lap','da_lap_xong')
         when 'da_lap_xong' then v_don.moc_ban_giao = 'da_lap_xong'
         when 'ngay_co_dinh' then ngay_han is not null and ngay_han <= current_date end) dat_moc
    from kho.lich_thu where don_hang_id = v_don.id and hieu_luc_den is null) z;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'don_id', v_don.id, 'dong', v_don.dong, 'gia', v_gia, 'da_thu', v_da,
    'moc_ban_giao', v_don.moc_ban_giao, 'moc_dat_luc', v_don.moc_dat_luc,
    'sum_ty_le', (select coalesce(sum(ty_le),0) from kho.lich_thu where don_hang_id=v_don.id and hieu_luc_den is null),
    'tong_due',  (select coalesce(sum(round(v_gia*ty_le/100.0,0)),0) from kho.lich_thu where don_hang_id=v_don.id and hieu_luc_den is null),
    'con_phai_thu', greatest(v_gia - v_da, 0), 'dot', v_dot);
end $fn$;
grant execute on function kho.lich_thu_cua_don(text) to authenticated;

-- [WP-75 L-2c] cờ CẢNH BÁO: đơn dự án đã bàn giao VƯỢT cửa cọc mà CHƯA đủ cọc → true tới khi thu đủ (QD-69, không tắt tay).
create or replace function kho.vuot_coc_canh_bao(p_ma_don text) returns boolean
  language sql stable security definer set search_path to 'kho' as $$
  select d.vuot_coc_boi is not null
     and coalesce((select sum(so_tien) from kho.phieu_thu where ma_don = p_ma_don and loai = 'coc'), 0)
       < round(kho.gia_don(d.gia_chot, d.doanh_thu, d.gia_cong_thuc) *
           coalesce((select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh where ma_ky = to_char(current_date,'YYYY-MM')),
                    (select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh order by ngay_ap_dung desc, ma_ky desc limit 1), 30) / 100.0, 0)
  from kho.don_hang d where d.ma_don = p_ma_don $$;
grant execute on function kho.vuot_coc_canh_bao(text) to authenticated;

-- con_phai_thu: refactor để "đã thu" đọc qua v_tien_da_thu (KHÔNG đổi hành vi — cùng công thức).
CREATE OR REPLACE FUNCTION kho.con_phai_thu(p_trang integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
declare v_ds jsonb; v_bac jsonb; v_tong numeric; v_sodon int; v_off int := (greatest(coalesce(p_trang,1),1)-1)*50;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'con_phai_thu: chỉ ceo/ke_toan'; end if;
  with pt as (select ma_don, da_thu from kho.v_tien_da_thu),   -- [WP-75] một nguồn suy "đã thu"
  base as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.nguon_khach, d.ngay_giao,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0) gia, coalesce(pt.da_thu,0) da_thu,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) con_lai,
           (current_date - d.ngay_giao) tuoi
    from kho.don_hang d left join pt on pt.ma_don=d.ma_don
    where d.trang_thai='da_giao' and d.ngay_giao is not null and coalesce(d.la_demo,false)=false
      and coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) > 0
      and not exists(select 1 from kho.giao_cod g where g.ma_don=d.ma_don and g.trang_thai='dang_giao')
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,
        'gia',gia,'da_thu',da_thu,'con_lai',con_lai,'tuoi',tuoi) order by tuoi desc, con_lai desc),'[]'::jsonb)
       from (select * from base order by tuoi desc, con_lai desc offset v_off limit 50) p),
    jsonb_build_object(
      'bac1', jsonb_build_object('nhan','Chưa quá 30 ngày','tien',coalesce(sum(con_lai) filter(where tuoi<=30),0),'so_don',count(*) filter(where tuoi<=30)),
      'bac2', jsonb_build_object('nhan','31–60 ngày','tien',coalesce(sum(con_lai) filter(where tuoi>30 and tuoi<=60),0),'so_don',count(*) filter(where tuoi>30 and tuoi<=60)),
      'bac3', jsonb_build_object('nhan','Quá 60 ngày','tien',coalesce(sum(con_lai) filter(where tuoi>60),0),'so_don',count(*) filter(where tuoi>60))),
    coalesce(sum(con_lai),0), count(*)::int
  into v_ds, v_bac, v_tong, v_sodon from base;
  return jsonb_build_object('trang',greatest(coalesce(p_trang,1),1),'so_trang',greatest(ceil(v_sodon/50.0)::int,1),
    'so_don',v_sodon,'tong',v_tong,'bac',v_bac,'dong',v_ds);
end $function$;

-- chot_don: gọi lt_sinh_mac_dinh sau khi lên đơn (sinh rồi thôi).
CREATE OR REPLACE FUNCTION kho.chot_don(p_don_id uuid, p_nguon_khach text, p_thuong_hieu text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho', 'public'
AS $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
begin
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'chot_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'chot_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = 'moi_len_don' then
    raise exception 'chot_don: đơn "%" ĐÃ lên đơn rồi (moi_len_don)', v_don.ma_don; end if;
  if v_don.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'chot_don: đơn "%" đang "%" — chỉ chốt được đơn báo giá (bao_gia/bao_gia_treo)', v_don.ma_don, v_don.trang_thai; end if;
  -- Ghi nguồn + thương hiệu (giữ giá trị cũ nếu tham số rỗng) rồi chuyển. kiem_chuyen_trang_thai (BEFORE UPDATE)
  --   TỰ bắt các điều kiện của nó (nguồn/thương hiệu trống, món giá<=0…) và RAISE — RPC KHÔNG chép lại luật đó,
  --   để lỗi nguyên văn nổi lên UI.
  update kho.don_hang
     set nguon_khach = coalesce(nullif(btrim(p_nguon_khach),''), nguon_khach),
         thuong_hieu = coalesce(nullif(btrim(p_thuong_hieu),''), thuong_hieu),
         trang_thai  = 'moi_len_don'
   where id = p_don_id;
  perform kho.lt_sinh_mac_dinh(p_don_id);   -- [WP-75 §2] sinh lịch thu mặc định (sinh rồi thôi)
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'moi_len_don');
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §3 · CỬA CỌC dự án
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table kho.tham_so_tai_chinh add column if not exists coc_toi_thieu_du_an_pct numeric default 30;
alter table kho.don_hang add column if not exists vuot_coc_boi uuid;
alter table kho.don_hang add column if not exists vuot_coc_luc timestamptz;
alter table kho.don_hang add column if not exists vuot_coc_ly_do text;

drop function if exists kho.ban_giao_xuong(text, jsonb, text);   -- tránh OVERLOAD (bài học WP-08): thêm tham số = ký mới, phải bỏ ký cũ
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text, p_ly_do_vuot_coc text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
  v_bom_cho jsonb;
  v_kieu text; v_xep jsonb; v_da_xep boolean := false; v_ly_do_xep text := null; v_so_dong_xep int := 0; v_i int; v_neo date;
  v_pct numeric; v_gia numeric; v_can numeric; v_da_coc numeric;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'ban_giao_xuong: chỉ ceo/thiet_ke'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'ban_giao_xuong: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'ban_giao_xuong: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  if v_don.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không gửi lại', p_ma_don, v_don.trang_thai; end if;
  if v_don.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_don.trang_thai not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không gửi được', p_ma_don, v_don.trang_thai; end if;
  select string_agg(ten, ', ') into v_chua_gan from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH') z;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  select string_agg(ten, ', ') into v_thieu_so from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'ok')::boolean is not true) z;
  if v_thieu_so is not null then raise exception 'THIEU_SO_DON_VI: món còn thiếu số: %', v_thieu_so; end if;

  select count(*) into v_miss
    from kho.so_don_vi_mon s join kho.don_hang_mon m on m.id = s.mon_id
    where m.don_id = v_don.id and s.moc = 'chuan' and s.chot_luc is null
      and not exists (
        select 1 from kho.quy_trinh_buoc b, kho.don_gia_baseline d
        where b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
              (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))
          and b.hoat_dong = s.hoat_dong and b.gio_moi_don_vi is not null
          and d.hoat_dong = s.hoat_dong and d.don_gia is not null);
  if v_miss > 0 then raise exception 'CHOT_THIEU_SO: % dòng số chuẩn thiếu phút/đơn giá để đóng băng — không bàn giao được', v_miss; end if;

  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'THIEU_FILE_CAT: chưa đính kèm file cắt nào'; end if;
  v_le_mau := (coalesce(v_don.dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'CHUA_KHACH_DUYET: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT', p_ma_don; end if;

  -- ═══ [WP-75 §3] CỬA CỌC dự án (QD-72): cọc = TIỀN THẬT từ phieu_thu loai='coc', KHÔNG phải số suy ═══
  --   Chỉ chặn dòng dự án. Ngưỡng đọc từ tham_so_tai_chinh.coc_toi_thieu_du_an_pct (kỳ hiện hành → kỳ mới nhất → 30).
  if coalesce(v_don.dong,'') = 'du_an' then
    v_pct := coalesce(
      (select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh where ma_ky = to_char(current_date,'YYYY-MM')),
      (select coc_toi_thieu_du_an_pct from kho.tham_so_tai_chinh order by ngay_ap_dung desc, ma_ky desc limit 1),
      30);
    v_gia := kho.gia_don(v_don.gia_chot, v_don.doanh_thu, v_don.gia_cong_thuc);
    v_can := round(v_gia * v_pct / 100.0);
    v_da_coc := coalesce((select sum(so_tien) from kho.phieu_thu where ma_don = p_ma_don and loai = 'coc'), 0);
    if v_da_coc < v_can then
      if coalesce(nullif(btrim(p_ly_do_vuot_coc),''),'') = '' then
        raise exception 'THIEU_COC: đơn dự án "%" cần cọc tối thiểu % đ (ngưỡng % phần trăm của % đ), đã cọc % đ, còn thiếu % đ — hoặc CEO nhập lý do vượt cọc',
          p_ma_don, v_can, v_pct, v_gia, v_da_coc, (v_can - v_da_coc);
      end if;
      if v_vai <> 'ceo' then
        raise exception 'VUOT_COC_CHI_CEO: chỉ CEO được vượt cửa cọc (vai "%") — cần cọc % đ, đã cọc % đ, còn thiếu % đ',
          v_vai, v_can, v_da_coc, (v_can - v_da_coc);
      end if;
      update kho.don_hang set vuot_coc_boi = v_ns, vuot_coc_luc = now(), vuot_coc_ly_do = p_ly_do_vuot_coc where id = v_don.id;
    end if;
  end if;

  -- ── VIỆC 1: file cắt + buoc_thiet_ke ──
  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  -- ── VIỆC 2: vào chuyền ──
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);

  -- ── VIỆC 3: đóng băng SỐ + PHÚT + ĐƠN GIÁ ──
  update kho.so_don_vi_mon s
    set gio_moi_don_vi_chot = (select b.gio_moi_don_vi from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        gio_co_dinh_chot = (select b.gio_co_dinh from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        don_gia_chot = (select d.don_gia from kho.don_gia_baseline d where d.hoat_dong = s.hoat_dong),
        chot_luc = now(), chot_boi = v_ns
    where s.moc = 'chuan' and s.chot_luc is null
      and s.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- WP-08 (db/169) VIỆC 3b: NEO phiên bản quy trình vào món lúc chốt (mốc bàn giao). Helper = MỘT nguồn suy.
  update kho.don_hang_mon m set quy_trinh_phien_ban = (select qm.phien_ban from kho.quy_trinh_cua_mon(m.id) qm)
    where m.don_id = v_don.id and m.quy_trinh_phien_ban is null;
  -- ── VIỆC 4: BOM du_kien→chuan ──
  select id into v_kho from kho.kho where la_mac_dinh limit 1;
  update kho.don_hang_mon_bom b set moc = 'chuan', chot_luc = now()
    where b.moc = 'du_kien' and b.chot_luc is null
      and b.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- ── VIỆC 5: giữ chỗ mềm ──
  with ins as (
    insert into kho.giu_cho(don_hang_id, don_hang_mon_id, don_hang_mon_bom_id, vat_tu_id, kho_id, so_luong_giu, tao_boi)
    select v_don.id, b.mon_id, b.id, b.vat_tu_id, v_kho, b.so_luong_co_so, v_ns
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is not null
    on conflict (don_hang_mon_bom_id) where trang_thai = 'mo' do nothing
    returning 1)
  select count(*) into v_giu_moi from ins;
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', m.id, 'ten', m.ten)), '[]'::jsonb) into v_mon_thieu
    from kho.don_hang_mon m
    where m.don_id = v_don.id and not exists (select 1 from kho.don_hang_mon_bom b where b.mon_id = m.id and b.moc = 'chuan');
  select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id', x.vat_tu_id, 'thieu', round(-x.kd, 4), 'don_vi', (select don_vi_co_so from kho.vat_tu where id=x.vat_tu_id))), '[]'::jsonb) into v_vt_thieu
    from (
      select v.vat_tu_id, coalesce(t.so_luong,0) - coalesce(g.giu,0) kd
      from (select distinct vat_tu_id from kho.giu_cho where don_hang_id = v_don.id and trang_thai='mo') v
      left join kho.ton t on t.vat_tu_id = v.vat_tu_id and t.kho_id = v_kho
      left join (select vat_tu_id, sum(so_luong_giu - so_luong_da_xuat) giu from kho.giu_cho where kho_id = v_kho and trang_thai='mo' group by vat_tu_id) g on g.vat_tu_id = v.vat_tu_id
    ) x where x.kd < 0;
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', b.mon_id, 'vat_tu_id', b.vat_tu_id,
           'ma', v.ma, 'ten', v.ten, 'don_vi', b.don_vi, 'so_luong', b.so_luong)), '[]'::jsonb) into v_bom_cho
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    left join kho.vat_tu v on v.id = b.vat_tu_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is null;

  -- ═══ VIỆC 6 (WP-43): TỰ XẾP LỊCH — inline luu_xep_lich (chạy owner, KHÔNG gác vai), bọc EXCEPTION ═══
  --   [db/157] NEO XUÔI = tuần đầu NGOÀI đóng băng = tuan_cua(now) + dong_bang×7 (đọc động từ moc_lich).
  v_kieu := case when v_don.ngay_hen_khach is not null then 'nguoc' else 'xuoi' end;
  begin
    if v_kieu = 'nguoc' then
      v_xep := kho._sched(p_ma_don,'nguoc', kho.tuan_cua(v_don.ngay_hen_khach));
    else
      v_neo := kho.neo_xuoi();
      v_xep := kho._sched(p_ma_don,'xuoi', v_neo);
    end if;
    if (v_xep->>'ok')::boolean is not true then
      v_da_xep := false; v_ly_do_xep := coalesce(v_xep->>'loi','KHONG_XEP_DUOC');
    else
      for v_i in 0 .. jsonb_array_length(v_xep->'lich')-1 loop
        if kho.vung_cua_tuan((v_xep->'lich'->v_i->>'tuan')::date) = 'dong_bang' then
          raise exception 'ĐÓNG BĂNG: bước rơi vào tuần đóng băng (%) — cần Xếp lại đơn (ngoại lệ CEO)', (v_xep->'lich'->v_i->>'tuan'); end if;
      end loop;
      delete from kho.xep_lich where ma_don = p_ma_don;
      insert into kho.xep_lich(ma_don,mon_id,buoc_thu_tu,hoat_dong,loai_buoc,tuan_bat_dau,ma_to,gio,kieu_xep,xep_boi,ly_do)
      select p_ma_don, (e->>'mon_id')::uuid, (e->>'thu_tu')::int, e->>'hoat_dong', e->>'loai_buoc',
             (e->>'tuan')::date, e->>'ma_to', coalesce((e->>'gio')::numeric,0), v_kieu, v_ns, null
      from jsonb_array_elements(v_xep->'lich') e;
      get diagnostics v_so_dong_xep = row_count;
      v_da_xep := true; v_ly_do_xep := null;
    end if;
  exception when others then
    v_da_xep := false; v_ly_do_xep := SQLERRM;
  end;
  update kho.don_hang set chua_xep_duoc = not v_da_xep,
      ly_do_chua_xep = case when v_da_xep then null else v_ly_do_xep end, thu_xep_luc = now(), khoa_lich_luc = now(), khoa_lich_boi = v_ns
    where id = v_don.id;

  -- ═══ VIỆC 7 (WP-43): ghi SỔ NÚT THẮT tuần này — cũng nuốt lỗi, KHÔNG chặn bàn giao ═══
  begin perform kho.nut_that_ghi(); exception when others then null; end;

  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat',
    'mon_thieu_bom', coalesce(v_mon_thieu,'[]'::jsonb), 'vat_tu_thieu', coalesce(v_vt_thieu,'[]'::jsonb),
    'bom_cho_he_so', coalesce(v_bom_cho,'[]'::jsonb), 'giu_cho_moi', v_giu_moi,
    'da_xep', v_da_xep, 'ly_do_khong_xep', v_ly_do_xep, 'so_dong_xep_lich', v_so_dong_xep);
end $function$;
grant execute on function kho.ban_giao_xuong(text,jsonb,text,text) to authenticated;

-- [WP-75 L-3] dong_tien_ky: bóc KHÁCH ỨNG TRƯỚC (lát cắt khối thu) + số dư ứng trước + p_gom_demo
drop function if exists kho.dong_tien_ky(text);
CREATE OR REPLACE FUNCTION kho.dong_tien_ky(p_ky text, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
declare
  v_from date := to_date(p_ky||'-01','YYYY-MM-DD'); v_to date := (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date;
  v_thu jsonb; v_tong_thu numeric; v_chi jsonb; v_tong_chi numeric;
  v_vc jsonb; v_vc_tong numeric; v_vc_don int; v_hoan jsonb;
  v_no jsonb; v_canhbao jsonb; v_cb_so int; v_von jsonb; v_von_vao numeric; v_von_ra numeric;
  v_quy_luu numeric; v_quy_dau numeric; v_goi_y numeric; v_rong_kd numeric; v_rong_ngoai numeric; v_prev jsonb;
  c_luong numeric; c_ads numeric; c_cpk numeric; c_tra_ncc numeric; v_con_no_ncc numeric;
  v_thu_giao numeric; v_thu_ung numeric; v_ut_dau numeric; v_ut_them numeric; v_ut_ket numeric; v_ut_con numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'dong_tien_ky: chỉ ceo/ke_toan'; end if;

  -- [WP-75 L-3/L-6] KHỐI THU: MỘT pass — group by loai + BÓC (đã-giao/ứng-trước) cùng lúc (gộp, KHÔNG quét phieu_thu⋈don_hang 2 lần).
  --   "đã giao" = don_hang.moc_ban_giao <> 'chua_giao' (trục giao-nhận WP-75/ERP 5.3.3 — doanh thu ghi khi GIAO HÀNG, Garrison ch.14).
  --   Bóc là LÁT CẮT của cùng tập phieu_thu (KHÔNG cộng thêm khối): v_tong_thu = v_thu_giao + v_thu_ung.
  with p as materialized (   -- quét NỀN một lần; byloai + bóc đều đọc từ đây (không quét lại bảng)
    select pt.loai, pt.ngay, pt.so_tien,
           (coalesce(d.moc_ban_giao,'chua_giao') <> 'chua_giao') as da_giao
    from kho.phieu_thu pt left join kho.don_hang d on d.ma_don = pt.ma_don
    where pt.ngay >= v_from and pt.ngay < v_to and (p_gom_demo or coalesce(d.la_demo,false) = false)
  ), byloai as (
    select loai, count(*) sp, coalesce(sum(so_tien),0) st,
           count(distinct ngay) filter(where loai='doi_soat_cod') sd,
           count(*) filter(where loai='doi_soat_cod') so_don
    from p group by loai
  )
  select (select jsonb_object_agg(loai, jsonb_build_object('so_phieu',sp,'so_tien',st,'so_dot',sd,'so_don',so_don)) from byloai),
         (select coalesce(sum(st),0) from byloai),
         coalesce(sum(so_tien) filter(where da_giao),0),
         coalesce(sum(so_tien) filter(where not da_giao),0)
    into v_thu, v_tong_thu, v_thu_giao, v_thu_ung
  from p;
  -- Số dư "khách ứng trước" (nợ phải trả): đầu + nhận thêm − kết chuyển(giao) = còn giữ. Khép vòng theo mốc giao (moc_dat_luc).
  select coalesce(sum(so_tien) filter(where eu and ngay<v_from),0),
         coalesce(sum(so_tien) filter(where eu and ngay>=v_from and ngay<v_to),0),
         coalesce(sum(so_tien) filter(where e_ and ngay<v_to),0),
         coalesce(sum(so_tien) filter(where u_ and ngay<v_to),0)
    into v_ut_dau, v_ut_them, v_ut_ket, v_ut_con
  from (select p.so_tien, p.ngay,
          (coalesce(d.moc_ban_giao,'chua_giao')='chua_giao' or d.moc_dat_luc >= v_from) eu,
          (coalesce(d.moc_ban_giao,'chua_giao')<>'chua_giao' and d.moc_dat_luc>=v_from and d.moc_dat_luc<v_to) e_,
          (coalesce(d.moc_ban_giao,'chua_giao')='chua_giao' or d.moc_dat_luc >= v_to) u_
        from kho.phieu_thu p left join kho.don_hang d on d.ma_don=p.ma_don
        where (p_gom_demo or coalesce(d.la_demo,false)=false)) z;

  -- KHỐI 2 — CHI: chi_phi_ky + chi_ads GỒM VAT + luong_to (lương+BH) + TRẢ NCC (phieu_chi_ncc, WP-22).
  c_cpk   := (select coalesce(sum(so_tien),0) from kho.chi_phi_ky where ma_ky=p_ky);
  c_ads   := (select coalesce(sum(so_tien_nhap),0) from kho.chi_ads where ma_ky=p_ky);
  c_luong := (select coalesce(sum(coalesce(luong_to,0)+coalesce(bao_hiem,0)),0) from kho.luong_to where ma_ky=p_ky);
  c_tra_ncc := (select coalesce(sum(so_tien),0) from kho.phieu_chi_ncc
                where da_xoa_luc is null and coalesce(la_demo,false)=false and ngay_chi>=v_from and ngay_chi<v_to);
  v_tong_chi := c_cpk + c_ads + c_luong + c_tra_ncc;
  v_chi := jsonb_build_object('chi_phi_ky',c_cpk,'chi_ads',c_ads,'luong_to',c_luong,'tra_ncc',c_tra_ncc);
  v_rong_kd := v_tong_thu - v_tong_chi;

  select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,
      'don_vi_vc',don_vi_vc,'so_tien_thu_ho',so_tien_thu_ho,'ngay_xuat',ngay_xuat,'tuoi',tuoi,'qua_14',tuoi>14)
      order by tuoi desc),'[]'::jsonb)
    into v_vc from (
      select g.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.nguon_khach,
             g.don_vi_vc, g.so_tien_thu_ho, g.ngay_xuat, (current_date-g.ngay_xuat) tuoi
      from kho.giao_cod g join kho.don_hang d on d.ma_don=g.ma_don
      where g.trang_thai='dang_giao' order by (current_date-g.ngay_xuat) desc limit 50) y;
  select coalesce(sum(so_tien_thu_ho),0), count(*) into v_vc_tong, v_vc_don from kho.giao_cod where trang_thai='dang_giao';
  select jsonb_build_object('so_don',count(*),'so_tien',coalesce(sum(so_tien_thu_ho),0)) into v_hoan
    from kho.giao_cod where trang_thai='hoan' and ngay_ket_thuc>=v_from and ngay_ket_thuc<v_to;

  with pt as (select ma_don, sum(so_tien) da_thu, count(*) c from kho.phieu_thu group by ma_don),
  cod as (select ma_don from kho.giao_cod where trang_thai='dang_giao'),
  base as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.ngay_giao,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) con_lai,
           coalesce(pt.c,0) so_phieu, (current_date-d.ngay_giao) tuoi,
           (cod.ma_don is null) khong_cod
    from kho.don_hang d left join pt on pt.ma_don=d.ma_don left join cod on cod.ma_don=d.ma_don
    where d.trang_thai='da_giao' and d.ngay_giao is not null and coalesce(d.la_demo,false)=false)
  select jsonb_build_object(
      'tong', coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod),0),
      'so_don', count(*) filter(where con_lai>0 and khong_cod),
      'bac1', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi<=30),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi<=30)),
      'bac2', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60)),
      'bac3', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>60))),
    coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'ngay_giao',ngay_giao)) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to),'[]'::jsonb),
    count(*) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to)
    into v_no, v_canhbao, v_cb_so from base;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'ngay',ngay,'loai',loai,
      'vao', case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end,
      'ra',  case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end,
      'ghi_chu',ghi_chu) order by ngay, id),'[]'::jsonb),
    coalesce(sum(case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end),0),
    coalesce(sum(case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end),0)
    into v_von, v_von_vao, v_von_ra from kho.giao_dich_von where ngay>=v_from and ngay<v_to;
  v_rong_ngoai := v_von_vao - v_von_ra;

  -- công nợ phải trả NCC (as-of cuối kỳ) — dòng phụ cho UI
  v_con_no_ncc := coalesce((
    select sum(h.tong_gom_vat) from kho.hoa_don_ncc h where h.da_xoa_luc is null and coalesce(h.la_demo,false)=false and h.ngay_hd < v_to),0)
    - coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.da_xoa_luc is null and coalesce(pc.la_demo,false)=false and pc.ngay_chi < v_to),0);

  select quy_dau_ky into v_quy_luu from kho.tham_so_tai_chinh where ma_ky=p_ky;
  v_prev := kho.dong_tien_rong(to_char((v_from - interval '1 month'),'YYYY-MM'));
  select coalesce(quy_dau_ky,0) + (v_prev->>'rong_kd')::numeric + (v_prev->>'rong_ngoai')::numeric into v_goi_y
    from kho.tham_so_tai_chinh where ma_ky=to_char((v_from - interval '1 month'),'YYYY-MM');
  v_quy_dau := coalesce(v_quy_luu, v_goi_y);

  return jsonb_build_object(
    'ma_ky',p_ky,
    'thu', jsonb_build_object('theo_loai',coalesce(v_thu,'{}'::jsonb),'tong',v_tong_thu,
      'boc', jsonb_build_object('da_giao',v_thu_giao,'ung_truoc',v_thu_ung)),
    'ung_truoc_du', jsonb_build_object('dau_ky',v_ut_dau,'nhan_them',v_ut_them,'ket_chuyen',v_ut_ket,'con_giu',v_ut_con),
    'chi', jsonb_build_object('theo_so',v_chi,'tong',v_tong_chi),
    'rong_kd', v_rong_kd,
    'o_nha_vc', jsonb_build_object('tong',v_vc_tong,'so_don',v_vc_don,'ds',v_vc,'hoan',v_hoan),
    'khach_no', v_no,
    'con_no_ncc', v_con_no_ncc,
    'canh_bao', jsonb_build_object('so_don',v_cb_so,'ds',v_canhbao),
    'ngoai_kd', jsonb_build_object('vao',v_von_vao,'ra',v_von_ra,'rong',v_rong_ngoai,'ds',v_von),
    'quy', jsonb_build_object('dau_ky',v_quy_dau,'da_luu',(v_quy_luu is not null),'goi_y',v_goi_y,
      'rong_kd',v_rong_kd,'rong_ngoai',v_rong_ngoai,'cuoi_ky',v_quy_dau + v_rong_kd + v_rong_ngoai)
  );
end $function$
;
grant execute on function kho.dong_tien_ky(text,boolean) to authenticated;

commit;
