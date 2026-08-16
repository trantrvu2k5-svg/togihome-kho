-- db/096 — DÒNG ĐỜI ĐƠN: kể lại một đơn từ lúc sinh ra (L-60 PHẦN 1). CHỈ ĐỌC, không bảng/trigger mới.
--   Gộp 4 nguồn có sẵn: don_hang_nhat_ky (đổi trạng thái) · ban_thiet_ke.luc_gui (gửi bản vN) ·
--     ban_thiet_ke.luc_phan_hoi (khách duyệt/chê) · link_ban_khach.tao_luc (gửi link khách xem).
--   Trả mảng sự kiện MỚI NHẤT TRÊN CÙNG; app dịch code→tiếng người. KHÔNG trường giá vốn (4 nguồn đều không có tiền).
--   Chạy: cd web && node ops/run_sql.mjs ../db/096_dong_doi_don.sql
-- ══════════ HOÀN TÁC ══════════  begin; drop function if exists kho.sale_dong_doi_don(text,int); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.sale_dong_doi_don(p_ma_don text, p_gioi_han int default 60)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v jsonb;
begin
  if v_vai not in ('sale','truong_nhom_sale','ceo','xuong','ke_toan','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'sale_dong_doi_don: vai "%" không xem được', coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;
  with sk as (
    -- a) đổi trạng thái đơn
    select nk.luc, nk.nguoi_id, 'tt'::text kind, nk.den code, nk.ly_do ghi, null::int pb
    from kho.don_hang_nhat_ky nk join kho.don_hang d on d.id = nk.don_id where d.ma_don = p_ma_don
    union all
    -- b) gửi bản thiết kế phiên bản N
    select b.luc_gui, b.ma_ns_gui, 'ban_gui', 'gui', nullif(btrim(coalesce(b.ghi_chu,'')),''), b.phien_ban
    from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_gui is not null
    union all
    -- c) khách phản hồi bản (duyệt / chê)
    select b.luc_phan_hoi, b.ma_ns_phan_hoi, 'phan_hoi', b.trang_thai, nullif(btrim(coalesce(b.ghi_chu_phan_hoi,'')),''), b.phien_ban
    from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_phan_hoi is not null
    union all
    -- d) gửi link cho khách xem
    select l.tao_luc, l.tao_boi, 'link', 'gui_link', null, b.phien_ban
    from kho.link_ban_khach l join kho.ban_thiet_ke b on b.id = l.ban_id where b.ma_don = p_ma_don
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'luc', luc, 'kind', kind, 'code', code, 'pb', pb, 'ghi', ghi,
      'ai_ten', (select n.ho_ten from kho.nguoi_dung n where n.id = nguoi_id),
      'ai_vai', (select n.vai_tro from kho.nguoi_dung n where n.id = nguoi_id)) order by luc desc), '[]'::jsonb)
    into v
  from (select * from sk where luc is not null order by luc desc limit greatest(p_gioi_han,0)) x;
  return v;
end $$;
grant execute on function kho.sale_dong_doi_don(text,int) to authenticated;

do $$ begin
  if to_regprocedure('kho.sale_dong_doi_don(text,int)') is null then raise exception 'THIẾU sale_dong_doi_don'; end if;
  raise notice 'db/096 OK: sale_dong_doi_don (dòng đời đơn, 4 nguồn, mới nhất trên cùng, không giá vốn)';
end $$;
commit;
