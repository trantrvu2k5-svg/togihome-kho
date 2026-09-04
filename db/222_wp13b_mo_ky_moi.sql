-- WP-13b L-2 · TẦNG DB: mở kỳ tham số mới bằng RPC + vết sửa + siết quyền 7 tham số vận hành.
-- CEO giao tự quyết. Q1 mở kỳ = chép tham_so + chi_phi_ky + luong_to (mỗi phần một cờ bật/tắt).
-- Q2 kỳ vừa chép mang nhãn CHƯA SOÁT (xac_nhan_luc IS NULL) tới khi xác nhận — KHÔNG chặn dùng
--    (Garrison ch.10: định mức đặt cho kỳ TỚI, không phải chép lại kỳ cũ; hệ đang đúng bệnh 09←08←07).
-- Q3 mở kỳ = ceo/ke_toan · sửa 7 tham số vận hành = CEO thôi.
-- Tái dùng khuôn: cpk_chep_ky_truoc (chép chi_phi_ky) + ghi_so_tham_so_xuong (ghi luong_to+phan_bo) — KHÔNG viết lại logic chép.

-- ═══ B1 · 4 cột vết sửa (đều NULL được; cột MỚI mặc định ĐÓNG với client — WP-11b) ═══
alter table kho.tham_so_tai_chinh add column if not exists nguoi_sua    text;
alter table kho.tham_so_tai_chinh add column if not exists sua_luc      timestamptz;
alter table kho.tham_so_tai_chinh add column if not exists chep_tu_ky   text;
alter table kho.tham_so_tai_chinh add column if not exists xac_nhan_luc timestamptz;
comment on column kho.tham_so_tai_chinh.chep_tu_ky   is 'WP-13b: kỳ nguồn đã chép sang (NULL = kỳ gốc nhập tay)';
comment on column kho.tham_so_tai_chinh.xac_nhan_luc is 'WP-13b: NULL = CHƯA SOÁT (kỳ vừa chép). Có giá trị = đã xác nhận số kỳ này';

-- Client ĐỌC được vết sửa (SELECT), nhưng KHÔNG ghi (không cấp UPDATE → PATCH 4 cột này = 403).
grant select (nguoi_sua, sua_luc, chep_tu_ky, xac_nhan_luc) on kho.tham_so_tai_chinh to authenticated;

