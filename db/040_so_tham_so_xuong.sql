-- 040 — S6 SỔ THAM SỐ XƯỞNG: ke_toan nhập lương tổ + % thời gian -> 12 đơn giá hoạt động.
--   db/038 dựng luong_to + phan_bo_hoat_dong nhưng KHÔNG có màn nhập + ke_toan KHÔNG ghi được (RLS ghi =
--   ceo/kho/xuong/tho). Lô này: RPC ghi (guard ceo/ke_toan, SECURITY DEFINER) — KHÔNG sửa policy, KHÔNG đụng
--   quyền kho/tho (CEO ghi sổ nợ: kho/tho ghi được lương là SAI, nhưng KHÔNG sửa lô này).
--   node ops/run_sql... — ⚠ CHỜ CEO DUYỆT PROTOTYPE. CHƯA áp prod.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.so_sanh_don_gia(text), kho.ket_qua_don_gia(text),
--     kho.ghi_so_tham_so_xuong(text, jsonb, jsonb);
--   drop table if exists kho.don_gia_baseline;
--   alter table kho.luong_to drop column if exists so_nguoi;
--   alter table kho.luong_to drop column if exists ghi_chu;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. Cột thêm vào luong_to: so_nguoi + ghi_chu. (BỎ ngay_hieu_luc — bảng đã khoá theo ma_ky, thêm ngày hiệu
--    lực = hai cơ chế thời gian chồng nhau, sẽ đá nhau — CEO 2026-08-10.)
alter table kho.luong_to add column if not exists so_nguoi integer check (so_nguoi is null or so_nguoi >= 0);
alter table kho.luong_to add column if not exists ghi_chu  text;

-- 2. Baseline "đơn giá ĐANG DÙNG" — snapshot từ plugin don_gia_hoat_dong.json (kỳ 2026-07, mẫu số [TẠM]).
--    so_sanh_don_gia đối chiếu đơn giá TÍNH RA (đếm thật) vs baseline này. CHỈ để CEO đối chiếu, KHÔNG ghi đè file.
create table if not exists kho.don_gia_baseline (
  hoat_dong text primary key,
  ma_to     text,
  mau_so    numeric,   -- mẫu số ĐỊNH MỨC THÁNG [TẠM] (khác cơ sở với đếm-thật-trong-kỳ)
  don_gia   numeric,
  nguon     text
);
insert into kho.don_gia_baseline(hoat_dong,ma_to,mau_so,don_gia,nguon) values
  ('cat','cnc',12500,3360,'json plugin [TẠM] 2026-07'),
  ('dan','dan_canh',13500,2613,'json plugin [TẠM] 2026-07'),
  ('cam','dan_canh',36000,420,'json plugin [TẠM] 2026-07'),
  ('lot','cha_lot',8700,10460,'json plugin [TẠM] 2026-07'),
  ('pu','son_pu',6200,5690,'json plugin [TẠM] 2026-07'),
  ('cup','lap_rap',4800,3194,'json plugin [TẠM] 2026-07'),
  ('thung','lap_rap',8400,5475,'json plugin [TẠM] 2026-07'),
  ('ray','lap_rap',600,42584,'json plugin [TẠM] 2026-07 (ray 25% — [TẠM chờ tổ trưởng Lắp ráp])'),
  ('canh','lap_rap',1200,12775,'json plugin [TẠM] 2026-07 (canh 15% — [TẠM chờ tổ trưởng Lắp ráp])'),
  ('goi','dong_goi',2100,34001,'json plugin [TẠM] 2026-07'),
  ('son_canh','son_pu',3000,5040,'json plugin [TẠM] 2026-07'),
  ('giuong_lap','giuong',200,231006,'json plugin [TẠM] 2026-07')
  on conflict (hoat_dong) do update set ma_to=excluded.ma_to, mau_so=excluded.mau_so,
    don_gia=excluded.don_gia, nguon=excluded.nguon;
grant select on kho.don_gia_baseline to authenticated;
revoke all on kho.don_gia_baseline from anon;
alter table kho.don_gia_baseline enable row level security;
drop policy if exists dgb_doc on kho.don_gia_baseline;
create policy dgb_doc on kho.don_gia_baseline for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));

