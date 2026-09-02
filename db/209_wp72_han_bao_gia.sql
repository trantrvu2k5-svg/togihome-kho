-- db/209 · WP-72 L-72b · HẠN TRẢ LỜI BÁO GIÁ + nối lý do thua vào cổng + đếm nhóm hạn. QD-94.
--   1a han_tra_loi date NULL (chỉ có nghĩa với nhóm báo giá; đơn cũ NULL, KHÔNG backfill).
--   1b han_bao_gia_mac_dinh (khoảng hiệu lực, EXCLUDE gist — khuôn QD-93): le=7, du_an=21 [TẠM]. Cột phân biệt = don_hang.dong (kiem_chuyen dùng dong='du_an').
--   1c moc_bao_gia: vào bao_gia mà han_tra_loi NULL → tự đặt = ngay_tao_bao_gia::date + so_ngay. GIỮ NGUYÊN vế RAISE ly_do_thua.
--   1d doi_trang_thai_don +p_ly_do_thua +p_ghi_chu_thua (DROP bản (uuid,text,text) cũ — tránh nhập nhằng PostgREST). Nơi gọi: web/src/sale.js:244 (đã sửa cùng lệnh).
--   1e sale_bao_gia_ds +han_tra_loi/so_ngay_con/nhom; sale_bao_gia_han_dem (đếm 3 nhóm + tiền).
--   ⚠ Cổng backup QD-61 (CẤM BO_QUA_BACKUP). HOÀN TÁC: chạy lại db/149 (doi_trang_thai_don cũ) + db/036 (moc_bao_gia) + db/xxx (sale_bao_gia_ds);
--     drop function sale_bao_gia_han_dem, han_bao_gia_so_ngay; drop table han_bao_gia_mac_dinh; alter table don_hang drop column han_tra_loi.
begin;
create extension if not exists btree_gist;

-- ══════════ 1a · cột hạn trả lời ══════════
alter table kho.don_hang add column if not exists han_tra_loi date;
comment on column kho.don_hang.han_tra_loi is 'WP-72: hạn khách trả lời báo giá (chỉ có nghĩa với bao_gia*). NULL=đơn cũ/không phải báo giá. Quá hạn CHỈ bật đèn, máy không tự đóng (QD-94).';

-- ══════════ 1b · tham số hạn mặc định theo loại đơn, khoảng hiệu lực ══════════
create table if not exists kho.han_bao_gia_mac_dinh (
  id           bigserial primary key,
  loai_don     text not null,                 -- 'le' (dong<>du_an) | 'du_an'
  so_ngay      int  not null check (so_ngay > 0),
  hieu_luc_tu  date not null,
  hieu_luc_den date,
  ly_do        text, nguoi_ghi text, tao_luc timestamptz not null default now(),
  check (hieu_luc_den is null or hieu_luc_den >= hieu_luc_tu)
);
alter table kho.han_bao_gia_mac_dinh drop constraint if exists hbg_khong_chong;
alter table kho.han_bao_gia_mac_dinh add constraint hbg_khong_chong
  exclude using gist (loai_don with =, daterange(hieu_luc_tu, coalesce(hieu_luc_den,'infinity'::date), '[]') with &&);
alter table kho.han_bao_gia_mac_dinh enable row level security;
revoke all on kho.han_bao_gia_mac_dinh from public, anon;
grant select on kho.han_bao_gia_mac_dinh to authenticated;
drop policy if exists hbg_doc on kho.han_bao_gia_mac_dinh;
create policy hbg_doc on kho.han_bao_gia_mac_dinh for select to authenticated
  using (kho.current_vai_tro() in ('ceo','ke_toan','sale','truong_nhom_sale','tk_ban_hang'));
-- Seed 2 dòng [TẠM] (guard: chỉ nạp khi loai chưa có khoảng đang mở). hieu_luc_tu 2026-01-01 để bao đơn hiện có.
insert into kho.han_bao_gia_mac_dinh(loai_don, so_ngay, hieu_luc_tu, ly_do, nguoi_ghi)
select v.l, v.n, date '2026-01-01', 'khởi tạo WP-72 [TẠM] (CEO chốt le=7/du_an=21)', 'he_thong'
from (values ('le',7),('du_an',21)) v(l,n)
where not exists (select 1 from kho.han_bao_gia_mac_dinh h where h.loai_don = v.l and h.hieu_luc_den is null);

