-- 055 — VÁ app thiết kế + CHIA VIỆC thủ công.
--   ① nhan_viec_thiet_ke: BỎ ceo (ceo XEM/GIAO, không LÀM). ② tk_chi_tiet_don (panel kanban).
--   ④ che_do_chia_viec (tu_nhan/giao_viec/hon_hop) · vai truong_nhom_thiet_ke · giao_viec/chuyen_viec + nhật ký.
--   Thêm truong_nhom_thiet_ke vào guard + "xem cả đội" của các hàm đọc/thành tích (055 re-create).
--   Hai vai: thiet_ke = THIẾT KẾ SẢN XUẤT · tk_ban_hang = THIẾT KẾ BÁN HÀNG.
--   node ops/run_sql.mjs ../db/055_chia_viec_thiet_ke.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.giao_viec_thiet_ke(text,uuid,text); drop function if exists kho.chuyen_viec(text,uuid,text);
--   drop function if exists kho.tk_chi_tiet_don(text); drop function if exists kho.tk_che_do(); drop function if exists kho.tk_xem_het();
--   drop table if exists kho.nhat_ky_giao_viec;
--   alter table kho.tham_so_tai_chinh drop column if exists che_do_chia_viec;
--   -- vai_tro: khôi phục CHECK không có truong_nhom_thiet_ke (xem git). tt_*/tk_*/nhan_viec: khôi phục bản db/053+054.
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ ④a THAM SỐ + VAI ════════
alter table kho.tham_so_tai_chinh add column if not exists che_do_chia_viec text not null default 'tu_nhan'
  check (che_do_chia_viec in ('tu_nhan','giao_viec','hon_hop'));

alter table kho.nguoi_dung drop constraint if exists nguoi_dung_vai_tro_check;
alter table kho.nguoi_dung add constraint nguoi_dung_vai_tro_check check (vai_tro = any (array[
  'ceo','kho','tho','sale','thiet_ke','xuong','ke_toan','truong_nhom_sale','tk_ban_hang','truong_nhom_thiet_ke']));

-- xem CẢ ĐỘI: ceo + trưởng nhóm thiết kế. (thiet_ke/tk_ban_hang chỉ thấy số MÌNH.)
create or replace function kho.tk_xem_het() returns boolean language sql stable security definer set search_path = kho as $$
  select coalesce(kho.current_vai_tro(),'') in ('ceo','truong_nhom_thiet_ke') $$;

-- chế độ chia việc hiện hành (đọc kỳ mới nhất; mặc định tu_nhan)
create or replace function kho.tk_che_do() returns text language sql stable security definer set search_path = kho as $$
  select coalesce((select che_do_chia_viec from kho.tham_so_tai_chinh order by ma_ky desc limit 1), 'tu_nhan') $$;
grant execute on function kho.tk_che_do() to authenticated;

-- ════════ ④b NHẬT KÝ GIAO/CHUYỂN ════════
create table if not exists kho.nhat_ky_giao_viec (
  id uuid primary key default gen_random_uuid(),
  ma_don text not null,
  ma_ns_tu uuid references kho.nguoi_dung(id),
  ma_ns_den uuid not null references kho.nguoi_dung(id),
  ma_ns_thao_tac uuid not null references kho.nguoi_dung(id),
  hanh_dong text not null check (hanh_dong in ('giao','chuyen')),
  ly_do text,
  vuot_tran boolean not null default false,
  luc timestamptz not null default now()
);
alter table kho.nhat_ky_giao_viec enable row level security;
drop policy if exists nkgv_doc on kho.nhat_ky_giao_viec;
create policy nkgv_doc on kho.nhat_ky_giao_viec for select using (
  kho.current_vai_tro() = any (array['ceo','truong_nhom_thiet_ke','thiet_ke','tk_ban_hang']));

-- ════════ ① NHẬN VIỆC — BỎ ceo; theo chế độ ════════
create or replace function kho.nhan_viec_thiet_ke(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_don kho.don_hang; v_dang int; v_ten text; v_che text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('thiet_ke','tk_ban_hang') then
    raise exception 'CEO không nhận việc thiết kế, chỉ xem và giao việc'; end if;   -- ceo/trưởng nhóm/khác → chặn
  v_che := kho.tk_che_do();
  if v_che = 'giao_viec' then
    raise exception 'Kỳ này chế độ GIAO VIỆC — không tự nhận, chờ trưởng nhóm giao'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'nhan_viec_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if v_don.ma_ns_thiet_ke is not null then
    select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
    raise exception 'nhan_viec_thiet_ke: đơn "%" đang do % cầm', p_ma_don, coalesce(v_ten,'người khác'); end if;
  v_ns := kho.current_ns();
  select count(*) into v_dang from kho.don_hang
    where ma_ns_thiet_ke = v_ns and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  if v_dang >= 5 then
    raise exception 'nhan_viec_thiet_ke: bạn đang cầm % đơn (tối đa 5) — xong bớt rồi nhận thêm', v_dang; end if;
  update kho.don_hang
     set ma_ns_thiet_ke = v_ns, luc_nhan_thiet_ke = now(), buoc_thiet_ke = 'dang_dung',
         trang_thai = case when trang_thai = 'moi_len_don' then 'nhan_thiet_ke' else trang_thai end
   where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'buoc', 'dang_dung');
