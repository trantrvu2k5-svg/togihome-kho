-- 068 — L-10: nền cho màn "Nhập số sản xuất" (app THIẾT KẾ).
--   THAY ĐỔI CẤU TRÚC DUY NHẤT: thêm cột so_don_vi_mon.bieu_thuc + CHECK. Còn lại là RPC (plumbing màn).
--   Guard tất cả RPC: ceo/thiet_ke (chặt hơn quy trình cũ — KHÔNG cho ke_toan/xuong vào màn này).
--   node ops/run_sql.mjs ../db/068_man_nhap_so.sql
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.nhap_so_don_don_hang(text); drop function if exists kho.nhap_so_chi_tiet_mon(text);
--   drop function if exists kho.quy_trinh_ds(); drop function if exists kho.gan_quy_trinh_mon(text,text);
--   drop function if exists kho.luu_so_don_vi(text,text,text,text); drop function if exists kho.day_so_san_xuat(text);
--   drop function if exists kho.tinh_bieu_thuc(text);
--   alter table kho.so_don_vi_mon drop constraint if exists sdv_bieu_thuc_ck; alter table kho.so_don_vi_mon drop column if exists bieu_thuc;
--   commit;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ════════ CỘT bieu_thuc (thay đổi cấu trúc DUY NHẤT) ════════
alter table kho.so_don_vi_mon add column if not exists bieu_thuc text;
alter table kho.so_don_vi_mon drop constraint if exists sdv_bieu_thuc_ck;
alter table kho.so_don_vi_mon add constraint sdv_bieu_thuc_ck
  check (bieu_thuc is null or bieu_thuc ~ '^[0-9+* ]*$');   -- server chặn ký tự lạ (test 2)

-- ════════ helper: tính biểu thức chỉ + và * (bind * chặt hơn +) ════════
create or replace function kho.tinh_bieu_thuc(p text)
  returns numeric language plpgsql immutable as $$
