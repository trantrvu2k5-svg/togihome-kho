-- WP-15b (2) L-10 · db/224 · vế 2b QD-103: báo giá đóng dấu kỳ lúc gửi + cờ hết-hạn + RPC báo-lại-theo-kỳ.
-- Hết hạn = NHÃN (tính từ han_tra_loi so current_date, KHÔNG cột trạng thái, KHÔNG job). Đổi giá CHỈ khi người bấm bao_gia_lai.

-- ═══ B1 · cột mới (client ĐÓNG — WP-11b; chỉ RPC/trigger DEFINER ghi) ═══
alter table kho.don_hang add column if not exists ma_ky_bao_gia   text;         -- kỳ giá lúc GỬI báo giá (≠ ma_ky_ap_dung của đơn CHỐT, QD-100)
alter table kho.don_hang add column if not exists bao_gia_lai_luc timestamptz;  -- vết QD-101: khi báo lại
alter table kho.don_hang add column if not exists bao_gia_lai_boi text;         -- vết QD-101: ai báo lại
comment on column kho.don_hang.ma_ky_bao_gia is 'WP-15b: kỳ giá THỰC lúc gửi báo giá (moc_bao_gia đóng dấu = ky_gia_hien_hanh); báo giá đã gửi KHÔNG tự đổi giá khi kỳ đổi (QD-103 lớp 2)';

-- ═══ B1 · moc_bao_gia: đóng dấu ma_ky_bao_gia lúc tạo báo giá ═══
CREATE OR REPLACE FUNCTION kho.moc_bao_gia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
      new.ma_ky_bao_gia   := coalesce(new.ma_ky_bao_gia, kho.ky_gia_hien_hanh());  -- [WP-15b] đóng dấu kỳ lúc gửi báo giá
      if new.han_tra_loi is null then
        new.han_tra_loi := coalesce(new.ngay_tao_bao_gia, now())::date
          + coalesce(kho.han_bao_gia_so_ngay(case when new.dong = 'du_an' then 'du_an' else 'le' end, now()::date), 7);
      end if;
    end if;
  else
    if new.trang_thai = 'bao_gia' and old.trang_thai is distinct from 'bao_gia' then
      new.ngay_tao_bao_gia := coalesce(new.ngay_tao_bao_gia, now());
      new.ma_ky_bao_gia   := coalesce(new.ma_ky_bao_gia, kho.ky_gia_hien_hanh());  -- [WP-15b] đóng dấu kỳ lúc gửi báo giá
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
end $function$
;

-- ═══ B2 · sale_bao_gia_ds: + ma_ky_bao_gia · het_han · so_ngay_qua_han (trường TÍNH, không cột trạng thái) ═══
CREATE OR REPLACE FUNCTION kho.sale_bao_gia_ds(p_gioi_han integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
      d.han_tra_loi, d.ma_ky_bao_gia,                                                     -- [WP-72]
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
         else 'con_han' end nhom,
    (trang_thai in ('bao_gia','bao_gia_treo') and han_tra_loi is not null and han_tra_loi < current_date) het_han,  -- [WP-15b]
    case when trang_thai in ('bao_gia','bao_gia_treo') and han_tra_loi is not null and han_tra_loi < current_date then current_date - han_tra_loi else 0 end so_ngay_qua_han
    from bg
  )
  select count(*)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'ten_khach',ten_khach,'gd',gd,'mo_ngay',mo_ngay,'so_mon',so_mon,'mon_ten',mon_ten,
      'pb',pb,'ai_dung',ai_dung,'vong_sua',vong_sua,'ngay_hen',ngay_hen_khach,'tien',tien,
      'cho_khach',cho_khach,'ban_id',ban_id,'loai',loai,'thuong_hieu',thuong_hieu,'ly_thua',ly_do_thua,
      'han_tra_loi',han_tra_loi,'so_ngay_con',so_ngay_con,'nhom',nhom,'ma_ky_bao_gia',ma_ky_bao_gia,'het_han',het_han,'so_ngay_qua_han',so_ngay_qua_han,                                  -- [WP-72]
      'cap',cap_thiet_ke,'ghi_chu',ghi_chu,'chua_co_ngay',chua_co_ngay,'sale_phu_trach',sale_phu_trach,'sale_ten',sale_ten)
      order by mo_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds
  from (select *, row_number() over (order by mo_ngay desc, ma_don) rn from gd) x;
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'cat', (v_tong > p_gioi_han));
end $function$
;

