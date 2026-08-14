-- 071 — ĐÓNG BĂNG PHÚT + ĐƠN GIÁ tại bàn giao (QD-16). THUẦN DB. Đóng lỗ hở db/070.
-- CẢNH BÁO: KHÔNG idempotent (đổi ban_giao_xuong/gio_du_kien). Chạy MỘT lần.
--   Chạy: cd web && node ops/run_sql.mjs ../db/071_dong_bang_phut.sql
begin;

-- ─────────── VIỆC 1 · ba cột chốt (chỉ có nghĩa với chuan đã chốt) ───────────
alter table kho.so_don_vi_mon add column if not exists gio_moi_don_vi_chot numeric;
alter table kho.so_don_vi_mon add column if not exists gio_co_dinh_chot    numeric;
alter table kho.so_don_vi_mon add column if not exists don_gia_chot        numeric;
--   mốc du_kien/thuc_te (và chuan CHƯA chốt) → ba số này NULL
alter table kho.so_don_vi_mon drop constraint if exists sdv_chot_chi_chuan;
alter table kho.so_don_vi_mon add  constraint sdv_chot_chi_chuan
  check (moc = 'chuan' or (gio_moi_don_vi_chot is null and gio_co_dinh_chot is null and don_gia_chot is null));
-- Trigger cấm sửa dòng chuan đã chốt (db/070) CHẶN MỌI cột → đã bao trùm 3 cột mới, không cần sửa trigger.