declare s text; term text; fac text; tong numeric := 0; tich numeric;
begin
  s := replace(coalesce(p,''), ' ', '');
  if s = '' then return null; end if;
  if s !~ '^[0-9]+([+*][0-9]+)*$' then raise exception 'BIEU_THUC_RAC: "%"', p; end if;   -- chỉ số/+/* hợp lệ
  foreach term in array string_to_array(s, '+') loop
    tich := 1;
    foreach fac in array string_to_array(term, '*') loop tich := tich * fac::numeric; end loop;
    tong := tong + tich;
  end loop;
  return tong;
end $$;

-- ════════ RPC ĐỌC · danh sách món + dải tổng của 1 đơn ════════
create or replace function kho.nhap_so_don_don_hang(p_ma_don text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_don uuid; v_tt text; r record; g jsonb; ql text; qten text; tt text; so_thieu int;
  v_mon jsonb := '[]'::jsonb; v_thieu_dem int := 0;
  v_tong numeric := 0; v_dem_du int := 0; v_dem int := 0;
  v_nang jsonb := null; v_nang_gio numeric := -1; v_to jsonb := '{}'::jsonb;
  b jsonb; i int; hd text; mato text; gi numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select id, trang_thai into v_don, v_tt from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  if v_tt in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" còn là báo giá, chưa chốt — lên đơn trước', p_ma_don; end if;

  for r in select dhm.sp_id, dhm.ten, dhm.so_luong, s.ma_loi, s.dai_mm, s.rong_mm, s.cao_mm, l.ma_quy_trinh, q.ten qten
           from kho.don_hang_mon dhm
           join kho.san_pham_mau s on s.ma = dhm.sp_id
           left join kho.san_pham_loi l on l.ma_loi = s.ma_loi
           left join kho.quy_trinh q on q.ma_quy_trinh = l.ma_quy_trinh
           where dhm.don_id = v_don and dhm.sp_id is not null
           order by dhm.tao_luc loop
    v_dem := v_dem + 1;
    g := kho.gio_du_kien_cua_mon(r.sp_id);
    if (g->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH' then
      tt := 'chua_gan'; so_thieu := null; v_thieu_dem := v_thieu_dem + 1;
    elsif (g->>'ok')::boolean is not true then
      tt := 'thieu'; so_thieu := jsonb_array_length(g->'thieu'); v_thieu_dem := v_thieu_dem + 1;
    else
      tt := 'du'; so_thieu := 0; v_dem_du := v_dem_du + 1;
      -- cộng dải tổng (PHẦN — chỉ món đủ); món nặng nhất; theo tổ
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
      'sp_id', r.sp_id, 'ma_loi', r.ma_loi, 'ten', r.ten,
      'kt', concat_ws('×', r.dai_mm::int, r.rong_mm::int, r.cao_mm::int),
      'ma_quy_trinh', r.ma_quy_trinh, 'ten_quy_trinh', r.qten,
      'trang_thai', tt, 'so_thieu', so_thieu, 'tong_gio', case when tt='du' then (g->>'tong_gio')::numeric else null end));
  end loop;

  return jsonb_build_object(
    'ma_don', p_ma_don,
    'ten_don', (select ten_khach from kho.don_hang where id = v_don),
    'trang_thai', v_tt,
    'da_vao_chuyen', (v_tt in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao')),
    'so_mon', v_dem, 'so_thieu_mon', v_thieu_dem,
    'day_duoc', (v_thieu_dem = 0 and v_dem > 0 and v_tt in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')),
    'mon', v_mon,
    'dai_tong', case when v_dem > 1 then jsonb_build_object(
        'tong_gio', v_tong, 'dem_du', v_dem_du, 'so_mon', v_dem,
        'mon_nang_nhat', v_nang, 'theo_to', v_to) else null end);
end $$;
grant execute on function kho.nhap_so_don_don_hang(text) to authenticated;

-- ════════ RPC ĐỌC · chi tiết bước + số của 1 món ════════
create or replace function kho.nhap_so_chi_tiet_mon(p_ma_bt text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_loi text; v_qt text; v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select ma_loi into v_loi from kho.san_pham_mau where ma = p_ma_bt;
  if not found then raise exception 'nhap_so: không có biến thể "%"', p_ma_bt; end if;
  if v_loi is null then return jsonb_build_object('chua_gan', true, 'buoc', '[]'::jsonb); end if;
  select ma_quy_trinh into v_qt from kho.san_pham_loi where ma_loi = v_loi;
  if v_qt is null then return jsonb_build_object('chua_gan', true, 'buoc', '[]'::jsonb); end if;
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
    left join kho.so_don_vi_mon sd on sd.ma_bien_the = p_ma_bt and sd.hoat_dong = b.hoat_dong
    where b.ma_quy_trinh = v_qt;
  return jsonb_build_object('chua_gan', false, 'ma_quy_trinh', v_qt, 'buoc', v_buoc);
end $$;
grant execute on function kho.nhap_so_chi_tiet_mon(text) to authenticated;

-- ════════ RPC ĐỌC · danh sách quy trình (dropdown) ════════
create or replace function kho.quy_trinh_ds()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('ma_quy_trinh', q.ma_quy_trinh, 'ten', q.ten,
            'so_buoc', (select count(*) from kho.quy_trinh_buoc b where b.ma_quy_trinh = q.ma_quy_trinh)) order by q.ten), '[]'::jsonb)
          from kho.quy_trinh q where coalesce(q.dang_dung, true));
end $$;
grant execute on function kho.quy_trinh_ds() to authenticated;

-- ════════ RPC GHI · gán quy trình cho lõi của món ════════
create or replace function kho.gan_quy_trinh_mon(p_ma_bt text, p_ma_qt text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_loi text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select ma_loi into v_loi from kho.san_pham_mau where ma = p_ma_bt;
  if v_loi is null then raise exception 'gan_quy_trinh: biến thể "%" chưa có lõi', p_ma_bt; end if;
  if not exists (select 1 from kho.quy_trinh where ma_quy_trinh = p_ma_qt) then raise exception 'gan_quy_trinh: quy trình "%" không có', p_ma_qt; end if;
  update kho.san_pham_loi set ma_quy_trinh = p_ma_qt where ma_loi = v_loi;
  return jsonb_build_object('ok', true, 'ma_loi', v_loi, 'ma_quy_trinh', p_ma_qt);
end $$;
grant execute on function kho.gan_quy_trinh_mon(text,text) to authenticated;

-- ════════ RPC GHI · lưu số đơn vị (LƯU CẢ BIỂU THỨC, validate server) ════════
create or replace function kho.luu_so_don_vi(p_ma_bt text, p_hoat_dong text, p_bieu_thuc text, p_nguon text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_so numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  if coalesce(p_nguon,'') not in ('cutlist','go_tay','uoc') then raise exception 'luu_so: nguồn phải cutlist/go_tay/uoc'; end if;
  -- trống → XOÁ dòng (món về thiếu)
  if coalesce(replace(p_bieu_thuc,' ',''),'') = '' then
    delete from kho.so_don_vi_mon where ma_bien_the = p_ma_bt and hoat_dong = p_hoat_dong;
    return jsonb_build_object('ok', true, 'xoa', true, 'so_don_vi', null);
  end if;
  v_so := kho.tinh_bieu_thuc(p_bieu_thuc);   -- raise BIEU_THUC_RAC nếu ký tự lạ
  insert into kho.so_don_vi_mon(ma_bien_the, hoat_dong, so_don_vi, nguon, bieu_thuc, nguoi_nhap, luc)
    values(p_ma_bt, p_hoat_dong, v_so, p_nguon, p_bieu_thuc, (select id from kho.nguoi_dung where auth_uid = auth.uid()), now())
    on conflict (ma_bien_the, hoat_dong) do update
      set so_don_vi = excluded.so_don_vi, nguon = excluded.nguon, bieu_thuc = excluded.bieu_thuc,
          nguoi_nhap = excluded.nguoi_nhap, luc = now();
  return jsonb_build_object('ok', true, 'so_don_vi', v_so, 'bieu_thuc', p_bieu_thuc);
end $$;
grant execute on function kho.luu_so_don_vi(text,text,text,text) to authenticated;

-- ════════ RPC GHI · đẩy xuống xưởng — FAIL-ĐÓNG SERVER (3 điều kiện, mã lỗi RIÊNG) + đổi cho_cat ════════
--   QD-12: thiết kế sản xuất được đẩy đơn sang cho_cat sau khi nhập đủ số. Đẩy qua cửa NÀY (đã gác a/b/c);
--   thiet_ke KHÔNG set cho_cat được bằng update thô (trigger chan_chuyen_theo_vai vẫn chặn). Cửa dùng
--   escape-hatch chan.tu_mon='1' (cơ chế "món tự đẩy" có sẵn) — KHÔNG nới quyền vai khác.
create or replace function kho.day_so_san_xuat(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_don uuid; v_tt text; r record; g jsonb; v_thieu_so text; v_chua_gan text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select id, trang_thai into v_don, v_tt from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;

  -- (c) trạng thái cho phép đẩy — không đẩy lại đơn đã vào chuyền
  if v_tt in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không đẩy lại', p_ma_don, v_tt; end if;
  if v_tt in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_tt not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không đẩy được', p_ma_don, v_tt; end if;

  -- (a) mọi món đã gán quy trình · (b) mọi món đủ số (bước 'nguoi')
  for r in select dhm.sp_id, dhm.ten from kho.don_hang_mon dhm where dhm.don_id = v_don and dhm.sp_id is not null loop
    g := kho.gio_du_kien_cua_mon(r.sp_id);
    if (g->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH' then v_chua_gan := concat_ws(', ', v_chua_gan, r.ten);
    elsif (g->>'ok')::boolean is not true then v_thieu_so := concat_ws(', ', v_thieu_so, r.ten); end if;
  end loop;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  if v_thieu_so  is not null then raise exception 'THIEU_SO_DON_VI: món thiếu số: %', v_thieu_so; end if;

  -- ĐỦ 3 điều kiện → chuyển cho_cat qua cửa gác (bypass trigger vai, KHÔNG nới vai khác)
  perform set_config('chan.tu_mon', '1', true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don;
  perform set_config('chan.tu_mon', '0', true);
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'tu', v_tt, 'den', 'cho_cat');
end $$;
grant execute on function kho.day_so_san_xuat(text) to authenticated;

commit;
