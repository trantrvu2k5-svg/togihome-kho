-- db/087 — CHUÔNG "bản chờ gửi": RPC cho app Sale (L-45 việc A)
--   Đơn có BẢN THIẾT KẾ mới nhất ở 'cho_duyet' và CHƯA có link_ban_khach nào trỏ tới bản đó
--   = "bản mới thiết kế đã gửi, ĐANG CHỜ SALE gửi link cho khách". (Điều kiện đã kiểm ở L-44 bước 1.)
--   Badge (tong) và danh sách (ds) tính từ CÙNG MỘT CTE — không viết câu điều kiện thứ hai.
--   Chạy: cd web && node ops/run_sql.mjs ../db/087_sale_ban_cho_gui.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop function if exists kho.sale_ban_cho_gui(int); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.sale_ban_cho_gui(p_gioi_han int default 50)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare
  v_vai text := coalesce(kho.current_vai_tro(),'');
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
end $$;
grant execute on function kho.sale_ban_cho_gui(int) to authenticated;

do $$ begin
  if to_regprocedure('kho.sale_ban_cho_gui(int)') is null then raise exception 'THIẾU sale_ban_cho_gui'; end if;
  raise notice 'db/087 OK: sale_ban_cho_gui (badge tong + ds cùng CTE, guard sale/truong_nhom_sale/ceo)';
end $$;

commit;
