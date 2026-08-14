-- 070 — BA MỐC số đơn vị: du_kien / chuan / thuc_te (QD-15). THUẦN DB.
-- CẢNH BÁO: migration này KHÔNG idempotent (đổi PK + chuyển dữ liệu). Chạy MỘT lần duy nhất.
--   Chạy: cd web && node ops/run_sql.mjs ../db/070_ba_moc.sql
-- ══════════ HOÀN TÁC: khôi phục từ backup (đổi khoá không có đường lùi sạch) ══════════
begin;

-- ─────────── VIỆC 1 · thêm cột moc + đổi khoá (mon_id,hoat_dong) → (mon_id,hoat_dong,moc) ───────────
do $$ declare v_truoc int; begin
  select count(*) into v_truoc from kho.so_don_vi_mon;
  raise notice 'so_don_vi_mon TRƯỚC migration: % dòng', v_truoc;
end $$;

alter table kho.so_don_vi_mon add column if not exists moc text not null default 'chuan'
  check (moc in ('du_kien','chuan','thuc_te'));
-- dữ liệu cũ = số thiết kế sản xuất đã nhập → mốc 'chuan' (default đã gán); nói rõ:
update kho.so_don_vi_mon set moc = 'chuan' where moc is null or moc = '';

-- ─────────── VIỆC 2 · cột hỏng / làm lại (chỉ có nghĩa với thuc_te) ───────────
alter table kho.so_don_vi_mon add column if not exists so_hong    numeric not null default 0 check (so_hong >= 0);
alter table kho.so_don_vi_mon add column if not exists so_lam_lai numeric not null default 0 check (so_lam_lai >= 0);
--   moc <> 'thuc_te' mà có hỏng/làm lại > 0 → CHẶN (MES 6.3.5: hai nguyên nhân khác hẳn nhau)
alter table kho.so_don_vi_mon drop constraint if exists sdv_hong_chi_thuc_te;
alter table kho.so_don_vi_mon add  constraint sdv_hong_chi_thuc_te
  check (moc = 'thuc_te' or (so_hong = 0 and so_lam_lai = 0));

-- ─────────── VIỆC 5 · cột chốt (mốc chuan tự làm bản ghi lịch sử) ───────────
alter table kho.so_don_vi_mon add column if not exists chot_luc timestamptz;
alter table kho.so_don_vi_mon add column if not exists chot_boi uuid;

-- đổi PK
alter table kho.so_don_vi_mon drop constraint so_don_vi_mon_moi_pkey;
alter table kho.so_don_vi_mon add  constraint so_don_vi_mon_pkey primary key (mon_id, hoat_dong, moc);

do $$ declare v_sau int; v_chuan int; begin
  select count(*), count(*) filter (where moc='chuan') into v_sau, v_chuan from kho.so_don_vi_mon;
  raise notice 'so_don_vi_mon SAU migration: % dòng (% mốc chuan)', v_sau, v_chuan;
end $$;

-- ─────────── VIỆC 5b · trigger cấm sửa/xoá dòng chuan ĐÃ CHỐT ───────────
create or replace function kho.chan_sua_moc_chot() returns trigger
  language plpgsql set search_path = kho as $$
begin
  if tg_op = 'DELETE' then
    if old.moc = 'chuan' and old.chot_luc is not null then
      raise exception 'MOC_CHUAN_DA_CHOT: số chuẩn của món đã chốt (bàn giao xuống xưởng) — không xoá được'; end if;
    return old;
  end if;
  -- UPDATE: chỉ chặn khi dòng ĐÃ chốt (old.chot_luc not null). Chính hành động CHỐT (null→now) vẫn cho.
  if old.moc = 'chuan' and old.chot_luc is not null then
    raise exception 'MOC_CHUAN_DA_CHOT: số chuẩn của món "%" đã chốt — không sửa được nữa', old.mon_id; end if;
  return new;
end $$;
drop trigger if exists trg_chan_sua_moc_chot on kho.so_don_vi_mon;
create trigger trg_chan_sua_moc_chot before update or delete on kho.so_don_vi_mon
  for each row execute function kho.chan_sua_moc_chot();

