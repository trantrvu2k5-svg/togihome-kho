-- 069 — KHOÁ SỐ + QUY TRÌNH THEO MÓN (QD-13) + BÀN GIAO XƯỞNG GỘP 3 CHỐT (QD-14)
-- CẢNH BÁO: migration này KHÔNG idempotent. Chạy MỘT lần duy nhất.
-- Bước đổi khoá dùng ma_bien_the, chạy lần hai sẽ hỏng vì cột đã mất.
--   Gốc lỗi "0 món": nhap_so_don_don_hang inner join san_pham_mau + where sp_id is not null → món tự do
--   (sp_id=null, việc CHÍNH của công ty) bị lọc sạch. Nay khoá theo don_hang_mon.id — mọi món hiện ra,
--   gán quy trình + nhập số được. Bàn giao xưởng gộp gui_file_san_xuat + day_so_san_xuat thành ban_giao_xuong
--   (3 chốt: file cắt · khách duyệt · đủ số), day_so_san_xuat GỠ BỎ (từ thiết kế chỉ CÒN MỘT đường cho_cat).
--   Chạy: cd web && node ops/run_sql.mjs ../db/069_khoa_theo_mon.sql
--
-- ══════════ HOÀN TÁC (thủ công, không tự động vì đổi khoá) ══════════
--   Khôi phục từ backup — migration này đổi PK so_don_vi_mon + thêm cột. Không có đường lùi sạch.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────── 1. so_don_vi_mon: khoá ma_bien_the → mon_id ───────────
create table if not exists kho.so_don_vi_mon_moi (
  mon_id      uuid not null references kho.don_hang_mon(id) on delete cascade,
  hoat_dong   text not null references kho.don_gia_baseline(hoat_dong),
  so_don_vi   numeric not null,
  bieu_thuc   text,
  nguon       text not null check (nguon in ('cutlist','go_tay','uoc')),
  nguoi_nhap  uuid,
  luc         timestamptz default now(),
  primary key (mon_id, hoat_dong),
  constraint sdv_bieu_thuc_ck check (bieu_thuc is null or bieu_thuc ~ '^[0-9+* ]*$')
);
-- chuyển dữ liệu cũ: mỗi (ma_bien_the,hoat_dong) → MỌI món có sp_id = ma_bien_the (có thì chuyển, không thì thôi)
insert into kho.so_don_vi_mon_moi (mon_id, hoat_dong, so_don_vi, bieu_thuc, nguon, nguoi_nhap, luc)
  select dhm.id, s.hoat_dong, s.so_don_vi, s.bieu_thuc, s.nguon, s.nguoi_nhap, s.luc
    from kho.so_don_vi_mon s
    join kho.don_hang_mon dhm on dhm.sp_id = s.ma_bien_the
  on conflict (mon_id, hoat_dong) do nothing;
drop table kho.so_don_vi_mon;
alter table kho.so_don_vi_mon_moi rename to so_don_vi_mon;

-- ─────────── 2. don_hang_mon.ma_quy_trinh (gán theo MÓN, cho NULL; lõi chỉ GỢI Ý) ───────────
alter table kho.don_hang_mon
  add column if not exists ma_quy_trinh text references kho.quy_trinh(ma_quy_trinh);
--   KHÔNG migrate từ lõi: để "gán thật" phản ánh thao tác người. gio_du_kien_cua_mon fallback lõi khi NULL.

