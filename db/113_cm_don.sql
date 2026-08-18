-- 113 — MÀN "LÃI THEO ĐƠN" (CM/đơn) + HÀM CHUNG cm_don_raw (một nguồn số với pl_ky) (L-47b).
--   ⚠ IDEMPOTENT: create or replace → chạy 1 lần vẫn an toàn chạy lại.
--   CM/đơn = dt_thuan − (k1+k2+k3) − ship_lap − hoa_hong; dt_thuan = gia_chot ÷ (1+vat/100);
--     hoa_hong = (hh_sale+hh_quan_ly+hh_thiet_ke) × dt_thuan (PHÂN SỐ). Đơn: da_giao, kỳ theo ngay_giao.
--   BẤT BIẾN: Σ cm (mọi đơn da_giao trong kỳ, kể cả chưa trọn phần có) = dòng SỐ DƯ ĐẢM PHÍ của pl_ky.
--     → cm_don_raw = NGUỒN CHUNG per-đơn cho màn CM. pl_ky GIỮ bản gộp nhanh (chia 1 lần/phân khúc, <500ms cho 100k);
--   ĐƠN CHƯA TRỌN (thiếu giá vốn HOẶC thiếu ship/lắp): cm_pct = NULL → LOẠI khỏi sắp theo cm_pct (đẩy cuối) + khỏi
--     CM% trung bình. Lý do: đơn thiếu giá vốn cho CM% cao GIẢ leo đầu bảng (CEO bắt trên mẫu 18/08). cm phần có VẪN cộng tổng.
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop function if exists kho.cm_don_ky(text,int,text), kho.cm_don_raw(text,numeric,numeric,text[]);
--   -- pl_ky: chạy lại bản db/108 (gộp trực tiếp join, không qua cm_don_raw). commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. cm_don_raw — NGUỒN CHUNG per-đơn (SQL stable, inline được vào query gọi) ═══════════════
--   Nhận vat/hh từ hàm gọi (đã đọc tham số + fail-đóng ở tầng trên). CHỈ hàm nội bộ gọi — thu hồi execute công khai.
-- KHÔNG đặt SET search_path (chặn inline SQL → chậm 4×): bảng đã qualified kho.* nên inline được, nhanh.
-- p_ma = danh sách mã CẦN (null = cả kỳ). cm_don_ky truyền top-50 mã (đã sắp hẹp) → chỉ dựng chi tiết 50 đơn.
create or replace function kho.cm_don_raw(p_ky text, p_vat numeric, p_hh numeric, p_ma text[] default null)
  returns table(ma_don text, khach text, dong text, nguon_khach text, seg text,
                gia_chot numeric, dt_thuan numeric, k1 numeric, k2 numeric, k3 numeric,
                ship_lap numeric, hoa_hong numeric, cm numeric, thieu_gv boolean, thieu_ship boolean)
  language sql stable as $$
  select
    d.ma_don,
    coalesce(nullif(btrim(d.ten_khach), ''), '(chưa tên)'),
    d.dong,
    d.nguon_khach,
    case when d.dong in ('le','combo','du_an') then d.dong else 'khac' end,
    coalesce(d.gia_chot, 0),
    coalesce(d.gia_chot, 0) / (1 + p_vat/100.0),
    coalesce(gv.khoi_1, 0), coalesce(gv.khoi_2, 0), coalesce(gv.khoi_3, 0),
    coalesce(d.ship_thuc_tra, 0) + coalesce(d.lap_thuc_tra, 0),
    (coalesce(d.gia_chot, 0) / (1 + p_vat/100.0)) * p_hh,
    coalesce(d.gia_chot, 0) / (1 + p_vat/100.0)
      - (coalesce(gv.khoi_1,0) + coalesce(gv.khoi_2,0) + coalesce(gv.khoi_3,0))
      - (coalesce(d.ship_thuc_tra,0) + coalesce(d.lap_thuc_tra,0))
      - (coalesce(d.gia_chot,0) / (1 + p_vat/100.0)) * p_hh,
    (gv.ma_don is null),
    (d.ship_thuc_tra is null and d.lap_thuc_tra is null)
  from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
  where d.trang_thai = 'da_giao'
    and d.ngay_giao >= to_date(p_ky || '-01', 'YYYY-MM-DD')
    and d.ngay_giao <  (to_date(p_ky || '-01', 'YYYY-MM-DD') + interval '1 month')::date
    and (p_ma is null or d.ma_don = any(p_ma))
