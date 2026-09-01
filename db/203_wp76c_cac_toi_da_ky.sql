-- db/203 · WP-76 mục 2 (L-76c) · CAC tối đa theo DẢI GIÁ TRỊ ĐƠN — HAI CỘT ngắn hạn / dài hạn. QD-91.
--   Nguồn SDĐP/biến phí = cm_don_raw (một bản sự thật 04 §A — KHÔNG viết công thức lần hai). Chỉ TÁCH k3 ra khỏi cm:
--     SDĐP (đảm phí) = cm + k3 = dt_thuan − k1 − k2 − ship − hoa   ·   cac_hoa_von = cm = SDĐP − k3.
--   HAI CỘT (vì Special Orders Garrison ch.12 tr.542-543 chỉ đúng đơn MỘT LẦN; bán lẻ quanh năm cần cột dài hạn phủ định phí):
--     cac_ngan_han = SDĐP − chi_phí_tăng_thêm(=0, k3 chưa tách biến/định → cờ k3_chua_tach) − chi_phí_cơ_hội(≠0 chỉ khi KÍN).
--     cac_dai_han  = cac_hoa_von − bien_muc_tieu × dt_thuan   (bien NULL → NULL + cờ thieu_bien; CẤM thay bằng he_so_m).
--     gia_toi_thieu = (khối③ + n_cac) ÷ tỷ_lệ_SDĐP  (đọc cột dài hạn).
--   Kín/trống ĐỌC TỪ lap_day_ky (QD-36) — KHÔNG tự đặt ngưỡng. Khối ④ (định phí chung) KHÔNG vào cột nào ở mức đơn (Garrison ch.6);
--     cột dài hạn gánh định phí QUA bien_muc_tieu. Dải 0 đơn → chua_co_don, số NULL (họ cờ vo_han WP-90). Hạng phân tích: loại demo mặc định.
--   ⚠ Cổng backup QD-61. IDEMPOTENT (add column if not exists + create or replace).
--   HOÀN TÁC: drop function kho.cac_toi_da_ky(text,boolean,numeric[]); alter table kho.tham_so_tai_chinh drop column bien_muc_tieu;
begin;

-- (a) BIÊN MỤC TIÊU — cột tham số, NULL = chưa chốt. KHÔNG backfill, KHÔNG suy từ he_so_m. Ô nhập UI là lệnh sau.
alter table kho.tham_so_tai_chinh
  add column if not exists bien_muc_tieu numeric check (bien_muc_tieu is null or (bien_muc_tieu >= 0 and bien_muc_tieu < 1));
comment on column kho.tham_so_tai_chinh.bien_muc_tieu is
  'WP-76/QD-91: biên lợi nhuận MỤC TIÊU (phân số doanh thu bóc VAT) cho CAC dài hạn. NULL=chưa chốt. KHÔNG suy từ he_so_m.';

