-- CHAY_THU.sql — chạy thử ĐƯỜNG GIÁ trên schema ĐÃ ÁP (027 + 028). Tự ROLLBACK, KHÔNG đổi prod.
--   psql "<DATABASE_URL>" -f db/CHAY_THU.sql
--   (hoặc bản đầy đủ có ngữ cảnh JWT theo vai trò: node web/ops/test_duong_gia.mjs — áp 027+028 trong tx rồi rollback)
--
--   In cả bản ĐỎ (công thức V2 cũ) lẫn XANH (SPEC mới) cho 3 ca, + kiểm RLS chặn sale.
--   Dùng he_so_m = 1.25 làm SỐ THỬ (prod để NULL tới khi tinh_he_so_m có đủ số thật).
begin;

-- ══════════ 3 CA CÔNG THỨC ══════════
do $$
declare
  s record; gv numeric; m numeric := 1.25;          -- he_so_m THỬ
  hh numeric; phi numeric;
  a_old numeric; a_new numeric;
  sumt numeric := 0; t1 numeric; new_don numeric; old_don numeric := 0; phi_new numeric; phi_old numeric;
  gcg_tb numeric := 7572414; N1 int; N2 int := 580;
  c_new1 numeric; c_new2 numeric; c_old1 numeric; c_old2 numeric;
begin
  select hh_sale+hh_quan_ly+hh_thiet_ke, phi_don_le into hh, phi
    from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1;

  -- ── Ca A: he_so_nhom 0,75 một món — giá bán phải VẪN > giá vốn ──
  select ma, gia_von into s from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 1;
  gv := s.gia_von;
  a_old := round(gv * m * 0.75);                    -- V2 CŨ: × nhom vào TOÀN giá
  a_new := round(gv * (1 + (m-1)*0.75));            -- SPEC MỚI: nhom chỉ vào phần lãi
  raise notice 'Ca A  gv=%  | V2 cũ=% (%)  | SPEC mới=% (%)',
    gv, a_old, case when a_old<gv then 'ĐỎ tụt<vốn' else '??' end,
    a_new, case when a_new>gv then 'XANH >vốn' else '??' end;
  if a_old >= gv then raise exception 'Ca A: V2 cũ đáng lẽ tụt dưới vốn'; end if;
  if a_new <= gv then raise exception 'Ca A: SPEC mới phải trên vốn'; end if;

  -- ── Ca B: đơn 3 món — phi_don xuất hiện đúng 1 lần ──
  for s in select ma, gia_von from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 3 loop
    t1 := round(s.gia_von * (1 + (m-1)*1));          -- tang_1, nhom=1
    sumt := sumt + t1;
    old_don := old_don + round((t1 + phi) / (1 - hh));  -- V2 CŨ: phi ở tầng MÓN -> cộng mỗi món
  end loop;
  new_don := round((sumt + phi) / (1 - hh));         -- SPEC MỚI: phi 1 lần
  phi_new := round(new_don*(1-hh) - sumt);
  phi_old := round(old_don*(1-hh) - sumt);
  raise notice 'Ca B  Σtang1=%  | ĐƠN mới=% (phi≈% =1×)  | V2 cũ=% (phi≈% =3×)',
    sumt, new_don, phi_new, old_don, phi_old;
  if abs(phi_new - phi)     > 3 then raise exception 'Ca B: đơn mới phải có phi 1 lần'; end if;
  if abs(phi_old - 3*phi)   > 3 then raise exception 'Ca B: V2 cũ đáng lẽ phi 3 lần'; end if;

  -- ── Ca C: tăng dt VÀ so_don cùng tỷ lệ → he_so_m gần như KHÔNG đổi ──
  N1 := round(N2 * 5.8 / 7.0);                        -- ≈481
  c_new1 := (5.8e9*(1-hh) - phi*N1) / (gcg_tb*N1);    -- MỚI: mẫu số theo sản lượng KH
  c_new2 := (7.0e9*(1-hh) - phi*N2) / (gcg_tb*N2);
  c_old1 := (5.8e9*(1-hh) - phi*N1) / (gcg_tb*N1);    -- CŨ: mẫu số CỐ ĐỊNH ở N1 trong khi dt tăng
  c_old2 := (7.0e9*(1-hh) - phi*N1) / (gcg_tb*N1);
  raise notice 'Ca C  MỚI %→% (lệch %)  | CŨ mẫu-cố-định %→% (nhảy %)',
    round(c_new1,4), round(c_new2,4), round(abs(c_new2-c_new1)/c_new1*100,2)||'%',
    round(c_old1,4), round(c_old2,4), round(abs(c_old2-c_old1)/c_old1*100,1)||'%';
  if abs(c_new2-c_new1)/c_new1 >= 0.01 then raise exception 'Ca C: SPEC mới phải ổn định <1%%'; end if;
  if abs(c_old2-c_old1)/c_old1 <= 0.15 then raise exception 'Ca C: bản cũ đáng lẽ nhảy >15%%'; end if;

  raise notice '3 CA: XANH ✅';
end $$;

-- ══════════ RLS: sale bị CHẶN tham số + giá vốn ══════════
select set_config('chaythu.sale_uid',
  (select auth_uid::text from kho.nguoi_dung where vai_tro='sale' and dang_hoat_dong and auth_uid is not null limit 1), false);

savepoint rls;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('chaythu.sale_uid'), 'role','authenticated')::text, true);
do $$ begin
  if (select count(*) from kho.tham_so_tai_chinh)    <> 0 then raise exception 'RLS: sale KHÔNG được đọc tham_so_tai_chinh'; end if;
  if (select count(*) from kho.san_pham_mau_gia_von) <> 0 then raise exception 'RLS: sale KHÔNG được đọc giá vốn'; end if;
  perform 1 from kho.gia_niem_yet;                          -- sale ĐỌC được (không lỗi)
  raise notice 'RLS: sale bị chặn tham_so + giá vốn, đọc được gia_niem_yet ✅';
end $$;
rollback to savepoint rls;
reset role;

rollback;   -- KHÔNG đổi prod
