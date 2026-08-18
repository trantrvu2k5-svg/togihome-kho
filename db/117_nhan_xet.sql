-- 117 — MÀN "NHẬN XÉT THEO LUẬT" (L-50): 8 luật đối chiếu số kỳ, TÁI DÙNG 6 RPC nguồn (CẤM tính lại công thức).
--   ⚠ IDEMPOTENT: alter add column if not exists (ngưỡng nullable — NULL = đang dùng mặc định) · create or replace hàm.
--   META-MÀN (CEO chốt 18/08): nhan_xet_ky GỌI pl_ky + cm_don_ky + kenh_cac_ky + lap_day_ky + con_phai_thu + dong_tien_ky.
--     Ngân sách tốc độ = TỔNG các hạng phân tích nó gọi (~1.5s @stress 100k; real kỳ vài trăm đơn <100ms). LUẬT 2 HẠNG (QD-40)
--     bổ sung: meta-màn = Σ nguồn. Từng RPC nguồn vẫn <900ms.
--   GIỌNG: mỗi nhận xét = câu + CÂU HỎI (không mệnh lệnh) + bằng chứng số + căn cứ. Mẫu mỏng → IM LẶNG kèm lý do (không phán).
--     Garrison ch.6: KHÔNG gợi ý cắt segment (định phí chung không biến mất). Ngưỡng = tham số kỳ, sửa không hồi tố.
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop function if exists kho.nhan_xet_ky(text), kho.nguong_ghi(text,jsonb);
--   alter table kho.tham_so_tai_chinh drop column if exists nguong_k3_le, drop column if exists mau_toi_thieu_don,
--     drop column if exists nguong_kenh_yeu, drop column if exists mau_toi_thieu_khach, drop column if exists nguong_lap_day_thap,
--     drop column if exists nguong_lap_day_cao, drop column if exists nguong_no_gia, drop column if exists nguong_cod_ket,
--     drop column if exists nguong_lai_hut_tien; commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. 9 NGƯỠNG — cột NULLABLE trên tham_so_tai_chinh (NULL = dùng mặc định, có cờ) ═══════════════
alter table kho.tham_so_tai_chinh add column if not exists nguong_k3_le          numeric;  -- % k3/DT dòng lẻ (mặc định 8)
alter table kho.tham_so_tai_chinh add column if not exists mau_toi_thieu_don     numeric;  -- đơn trọn tối thiểu (5)
alter table kho.tham_so_tai_chinh add column if not exists nguong_kenh_yeu       numeric;  -- điểm % CM kênh dưới TB (10)
alter table kho.tham_so_tai_chinh add column if not exists mau_toi_thieu_khach   numeric;  -- khách mới tối thiểu 1 kênh (3)
alter table kho.tham_so_tai_chinh add column if not exists nguong_lap_day_thap   numeric;  -- % lấp đầy sàn (75)
alter table kho.tham_so_tai_chinh add column if not exists nguong_lap_day_cao    numeric;  -- % lấp đầy trần (95)
alter table kho.tham_so_tai_chinh add column if not exists nguong_no_gia         numeric;  -- % nợ>60/DT kỳ (8)
alter table kho.tham_so_tai_chinh add column if not exists nguong_cod_ket        numeric;  -- số đơn COD kẹt >14 ngày (2)
alter table kho.tham_so_tai_chinh add column if not exists nguong_lai_hut_tien   numeric;  -- triệu đồng ròng âm (50)

-- nhãn kênh (6 giá trị nguon_khach) → tên hiển thị
create or replace function kho._nx_ten_kenh(p text) returns text language sql immutable as $$
  select case p when 'quang_cao' then 'Quảng cáo' when 'gioi_thieu' then 'Giới thiệu' when 'cua_hang' then 'Cửa hàng'
    when 'san_tmdt' then 'Sàn TMĐT' when 'khach_cu' then 'Khách cũ' when 'khac' then 'Khác' else coalesce(p,'—') end $$;

