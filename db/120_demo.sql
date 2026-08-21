-- 120 — NỀN DEMO (WP-02a / L-57): cờ la_demo tự động theo ma_don DEMO-* · xoa_demo() · lọc demo khỏi 6 RPC tài chính.
--   CĂN CỨ: MES Meyer 9.4 (pilot test trước parameterize) + 9.1.2 (triển khai từng quy trình để giảm rủi ro).
--   ⚠ IDEMPOTENT: add column if not exists · create or replace trigger/hàm · drop function đúng chữ ký (thêm p_gom_demo → DROP bản cũ).
--   GIẢ ĐỊNH: (G1) không nút bật/tắt demo — chỉ tham số RPC p_gom_demo default false. (G2) xoa_demo() không ma_don = xoá TOÀN BỘ
--     la_demo (kể cả 14 seed cũ) → bắt buộc p_xac_nhan='XOA_HET'. (G3) bàn giao chưa nối lịch (WP-43) → demo gọi luu_xep_lich tay.
--   Sổ kho giao_dich KHÔNG dính đơn (demo không nhập/xuất kho) → xoa_demo KHÔNG chạm giao_dich/ton (giữ 199/199).
-- HOÀN TÁC: drop function xoa_demo; drop trigger don_hang_tu_danh_dau_demo on don_hang, khach_tu_danh_dau_demo on khach;
--   alter table khach drop column la_demo; chạy lại db/113/115/110/098 (6 RPC bản cũ không p_gom_demo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · cột + trigger tự đánh dấu demo ═══════════
alter table kho.khach add column if not exists la_demo boolean not null default false;

create or replace function kho.tu_danh_dau_demo_don() returns trigger language plpgsql as $$
begin if new.ma_don ilike 'DEMO-%' then new.la_demo := true; end if; return new; end $$;
drop trigger if exists don_hang_tu_danh_dau_demo on kho.don_hang;
create trigger don_hang_tu_danh_dau_demo before insert or update of ma_don on kho.don_hang
  for each row execute function kho.tu_danh_dau_demo_don();

create or replace function kho.tu_danh_dau_demo_khach() returns trigger language plpgsql as $$
begin if new.ten ilike 'DEMO%' then new.la_demo := true; end if; return new; end $$;
drop trigger if exists khach_tu_danh_dau_demo on kho.khach;
create trigger khach_tu_danh_dau_demo before insert or update on kho.khach
  for each row execute function kho.tu_danh_dau_demo_khach();
comment on function kho.tu_danh_dau_demo_don() is 'QD-46: ma_don DEMO-* → la_demo tự động';

-- ═══════════ 2 · LỌC DEMO — drop 6 chữ ký cũ (thêm p_gom_demo). Callers trước callee. ═══════════
drop function if exists kho.cm_don_ky(text, integer, text);
drop function if exists kho.kenh_cac_ky(text, text);
drop function if exists kho.cm_don_raw(text, numeric, numeric, text[]);
drop function if exists kho.pl_ky(text);
drop function if exists kho.lap_day_ky(text);
drop function if exists kho.gia_von_don_ds(integer, integer);

CREATE OR REPLACE FUNCTION kho.cm_don_raw(p_ky text, p_vat numeric, p_hh numeric, p_ma text[] DEFAULT NULL::text[], p_gom_demo boolean DEFAULT false)
 RETURNS TABLE(ma_don text, khach text, dong text, nguon_khach text, thuong_hieu text, seg text, gia_chot numeric, dt_thuan numeric, k1 numeric, k2 numeric, k3 numeric, ship_lap numeric, hoa_hong numeric, cm numeric, thieu_gv boolean, thieu_ship boolean)
 LANGUAGE sql
 STABLE
AS $function$
  select
    d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)'), d.dong, d.nguon_khach, d.thuong_hieu,
    case when d.dong in ('le','combo','du_an') then d.dong else 'khac' end,
    coalesce(d.gia_chot,0), coalesce(d.gia_chot,0)/(1+p_vat/100.0),
    coalesce(gv.khoi_1,0), coalesce(gv.khoi_2,0), coalesce(gv.khoi_3,0),
    coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0),
    (coalesce(d.gia_chot,0)/(1+p_vat/100.0))*p_hh,
    coalesce(d.gia_chot,0)/(1+p_vat/100.0) - (coalesce(gv.khoi_1,0)+coalesce(gv.khoi_2,0)+coalesce(gv.khoi_3,0))
      - (coalesce(d.ship_thuc_tra,0)+coalesce(d.lap_thuc_tra,0)) - (coalesce(d.gia_chot,0)/(1+p_vat/100.0))*p_hh,
    (gv.ma_don is null), (d.ship_thuc_tra is null and d.lap_thuc_tra is null)
  from kho.don_hang d left join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
  where d.trang_thai='da_giao' and (p_gom_demo or not d.la_demo) and d.ngay_giao >= to_date(p_ky||'-01','YYYY-MM-DD')
    and d.ngay_giao < (to_date(p_ky||'-01','YYYY-MM-DD') + interval '1 month')::date
    and (p_ma is null or d.ma_don = any(p_ma))
