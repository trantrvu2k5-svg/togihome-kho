-- 057 — Hai vai hai đích gửi · đường thứ 2 xuống xưởng · file nguồn bàn giao · người kiêm hai vai.
--   ① tk_ban_hang gửi BẢN 3D cho sale · thiet_ke gửi FILE SẢN XUẤT cho xưởng — nút theo LOẠI ĐƠN.
--   ② file_san_xuat + bucket 'file-san-xuat' + gui_file_san_xuat (đường 2 xuống xưởng, song song plugin).
--   ③ file NGUỒN đính kèm bản 3D (dùng file_3d_path/byte sẵn có, CHECK ≤100MB) + ty_le_dung_lai_ban_3d.
--   ④ vai_phu: người kiêm thiet_ke+tk_ban_hang — nhận cả hai, giờ theo ĐƠN, không bàn giao khi cùng người.
--   THIẾT KẾ SẢN XUẤT = thiet_ke · THIẾT KẾ BÁN HÀNG = tk_ban_hang.
--   node ops/run_sql.mjs ../db/057_hai_vai_file_xuong.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.ty_le_dung_lai_ban_3d(text); drop function if exists kho.gui_file_san_xuat(text,jsonb,text);
--   drop function if exists kho.tk_vai_cua_toi(); drop function if exists kho.toi_co_vai(text); drop function if exists kho.co_vai(uuid,text);
--   drop trigger if exists trg_ban_giao on kho.don_hang; drop function if exists kho.ban_giao_thiet_ke();
--   drop table if exists kho.file_san_xuat; drop table if exists kho.vai_phu;
--   delete from storage.objects where bucket_id='file-san-xuat'; delete from storage.buckets where id='file-san-xuat';
--   -- gui_ban_thiet_ke/ghi_gio/nhan_viec/tk_don_cho_nhan/tk_chi_tiet_don/tt_*: khôi phục bản db/053-056 (git).
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ ④a VAI PHỤ + helper co_vai ════════
create table if not exists kho.vai_phu (
  ma_ns uuid not null references kho.nguoi_dung(id) on delete cascade,
  vai_them text not null check (vai_them in ('thiet_ke','tk_ban_hang')),
  primary key (ma_ns, vai_them)
);
alter table kho.vai_phu enable row level security;
drop policy if exists vp_doc on kho.vai_phu;
create policy vp_doc on kho.vai_phu for select using (kho.current_vai_tro() = any (array['ceo','truong_nhom_thiet_ke','thiet_ke','tk_ban_hang','kho']));

create or replace function kho.co_vai(p_ns uuid, p_vai text) returns boolean language sql stable security definer set search_path = kho as $$
  select exists (select 1 from kho.nguoi_dung n where n.id = p_ns and n.vai_tro = p_vai)
      or exists (select 1 from kho.vai_phu v where v.ma_ns = p_ns and v.vai_them = p_vai) $$;
create or replace function kho.toi_co_vai(p_vai text) returns boolean language sql stable security definer set search_path = kho as $$
  select kho.co_vai(kho.current_ns(), p_vai) $$;
grant execute on function kho.toi_co_vai(text) to authenticated;

-- vai hiệu lực của người đang gọi (base + phụ) — app dùng để chọn nút
create or replace function kho.tk_vai_cua_toi()
  returns jsonb language sql stable security definer set search_path = kho as $$
  select jsonb_build_object('thiet_ke', kho.toi_co_vai('thiet_ke'), 'tk_ban_hang', kho.toi_co_vai('tk_ban_hang'),
                            'vai_chinh', kho.current_vai_tro()) $$;
grant execute on function kho.tk_vai_cua_toi() to authenticated;