-- ═══ B2 · RPC mo_ky_moi — chỉ cho mở kỳ LIỀN SAU kỳ mới nhất ═══
create or replace function kho.mo_ky_moi(
  p_ky           text,
  p_chep_tu      text    default null,
  p_chep_chi_phi boolean default true,
  p_chep_luong   boolean default true
) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $$
declare
  v_vai        text;
  v_nguoi      text;
  v_nguon      text;     -- kỳ nguồn (mặc định = kỳ mới nhất)
  v_latest_ky  text;
  v_latest_ngay date;
  v_next_ky    text;
  v_ngay_moi   date;
  v_cols text; v_sel text; v_n int;
  v_luong jsonb; v_phanbo jsonb;
  v_so_cp int := 0; v_so_luong int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(), '');
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'mo_ky_moi: vai "%" không được mở kỳ (chỉ ceo/ke_toan)', v_vai; end if;
  v_nguoi := coalesce(auth.uid()::text, 'he_thong');

  if p_ky is null or p_ky !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'mo_ky_moi: kỳ "%" sai dạng — phải YYYY-MM', p_ky; end if;

  select ma_ky, ngay_ap_dung
    into v_latest_ky, v_latest_ngay
    from kho.tham_so_tai_chinh
    order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;
  if v_latest_ngay is null then
    raise exception 'mo_ky_moi: chưa có kỳ nào để làm nguồn — tạo kỳ gốc bằng SQL tầng owner trước'; end if;

  v_next_ky  := to_char(v_latest_ngay + interval '1 month', 'YYYY-MM');
  v_ngay_moi := (p_ky || '-01')::date;
  v_nguon    := coalesce(p_chep_tu, v_latest_ky);

  -- CHẶN 1: kỳ đã tồn tại
  if exists (select 1 from kho.tham_so_tai_chinh where ma_ky = p_ky) then
    raise exception 'mo_ky_moi: kỳ "%" đã tồn tại — không mở đè', p_ky; end if;
  -- CHẶN 2: kỳ quá khứ (≤ kỳ mới nhất)
  if v_ngay_moi <= v_latest_ngay then
    raise exception 'mo_ky_moi: kỳ "%" là quá khứ (kỳ mới nhất là %) — không mở lùi', p_ky, v_latest_ky; end if;
  -- CHẶN 3: kỳ nhảy cóc (chỉ cho LIỀN SAU; muốn khác phải SQL tầng owner như db/221)
  if p_ky <> v_next_ky then
    raise exception 'mo_ky_moi: kỳ "%" nhảy cóc — chỉ cho mở kỳ liền sau "%". Muốn khác: SQL tầng owner (xem db/221)', p_ky, v_next_ky; end if;

  -- Chép tham_so_tai_chinh: toàn bộ cột từ kỳ nguồn, override ma_ky/ngay_ap_dung + vết sửa + nhãn chưa-soát.
  -- (khuôn chép động y db/221; 4 cột vết sửa NẰM TRONG danh sách cột → phải override tường minh)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(
           case column_name
             when 'ma_ky'        then quote_literal(p_ky)
             when 'ngay_ap_dung' then quote_literal(v_ngay_moi::text) || '::date'
             when 'chep_tu_ky'   then quote_literal(v_nguon)
             when 'nguoi_sua'    then quote_literal(v_nguoi)
             when 'sua_luc'      then 'now()'
             when 'xac_nhan_luc' then 'null::timestamptz'  -- NULL = nhãn CHƯA SOÁT (Q2). ghi_chu + mọi cột khác chép NGUYÊN.
             else quote_ident(column_name)
           end, ', ' order by ordinal_position)
    into v_cols, v_sel
    from information_schema.columns
    where table_schema='kho' and table_name='tham_so_tai_chinh';

  execute format('insert into kho.tham_so_tai_chinh (%s) select %s from kho.tham_so_tai_chinh where ma_ky = %L',
                 v_cols, v_sel, v_nguon);
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'mo_ky_moi: chép tham_so % dòng (phải 1) — kỳ nguồn "%" không có?', v_n, v_nguon; end if;

  -- Chép chi_phi_ky: tái dùng cpk_chep_ky_truoc (chép từ kỳ LIỀN TRƯỚC = nguồn mặc định)
  if p_chep_chi_phi then
    perform kho.cpk_chep_ky_truoc(p_ky);
    select count(*) into v_so_cp from kho.chi_phi_ky where ma_ky = p_ky;
  end if;

  -- Chép luong_to + phan_bo_hoat_dong: tái dùng ghi_so_tham_so_xuong (dựng jsonb từ kỳ nguồn)
  if p_chep_luong then
    select coalesce(jsonb_agg(jsonb_build_object(
             'ma_to', ma_to, 'so_nguoi', so_nguoi, 'luong_to', luong_to,
             'overhead_phan_bo', overhead_phan_bo, 'bao_hiem', bao_hiem, 'ghi_chu', ghi_chu)), '[]'::jsonb)
      into v_luong from kho.luong_to where ma_ky = v_nguon;
    select coalesce(jsonb_agg(jsonb_build_object(
             'ma_to', ma_to, 'hoat_dong', hoat_dong, 'phan_tram_thoi_gian', phan_tram_thoi_gian)), '[]'::jsonb)
      into v_phanbo from kho.phan_bo_hoat_dong where ma_ky = v_nguon;
    perform kho.ghi_so_tham_so_xuong(p_ky, v_luong, v_phanbo);
    select count(*) into v_so_luong from kho.luong_to where ma_ky = p_ky;
  end if;

  return jsonb_build_object(
    'ok', true, 'ky_moi', p_ky, 'ky_nguon', v_nguon,
    'so_dong_chi_phi_ky', v_so_cp, 'so_dong_luong_to', v_so_luong,
    'chua_soat', true);
