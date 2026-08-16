-- db/097 — CHUÔNG HAI CHIỀU cho app Thiết kế (L-62). Chiều sale→thiết kế: TK biết khách phản hồi + đơn chốt/thua.
--   3 con số + 3 danh sách CÙNG CTE (badge == list), limit + tổng riêng, guard vai coalesce, vai NULL chặn.
--   luc_tk_xem (idempotent) = mốc TK xem panel đơn; NULL/nhỏ hơn mốc mới = CHƯA XEM (dùng chung cho b + c).
--   KHÔNG cột thứ hai cho (c): so luc_tk_xem với thời điểm đổi trạng thái trong don_hang_nhat_ky.
--   Chạy: cd web && node ops/run_sql.mjs ../db/097_tk_chuong.sql
-- ══════════ HOÀN TÁC ══════════  begin; drop function if exists kho.tk_chuong(int); drop function if exists kho.tk_danh_dau_xem(text); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table kho.ban_thiet_ke add column if not exists luc_tk_xem timestamptz;   -- NULL = TK chưa xem
comment on column kho.ban_thiet_ke.luc_tk_xem is 'Mốc thiết kế mở panel xem đơn này — so với luc_phan_hoi (b) và mốc đổi trạng thái nhật ký (c) để biết CHƯA XEM.';

-- ── đánh dấu ĐÃ XEM khi mở panel chi tiết ──
create or replace function kho.tk_danh_dau_xem(p_ma_don text)
  returns void language plpgsql volatile security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_me uuid := kho.current_ns();
  v_nhom boolean := v_vai in ('ceo','truong_nhom_thiet_ke');
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom_thiet_ke','ceo') then
    raise exception 'tk_danh_dau_xem: vai "%" không được', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  update kho.ban_thiet_ke set luc_tk_xem = now()
    where ma_don = p_ma_don and (v_nhom or ma_ns_gui = v_me);
end $$;
grant execute on function kho.tk_danh_dau_xem(text) to authenticated;

-- ── CHUÔNG: 3 mục ──
create or replace function kho.tk_chuong(p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),''); v_me uuid := kho.current_ns();
  v_nhom boolean := v_vai in ('ceo','truong_nhom_thiet_ke');
  v_cb boolean := kho.toi_co_vai('tk_ban_hang'); v_ct boolean := kho.toi_co_vai('thiet_ke');
  a jsonb; b jsonb; cc jsonb; ta int; tb int; tc int;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom_thiet_ke','ceo') then
    raise exception 'tk_chuong: vai "%" không xem được', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;

  -- (a) VIỆC MỚI CHỜ NHẬN — dùng lại điều kiện tk_don_cho_nhan (ma_ns_thiet_ke null + hàng chờ + lọc vai)
  with cn as (
    select d.ma_don,
      coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach,
      (current_date - coalesce(d.ngay_tao_bao_gia::date, d.tao_luc::date, current_date)) so_ngay
    from kho.don_hang d
    where d.ma_ns_thiet_ke is null
      and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke')
      and (v_nhom or (v_cb and d.trang_thai in ('bao_gia','bao_gia_treo'))
                  or (v_ct and d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke')))
  ), cnx as (select *, row_number() over (order by so_ngay desc, ma_don) rn from cn)
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'khach',khach,'viec','việc mới chờ nhận','so_ngay',so_ngay)
      order by so_ngay desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)),'[]'::jsonb)
    into ta, a from cnx;

  -- (b) KHÁCH ĐÃ PHẢN HỒI bản mình dựng mà mình CHƯA XEM (khách chê kèm lý do)
  with ph as (
    select b.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, b.phien_ban, b.trang_thai bt,
      nullif(btrim(coalesce(b.ghi_chu_phan_hoi,'')),'') ghi, b.luc_phan_hoi,
      (current_date - b.luc_phan_hoi::date) so_ngay
    from kho.ban_thiet_ke b join kho.don_hang d on d.ma_don = b.ma_don
    where b.luc_phan_hoi is not null
      and b.trang_thai in ('khach_duyet','khach_doi_y','chua_dung_yeu_cau')
      and (v_nhom or b.ma_ns_gui = v_me)
      and (b.luc_tk_xem is null or b.luc_tk_xem < b.luc_phan_hoi)
  ), phx as (select *, row_number() over (order by luc_phan_hoi desc, ma_don) rn from ph)
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'khach',khach,'pb',phien_ban,
      'viec', (case bt when 'khach_duyet' then 'khách duyệt bản' else 'khách chê' end)
              || case when bt in ('khach_doi_y','chua_dung_yeu_cau') and ghi is not null then ': '||ghi else '' end,
      'so_ngay',so_ngay) order by luc_phan_hoi desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)),'[]'::jsonb)
    into tb, b from phx;

  -- (c) ĐƠN CỦA MÌNH ĐÃ CHỐT (moi_len_don) / THUA (bao_gia_thua) mà mình CHƯA XEM
  --     (so luc_tk_xem của bản mình dựng với MỐC ĐỔI TRẠNG THÁI trong nhật ký — KHÔNG cột thứ hai)
  with ct as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.trang_thai tt, d.ly_do_thua,
      nk.luc chot_luc, (current_date - nk.luc::date) so_ngay
    from kho.don_hang d
      join lateral (select max(n.luc) luc from kho.don_hang_nhat_ky n
                    where n.don_id = d.id and n.den in ('moi_len_don','bao_gia_thua')) nk on true
    where d.trang_thai in ('moi_len_don','bao_gia_thua') and nk.luc is not null
      and exists (select 1 from kho.ban_thiet_ke b where b.ma_don = d.ma_don
                    and (v_nhom or b.ma_ns_gui = v_me)
                    and (b.luc_tk_xem is null or b.luc_tk_xem < nk.luc))
  ), ctx as (select *, row_number() over (order by chot_luc desc, ma_don) rn from ct)
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'khach',khach,
      'viec', case when tt='moi_len_don' then 'đã chốt thành đơn'
                   else 'thua' || coalesce(': ' || (case ly_do_thua
                        when 'gia_cao' then 'giá cao' when 'cham' then 'chậm' when 'doi_y' then 'khách đổi ý'
                        when 'chon_noi_khac' then 'chọn nơi khác' when 'khac' then 'khác' else ly_do_thua end), '') end,
      'so_ngay',so_ngay) order by chot_luc desc, ma_don) filter (where rn <= greatest(p_gioi_han,0)),'[]'::jsonb)
    into tc, cc from ctx;

  return jsonb_build_object('tong', ta+tb+tc,
    'a', jsonb_build_object('tong',ta,'ds',a),
    'b', jsonb_build_object('tong',tb,'ds',b),
    'c', jsonb_build_object('tong',tc,'ds',cc));
end $$;
grant execute on function kho.tk_chuong(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.tk_chuong(int)') is null then raise exception 'THIẾU tk_chuong'; end if;
  if to_regprocedure('kho.tk_danh_dau_xem(text)') is null then raise exception 'THIẾU tk_danh_dau_xem'; end if;
  raise notice 'db/097 OK: tk_chuong (3 mục badge==list) + luc_tk_xem + tk_danh_dau_xem';
end $$;
commit;