-- ─────────── VIỆC 1b · ban_giao_xuong: chốt CẢ số LẪN phút + đơn giá (fail-đóng, không chốt một phần) ───────────
create or replace function kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0;
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

  -- CHỐT-COMPLETE: mọi dòng chuan chép được ĐỦ phút + đơn giá? Thiếu → CHẶN cả bàn giao (KHÔNG chốt một phần)
  select count(*) into v_miss
    from kho.so_don_vi_mon s join kho.don_hang_mon m on m.id = s.mon_id
    where m.don_id = v_don.id and s.moc = 'chuan' and s.chot_luc is null
      and not exists (
        select 1 from kho.quy_trinh_buoc b, kho.don_gia_baseline d
        where b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
              (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))
          and b.hoat_dong = s.hoat_dong and b.gio_moi_don_vi is not null
          and d.hoat_dong = s.hoat_dong and d.don_gia is not null);
  if v_miss > 0 then raise exception 'CHOT_THIEU_SO: % dòng số chuẩn thiếu phút/đơn giá để đóng băng — không bàn giao được', v_miss; end if;

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

  -- CHỐT: đóng băng SỐ + PHÚT + ĐƠN GIÁ (chép từ quy_trinh_buoc + don_gia_baseline HIỆN TẠI)
  --   dùng subquery tương quan theo s (UPDATE...FROM không cho tham chiếu s trong JOIN ON)
  update kho.so_don_vi_mon s
    set gio_moi_don_vi_chot = (select b.gio_moi_don_vi from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        gio_co_dinh_chot = (select b.gio_co_dinh from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        don_gia_chot = (select d.don_gia from kho.don_gia_baseline d where d.hoat_dong = s.hoat_dong),
        chot_luc = now(), chot_boi = v_ns
    where s.moc = 'chuan' and s.chot_luc is null
      and s.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat');
end $$;
grant execute on function kho.ban_giao_xuong(text, jsonb, text) to authenticated;

-- ─────────── VIỆC 2 · gio_du_kien_cua_mon rẽ theo ĐÃ CHỐT / LIVE ───────────
drop function if exists kho.gio_du_kien_cua_mon(uuid, text);
create or replace function kho.gio_du_kien_cua_mon(p_mon uuid, p_moc text default 'chuan')
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_sp text; v_qt text; r record; v_buoc jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
        v_tong numeric := 0; v_mauso numeric; v_sodv numeric; v_nguon text; v_gio numeric;
        v_co int; v_nguoi int := 0; v_loi text := null; v_src text;
        v_chot timestamptz; v_gmdv_c numeric; v_gcd_c numeric;
        v_co_chot boolean := false; v_co_live boolean := false; v_co_thieu_chot boolean := false; v_nguon_gio text;
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
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'moc', p_moc, 'nguon_gio', null, 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;

  select count(*) into v_co from kho.so_don_vi_mon where mon_id = p_mon and moc = p_moc;
  for r in select * from kho.quy_trinh_buoc where ma_quy_trinh = v_qt order by thu_tu loop
    if r.loai_buoc = 'tu_chay' then
      v_gio := coalesce(r.gio_co_dinh, 0);   -- bước tự chạy KHÔNG có số → giờ luôn LIVE (ghi hở ở so_no.md)
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','tu_chay','so_don_vi',null,'nguon','tu_chay','gio',v_gio,'nguon_gio','live');
      v_tong := v_tong + v_gio;
    else
      v_nguoi := v_nguoi + 1;
      select mau_so into v_mauso from kho.don_gia_baseline where hoat_dong = r.hoat_dong;
      if v_mauso is null or v_mauso = 0 then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_DON_GIA'); continue; end if;
      select so_don_vi, nguon, chot_luc, gio_moi_don_vi_chot, gio_co_dinh_chot
        into v_sodv, v_nguon, v_chot, v_gmdv_c, v_gcd_c
        from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = r.hoat_dong and moc = p_moc;
      if not found then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_SO_DON_VI'); continue; end if;
      -- ĐÃ CHỐT (chỉ chuan có chot_luc) → dùng phút đóng băng; CHƯA chốt / du_kien / thuc_te → LIVE
      if v_chot is not null and v_gmdv_c is not null then
        v_gio := coalesce(v_gcd_c,0) + v_gmdv_c * v_sodv; v_src := 'da_chot'; v_co_chot := true;
      elsif v_chot is not null then
        v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv; v_src := 'thieu_so_chot'; v_co_thieu_chot := true;
      else
        v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv; v_src := 'live'; v_co_live := true;
      end if;
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','nguoi','so_don_vi',v_sodv,'nguon',v_nguon,'gio',v_gio,'nguon_gio',v_src);
      v_tong := v_tong + v_gio;
    end if;
  end loop;

  if v_co = 0 and v_nguoi > 0 then v_loi := 'THIEU_MOC'; end if;
  v_nguon_gio := case when v_co_thieu_chot then 'thieu_so_chot'
                      when v_co_chot and v_co_live then 'lan'
                      when v_co_chot then 'da_chot' else 'live' end;
  return jsonb_build_object(
    'ok', (jsonb_array_length(v_thieu) = 0), 'loi', coalesce(v_loi, null), 'moc', p_moc, 'nguon_gio', v_nguon_gio,
    'tong_gio', case when jsonb_array_length(v_thieu) = 0 then v_tong else null end,
    'buoc', v_buoc, 'thieu', v_thieu);
end $$;
grant execute on function kho.gio_du_kien_cua_mon(uuid, text) to authenticated;

-- gio_du_kien_cua_don: gộp nguon_gio (đơn-level)
create or replace function kho.gio_du_kien_cua_don(p_ma_don text, p_moc text default 'chuan')
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare
  v_don uuid; r record; g jsonb; arr jsonb; i int; hd text; mato text; gi numeric; mgio numeric;
  v_mon jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
  v_hd jsonb := '{}'::jsonb; v_to jsonb := '{}'::jsonb;
  v_tong numeric := 0; v_nang jsonb := null; v_nang_gio numeric := -1;
  v_chot boolean := false; v_live boolean := false; v_thieuc boolean := false; v_ng text;
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
      v_mon   := v_mon   || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'ok',false,'tong_gio',null,'loi',g->'loi','nguon_gio',g->>'nguon_gio','thieu',g->'thieu'));
    else
      v_ng := g->>'nguon_gio';
      if v_ng = 'thieu_so_chot' then v_thieuc := true; elsif v_ng = 'da_chot' then v_chot := true; elsif v_ng = 'lan' then v_chot := true; v_live := true; else v_live := true; end if;
      mgio := 0; arr := g->'buoc';
      for i in 0 .. jsonb_array_length(arr) - 1 loop
        hd := arr->i->>'hoat_dong'; gi := (arr->i->>'gio')::numeric * coalesce(r.so_luong,1);
        select ma_to into mato from kho.don_gia_baseline where hoat_dong = hd; mato := coalesce(mato, '(chưa rõ tổ)');
        v_hd := jsonb_set(v_hd, array[hd],   to_jsonb(coalesce((v_hd->>hd)::numeric,0)   + gi));
        v_to := jsonb_set(v_to, array[mato], to_jsonb(coalesce((v_to->>mato)::numeric,0) + gi));
        mgio := mgio + gi;
      end loop;
      v_tong := v_tong + mgio;
      v_mon := v_mon || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'ok',true,'tong_gio',mgio,'nguon_gio',v_ng,'so_luong',coalesce(r.so_luong,1)));
      if mgio > v_nang_gio then v_nang_gio := mgio; v_nang := jsonb_build_object('mon_id',r.id,'ten',r.ten,'tong_gio',mgio); end if;
    end if;
  end loop;

  v_ng := case when v_thieuc then 'thieu_so_chot' when v_chot and v_live then 'lan' when v_chot then 'da_chot' else 'live' end;
  if jsonb_array_length(v_thieu) > 0 then
    return jsonb_build_object('ma_don',p_ma_don,'moc',p_moc,'ok',false,'nguon_gio',v_ng,'tong_gio_don',null,'thieu_mon',v_thieu,'mon',v_mon);
  end if;
  return jsonb_build_object('ma_don',p_ma_don,'moc',p_moc,'ok',true,'nguon_gio',v_ng,'tong_gio_don',v_tong,'mon',v_mon,
    'theo_hoat_dong',v_hd,'theo_to',v_to,'mon_nang_nhat',v_nang);