-- ─────────── 3. gio_du_kien_cua_mon(mon_id) — quy trình theo MÓN, fallback lõi (gợi ý) ───────────
drop function if exists kho.gio_du_kien_cua_mon(text);
create or replace function kho.gio_du_kien_cua_mon(p_mon uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_sp text; v_qt text; r record; v_buoc jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
        v_tong numeric := 0; v_mauso numeric; v_sodv numeric; v_nguon text; v_gio numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_mon: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select ma_quy_trinh, sp_id into v_qt, v_sp from kho.don_hang_mon where id = p_mon;
  if not found then raise exception 'gio_du_kien_cua_mon: không có món "%"', p_mon; end if;
  -- quy trình HIỆU LỰC: gán tay ở món > gợi ý từ lõi (nếu món có sp_id)
  if v_qt is null and v_sp is not null then
    select l.ma_quy_trinh into v_qt from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = v_sp;
  end if;
  if v_qt is null then
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;

  for r in select * from kho.quy_trinh_buoc where ma_quy_trinh = v_qt order by thu_tu loop
    if r.loai_buoc = 'tu_chay' then
      v_gio := coalesce(r.gio_co_dinh, 0);
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','tu_chay','so_don_vi',null,'nguon','tu_chay','gio',v_gio);
      v_tong := v_tong + v_gio;
    else
      select mau_so into v_mauso from kho.don_gia_baseline where hoat_dong = r.hoat_dong;
      if v_mauso is null or v_mauso = 0 then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_DON_GIA'); continue; end if;
      select so_don_vi, nguon into v_sodv, v_nguon from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = r.hoat_dong;
      if not found then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_SO_DON_VI'); continue; end if;
      v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv;
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','nguoi','so_don_vi',v_sodv,'nguon',v_nguon,'gio',v_gio);
      v_tong := v_tong + v_gio;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', (jsonb_array_length(v_thieu) = 0), 'loi', null,
    'tong_gio', case when jsonb_array_length(v_thieu) = 0 then v_tong else null end,
    'buoc', v_buoc, 'thieu', v_thieu);
end $$;
grant execute on function kho.gio_du_kien_cua_mon(uuid) to authenticated;

