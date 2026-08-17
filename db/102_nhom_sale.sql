-- db/102 — L-72 PHẦN B: màn "Nhóm của tôi" (trưởng nhóm sale). Idempotent.
--   Block 1 (tắc nhóm) + Block 2 (phễu theo người) DÙNG LẠI sale_bao_gia_ds (trưởng nhóm/ceo thấy CẢ NHÓM,
--     RPC đã trả sale_phu_trach + sale_ten) → tính client-side, KHÔNG viết câu thứ hai.
--   Block 3 (số theo người 30 ngày) = RPC MỚI nhom_so_nguoi. Guard truong_nhom_sale/ceo, limit. KHÔNG giá vốn.
-- ═════ HOÀN TÁC: drop function kho.nhom_so_nguoi(int,int); ═════
begin;

create or replace function kho.nhom_so_nguoi(p_ngay int default 30, p_gioi_han int default 50)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); r jsonb;
begin
  if v_vai not in ('truong_nhom_sale','ceo') then
    raise exception 'nhom_so_nguoi: chỉ truong_nhom_sale/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return (
  with f as (   -- đơn báo giá trong CỬA SỔ p_ngày (không demo)
    select d.ma_don, d.sale_phu_trach, d.tao_luc,
      coalesce(d.doanh_thu, d.gia_goc) tien,                          -- GIÁ BÁN (không giá vốn)
      (d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy','tam_ngung')) chot,
      (select min(coalesce(l.tao_luc, b.luc_gui)) from kho.ban_thiet_ke b
         left join kho.link_ban_khach l on l.ban_id = b.id where b.ma_don = d.ma_don) gui_luc
    from kho.don_hang d
    where coalesce(d.la_demo,false) = false and d.ngay_tao_bao_gia is not null
      and d.ngay_tao_bao_gia >= now() - (p_ngay || ' days')::interval
  ), byS as (
    select sale_phu_trach,
      count(*) tao, count(*) filter (where chot) chot,
      round(avg(tien)) gia_tri_tb,
      round(avg((gui_luc::date - tao_luc::date)) filter (where gui_luc is not null), 1) hoi_gui_tb
    from f group by sale_phu_trach
  )
  select jsonb_build_object('nguong_tam', 30, 'so_ngay', p_ngay,
    'ds', coalesce((select jsonb_agg(jsonb_build_object(
        'sale_id', z.sale_phu_trach,
        'sale', coalesce((select ho_ten from kho.nguoi_dung n where n.id = z.sale_phu_trach), '(chưa gán)'),
        'tao', z.tao, 'chot', z.chot,
        'ti_le', case when z.tao > 0 then round(z.chot::numeric / z.tao, 3) end,
        'gia_tri_tb', z.gia_tri_tb, 'hoi_gui_tb', z.hoi_gui_tb, 'n', z.tao) order by z.tao desc)
      from (select * from byS order by tao desc limit greatest(p_gioi_han, 0)) z), '[]'::jsonb)));
end $$;
grant execute on function kho.nhom_so_nguoi(int, int) to authenticated;

do $$ begin
  if to_regprocedure('kho.nhom_so_nguoi(int,int)') is null then raise exception 'THIẾU nhom_so_nguoi'; end if;
  raise notice 'db/102 OK: nhom_so_nguoi (số theo người 30 ngày, guard truong_nhom_sale/ceo). Block 1+2 dùng lại sale_bao_gia_ds.';
end $$;
commit;