$function$
;

CREATE OR REPLACE FUNCTION kho.cm_don_ky(p_ky text, p_trang integer DEFAULT 0, p_sap text DEFAULT 'cm_pct.asc'::text, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
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
  where d.trang_thai = 'da_giao' and (p_gom_demo or not d.la_demo) and d.ngay_giao >= v_from and d.ngay_giao < v_to;
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
    || '     where d.trang_thai=''da_giao'' and (' || p_gom_demo::text || ' or not d.la_demo) and d.ngay_giao >= ' || quote_literal(v_from) || '::date and d.ngay_giao < ' || quote_literal(v_to) || '::date) a'
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
    from kho.cm_don_raw(p_ky, v_vat, v_hh, v_ma, p_gom_demo)
  ) x;

  return jsonb_build_object(
    'ma_ky', p_ky, 'vat', v_vat, 'hh', v_hh, 'trang', p_trang,
    'so_trang', greatest(1, ceil(v_n::numeric / v_gioi)),
    'tong', jsonb_build_object('so_don', v_n, 'so_thieu', v_nthieu, 'cm', v_cm, 'dt', v_dt,
      'gv', v_sgv, 'ship_lap', v_sship, 'hoa_hong', v_hoa, 'cm_pct_tb', v_cmtb),
    'ds', v_ds
  );
end $function$
;

