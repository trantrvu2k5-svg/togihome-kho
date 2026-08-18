-- 108 — P/L NỘI BỘ (contribution format, Garrison ch.6) + SỔ CHI PHÍ KỲ (actuals).
--   ⚠ IDEMPOTENT: create table if not exists + create or replace function → chạy ĐÚNG 1 LẦN vẫn an toàn chạy lại.
--   Bảng chi_phi_ky = sổ ACTUALS chi phí kỳ (tách khỏi tham_so_tai_chinh = dự toán). 7 loại, phan_khuc NULL = CHUNG.
--   RPC: cpk_ds / cpk_ghi / cpk_chep_ky_truoc / pl_ky. TẤT CẢ guard coalesce(current_vai_tro(),'') ∈ {ceo,ke_toan}.
--   pl_ky: doanh thu thuần = SUM(gia_chot)/(1+vat/100) theo dong; k1/k2/k3 join don_hang_gia_von; ship_lap = ship+lap thực trả;
--          hoa_hong = (hh_sale+hh_quan_ly+hh_thiet_ke) × doanh_thu_thuan (hh_* là PHÂN SỐ, khớp gia_bac_tu_gv);
--          dinh_phi_truy = chi_phi_ky phan_khuc NOT NULL; dinh_phi_chung = phan_khuc NULL (chỉ cột toàn cty).
--          vat/hh đọc tham_so ĐÚNG kỳ — thiếu → FAIL-ĐÓNG (raise), KHÔNG lấy kỳ khác. Đơn thiếu giá vốn: vẫn tính doanh thu, đếm cảnh báo.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.pl_ky(text), kho.cpk_ds(text), kho.cpk_ghi(text,jsonb), kho.cpk_chep_ky_truoc(text);
--   drop table if exists kho.chi_phi_ky;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. BẢNG chi_phi_ky (sổ actuals) ═══════════════
create table if not exists kho.chi_phi_ky (
  id           bigserial primary key,
  ma_ky        text not null,                      -- '2026-08'
  loai         text not null check (loai in ('luong_vp','luong_sale','marketing_ads','thue_mat_bang','khau_hao','dien_nuoc_vh','khac')),
  so_tien      numeric not null check (so_tien >= 0),
  phan_khuc    text check (phan_khuc in ('le','combo','du_an')),  -- NULL = CHUNG (định phí chung, không rải)
  ghi_chu      text,
  nguoi_nhap   text,
  cap_nhat_luc timestamptz default now()
);
create index if not exists idx_chi_phi_ky_ma_ky on kho.chi_phi_ky(ma_ky);

grant select on kho.chi_phi_ky to authenticated;
revoke all on kho.chi_phi_ky from anon;
alter table kho.chi_phi_ky enable row level security;
drop policy if exists cpk_doc on kho.chi_phi_ky;
create policy cpk_doc on kho.chi_phi_ky for select using (kho.current_vai_tro() = any(array['ceo','ke_toan']));
-- Ghi CHỈ qua RPC SECURITY DEFINER (bypass RLS) — không mở policy insert/update/delete cho client.

-- ═══════════════ 2. cpk_ds(p_ky) — dòng chi của kỳ, ORDER loai, LIMIT 500 ═══════════════
create or replace function kho.cpk_ds(p_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v jsonb; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cpk_ds: chỉ ceo/ke_toan'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.loai),'[]'::jsonb), coalesce(sum(x.so_tien),0)
    into v, v_tong
  from (select id, ma_ky, loai, so_tien, phan_khuc, ghi_chu, nguoi_nhap, cap_nhat_luc
        from kho.chi_phi_ky where ma_ky = p_ky order by loai limit 500) x;
  return jsonb_build_object('ma_ky', p_ky, 'ds', v, 'tong_ky', v_tong);
end $$;
grant execute on function kho.cpk_ds(text) to authenticated;

-- ═══════════════ 3. cpk_ghi(p_ky, p_dong) — thay TRỌN bộ dòng của kỳ (delete+insert 1 transaction) ═══════════════
create or replace function kho.cpk_ghi(p_ky text, p_dong jsonb)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; v_n int := 0;
        v_nguoi text := coalesce((select ho_ten from kho.nguoi_dung where id = kho.current_ns()), '');
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cpk_ghi: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky = '' then raise exception 'cpk_ghi: thiếu ma_ky'; end if;
  delete from kho.chi_phi_ky where ma_ky = p_ky;
  for r in select * from jsonb_array_elements(coalesce(p_dong, '[]'::jsonb)) loop
    insert into kho.chi_phi_ky(ma_ky, loai, so_tien, phan_khuc, ghi_chu, nguoi_nhap)
      values (p_ky, r->>'loai', coalesce(nullif(r->>'so_tien','')::numeric, 0),
              nullif(r->>'phan_khuc',''), nullif(r->>'ghi_chu',''),
              coalesce(nullif(r->>'nguoi_nhap',''), v_nguoi));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ma_ky', p_ky, 'so_dong', v_n);
end $$;
grant execute on function kho.cpk_ghi(text, jsonb) to authenticated;

-- ═══════════════ 4. cpk_chep_ky_truoc(p_ky) — chép từ kỳ liền trước; kỳ đã có dòng thì TỪ CHỐI ═══════════════
create or replace function kho.cpk_chep_ky_truoc(p_ky text)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_truoc text; v_n int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cpk_chep_ky_truoc: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky = '' then raise exception 'cpk_chep_ky_truoc: thiếu ma_ky'; end if;
  if exists (select 1 from kho.chi_phi_ky where ma_ky = p_ky) then
    raise exception 'cpk_chep_ky_truoc: kỳ % đã có dòng chi phí — không chép đè', p_ky; end if;
  v_truoc := to_char((to_date(p_ky,'YYYY-MM') - interval '1 month'), 'YYYY-MM');
  select count(*) into v_n from kho.chi_phi_ky where ma_ky = v_truoc;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'ma_ky_truoc', v_truoc, 'so_dong', 0,
      'msg', 'Kỳ trước (' || v_truoc || ') không có dòng nào để chép'); end if;
  insert into kho.chi_phi_ky(ma_ky, loai, so_tien, phan_khuc, ghi_chu, nguoi_nhap)
    select p_ky, loai, so_tien, phan_khuc, ghi_chu, nguoi_nhap from kho.chi_phi_ky where ma_ky = v_truoc;
  return jsonb_build_object('ok', true, 'ma_ky_truoc', v_truoc, 'so_dong', v_n);
