-- db/098 — VÁ lỗi rà L-64 app Tài chính (L-65). Idempotent.
--   #1 (QĐ CEO): gia_von_don_ds cho THÊM ke_toan XEM (guard ceo/kho → ceo/kho/ke_toan) + PHÂN TRANG (tổng riêng).
--       ghi_gia_von_tay GIỮ NGUYÊN chỉ ceo/kho (kế toán XEM được, GHI không) — KHÔNG đụng ở đây.
--   #3: niem_yet_info THÊM guard vai (trước HỞ, sale/tho/NULL gọi được) — chỉ ceo/ke_toan.
--   Chạy: cd web && node ops/run_sql.mjs ../db/098_va_ra_taichinh.sql
-- ══════════ HOÀN TÁC ══════════  chạy lại db/048 (gia_von_don_ds không tham số) + db/033 (niem_yet_info language sql).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── #1 · gia_von_don_ds: đổi CHỮ KÝ (thêm phân trang) → DROP bản không tham số cũ trước ──
drop function if exists kho.gia_von_don_ds();
create or replace function kho.gia_von_don_ds(p_gioi_han int default 50, p_offset int default 0)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_tong int; v_ds jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','ke_toan') then   -- QĐ CEO: kế toán XEM được giá vốn đơn
    raise exception 'gia_von_don_ds: chỉ ceo/kho/ke_toan (vai "%")',
      coalesce(nullif(kho.current_vai_tro(),''),'(chưa đăng nhập)'); end if;
  select count(*)::int into v_tong from kho.don_hang d
    where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy');
  select coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'trang_thai',trang_thai,'dong',dong,'co_gia_von',co_gia_von,'nguon',nguon,
      'khoi_1',khoi_1,'khoi_2',khoi_2,'khoi_3',khoi_3,'gia_chuyen_giao',gia_chuyen_giao,
      'nguoi_ten',nguoi_ten,'ly_do',ly_do,'cap_nhat_luc',cap_nhat_luc) order by co_gia_von, ma_don), '[]'::jsonb)
    into v_ds
  from (
    select d.ma_don, d.trang_thai, d.dong, (g.ma_don is not null) co_gia_von, g.nguon,
      g.khoi_1, g.khoi_2, g.khoi_3, g.gia_chuyen_giao, n.ho_ten nguoi_ten, g.ly_do, g.cap_nhat_luc
    from kho.don_hang d
    left join kho.don_hang_gia_von g on g.ma_don = d.ma_don
    left join kho.nguoi_dung n on n.id = g.nguoi_day
    where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy')
    order by (g.ma_don is not null), d.ma_don        -- đơn CHƯA có giá vốn lên đầu (giữ cho dropdown nhập tay)
    limit greatest(p_gioi_han,0) offset greatest(p_offset,0)
  ) x;
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'gioi_han', p_gioi_han, 'offset', greatest(p_offset,0));
end $$;
grant execute on function kho.gia_von_don_ds(int,int) to authenticated;

-- ── #3 · niem_yet_info: THÊM guard (trước HỞ) — chỉ ceo/ke_toan. Cùng chữ ký (text→jsonb), đổi language sql→plpgsql. ──
create or replace function kho.niem_yet_info(p_ma_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'niem_yet_info: chỉ ceo/ke_toan (vai "%")',
      coalesce(nullif(kho.current_vai_tro(),''),'(chưa đăng nhập)'); end if;
  return (
    select jsonb_build_object('so_dong', count(*), 'chot_luc', max(y.chot_luc),
      'chot_boi', (select n.ho_ten from kho.gia_niem_yet y2 join kho.nguoi_dung n on n.id = y2.chot_boi
                   where y2.ma_ky = p_ma_ky order by y2.chot_luc desc limit 1))
    from kho.gia_niem_yet y where y.ma_ky = p_ma_ky);
end $$;
grant execute on function kho.niem_yet_info(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.gia_von_don_ds(int,int)') is null then raise exception 'THIẾU gia_von_don_ds(int,int)'; end if;
  if to_regprocedure('kho.gia_von_don_ds()') is not null then raise exception 'BẢN CŨ gia_von_don_ds() còn — chưa drop'; end if;
  raise notice 'db/098 OK: gia_von_don_ds(+ke_toan, phân trang) + niem_yet_info(gác vai). ghi_gia_von_tay GIỮ ceo/kho.';
end $$;
commit;