-- (b) RPC hai cột.
create or replace function kho.cac_toi_da_ky(
    p_ky text, p_gom_demo boolean default false,
    p_nguong numeric[] default array[3e6, 7e6, 15e6, 40e6])
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare
  t record; v_vat numeric; v_hh numeric; v_bien numeric; v_ncac numeric;
  v_cao numeric; v_tyle numeric; v_kin boolean; v_cot text; v_ly text; v_lap jsonb; v_dai jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'cac_toi_da_ky: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky !~ '^\d{4}-\d{2}$' then raise exception 'cac_toi_da_ky: p_ky phải dạng YYYY-MM'; end if;
  if p_nguong is null or array_length(p_nguong,1) <> 4 then raise exception 'cac_toi_da_ky: p_nguong phải 4 mốc (5 dải)'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found or t.vat is null then raise exception 'cac_toi_da_ky: kỳ % chưa có tham số tài chính (vat)', p_ky; end if;
  v_vat := t.vat; v_hh := coalesce(t.hh_sale,0)+coalesce(t.hh_quan_ly,0)+coalesce(t.hh_thiet_ke,0);
  v_bien := t.bien_muc_tieu; v_ncac := t.n_cac; v_cao := t.nguong_lap_day_cao;

  -- Trạng thái năng lực đọc từ lap_day_ky (QD-36) — KHÔNG tự đặt ngưỡng. Thiếu ngưỡng cao → coi TRỐNG.
  begin v_lap := kho.lap_day_ky(p_ky, p_gom_demo); v_tyle := nullif(v_lap->>'ty_le_lap_day','')::numeric; exception when others then v_tyle := null; end;
  v_kin := (v_cao is not null and v_tyle is not null and v_tyle >= v_cao);
  if v_kin then v_cot := 'ngan_han';
    v_ly := 'Năng lực ĐANG KÍN (lấp đầy '||round(coalesce(v_tyle,0)*100,1)||'% ≥ ngưỡng cao '||round(v_cao*100,1)||'%) → đọc cột NGẮN HẠN: mỗi đơn thêm lấn chỗ đơn khác, chi phí cơ hội là mức chặn.';
  else v_cot := 'dai_han';
    v_ly := 'Năng lực CÒN TRỐNG (lấp đầy '||round(coalesce(v_tyle,0)*100,1)||'%'||case when v_cao is null then ', chưa chốt ngưỡng lấp đầy' else '' end||') → đọc cột DÀI HẠN: đơn phải phủ đủ khối ③ + biên mục tiêu, đừng để đơn nhỏ nào cũng "lãi" ngắn hạn mà cả năm không phủ định phí.';
  end if;

  -- Nguồn per-đơn = cm_don_raw. "đo đủ" = không thiếu giá vốn & không thiếu ship (đúng dân số cm_don_ky dùng cho CM%).
  with d as (
    select r.gia_chot, r.dt_thuan, r.cm, coalesce(r.k3,0) k3,
           r.cm + coalesce(r.k3,0) as sdp,             -- đảm phí = cm + k3
           r.thieu_gv, r.thieu_ship,
           (not r.thieu_gv and not r.thieu_ship) as do_du,
           least(greatest(width_bucket(r.gia_chot, p_nguong),0),4) as b
    from kho.cm_don_raw(p_ky, v_vat, v_hh, null, p_gom_demo) r
  ),
  a as (
    select b,
      count(*) n,
      avg(gia_chot) gia_tb,
      count(*) filter (where do_du) n_do,
      count(*) filter (where thieu_gv) n_thieu_k3,       -- thiếu giá vốn = k3 chưa biết
      sum(sdp)      filter (where do_du) ssdp,
      sum(dt_thuan) filter (where do_du) sdt,
      sum(cm)       filter (where do_du) scm,
      avg(k3)       filter (where do_du) k3_don
    from d group by b
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dai', case when g.b=0 then '<'||trim_scale(p_nguong[1]/1e6)||'tr'
                  when g.b=4 then '>'||trim_scale(p_nguong[4]/1e6)||'tr'
                  else trim_scale(p_nguong[g.b]/1e6)||'–'||trim_scale(p_nguong[g.b+1]/1e6)||'tr' end,
      'tu',  case when g.b=0 then null else p_nguong[g.b] end,
      'den', case when g.b=4 then null else p_nguong[g.b+1] end,
      'so_don', coalesce(a.n,0),
      'chua_co_don', (a.n is null or a.n=0),
      'gia_tri_tb', a.gia_tb,
      'ty_le_sdp',  case when coalesce(a.sdt,0)>0 then a.ssdp/a.sdt else null end,
      'sdp_don',    case when coalesce(a.n_do,0)>0 then a.ssdp/a.n_do else null end,
      'khoi3_don',  a.k3_don,
      'cac_hoa_von', case when coalesce(a.n_do,0)>0 then a.scm/a.n_do else null end,
      'cac_ngan_han', case when coalesce(a.n_do,0)=0 then null
                           when v_kin then null                                    -- kín: thiếu chi phí cơ hội → NULL
                           else a.ssdp/a.n_do end,                                  -- trống: tăng thêm=0, cơ hội=0 → = SDĐP/đơn
      'cac_dai_han', case when coalesce(a.n_do,0)=0 then null
                          when v_bien is null then null                            -- thiếu biên → NULL
                          else a.scm/a.n_do - v_bien*(a.sdt/a.n_do) end,
      'gia_toi_thieu', case when coalesce(a.sdt,0)>0 and a.ssdp>0
                            then (coalesce(a.k3_don,0) + coalesce(v_ncac,0)) / (a.ssdp/a.sdt) else null end,
      'thieu_bien', (v_bien is null),
      'thieu_khoi_3', coalesce(a.n_thieu_k3,0) > 0,
      'thieu_chi_phi_co_hoi', v_kin,                                               -- kín mà không có pool đơn thay thế
      'k3_chua_tach', true                                                         -- k3 chưa tách biến/định → tăng thêm=0
    ) order by g.b), '[]'::jsonb) into v_dai
  from generate_series(0,4) g(b) left join a on a.b = g.b;

  return jsonb_build_object(
    'ma_ky', p_ky, 'vat', v_vat, 'bien_muc_tieu', v_bien, 'cac_du_kien_n_cac', v_ncac,
    'nang_luc_kin', v_kin, 'ty_le_lap_day', v_tyle, 'cot_dang_sang', v_cot, 'ly_do_sang', v_ly,
    'nguong', to_jsonb(p_nguong), 'dai', v_dai);
end $$;
grant execute on function kho.cac_toi_da_ky(text, boolean, numeric[]) to authenticated;

do $$ begin
  if to_regprocedure('kho.cac_toi_da_ky(text,boolean,numeric[])') is null then raise exception 'THIẾU cac_toi_da_ky'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='kho' and table_name='tham_so_tai_chinh' and column_name='bien_muc_tieu')
    then raise exception 'THIẾU bien_muc_tieu'; end if;
  raise notice 'db/203 OK: tham_so_tai_chinh.bien_muc_tieu + cac_toi_da_ky (hai cột ngắn/dài hạn).';
end $$;
commit;