create or replace function kho.han_bao_gia_so_ngay(p_loai text, p_ngay date) returns int
  language sql stable security definer set search_path = kho as $$
  select so_ngay from kho.han_bao_gia_mac_dinh
  where loai_don = p_loai and hieu_luc_tu <= p_ngay and (hieu_luc_den is null or p_ngay <= hieu_luc_den)
  order by hieu_luc_tu desc limit 1
$$;

-- ══════════ 1c · moc_bao_gia mở rộng (tự đặt han_tra_loi; GIỮ NGUYÊN vế RAISE ly_do_thua) ══════════
create or replace function kho.moc_bao_gia() returns trigger
  language plpgsql security definer set search_path = kho as $$
begin
  -- CHỐT lý do thua: vào bao_gia_thua phải có ly_do_thua (KHÔNG nới — ràng buộc đang đúng)
  if new.trang_thai = 'bao_gia_thua'
     and (tg_op = 'INSERT' or old.trang_thai is distinct from 'bao_gia_thua')
     and current_setting('chan.off_thua', true) is distinct from '1'
     and coalesce(btrim(new.ly_do_thua), '') = '' then
    raise exception 'Đơn báo giá thua phải có lý do (ly_do_thua): gia_cao/cham/doi_y/chon_noi_khac/khac';
  end if;
  -- Mốc ngày + hạn trả lời (chỉ khi VÀO bao_gia)
  if tg_op = 'INSERT' then
    if new.trang_thai = 'bao_gia' then
      new.ngay_tao_bao_gia := coalesce(new.ngay_tao_bao_gia, now());
      if new.han_tra_loi is null then
        new.han_tra_loi := coalesce(new.ngay_tao_bao_gia, now())::date
          + coalesce(kho.han_bao_gia_so_ngay(case when new.dong = 'du_an' then 'du_an' else 'le' end, now()::date), 7);
      end if;
    end if;
  else
    if new.trang_thai = 'bao_gia' and old.trang_thai is distinct from 'bao_gia' then
      new.ngay_tao_bao_gia := coalesce(new.ngay_tao_bao_gia, now());
      if new.han_tra_loi is null then
        new.han_tra_loi := coalesce(new.ngay_tao_bao_gia, now())::date
          + coalesce(kho.han_bao_gia_so_ngay(case when new.dong = 'du_an' then 'du_an' else 'le' end, now()::date), 7);
      end if;
    end if;
    if old.trang_thai = 'bao_gia' and new.trang_thai is distinct from 'bao_gia' then
      new.ngay_ket_thuc_bao_gia := coalesce(new.ngay_ket_thuc_bao_gia, now());
    end if;
  end if;
  return new;
end $$;
-- trigger trg_moc_bao_gia đã tồn tại (db/036), trỏ cùng hàm — không tạo lại.

-- ══════════ 1d · doi_trang_thai_don bản mới (+p_ly_do_thua +p_ghi_chu_thua). DROP bản cũ (uuid,text,text). ══════════
drop function if exists kho.doi_trang_thai_don(uuid, text, text);
create function kho.doi_trang_thai_don(
    p_don_id uuid, p_trang_thai_moi text, p_ly_do text default null,
    p_ly_do_thua text default null, p_ghi_chu_thua text default null)
  returns jsonb language plpgsql security definer set search_path = 'kho','public' as $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
  v_cho text[] := array['bao_gia','bao_gia_thua','bao_gia_treo','tam_ngung','huy'];
  v_sx  text[] := array['cho_cat','da_cat','dang_lam','xong_sx','cho_giao'];