-- ─────────── VIỆC 3 · hàm giờ đọc theo MỐC (fail-đóng THIEU_MOC) ───────────
drop function if exists kho.gio_du_kien_cua_mon(uuid);
create or replace function kho.gio_du_kien_cua_mon(p_mon uuid, p_moc text default 'chuan')
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_sp text; v_qt text; r record; v_buoc jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
        v_tong numeric := 0; v_mauso numeric; v_sodv numeric; v_nguon text; v_gio numeric;
        v_co int; v_nguoi int := 0; v_loi text := null;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_mon: vai không xem được'; end if;
  if p_moc not in ('du_kien','chuan','thuc_te') then raise exception 'gio_du_kien_cua_mon: mốc "%" không hợp lệ', p_moc; end if;
  select ma_quy_trinh, sp_id into v_qt, v_sp from kho.don_hang_mon where id = p_mon;
  if not found then raise exception 'gio_du_kien_cua_mon: không có món "%"', p_mon; end if;
  if v_qt is null and v_sp is not null then
    select l.ma_quy_trinh into v_qt from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = v_sp;
  end if;
  if v_qt is null then
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'moc', p_moc, 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;

  select count(*) into v_co from kho.so_don_vi_mon where mon_id = p_mon and moc = p_moc;
  for r in select * from kho.quy_trinh_buoc where ma_quy_trinh = v_qt order by thu_tu loop
    if r.loai_buoc = 'tu_chay' then
      v_gio := coalesce(r.gio_co_dinh, 0);
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','tu_chay','so_don_vi',null,'nguon','tu_chay','gio',v_gio);
      v_tong := v_tong + v_gio;
    else
      v_nguoi := v_nguoi + 1;
      select mau_so into v_mauso from kho.don_gia_baseline where hoat_dong = r.hoat_dong;
      if v_mauso is null or v_mauso = 0 then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_DON_GIA'); continue; end if;
      select so_don_vi, nguon into v_sodv, v_nguon from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = r.hoat_dong and moc = p_moc;
      if not found then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_SO_DON_VI'); continue; end if;
      v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv;
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','nguoi','so_don_vi',v_sodv,'nguon',v_nguon,'gio',v_gio);
      v_tong := v_tong + v_gio;
    end if;
  end loop;

  -- FAIL-ĐÓNG: mốc yêu cầu KHÔNG có dữ liệu (0 dòng) mà có bước người → THIEU_MOC, KHÔNG rơi mốc khác, KHÔNG 0
  if v_co = 0 and v_nguoi > 0 then v_loi := 'THIEU_MOC'; end if;
  return jsonb_build_object(
    'ok', (jsonb_array_length(v_thieu) = 0), 'loi', coalesce(v_loi, null), 'moc', p_moc,
    'tong_gio', case when jsonb_array_length(v_thieu) = 0 then v_tong else null end,
    'buoc', v_buoc, 'thieu', v_thieu);
end $$;
grant execute on function kho.gio_du_kien_cua_mon(uuid, text) to authenticated;

drop function if exists kho.gio_du_kien_cua_don(text);   -- gỡ bản 1 tham số (db/069) tránh overload nhập nhằng
create or replace function kho.gio_du_kien_cua_don(p_ma_don text, p_moc text default 'chuan')
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare
  v_don uuid; r record; g jsonb; arr jsonb; i int; hd text; mato text; gi numeric; mgio numeric;
  v_mon jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
  v_hd jsonb := '{}'::jsonb; v_to jsonb := '{}'::jsonb;
  v_tong numeric := 0; v_nang jsonb := null; v_nang_gio numeric := -1;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_don: vai không xem được'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'gio_du_kien_cua_don: không có đơn "%"', p_ma_don; end if;

  for r in select dhm.id, dhm.sp_id, dhm.ten, dhm.so_luong from kho.don_hang_mon dhm
           where dhm.don_id = v_don order by dhm.tao_luc loop
    g := kho.gio_du_kien_cua_mon(r.id, p_moc);
    if (g->>'ok')::boolean is not true then
      v_thieu := v_thieu || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'loi',coalesce(g->>'loi', 'THIEU_SO_DON_VI'),'thieu',g->'thieu'));
      v_mon   := v_mon   || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'ok',false,'tong_gio',null,'loi',g->'loi','thieu',g->'thieu'));
    else
      mgio := 0; arr := g->'buoc';
      for i in 0 .. jsonb_array_length(arr) - 1 loop
        hd := arr->i->>'hoat_dong'; gi := (arr->i->>'gio')::numeric * coalesce(r.so_luong,1);
        select ma_to into mato from kho.don_gia_baseline where hoat_dong = hd; mato := coalesce(mato, '(chưa rõ tổ)');
        v_hd := jsonb_set(v_hd, array[hd],   to_jsonb(coalesce((v_hd->>hd)::numeric,0)   + gi));
        v_to := jsonb_set(v_to, array[mato], to_jsonb(coalesce((v_to->>mato)::numeric,0) + gi));
        mgio := mgio + gi;
      end loop;
      v_tong := v_tong + mgio;
      v_mon := v_mon || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'ok',true,'tong_gio',mgio,'so_luong',coalesce(r.so_luong,1)));
      if mgio > v_nang_gio then v_nang_gio := mgio; v_nang := jsonb_build_object('mon_id',r.id,'ten',r.ten,'tong_gio',mgio); end if;
    end if;
  end loop;

  if jsonb_array_length(v_thieu) > 0 then
    return jsonb_build_object('ma_don',p_ma_don,'moc',p_moc,'ok',false,'tong_gio_don',null,'thieu_mon',v_thieu,'mon',v_mon);
  end if;
  return jsonb_build_object('ma_don',p_ma_don,'moc',p_moc,'ok',true,'tong_gio_don',v_tong,'mon',v_mon,
    'theo_hoat_dong',v_hd,'theo_to',v_to,'mon_nang_nhat',v_nang);
