-- db/107 — L-78 PHẦN B: THƯ VIỆN BẢN THIẾT KẾ. Idempotent.
--   Nhãn = SUY TỰ ĐỘNG (RPC, không cột trùng) + 2 ô tay tối thiểu (mau_chu_dao, vat_lieu_chinh) + cờ an_thu_vien.
--   thu_vien_ban: lọc+phân trang, ẨN tên/sđt khách, loại bản an_thu_vien. ghi_dung_lai_ban: đường vào dung_lai_ban (v-kho-46).
-- ═════ HOÀN TÁC: alter drop 3 cột; chạy lại db/051 gui_ban_thiet_ke; drop thu_vien_ban, ghi_dung_lai_ban. ═════
begin;

-- ── B1 · cột nhãn tay + cờ ẩn ──
alter table kho.ban_thiet_ke add column if not exists mau_chu_dao   text;
alter table kho.ban_thiet_ke add column if not exists vat_lieu_chinh text;
alter table kho.ban_thiet_ke add column if not exists an_thu_vien   boolean not null default false;

-- ── gui_ban_thiet_ke: +3 tham số (đổi chữ ký → drop bản 4-tham số) — lưu 2 nhãn tay + cờ ẩn ──
drop function if exists kho.gui_ban_thiet_ke(text, text, jsonb, jsonb);
create or replace function kho.gui_ban_thiet_ke(p_ma_don text, p_ghi_chu text, p_anh jsonb, p_file_nguon jsonb default null,
    p_mau text default null, p_vat_lieu text default null, p_an_thu_vien boolean default false)
  returns jsonb language plpgsql security definer set search_path to 'kho' as $fn$
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
  insert into kho.ban_thiet_ke(ma_don, phien_ban, ma_ns_gui, ghi_chu, trang_thai, file_3d_path, file_3d_byte, mau_chu_dao, vat_lieu_chinh, an_thu_vien)
    values (p_ma_don, v_pb, v_ns, p_ghi_chu, 'cho_duyet', p_file_nguon->>'duong_dan', (p_file_nguon->>'byte')::bigint,
            nullif(btrim(p_mau),''), nullif(btrim(p_vat_lieu),''), coalesce(p_an_thu_vien,false)) returning id into v_ban;
  for a in select * from jsonb_array_elements(p_anh) loop
    insert into kho.anh_ban_thiet_ke(ban_id, duong_dan_nho, duong_dan_to, byte_nho, byte_to, thu_tu)
      values (v_ban, a->>'duong_dan_nho', a->>'duong_dan_to', (a->>'byte_nho')::bigint, (a->>'byte_to')::bigint, coalesce((a->>'thu_tu')::int, i));
    i := i + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'cho_duyet' where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ban_id', v_ban, 'phien_ban', v_pb, 'so_anh', jsonb_array_length(p_anh));
end $fn$;
grant execute on function kho.gui_ban_thiet_ke(text,text,jsonb,jsonb,text,text,boolean) to authenticated;

-- ── B2 · thu_vien_ban: thư viện bản (nhãn suy tự động) — ẨN tên/sđt khách, loại bản an_thu_vien ──
create or replace function kho.thu_vien_ban(
    p_chi_duyet boolean default true, p_loai_mon text default null, p_phong_cach text default null,
    p_mau text default null, p_vat_lieu text default null, p_nguoi uuid default null, p_trang_thai text default null,
    p_tu_khoa text default null, p_sap text default 'moi', p_gioi_han int default 40, p_offset int default 0)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tong int; v_ds jsonb;
