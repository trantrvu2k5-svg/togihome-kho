-- 054 — RPC ĐỌC cho app THIẾT KẾ (nối dây 3 màn). CHỈ đọc; nền dữ liệu ở db/053.
--   TƯỜNG LỬA: thiet_ke/tk_ban_hang đọc qua RPC curated — TRẢ VỀ KHÔNG có giá bán / giá vốn / tên-sđt-địa chỉ
--   khách. Tên hiển thị đơn = tên MÓN đầu (an toàn, không lộ khách). Người cầm = ho_ten nhân sự (nội bộ).
--   Hai vai: thiet_ke = THIẾT KẾ SẢN XUẤT · tk_ban_hang = THIẾT KẾ BÁN HÀNG.
--   node ops/run_sql.mjs ../db/054_doc_app_thiet_ke.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.tk_viec_cua_toi(); drop function if exists kho.tk_don_cho_nhan();
--   drop function if exists kho.tk_bang_cong_viec(); drop function if exists kho.tk_gio_chi_phi(text);
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Trạng thái đơn ở luồng thiết kế (cần/đang) · đã thắng · đã thua — dùng chung.
--   cần thiết kế: moi_len_don·bao_gia·bao_gia_treo·nhan_thiet_ke·dang_thiet_ke
--   thắng (vào SX): cho_cat·da_cat·dang_lam·xong_sx·cho_giao·da_giao · thua: bao_gia_thua

-- ════════ MÀN ① — ĐANG LÀM (đơn caller đang cầm) ════════
create or replace function kho.tk_viec_cua_toi()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer,
                gio_uoc numeric, gio_da_ghi numeric, buoc_thiet_ke text, trang_thai text,
                vong_sua integer, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tk_viec_cua_toi: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  v_me := kho.current_ns();
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke),
    coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = d.ma_don), 0),
    d.buoc_thiet_ke, d.trang_thai,
    (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    d.ngay_hen_khach, coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.ma_ns_thiet_ke = v_me and coalesce(d.buoc_thiet_ke,'') <> 'xong_file'
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last;
end $$;
grant execute on function kho.tk_viec_cua_toi() to authenticated;

-- ════════ MÀN ① — CHỜ NHẬN (chưa ai cầm, cần thiết kế) — xếp theo mức cần làm trước ════════
create or replace function kho.tk_don_cho_nhan()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric,
                trang_thai text, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tk_don_cho_nhan: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke), d.trang_thai, d.ngay_hen_khach,
    coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.ma_ns_thiet_ke is null
    and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke')
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last, d.tao_luc asc nulls last;
end $$;
grant execute on function kho.tk_don_cho_nhan() to authenticated;

-- ════════ MÀN ② — BẢNG CÔNG VIỆC (cả đội — team board, KHÔNG lọc theo người) ════════
--   cot = buoc_thiet_ke; đơn chưa nhận mà cần thiết kế -> cot='cho_nhan'.
create or replace function kho.tk_bang_cong_viec()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, cot text,
                gio_uoc numeric, gio_thuc numeric, ai_cam text, vai_cam text,
                vong_sua integer, ngay_hen_khach date, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tk_bang_cong_viec: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    case when d.buoc_thiet_ke is not null then d.buoc_thiet_ke else 'cho_nhan' end,
    kho.gio_uoc_cap(d.cap_thiet_ke),
    coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = d.ma_don), 0),
    (select n.ho_ten from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke),
    (select n.vai_tro from kho.nguoi_dung n where n.id = d.ma_ns_thiet_ke),
    (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    d.ngay_hen_khach, coalesce(d.la_demo,false), (d.loai = 'mau_moi')
  from kho.don_hang d
  where d.buoc_thiet_ke is not null
     or (d.ma_ns_thiet_ke is null and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke'))
  order by d.ngay_hen_khach asc nulls last;
end $$;
grant execute on function kho.tk_bang_cong_viec() to authenticated;

-- ════════ MÀN ③ — GIỜ & CHI PHÍ (RLS: mỗi vai số CỦA MÌNH · ceo cả đội) ════════
--   Trả jsonb: {o_so, gio_di_dau, uoc_thuc}. Giờ ĐI ĐÂU phân loại theo TRẠNG THÁI ĐƠN (đơn-level, không
--   gắn từng giờ vào việc-sửa — nền chưa tag rework theo giờ; xấp xỉ đủ để CEO thấy khối chảy máu).
create or replace function kho.tk_gio_chi_phi(p_ma_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v_me uuid; v_tong numeric; v_thang numeric; v_thua numeric; v_sua numeric; v_mau_cho numeric;
        v_uoc_thuc jsonb;
begin
  v_vai := coalesce(kho.current_vai_tro(),''); v_me := kho.current_ns();
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'tk_gio_chi_phi: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;

  -- gom giờ (không demo, đúng kỳ, đúng phạm vi) rồi phân xô theo trạng thái đơn
  with g as (
    select g.gio_thuc,
      case
        when d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then 'thang'
        when d.trang_thai = 'bao_gia_thua' then 'thua'
        when exists (select 1 from kho.ban_thiet_ke b where b.ma_don = d.ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')) then 'sua'
        else 'mau_cho' end xo
    from kho.gio_thiet_ke_thuc g
    join kho.don_hang d on d.ma_don = g.ma_don
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
      and (v_vai = 'ceo' or g.ma_ns = v_me)
  )
  select coalesce(sum(gio_thuc),0),
         coalesce(sum(gio_thuc) filter (where xo='thang'),0),
         coalesce(sum(gio_thuc) filter (where xo='thua'),0),
         coalesce(sum(gio_thuc) filter (where xo='sua'),0),
         coalesce(sum(gio_thuc) filter (where xo='mau_cho'),0)
    into v_tong, v_thang, v_thua, v_sua, v_mau_cho from g;

  -- ước vs thực theo CẤP (đơn đã xong file — mới so được). <5 đơn -> du_tin=false (frontend KHÔNG hiện số).
  select coalesce(jsonb_agg(x order by x->>'cap'), '[]'::jsonb) into v_uoc_thuc from (
    select jsonb_build_object(
      'cap', t.cap_thiet_ke,
      'gio_uoc', kho.gio_uoc_cap(t.cap_thiet_ke),
      'gio_thuc_tb', round(avg(t.thuc) filter (where t.thuc is not null), 2),
      'so_don', count(*)::int,
      'du_tin', count(*) >= 5) x
    from (
      select d.cap_thiet_ke,
        (select sum(gg.gio_thuc) from kho.gio_thiet_ke_thuc gg
           where gg.ma_don = d.ma_don and (v_vai='ceo' or gg.ma_ns = v_me)) thuc
      from kho.don_hang d
      where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
        and d.buoc_thiet_ke = 'xong_file' and (v_vai='ceo' or d.ma_ns_thiet_ke = v_me)
    ) t
    group by t.cap_thiet_ke
  ) y;

  return jsonb_build_object(
    'o_so', jsonb_build_object(
      'gio_thang', v_tong,
      'ty_le_ve_don', case when v_tong > 0 then round(100.0 * v_thang / v_tong, 0) else null end,
      'gio_bao_gia_thua', v_thua,
      'gio_sua_gop_y', v_sua),
    'gio_di_dau', jsonb_build_object('thang', v_thang, 'thua', v_thua, 'sua', v_sua, 'mau_cho', v_mau_cho),
    'uoc_thuc', v_uoc_thuc);
end $$;
grant execute on function kho.tk_gio_chi_phi(text) to authenticated;

commit;
