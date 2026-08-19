-- 118 — DỌN NỢ (L-51 phần A): thêm LIMIT trần cho 6 RPC nợ L-29 (danh sách không giới hạn) + DROP cột khach_sdt.
--   ⚠ IDEMPOTENT: create or replace GIỮ NGUYÊN CHỮ KÝ (không thêm param) + alter drop if exists.
--   A1 — 6 RPC nợ (docs/so_no.md §"NỢ HIỆU NĂNG L-29 VIỆC 4"): thêm `limit <trần>` BÊN TRONG, GIỮ y chữ ký gốc (zero-arg vẫn
--        zero-arg; sp_danh_sach 3-arg vẫn 3-arg). KHÔNG thêm p_gioi_han → KHÔNG sinh overload thứ hai.
--        ⚠ BÀI HỌC (đã vấp trong chính lô này): thêm `p_gioi_han int default N` tạo overload `(int,int)` SONG SONG bản `()`.
--        Các test tự-nạp-lại migration cũ (test_054/056/057 nạp db/054…) tái tạo bản `()` → gọi `f()` khớp CẢ HAI →
--        "function is not unique". Giữ chữ ký gốc + LIMIT cố định né hẳn bẫy này, và khớp chữ "giữ chữ ký" của lệnh.
--        Trần rộng (1000 đơn/việc · 2000 sp) = chặn thảm hoạ, không cắt dữ liệu thật (kỳ thật vài chục–vài trăm dòng).
--   ⚠ ket_qua_don_gia / so_sanh_don_gia (db/040): KHÔNG phải nợ — chặn cứng 12 dòng bởi MAP hoạt động. KHÔNG đụng.
--   A2 — DROP kho.don_hang.khach_sdt (cột FK master không đường ghi, luôn NULL; cột dùng thật = sdt_khach có index).
--        Reader sống DUY NHẤT = dieu_hanh_cong_no_khach (db/116) → đổi max(khach_sdt)→max(sdt_khach). Gỡ FK fk_dh_khach rồi drop.
--
-- ══════════ HOÀN TÁC ══════════
--   Chạy lại db/043/045/055/056/057/060 (6 RPC bản không-limit) + db/024 (cột khach_sdt + FK) + db/116 (dieu_hanh bản khach_sdt).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Dọn bản overload (int,int) NẾU còn sót từ lần áp thử trước lô này (idempotent) → về đúng 1 chữ ký gốc.
drop function if exists kho.xuong_don_cho_vao_chuyen(int,int);
drop function if exists kho.can_ceo_quyet(int);
drop function if exists kho.sp_danh_sach(text,text,text,int,int);
drop function if exists kho.tk_bang_cong_viec(int,int);
drop function if exists kho.tk_viec_cua_toi(int,int);
drop function if exists kho.tk_don_cho_nhan(int,int);

-- ═══════════════ A1 · THÊM LIMIT TRẦN (giữ chữ ký gốc) ═══════════════
create or replace function kho.xuong_don_cho_vao_chuyen()
  returns table(ma_don text, trang_thai text, so_mon integer, ngay_hen_khach date)
  language plpgsql stable security definer set search_path to 'kho' as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong') then
    raise exception 'xuong_don_cho_vao_chuyen: chỉ ceo/kho/xuong'; end if;
  return query
    select d.ma_don, d.trang_thai,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
      d.ngay_hen_khach
    from kho.don_hang d
    where d.trang_thai in ('moi_len_don','xong_file')
      and not exists (select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don)
    order by d.ngay_hen_khach nulls last, d.ma_don
    limit 1000;   -- L-51: trần chặn thảm hoạ (đơn chờ vào chuyền thực tế vài chục)
end $$;