-- ═══════════════ 2. nguong_ghi(p_ky, p_nguong) — set ngưỡng kỳ (không hồi tố; NULL/khuyết = giữ) ═══════════════
create or replace function kho.nguong_ghi(p_ky text, p_nguong jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'nguong_ghi: chỉ ceo/ke_toan'; end if;
  if p_ky is null or p_ky='' then raise exception 'nguong_ghi: thiếu ma_ky'; end if;
  update kho.tham_so_tai_chinh set
    nguong_k3_le        = coalesce(nullif(p_nguong->>'nguong_k3_le','')::numeric,        nguong_k3_le),
    mau_toi_thieu_don   = coalesce(nullif(p_nguong->>'mau_toi_thieu_don','')::numeric,   mau_toi_thieu_don),
    nguong_kenh_yeu     = coalesce(nullif(p_nguong->>'nguong_kenh_yeu','')::numeric,     nguong_kenh_yeu),
    mau_toi_thieu_khach = coalesce(nullif(p_nguong->>'mau_toi_thieu_khach','')::numeric, mau_toi_thieu_khach),
    nguong_lap_day_thap = coalesce(nullif(p_nguong->>'nguong_lap_day_thap','')::numeric, nguong_lap_day_thap),
    nguong_lap_day_cao  = coalesce(nullif(p_nguong->>'nguong_lap_day_cao','')::numeric,  nguong_lap_day_cao),
    nguong_no_gia       = coalesce(nullif(p_nguong->>'nguong_no_gia','')::numeric,       nguong_no_gia),
    nguong_cod_ket      = coalesce(nullif(p_nguong->>'nguong_cod_ket','')::numeric,      nguong_cod_ket),
    nguong_lai_hut_tien = coalesce(nullif(p_nguong->>'nguong_lai_hut_tien','')::numeric, nguong_lai_hut_tien)
  where ma_ky = p_ky; get diagnostics v = row_count;
  if v = 0 then raise exception 'nguong_ghi: kỳ % chưa có tham số tài chính', p_ky; end if;
  return jsonb_build_object('ok',true,'ma_ky',p_ky);
end $$;
grant execute on function kho.nguong_ghi(text, jsonb) to authenticated;

-- ═══════════════ 3. nhan_xet_ky(p_ky) — 8 luật, tái dùng 6 RPC nguồn ═══════════════
create or replace function kho.nhan_xet_ky(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho set jit='off' as $$
declare
  t record; v_from date; v_to date;
  -- ngưỡng hiệu lực + cờ mặc định
  n_k3 numeric; n_don numeric; n_kyeu numeric; n_khach numeric; n_ldt numeric; n_ldc numeric; n_no numeric; n_cod numeric; n_hut numeric;
  v_md text[] := array[]::text[];   -- danh sách ngưỡng đang dùng mặc định
  -- output
  v_nx jsonb := '[]'::jsonb; v_im jsonb := '[]'::jsonb; c_canh int:=0; c_soi int:=0;
  -- nguồn
  v_pl jsonb; v_cm jsonb; v_kenh jsonb; v_lap jsonb; v_no jsonb; v_dt jsonb;
  -- tạm
  v_sothieu int; v_dtcty numeric; v_lai numeric; r record; v_bc text; v_kbc jsonb;
  n_le int; k3_le numeric; dt_le numeric; pct numeric;
  cm_tb numeric; kyeu record; v_lap_ty numeric;
  no_gia numeric; old_ma text; old_tuoi int; old_con numeric;
  cod_ket int; v_dt_o jsonb; e jsonb;
  rong numeric; chenh numeric; p_no numeric; p_vc numeric; p_ngoai numeric; p_khac numeric;
  helper_le int; helper_combo int; helper_du_an int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'nhan_xet_ky: chỉ ceo/ke_toan'; end if;
  select * into t from kho.tham_so_tai_chinh where ma_ky = p_ky;
  if not found then raise exception 'nhan_xet_ky: kỳ % chưa có tham số tài chính', p_ky; end if;
  v_from := to_date(p_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  -- ngưỡng: coalesce(cột, mặc định) + ghi cờ nếu cột NULL
  n_k3   := coalesce(t.nguong_k3_le,8);          if t.nguong_k3_le is null then v_md := v_md||array['nguong_k3_le']; end if;
  n_don  := coalesce(t.mau_toi_thieu_don,5);      if t.mau_toi_thieu_don is null then v_md := v_md||array['mau_toi_thieu_don']; end if;
  n_kyeu := coalesce(t.nguong_kenh_yeu,10);        if t.nguong_kenh_yeu is null then v_md := v_md||array['nguong_kenh_yeu']; end if;
  n_khach:= coalesce(t.mau_toi_thieu_khach,3);     if t.mau_toi_thieu_khach is null then v_md := v_md||array['mau_toi_thieu_khach']; end if;
  n_ldt  := coalesce(t.nguong_lap_day_thap,75);    if t.nguong_lap_day_thap is null then v_md := v_md||array['nguong_lap_day_thap']; end if;
  n_ldc  := coalesce(t.nguong_lap_day_cao,95);     if t.nguong_lap_day_cao is null then v_md := v_md||array['nguong_lap_day_cao']; end if;
  n_no   := coalesce(t.nguong_no_gia,8);           if t.nguong_no_gia is null then v_md := v_md||array['nguong_no_gia']; end if;
  n_cod  := coalesce(t.nguong_cod_ket,2);          if t.nguong_cod_ket is null then v_md := v_md||array['nguong_cod_ket']; end if;
  n_hut  := coalesce(t.nguong_lai_hut_tien,50);    if t.nguong_lai_hut_tien is null then v_md := v_md||array['nguong_lai_hut_tien']; end if;

  -- ════ GỌI 6 RPC NGUỒN (tái dùng, KHÔNG tính lại) ════
  v_pl   := kho.pl_ky(p_ky);
  v_cm   := kho.cm_don_ky(p_ky);
  v_kenh := kho.kenh_cac_ky(p_ky);
  v_lap  := kho.lap_day_ky(p_ky);
  v_no   := kho.con_phai_thu(1);
  v_dt   := kho.dong_tien_ky(p_ky);
  v_dtcty := coalesce((v_pl->'dong'->'doanh_thu_thuan'->>'toan_cty')::numeric,0);
  -- đếm đơn trọn theo dòng (guard mẫu L2 — sample size, KHÔNG phải công thức)
  select count(*) filter(where dong='le'), count(*) filter(where dong='combo'), count(*) filter(where dong='du_an')
    into helper_le, helper_combo, helper_du_an
  from kho.don_hang d join kho.don_hang_gia_von gv on gv.ma_don=d.ma_don
  where d.trang_thai='da_giao' and coalesce(d.la_demo,false)=false and d.ngay_giao>=v_from and d.ngay_giao<v_to;

  -- ════ L1 · CẢNH BÁO — đơn giao thiếu giá vốn/ship-lắp (không ngưỡng) ════
  v_sothieu := coalesce((v_cm->'tong'->>'so_thieu')::int,0);
  if v_sothieu > 0 then
    select string_agg(x.ma_don||' ('||array_to_string(array(select jsonb_array_elements_text(x.thieu)),', ')||')', ' · ')
      into v_bc from (select value->>'ma_don' ma_don, value->'thieu' thieu from jsonb_array_elements(v_cm->'ds') where jsonb_array_length(coalesce(value->'thieu','[]'::jsonb))>0 limit 4) x;
    v_nx := v_nx || jsonb_build_object('luat','L1','muc','canh_bao',
      'cau', 'Số kỳ này chưa tin được — '||v_sothieu||' đơn đã giao thiếu giá vốn hoặc ship/lắp.',
      'cau_hoi','Ai phụ trách điền nốt trước khi họp số?',
      'bang_chung', coalesce(v_bc,'')||case when v_bc is not null then ' — ' else '' end||v_sothieu||' đơn chưa trọn, không vào xếp hạng CM.',
      'can_cu','Luật 1 · nguồn: màn Lãi theo đơn · QD-37 (đơn chưa trọn không vào xếp hạng)',
      'so_lieu', jsonb_build_object('so_thieu',v_sothieu)); c_canh:=c_canh+1;
  end if;

  -- ════ L2 · ĐÁNG SOI — k3 dòng lẻ / DT thuần lẻ > ngưỡng (cần ≥ mẫu tối thiểu đơn trọn lẻ) ════
  k3_le := coalesce((v_pl->'dong'->'k3'->>'le')::numeric,0);
  dt_le := coalesce((v_pl->'dong'->'doanh_thu_thuan'->>'le')::numeric,0);
  if helper_le < n_don then
    v_im := v_im || jsonb_build_object('luat','L2','ly_do','k3 ăn dòng lẻ: chỉ '||helper_le||' đơn trọn dòng lẻ (<'||n_don||') — chưa đủ mẫu để kết luận.');
  elsif dt_le > 0 and k3_le/dt_le > n_k3/100.0 then
    pct := round(k3_le/dt_le*1000)/10.0;
    v_nx := v_nx || jsonb_build_object('luat','L2','muc','dang_soi',
      'cau','Chi phí cấp đơn đang ăn '||pct||'% doanh thu dòng Lẻ.',
      'cau_hoi','Giá sàn dòng lẻ có đang gánh đủ k3?',
      'bang_chung','k3 dòng Lẻ: '||to_char(k3_le,'FM999,999,999')||' / DT thuần '||to_char(dt_le,'FM999,999,999')||' = '||pct||'% · ngưỡng luật: '||n_k3||'% · '||helper_le||' đơn trọn (≥'||n_don||', đủ mẫu)',
      'can_cu','Luật 2 · nguồn: màn Lãi theo đơn · DACTA khối ③ (batch-level cost)',
      'so_lieu', jsonb_build_object('k3_le',k3_le,'dt_le',dt_le,'pct',pct,'nguong',n_k3,'so_don',helper_le)); c_soi:=c_soi+1;
  end if;

  -- ════ L3 · ĐÁNG SOI — CM% kênh < CM% TB − ngưỡng (cần khách mới kênh ≥ mẫu tối thiểu) ════
  cm_tb := case when coalesce((v_kenh->'tong'->>'dt_thuan')::numeric,0)>0
    then (v_kenh->'tong'->>'cm_kenh')::numeric / (v_kenh->'tong'->>'dt_thuan')::numeric * 100 else null end;
  if cm_tb is not null then
    select kenh, sum(cm_kenh) cm, sum(dt_thuan) dt, sum(khach_moi_brand) khach into kyeu from
      jsonb_to_recordset(v_kenh->'dong') as x(kenh text, cm_kenh numeric, dt_thuan numeric, khach_moi_brand numeric)
      where nullif(btrim(kenh),'') is not null and kenh <> '(chưa ghi nguồn)'
      group by kenh
      having sum(dt_thuan) > 0 and sum(khach_moi_brand) >= n_khach
        and sum(cm_kenh)/sum(dt_thuan)*100 < cm_tb - n_kyeu
      order by sum(cm_kenh)/sum(dt_thuan)*100 asc limit 1;
    if found then
      pct := round(kyeu.cm/kyeu.dt*1000)/10.0;
      v_nx := v_nx || jsonb_build_object('luat','L3','muc','dang_soi',
        'cau','Kênh '||kho._nx_ten_kenh(kyeu.kenh)||' có CM% '||pct||'% — thấp hơn trung bình '||round(cm_tb*10)/10.0||'% tới '||round((cm_tb-pct)*10)/10.0||' điểm.',
        'cau_hoi','Kênh này đáng đầu tư tiếp hay dồn sang kênh khoẻ hơn?',
        'bang_chung','CM% kênh '||kho._nx_ten_kenh(kyeu.kenh)||': '||pct||'% vs TB '||round(cm_tb*10)/10.0||'% · ngưỡng yếu: '||n_kyeu||' điểm % · '||kyeu.khach::int||' khách mới (≥'||n_khach||')',
        'can_cu','Luật 3 · nguồn: màn Kênh & CAC',
        'so_lieu', jsonb_build_object('kenh',kyeu.kenh,'cm_pct',pct,'cm_tb',cm_tb,'khach',kyeu.khach)); c_soi:=c_soi+1;
    else
      -- có kênh dưới TB nhưng mẫu mỏng?
      select kho._nx_ten_kenh(kenh) ten, sum(khach_moi_brand) khach into r from
        jsonb_to_recordset(v_kenh->'dong') as x(kenh text, cm_kenh numeric, dt_thuan numeric, khach_moi_brand numeric)
        where nullif(btrim(kenh),'') is not null and kenh <> '(chưa ghi nguồn)'
        group by kenh having sum(dt_thuan)>0 and sum(cm_kenh)/sum(dt_thuan)*100 < cm_tb - n_kyeu and sum(khach_moi_brand) < n_khach
        order by sum(khach_moi_brand) desc limit 1;
      if found then v_im := v_im || jsonb_build_object('luat','L3','ly_do','kênh yếu: kênh '||r.ten||' chỉ '||r.khach::int||' khách mới (<'||n_khach||', chưa đủ mẫu để kết luận).'); end if;
    end if;
  end if;

  -- ════ L4 · CẢNH BÁO — kênh vô hạn (ads>0, 0 khách mới); nếu không có → dòng ỔN ════
  select brand||'/'||kho._nx_ten_kenh(kenh) k, chi_ads_that into r from
    jsonb_to_recordset(v_kenh->'dong') as x(brand text, kenh text, vo_han bool, chi_ads_that numeric)
    where vo_han is true order by chi_ads_that desc limit 1;
  if found then
    v_nx := v_nx || jsonb_build_object('luat','L4','muc','canh_bao',
      'cau','Kênh '||r.k||' chi ads nhưng 0 khách mới — CAC vô hạn.',
      'cau_hoi','Tắt kênh này, đổi thông điệp, hay chờ thêm dữ liệu?',
      'bang_chung','Chi ads thật '||to_char(r.chi_ads_that,'FM999,999,999')||' · 0 khách mới trong kỳ',
      'can_cu','Luật 4 · nguồn: màn Kênh & CAC', 'so_lieu', jsonb_build_object('chi_ads',r.chi_ads_that)); c_canh:=c_canh+1;
  else
    v_nx := v_nx || jsonb_build_object('luat','L4','muc','on',
      'cau','Không kênh nào chi ads mà 0 khách mới — CAC các kênh trả tiền đều hữu hạn.',
      'cau_hoi',null,'bang_chung',null,'can_cu','Luật 4 · nguồn: màn Kênh & CAC','so_lieu',null);
  end if;

  -- ════ L5 · ĐÁNG SOI — lấp đầy ngoài dải [thấp, cao]; hai câu KHÁC NHAU ════
  v_lap_ty := (v_lap->>'ty_le_lap_day')::numeric;
  if v_lap_ty is null then
    v_im := v_im || jsonb_build_object('luat','L5','ly_do','xưởng trống/kín: kỳ chưa chốt chi phí năng lực — chưa tính được lấp đầy.');
  elsif v_lap_ty < n_ldt/100.0 then
    v_nx := v_nx || jsonb_build_object('luat','L5','muc','dang_soi',
      'cau','Xưởng trống '||to_char(coalesce((v_lap->>'tien_bo_trong')::numeric,0),'FM999,999,999')||' năng lực kỳ này (lấp đầy '||round(v_lap_ty*1000)/10.0||'%).',
      'cau_hoi','Đơn CM dương dưới giá sàn có đáng nhận thêm không?',
      'bang_chung','Chi phí năng lực '||to_char(coalesce((v_lap->>'mau_so_dung')::numeric,0),'FM999,999,999')||' · Σ khối 2: '||to_char(coalesce((v_lap->>'tong_khoi_2')::numeric,0),'FM999,999,999')||' · trống '||to_char(coalesce((v_lap->>'tien_bo_trong')::numeric,0),'FM999,999,999')||' = '||round((1-v_lap_ty)*1000)/10.0||'% · ngưỡng lấp đầy sàn: '||n_ldt||'%',
      'can_cu','Luật 5 · nguồn: màn Lấp đầy · Garrison ch.12 + App.3A (cost of unused capacity)',
      'so_lieu', jsonb_build_object('ty_le',v_lap_ty,'huong','trong')); c_soi:=c_soi+1;
  elsif v_lap_ty > n_ldc/100.0 then
    v_nx := v_nx || jsonb_build_object('luat','L5','muc','dang_soi',
      'cau','Xưởng gần kín (lấp đầy '||round(v_lap_ty*1000)/10.0||'%) — năng lực khan.',
      'cau_hoi','Ưu tiên đơn theo CM/khối 2 chưa, thay vì theo CM%?',
      'bang_chung','Lấp đầy '||round(v_lap_ty*1000)/10.0||'% · Σ khối 2: '||to_char(coalesce((v_lap->>'tong_khoi_2')::numeric,0),'FM999,999,999')||' / năng lực '||to_char(coalesce((v_lap->>'mau_so_dung')::numeric,0),'FM999,999,999')||' · ngưỡng trần: '||n_ldc||'%',
      'can_cu','Luật 5 · nguồn: màn Lấp đầy · Garrison ch.12 (ưu tiên theo constraint)',
      'so_lieu', jsonb_build_object('ty_le',v_lap_ty,'huong','kin')); c_soi:=c_soi+1;
  end if;

  -- ════ L6 · ĐÁNG SOI — nợ >60 ngày / DT thuần kỳ > ngưỡng ════
  no_gia := coalesce((v_no->'bac'->'bac3'->>'tien')::numeric,0);
  if v_dtcty > 0 and no_gia/v_dtcty > n_no/100.0 then
    old_ma := v_no->'dong'->0->>'ma_don'; old_tuoi := (v_no->'dong'->0->>'tuoi')::int; old_con := (v_no->'dong'->0->>'con_lai')::numeric;
    pct := round(no_gia/v_dtcty*1000)/10.0;
    v_nx := v_nx || jsonb_build_object('luat','L6','muc','dang_soi',
      'cau','Nợ quá 60 ngày đã bằng '||pct||'% doanh thu kỳ.',
      'cau_hoi','Đơn già nhất — ai đang đi đòi?',
      'bang_chung',to_char(no_gia,'FM999,999,999')||' quá 60 ngày / DT thuần kỳ '||to_char(v_dtcty,'FM999,999,999')||' = '||pct||'% · ngưỡng: '||n_no||'%'||case when old_ma is not null then ' · già nhất: '||old_ma||' ('||old_tuoi||' ngày, '||to_char(old_con,'FM999,999,999')||')' else '' end,
      'can_cu','Luật 6 · nguồn: màn Dòng tiền (khách nợ thật) · Garrison ch.14',
      'so_lieu', jsonb_build_object('no_gia',no_gia,'dt_ky',v_dtcty,'pct',pct,'old_ma',old_ma)); c_soi:=c_soi+1;
  end if;

  -- ════ L7 · ĐÁNG SOI — số đơn COD dang_giao quá 14 ngày ≥ ngưỡng ════
  v_dt_o := v_dt->'o_nha_vc'->'ds';
  select count(*) into cod_ket from jsonb_to_recordset(coalesce(v_dt_o,'[]'::jsonb)) as x(qua_14 bool) where qua_14 is true;
  if cod_ket >= n_cod then
    v_nx := v_nx || jsonb_build_object('luat','L7','muc','dang_soi',
      'cau', cod_ket||' đơn COD kẹt quá 14 ngày ở nhà vận chuyển.',
      'cau_hoi','Nhà vận chuyển nào đang giữ lâu — cần giục đối soát?',
      'bang_chung', cod_ket||' đơn quá 14 ngày (ngưỡng đếm: '||n_cod||' đơn) · tổng ở nhà VC '||to_char(coalesce((v_dt->'o_nha_vc'->>'tong')::numeric,0),'FM999,999,999'),
      'can_cu','Luật 7 · nguồn: màn Dòng tiền (mốc 14 ngày)',
      'so_lieu', jsonb_build_object('cod_ket',cod_ket,'nguong',n_cod)); c_soi:=c_soi+1;
  elsif cod_ket > 0 then
    v_im := v_im || jsonb_build_object('luat','L7','ly_do','COD kẹt: chỉ '||cod_ket||' đơn quá 14 ngày, dưới ngưỡng đếm '||n_cod||' đơn.');
  end if;

  -- ════ L8 · CẢNH BÁO — P/L lãi dương VÀ ròng dòng tiền âm quá ngưỡng; phân rã chênh ════
  v_lai := coalesce((v_pl->'dong'->'lai_thuan'->>'toan_cty')::numeric,0);
  rong  := coalesce((v_dt->'quy'->>'rong_kd')::numeric,0) + coalesce((v_dt->'quy'->>'rong_ngoai')::numeric,0);
  if v_lai > 0 and rong < -(n_hut*1000000) then
    chenh := v_lai - rong;
    p_no    := coalesce((v_no->>'tong')::numeric,0);
    p_vc    := coalesce((v_dt->'o_nha_vc'->>'tong')::numeric,0);
    p_ngoai := -coalesce((v_dt->'quy'->>'rong_ngoai')::numeric,0);
    p_khac  := chenh - (p_no + p_vc + p_ngoai);   -- residual → 4 phần CỘNG KHỚP chênh (bất biến test #5)
    v_nx := v_nx || jsonb_build_object('luat','L8','muc','canh_bao',
      'cau','Kỳ có lãi '||to_char(v_lai,'FM999,999,999')||' trên P/L nhưng tiền mặt ròng '||to_char(rong,'FM999,999,999')||'.',
      'cau_hoi','Tiền đang đọng ở đâu — nợ khách hay COD?',
      'bang_chung','Lãi thuần P/L: '||to_char(v_lai,'FM999,999,999')||' · ròng dòng tiền: '||to_char(rong,'FM999,999,999')||' · chênh: '||to_char(chenh,'FM999,999,999')||' (nợ khách '||to_char(p_no,'FM999,999,999')||' · ở nhà VC '||to_char(p_vc,'FM999,999,999')||' · ngoài KD '||to_char(p_ngoai,'FM999,999,999')||case when abs(p_khac)>=1 then ' · khác '||to_char(p_khac,'FM999,999,999') else '' end||')',
      'can_cu','Luật 8 · nguồn: P/L × Dòng tiền · Garrison ch.14 (lãi trên giấy, chết tiền mặt)',
      'so_lieu', jsonb_build_object('lai',v_lai,'rong',rong,'chenh',chenh,'no_khach',p_no,'o_nha_vc',p_vc,'ngoai_kd',p_ngoai,'khac',p_khac)); c_canh:=c_canh+1;
  end if;

  return jsonb_build_object(
    'ma_ky', p_ky,
    'nhan_xet', v_nx, 'im_lang', v_im,
    'dem', jsonb_build_object('canh_bao',c_canh,'dang_soi',c_soi,'im_lang', jsonb_array_length(v_im)),
    'nguong', jsonb_build_object('nguong_k3_le',n_k3,'mau_toi_thieu_don',n_don,'nguong_kenh_yeu',n_kyeu,
      'mau_toi_thieu_khach',n_khach,'nguong_lap_day_thap',n_ldt,'nguong_lap_day_cao',n_ldc,
      'nguong_no_gia',n_no,'nguong_cod_ket',n_cod,'nguong_lai_hut_tien',n_hut),
    'nguong_mac_dinh', to_jsonb(v_md)
  );
end $$;
grant execute on function kho.nhan_xet_ky(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.nhan_xet_ky(text)') is null then raise exception 'THIẾU nhan_xet_ky'; end if;
  if to_regprocedure('kho.nguong_ghi(text,jsonb)') is null then raise exception 'THIẾU nguong_ghi'; end if;
  raise notice 'db/117 OK: 9 ngưỡng + nguong_ghi + nhan_xet_ky (8 luật, tái dùng 6 RPC nguồn).';
end $$;
commit;