end $$;
grant execute on function kho.gio_du_kien_cua_don(text, text) to authenticated;

-- ─────────── luu_so_don_vi + nhap_so_chi_tiet_mon: ghi/đọc mốc 'chuan' (màn nhập số) ───────────
drop function if exists kho.luu_so_don_vi(uuid, text, text, text);
create or replace function kho.luu_so_don_vi(p_mon uuid, p_hoat_dong text, p_bieu_thuc text, p_nguon text, p_moc text default 'chuan')
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_so numeric; v_ns uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  if p_moc not in ('du_kien','chuan','thuc_te') then raise exception 'luu_so: mốc "%" không hợp lệ', p_moc; end if;
  if not exists (select 1 from kho.don_hang_mon where id = p_mon) then raise exception 'luu_so: không có món "%"', p_mon; end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'luu_so: nguồn phải cutlist/go_tay/uoc'; end if;
  if coalesce(btrim(p_bieu_thuc),'') = '' then
    delete from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = p_hoat_dong and moc = p_moc;
    return jsonb_build_object('ok', true, 'xoa', true);
  end if;
  v_so := kho.tinh_bieu_thuc(p_bieu_thuc);
  v_ns := kho.current_ns();
  insert into kho.so_don_vi_mon(mon_id, hoat_dong, moc, so_don_vi, bieu_thuc, nguon, nguoi_nhap)
    values (p_mon, p_hoat_dong, p_moc, v_so, btrim(p_bieu_thuc), p_nguon, v_ns)
    on conflict (mon_id, hoat_dong, moc) do update
      set so_don_vi = excluded.so_don_vi, bieu_thuc = excluded.bieu_thuc, nguon = excluded.nguon,
          nguoi_nhap = excluded.nguoi_nhap, luc = now();
  return jsonb_build_object('ok', true, 'so_don_vi', v_so, 'bieu_thuc', btrim(p_bieu_thuc), 'moc', p_moc);
end $$;
grant execute on function kho.luu_so_don_vi(uuid, text, text, text, text) to authenticated;