-- ═══ B3 · RPC bao_gia_lai — báo lại theo kỳ, CHỈ khi người bấm, đơn còn báo giá VÀ quá hạn ═══
create or replace function kho.bao_gia_lai(p_don_id uuid) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $BGL$
declare v_vai text; v_d record; v_mon jsonb; v_gia_moi numeric; v_ky_moi text; v_han_moi date; v_songay int;
        v_gia_cu numeric; v_ky_cu text; v_boi text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('sale','truong_nhom_sale','ceo','ke_toan') then
    raise exception 'bao_gia_lai: chỉ sale/truong_nhom_sale/ceo/ke_toan (vai "%")', v_vai; end if;
  v_boi := coalesce(auth.uid()::text, 'he_thong');
  select * into v_d from kho.don_hang where id = p_don_id;
  if v_d.id is null then raise exception 'bao_gia_lai: không có đơn %', p_don_id; end if;
  -- chỉ đơn CÒN LÀ BÁO GIÁ (bao_gia/bao_gia_treo) — chặn đơn đã chốt/đã giao (không lặp vụ chot_don đơn da_giao)
  if v_d.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'bao_gia_lai: đơn "%" đang "%" — chỉ báo lại đơn CÒN Ở BÁO GIÁ', v_d.ma_don, v_d.trang_thai; end if;
  -- chỉ khi ĐÃ QUÁ HẠN (còn hạn thì giữ nguyên giá đã đóng dấu — QD-103 lớp 2)
  if v_d.han_tra_loi is null or v_d.han_tra_loi >= current_date then
    raise exception 'bao_gia_lai: đơn "%" CHƯA quá hạn (hạn %) — báo giá còn hiệu lực, không cần báo lại', v_d.ma_don, v_d.han_tra_loi; end if;
  -- món phải có sp_id + giá vốn (không thì không tự tính lại được)
  if not exists (select 1 from kho.don_hang_mon m where m.don_id = p_don_id) then
    raise exception 'bao_gia_lai: đơn "%" không có món', v_d.ma_don; end if;
  if exists (select 1 from kho.don_hang_mon m where m.don_id = p_don_id
             and (m.sp_id is null or not exists(select 1 from kho.san_pham_mau_gia_von g where g.ma = m.sp_id))) then
    raise exception 'bao_gia_lai: đơn "%" có món thiếu sp_id/giá vốn — không tự tính lại, cần báo giá thủ công', v_d.ma_don; end if;
  -- dựng p_mon: mỗi món × so_luong (gia_san_don tính từng đơn vị, dùng he_so_nhom mặc định của kỳ)
  select jsonb_agg(jsonb_build_object('sku', m.sp_id))
    into v_mon from kho.don_hang_mon m
    cross join generate_series(1, greatest(coalesce(m.so_luong,1),1)) where m.don_id = p_don_id;
  v_ky_cu := v_d.ma_ky_bao_gia; v_gia_cu := v_d.gia_chot;
  v_gia_moi := kho.gia_san_don(v_mon, coalesce(nullif(v_d.dong,''),'le'));   -- CHƯA VAT (khớp cách lưu gia_chot)
  v_ky_moi  := kho.ky_gia_hien_hanh();
  v_songay  := coalesce(kho.han_bao_gia_so_ngay(case when v_d.dong='du_an' then 'du_an' else 'le' end, current_date), 7);
  v_han_moi := current_date + v_songay;
  update kho.don_hang
     set gia_chot = v_gia_moi, doanh_thu = v_gia_moi, ma_ky_bao_gia = v_ky_moi,
         han_tra_loi = v_han_moi, ngay_tao_bao_gia = now(),
         bao_gia_lai_luc = now(), bao_gia_lai_boi = v_boi
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'gia_cu', v_gia_cu, 'gia_moi', v_gia_moi,
    'ky_cu', v_ky_cu, 'ky_moi', v_ky_moi, 'han_moi', v_han_moi);
end $BGL$;
alter function kho.bao_gia_lai(uuid) owner to postgres;
revoke execute on function kho.bao_gia_lai(uuid) from public, anon;
grant  execute on function kho.bao_gia_lai(uuid) to authenticated;
