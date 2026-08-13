-- 056 — PHÂN BIỆT VIỆC HAI VAI + BÀN GIAO bán hàng → sản xuất.
--   A. Nhãn/việc theo VIỆC THIẾT KẾ (không theo trang_thai đơn) — tính ở frontend từ trang_thai/loai.
--   B. tk_don_cho_nhan LỌC THEO VAI ở tầng RPC + nhan_viec_thiet_ke chặn nhận SAI việc.
--        bán hàng (tk_ban_hang) = đơn bao_gia/bao_gia_treo  ·  sản xuất (thiet_ke) = moi_len_don/nhan_thiet_ke/dang_thiet_ke
--   C. Đơn rời bao_gia → moi_len_don: XOÁ người cầm (về cho_nhan) nhưng GHI VẾT ma_ns_tk_ban_hang;
--        panel sản xuất thấy "bản khách đã duyệt" để dựng file cho khớp.
--   node ops/run_sql.mjs ../db/056_viec_hai_vai.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop trigger if exists trg_ban_giao on kho.don_hang; drop function if exists kho.ban_giao_thiet_ke();
--   alter table kho.don_hang drop column if exists ma_ns_tk_ban_hang;
--   -- tk_don_cho_nhan / nhan_viec_thiet_ke / tk_chi_tiet_don: khôi phục bản db/055 (xem git).
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- vết ai dựng 3D báo giá (thiết kế bán hàng) — giữ SAU khi bàn giao sang sản xuất
alter table kho.don_hang add column if not exists ma_ns_tk_ban_hang uuid references kho.nguoi_dung(id);

-- ════════ C. BÀN GIAO: rời bao_gia → moi_len_don thì trả đơn về cho_nhan (cho sản xuất), giữ vết bán hàng ════════
create or replace function kho.ban_giao_thiet_ke() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if old.trang_thai in ('bao_gia','bao_gia_treo') and new.trang_thai = 'moi_len_don'
     and new.ma_ns_thiet_ke is not null
     and exists (select 1 from kho.nguoi_dung n where n.id = new.ma_ns_thiet_ke and n.vai_tro = 'tk_ban_hang') then
    new.ma_ns_tk_ban_hang := new.ma_ns_thiet_ke;   -- ghi vết người dựng 3D báo giá
    new.ma_ns_thiet_ke := null;                    -- trả về cho_nhan cho thiết kế sản xuất
    new.luc_nhan_thiet_ke := null;
    new.buoc_thiet_ke := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_ban_giao on kho.don_hang;
create trigger trg_ban_giao before update of trang_thai on kho.don_hang
  for each row execute function kho.ban_giao_thiet_ke();

-- ════════ B. CHỜ NHẬN — lọc theo vai ở RPC (thêm cột viec → phải DROP trước) ════════
drop function if exists kho.tk_don_cho_nhan();
create or replace function kho.tk_don_cho_nhan()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric,
                trang_thai text, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean, viec text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_don_cho_nhan: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke), d.trang_thai, d.ngay_hen_khach,
    coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi'),
    case when d.trang_thai in ('bao_gia','bao_gia_treo') then 'tk_ban_hang' else 'thiet_ke' end
  from kho.don_hang d
  where d.ma_ns_thiet_ke is null
    and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke')
    -- ÉP Ở RPC: bán hàng chỉ thấy báo giá · sản xuất chỉ thấy đã-chốt · ceo+trưởng thấy cả hai
    and (case
      when v_vai = 'tk_ban_hang' then d.trang_thai in ('bao_gia','bao_gia_treo')
      when v_vai = 'thiet_ke'    then d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke')
      else true end)
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last, d.tao_luc asc nulls last;
end $$;
grant execute on function kho.tk_don_cho_nhan() to authenticated;