begin
  -- ═══ [QD-65] NHÁNH da_giao ═══
  if p_trang_thai_moi = 'da_giao' then
    if v_vai not in ('sale','ke_toan','ceo') then
      raise exception 'doi_trang_thai_don(da_giao): chỉ sale/ke_toan/ceo (vai "%")', v_vai; end if;
    select * into v_don from kho.don_hang where id = p_don_id;
    if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
    if v_don.trang_thai = 'da_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" ĐÃ giao rồi', v_don.ma_don; end if;
    if v_don.trang_thai <> 'cho_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" đang "%" — chưa ở bước CHỜ GIAO, không đánh dấu "Đã giao" được (da_giao là mốc chốt doanh thu, cấm nhảy tắt)', v_don.ma_don, v_don.trang_thai; end if;
    update kho.don_hang set trang_thai = 'da_giao',
        moc_ban_giao = case when moc_ban_giao = 'chua_giao' then 'da_giao_chua_lap' else moc_ban_giao end,
        moc_dat_luc  = case when moc_ban_giao = 'chua_giao' then now() else moc_dat_luc end,
        moc_nguoi    = case when moc_ban_giao = 'chua_giao' then kho.current_ns() else moc_nguoi end
      where id = p_don_id;
    return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'da_giao');
  end if;

  -- ═══ các đích còn lại ═══
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
  -- [WP-72] ĐÁNH DẤU THUA: bắt lý do thua ngay ở cổng (câu tiếng Việt), không để rơi xuống trigger. treo KHÔNG bắt.
  if p_trang_thai_moi = 'bao_gia_thua' then
    if coalesce(nullif(btrim(p_ly_do_thua),''),'') = '' then
      raise exception 'Đánh dấu THUA phải chọn lý do (gia_cao / cham / doi_y / chon_noi_khac / khac)'; end if;
    if p_ly_do_thua not in ('gia_cao','cham','doi_y','chon_noi_khac','khac') then
      raise exception 'Lý do thua "%" không hợp lệ — chỉ: gia_cao / cham / doi_y / chon_noi_khac / khac', p_ly_do_thua; end if;
  end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = p_trang_thai_moi then
    raise exception 'doi_trang_thai_don: đơn "%" ĐÃ ở "%"', v_don.ma_don, p_trang_thai_moi; end if;
  if coalesce(nullif(btrim(p_ly_do),''),'') <> '' then
    perform set_config('moc.ly_do_lui', p_ly_do, true); end if;
  update kho.don_hang
     set trang_thai = p_trang_thai_moi,
         ly_do_huy    = case when p_trang_thai_moi in ('huy','tam_ngung') then p_ly_do else ly_do_huy end,
         ly_do_thua   = case when p_trang_thai_moi = 'bao_gia_thua' then p_ly_do_thua else ly_do_thua end,
         ghi_chu_thua = case when p_trang_thai_moi = 'bao_gia_thua' then nullif(btrim(coalesce(p_ghi_chu_thua,'')),'') else ghi_chu_thua end
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', p_trang_thai_moi);
end $function$;
revoke all on function kho.doi_trang_thai_don(uuid,text,text,text,text) from anon;
grant execute on function kho.doi_trang_thai_don(uuid,text,text,text,text) to authenticated;

-- ══════════ 1e · sale_bao_gia_ds (+han_tra_loi/so_ngay_con/nhom) + sale_bao_gia_han_dem ══════════
create or replace function kho.sale_bao_gia_ds(p_gioi_han integer default 1000)
  returns jsonb language plpgsql stable security definer set search_path = kho as $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); v_ds jsonb; v_tong int;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'sale_bao_gia_ds: chỉ sale/truong_nhom_sale/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  with ban_moi as (
    select distinct on (ma_don) ma_don, id ban_id, trang_thai bt_tt, phien_ban, luc_gui
    from kho.ban_thiet_ke order by ma_don, phien_ban desc
  ), lk as (
    select bm.ma_don, exists(select 1 from kho.link_ban_khach l where l.ban_id = bm.ban_id) co_link,
           (select max(l.tao_luc) from kho.link_ban_khach l where l.ban_id = bm.ban_id) gui_luc
    from ban_moi bm
  ), bg as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
      d.trang_thai, d.buoc_thiet_ke, d.ma_ns_thiet_ke, d.loai, d.thuong_hieu,
      d.ngay_hen_khach, d.ly_do_thua, d.cap_thiet_ke, nullif(btrim(d.ghi_chu),'') ghi_chu,
      d.han_tra_loi,                                                     -- [WP-72]
      coalesce(d.doanh_thu, d.gia_goc) tien,
      d.sale_phu_trach, (select ho_ten from kho.nguoi_dung n where n.id = d.sale_phu_trach) sale_ten,
      (d.ngay_hen_khach is null) chua_co_ngay,
      bm.ban_id, coalesce(bm.phien_ban,0) pb, bm.bt_tt, lk.co_link,
      (current_date - coalesce(d.ngay_tao_bao_gia::date, bm.luc_gui::date, current_date)) mo_ngay,
      (current_date - coalesce(lk.gui_luc::date, bm.luc_gui::date, current_date)) cho_khach,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id) so_mon,
      (select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1) mon_ten,
      (select ho_ten from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke) ai_dung,
      (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don
         and b.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong_sua
    from kho.don_hang d
      left join ban_moi bm on bm.ma_don = d.ma_don
      left join lk on lk.ma_don = d.ma_don
    where d.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo')
      and (v_vai <> 'sale' or d.sale_phu_trach = v_ns)
  ), gd as (
    select *, case
      when trang_thai='bao_gia_thua'                       then 'thua'
      when trang_thai='bao_gia_treo'                       then 'treo'
      when bt_tt='khach_duyet'                             then 'du_len_don'
      when buoc_thiet_ke='sua_gop_y'                       then 'sua_gop_y'
      when bt_tt='cho_duyet' and co_link                   then 'da_gui'
      when bt_tt='cho_duyet' and not coalesce(co_link,false) then 'ban_moi'
      when ma_ns_thiet_ke is null                          then 'chua_nhan'
      else 'dang_dung'
    end gd,
    case when trang_thai='bao_gia' and han_tra_loi is not null then (han_tra_loi - current_date) end so_ngay_con,  -- [WP-72]
    case when trang_thai <> 'bao_gia' then null
         when han_tra_loi is null then 'con_han'
         when han_tra_loi < current_date then 'qua_han'
         when han_tra_loi - current_date <= 3 then 'sap_het_han'
         else 'con_han' end nhom
    from bg
  )
  select count(*)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'ten_khach',ten_khach,'gd',gd,'mo_ngay',mo_ngay,'so_mon',so_mon,'mon_ten',mon_ten,
      'pb',pb,'ai_dung',ai_dung,'vong_sua',vong_sua,'ngay_hen',ngay_hen_khach,'tien',tien,
      'cho_khach',cho_khach,'ban_id',ban_id,'loai',loai,'thuong_hieu',thuong_hieu,'ly_thua',ly_do_thua,
      'han_tra_loi',han_tra_loi,'so_ngay_con',so_ngay_con,'nhom',nhom,                                  -- [WP-72]
      'cap',cap_thiet_ke,'ghi_chu',ghi_chu,'chua_co_ngay',chua_co_ngay,'sale_phu_trach',sale_phu_trach,'sale_ten',sale_ten)
      order by mo_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds
  from (select *, row_number() over (order by mo_ngay desc, ma_don) rn from gd) x;
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'cat', (v_tong > p_gioi_han));
end $function$;