$$;
revoke all on function kho.cm_don_raw(text, numeric, numeric, text[]) from public;

-- ═══════════════ 2. pl_ky — GIỮ bản gộp NHANH của db/108 (KHÔNG route per-đơn qua cm_don_raw) ═══════════════
--   Lý do: cm_don_raw chia dt_thuan PER-ĐƠN (100k phép chia); pl_ky gộp gia_chot rồi chia 1 lần/phân khúc (4 phép) →
--   nhanh hơn ~2×, giữ <500ms cho 100k. Công thức ĐỒNG NHẤT cm_don_raw; BẤT BIẾN Σ cm = sddp khoá bằng test_113 (<1đ).
--   (Bản redefine ở đây = y hệt db/108, để chạy db/113 khôi phục pl_ky nhanh nếu đã lỡ đổi.)
create or replace function kho.pl_ky(p_ky text)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
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
  v_vat := t.vat;
  v_hh  := coalesce(t.hh_sale,0) + coalesce(t.hh_quan_ly,0) + coalesce(t.hh_thiet_ke,0);
  v_from := to_date(p_ky || '-01', 'YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

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

  select coalesce(jsonb_object_agg(phan_khuc, tong),'{}'::jsonb) into v_truy
    from (select phan_khuc, sum(so_tien) tong from kho.chi_phi_ky where ma_ky = p_ky and phan_khuc is not null group by phan_khuc) z;
  select coalesce(sum(so_tien),0) into v_chung from kho.chi_phi_ky where ma_ky = p_ky and phan_khuc is null;

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

-- ═══════════════ 3. cm_don_ky(p_ky, p_trang, p_sap) — màn Lãi theo đơn (ceo/ke_toan, sale CHẶN vì lộ giá vốn) ═══════════════
create or replace function kho.cm_don_ky(p_ky text, p_trang int default 0, p_sap text default 'cm_pct.asc')
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  t record; v_vat numeric; v_hh numeric; v_ds jsonb; v_d numeric;
  v_cot text; v_chieu text; v_order text; v_gioi int := 50; v_ma text[]; v_from date; v_to date; v_sql text; v_ct text;
  v_n int; v_nthieu int; v_sgc numeric; v_sgv numeric; v_sship numeric;
  v_sgc_t numeric; v_sgv_t numeric; v_sship_t numeric;
  v_dt numeric; v_hoa numeric; v_cm numeric; v_cmtb numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then
    raise exception 'cm_don_ky: chỉ ceo/ke_toan (màn lộ giá vốn theo đơn)'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then
    raise exception 'cm_don_ky: kỳ % chưa có tham số tài chính (vat) — nhập tham số kỳ trước khi xem CM/đơn', p_ky; end if;
  v_vat := t.vat; v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_d := 1 + v_vat/100.0;   -- ước số bóc VAT
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  -- ── TỔNG KỲ: aggregate DEFERRED (hash-agg, KHÔNG sort; chia 1 lần, khớp pl_ky; ~1 quét như pl_ky) ──
  select count(*),
    count(*) filter (where gv.ma_don is null or (d.ship_thuc_tra is null and d.lap_thuc_tra is null)),
    coalesce(sum(coalesce(d.gia_chot,0)),0),
    coalesce(sum(coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0)),0),
    coalesce(sum(coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0)),0),
    coalesce(sum(coalesce(d.gia_chot,0)) filter (where not(gv.ma_don is null or (d.ship_thuc_tra is null and d.lap_thuc_tra is null))),0),
    coalesce(sum(coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0)) filter (where not(gv.ma_don is null or (d.ship_thuc_tra is null and d.lap_thuc_tra is null))),0),
    coalesce(sum(coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0)) filter (where not(gv.ma_don is null or (d.ship_thuc_tra is null and d.lap_thuc_tra is null))),0)
  into v_n, v_nthieu, v_sgc, v_sgv, v_sship, v_sgc_t, v_sgv_t, v_sship_t
  from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
  where d.trang_thai = 'da_giao' and d.ngay_giao >= v_from and d.ngay_giao < v_to;
  v_dt := v_sgc / v_d; v_hoa := v_dt * v_hh; v_cm := v_dt - v_sgv - v_sship - v_hoa;
  v_cmtb := case when v_sgc_t > 0 then (v_sgc_t/v_d - v_sgv_t - v_sship_t - v_sgc_t/v_d*v_hh) / (v_sgc_t/v_d) * 100 else null end;

  -- ── TRANG: TOP-N (order by ... limit 50 = heapsort top-50, KHÔNG full-sort 100k) → top-50 mã, giữ thứ tự ──
  v_cot := split_part(p_sap,'.',1); v_chieu := lower(coalesce(nullif(split_part(p_sap,'.',2),''),'asc'));
  if v_chieu not in ('asc','desc') then v_chieu := 'asc'; end if;
  v_order := case v_cot
    when 'cm' then 'cm ' || v_chieu
    when 'dt_thuan' then 'gc ' || v_chieu
    when 'gia_von' then 'gv_sum ' || v_chieu
    else '(cm_pct is null), cm_pct ' || v_chieu
  end;
  v_ct := 'coalesce(d.gia_chot,0)/' || v_d
        || ' - (coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0))'
        || ' - (coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0))'
        || ' - coalesce(d.gia_chot,0)/' || v_d || '*' || v_hh;
  --   cm tính 1 LẦN (v_ct) ở lớp a; cm_pct = cm/dt ở lớp inr → order by biểu thức '(cm_pct is null), cm_pct' hợp lệ (cột thật).
  v_sql := 'select array_agg(ma_don order by rn) from (select ma_don, row_number() over () rn from ('
    || ' select ma_don from ('
    || '   select ma_don, gc, gv_sum, cm, case when chua_tron or gc=0 then null else cm/(gc/' || v_d || ')*100 end cm_pct'
    || '   from (select d.ma_don, coalesce(d.gia_chot,0) gc,'
    || '       (coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0)) gv_sum,'
    || '       (' || v_ct || ') cm,'
    || '       (gv.ma_don is null or (d.ship_thuc_tra is null and d.lap_thuc_tra is null)) chua_tron'
    || '     from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don=d.ma_don'
    || '     where d.trang_thai=''da_giao'' and d.ngay_giao >= ' || quote_literal(v_from) || '::date and d.ngay_giao < ' || quote_literal(v_to) || '::date) a'
    || ' ) inr order by ' || v_order || ' limit ' || v_gioi || ' offset ' || (p_trang*v_gioi) || ') lim) z';
  execute v_sql into v_ma;
  v_n := coalesce(v_n,0); v_nthieu := coalesce(v_nthieu,0);

  -- Tầng 2: chi tiết 50 mã (giữ đúng thứ tự tầng 1 bằng array_position). Query TĨNH.
  select coalesce(jsonb_agg(
      jsonb_build_object(
        'ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,'gia_chot',gia_chot,
        'dt_thuan',dt_thuan,'k1',k1,'k2',k2,'k3',k3,'gv',k1+k2+k3,'ship_lap',ship_lap,'hoa_hong',hoa_hong,
        'cm',cm,'cm_pct',cm_pct,'cm_tren_k2', case when k2>0 then cm/k2 else null end, 'thieu',to_jsonb(thieu)
      ) order by array_position(v_ma, ma_don)), '[]'::jsonb)
    into v_ds
  from (
    select *,
      case when (thieu_gv or thieu_ship) or dt_thuan = 0 then null else cm/dt_thuan*100 end cm_pct,
      (case when thieu_gv then array['giá vốn'] else array[]::text[] end
       || case when thieu_ship then array['ship/lắp'] else array[]::text[] end) thieu
    from kho.cm_don_raw(p_ky, v_vat, v_hh, v_ma)
  ) x;

  return jsonb_build_object(
    'ma_ky', p_ky, 'vat', v_vat, 'hh', v_hh, 'trang', p_trang,
    'so_trang', greatest(1, ceil(v_n::numeric / v_gioi)),
    'tong', jsonb_build_object('so_don', v_n, 'so_thieu', v_nthieu, 'cm', v_cm, 'dt', v_dt,
      'gv', v_sgv, 'ship_lap', v_sship, 'hoa_hong', v_hoa, 'cm_pct_tb', v_cmtb),
    'ds', v_ds
  );
end $$;
grant execute on function kho.cm_don_ky(text, int, text) to authenticated;

do $$ begin
  if to_regprocedure('kho.cm_don_ky(text,int,text)') is null then raise exception 'THIẾU cm_don_ky'; end if;
  if to_regprocedure('kho.cm_don_raw(text,numeric,numeric,text[])') is null then raise exception 'THIẾU cm_don_raw'; end if;
  raise notice 'db/113 OK: cm_don_raw (nguồn chung) + cm_don_ky (Lãi theo đơn); pl_ky giữ bản nhanh db/108.';
end $$;
commit;
