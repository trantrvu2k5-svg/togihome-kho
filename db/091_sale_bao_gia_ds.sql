-- db/091 — MÀN BÁO GIÁ theo v5 (L-50). Trả TOÀN BỘ đơn báo giá (một mảng) + gd (giai đoạn) mỗi đơn.
--   App tính 5 ô đếm + thua/treo + LỌC client-side TỪ chính mảng này (như v5) → ô == danh sách (cùng nguồn).
--   gd ánh xạ: chua_nhan · dang_dung(gồm dung_xong) · ban_moi(bản cho_duyet CHƯA gửi link = chuông) ·
--     da_gui(cho_duyet ĐÃ gửi link) · sua_gop_y · du_len_don(bản khach_duyet) · thua · treo.
--   Sale THẤY GIÁ BÁN (doanh_thu/gia_goc), KHÔNG giá vốn (RPC không đụng don_hang_gia_von). Guard coalesce vai.
--   Chạy: cd web && node ops/run_sql.mjs ../db/091_sale_bao_gia_ds.sql
--
-- ══════════ HOÀN TÁC ══════════  begin; drop function if exists kho.sale_bao_gia_ds(int); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.sale_bao_gia_ds(p_gioi_han int default 1000)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
  v_ds jsonb; v_tong int;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo') then
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
      'cap',cap_thiet_ke,'ghi_chu',ghi_chu,'chua_co_ngay',chua_co_ngay)
      order by mo_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds
  from (select *, row_number() over (order by mo_ngay desc, ma_don) rn from gd) x;

  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'cat', (v_tong > p_gioi_han));
end $$;
grant execute on function kho.sale_bao_gia_ds(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.sale_bao_gia_ds(int)') is null then raise exception 'THIẾU sale_bao_gia_ds'; end if;
  raise notice 'db/091 OK: sale_bao_gia_ds (mảng đơn báo giá + gd; app tự tính ô/lọc như v5)';
end $$;
commit;