-- 3. RPC ghi sổ tham số xưởng — guard ceo/ke_toan (ke_toan KHÔNG ghi bảng trực tiếp -> SECURITY DEFINER).
--    Ghi ĐÈ trọn kỳ (xoá cũ + chèn mới). Deferred trigger kiem_phan_bo_100 kiểm 100% mỗi tổ LÚC COMMIT.
--    p_luong   = [{ma_to, so_nguoi, luong_to, overhead_phan_bo, bao_hiem, ghi_chu}]
--    p_phan_bo = [{ma_to, hoat_dong, phan_tram_thoi_gian}]
create or replace function kho.ghi_so_tham_so_xuong(p_ma_ky text, p_luong jsonb, p_phan_bo jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare r jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'ghi_so_tham_so_xuong: chỉ ceo/ke_toan'; end if;
  if p_ma_ky is null or p_ma_ky = '' then raise exception 'ghi_so_tham_so_xuong: thiếu ma_ky'; end if;
  delete from kho.luong_to where ma_ky = p_ma_ky;
  delete from kho.phan_bo_hoat_dong where ma_ky = p_ma_ky;
  for r in select * from jsonb_array_elements(coalesce(p_luong, '[]'::jsonb)) loop
    insert into kho.luong_to(ma_ky, ma_to, so_nguoi, luong_to, overhead_phan_bo, bao_hiem, ghi_chu)
      values(p_ma_ky, r->>'ma_to', nullif(r->>'so_nguoi','')::int, nullif(r->>'luong_to','')::numeric,
             nullif(r->>'overhead_phan_bo','')::numeric, nullif(r->>'bao_hiem','')::numeric, r->>'ghi_chu');
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_phan_bo, '[]'::jsonb)) loop
    insert into kho.phan_bo_hoat_dong(ma_ky, ma_to, hoat_dong, phan_tram_thoi_gian)
      values(p_ma_ky, r->>'ma_to', r->>'hoat_dong', (r->>'phan_tram_thoi_gian')::numeric);
  end loop;
  return jsonb_build_object('ok', true, 'ma_ky', p_ma_ky,
    'so_to', jsonb_array_length(coalesce(p_luong,'[]'::jsonb)),
    'so_phan_bo', jsonb_array_length(coalesce(p_phan_bo,'[]'::jsonb)));
end $$;
grant execute on function kho.ghi_so_tham_so_xuong(text, jsonb, jsonb) to authenticated;

-- 4. ket_qua_don_gia(ma_ky) — 12 dòng. Mẫu số theo thứ tự tem -> kho -> phiếu đếm -> san_luong_don (plugin dự tính).
--    Thiếu -> NULL + trạng thái "THIẾU <cái gì>", KHÔNG ra 0.
create or replace function kho.ket_qua_don_gia(p_ma_ky text)
  returns table(hoat_dong text, ma_to text, phan_tram numeric, luong_phan_bo numeric,
                mau_so numeric, nguon_mau_so text, don_gia numeric, trang_thai text)
  language plpgsql stable security definer set search_path = kho as $$