drop function if exists kho.nhap_so_chi_tiet_mon(uuid);
create or replace function kho.nhap_so_chi_tiet_mon(p_mon uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_sp text; v_qt text; v_goi_y text; v_dung text; v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select ma_quy_trinh, sp_id into v_qt, v_sp from kho.don_hang_mon where id = p_mon;
  if not found then raise exception 'nhap_so: không có món "%"', p_mon; end if;
  if v_sp is not null then
    select l.ma_quy_trinh into v_goi_y from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = v_sp;
  end if;
  v_dung := coalesce(v_qt, v_goi_y);
  if v_dung is null then
    return jsonb_build_object('chua_gan', true, 'ma_quy_trinh', null, 'goi_y', null, 'dang_dung', null, 'buoc', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'thu_tu', b.thu_tu, 'hoat_dong', b.hoat_dong,
      'ten_hoat_dong', (select ten from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'nhanh', b.nhanh, 'loai_buoc', b.loai_buoc,
      'gio_co_dinh', b.gio_co_dinh, 'gio_moi_don_vi', b.gio_moi_don_vi,
      'so_don_vi', sd.so_don_vi, 'bieu_thuc', sd.bieu_thuc, 'nguon', sd.nguon,
      'gio', case when b.loai_buoc = 'tu_chay' then b.gio_co_dinh
                  when sd.so_don_vi is not null then round((coalesce(b.gio_co_dinh,0) + coalesce(b.gio_moi_don_vi,0)*sd.so_don_vi)::numeric, 2)
                  else null end
    ) order by b.thu_tu), '[]'::jsonb)
    into v_buoc
    from kho.quy_trinh_buoc b
    left join kho.so_don_vi_mon sd on sd.mon_id = p_mon and sd.hoat_dong = b.hoat_dong and sd.moc = 'chuan'
    where b.ma_quy_trinh = v_dung;
  return jsonb_build_object('chua_gan', false, 'ma_quy_trinh', v_qt, 'goi_y', v_goi_y, 'dang_dung', v_dung, 'buoc', v_buoc);
end $$;
grant execute on function kho.nhap_so_chi_tiet_mon(uuid) to authenticated;