end $$;

alter function kho.mo_ky_moi(text,text,boolean,boolean) owner to postgres;
revoke execute on function kho.mo_ky_moi(text,text,boolean,boolean) from public, anon;
grant  execute on function kho.mo_ky_moi(text,text,boolean,boolean) to authenticated;

-- ═══ B3 · RPC xac_nhan_ky — bỏ nhãn chưa-soát ═══
create or replace function kho.xac_nhan_ky(p_ky text) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $$
declare v_vai text; v_nguoi text; v_da timestamptz; v_n int;
begin
  v_vai := coalesce(kho.current_vai_tro(), '');
  if v_vai not in ('ceo','ke_toan') then
    raise exception 'xac_nhan_ky: vai "%" không được xác nhận (chỉ ceo/ke_toan)', v_vai; end if;
  v_nguoi := coalesce(auth.uid()::text, 'he_thong');

  select xac_nhan_luc into v_da from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found then raise exception 'xac_nhan_ky: kỳ "%" không tồn tại', p_ky; end if;
  if v_da is not null then
    raise exception 'xac_nhan_ky: kỳ "%" đã xác nhận lúc %', p_ky, v_da; end if;

  update kho.tham_so_tai_chinh
     set xac_nhan_luc = now(), nguoi_sua = v_nguoi, sua_luc = now()
   where ma_ky = p_ky;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'ma_ky', p_ky, 'xac_nhan', v_n = 1);
end $$;

alter function kho.xac_nhan_ky(text) owner to postgres;
revoke execute on function kho.xac_nhan_ky(text) from public, anon;
grant  execute on function kho.xac_nhan_ky(text) to authenticated;

-- ═══ B4 · Siết luu_cau_hinh_van_hanh: ceo/ke_toan → CEO thôi (Q3) + ghi thêm vết sửa ═══
create or replace function kho.luu_cau_hinh_van_hanh(
  p_ma_ky text,
  p_vat numeric, p_gio_mo_cua jsonb, p_ghi_de int,
  p_n_ads numeric, p_n_cac numeric, p_n_kg numeric, p_n_no numeric, p_n_giam numeric
) returns jsonb
language plpgsql security definer set search_path = kho, pg_temp as $$
declare v_n int; v_vai text; v_nguoi text;
begin
  v_vai := coalesce(kho.current_vai_tro(), '');
  if v_vai <> 'ceo' then
    raise exception 'luu_cau_hinh_van_hanh: vai "%" không được sửa 7 tham số vận hành (chỉ CEO)', v_vai; end if;
  v_nguoi := coalesce(auth.uid()::text, 'he_thong');
  update kho.tham_so_tai_chinh set
    vat = p_vat, gio_mo_cua = p_gio_mo_cua, ghi_de = p_ghi_de,
    n_ads = p_n_ads, n_cac = p_n_cac, n_kg = p_n_kg, n_no = p_n_no, n_giam = p_n_giam,
    nguoi_sua = v_nguoi, sua_luc = now()
   where ma_ky = p_ma_ky;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'luu_cau_hinh_van_hanh: kỳ "%" chưa có tham số — tạo kỳ trước', p_ma_ky; end if;
  return jsonb_build_object('ok', true, 'ma_ky', p_ma_ky, 'so_cot', 8);
end $$;

alter function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) owner to postgres;
revoke execute on function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) from public, anon;
grant  execute on function kho.luu_cau_hinh_van_hanh(text,numeric,jsonb,int,numeric,numeric,numeric,numeric,numeric) to authenticated;