-- ════════ ② FILE SẢN XUẤT (đường 2 xuống xưởng) ════════
create table if not exists kho.file_san_xuat (
  id uuid primary key default gen_random_uuid(),
  ma_don text not null,
  loai_file text not null check (loai_file in ('dxf','cutlist','anh_ban_ve','khac')),
  duong_dan text not null,
  ten_goc text,
  co_byte bigint,
  ma_ns_gui uuid references kho.nguoi_dung(id),
  luc_gui timestamptz not null default now(),
  ghi_chu text
);
alter table kho.file_san_xuat enable row level security;
drop policy if exists fsx_doc on kho.file_san_xuat;
create policy fsx_doc on kho.file_san_xuat for select using (kho.current_vai_tro() = any (array['xuong','tho','ceo','kho']));  -- sale KHÔNG
drop policy if exists fsx_ghi on kho.file_san_xuat;
create policy fsx_ghi on kho.file_san_xuat for insert with check (kho.current_vai_tro() = any (array['ceo','kho','thiet_ke']));

-- bucket private + policy trên storage.objects
insert into storage.buckets (id, name, public) values ('file-san-xuat','file-san-xuat', false)
  on conflict (id) do nothing;
drop policy if exists fsx_obj_doc on storage.objects;
create policy fsx_obj_doc on storage.objects for select to authenticated
  using (bucket_id = 'file-san-xuat' and kho.current_vai_tro() = any (array['xuong','tho','ceo','kho']));
drop policy if exists fsx_obj_ghi on storage.objects;
create policy fsx_obj_ghi on storage.objects for insert to authenticated
  with check (bucket_id = 'file-san-xuat' and kho.current_vai_tro() = any (array['ceo','kho','thiet_ke']));
drop policy if exists fsx_obj_sua on storage.objects;   -- upload(upsert:true) cần UPDATE policy (như bucket ban-thiet-ke)
create policy fsx_obj_sua on storage.objects for update to authenticated
  using (bucket_id = 'file-san-xuat' and kho.current_vai_tro() = any (array['ceo','kho','thiet_ke']))
  with check (bucket_id = 'file-san-xuat' and kho.current_vai_tro() = any (array['ceo','kho','thiet_ke']));