create or replace function kho.can_ceo_quyet()
  returns table(loai_tinh_huong text, mo_ta text)
  language plpgsql stable security definer set search_path to 'kho' as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then
    raise exception 'can_ceo_quyet: chỉ ceo/xuong'; end if;
  -- 1. Hai đơn cùng quá hạn, cùng chờ MỘT tổ (khối duy nhất có thể nhiều dòng → trần)
  return query
  with v as (select * from kho.viec_uu_tien())
  select 'hai_qua_han_mot_to'::text,
    'Hai+ đơn quá hạn cùng chờ tổ "' || v.to_goi_y || '": ' || string_agg(v.ma_don, ', ')
  from v where v.rank_uu_tien = 1 group by v.to_goi_y having count(*) >= 2
  limit 1000;
  -- 2. Đơn gấp chen vào khi có đơn khác đang trễ (≤1 dòng)
  return query
  with v as (select * from kho.viec_uu_tien())
  select 'gap_chen_don_tre'::text,
    'Đơn gấp (' || (select string_agg(ma_don, ', ') from v where v.rank_uu_tien = 2) ||
    ') chen khi có đơn quá hạn (' || (select string_agg(ma_don, ', ') from v where v.rank_uu_tien = 1) || ')'
  where exists (select 1 from v where v.rank_uu_tien = 2)
    and exists (select 1 from v where v.rank_uu_tien = 1);
  -- 3. Món đứng yên quá 5 ngày (≤1 dòng)
  return query
  select 'mon_dung_qua_5'::text, 'Món đứng yên >5 ngày: ' || string_agg(m.ten || ' (' || m.so_ngay_dung || 'n)', ', ')
  from kho.mon_dung_yen(5) m having count(*) >= 1;
end $$;

create or replace function kho.sp_danh_sach(p_brand text, p_nhom text, p_nguon text)
  returns table(ma_ny text, ten text, brand text, brand_ten text, gia numeric, gia_von numeric, order_count integer, total_week_sold integer, la_combo boolean, ma_loi text, ma_bien_the text, nhom_hang text, nguon text, anh jsonb, vl_chua_xac_nhan boolean, kt_thieu boolean, dai_mm numeric, rong_mm numeric, cao_mm numeric, kt_nguon text, vat_lieu text, ma_vat_tu_chinh text, da_soat_tay boolean, soat_ten text, soat_luc timestamp with time zone)
  language plpgsql stable security definer set search_path to 'kho' as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'sp_danh_sach: chỉ ceo/ke_toan'; end if;
  return query
  select n.ma_ny, n.ten_ban_hang, n.ma_thuong_hieu, coalesce(th.ten_tren_web, th.ten), n.gia_niem_yet, gv.gia_von,
    n.order_count, n.total_week_sold, n.la_combo,
    s.ma_loi, s.ma, l.nhom_hang, l.nguon, n.anh,
    s.vl_chua_xac_nhan, (s.dai_mm is null and s.cao_mm is null), s.dai_mm, s.rong_mm, s.cao_mm, s.kt_nguon, coalesce(s.vl_doan, s.vat_lieu), s.ma_vat_tu_chinh,
    s.da_soat_tay, (select nd.ho_ten from kho.nguoi_dung nd where nd.id = s.soat_boi), s.soat_luc
  from kho.niem_yet n
  join kho.san_pham_mau s on s.ma = n.ma_bien_the
  left join kho.san_pham_loi l on l.ma_loi = s.ma_loi
  left join kho.thuong_hieu th on th.ma = n.ma_thuong_hieu
  left join kho.san_pham_mau_gia_von gv on gv.ma = n.ma_bien_the
  where (p_brand is null or n.ma_thuong_hieu = p_brand)
    and (p_nhom is null or l.nhom_hang = p_nhom)
    and (p_nguon is null or l.nguon = p_nguon)
  order by n.order_count desc, n.total_week_sold desc
  limit 2000;   -- L-51: trần (catalog niêm yết thực tế vài trăm)
end $$;

create or replace function kho.tk_bang_cong_viec()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, cot text, gio_uoc numeric, gio_thuc numeric, ai_cam text, vai_cam text, vong_sua integer, ngay_hen_khach date, la_demo boolean, la_mau boolean, viec text)
  language plpgsql stable security definer set search_path to 'kho' as $$
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
  order by d.ngay_hen_khach asc nulls last
  limit 1000;
end $$;

create or replace function kho.tk_viec_cua_toi()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric, gio_da_ghi numeric, buoc_thiet_ke text, trang_thai text, vong_sua integer, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean)
  language plpgsql stable security definer set search_path to 'kho' as $$