declare
  MAP text[][] := array[
    array['cat','cnc'], array['dan','dan_canh'], array['cam','dan_canh'], array['lot','cha_lot'],
    array['pu','son_pu'], array['cup','lap_rap'], array['thung','lap_rap'], array['ray','lap_rap'],
    array['canh','lap_rap'], array['goi','dong_goi'], array['son_canh','son_pu'], array['giuong_lap','giuong']];
  i int; hd text; mt text; pt numeric; lt numeric; lpb numeric; ms numeric; ng text; thieu text[];
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'ket_qua_don_gia: chỉ ceo/ke_toan'; end if;
  for i in 1 .. array_length(MAP,1) loop
    hd := MAP[i][1]; mt := MAP[i][2];
    select p.phan_tram_thoi_gian into pt from kho.phan_bo_hoat_dong p
      where p.ma_ky=p_ma_ky and p.ma_to=mt and p.hoat_dong=hd;
    select (coalesce(l.luong_to,0)+coalesce(l.overhead_phan_bo,0)+coalesce(l.bao_hiem,0)) into lt
      from kho.luong_to l where l.ma_ky=p_ma_ky and l.ma_to=mt;
    lpb := case when pt is not null and lt is not null then lt * pt / 100.0 else null end;
    -- MẪU SỐ: tem -> kho -> phiếu đếm -> san_luong_don (plugin dự tính)
    ms := null; ng := null;
    begin ms := kho.driver_tu_tem(p_ma_ky, hd); exception when others then ms := null; end;
    if ms is not null and ms > 0 then ng := 'từ tem';
    else
      begin ms := kho.driver_tu_kho(p_ma_ky, hd); exception when others then ms := null; end;
      if ms is not null and ms > 0 then ng := 'từ kho';
      else
        select sum(pdn.so_luong) into ms from kho.phieu_dem_ngay pdn
          where pdn.hoat_dong=hd and to_char(pdn.ngay,'YYYY-MM')=p_ma_ky;
        if ms is not null and ms > 0 then ng := 'từ phiếu đếm';
        else
          execute format('select coalesce(sum(s.%I),0) from kho.san_luong_don s join kho.don_hang d on d.ma_don=s.ma_don where d.ma_ky_ap_dung=$1', hd)
            into ms using p_ma_ky;
          if ms is not null and ms > 0 then ng := 'từ plugin (dự tính)'; else ms := null; ng := null; end if;
        end if;
      end if;
    end if;
    -- trạng thái + đơn giá
    thieu := array[]::text[];
    if pt is null then thieu := array_append(thieu, '% thời gian'); end if;
    if lt is null then thieu := array_append(thieu, 'lương tổ'); end if;
    if ms is null then thieu := array_append(thieu, 'mẫu số'); end if;
    hoat_dong := hd; ma_to := mt; phan_tram := pt; luong_phan_bo := lpb;
    mau_so := ms; nguon_mau_so := coalesce(ng, 'THIẾU');
    if array_length(thieu,1) is null then
      trang_thai := 'ĐỦ SỐ'; don_gia := round(lpb / ms);
    else
      trang_thai := 'THIẾU ' || array_to_string(thieu, ', '); don_gia := null;
    end if;
    return next;
  end loop;
end $$;
grant execute on function kho.ket_qua_don_gia(text) to authenticated;

-- 5. so_sanh_don_gia(ma_ky) — đặt cạnh nhau đơn giá TÍNH RA (đếm thật) vs ĐANG DÙNG (json định mức tháng).
--    + so_ngay_co_du_lieu: số ngày trong kỳ THỰC SỰ có dữ liệu đếm (kỳ mới đếm vài ngày mà lệch nhiều = bình thường).
create or replace function kho.so_sanh_don_gia(p_ma_ky text)
  returns table(hoat_dong text, ma_to text, don_gia_tinh numeric, don_gia_dang_dung numeric,
                lech_pct numeric, so_ngay_co_du_lieu int, nguon_mau_so text, trang_thai text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'so_sanh_don_gia: chỉ ceo/ke_toan'; end if;
  return query
  select k.hoat_dong, k.ma_to, k.don_gia, b.don_gia,
    case when k.don_gia is not null and b.don_gia is not null and b.don_gia <> 0
      then round((k.don_gia - b.don_gia) / b.don_gia * 100, 1) else null end,
    case k.nguon_mau_so
      when 'từ tem' then (select count(distinct l.ngay)::int from kho.lan_in_tem l where to_char(l.ngay,'YYYY-MM')=p_ma_ky)
      when 'từ kho' then (select count(distinct g.tao_luc::date)::int from kho.giao_dich g where g.loai='xuat' and to_char(g.tao_luc,'YYYY-MM')=p_ma_ky)
      when 'từ phiếu đếm' then (select count(distinct pd.ngay)::int from kho.phieu_dem_ngay pd where pd.hoat_dong=k.hoat_dong and to_char(pd.ngay,'YYYY-MM')=p_ma_ky)
      else 0 end,
    k.nguon_mau_so, k.trang_thai
  from kho.ket_qua_don_gia(p_ma_ky) k
  left join kho.don_gia_baseline b on b.hoat_dong = k.hoat_dong;
end $$;
grant execute on function kho.so_sanh_don_gia(text) to authenticated;

commit;