end $$;
grant execute on function kho.nhan_viec_thiet_ke(text) to authenticated;

-- ════════ ④c GIAO VIỆC (trưởng nhóm/ceo) — giao đơn CHƯA ai cầm ════════
create or replace function kho.giao_viec_thiet_ke(p_ma_don text, p_ma_ns_nhan uuid, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_don kho.don_hang; v_vai_nhan text; v_dang int; v_vuot boolean := false; v_ten text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','truong_nhom_thiet_ke') then
    raise exception 'giao_viec_thiet_ke: chỉ ceo / trưởng nhóm thiết kế'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'giao_viec_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if v_don.ma_ns_thiet_ke is not null then
    select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
    raise exception 'giao_viec_thiet_ke: đơn "%" đang do % cầm — dùng CHUYỂN VIỆC', p_ma_don, coalesce(v_ten,'người khác'); end if;
  select vai_tro into v_vai_nhan from kho.nguoi_dung where id = p_ma_ns_nhan;
  if v_vai_nhan not in ('thiet_ke','tk_ban_hang') then
    raise exception 'giao_viec_thiet_ke: chỉ giao cho thiết kế sản xuất / bán hàng (không giao cho %)', coalesce(v_vai_nhan,'?'); end if;
  select count(*) into v_dang from kho.don_hang where ma_ns_thiet_ke = p_ma_ns_nhan and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  v_vuot := v_dang >= 5;   -- vượt trần: CẢNH BÁO nhưng cho qua (trưởng nhóm quyết)
  -- KHÔNG đổi trang_thai đơn (máy trạng thái + trigger vai chặn trưởng nhóm); buoc_thiet_ke là bộ đếm thiết kế.
  update kho.don_hang
     set ma_ns_thiet_ke = p_ma_ns_nhan, luc_nhan_thiet_ke = now(), buoc_thiet_ke = 'dang_dung'
   where ma_don = p_ma_don;
  insert into kho.nhat_ky_giao_viec(ma_don, ma_ns_tu, ma_ns_den, ma_ns_thao_tac, hanh_dong, ly_do, vuot_tran)
    values (p_ma_don, null, p_ma_ns_nhan, kho.current_ns(), 'giao', p_ly_do, v_vuot);
  return jsonb_build_object('ok', true, 'vuot_tran', v_vuot,
    'canh_bao', case when v_vuot then 'Người này đang cầm '||v_dang||' đơn (vượt trần 5) — đã ghi vết giao vượt trần' else null end);
end $$;
grant execute on function kho.giao_viec_thiet_ke(text,uuid,text) to authenticated;

-- ════════ ④d CHUYỂN VIỆC (trưởng nhóm/ceo) — ĐỔI người cầm; LÝ DO bắt buộc ════════
create or replace function kho.chuyen_viec(p_ma_don text, p_ma_ns_moi uuid, p_ly_do text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_don kho.don_hang; v_vai_moi text; v_dang int; v_vuot boolean := false;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','truong_nhom_thiet_ke') then
    raise exception 'chuyen_viec: chỉ ceo / trưởng nhóm thiết kế'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'chuyen_viec: BẮT BUỘC ghi lý do chuyển'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'chuyen_viec: không có đơn "%"', p_ma_don; end if;
  if v_don.ma_ns_thiet_ke is null then raise exception 'chuyen_viec: đơn "%" chưa ai cầm — dùng GIAO VIỆC', p_ma_don; end if;
  select vai_tro into v_vai_moi from kho.nguoi_dung where id = p_ma_ns_moi;
  if v_vai_moi not in ('thiet_ke','tk_ban_hang') then
    raise exception 'chuyen_viec: chỉ chuyển cho thiết kế sản xuất / bán hàng'; end if;
  if p_ma_ns_moi = v_don.ma_ns_thiet_ke then raise exception 'chuyen_viec: người mới trùng người đang cầm'; end if;
  select count(*) into v_dang from kho.don_hang where ma_ns_thiet_ke = p_ma_ns_moi and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  v_vuot := v_dang >= 5;
  insert into kho.nhat_ky_giao_viec(ma_don, ma_ns_tu, ma_ns_den, ma_ns_thao_tac, hanh_dong, ly_do, vuot_tran)
    values (p_ma_don, v_don.ma_ns_thiet_ke, p_ma_ns_moi, kho.current_ns(), 'chuyen', p_ly_do, v_vuot);
  update kho.don_hang set ma_ns_thiet_ke = p_ma_ns_moi, luc_nhan_thiet_ke = now() where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'vuot_tran', v_vuot);
end $$;
grant execute on function kho.chuyen_viec(text,uuid,text) to authenticated;

-- ════════ ④e Người NHẬN được (thiet_ke + tk_ban_hang) — cho picker "Giao cho…" ════════
create or replace function kho.tk_nguoi_nhan()
  returns table(id uuid, ho_ten text, vai_tro text, dang_cam integer)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','truong_nhom_thiet_ke') then
    raise exception 'tk_nguoi_nhan: chỉ ceo / trưởng nhóm thiết kế'; end if;
  return query
  select n.id, n.ho_ten, n.vai_tro,
    (select count(*)::int from kho.don_hang d where d.ma_ns_thiet_ke = n.id and coalesce(d.buoc_thiet_ke,'') <> 'xong_file')
  from kho.nguoi_dung n where n.vai_tro in ('thiet_ke','tk_ban_hang') and n.dang_hoat_dong
  order by n.ho_ten;
end $$;
grant execute on function kho.tk_nguoi_nhan() to authenticated;

-- ════════ ② CHI TIẾT ĐƠN (panel kanban) — KHÔNG giá/khách/sđt ════════
create or replace function kho.tk_chi_tiet_don(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don kho.don_hang; v_mon jsonb; v_lich jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_chi_tiet_don: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'tk_chi_tiet_don: không có đơn "%"', p_ma_don; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'ten', m.ten, 'kt', m.kt, 'vl', m.vl, 'mau', (select s.ten from kho.mau_sac s where s.ma = m.ma_mau),
      'chi_tiet', m.chi_tiet, 'so_luong', m.so_luong, 'dung_moi', m.dung_moi) order by m.id), '[]'::jsonb)
    into v_mon from kho.don_hang_mon m where m.don_id = v_don.id;
  -- lịch sử: nhận · gửi bản · sale phản hồi · đẩy tem — ghép theo thời gian
  select coalesce(jsonb_agg(e order by (e->>'luc')), '[]'::jsonb) into v_lich from (
    select jsonb_build_object('luc', x.luc, 'viec', x.viec) e from (
      select v_don.luc_nhan_thiet_ke luc, 'Nhận việc'::text viec where v_don.luc_nhan_thiet_ke is not null
      union all
      select b.luc_gui, 'Gửi bản 3D cho sale · phiên ' || b.phien_ban from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_gui is not null
      union all
      select b.luc_phan_hoi, 'Sale: ' || case b.trang_thai when 'khach_duyet' then 'Khách duyệt' when 'khach_doi_y' then 'Khách đổi ý'
             when 'chua_dung_yeu_cau' then 'Trả về — chưa đúng yêu cầu' else b.trang_thai end
        from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_phan_hoi is not null
      union all
      select min(t.ghi_luc), 'Đẩy tem file cắt · phiên ' || t.phien_ban from kho.tem_ban_ve t where t.ma_don = p_ma_don group by t.phien_ban
    ) x where x.luc is not null
  ) y;
  return jsonb_build_object(
    'ma_don', v_don.ma_don,
    'ten', coalesce((select m.ten from kho.don_hang_mon m where m.don_id = v_don.id order by m.id limit 1), 'Đơn ' || v_don.ma_don),
    'loai', v_don.loai, 'cap_thiet_ke', v_don.cap_thiet_ke, 'buoc_thiet_ke', coalesce(v_don.buoc_thiet_ke,'cho_nhan'),
    'trang_thai', v_don.trang_thai, 'ghi_chu', v_don.ghi_chu,
    'gio_uoc', kho.gio_uoc_cap(v_don.cap_thiet_ke),
    'gio_thuc', coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = p_ma_don), 0),
    'vong_sua', (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    'ai_cam', (select n.ho_ten from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'vai_cam', (select n.vai_tro from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'ngay_hen_khach', v_don.ngay_hen_khach,
    'mon', v_mon, 'lich_su', v_lich);
end $$;
grant execute on function kho.tk_chi_tiet_don(text) to authenticated;

-- ════════ RE-CREATE hàm đọc/thành tích — thêm truong_nhom_thiet_ke (guard + xem cả đội) ════════
create or replace function kho.tk_viec_cua_toi()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer,
                gio_uoc numeric, gio_da_ghi numeric, buoc_thiet_ke text, trang_thai text,
                vong_sua integer, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_viec_cua_toi: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  v_me := kho.current_ns();
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke),
    coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = d.ma_don), 0),
    d.buoc_thiet_ke, d.trang_thai,
    (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    d.ngay_hen_khach, coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.ma_ns_thiet_ke = v_me and coalesce(d.buoc_thiet_ke,'') <> 'xong_file'
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last;
end $$;
grant execute on function kho.tk_viec_cua_toi() to authenticated;

create or replace function kho.tk_don_cho_nhan()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric,
                trang_thai text, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_don_cho_nhan: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke), d.trang_thai, d.ngay_hen_khach,
    coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.ma_ns_thiet_ke is null
    and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke')
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last, d.tao_luc asc nulls last;
end $$;
grant execute on function kho.tk_don_cho_nhan() to authenticated;

