-- db/101 — L-71: CHỦ ĐƠN (mỗi đơn thuộc MỘT sale). Vá nợ L-45. Idempotent.
--   Cột sale_phu_trach → nguoi_dung; TỰ GÁN = người tạo lúc INSERT (trigger BEFORE INSERT, ít xâm lấn — app không đổi).
--   Backfill đơn cũ từ nhật ký (nguoi_id dòng đầu). Đổi chủ: doi_sale_phu_trach (chỉ truong_nhom_sale/ceo, ghi nhật ký).
--   SIẾT: sale_ban_cho_gui + sale_bao_gia_ds lọc theo chủ (sale thường chỉ ĐƠN MÌNH; trưởng nhóm/ceo cả nhóm). Body sao NGUYÊN, thêm 1 vế lọc.
-- ═════ HOÀN TÁC: alter drop column sale_phu_trach; chạy lại db/087+db/091; drop doi_sale_phu_trach. ═════
begin;

-- ── (1) cột + tự gán ──
alter table kho.don_hang add column if not exists sale_phu_trach uuid references kho.nguoi_dung(id);
comment on column kho.don_hang.sale_phu_trach is 'CHỦ đơn / sale phụ trách (L-71). Tự gán = người tạo lúc INSERT; đổi qua doi_sale_phu_trach (trưởng nhóm/ceo). Đơn demo/seed = NULL (không JWT).';
create index if not exists idx_dh_sale_phu_trach on kho.don_hang(sale_phu_trach);

create or replace function kho.tg_gan_sale_phu_trach() returns trigger language plpgsql security definer set search_path = kho as $fn$
begin
  if new.sale_phu_trach is null then new.sale_phu_trach := kho.current_ns(); end if;  -- người đang đăng nhập (NULL nếu không JWT: seed/demo)
  return new;
end $fn$;
drop trigger if exists trg_gan_sale_phu_trach on kho.don_hang;
create trigger trg_gan_sale_phu_trach before insert on kho.don_hang for each row execute function kho.tg_gan_sale_phu_trach();

-- ── (2) backfill đơn cũ từ nhật ký (nguoi_id dòng ĐẦU) — CHỈ đụng cột sale_phu_trach ──
update kho.don_hang d set sale_phu_trach = nk.nguoi_id
from (select distinct on (don_id) don_id, nguoi_id from kho.don_hang_nhat_ky
      where nguoi_id is not null order by don_id, luc asc, id asc) nk
where nk.don_id = d.id and d.sale_phu_trach is null;

do $$ declare v_null int; begin
  select count(*) into v_null from kho.don_hang where sale_phu_trach is null;
  raise notice 'db/101 backfill xong. Đơn còn NULL chủ: % (không truy được nhật ký — phần lớn demo/seed).', v_null;
end $$;

-- ── (3) đổi chủ đơn (chỉ truong_nhom_sale/ceo) ──
create or replace function kho.doi_sale_phu_trach(p_ma_don text, p_ns_moi uuid, p_ly_do text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang%rowtype; v_ten_cu text; v_ten_moi text;
begin
  if v_vai not in ('truong_nhom_sale','ceo') then
    raise exception 'doi_sale_phu_trach: chỉ truong_nhom_sale/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'doi_sale_phu_trach: không có đơn "%"', p_ma_don; end if;
  if p_ns_moi is null or not exists (select 1 from kho.nguoi_dung where id = p_ns_moi) then
    raise exception 'doi_sale_phu_trach: người phụ trách mới không hợp lệ'; end if;
  select ho_ten into v_ten_cu from kho.nguoi_dung where id = v_don.sale_phu_trach;
  select ho_ten into v_ten_moi from kho.nguoi_dung where id = p_ns_moi;
  update kho.don_hang set sale_phu_trach = p_ns_moi where ma_don = p_ma_don;
  insert into kho.don_hang_nhat_ky(don_id, tu, den, nguoi_id, ly_do)   -- tu=den (không đổi trạng thái) → auto-trigger KHÔNG double-log
    values(v_don.id, v_don.trang_thai, v_don.trang_thai, kho.current_ns(),
      'Đổi sale phụ trách: '||coalesce(v_ten_cu,'(trống)')||' → '||coalesce(v_ten_moi,'?')||coalesce(' · '||nullif(btrim(p_ly_do),''),''));
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'sale_moi', p_ns_moi, 'ten_moi', v_ten_moi);
end $fn$;
grant execute on function kho.doi_sale_phu_trach(text, uuid, text) to authenticated;