-- Đếm cho khối đầu màn: chỉ đơn ĐANG bao_gia, LOẠI demo (0 đơn thật → trống). 3 nhóm + tiền.
create or replace function kho.sale_bao_gia_han_dem()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); r jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'sale_bao_gia_han_dem: chỉ sale/truong_nhom_sale/ceo/ke_toan (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select jsonb_build_object(
    'qua_han',     jsonb_build_object('so', count(*) filter (where han_tra_loi is not null and han_tra_loi < current_date),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is not null and han_tra_loi < current_date),0)),
    'sap_het_han', jsonb_build_object('so', count(*) filter (where han_tra_loi is not null and han_tra_loi >= current_date and han_tra_loi - current_date <= 3),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is not null and han_tra_loi >= current_date and han_tra_loi - current_date <= 3),0)),
    'con_han',     jsonb_build_object('so', count(*) filter (where han_tra_loi is null or han_tra_loi - current_date > 3),
                                      'tien', coalesce(sum(tien) filter (where han_tra_loi is null or han_tra_loi - current_date > 3),0)),
    'tong_don', count(*)
  ) into r
  from (select d.han_tra_loi, coalesce(d.doanh_thu, d.gia_goc, 0) tien
        from kho.don_hang d
        where d.trang_thai = 'bao_gia' and not coalesce(d.la_demo,false)
          and (v_vai <> 'sale' or d.sale_phu_trach = v_ns)) x;
  return r;
end $$;
revoke all on function kho.sale_bao_gia_han_dem() from anon;
grant execute on function kho.sale_bao_gia_han_dem() to authenticated;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='han_tra_loi') then raise exception 'THIẾU han_tra_loi'; end if;
  if to_regprocedure('kho.doi_trang_thai_don(uuid,text,text,text,text)') is null then raise exception 'THIẾU doi_trang_thai_don bản mới'; end if;
  if to_regprocedure('kho.doi_trang_thai_don(uuid,text,text)') is not null then raise exception 'CÒN bản cũ doi_trang_thai_don(uuid,text,text) — phải drop'; end if;
  raise notice 'db/209 OK: han_tra_loi + han_bao_gia_mac_dinh(le=7/du_an=21) + moc_bao_gia mở rộng + doi_trang_thai_don(+2 tham số) + sale_bao_gia_ds/han_dem.';
end $$;
commit;