-- ─────────── 4. helper NỘI BỘ (không grant): tình trạng số của 1 đơn ───────────
create or replace function kho.so_tt_don(p_don uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare r record; g jsonb; v_mon int := 0; v_du int := 0; v_thieu int := 0; v_chua int := 0;
begin
  for r in select id from kho.don_hang_mon where don_id = p_don loop
    v_mon := v_mon + 1; g := kho.gio_du_kien_cua_mon(r.id);
    if (g->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH' then v_chua := v_chua + 1;
    elsif (g->>'ok')::boolean is true then v_du := v_du + 1;
    else v_thieu := v_thieu + 1; end if;
  end loop;
  return jsonb_build_object('so_mon',v_mon,'dem_du',v_du,'dem_thieu',v_thieu,'dem_chua_gan',v_chua,
    'tinh_trang', case when v_mon = 0 then 'trong' when v_chua > 0 then 'chua_gan'
                       when v_thieu > 0 then 'thieu' else 'du' end);
end $$;

-- ─────────── 5. gio_du_kien_cua_don — DUYỆT MỌI món (kể cả sp_id null), khoá mon_id ───────────
create or replace function kho.gio_du_kien_cua_don(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare
  v_don uuid; r record; g jsonb; arr jsonb; i int; hd text; mato text; gi numeric; mgio numeric;
  v_mon jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
  v_hd jsonb := '{}'::jsonb; v_to jsonb := '{}'::jsonb;
  v_tong numeric := 0; v_nang jsonb := null; v_nang_gio numeric := -1;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_don: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if not found then raise exception 'gio_du_kien_cua_don: không có đơn "%"', p_ma_don; end if;

  for r in select dhm.id, dhm.sp_id, dhm.ten, dhm.so_luong from kho.don_hang_mon dhm
           where dhm.don_id = v_don order by dhm.tao_luc loop
    g := kho.gio_du_kien_cua_mon(r.id);
    if (g->>'ok')::boolean is not true then
      v_thieu := v_thieu || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'loi',g->'loi','thieu',g->'thieu'));
      v_mon   := v_mon   || jsonb_build_array(jsonb_build_object('mon_id',r.id,'sp_id',r.sp_id,'ten',r.ten,'ok',false,'tong_gio',null,'loi',g->'loi','thieu',g->'thieu'));
    else
      mgio := 0; arr := g->'buoc';
      for i in 0 .. jsonb_array_length(arr) - 1 loop
        hd := arr->i->>'hoat_dong'; gi := (arr->i->>'gio')::numeric * coalesce(r.so_luong,1);
        select ma_to into mato from kho.don_gia_baseline where hoat_dong = hd;
        mato := coalesce(mato, '(chưa rõ tổ)');
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
    return jsonb_build_object('ma_don',p_ma_don,'ok',false,'tong_gio_don',null,'thieu_mon',v_thieu,'mon',v_mon);
  end if;
  return jsonb_build_object('ma_don',p_ma_don,'ok',true,'tong_gio_don',v_tong,'mon',v_mon,
    'theo_hoat_dong',v_hd,'theo_to',v_to,'mon_nang_nhat',v_nang);
end $$;
grant execute on function kho.gio_du_kien_cua_don(text) to authenticated;

-- ─────────── 6. gan_quy_trinh_mon(mon_id, ma_qt) — ghi don_hang_mon.ma_quy_trinh ───────────
drop function if exists kho.gan_quy_trinh_mon(text, text);
create or replace function kho.gan_quy_trinh_mon(p_mon uuid, p_ma_qt text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  if not exists (select 1 from kho.don_hang_mon where id = p_mon) then raise exception 'gan_quy_trinh: không có món "%"', p_mon; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_ma_qt) then raise exception 'gan_quy_trinh: không có quy trình "%"', p_ma_qt; end if;
  update kho.don_hang_mon set ma_quy_trinh = p_ma_qt where id = p_mon;
  return jsonb_build_object('ok', true, 'mon_id', p_mon, 'ma_quy_trinh', p_ma_qt);
end $$;
grant execute on function kho.gan_quy_trinh_mon(uuid, text) to authenticated;

-- ─────────── 7. luu_so_don_vi(mon_id, hoat_dong, bieu_thuc, nguon) ───────────
drop function if exists kho.luu_so_don_vi(text, text, text, text);
create or replace function kho.luu_so_don_vi(p_mon uuid, p_hoat_dong text, p_bieu_thuc text, p_nguon text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_so numeric; v_ns uuid;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  if not exists (select 1 from kho.don_hang_mon where id = p_mon) then raise exception 'luu_so: không có món "%"', p_mon; end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'luu_so: nguồn phải cutlist/go_tay/uoc'; end if;
  if coalesce(btrim(p_bieu_thuc),'') = '' then                       -- rỗng → xoá dòng
    delete from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = p_hoat_dong;
    return jsonb_build_object('ok', true, 'xoa', true);
  end if;
  v_so := kho.tinh_bieu_thuc(p_bieu_thuc);                           -- validate + tính (rác → raise BIEU_THUC_RAC)
  v_ns := kho.current_ns();
  insert into kho.so_don_vi_mon(mon_id, hoat_dong, so_don_vi, bieu_thuc, nguon, nguoi_nhap)
    values (p_mon, p_hoat_dong, v_so, btrim(p_bieu_thuc), p_nguon, v_ns)
    on conflict (mon_id, hoat_dong) do update
      set so_don_vi = excluded.so_don_vi, bieu_thuc = excluded.bieu_thuc, nguon = excluded.nguon,
          nguoi_nhap = excluded.nguoi_nhap, luc = now();
  return jsonb_build_object('ok', true, 'so_don_vi', v_so, 'bieu_thuc', btrim(p_bieu_thuc));
end $$;
grant execute on function kho.luu_so_don_vi(uuid, text, text, text) to authenticated;

-- ─────────── 8. nhap_so_chi_tiet_mon(mon_id) — bước + số + GỢI Ý quy trình từ lõi ───────────
drop function if exists kho.nhap_so_chi_tiet_mon(text);
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
  v_dung := coalesce(v_qt, v_goi_y);                                 -- quy trình đang hiển thị bước
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
    left join kho.so_don_vi_mon sd on sd.mon_id = p_mon and sd.hoat_dong = b.hoat_dong
    where b.ma_quy_trinh = v_dung;
  -- chua_gan = chưa CÓ quy trình hiệu lực nào (v_dung null đã trả trên); ở đây có v_dung nên false
  return jsonb_build_object('chua_gan', false, 'ma_quy_trinh', v_qt, 'goi_y', v_goi_y, 'dang_dung', v_dung, 'buoc', v_buoc);
end $$;
grant execute on function kho.nhap_so_chi_tiet_mon(uuid) to authenticated;

-- ─────────── 9. nhap_so_don_don_hang — MỌI món hiện ra (bỏ inner join + sp_id filter) ───────────
create or replace function kho.nhap_so_don_don_hang(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don uuid; v_tt text; v_dong text; r record; g jsonb; tt text; so_thieu int;
  v_mon jsonb := '[]'::jsonb; v_thieu_dem int := 0;
  v_tong numeric := 0; v_dem_du int := 0; v_dem int := 0;
  v_nang jsonb := null; v_nang_gio numeric := -1; v_to jsonb := '{}'::jsonb;
  b jsonb; i int; hd text; mato text; gi numeric; v_qt text; v_goi_y text; v_qten text;
  v_khach_duyet boolean; v_le_mau boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select id, trang_thai, dong into v_don, v_tt, v_dong from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  if v_tt in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" còn là báo giá, chưa chốt — lên đơn trước', p_ma_don; end if;

  for r in select dhm.id, dhm.sp_id, dhm.ten, dhm.kt, dhm.so_luong, dhm.ma_quy_trinh
           from kho.don_hang_mon dhm where dhm.don_id = v_don order by dhm.tao_luc loop
    v_dem := v_dem + 1;
    -- quy trình gán ở món + gợi ý từ lõi (nếu có sp_id)
    v_qt := r.ma_quy_trinh; v_goi_y := null;
    if r.sp_id is not null then
      select l.ma_quy_trinh into v_goi_y from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = r.sp_id;
    end if;
    select ten into v_qten from kho.quy_trinh where ma_quy_trinh = coalesce(v_qt, v_goi_y);
    g := kho.gio_du_kien_cua_mon(r.id);
    if (g->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH' then
      tt := 'chua_gan'; so_thieu := null; v_thieu_dem := v_thieu_dem + 1;
    elsif (g->>'ok')::boolean is not true then
      tt := 'thieu'; so_thieu := jsonb_array_length(g->'thieu'); v_thieu_dem := v_thieu_dem + 1;
    else
      tt := 'du'; so_thieu := 0; v_dem_du := v_dem_du + 1;
      v_tong := v_tong + (g->>'tong_gio')::numeric;
      if (g->>'tong_gio')::numeric > v_nang_gio then
        v_nang_gio := (g->>'tong_gio')::numeric; v_nang := jsonb_build_object('ten', r.ten, 'gio', (g->>'tong_gio')::numeric); end if;
      for i in 0 .. jsonb_array_length(g->'buoc') - 1 loop
        b := (g->'buoc')->i; hd := b->>'hoat_dong'; gi := (b->>'gio')::numeric;
        select ma_to into mato from kho.don_gia_baseline where hoat_dong = hd; mato := coalesce(mato,'?');
        v_to := jsonb_set(v_to, array[mato], to_jsonb(coalesce((v_to->>mato)::numeric,0) + gi));
      end loop;
    end if;
    v_mon := v_mon || jsonb_build_array(jsonb_build_object(
      'mon_id', r.id, 'sp_id', r.sp_id, 'ten', r.ten,
      'kt', coalesce(r.kt,''),
      'ma_quy_trinh', v_qt, 'goi_y', v_goi_y, 'ten_quy_trinh', v_qten,
      'trang_thai', tt, 'so_thieu', so_thieu, 'tong_gio', case when tt='du' then (g->>'tong_gio')::numeric else null end));
  end loop;

  v_khach_duyet := exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet');
  v_le_mau := (coalesce(v_dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don and m.dung_moi));

  return jsonb_build_object(
    'ma_don', p_ma_don,
    'ten_don', (select ten_khach from kho.don_hang where id = v_don),
    'trang_thai', v_tt,
    'da_vao_chuyen', (v_tt in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao')),
    'so_mon', v_dem, 'so_thieu_mon', v_thieu_dem,
    'day_duoc', (v_thieu_dem = 0 and v_dem > 0 and v_tt in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')),
    'co_khach_duyet', v_khach_duyet, 'le_mau_san', v_le_mau,
    'mon', v_mon,
    'dai_tong', case when v_dem > 1 then jsonb_build_object(
        'tong_gio', v_tong, 'dem_du', v_dem_du, 'so_mon', v_dem,
        'mon_nang_nhat', v_nang, 'theo_to', v_to) else null end);
end $$;
grant execute on function kho.nhap_so_don_don_hang(text) to authenticated;

-- ─────────── 10. nhap_so_don_cho() — DANH SÁCH đơn chờ nhập số (đã chốt, chưa gửi xưởng) ───────────
create or replace function kho.nhap_so_don_cho()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v_ns uuid; r record; v_out jsonb := '[]'::jsonb; st jsonb;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  v_ns := kho.current_ns();
  for r in select d.id, d.ma_don, d.ten_khach, d.trang_thai,
                  coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.tao_luc limit 1), 'Đơn '||d.ma_don) ten1
           from kho.don_hang d
           where d.trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')
             and (v_vai = 'ceo' or d.ma_ns_thiet_ke = v_ns)
           order by d.tao_luc loop
    st := kho.so_tt_don(r.id);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ma_don', r.ma_don, 'ten', coalesce(nullif(r.ten_khach,''), r.ten1), 'trang_thai', r.trang_thai,
      'so_mon', (st->>'so_mon')::int, 'tinh_trang', st->>'tinh_trang',
      'dem_du', (st->>'dem_du')::int, 'dem_thieu', (st->>'dem_thieu')::int, 'dem_chua_gan', (st->>'dem_chua_gan')::int));
  end loop;
  return v_out;
end $$;
grant execute on function kho.nhap_so_don_cho() to authenticated;

-- ─────────── 11. nhap_so_bang() — tình trạng số của MỌI đơn đã chốt (cho kanban) ───────────
create or replace function kho.nhap_so_bang()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; r record; v_out jsonb := '[]'::jsonb; st jsonb;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke','tk_ban_hang','truong_nhom_thiet_ke','xuong','ke_toan') then
    raise exception 'nhap_so_bang: vai không xem được'; end if;
  for r in select d.id, d.ma_don from kho.don_hang d
           where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','tam_ngung','huy') loop
    st := kho.so_tt_don(r.id);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ma_don', r.ma_don, 'so_mon', (st->>'so_mon')::int, 'tinh_trang', st->>'tinh_trang',
      'dem_du', (st->>'dem_du')::int, 'dem_thieu', (st->>'dem_thieu')::int, 'dem_chua_gan', (st->>'dem_chua_gan')::int));
  end loop;
  return v_out;