declare v_me uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_viec_cua_toi: chỉ ceo / thiết kế / trưởng nhóm'; end if;
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
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last
  limit 1000;
end $$;

create or replace function kho.tk_don_cho_nhan()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric, trang_thai text, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean, viec text)
  language plpgsql stable security definer set search_path to 'kho' as $$
declare v_ct boolean; v_cb boolean; v_ceo boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_don_cho_nhan: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  v_ct := kho.toi_co_vai('thiet_ke'); v_cb := kho.toi_co_vai('tk_ban_hang');
  v_ceo := kho.current_vai_tro() in ('ceo','truong_nhom_thiet_ke');
  return query
  select d.ma_don,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.id limit 1), 'Đơn ' || d.ma_don),
    d.loai, d.cap_thiet_ke,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
    kho.gio_uoc_cap(d.cap_thiet_ke), d.trang_thai, d.ngay_hen_khach,
    coalesce(d.danh_dau_gap,false), coalesce(d.la_demo,false), (d.loai = 'mau_moi'),
    case when d.loai = 'mau_moi' then 'mau' when d.trang_thai in ('bao_gia','bao_gia_treo') then 'tk_ban_hang' else 'thiet_ke' end
  from kho.don_hang d
  where d.ma_ns_thiet_ke is null
    and d.trang_thai in ('moi_len_don','bao_gia','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke')
    and (v_ceo or (v_cb and d.trang_thai in ('bao_gia','bao_gia_treo'))
                or (v_ct and d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke')))
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last, d.tao_luc asc nulls last
  limit 1000;
end $$;

-- ═══════════════ A2 · DROP cột khach_sdt ═══════════════
-- 1) Reader sống: dieu_hanh_cong_no_khach (db/116) đổi max(khach_sdt)→max(sdt_khach) (sdt_khach = ảnh chụp, có index idx_don_hang_sdt).
create or replace function kho.dieu_hanh_cong_no_khach(p_gioi_han int default 100) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'dieu_hanh_cong_no_khach: chỉ ceo/ke_toan'; end if;
  return (
    with pt as (select ma_don, sum(so_tien) da_thu from kho.phieu_thu group by ma_don)
    select coalesce(jsonb_agg(jsonb_build_object('khach',z.khach,'sdt',z.sdt,'tong_phai_thu',z.tong,
        'so_don',z.so_don,'lau_nhat',z.lau) order by z.tong desc),'[]'::jsonb)
    from (
      select coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, max(d.sdt_khach) sdt,
        sum(coalesce(d.gia_chot, d.doanh_thu, d.gia_cong_thuc, 0) - coalesce(pt.da_thu,0)) tong,
        count(*) so_don, max(current_date - d.ngay_giao) lau
      from kho.don_hang d left join pt on pt.ma_don=d.ma_don
      where d.ngay_giao is not null and coalesce(d.la_demo,false)=false
        and coalesce(d.gia_chot, d.doanh_thu, d.gia_cong_thuc, 0) - coalesce(pt.da_thu,0) > 0
        and not exists(select 1 from kho.giao_cod g where g.ma_don=d.ma_don and g.trang_thai='dang_giao')
      group by 1 order by 3 desc limit greatest(p_gioi_han,0)) z);
end $$;
grant execute on function kho.dieu_hanh_cong_no_khach(int) to authenticated;

-- 2) Gỡ FK rồi drop cột (không index nào trên khach_sdt; kho.khach giữ nguyên).
alter table kho.don_hang drop constraint if exists fk_dh_khach;
alter table kho.don_hang drop column if exists khach_sdt;

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='khach_sdt')
    then raise exception 'khach_sdt CHƯA drop'; end if;
  -- KHÔNG được sót overload (int,int) của 6 RPC — nếu còn là ambiguous
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='kho' and p.proname='tk_don_cho_nhan') <> 1
    then raise exception 'tk_don_cho_nhan còn overload — ambiguous'; end if;
  raise notice 'db/118 OK: LIMIT trần 6 RPC nợ L-29 (giữ chữ ký) + drop khach_sdt.';
end $$;
commit;