create or replace function kho.tk_bang_cong_viec()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, cot text,
                gio_uoc numeric, gio_thuc numeric, ai_cam text, vai_cam text,
                vong_sua integer, ngay_hen_khach date, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_bang_cong_viec: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    case when d.buoc_thiet_ke is not null then d.buoc_thiet_ke else 'cho_nhan' end,
    kho.gio_uoc_cap(d.cap_thiet_ke),
    coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = d.ma_don), 0),
    (select n.ho_ten from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke),
    (select n.vai_tro from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke),
    (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    d.ngay_hen_khach, coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.buoc_thiet_ke is not null
     or (d.ma_ns_thiet_ke is null and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke'))
  order by d.ngay_hen_khach asc nulls last;
end $$;
grant execute on function kho.tk_bang_cong_viec() to authenticated;

create or replace function kho.tk_gio_chi_phi(p_ma_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean; v_tong numeric; v_thang numeric; v_thua numeric; v_sua numeric; v_mau_cho numeric; v_uoc_thuc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_gio_chi_phi: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  with g as (
    select g.gio_thuc,
      case
        when d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then 'thang'
        when d.trang_thai = 'bao_gia_thua' then 'thua'
        when exists (select 1 from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')) then 'sua'
        else 'mau_cho' end xo
    from kho.gio_thiet_ke_thuc g join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and (v_het or g.ma_ns = v_me)
  )
  select coalesce(sum(gio_thuc),0), coalesce(sum(gio_thuc) filter (where xo='thang'),0),
         coalesce(sum(gio_thuc) filter (where xo='thua'),0), coalesce(sum(gio_thuc) filter (where xo='sua'),0),
         coalesce(sum(gio_thuc) filter (where xo='mau_cho'),0)
    into v_tong, v_thang, v_thua, v_sua, v_mau_cho from g;
  select coalesce(jsonb_agg(x order by x->>'cap'), '[]'::jsonb) into v_uoc_thuc from (
    select jsonb_build_object('cap', t.cap_thiet_ke, 'gio_uoc', kho.gio_uoc_cap(t.cap_thiet_ke),
      'gio_thuc_tb', round(avg(t.thuc) filter (where t.thuc is not null), 2), 'so_don', count(*)::int, 'du_tin', count(*) >= 5) x
    from (
      select d.cap_thiet_ke,
        (select sum(gg.gio_thuc) from kho.gio_thiet_ke_thuc gg where gg.ma_don = d.ma_don and (v_het or gg.ma_ns = v_me)) thuc
      from kho.don_hang d
      where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
        and d.buoc_thiet_ke = 'xong_file' and (v_het or d.ma_ns_thiet_ke = v_me)
    ) t group by t.cap_thiet_ke
  ) y;
  return jsonb_build_object(
    'o_so', jsonb_build_object('gio_thang', v_tong,
      'ty_le_ve_don', case when v_tong > 0 then round(100.0 * v_thang / v_tong, 0) else null end,
      'gio_bao_gia_thua', v_thua, 'gio_sua_gop_y', v_sua),
    'gio_di_dau', jsonb_build_object('thang', v_thang, 'thua', v_thua, 'sua', v_sua, 'mau_cho', v_mau_cho),
    'uoc_thuc', v_uoc_thuc);
end $$;
grant execute on function kho.tk_gio_chi_phi(text) to authenticated;

create or replace function kho.tt_thiet_ke_xuong(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, viec_xong_chuan_hoa numeric, file_dung_lan_dau_pct numeric,
                loi_do_file_bat integer, uoc_lech_gio_tb numeric, so_don_can_cu integer, du_tin boolean, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','truong_nhom_thiet_ke') then
    raise exception 'tt_thiet_ke_xuong: chỉ ceo / thiết kế sản xuất / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  return query
  with base as (
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, n.id ns, n.ho_ten
    from kho.don_hang d join kho.nguoi_dung n on n.id = d.ma_ns_thiet_ke and n.vai_tro = 'thiet_ke'
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and (v_het or d.ma_ns_thiet_ke = v_me)
  )
  select b.ns, b.ho_ten,
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where mx = 1) / count(*), 1) end
       from (select t.ma_don, max(t.phien_ban) mx from kho.tem_ban_ve t
             where t.ma_don in (select ma_don from base bb where bb.ns = b.ns) group by t.ma_don) s),
    (select count(*)::int from kho.loi_lam_lai l
       where l.do_file and l.ma_ns_thiet_ke = b.ns and l.ma_don in (select ma_don from base b2 where b2.ns = b.ns)),
    (select round(avg(gt.gio - kho.gio_uoc_cap(bb.cap_thiet_ke)), 2)
       from base bb join lateral (select sum(g.gio_thuc) gio from kho.gio_thiet_ke_thuc g
                     where g.ma_don = bb.ma_don and g.loai_gio = 'xuong') gt on true
       where bb.ns = b.ns and gt.gio is not null),
    count(*) filter (where b.buoc_thiet_ke = 'xong_file')::int,
    count(*) filter (where b.buoc_thiet_ke = 'xong_file') >= 5,
    case when count(*) filter (where b.buoc_thiet_ke = 'xong_file') < 5
         then 'Chưa đủ đơn để tin (' || count(*) filter (where b.buoc_thiet_ke = 'xong_file') || '/5)' else null end
  from base b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_xuong(text) to authenticated;

create or replace function kho.tt_thiet_ke_ban_hang(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, ra_phuong_an_dau_gio numeric, sale_tra_ve_hieu_sai integer,
                viec_xong_chuan_hoa numeric, ty_le_khach_chot numeric, so_don_can_cu integer,
                du_tin boolean, canh_bao text, xep_hang_ty_le text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tt_thiet_ke_ban_hang: chỉ ceo / thiết kế bán hàng / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  return query
  with base as (
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, d.luc_nhan_thiet_ke, n.id ns, n.ho_ten
    from kho.don_hang d join kho.nguoi_dung n on n.id = d.ma_ns_thiet_ke and n.vai_tro = 'tk_ban_hang'
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and (v_het or d.ma_ns_thiet_ke = v_me)
  )
  select b.ns, b.ho_ten,
    (select round(avg(extract(epoch from (fg.luc - bb.luc_nhan_thiet_ke)) / 3600.0), 2)
       from base bb join lateral (select min(x.luc_gui) luc from kho.ban_thiet_ke x where x.ma_don = bb.ma_don) fg on true
       where bb.ns = b.ns and bb.luc_nhan_thiet_ke is not null and fg.luc is not null),
    (select count(*)::int from kho.ban_thiet_ke bt
       where bt.trang_thai = 'chua_dung_yeu_cau' and bt.ma_don in (select ma_don from base b2 where b2.ns = b.ns)),
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    (select round(100.0 * count(distinct case when exists(select 1 from kho.ban_thiet_ke bt2
             where bt2.ma_don = bb.ma_don and bt2.trang_thai = 'khach_duyet') then bb.ma_don end)
          / nullif(count(distinct bb.ma_don),0), 1) from base bb where bb.ns = b.ns),
    count(distinct b.ma_don)::int, count(distinct b.ma_don) >= 5,
    case when count(distinct b.ma_don) < 5 then 'Chưa đủ đơn để tin (' || count(distinct b.ma_don) || '/5)' else null end,
    'KHONG_XEP_HANG'
  from base b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_ban_hang(text) to authenticated;

create or replace function kho.nguyen_nhan_sua(p_ma_ky text)
  returns table(trang_thai text, so_lan integer) language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'nguyen_nhan_sua: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  return query
  select bt.trang_thai, count(*)::int
  from kho.ban_thiet_ke bt join kho.don_hang d on d.ma_don = bt.ma_don
  where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and (v_het or d.ma_ns_thiet_ke = v_me)
  group by bt.trang_thai order by count(*) desc;
end $$;
grant execute on function kho.nguyen_nhan_sua(text) to authenticated;

commit;