CREATE OR REPLACE FUNCTION kho.kenh_cac_ky(p_ky text, p_brand text DEFAULT NULL::text, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
declare
  t record; v_vat numeric; v_hh numeric; v_from date; v_to date; v_ds jsonb; v_tong jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'kenh_cac_ky: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then raise exception 'kenh_cac_ky: kỳ % chưa có tham số tài chính (vat)', p_ky; end if;
  v_vat := t.vat; v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;

  with cm as (   -- CHỈ ĐƠN TRỌN trong kỳ, gom brand×kênh (nguồn: cm_don_raw)
    select coalesce(nullif(btrim(r.thuong_hieu),''),'(chưa ghi TH)') brand,
           coalesce(nullif(btrim(r.nguon_khach),''),'(chưa ghi nguồn)') kenh,
           count(*) don_giao, sum(r.dt_thuan) dt, sum(r.cm) cm
    from kho.cm_don_raw(p_ky, v_vat, v_hh, null, p_gom_demo) r
    where not (r.thieu_gv or r.thieu_ship)
    group by 1,2
  ),
  fb as (   -- khách MỚI theo brand: đơn ĐẦU TIÊN (distinct on, 1 sort) mỗi sdt×brand → nếu rơi vào kỳ = khách mới
    select brand, kenh, count(*) khach_moi from (
      select distinct on (d.sdt_khach, d.thuong_hieu)
             d.thuong_hieu brand, d.nguon_khach kenh, d.ngay_giao first_giao
      from kho.don_hang d
      where d.trang_thai='da_giao' and (p_gom_demo or not d.la_demo) and nullif(btrim(d.sdt_khach),'') is not null
        and nullif(btrim(d.thuong_hieu),'') is not null and d.ngay_giao is not null
      order by d.sdt_khach, d.thuong_hieu, d.ngay_giao
    ) x where x.first_giao >= v_from and x.first_giao < v_to and nullif(btrim(x.kenh),'') is not null
    group by brand, kenh
  ),
  ads as (   -- chi ads THẬT = Σ so_tien_nhap ÷ (1+vat/100)
    select thuong_hieu brand, kenh, sum(so_tien_nhap)/(1+v_vat/100.0) chi_that
    from kho.chi_ads where ma_ky=p_ky group by 1,2
  ),
  gop as (
    select coalesce(cm.brand, fb.brand, ads.brand) brand, coalesce(cm.kenh, fb.kenh, ads.kenh) kenh,
      coalesce(cm.don_giao,0) don_giao, coalesce(cm.dt,0) dt, coalesce(cm.cm,0) cm,
      coalesce(fb.khach_moi,0) khach_moi, coalesce(ads.chi_that,0) chi_that
    from cm full outer join fb on fb.brand=cm.brand and fb.kenh=cm.kenh
            full outer join ads on ads.brand=coalesce(cm.brand,fb.brand) and ads.kenh=coalesce(cm.kenh,fb.kenh)
  ),
  loc as ( select * from gop where p_brand is null or brand = p_brand )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'brand',brand,'kenh',kenh,'don_giao',don_giao,'khach_moi_brand',khach_moi,
      'chi_ads_that',chi_that,'cac', case when khach_moi>0 then chi_that/khach_moi else null end,
      'vo_han', (chi_that>0 and khach_moi=0), 'mau_mong', (khach_moi>0 and khach_moi<3),
      'dt_thuan',dt,'cm_kenh',cm,'cm_sau_ads', cm - chi_that
    ) order by brand, kenh),'[]'::jsonb),
    jsonb_build_object('don_giao',coalesce(sum(don_giao),0),'khach_moi_brand',coalesce(sum(khach_moi),0),
      'chi_ads_that',coalesce(sum(chi_that),0),'dt_thuan',coalesce(sum(dt),0),
      'cm_kenh',coalesce(sum(cm),0),'cm_sau_ads',coalesce(sum(cm),0)-coalesce(sum(chi_that),0))
  into v_ds, v_tong from loc;

  return jsonb_build_object('ma_ky',p_ky,'vat',v_vat,'brand_loc',p_brand,'dong',v_ds,'tong',v_tong);
end $function$
;