end $$;
grant execute on function kho.cpk_chep_ky_truoc(text) to authenticated;

-- ═══════════════ 5. pl_ky(p_ky) — MỘT lần gọi trả đủ P/L (mọi dòng × mọi cột phân khúc) ═══════════════
create or replace function kho.pl_ky(p_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
  -- jit=off: query gộp 100k đơn có cost đủ cao để kích JIT-compile (~300ms/lần cold); JIT KHÔNG bõ cho 1 lần chạy → tắt.
declare
  t record; v_vat numeric; v_hh numeric; v_from date; v_to date;
  v_base jsonb; v_truy jsonb; v_chung numeric; v_thieu_n int; v_thieu_ds text[];
  v_seg text; v_segs text[] := array['le','combo','du_an','khac'];
  sum_gc numeric; dtt numeric; k1 numeric; k2 numeric; k3 numeric; ship numeric;
  hoa numeric; bien numeric; sddp numeric; truy numeric; sm numeric;
  c_dtt jsonb := '{}'; c_k1 jsonb := '{}'; c_k2 jsonb := '{}'; c_k3 jsonb := '{}'; c_ship jsonb := '{}';
  c_hoa jsonb := '{}'; c_bien jsonb := '{}'; c_sddp jsonb := '{}'; c_truy jsonb := '{}'; c_sm jsonb := '{}';
  t_dtt numeric := 0; t_k1 numeric := 0; t_k2 numeric := 0; t_k3 numeric := 0; t_ship numeric := 0;
  t_hoa numeric := 0; t_bien numeric := 0; t_sddp numeric := 0; t_truy numeric := 0; t_sm numeric := 0;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'pl_ky: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then
    raise exception 'pl_ky: kỳ % chưa có tham số tài chính (vat) — nhập tham số kỳ trước khi xem P/L', p_ky; end if;
  v_vat := t.vat;                                                             -- % (vd 10)
  v_hh  := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);  -- PHÂN SỐ (vd 0.05)
  v_from := to_date(p_ky || '-01', 'YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;  -- range SARGABLE, tránh to_char/hàng

  -- 5.1 MỘT lần quét + MỘT group-by: mỗi phân khúc gói sẵn {sum, nthieu, thieu_ds}. Đơn thiếu giá vốn: k1/k2/k3=0, doanh thu VẪN tính.
  select coalesce(jsonb_object_agg(x_seg, jsonb_build_object(
           'gc',s_gc,'k1',s_k1,'k2',s_k2,'k3',s_k3,'ship',s_ship,'nthieu',n_thieu,'thieu_ds',to_jsonb(thieu_ds))), '{}'::jsonb)
    into v_base
  from (
    select
      case when d.dong in ('le','combo','du_an') then d.dong else 'khac' end x_seg,
      sum(coalesce(d.gia_chot,0)) s_gc, sum(coalesce(gv.khoi_1,0)) s_k1, sum(coalesce(gv.khoi_2,0)) s_k2,
      sum(coalesce(gv.khoi_3,0)) s_k3, sum(coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0)) s_ship,
      count(*) filter (where gv.ma_don is null) n_thieu,
      (array_agg(d.ma_don) filter (where gv.ma_don is null))[1:50] thieu_ds
    from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
    where d.trang_thai = 'da_giao' and d.ngay_giao >= v_from and d.ngay_giao < v_to
    group by 1
  ) b;
  v_thieu_n := 0; v_thieu_ds := '{}';

  -- 5.2 định phí từ chi_phi_ky (truy được theo phân khúc + chung)
  select coalesce(jsonb_object_agg(phan_khuc, tong),'{}'::jsonb) into v_truy
    from (select phan_khuc, sum(so_tien) tong from kho.chi_phi_ky where ma_ky = p_ky and phan_khuc is not null group by phan_khuc) z;
  select coalesce(sum(so_tien),0) into v_chung from kho.chi_phi_ky where ma_ky = p_ky and phan_khuc is null;

  -- 5.4 ráp từng dòng chỉ tiêu × cột (KHÔNG làm tròn — giữ bất biến cộng chính xác; UI làm tròn hiển thị)
  foreach v_seg in array v_segs loop
    sum_gc := coalesce((v_base->v_seg->>'gc')::numeric,0); k1 := coalesce((v_base->v_seg->>'k1')::numeric,0);
    k2 := coalesce((v_base->v_seg->>'k2')::numeric,0); k3 := coalesce((v_base->v_seg->>'k3')::numeric,0); ship := coalesce((v_base->v_seg->>'ship')::numeric,0);
    dtt  := sum_gc / (1 + v_vat/100.0);
    hoa  := dtt * v_hh;
    bien := k1 + k2 + k3 + ship + hoa;
    sddp := dtt - bien;
    truy := coalesce((v_truy->>v_seg)::numeric, 0);
    sm   := sddp - truy;
    c_dtt := c_dtt||jsonb_build_object(v_seg,dtt); c_k1 := c_k1||jsonb_build_object(v_seg,k1);
    c_k2 := c_k2||jsonb_build_object(v_seg,k2); c_k3 := c_k3||jsonb_build_object(v_seg,k3);
    c_ship := c_ship||jsonb_build_object(v_seg,ship); c_hoa := c_hoa||jsonb_build_object(v_seg,hoa);
    c_bien := c_bien||jsonb_build_object(v_seg,bien); c_sddp := c_sddp||jsonb_build_object(v_seg,sddp);
    c_truy := c_truy||jsonb_build_object(v_seg,truy); c_sm := c_sm||jsonb_build_object(v_seg,sm);
    t_dtt:=t_dtt+dtt; t_k1:=t_k1+k1; t_k2:=t_k2+k2; t_k3:=t_k3+k3; t_ship:=t_ship+ship;
    t_hoa:=t_hoa+hoa; t_bien:=t_bien+bien; t_sddp:=t_sddp+sddp; t_truy:=t_truy+truy; t_sm:=t_sm+sm;
    v_thieu_n := v_thieu_n + coalesce((v_base->v_seg->>'nthieu')::int, 0);
    if jsonb_typeof(v_base->v_seg->'thieu_ds') = 'array' then
      v_thieu_ds := v_thieu_ds || array(select jsonb_array_elements_text(v_base->v_seg->'thieu_ds'));
    end if;
  end loop;
  v_thieu_ds := (v_thieu_ds)[1:50];

  return jsonb_build_object(
    'ma_ky', p_ky, 'vat', v_vat, 'hh', v_hh, 'segs', to_jsonb(v_segs),
    'dong', jsonb_build_object(
      'doanh_thu_thuan', c_dtt || jsonb_build_object('toan_cty', t_dtt),
      'k1',              c_k1  || jsonb_build_object('toan_cty', t_k1),
      'k2',              c_k2  || jsonb_build_object('toan_cty', t_k2),
      'k3',              c_k3  || jsonb_build_object('toan_cty', t_k3),
      'ship_lap',        c_ship|| jsonb_build_object('toan_cty', t_ship),
      'hoa_hong',        c_hoa || jsonb_build_object('toan_cty', t_hoa),
      'bien_phi',        c_bien|| jsonb_build_object('toan_cty', t_bien),
      'so_du_dam_phi',   c_sddp|| jsonb_build_object('toan_cty', t_sddp),
      'dinh_phi_truy',   c_truy|| jsonb_build_object('toan_cty', t_truy),
      'segment_margin',  c_sm  || jsonb_build_object('toan_cty', t_sm),
      'dinh_phi_chung',  jsonb_build_object('toan_cty', v_chung),
      'lai_thuan',       jsonb_build_object('toan_cty', t_sm - v_chung)
    ),
    'so_don_thieu_gia_von', v_thieu_n,
    'don_thieu', coalesce(to_jsonb(v_thieu_ds), '[]'::jsonb)
  );
end $$;
grant execute on function kho.pl_ky(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.pl_ky(text)') is null then raise exception 'THIẾU pl_ky'; end if;
  if to_regprocedure('kho.cpk_ghi(text,jsonb)') is null then raise exception 'THIẾU cpk_ghi'; end if;
  raise notice 'db/108 OK: chi_phi_ky + cpk_ds/cpk_ghi/cpk_chep_ky_truoc + pl_ky.';
end $$;
commit;