-- RPC gửi file sản xuất — cùng luật cổng cắt như đẩy tem (db/051)
create or replace function kho.gui_file_san_xuat(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau_san boolean; f jsonb; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','kho','thiet_ke') then
    raise exception 'gui_file_san_xuat: chỉ ceo/kho/thiết kế sản xuất'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'gui_file_san_xuat: không có đơn "%"', p_ma_don; end if;
  -- [QUY ĐÚNG NGƯỜI] chỉ người cầm (ma_ns_thiet_ke) hoặc ceo/kho
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'gui_file_san_xuat: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'gui_file_san_xuat: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'gui_file_san_xuat: phải có ít nhất 1 file'; end if;
  -- [CỔNG KHOÁ CẮT] khách chưa duyệt bản → chưa được gửi file (trừ le mẫu sẵn)
  v_le_mau_san := (v_don.dong = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'gui_file_san_xuat: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được gửi file.', p_ma_don; end if;
  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'so_file', n);
end $$;
grant execute on function kho.gui_file_san_xuat(text,jsonb,text) to authenticated;

-- đọc file sản xuất của đơn (cho app xưởng — panel món)
create or replace function kho.xuong_file_cua_don(p_ma_don text)
  returns table(id uuid, loai_file text, duong_dan text, ten_goc text, co_byte bigint, luc_gui timestamptz, ghi_chu text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('xuong','tho','ceo','kho') then
    raise exception 'xuong_file_cua_don: chỉ xưởng/thợ/ceo/kho'; end if;
  return query select f.id, f.loai_file, f.duong_dan, f.ten_goc, f.co_byte, f.luc_gui, f.ghi_chu
    from kho.file_san_xuat f where f.ma_don = p_ma_don order by f.luc_gui;
end $$;
grant execute on function kho.xuong_file_cua_don(text) to authenticated;

-- ════════ ③ GỬI BẢN 3D + FILE NGUỒN (tuỳ chọn) — dùng file_3d_path/byte sẵn có ════════
drop function if exists kho.gui_ban_thiet_ke(text,text,jsonb);
create or replace function kho.gui_ban_thiet_ke(p_ma_don text, p_ghi_chu text, p_anh jsonb, p_file_nguon jsonb default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_pb integer; v_ban uuid; a jsonb; i int := 0;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then
    raise exception 'gui_ban_thiet_ke: chỉ ceo / thiết kế sản xuất / thiết kế bán hàng'; end if;
  if not exists (select 1 from kho.don_hang where ma_don = p_ma_don) then
    raise exception 'gui_ban_thiet_ke: không có đơn "%"', p_ma_don; end if;
  if p_anh is null or jsonb_typeof(p_anh) <> 'array' or jsonb_array_length(p_anh) = 0 then
    raise exception 'gui_ban_thiet_ke: phải có ít nhất 1 ảnh'; end if;
  select id into v_ns from kho.nguoi_dung where auth_uid = auth.uid();
  select coalesce(max(phien_ban),0)+1 into v_pb from kho.ban_thiet_ke where ma_don = p_ma_don;
  insert into kho.ban_thiet_ke(ma_don, phien_ban, ma_ns_gui, ghi_chu, trang_thai, file_3d_path, file_3d_byte)
    values (p_ma_don, v_pb, v_ns, p_ghi_chu, 'cho_duyet',
            p_file_nguon->>'duong_dan', (p_file_nguon->>'byte')::bigint) returning id into v_ban;   -- file NGUỒN
  for a in select * from jsonb_array_elements(p_anh) loop
    insert into kho.anh_ban_thiet_ke(ban_id, duong_dan_nho, duong_dan_to, byte_nho, byte_to, thu_tu)
      values (v_ban, a->>'duong_dan_nho', a->>'duong_dan_to',
              (a->>'byte_nho')::bigint, (a->>'byte_to')::bigint, coalesce((a->>'thu_tu')::int, i));
    i := i + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'cho_duyet' where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ban_id', v_ban, 'phien_ban', v_pb, 'so_anh', jsonb_array_length(p_anh),
                            'co_file_nguon', (p_file_nguon->>'duong_dan') is not null);
end $$;
grant execute on function kho.gui_ban_thiet_ke(text,text,jsonb,jsonb) to authenticated;

-- % đơn ĐÃ BÀN GIAO (có người dựng 3D) mà bản khách duyệt CÓ file nguồn — đo chuyện "dựng hai lần"
create or replace function kho.ty_le_dung_lai_ban_3d(p_ma_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_tong int; v_co int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','truong_nhom_thiet_ke','thiet_ke','tk_ban_hang') then
    raise exception 'ty_le_dung_lai_ban_3d: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  select count(*),
         count(*) filter (where exists (select 1 from kho.ban_thiet_ke b
                          where b.ma_don = d.ma_don and b.trang_thai = 'khach_duyet' and b.file_3d_path is not null))
    into v_tong, v_co
  from kho.don_hang d where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and d.ma_ns_tk_ban_hang is not null;
  return jsonb_build_object('so_don_ban_giao', v_tong, 'co_file_nguon', v_co,
    'ty_le', case when v_tong > 0 then round(100.0 * v_co / v_tong, 0) else null end);
end $$;
grant execute on function kho.ty_le_dung_lai_ban_3d(text) to authenticated;

-- ════════ ④b GHI GIỜ — loai_gio theo TRẠNG THÁI ĐƠN (không theo vai; đúng cho người kiêm) ════════
create or replace function kho.ghi_gio_thiet_ke(p_ma_don text, p_so_gio numeric)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_loai text; v_ns uuid; v_cap text; v_tt text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if not (kho.toi_co_vai('thiet_ke') or kho.toi_co_vai('tk_ban_hang')) then
    raise exception 'ghi_gio_thiet_ke: chỉ thiết kế sản xuất / thiết kế bán hàng'; end if;
  if p_so_gio is null or p_so_gio < 0 then raise exception 'ghi_gio_thiet_ke: số giờ không hợp lệ'; end if;
  select cap_thiet_ke, trang_thai into v_cap, v_tt from kho.don_hang where ma_don = p_ma_don;
  if v_tt is null then raise exception 'ghi_gio_thiet_ke: không có đơn "%"', p_ma_don; end if;
  -- loai_gio suy từ ĐƠN: báo giá → ban_hang (dựng 3D) · đã chốt → xuong (dựng file)
  v_loai := case when v_tt in ('bao_gia','bao_gia_treo') then 'ban_hang' else 'xuong' end;
  v_ns := kho.current_ns();
  insert into kho.gio_thiet_ke_thuc(ma_don, ma_ns, loai_gio, gio_thuc, cap)
    values (p_ma_don, v_ns, v_loai, p_so_gio, v_cap);
  return jsonb_build_object('ok', true, 'loai_gio', v_loai, 'gio', p_so_gio);
end $$;
grant execute on function kho.ghi_gio_thiet_ke(text,numeric) to authenticated;

-- ════════ ④c NHẬN VIỆC — chặn theo NĂNG LỰC (co_vai), người kiêm nhận cả hai ════════
create or replace function kho.nhan_viec_thiet_ke(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_ns uuid; v_don kho.don_hang; v_dang int; v_ten text; v_che text; v_vai text;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if not (kho.toi_co_vai('thiet_ke') or kho.toi_co_vai('tk_ban_hang')) then
    raise exception 'CEO không nhận việc thiết kế, chỉ xem và giao việc'; end if;
  v_che := kho.tk_che_do();
  if v_che = 'giao_viec' then
    raise exception 'Kỳ này chế độ GIAO VIỆC — không tự nhận, chờ trưởng nhóm giao'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'nhan_viec_thiet_ke: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  -- ĐÚNG VIỆC ĐÚNG NĂNG LỰC (người kiêm hai vai qua được cả hai)
  if v_don.trang_thai in ('bao_gia','bao_gia_treo') and not kho.co_vai(v_ns,'tk_ban_hang') then
    raise exception 'Đơn báo giá là việc của thiết kế bán hàng (dựng 3D)'; end if;
  if v_don.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke') and not kho.co_vai(v_ns,'thiet_ke') then
    raise exception 'Đơn đã chốt là việc của thiết kế sản xuất (dựng file)'; end if;
  if v_don.ma_ns_thiet_ke is not null then
    select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
    raise exception 'nhan_viec_thiet_ke: đơn "%" đang do % cầm', p_ma_don, coalesce(v_ten,'người khác'); end if;
  select count(*) into v_dang from kho.don_hang where ma_ns_thiet_ke = v_ns and coalesce(buoc_thiet_ke,'') <> 'xong_file';
  if v_dang >= 5 then raise exception 'nhan_viec_thiet_ke: bạn đang cầm % đơn (tối đa 5) — xong bớt rồi nhận thêm', v_dang; end if;
  update kho.don_hang
     set ma_ns_thiet_ke = v_ns, luc_nhan_thiet_ke = now(), buoc_thiet_ke = 'dang_dung',
         trang_thai = case when trang_thai = 'moi_len_don' then 'nhan_thiet_ke' else trang_thai end
   where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'buoc', 'dang_dung');
end $$;
grant execute on function kho.nhan_viec_thiet_ke(text) to authenticated;

-- ════════ ④d CHỜ NHẬN — lọc theo NĂNG LỰC (người kiêm thấy cả hai) ════════
drop function if exists kho.tk_don_cho_nhan();
create or replace function kho.tk_don_cho_nhan()
  returns table(ma_don text, ten text, loai text, cap_thiet_ke text, so_mon integer, gio_uoc numeric,
                trang_thai text, ngay_hen_khach date, danh_dau_gap boolean, la_demo boolean, la_mau boolean, viec text)
  language plpgsql stable security definer set search_path = kho as $$
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
  order by coalesce(d.danh_dau_gap,false) desc, d.ngay_hen_khach asc nulls last, d.tao_luc asc nulls last;
end $$;
grant execute on function kho.tk_don_cho_nhan() to authenticated;

-- ════════ ④e BÀN GIAO — GIỮ người cầm nếu họ CÓ vai thiet_ke (kiêm), else bàn giao ════════
create or replace function kho.ban_giao_thiet_ke() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if old.trang_thai in ('bao_gia','bao_gia_treo') and new.trang_thai = 'moi_len_don' and new.ma_ns_thiet_ke is not null then
    new.ma_ns_tk_ban_hang := new.ma_ns_thiet_ke;                 -- luôn ghi vết người dựng 3D
    if not kho.co_vai(new.ma_ns_thiet_ke, 'thiet_ke') then       -- KHÔNG kiêm sản xuất → bàn giao
      new.ma_ns_thiet_ke := null; new.luc_nhan_thiet_ke := null; new.buoc_thiet_ke := null;
    end if;                                                       -- KIÊM → giữ nguyên, dựng tiếp file
  end if;
  return new;
end $$;
drop trigger if exists trg_ban_giao on kho.don_hang;
create trigger trg_ban_giao before update of trang_thai on kho.don_hang for each row execute function kho.ban_giao_thiet_ke();

-- ════════ ⑤ CHI TIẾT ĐƠN — thêm cờ hành động cho panel ════════
create or replace function kho.tk_chi_tiet_don(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don kho.don_hang; v_mon jsonb; v_lich jsonb; v_ban_kd jsonb; v_ns uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke') then
    raise exception 'tk_chi_tiet_don: chỉ ceo / thiết kế / trưởng nhóm'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'tk_chi_tiet_don: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  select coalesce(jsonb_agg(jsonb_build_object(
      'ten', m.ten, 'kt', m.kt, 'vl', m.vl, 'mau', (select s.ten from kho.mau_sac s where s.ma = m.ma_mau),
      'chi_tiet', m.chi_tiet, 'so_luong', m.so_luong, 'dung_moi', m.dung_moi) order by m.id), '[]'::jsonb)
    into v_mon from kho.don_hang_mon m where m.don_id = v_don.id;
  select coalesce(jsonb_agg(e order by (e->>'luc')), '[]'::jsonb) into v_lich from (
    select jsonb_build_object('luc', x.luc, 'viec', x.viec) e from (
      select v_don.luc_nhan_thiet_ke luc, 'Nhận việc'::text viec where v_don.luc_nhan_thiet_ke is not null
      union all select b.luc_gui, 'Gửi bản 3D cho sale · phiên ' || b.phien_ban from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_gui is not null
      union all select b.luc_phan_hoi, 'Sale: ' || case b.trang_thai when 'khach_duyet' then 'Khách duyệt' when 'khach_doi_y' then 'Khách đổi ý'
             when 'chua_dung_yeu_cau' then 'Trả về — chưa đúng yêu cầu' else b.trang_thai end
        from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.luc_phan_hoi is not null
      union all select f.luc_gui, 'Gửi file sản xuất cho xưởng (' || f.loai_file || ')' from kho.file_san_xuat f where f.ma_don = p_ma_don
      union all select min(t.ghi_luc), 'Đẩy tem file cắt · phiên ' || t.phien_ban from kho.tem_ban_ve t where t.ma_don = p_ma_don group by t.phien_ban
    ) x where x.luc is not null
  ) y;
  select jsonb_build_object('phien_ban', b.phien_ban, 'luc_duyet', b.luc_phan_hoi,
      'nguoi_ban_hang', (select ho_ten from kho.nguoi_dung where id = coalesce(v_don.ma_ns_tk_ban_hang, b.ma_ns_gui)),
      'file_nguon', case when b.file_3d_path is not null then jsonb_build_object('duong_dan', b.file_3d_path, 'byte', b.file_3d_byte) else null end,
      'anh', (select coalesce(jsonb_agg(a.duong_dan_to order by a.thu_tu), '[]'::jsonb) from kho.anh_ban_thiet_ke a where a.ban_id = b.id))
    into v_ban_kd from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet' order by b.phien_ban desc limit 1;
  return jsonb_build_object(
    'ma_don', v_don.ma_don,
    'ten', coalesce((select m.ten from kho.don_hang_mon m where m.don_id = v_don.id order by m.id limit 1), 'Đơn ' || v_don.ma_don),
    'loai', v_don.loai, 'cap_thiet_ke', v_don.cap_thiet_ke, 'buoc_thiet_ke', coalesce(v_don.buoc_thiet_ke,'cho_nhan'),
    'trang_thai', v_don.trang_thai, 'ghi_chu', v_don.ghi_chu,
    'viec', case when v_don.loai = 'mau_moi' then 'mau' when v_don.trang_thai in ('bao_gia','bao_gia_treo') then 'tk_ban_hang' else 'thiet_ke' end,
    'la_bao_gia', v_don.trang_thai in ('bao_gia','bao_gia_treo'),
    'gio_uoc', kho.gio_uoc_cap(v_don.cap_thiet_ke),
    'gio_thuc', coalesce((select sum(g.gio_thuc) from kho.gio_thiet_ke_thuc g where g.ma_don = p_ma_don), 0),
    'vong_sua', (select count(*)::int from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y')),
    'ai_cam', (select n.ho_ten from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'vai_cam', (select n.vai_tro from kho.nguoi_dung n where n.id = v_don.ma_ns_thiet_ke),
    'la_toi_cam', v_don.ma_ns_thiet_ke = v_ns,
    'sale_ghi_chu', (select b.ghi_chu_phan_hoi from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai in ('chua_dung_yeu_cau','khach_doi_y') order by b.luc_phan_hoi desc nulls last limit 1),
    'da_gui_xuong', exists (select 1 from kho.file_san_xuat f where f.ma_don = p_ma_don),
    'ngay_hen_khach', v_don.ngay_hen_khach,
    'ban_khach_duyet', v_ban_kd,
    'mon', v_mon, 'lich_su', v_lich);
end $$;
grant execute on function kho.tk_chi_tiet_don(text) to authenticated;

-- ════════ ④f THÀNH TÍCH — dùng co_vai; người kiêm hiện ở CẢ HAI bảng ════════
create or replace function kho.tt_thiet_ke_xuong(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, viec_xong_chuan_hoa numeric, file_dung_lan_dau_pct numeric,
                loi_do_file_bat integer, uoc_lech_gio_tb numeric, so_don_can_cu integer, du_tin boolean, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','truong_nhom_thiet_ke') and not kho.toi_co_vai('thiet_ke') then
    raise exception 'tt_thiet_ke_xuong: chỉ ceo / thiết kế sản xuất / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  return query
  with base as (
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, n.id ns, n.ho_ten
    from kho.don_hang d join kho.nguoi_dung n on n.id = d.ma_ns_thiet_ke and kho.co_vai(n.id,'thiet_ke')
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false and (v_het or d.ma_ns_thiet_ke = v_me)
  )
  select b.ns, b.ho_ten,
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where mx = 1) / count(*), 1) end
       from (select t.ma_don, max(t.phien_ban) mx from kho.tem_ban_ve t where t.ma_don in (select ma_don from base bb where bb.ns = b.ns) group by t.ma_don) s),
    (select count(*)::int from kho.loi_lam_lai l where l.do_file and l.ma_ns_thiet_ke = b.ns and l.ma_don in (select ma_don from base b2 where b2.ns = b.ns)),
    (select round(avg(gt.gio - kho.gio_uoc_cap(bb.cap_thiet_ke)), 2)
       from base bb join lateral (select sum(g.gio_thuc) gio from kho.gio_thiet_ke_thuc g where g.ma_don = bb.ma_don and g.loai_gio = 'xuong') gt on true
       where bb.ns = b.ns and gt.gio is not null),
    count(*) filter (where b.buoc_thiet_ke = 'xong_file')::int,
    count(*) filter (where b.buoc_thiet_ke = 'xong_file') >= 5,
    case when count(*) filter (where b.buoc_thiet_ke = 'xong_file') < 5
         then 'Chưa đủ đơn để tin (' || count(*) filter (where b.buoc_thiet_ke = 'xong_file') || '/5)' else null end
  from base b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_xuong(text) to authenticated;

create or replace function kho.tt_thiet_ke_ban_hang(p_ma_ky text)
  returns table(ma_ns uuid, ho_ten text, ra_phuong_an_dau_gio numeric, sale_tra_ve_hieu_sai integer,
                viec_xong_chuan_hoa numeric, ty_le_khach_chot numeric, so_don_can_cu integer,
                du_tin boolean, canh_bao text, xep_hang_ty_le text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_me uuid; v_het boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','tk_ban_hang','truong_nhom_thiet_ke') and not kho.toi_co_vai('tk_ban_hang') then
    raise exception 'tt_thiet_ke_ban_hang: chỉ ceo / thiết kế bán hàng / trưởng nhóm'; end if;
  v_me := kho.current_ns(); v_het := kho.tk_xem_het();
  return query
  with base as (   -- người BÁN HÀNG của đơn = ma_ns_tk_ban_hang (đã bàn giao/ghi vết) HOẶC người cầm khi còn bao_gia
    select d.ma_don, d.cap_thiet_ke, d.buoc_thiet_ke, d.luc_nhan_thiet_ke,
      coalesce(d.ma_ns_tk_ban_hang, case when d.trang_thai in ('bao_gia','bao_gia_treo') then d.ma_ns_thiet_ke end) bh
    from kho.don_hang d
    where d.ma_ky_ap_dung = p_ma_ky and coalesce(d.la_demo,false) = false
  ), based as (
    select b.*, n.id ns, n.ho_ten from base b join kho.nguoi_dung n on n.id = b.bh and kho.co_vai(n.id,'tk_ban_hang')
    where (v_het or b.bh = v_me)
  )
  select b.ns, b.ho_ten,
    (select round(avg(extract(epoch from (fg.luc - bb.luc_nhan_thiet_ke)) / 3600.0), 2)
       from based bb join lateral (select min(x.luc_gui) luc from kho.ban_thiet_ke x where x.ma_don = bb.ma_don) fg on true
       where bb.ns = b.ns and bb.luc_nhan_thiet_ke is not null and fg.luc is not null),
    (select count(*)::int from kho.ban_thiet_ke bt where bt.trang_thai = 'chua_dung_yeu_cau' and bt.ma_don in (select ma_don from based b2 where b2.ns = b.ns)),
    coalesce(sum(kho.gio_uoc_cap(b.cap_thiet_ke)) filter (where b.buoc_thiet_ke = 'xong_file'), 0)::numeric,
    (select round(100.0 * count(distinct case when exists(select 1 from kho.ban_thiet_ke bt2 where bt2.ma_don = bb.ma_don and bt2.trang_thai = 'khach_duyet') then bb.ma_don end)
          / nullif(count(distinct bb.ma_don),0), 1) from based bb where bb.ns = b.ns),
    count(distinct b.ma_don)::int, count(distinct b.ma_don) >= 5,
    case when count(distinct b.ma_don) < 5 then 'Chưa đủ đơn để tin (' || count(distinct b.ma_don) || '/5)' else null end,
    'KHONG_XEP_HANG'
  from based b group by b.ns, b.ho_ten;
end $$;
grant execute on function kho.tt_thiet_ke_ban_hang(text) to authenticated;

commit;