-- ── (4) SIẾT chuông + màn Báo giá theo chủ đơn (body sao nguyên, thêm 1 vế lọc + trả chủ) ──
CREATE OR REPLACE FUNCTION kho.sale_ban_cho_gui(p_gioi_han integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ns uuid := kho.current_ns();  -- L-71: tính MỘT lần, tránh gọi per-row
  v_tong int; v_ds jsonb;
begin
  -- CỔNG VAI (coalesce → vai NULL bị chặn; bẫy NULL đã dính 4 lần)
  if v_vai not in ('sale','truong_nhom_sale','ceo') then
    raise exception 'sale_ban_cho_gui: chỉ sale/truong_nhom_sale/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;

  with moi as (   -- bản MỚI NHẤT mỗi đơn
    select distinct on (b.ma_don) b.ma_don, b.id, b.trang_thai, b.luc_gui
    from kho.ban_thiet_ke b
    order by b.ma_don, b.phien_ban desc
  ), loc as (     -- lọc: bản mới nhất cho_duyet + chưa có link nào cho bản đó
    select m.ma_don,
           coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
           m.luc_gui::date as ngay_thiet_ke_gui,
           (current_date - m.luc_gui::date) as so_ngay_cho
    from moi m
    join kho.don_hang d on d.ma_don = m.ma_don
    where m.trang_thai = 'cho_duyet'
      and not exists (select 1 from kho.link_ban_khach l where l.ban_id = m.id)
      and (v_vai <> 'sale' or d.sale_phu_trach = v_ns)   -- L-71: sale thường chỉ ĐƠN MÌNH
  ), xep as (
    select ma_don, ten_khach, ngay_thiet_ke_gui, so_ngay_cho,
           row_number() over (order by so_ngay_cho desc, ma_don) as rn
    from loc
  )
  select count(*)::int,
         coalesce(jsonb_agg(
           jsonb_build_object('ma_don',ma_don,'ten_khach',ten_khach,
             'ngay_thiet_ke_gui',ngay_thiet_ke_gui,'so_ngay_cho',so_ngay_cho)
           order by so_ngay_cho desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)),
           '[]'::jsonb)
    into v_tong, v_ds
  from xep;

  -- tong = TỔNG thật (badge); ds = tối đa p_gioi_han dòng (danh sách). Cùng điều kiện, chỉ khác cắt trang.
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'gioi_han', p_gioi_han);
end $function$
;

CREATE OR REPLACE FUNCTION kho.sale_bao_gia_ds(p_gioi_han integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ns uuid := kho.current_ns();  -- L-71: tính MỘT lần, tránh gọi per-row
  v_ds jsonb; v_tong int;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'sale_bao_gia_ds: chỉ sale/truong_nhom_sale/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;

  with ban_moi as (   -- bản MỚI NHẤT mỗi đơn
    select distinct on (ma_don) ma_don, id ban_id, trang_thai bt_tt, phien_ban, luc_gui
    from kho.ban_thiet_ke order by ma_don, phien_ban desc
  ), lk as (          -- bản mới nhất ĐÃ gửi link chưa + ngày gửi link gần nhất
    select bm.ma_don, exists(select 1 from kho.link_ban_khach l where l.ban_id = bm.ban_id) co_link,
           (select max(l.tao_luc) from kho.link_ban_khach l where l.ban_id = bm.ban_id) gui_luc
    from ban_moi bm
  ), bg as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') ten_khach,
      d.trang_thai, d.buoc_thiet_ke, d.ma_ns_thiet_ke, d.loai, d.thuong_hieu,
      d.ngay_hen_khach, d.ly_do_thua, d.cap_thiet_ke, nullif(btrim(d.ghi_chu),'') ghi_chu,
      coalesce(d.doanh_thu, d.gia_goc) tien,                              -- GIÁ BÁN (không giá vốn)
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
      and (v_vai <> 'sale' or d.sale_phu_trach = v_ns)   -- L-71: sale thường chỉ ĐƠN MÌNH
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
    end gd
    from bg
  )
  select count(*)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'ten_khach',ten_khach,'gd',gd,'mo_ngay',mo_ngay,'so_mon',so_mon,'mon_ten',mon_ten,
      'pb',pb,'ai_dung',ai_dung,'vong_sua',vong_sua,'ngay_hen',ngay_hen_khach,'tien',tien,
      'cho_khach',cho_khach,'ban_id',ban_id,'loai',loai,'thuong_hieu',thuong_hieu,'ly_thua',ly_do_thua,
      'cap',cap_thiet_ke,'ghi_chu',ghi_chu,'chua_co_ngay',chua_co_ngay,'sale_phu_trach',sale_phu_trach,'sale_ten',sale_ten)
      order by mo_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds
  from (select *, row_number() over (order by mo_ngay desc, ma_don) rn from gd) x;

  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'cat', (v_tong > p_gioi_han));
end $function$
;


do $$ begin
  if to_regprocedure('kho.doi_sale_phu_trach(text,uuid,text)') is null then raise exception 'THIẾU doi_sale_phu_trach'; end if;
  raise notice 'db/101 OK: sale_phu_trach + trigger tự gán + backfill + doi_sale_phu_trach + siết sale_ban_cho_gui/sale_bao_gia_ds theo chủ.';
end $$;
commit;