end $$;
grant execute on function kho.gio_du_kien_cua_don(text, text) to authenticated;

-- ─────────── VIỆC 2b · so_sanh_moc: tiền công mốc chuan ĐÃ CHỐT dùng don_gia_chot (đóng băng) ───────────
create or replace function kho.so_sanh_moc(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don uuid; m record; h record; v_mon jsonb := '[]'::jsonb; v_hd jsonb;
  dk numeric; ch numeric; tt numeric; hong numeric; laylai numeric; dg numeric; ten_hd text; dg_ch numeric; chot timestamptz;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'so_sanh_moc: chỉ ceo/thiet_ke'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'so_sanh_moc: không có đơn "%"', p_ma_don; end if;
  for m in select id, ten, sp_id from kho.don_hang_mon where don_id = v_don order by tao_luc loop
    v_hd := '[]'::jsonb;
    for h in select distinct hoat_dong from kho.so_don_vi_mon where mon_id = m.id order by hoat_dong loop
      select so_don_vi into dk from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='du_kien';
      select so_don_vi, don_gia_chot, chot_luc into ch, dg_ch, chot from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='chuan';
      select so_don_vi, so_hong, so_lam_lai into tt, hong, laylai from kho.so_don_vi_mon where mon_id = m.id and hoat_dong = h.hoat_dong and moc='thuc_te';
      select don_gia, ten into dg, ten_hd from kho.don_gia_baseline where hoat_dong = h.hoat_dong;
      v_hd := v_hd || jsonb_build_array(jsonb_build_object(
        'hoat_dong', h.hoat_dong, 'ten_hoat_dong', ten_hd,
        'du_kien', dk, 'chuan', ch, 'thuc_te', tt,
        'so_hong', case when tt is not null then coalesce(hong,0) else null end,
        'so_lam_lai', case when tt is not null then coalesce(laylai,0) else null end,
        'chenh_dk_chuan', case when dk is not null and ch is not null then ch - dk else null end,
        'pct_dk_chuan',   case when dk is not null and ch is not null and dk <> 0 then round((ch-dk)/dk*100,1) else null end,
        'chenh_chuan_tt', case when ch is not null and tt is not null then tt - ch else null end,
        'pct_chuan_tt',   case when ch is not null and tt is not null and ch <> 0 then round((tt-ch)/ch*100,1) else null end,
        'chenh_do_hong',  case when ch is not null and tt is not null then coalesce(hong,0)+coalesce(laylai,0) else null end,
        'chenh_do_dem',   case when ch is not null and tt is not null then (tt-ch) - (coalesce(hong,0)+coalesce(laylai,0)) else null end,
        'tien_du_kien', case when dk is not null then round(dk*coalesce(dg,0)) else null end,
        -- tiền công chuan ĐÃ CHỐT → don_gia_chot (đóng băng); chưa chốt → don_gia live
        'tien_chuan',   case when ch is not null then round(ch*coalesce(case when chot is not null then dg_ch else dg end,0)) else null end,
        'tien_thuc_te', case when tt is not null then round(tt*coalesce(dg,0)) else null end,
        'don_gia_chot', dg_ch));
    end loop;
    v_mon := v_mon || jsonb_build_array(jsonb_build_object('mon_id', m.id, 'ten', m.ten, 'sp_id', m.sp_id, 'hoat_dong', v_hd));
  end loop;
  return jsonb_build_object('ma_don', p_ma_don, 'mon', v_mon);
end $$;
grant execute on function kho.so_sanh_moc(text) to authenticated;

commit;