end $$;
grant execute on function kho.nhap_so_bang() to authenticated;

-- ─────────── 12. ban_giao_xuong — MỘT đường: lưu file · gác 3 chốt · đẩy cho_cat ───────────
--   Gộp gui_file_san_xuat (file + khách duyệt) và day_so_san_xuat (gán+số+trạng thái → cho_cat).
drop function if exists kho.day_so_san_xuat(text);   -- GỠ BỎ: từ thiết kế chỉ CÒN MỘT đường sang cho_cat
create or replace function kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; f jsonb; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'ban_giao_xuong: chỉ ceo/thiet_ke'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  -- quy đúng người cầm (thiet_ke)
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'ban_giao_xuong: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'ban_giao_xuong: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  -- ── chốt TRẠNG THÁI ──
  if v_don.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không gửi lại', p_ma_don, v_don.trang_thai; end if;
  if v_don.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_don.trang_thai not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không gửi được', p_ma_don, v_don.trang_thai; end if;
  -- ── chốt QUY TRÌNH + SỐ (theo món) ──
  select string_agg(ten, ', ') into v_chua_gan from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id)->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH') z;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  select string_agg(ten, ', ') into v_thieu_so from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id)->>'ok')::boolean is not true) z;
  if v_thieu_so is not null then raise exception 'THIEU_SO_DON_VI: món còn thiếu số: %', v_thieu_so; end if;
  -- ── chốt FILE CẮT ──
  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'THIEU_FILE_CAT: chưa đính kèm file cắt nào'; end if;
  -- ── chốt KHÁCH DUYỆT (trừ lẻ mẫu sẵn) ──
  v_le_mau := (coalesce(v_don.dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'CHUA_KHACH_DUYET: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT', p_ma_don; end if;

  -- ĐỦ 3 chốt → lưu file + đặt xong_file + đẩy cho_cat (qua cửa món tự đẩy, KHÔNG nới vai khác)
  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat');
end $$;
grant execute on function kho.ban_giao_xuong(text, jsonb, text) to authenticated;

commit;