-- ════════ A. BẢNG CÔNG VIỆC — thêm cột "viec" (bán hàng/sản xuất) để lọc+tô màu theo VIỆC ════════
drop function if exists kho.tk_bang_cong_viec();
create or replace function kho.tk_bang_cong_viec()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, cot text,
                gio_uoc numeric, gio_thuc numeric, ai_cam text, vai_cam text,
                vong_sua integer, ngay_hen_khach date, la_demo boolean, la_mau boolean, viec text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_bang_cong_viec: chỉ ceo / thiết kế / trưởng nhóm'; end if;
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
    d.ngay_hen_khach, coalesce(d.la_demo,false), (d.loai = 'mau_moi'),
    case when d.loai = 'mau_moi' then 'mau'
         when d.trang_thai in ('bao_gia','bao_gia_treo') then 'tk_ban_hang' else 'thiet_ke' end
  from kho.don_hang d
  where d.buoc_thiet_ke is not null
     or (d.ma_ns_thiet_ke is null and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke'))
  order by d.ngay_hen_khach asc nulls last;
end $$;
grant execute on function kho.tk_bang_cong_viec() to authenticated;

-- ════════ B. NHẬN VIỆC — chặn nhận SAI việc theo vai ════════
create or replace function kho.nhan_viec_thiet_ke(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_don kho.don_hang; v_dang int; v_ten text; v_che text; v_vai text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('thiet_ke','tk_ban_hang') then
    raise exception 'CEO không nhận việc thiết kế, chỉ xem và giao việc'; end if;
  v_che := kho.tk_che_do();
  if v_che = 'giao_viec' then
    raise exception 'Kỳ này chế độ GIAO VIỆC — không tự nhận, chờ trưởng nhóm giao'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'nhan_viec_thiet_ke: không có đơn "%"', p_ma_don; end if;
  -- ĐÚNG VIỆC ĐÚNG VAI
  if v_vai = 'thiet_ke' and v_don.trang_thai in ('bao_gia','bao_gia_treo') then
    raise exception 'Đơn báo giá là việc của thiết kế bán hàng (dựng 3D), không phải thiết kế sản xuất'; end if;
  if v_vai = 'tk_ban_hang' and v_don.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke') then
    raise exception 'Đơn đã chốt là việc của thiết kế sản xuất (dựng file), không phải thiết kế bán hàng'; end if;
  if v_don.ma_ns_thiet_ke is not null then
    select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
    raise exception 'nhan_viec_thiet_ke: đơn "%" đang do % cầm', p_ma_don, coalesce(v_ten,'người khác'); end if;
  v_ns := kho.current_ns();
  select count(*) into v_dang from kho.don_hang
    where ma_ns_thiet_ke = v_ns and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  if v_dang >= 5 then
    raise exception 'nhan_viec_thiet_ke: bạn đang cầm % đơn (tối đa 5) — xong bớt rồi nhận thêm', v_dang; end if;
  update kho.don_hang
     set ma_ns_thiet_ke = v_ns, luc_nhan_thiet_ke = now(), buoc_thiet_ke = 'dang_dung',
         trang_thai = case when trang_thai = 'moi_len_don' then 'nhan_thiet_ke' else trang_thai end
   where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'buoc', 'dang_dung');
end $$;
grant execute on function kho.nhan_viec_thiet_ke(text) to authenticated;

-- ════════ C. CHI TIẾT ĐƠN — thêm "bản khách đã duyệt" (cho sản xuất dựng file cho khớp) ════════
create or replace function kho.tk_chi_tiet_don(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don kho.don_hang; v_mon jsonb; v_lich jsonb; v_ban_kd jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_chi_tiet_don: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'tk_chi_tiet_don: không có đơn "%"', p_ma_don; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'ten', m.ten, 'kt', m.kt, 'vl', m.vl, 'mau', (select s.ten from kho.mau_sac s where s.ma = m.ma_mau),
      'chi_tiet', m.chi_tiet, 'so_luong', m.so_luong, 'dung_moi', m.dung_moi) order by m.id), '[]'::jsonb)
    into v_mon from kho.don_hang_mon m where m.don_id = v_don.id;
  select coalesce(jsonb_agg(e order by (e->>'luc')), '[]'::jsonb) into v_lich from (
    select jsonb_build_object('luc', x.luc, 'viec', x.viec) e from (
      select v_don.luc_nhan_thiet_ke luc, 'Nhận việc'::text viec where v_don.luc_nhan_thiet_ke is not null
      union all
      select b.luc_gui, 'Gửi bản 3D cho sale · phiên ' || b.phien_ban from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_gui is not null
      union all
      select b.luc_phan_hoi, 'Sale: ' || case b.trang_thai when 'khach_duyet' then 'Khách duyệt' when 'khach_doi_y' then 'Khách đổi ý'
             when 'chua_dung_yeu_cau' then 'Trả về — chưa đúng yêu cầu' else b.trang_thai end
        from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_phan_hoi is not null
      union all
      select min(t.ghi_luc), 'Đẩy tem file cắt · phiên ' || t.phien_ban from kho.tem_ban_ve t where t.ma_don = p_ma_don group by t.phien_ban
    ) x where x.luc is not null
  ) y;
  -- bản KHÁCH ĐÃ DUYỆT (nếu có) + ai dựng 3D — cho thiết kế sản xuất xem để dựng file cho khớp
  select jsonb_build_object(
      'phien_ban', b.phien_ban, 'luc_duyet', b.luc_phan_hoi,
      'nguoi_ban_hang', (select ho_ten from kho.nguoi_dung where id = coalesce(v_don.ma_ns_tk_ban_hang, b.ma_ns_gui)),
      'anh', (select coalesce(jsonb_agg(a.duong_dan_to order by a.thu_tu), '[]'::jsonb) from kho.anh_ban_thiet_ke a where a.ban_id = b.id))
    into v_ban_kd
    from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet' order by b.phien_ban desc limit 1;
  return jsonb_build_object(
    'ma_don', v_don.ma_don,
    'ten', coalesce((select m.ten from kho.don_hang_mon m where m.don_id = v_don.id order by m.id limit 1), 'Đơn ' || v_don.ma_don),
    'loai', v_don.loai, 'cap_thiet_ke', v_don.cap_thiet_ke, 'buoc_thiet_ke', coalesce(v_don.buoc_thiet_ke,'cho_nhan'),
    'trang_thai', v_don.trang_thai, 'ghi_chu', v_don.ghi_chu,
    'gio_uoc', kho.gio_uoc_cap(v_don.cap_thiet_ke),
    'gio_thuc', coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = p_ma_don), 0),
    'vong_sua', (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    'ai_cam', (select n.ho_ten from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'vai_cam', (select n.vai_tro from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'ngay_hen_khach', v_don.ngay_hen_khach,
    'ban_khach_duyet', v_ban_kd,
    'mon', v_mon, 'lich_su', v_lich);
end $$;
grant execute on function kho.tk_chi_tiet_don(text) to authenticated;

commit;