begin
  if v_vai not in ('sale','tk_ban_hang','thiet_ke','truong_nhom_sale','truong_nhom_thiet_ke','ceo') then
    raise exception 'thu_vien_ban: chỉ sale/thiết kế/trưởng nhóm/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  with base as (
    select b.id ban_id, b.ma_don, b.trang_thai, b.ma_ns_gui, b.luc_gui, b.mau_chu_dao, b.vat_lieu_chinh,
      d.phong_cach, d.ngan_sach_trieu,
      (select count(*)::int from kho.ban_thiet_ke b2 where b2.ma_don=b.ma_don and b2.trang_thai in ('khach_doi_y','chua_dung_yeu_cau')) vong_sua,
      (select ho_ten from kho.nguoi_dung n where n.id=b.ma_ns_gui) nguoi_dung,
      (select duong_dan_nho from kho.anh_ban_thiet_ke a where a.ban_id=b.id order by a.thu_tu, a.id limit 1) anh,
      (select m.ten from kho.don_hang_mon m where m.don_id=d.id order by m.id limit 1) ten_mon,
      (select count(*)::int from kho.don_hang_mon m where m.don_id=d.id) so_mon,
      (select l.dong_id from kho.don_hang_mon m join kho.san_pham_mau sm on sm.ma=m.sp_id join kho.san_pham_loi l on l.ma_loi=sm.ma_loi where m.don_id=d.id and m.sp_id is not null order by m.id limit 1) dong
    from kho.ban_thiet_ke b join kho.don_hang d on d.ma_don=b.ma_don
    where coalesce(b.an_thu_vien,false)=false and coalesce(d.la_demo,false)=false
      and (not p_chi_duyet or b.trang_thai='khach_duyet')
  ), loc as (
    select * from base where
        (p_loai_mon   is null or dong = p_loai_mon)
    and (p_phong_cach is null or phong_cach = p_phong_cach)
    and (p_mau        is null or mau_chu_dao = p_mau)
    and (p_vat_lieu   is null or vat_lieu_chinh = p_vat_lieu)
    and (p_nguoi      is null or ma_ns_gui = p_nguoi)
    and (p_trang_thai is null or trang_thai = p_trang_thai)
    and (p_tu_khoa    is null or coalesce(ten_mon,'') ilike '%'||p_tu_khoa||'%')
  ), sx as (
    select *, row_number() over (order by
        case when p_sap='it_sua' then vong_sua end asc nulls last,
        luc_gui desc nulls last, ban_id desc) rn
    from loc
  )
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object(
      'ban_id', ban_id, 'ma_don', ma_don, 'trang_thai', trang_thai, 'anh', anh, 'vong_sua', vong_sua,
      'phong_cach', phong_cach, 'ngan_sach_trieu', ngan_sach_trieu, 'mau_chu_dao', mau_chu_dao, 'vat_lieu_chinh', vat_lieu_chinh,
      'nguoi_dung', nguoi_dung, 'ten_mon', ten_mon, 'so_mon', so_mon, 'dong', dong)
      order by rn) filter (where rn > p_offset and rn <= p_offset + greatest(p_gioi_han,0)), '[]'::jsonb)
    into v_tong, v_ds from sx;
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'offset', greatest(p_offset,0));  -- KHÔNG có ten_khach/sdt
end $$;
grant execute on function kho.thu_vien_ban(boolean,text,text,text,text,uuid,text,text,text,int,int) to authenticated;

-- ── B3 · ghi_dung_lai_ban: đường vào dung_lai_ban (v-kho-46, lần đầu có người dùng) ──
drop function if exists kho.ghi_dung_lai_ban(uuid, uuid, text);
create or replace function kho.ghi_dung_lai_ban(p_ban_id uuid, p_ma_don_moi text, p_sua_gi text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ma_don text; v_mon_goc uuid; v_mon_moi uuid; v_don_moi uuid; v_tt text;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom_thiet_ke','ceo') then
    raise exception 'ghi_dung_lai_ban: chỉ thiết kế (SX/bán hàng)/trưởng nhóm TK/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select ma_don into v_ma_don from kho.ban_thiet_ke where id = p_ban_id;
  if v_ma_don is null then raise exception 'ghi_dung_lai_ban: không có bản %', p_ban_id; end if;
  select m.id into v_mon_goc from kho.don_hang_mon m join kho.don_hang d on d.id=m.don_id where d.ma_don=v_ma_don order by m.id limit 1;
  if v_mon_goc is null then raise exception 'ghi_dung_lai_ban: đơn bản gốc chưa có món'; end if;
  -- món MỚI = món đầu của ĐƠN đang cầm (p_ma_don_moi)
  select m.id, d.id, d.trang_thai into v_mon_moi, v_don_moi, v_tt from kho.don_hang_mon m join kho.don_hang d on d.id=m.don_id where d.ma_don=p_ma_don_moi order by m.id limit 1;
  if v_mon_moi is null then raise exception 'ghi_dung_lai_ban: đơn "%" chưa có món để gắn', p_ma_don_moi; end if;
  insert into kho.dung_lai_ban(mon_id_goc, mon_id_moi, sua_gi) values (v_mon_goc, v_mon_moi, nullif(btrim(p_sua_gi),''));
  insert into kho.don_hang_nhat_ky(don_id, tu, den, nguoi_id, ly_do)
    values (v_don_moi, v_tt, v_tt, kho.current_ns(), 'Dựng lại từ bản đơn '||v_ma_don||coalesce(' · '||nullif(btrim(p_sua_gi),''),''));
  return jsonb_build_object('ok', true, 'ban_goc_don', v_ma_don, 'don_moi', p_ma_don_moi);
end $$;
grant execute on function kho.ghi_dung_lai_ban(uuid,text,text) to authenticated;

do $$ begin
  if to_regprocedure('kho.thu_vien_ban(boolean,text,text,text,text,uuid,text,text,text,int,int)') is null then raise exception 'THIẾU thu_vien_ban'; end if;
  raise notice 'db/107 OK: cột nhãn+cờ ẩn + gui_ban_thiet_ke(+3) + thu_vien_ban + ghi_dung_lai_ban.';
end $$;
commit;
