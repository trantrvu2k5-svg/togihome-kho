-- db/094 — sale XEM tiến độ xưởng của một đơn (L-58 PHẦN 3). Mỗi MÓN một dòng: bước hiện tại + lần quét gần nhất.
--   Đọc từ tien_do_tem (bảng suy sẵn — KHÔNG đụng su_kien_quet trực tiếp). Món lấy tem "kém tiến độ nhất"
--   (so_buoc_xong nhỏ nhất) làm bước hiện tại của món. Chỉ trả món CÓ tem (đang SX). KHÔNG giá vốn.
--   Sale/truong_nhom_sale/ceo/xuong/ke_toan xem được. Chạy: cd web && node ops/run_sql.mjs ../db/094_sale_tien_do_mon.sql
-- ══════════ HOÀN TÁC ══════════  begin; drop function if exists kho.sale_tien_do_mon(text); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.sale_tien_do_mon(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','xuong','ke_toan') then
    raise exception 'sale_tien_do_mon: vai "%" không xem được', coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'mon_id', mon_id, 'ten', ten, 'so_tem', so_tem, 'tem_xong', tem_xong,
      'buoc', buoc, 'tong_buoc', tong_buoc, 'so_buoc_xong', so_buoc_xong, 'to', to_ht,
      'trang_thai', tt, 'lan_quet', lan_quet) order by ten), '[]'::jsonb) into v
  from (
    select m.id mon_id, m.ten,
      (select count(*)::int from kho.tien_do_tem t where t.mon_id = m.id) so_tem,
      (select count(*)::int from kho.tien_do_tem t where t.mon_id = m.id and t.trang_thai='xong_het') tem_xong,
      lag.buoc_hien_tai buoc, lag.tong_so_buoc tong_buoc, lag.so_buoc_xong, lag.to_hien_tai to_ht, lag.trang_thai tt,
      (select max(coalesce(t.ra_luc, t.vao_luc, t.cap_nhat_luc)) from kho.tien_do_tem t where t.mon_id = m.id) lan_quet
    from kho.don_hang_mon m
      join kho.don_hang d on d.id = m.don_id
      join lateral (   -- tem KÉM tiến độ nhất của món = bước hiện tại của món
        select t.buoc_hien_tai, t.tong_so_buoc, t.so_buoc_xong, t.to_hien_tai, t.trang_thai
        from kho.tien_do_tem t where t.mon_id = m.id
        order by t.so_buoc_xong nulls first, t.buoc_hien_tai nulls first limit 1) lag on true
    where d.ma_don = p_ma_don
  ) x;
  return v;
end $$;
grant execute on function kho.sale_tien_do_mon(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.sale_tien_do_mon(text)') is null then raise exception 'THIẾU sale_tien_do_mon'; end if;
  raise notice 'db/094 OK: sale_tien_do_mon (đọc tien_do_tem, mỗi món 1 dòng, không giá vốn)';
end $$;
commit;