-- ─────────── VIỆC 5c · ban_giao_xuong: chốt mốc 'chuan' của mọi món trong đơn ───────────
create or replace function kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; f jsonb; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'ban_giao_xuong: chỉ ceo/thiet_ke'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'ban_giao_xuong: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'ban_giao_xuong: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  if v_don.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không gửi lại', p_ma_don, v_don.trang_thai; end if;
  if v_don.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_don.trang_thai not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không gửi được', p_ma_don, v_don.trang_thai; end if;
  select string_agg(ten, ', ') into v_chua_gan from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH') z;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  select string_agg(ten, ', ') into v_thieu_so from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'ok')::boolean is not true) z;
  if v_thieu_so is not null then raise exception 'THIEU_SO_DON_VI: món còn thiếu số: %', v_thieu_so; end if;
  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'THIEU_FILE_CAT: chưa đính kèm file cắt nào'; end if;
  v_le_mau := (coalesce(v_don.dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'CHUA_KHACH_DUYET: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT', p_ma_don; end if;

  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);
  -- CHỐT mốc chuan: đóng băng SỐ đơn vị (thay bảng snapshot riêng) — trigger cấm sửa từ đây
  update kho.so_don_vi_mon set chot_luc = now(), chot_boi = v_ns
    where moc = 'chuan' and chot_luc is null and mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat');
end $$;
grant execute on function kho.ban_giao_xuong(text, jsonb, text) to authenticated;

-- ─────────── VIỆC 4 · so_sanh_moc(ma_don) — bảng chênh lệch ba mốc ───────────
create or replace function kho.so_sanh_moc(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don uuid; m record; h record; v_mon jsonb := '[]'::jsonb; v_hd jsonb;
  dk numeric; ch numeric; tt numeric; hong numeric; laylai numeric; dg numeric; ten_hd text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'so_sanh_moc: chỉ ceo/thiet_ke'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'so_sanh_moc: không có đơn "%"', p_ma_don; end if;
  for m in select id, ten, sp_id from kho.don_hang_mon where don_id = v_don order by tao_luc loop
    v_hd := '[]'::jsonb;
    for h in select distinct hoat_dong from kho.so_don_vi_mon where mon_id = m.id order by hoat_dong loop
      select so_don_vi into dk     from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='du_kien';
      select so_don_vi into ch     from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='chuan';
      select so_don_vi, so_hong, so_lam_lai into tt, hong, laylai
        from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='thuc_te';
      select don_gia, ten into dg, ten_hd from kho.don_gia_baseline where hoat_dong = h.hoat_dong;
      v_hd := v_hd || jsonb_build_array(jsonb_build_object(
        'hoat_dong', h.hoat_dong, 'ten_hoat_dong', ten_hd,
        'du_kien', dk, 'chuan', ch, 'thuc_te', tt,
        'so_hong', case when tt is not null then coalesce(hong,0) else null end,
        'so_lam_lai', case when tt is not null then coalesce(laylai,0) else null end,
        -- chênh du_kien→chuan
        'chenh_dk_chuan', case when dk is not null and ch is not null then ch - dk else null end,
        'pct_dk_chuan',   case when dk is not null and ch is not null and dk <> 0 then round((ch-dk)/dk*100,1) else null end,
        -- chênh chuan→thuc_te, tách hỏng/làm lại và đếm
        'chenh_chuan_tt', case when ch is not null and tt is not null then tt - ch else null end,
        'pct_chuan_tt',   case when ch is not null and tt is not null and ch <> 0 then round((tt-ch)/ch*100,1) else null end,
        'chenh_do_hong',  case when ch is not null and tt is not null then coalesce(hong,0)+coalesce(laylai,0) else null end,
        'chenh_do_dem',   case when ch is not null and tt is not null then (tt-ch) - (coalesce(hong,0)+coalesce(laylai,0)) else null end,
        -- tiền công mỗi mốc = số × đơn giá
        'tien_du_kien', case when dk is not null then round(dk*coalesce(dg,0)) else null end,
        'tien_chuan',   case when ch is not null then round(ch*coalesce(dg,0)) else null end,
        'tien_thuc_te', case when tt is not null then round(tt*coalesce(dg,0)) else null end));
    end loop;
    v_mon := v_mon || jsonb_build_array(jsonb_build_object('mon_id', m.id, 'ten', m.ten, 'sp_id', m.sp_id, 'hoat_dong', v_hd));
  end loop;
  return jsonb_build_object('ma_don', p_ma_don, 'mon', v_mon);
end $$;
grant execute on function kho.so_sanh_moc(text) to authenticated;

-- ─────────── VIỆC 6 · chep_so_tu_mon_tuong_tu(dich, nguon, ti_le) → ghi du_kien/uoc ───────────
--   driver ĐẾM CÁI (tấm/lỗ/cánh/cup/ngăn/kiện/giường) → làm tròn LÊN số nguyên; driver ĐO (mét/m²) → giữ lẻ.
create or replace function kho.chep_so_tu_mon_tuong_tu(p_dich uuid, p_nguon uuid, p_ti_le numeric default 1.0)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_moc text; r record; v_so numeric; n int := 0; v_ns uuid;
  v_do text[] := array['dan','lot','pu','son_canh'];   -- mốc ĐO (mét, m²) — giữ số lẻ
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke','tk_ban_hang') then raise exception 'chep_so: chỉ ceo/thiet_ke/tk_ban_hang'; end if;
  if not exists (select 1 from kho.don_hang_mon where id = p_dich) then raise exception 'chep_so: không có món đích "%"', p_dich; end if;
  if not exists (select 1 from kho.don_hang_mon where id = p_nguon) then raise exception 'chep_so: không có món nguồn "%"', p_nguon; end if;
  -- mốc nguồn: ưu tiên chuan > du_kien > thuc_te
  select moc into v_moc from kho.so_don_vi_mon where mon_id = p_nguon
    order by case moc when 'chuan' then 1 when 'du_kien' then 2 else 3 end limit 1;
  if v_moc is null then raise exception 'MON_NGUON_TRONG: món nguồn "%" chưa có số ở mốc nào — không chép được', p_nguon; end if;
  v_ns := kho.current_ns();
  for r in select hoat_dong, so_don_vi from kho.so_don_vi_mon where mon_id = p_nguon and moc = v_moc loop
    if r.hoat_dong = any(v_do) then v_so := round((r.so_don_vi * p_ti_le)::numeric, 2);   -- đo: giữ lẻ
    else v_so := ceil(r.so_don_vi * p_ti_le); end if;                                     -- đếm: làm tròn LÊN
    insert into kho.so_don_vi_mon(mon_id, hoat_dong, moc, so_don_vi, nguon, nguoi_nhap)
      values (p_dich, r.hoat_dong, 'du_kien', v_so, 'uoc', v_ns)
      on conflict (mon_id, hoat_dong, moc) do update set so_don_vi = excluded.so_don_vi, nguon = 'uoc', nguoi_nhap = v_ns, luc = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'moc_nguon', v_moc, 'so_hoat_dong', n, 'ti_le', p_ti_le, 'moc_ghi', 'du_kien');
end $$;
grant execute on function kho.chep_so_tu_mon_tuong_tu(uuid, uuid, numeric) to authenticated;

commit;