CREATE OR REPLACE FUNCTION kho.pl_ky(p_ky text, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
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
    where d.trang_thai = 'da_giao' and (p_gom_demo or not d.la_demo) and d.ngay_giao >= v_from and d.ngay_giao < v_to
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
end $function$
;

CREATE OR REPLACE FUNCTION kho.lap_day_ky(p_ky text, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
 SET jit TO 'off'
AS $function$
declare
  v_suy numeric; v_cpnl numeric; v_mau numeric; v_k2 numeric; v_from date; v_to date; v_chua boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'lap_day_ky: chỉ ceo/ke_toan'; end if;
  -- số SUY = Σ(lương tổ + overhead + bảo hiểm) của luong_to CÙNG kỳ
  select coalesce(sum(coalesce(luong_to,0)+coalesce(overhead_phan_bo,0)+coalesce(bao_hiem,0)),0)
    into v_suy from kho.luong_to where ma_ky = p_ky;
  -- tham số đã chốt?
  select chi_phi_nang_luc into v_cpnl from kho.tham_so_tai_chinh where ma_ky = p_ky;
  v_chua := (v_cpnl is null);
  v_mau  := coalesce(v_cpnl, v_suy);     -- chưa chốt → dùng số suy làm mẫu số
  -- Σ khoi_2 (đơn da_giao trong kỳ theo ngay_giao) — range SARGABLE
  v_from := to_date(p_ky || '-01', 'YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  select coalesce(sum(coalesce(gv.khoi_2,0)),0) into v_k2
    from kho.don_hang d join kho.don_hang_gia_von gv on gv.ma_don = d.ma_don
    where d.trang_thai = 'da_giao' and (p_gom_demo or not d.la_demo) and d.ngay_giao >= v_from and d.ngay_giao < v_to;
  return jsonb_build_object(
    'ma_ky', p_ky,
    'chi_phi_nang_luc', v_cpnl,                 -- tham số THÔ (null = chưa chốt)
    'so_suy_tu_luong_to', v_suy,
    'chua_chot_tham_so', v_chua,
    'mau_so_dung', v_mau,                       -- mẫu số thực dùng để tính %
    'tong_khoi_2', v_k2,
    'ty_le_lap_day', case when v_mau > 0 then v_k2 / v_mau else null end,   -- phân số (×100 ở UI)
    'tien_bo_trong', v_mau - v_k2               -- âm = VƯỢT năng lực chuẩn
  );
end $function$
;

CREATE OR REPLACE FUNCTION kho.gia_von_don_ds(p_gioi_han integer DEFAULT 50, p_offset integer DEFAULT 0, p_gom_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_tong int; v_ds jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','ke_toan') then   -- QĐ CEO: kế toán XEM được giá vốn đơn
    raise exception 'gia_von_don_ds: chỉ ceo/kho/ke_toan (vai "%")',
      coalesce(nullif(kho.current_vai_tro(),''),'(chưa đăng nhập)'); end if;
  select count(*)::int into v_tong from kho.don_hang d
    where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy') and (p_gom_demo or not d.la_demo);
  select coalesce(jsonb_agg(jsonb_build_object(
      'ma_don',ma_don,'trang_thai',trang_thai,'dong',dong,'co_gia_von',co_gia_von,'nguon',nguon,
      'khoi_1',khoi_1,'khoi_2',khoi_2,'khoi_3',khoi_3,'gia_chuyen_giao',gia_chuyen_giao,
      'nguoi_ten',nguoi_ten,'ly_do',ly_do,'cap_nhat_luc',cap_nhat_luc) order by co_gia_von, ma_don), '[]'::jsonb)
    into v_ds
  from (
    select d.ma_don, d.trang_thai, d.dong, (g.ma_don is not null) co_gia_von, g.nguon,
      g.khoi_1, g.khoi_2, g.khoi_3, g.gia_chuyen_giao, n.ho_ten nguoi_ten, g.ly_do, g.cap_nhat_luc
    from kho.don_hang d
    left join kho.don_hang_gia_von g on g.ma_don = d.ma_don
    left join kho.nguoi_dung n on n.id = g.nguoi_day
    where d.trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy') and (p_gom_demo or not d.la_demo)
    order by (g.ma_don is not null), d.ma_don        -- đơn CHƯA có giá vốn lên đầu (giữ cho dropdown nhập tay)
    limit greatest(p_gioi_han,0) offset greatest(p_offset,0)
  ) x;
  return jsonb_build_object('tong', v_tong, 'ds', v_ds, 'gioi_han', p_gioi_han, 'offset', greatest(p_offset,0));
end $function$
;

-- Grant lại theo bản cũ (definer, ceo/ke_toan gọi; nhan_xet_ky gọi lồng vẫn OK do default false)
grant execute on function kho.cm_don_raw(text,numeric,numeric,text[],boolean) to authenticated;
grant execute on function kho.cm_don_ky(text,integer,text,boolean) to authenticated;
grant execute on function kho.kenh_cac_ky(text,text,boolean) to authenticated;
grant execute on function kho.pl_ky(text,boolean) to authenticated;
grant execute on function kho.lap_day_ky(text,boolean) to authenticated;
grant execute on function kho.gia_von_don_ds(integer,integer,boolean) to authenticated;

-- ═══════════ 3 · xoa_demo() — SECURITY DEFINER, chỉ ceo ═══════════
create or replace function kho.xoa_demo(p_ma_don text default null, p_xac_nhan text default null)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_targets text[]; v_ids uuid[]; r jsonb := '{}'::jsonb; n int;
  v_global boolean := (p_ma_don is null);
begin
  if coalesce(kho.current_vai_tro(),'') <> 'ceo' then raise exception 'xoa_demo: chỉ CEO'; end if;
  if v_global then
    if coalesce(p_xac_nhan,'') <> 'XOA_HET' then
      raise exception 'xoa_demo TOÀN BỘ demo cần p_xac_nhan=''XOA_HET'' (xoá cả seed cũ)'; end if;
    select array_agg(ma_don) into v_targets from kho.don_hang where la_demo = true;
  else
    if not exists(select 1 from kho.don_hang where ma_don = p_ma_don and la_demo = true) then
      raise exception 'xoa_demo: đơn % không tồn tại hoặc KHÔNG phải demo (la_demo=false)', p_ma_don; end if;
    v_targets := array[p_ma_don];
  end if;
  v_targets := coalesce(v_targets, '{}');
  select array_agg(id) into v_ids from kho.don_hang where ma_don = any(v_targets);

  -- sổ quét (partitioned, không FK don_hang): theo tem của đơn
  delete from kho.su_kien_quet where tem_ma in (select tem_ma from kho.tien_do_tem where ma_don = any(v_targets)); get diagnostics n = row_count; r := r || jsonb_build_object('su_kien_quet', n);
  delete from kho.tien_do_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tien_do_tem', n);
  delete from kho.tem_da_in where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('tem_da_in', n);
  delete from kho.lan_in_tem where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('lan_in_tem', n);
  delete from kho.don_hang_mon_nhat_ky where don_id = any(v_ids); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang_mon_nhat_ky', n);
  -- phiếu kho (no-action FK) — demo không tạo, nhưng gỡ liên kết cho an toàn
  update kho.phieu set ma_don = null where ma_don = any(v_targets);
  -- don_hang → CASCADE: gia_von·mon·nhat_ky·gio_tk·tem_ban_ve·san_luong·ban_thiet_ke·xep_lich·phieu_thu·giao_cod
  delete from kho.don_hang where ma_don = any(v_targets); get diagnostics n = row_count; r := r || jsonb_build_object('don_hang', n);
  -- khách demo mồ côi (không còn đơn nào trỏ sdt)
  delete from kho.khach where la_demo = true and sdt not in (select sdt_khach from kho.don_hang where sdt_khach is not null); get diagnostics n = row_count; r := r || jsonb_build_object('khach', n);
  if v_global then
    delete from kho.phieu_dem_ngay where la_demo = true; get diagnostics n = row_count; r := r || jsonb_build_object('phieu_dem_ngay', n);
  end if;
  return jsonb_build_object('ok', true, 'pham_vi', case when v_global then 'TOAN_BO' else p_ma_don end, 'xoa', r);
end $$;
revoke execute on function kho.xoa_demo(text,text) from public;
grant execute on function kho.xoa_demo(text,text) to authenticated;   -- guard vai ceo BÊN TRONG (như các RPC ceo-only)
comment on function kho.xoa_demo(text,text) is 'QD-46: xoá đơn demo (DEMO-*) + con; ceo-only; giao_dich KHÔNG chạm';

do $$ begin
  if to_regprocedure('kho.pl_ky(text,boolean)') is null then raise exception 'THIẾU pl_ky(text,boolean)'; end if;
  if to_regprocedure('kho.xoa_demo(text,text)') is null then raise exception 'THIẾU xoa_demo'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and p.proname='pl_ky') <> 1 then raise exception 'pl_ky bị OVERLOAD'; end if;
  raise notice 'db/120 OK: la_demo tự động + xoa_demo + 6 RPC lọc demo (p_gom_demo).';
end $$;
commit;
