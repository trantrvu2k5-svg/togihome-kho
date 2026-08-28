-- db/170 (WP-08 L-03) — ĐƯỜNG THỢ ĐỌC THEO PHIÊN BẢN ĐÃ NEO.
--   Mọi hàm chạy THEO MÓN lấy bước qua kho.buoc_cua_mon(mon_id) (nguồn suy DUY NHẤT, L-02).
--   Không còn câu tự SELECT quy_trinh_buoc WHERE ma_quy_trinh=... trong nhóm theo-món.
--   Hàm nhận ma_quy_trinh/loi (kiem_quy_trinh, quy_trinh_cua_loi): +p_phien_ban DEFAULT NULL (NULL=hien_hanh),
--   KHÔNG đổi chữ ký cũ (default nên lời gọi 1 tham số vẫn chạy).
begin;

-- ═══ 0. quy_trinh_cua_mon: DỰ PHÒNG mẫu CHƯA đăng ký phiên bản (tạo qua qt_luu_buoc/test, không có
--    dòng quy_trinh_phien_ban) → rơi về phien_ban THẬT của bước (min), tránh buoc_cua_mon trả rỗng. ═══
create or replace function kho.quy_trinh_cua_mon(p_mon_id uuid)
 returns table(ma_quy_trinh text, phien_ban int)
 language sql stable security definer set search_path to 'kho' as $fn$
  select s.qt,
         coalesce(m.quy_trinh_phien_ban,
                  (select pb.phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh = s.qt and pb.trang_thai = 'hien_hanh'),
                  (select min(b.phien_ban) from kho.quy_trinh_buoc b where b.ma_quy_trinh = s.qt))
  from kho.don_hang_mon m
  cross join lateral (
    select coalesce(m.ma_quy_trinh,
             (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id)) as qt) s
  where m.id = p_mon_id
$fn$;

-- ═══ do_gio_that ═══
CREATE OR REPLACE FUNCTION kho.do_gio_that(p_mon uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_qt text; v_hd text; v_thieu text; v_bang jsonb := '[]'::jsonb; v_so int; v_cham numeric; v_hong numeric; v_lam numeric; v_tems text[];
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','thiet_ke') then raise exception 'do_gio_that: chỉ ceo/xuong/thiet_ke'; end if;
  v_qt := kho.qt_hieu_luc(p_mon);
  if v_qt is null then raise exception 'do_gio_that: món "%" chưa có quy trình', p_mon; end if;
  v_tems := array(select distinct ma_tam from kho.tem_ban_ve where mon_id = p_mon);   -- idx_tem_mon (không join toàn bảng)
  select string_agg(d.ten, ', ') into v_thieu from kho.buoc_cua_mon(p_mon) qb left join kho.don_gia_baseline d on d.hoat_dong=qb.hoat_dong
    where coalesce(qb.loai_buoc,'nguoi')<>'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
        where sq.tem_ma = any(v_tems) and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=qb.hoat_dong);
  if v_thieu is not null then raise exception 'CHUA_QUET_XONG: món còn thiếu bước: %', v_thieu; end if;
  for v_hd in select distinct qb.hoat_dong from kho.buoc_cua_mon(p_mon) qb where coalesce(qb.loai_buoc,'nguoi')<>'tu_chay' loop
    select count(distinct sq.tem_ma) into v_so from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      where sq.tem_ma = any(v_tems) and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=v_hd;
    select coalesce(sum(case when sq.loai='ra' then extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) else -extract(epoch from coalesce(sq.ghi_bu_cho,sq.luc)) end),0)/3600.0,
           coalesce(sum(sq.so_hong) filter (where sq.loai='ra'),0), coalesce(sum(sq.so_lam_lai) filter (where sq.loai='ra'),0)
      into v_cham, v_hong, v_lam
      from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
      where sq.tem_ma = any(v_tems) and sq.ket_qua='nhan' and t.hoat_dong=v_hd;
    insert into kho.so_don_vi_mon(mon_id, hoat_dong, moc, so_don_vi, nguon, so_hong, so_lam_lai, nguoi_nhap)
      values (p_mon, v_hd, 'thuc_te', v_so, 'cutlist', v_hong, v_lam, kho.current_ns())
      on conflict (mon_id, hoat_dong, moc) do update set so_don_vi=excluded.so_don_vi, so_hong=excluded.so_hong, so_lam_lai=excluded.so_lam_lai, luc=now();
    v_bang := v_bang || jsonb_build_array(jsonb_build_object('hoat_dong', v_hd, 'so_don_vi', v_so,
      'gio_cham_tay', round(v_cham::numeric,4), 'so_hong', v_hong, 'so_lam_lai', v_lam));
  end loop;
  return jsonb_build_object('ok', true, 'mon_id', p_mon, 'bang', v_bang);
end $function$
;

-- ═══ gio_du_kien_cua_mon ═══
CREATE OR REPLACE FUNCTION kho.gio_du_kien_cua_mon(p_mon uuid, p_moc text DEFAULT 'chuan'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_sp text; v_qt text; r record; v_buoc jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb;
        v_tong numeric := 0; v_mauso numeric; v_sodv numeric; v_nguon text; v_gio numeric;
        v_co int; v_nguoi int := 0; v_loi text := null; v_src text;
        v_chot timestamptz; v_gmdv_c numeric; v_gcd_c numeric;
        v_co_chot boolean := false; v_co_live boolean := false; v_co_thieu_chot boolean := false; v_nguon_gio text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'gio_du_kien_cua_mon: vai không xem được'; end if;
  if p_moc not in ('du_kien','chuan','thuc_te') then raise exception 'gio_du_kien_cua_mon: mốc "%" không hợp lệ', p_moc; end if;
  select ma_quy_trinh, sp_id into v_qt, v_sp from kho.don_hang_mon where id = p_mon;
  if not found then raise exception 'gio_du_kien_cua_mon: không có món "%"', p_mon; end if;
  if v_qt is null and v_sp is not null then
    select l.ma_quy_trinh into v_qt from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = v_sp;
  end if;
  if v_qt is null then
    return jsonb_build_object('ok', false, 'loi', 'LOI_CHUA_GAN_QUY_TRINH', 'moc', p_moc, 'nguon_gio', null, 'tong_gio', null, 'buoc','[]'::jsonb, 'thieu','[]'::jsonb); end if;

  select count(*) into v_co from kho.so_don_vi_mon where mon_id = p_mon and moc = p_moc;
  for r in select * from kho.buoc_cua_mon(p_mon) order by thu_tu loop
    if r.loai_buoc = 'tu_chay' then
      v_gio := coalesce(r.gio_co_dinh, 0);   -- bước tự chạy KHÔNG có số → giờ luôn LIVE (ghi hở ở so_no.md)
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','tu_chay','so_don_vi',null,'nguon','tu_chay','gio',v_gio,'nguon_gio','live');
      v_tong := v_tong + v_gio;
    else
      v_nguoi := v_nguoi + 1;
      select mau_so into v_mauso from kho.don_gia_baseline where hoat_dong = r.hoat_dong;
      if v_mauso is null or v_mauso = 0 then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_DON_GIA'); continue; end if;
      select so_don_vi, nguon, chot_luc, gio_moi_don_vi_chot, gio_co_dinh_chot
        into v_sodv, v_nguon, v_chot, v_gmdv_c, v_gcd_c
        from kho.so_don_vi_mon where mon_id = p_mon and hoat_dong = r.hoat_dong and moc = p_moc;
      if not found then
        v_thieu := v_thieu || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'ma','THIEU_SO_DON_VI'); continue; end if;
      -- ĐÃ CHỐT (chỉ chuan có chot_luc) → dùng phút đóng băng; CHƯA chốt / du_kien / thuc_te → LIVE
      if v_chot is not null and v_gmdv_c is not null then
        v_gio := coalesce(v_gcd_c,0) + v_gmdv_c * v_sodv; v_src := 'da_chot'; v_co_chot := true;
      elsif v_chot is not null then
        v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv; v_src := 'thieu_so_chot'; v_co_thieu_chot := true;
      else
        v_gio := coalesce(r.gio_co_dinh,0) + coalesce(r.gio_moi_don_vi,0) * v_sodv; v_src := 'live'; v_co_live := true;
      end if;
      v_buoc := v_buoc || jsonb_build_object('thu_tu',r.thu_tu,'hoat_dong',r.hoat_dong,'loai_buoc','nguoi','so_don_vi',v_sodv,'nguon',v_nguon,'gio',v_gio,'nguon_gio',v_src);
      v_tong := v_tong + v_gio;
    end if;
  end loop;

  if v_co = 0 and v_nguoi > 0 then v_loi := 'THIEU_MOC'; end if;
  v_nguon_gio := case when v_co_thieu_chot then 'thieu_so_chot'
                      when v_co_chot and v_co_live then 'lan'
                      when v_co_chot then 'da_chot' else 'live' end;
  return jsonb_build_object(
    'ok', (jsonb_array_length(v_thieu) = 0), 'loi', coalesce(v_loi, null), 'moc', p_moc, 'nguon_gio', v_nguon_gio,
    'tong_gio', case when jsonb_array_length(v_thieu) = 0 then v_tong else null end,
    'buoc', v_buoc, 'thieu', v_thieu);
end $function$
;

-- ═══ nhap_so_chi_tiet_mon ═══
CREATE OR REPLACE FUNCTION kho.nhap_so_chi_tiet_mon(p_mon uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_sp text; v_qt text; v_goi_y text; v_dung text; v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','thiet_ke') then raise exception 'nhap_so: chỉ ceo/thiet_ke'; end if;
  select ma_quy_trinh, sp_id into v_qt, v_sp from kho.don_hang_mon where id = p_mon;
  if not found then raise exception 'nhap_so: không có món "%"', p_mon; end if;
  if v_sp is not null then
    select l.ma_quy_trinh into v_goi_y from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = v_sp;
  end if;
  v_dung := coalesce(v_qt, v_goi_y);
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
    from kho.buoc_cua_mon(p_mon) b
    left join kho.so_don_vi_mon sd on sd.mon_id = p_mon and sd.hoat_dong = b.hoat_dong and sd.moc = 'chuan';
  return jsonb_build_object('chua_gan', false, 'ma_quy_trinh', v_qt, 'goi_y', v_goi_y, 'dang_dung', v_dung, 'buoc', v_buoc);
end $function$
;

-- ═══ viec_dang_giu ═══
CREATE OR REPLACE FUNCTION kho.viec_dang_giu(p_ma_ns uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tem text, mon text, buoc integer, tram text, tram_ten text, nguoi_id uuid, nguoi_ten text, giu_tu timestamp with time zone, giu_gio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
  with mo as (
    select sq.tem_ma, sq.ma_tram,
           count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') as d,
           max(kho.sq_luc(sq.*)) filter (where sq.loai='vao') as vao_luc,
           (array_agg(sq.nguoi_id order by kho.sq_luc(sq.*) desc) filter (where sq.loai='vao'))[1] as nguoi
    from kho.su_kien_quet sq
    where sq.ket_qua='nhan'
    group by sq.tem_ma, sq.ma_tram
    having count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') > 0
  )
  select mo.tem_ma, dm.ten, qb.thu_tu, mo.ma_tram, tr.ten, mo.nguoi, nd.ho_ten, mo.vao_luc,
         round(extract(epoch from (now() - mo.vao_luc))/3600.0, 2)
  from mo
  join kho.tram tr on tr.ma_tram = mo.ma_tram
  left join lateral (select mon_id from kho.tem_ban_ve where ma_tam = mo.tem_ma order by phien_ban desc limit 1) tbv on true
  left join kho.don_hang_mon dm on dm.id = tbv.mon_id
  left join lateral (select thu_tu from kho.buoc_cua_mon(tbv.mon_id) where hoat_dong = tr.hoat_dong limit 1) qb on true
  left join kho.nguoi_dung nd on nd.id = mo.nguoi
  where p_ma_ns is null or mo.nguoi = p_ma_ns
  order by mo.vao_luc;
$function$
;

-- ═══ tl_don_co_van_de ═══
CREATE OR REPLACE FUNCTION kho.tl_don_co_van_de(p_loai text DEFAULT 'tat'::text, p_ma_to text DEFAULT NULL::text, p_tim text DEFAULT NULL::text, p_gioi_han integer DEFAULT 12, p_bo_qua integer DEFAULT 0)
 RETURNS TABLE(ma_don text, ten_khach text, ngay_hen_khach date, loai_van_de text[], chi_tiet text, tong_so bigint, dem_tat bigint, dem_tre bigint, dem_thu_tu bigint, dem_dung bigint, dem_thieu bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_tim text := nullif(lower(btrim(coalesce(p_tim,''))),''); v_to text := nullif(btrim(coalesce(p_ma_to,'')),'');
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_don_co_van_de: chỉ ceo/xuong'; end if;
  return query
  with base as (
    select d.ma_don, d.trang_thai, d.ngay_hen_khach, d.ten_khach,
      (d.trang_thai in ('cho_cat','da_cat','dang_lam')) as dang_sx
    from kho.don_hang d
    where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao',
                           'moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')
  ),
  prob as (
    select b.ma_don, b.ten_khach, b.ngay_hen_khach,
      kho.tl_don_sap_tre(b.ma_don) as v_tre,
      exists(
        select 1 from kho.xep_lich a
        join kho.buoc_cua_mon(a.mon_id) qb on qb.thu_tu = a.buoc_thu_tu
        join kho.xep_lich pre on pre.mon_id = a.mon_id and pre.buoc_thu_tu = any(qb.buoc_truoc)
        where a.ma_don = b.ma_don and pre.tuan_bat_dau > a.tuan_bat_dau
      ) as v_thu_tu,
      exists(select 1 from kho.tien_do_tem t
             where t.ma_don = b.ma_don and t.trang_thai <> 'xong_het'
               and t.cap_nhat_luc < now() - interval '3 days') as v_dung,
      (b.dang_sx and not exists(select 1 from kho.gio_don_da_tinh g
                                where g.ma_don = b.ma_don and g.moc = 'chuan')) as v_thieu
    from base b
  ),
  tong as (
    select count(*) filter (where v_tre) t_tre, count(*) filter (where v_thu_tu) t_tt,
           count(*) filter (where v_dung) t_d, count(*) filter (where v_thieu) t_th,
           count(*) filter (where v_tre or v_thu_tu or v_dung or v_thieu) t_tat
    from prob
  ),
  loc as (
    select p.* from prob p
    where (p.v_tre or p.v_thu_tu or p.v_dung or p.v_thieu)
      and case p_loai when 'tre' then p.v_tre when 'thu_tu' then p.v_thu_tu
                      when 'dung' then p.v_dung when 'thieu' then p.v_thieu else true end
      and (v_to is null or exists(select 1 from kho.xep_lich x where x.ma_don=p.ma_don and x.ma_to = v_to))
      and (v_tim is null or lower(p.ma_don||' '||coalesce(p.ten_khach,'')) like '%'||v_tim||'%')
  )
  select l.ma_don, l.ten_khach, l.ngay_hen_khach,
    array_remove(array[case when l.v_tre then 'tre' end, case when l.v_thu_tu then 'thu_tu' end,
                       case when l.v_dung then 'dung' end, case when l.v_thieu then 'thieu' end], null),
    (case when l.v_tre then 'lịch xong sau hẹn' when l.v_thu_tu then 'bước sau nằm trước'
          when l.v_dung then 'tem đứng yên >3 ngày' else 'chưa nhập số đơn vị' end),
    count(*) over(), t.t_tat, t.t_tre, t.t_tt, t.t_d, t.t_th
  from loc l cross join tong t
  order by l.ngay_hen_khach nulls last, l.ma_don
  limit p_gioi_han offset p_bo_qua;
end $function$
;

-- ═══ tl_tuan_doi_duoc ═══
CREATE OR REPLACE FUNCTION kho.tl_tuan_doi_duoc(p_viec_id bigint, p_ngoai_le boolean DEFAULT false, p_so_tuan integer DEFAULT 12)
 RETURNS TABLE(tuan_bat_dau date, co_the_doi boolean, ly_do_khong text, vung text, gio_hien_co numeric, nang_luc numeric, se_vuot boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v xep_lich%rowtype; v_qt text; v_min date; v_max date; i int; v_tu date; v_ws date; v_vung text; v_nl numeric; v_gio numeric;
  v_pre int[]; v_suc int[];
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'tl_tuan_doi_duoc: chỉ ceo/xuong'; end if;
  select * into v from kho.xep_lich where id = p_viec_id;
  if not found then raise exception 'tl_tuan_doi_duoc: không thấy việc %', p_viec_id; end if;
  select coalesce(qb.buoc_truoc,'{}') into v_pre from kho.buoc_cua_mon(v.mon_id) qb where qb.thu_tu=v.buoc_thu_tu;
  select coalesce(array_agg(qb.thu_tu),'{}') into v_suc from kho.buoc_cua_mon(v.mon_id) qb where v.buoc_thu_tu = any(qb.buoc_truoc);
  select max(x.tuan_bat_dau) into v_min from kho.xep_lich x where x.mon_id = v.mon_id and x.buoc_thu_tu = any(v_pre);
  select min(x.tuan_bat_dau) into v_max from kho.xep_lich x where x.mon_id = v.mon_id and x.buoc_thu_tu = any(v_suc);
  v_tu := kho.tuan_cua(current_date);
  for i in 0 .. p_so_tuan-1 loop
    v_ws := v_tu + i*7;
    if v_ws = v.tuan_bat_dau then continue; end if;
    v_vung := kho.vung_cua_tuan(v_ws);
    select coalesce(sum(x.gio),0) into v_gio from kho.xep_lich x where x.ma_to=v.ma_to and x.tuan_bat_dau=v_ws;
    select gio_nen into v_nl from kho.nang_luc_to_tuan(v.ma_to, v_ws, v_ws+7) limit 1;
    tuan_bat_dau := v_ws; vung := v_vung; gio_hien_co := round(v_gio,1); nang_luc := v_nl;
    se_vuot := v_nl is not null and (v_gio + v.gio) > v_nl;
    if v_min is not null and v_ws < v_min then
      co_the_doi := false; ly_do_khong := 'bước trước ở tuần '||to_char(v_min,'DD/MM');
    elsif v_max is not null and v_ws > v_max then
      co_the_doi := false; ly_do_khong := 'bước sau ở tuần '||to_char(v_max,'DD/MM');
    elsif v_vung = 'dong_bang' and not (p_ngoai_le and v_vai='ceo') then
      co_the_doi := false; ly_do_khong := 'tuần đóng băng';
    else
      co_the_doi := true; ly_do_khong := null;
    end if;
    return next;
  end loop;
end $function$
;

-- ═══ sched_buoc ═══
CREATE OR REPLACE FUNCTION kho.sched_buoc(p_ma_don text, p_moc text DEFAULT 'chuan'::text)
 RETURNS TABLE(mon_id uuid, thu_tu integer, hoat_dong text, ma_to text, gio numeric, loai_buoc text, buoc_truoc integer[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_don uuid; m record; v_qt text;
begin
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'sched_buoc: không có đơn "%"', p_ma_don; end if;
  for m in select id, sp_id, ma_quy_trinh, coalesce(so_luong,1) sl from kho.don_hang_mon where don_id = v_don loop
    return query
      select m.id, b.thu_tu, b.hoat_dong,
        case when coalesce(b.loai_buoc,'nguoi') = 'tu_chay' then null else d.ma_to end,
        case when coalesce(b.loai_buoc,'nguoi') = 'tu_chay' then coalesce(b.gio_co_dinh,0)
             else (select case when s.so_don_vi is null then null
                     else coalesce(b.gio_co_dinh,0) + coalesce(b.gio_moi_don_vi,0) * s.so_don_vi * m.sl end
                   from (select so_don_vi from kho.so_don_vi_mon sdv where sdv.mon_id = m.id and sdv.hoat_dong = b.hoat_dong and sdv.moc = p_moc) s)
        end,
        coalesce(b.loai_buoc,'nguoi'), b.buoc_truoc
      from kho.buoc_cua_mon(m.id) b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
      where coalesce(b.loai_buoc,'nguoi') in ('nguoi','tu_chay');
  end loop;
end $function$
;

-- ═══ capnhat_tien_do_tem ═══
CREATE OR REPLACE FUNCTION kho.capnhat_tien_do_tem(p_tem text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_mon uuid; v_don text; v_qt text; v_nhieu boolean; v_nhanh text;
        v_tong int; v_xong int; v_bhien int; v_to text; v_tt text; v_tramo text; v_vao timestamptz; v_ra timestamptz;
begin
  select mon_id, ma_don into v_mon, v_don from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1;
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  if v_qt is null or v_nhieu then delete from kho.tien_do_tem where tem_ma = p_tem; return; end if;   -- không quy trình rõ
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  select count(*) into v_tong from kho.buoc_cua_mon(v_mon) where coalesce(loai_buoc,'nguoi') <> 'tu_chay';
  select count(*) into v_xong from kho.buoc_cua_mon(v_mon) b where coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
    and exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
                where sq.tem_ma = p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong = b.hoat_dong);

  -- ĐANG LÀM? bước có 'vao' chưa 'ra' (mới nhất)
  select b.thu_tu, t.ma_tram, d.ma_to,
         (select max(kho.sq_luc(s.*)) from kho.su_kien_quet s where s.tem_ma=p_tem and s.ma_tram=t.ma_tram and s.loai='vao' and s.ket_qua='nhan')
    into v_bhien, v_tramo, v_to, v_vao
    from kho.buoc_cua_mon(v_mon) b join kho.tram t on t.hoat_dong = b.hoat_dong
    left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
    join kho.su_kien_quet sq on sq.ma_tram = t.ma_tram and sq.tem_ma = p_tem and sq.ket_qua='nhan'
    group by b.thu_tu, t.ma_tram, d.ma_to
    having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra')
    order by b.thu_tu desc limit 1;

  if v_bhien is not null then
    v_tt := 'dang_lam'; v_ra := null;
  else
    -- BƯỚC KẾ TIẾP (nhánh-aware): bước người trên đường tem, chưa 'ra', predecessors LIÊN QUAN đã 'ra'
    select b.thu_tu, d.ma_to into v_bhien, v_to
      from kho.buoc_cua_mon(v_mon) b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
      where coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
        and (v_nhanh='chung' or b.nhanh='chung' or b.nhanh = v_nhanh)
        and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                        where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong)
        and coalesce((select bool_and(exists (select 1 from kho.su_kien_quet sq2 join kho.tram t2 on t2.ma_tram=sq2.ma_tram
                        where sq2.tem_ma=p_tem and sq2.loai='ra' and sq2.ket_qua='nhan' and t2.hoat_dong=pb.hoat_dong))
                      from unnest(coalesce(b.buoc_truoc,array[]::int[])) pr
                      join kho.buoc_cua_mon(v_mon) pb on pb.thu_tu=pr
                      where v_nhanh='chung' or pb.nhanh='chung' or pb.nhanh=v_nhanh), true)
      order by b.thu_tu limit 1;
    v_ra := (select max(kho.sq_luc(s.*)) from kho.su_kien_quet s where s.tem_ma=p_tem and s.loai='ra' and s.ket_qua='nhan');
    if v_bhien is not null then v_tt := 'cho_vao'; v_tramo := null; v_vao := null;
    elsif v_tong > 0 and v_xong >= v_tong then v_tt := 'xong_het'; v_to := null; v_tramo := null;
    else v_tt := 'cho_vao'; v_to := null; v_tramo := null; end if;   -- hiếm: không bước kế mà chưa xong hết
  end if;

  insert into kho.tien_do_tem(tem_ma,mon_id,ma_don,buoc_hien_tai,to_hien_tai,nhanh,trang_thai,tram_dang_o,vao_luc,ra_luc,so_buoc_xong,tong_so_buoc,cap_nhat_luc)
    values (p_tem,v_mon,v_don,v_bhien,v_to,v_nhanh,v_tt,v_tramo,v_vao,v_ra,v_xong,v_tong,now())
  on conflict (tem_ma) do update set mon_id=excluded.mon_id, ma_don=excluded.ma_don, buoc_hien_tai=excluded.buoc_hien_tai,
    to_hien_tai=excluded.to_hien_tai, nhanh=excluded.nhanh, trang_thai=excluded.trang_thai, tram_dang_o=excluded.tram_dang_o,
    vao_luc=excluded.vao_luc, ra_luc=excluded.ra_luc, so_buoc_xong=excluded.so_buoc_xong, tong_so_buoc=excluded.tong_so_buoc, cap_nhat_luc=now();
end $function$
;

-- ═══ tien_do_tam ═══
CREATE OR REPLACE FUNCTION kho.tien_do_tam(p_tem text, p_tram text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_mon uuid; v_qt text; v_tong int; v_xong int; v_ke int; v_ke_ten text; v_cur int; v_cur_ten text;
  v_cham numeric := 0; v_first timestamptz; v_last timestamptz;
  v_ds jsonb; v_tram_hd text; v_xong_mon boolean;
begin
  if coalesce(kho.current_vai_tro(),'') = '' then raise exception 'tien_do: chưa đăng nhập'; end if;
  v_mon := kho.sq_tem_mon(p_tem);
  v_qt  := case when v_mon is null then null else kho.qt_hieu_luc(v_mon) end;
  if v_qt is null then raise exception 'tien_do: tem "%" chưa gắn quy trình', p_tem; end if;
  select count(*) into v_tong from kho.buoc_cua_mon(v_mon) where coalesce(loai_buoc,'nguoi') <> 'tu_chay';
  select count(*) into v_xong from kho.buoc_cua_mon(v_mon) b where coalesce(b.loai_buoc,'nguoi')<>'tu_chay'
    and exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong);
  select coalesce(sum(case when loai='ra' then extract(epoch from coalesce(ghi_bu_cho,luc)) else -extract(epoch from coalesce(ghi_bu_cho,luc)) end),0)/3600.0,
         min(coalesce(ghi_bu_cho,luc)), max(coalesce(ghi_bu_cho,luc))
    into v_cham, v_first, v_last from kho.su_kien_quet where tem_ma=p_tem and ket_qua='nhan';
  -- bước hiện tại = bước đang 'vao' chưa 'ra' (giữ nguyên)
  select b.thu_tu, d.ten into v_cur, v_cur_ten from kho.buoc_cua_mon(v_mon) b join kho.tram t on t.hoat_dong=b.hoat_dong
    join kho.su_kien_quet sq on sq.ma_tram=t.ma_tram and sq.tem_ma=p_tem and sq.ket_qua='nhan'
    left join kho.don_gia_baseline d on d.hoat_dong=b.hoat_dong
    group by b.thu_tu, d.ten
    having count(*) filter (where sq.loai='vao') > count(*) filter (where sq.loai='ra') order by b.thu_tu desc limit 1;

  -- trạm đang quét → hoạt động của nó (đánh cờ cua_tram_nay)
  if p_tram is not null then select hoat_dong into v_tram_hd from kho.tram where ma_tram = p_tram; end if;

  -- MẢNG mọi bước SẴN SÀNG: chưa 'ra' + MỌI buoc_truoc đã 'ra'. Sắp: cua_tram_nay trước, rồi thu_tu tăng.
  with san_sang as (
    select b.thu_tu, coalesce(d.ten, b.hoat_dong) as ten_buoc, b.nhanh, b.to_phu_trach,
           (select ma_tram from kho.tram t where t.hoat_dong = b.hoat_dong limit 1) as ma_tram,
           (v_tram_hd is not null and b.hoat_dong = v_tram_hd) as cua_tram_nay
    from kho.buoc_cua_mon(v_mon) b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
    where coalesce(b.loai_buoc,'nguoi') <> 'tu_chay'
      and not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram=sq.ma_tram
                      where sq.tem_ma=p_tem and sq.loai='ra' and sq.ket_qua='nhan' and t.hoat_dong=b.hoat_dong)
      -- bool_and(∅)=NULL → bước KHÔNG có buoc_truoc (bước đầu) phải coi là SẴN SÀNG → coalesce true
      and coalesce((select bool_and(exists (select 1 from kho.su_kien_quet sq2 join kho.tram t2 on t2.ma_tram=sq2.ma_tram
             join kho.buoc_cua_mon(v_mon) pb on pb.thu_tu=pr
             where sq2.tem_ma=p_tem and sq2.loai='ra' and sq2.ket_qua='nhan' and t2.hoat_dong=pb.hoat_dong))
           from unnest(coalesce(b.buoc_truoc,array[]::int[])) pr), true)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'thu_tu', thu_tu, 'ten_buoc', ten_buoc, 'nhanh', nhanh, 'to', to_phu_trach,
           'tram', ma_tram, 'cua_tram_nay', cua_tram_nay)
           order by cua_tram_nay desc, thu_tu asc), '[]'::jsonb)
    into v_ds from san_sang;

  v_ke     := (v_ds->0->>'thu_tu')::int;        -- trường cũ = phần tử ĐẦU mảng đã sắp (giữ UI L-33)
  v_ke_ten := v_ds->0->>'ten_buoc';
  v_xong_mon := (v_tong > 0 and v_xong >= v_tong);

  return jsonb_build_object(
    'tem', p_tem, 'buoc_hien_tai', v_cur, 'ten_buoc_hien_tai', v_cur_ten,
    'buoc_ke_tiep', v_ke, 'ten_buoc_ke_tiep', v_ke_ten,
    'buoc_ke_ds', v_ds, 'xong_mon', v_xong_mon,
    'xong', v_xong, 'tong_buoc', v_tong,
    'dung_yen_phut', case when v_last is null then null else round((extract(epoch from now()-v_last)/60)::numeric,1) end,
    'gio_cham_tay', round(v_cham::numeric, 4),
    'gio_troi_qua', case when v_first is null then 0 else round((extract(epoch from coalesce(v_last,v_first)-v_first)/3600)::numeric, 4) end);
end $function$
;

-- ═══ sq_ghi ═══
CREATE OR REPLACE FUNCTION kho.sq_ghi(p_tem text, p_tram text, p_loai_ep text, p_nguon text, p_ghi_bu_cho timestamp with time zone, p_ly_do text, p_so_hong numeric, p_so_lam_lai numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_qt text; v_nhieu boolean; v_ns uuid; v_tt text; v_loai text; v_buoc record; v_thieu text;
        p int; v_pre_hd text; v_pre_nhanh text; v_nhanh text; v_sk uuid; v_bf jsonb := null; v_hd text; v_mon uuid;
        v_dang int; v_giu int; v_so_phut int; v_canh_bao text := null;
begin
  -- WP-46a L-34: gốc "ai làm" = PHIÊN THỢ HÔM NAY tại trạm (một gốc, không hai). ca_lam thôi quyết định công.
  v_ns := kho.phien_nguoi(p_tram);

  -- ■1 (db/165): loai do NGƯỜI khai. Không default, không đoán.
  if p_loai_ep is null or p_loai_ep not in ('vao','ra') then
    raise exception 'sq_ghi: loai phải là "vao" hoặc "ra", nhận "%"', coalesce(p_loai_ep, '(null)');
  end if;
  v_loai := p_loai_ep;

  if not exists (select 1 from kho.tem_ban_ve where ma_tam = p_tem) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TEM_LA', 'tem không có trong hệ thống'); end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram and dang_dung) then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_TAT', 'trạm không dùng được'); end if;
  -- ■2 · không có phiên thợ hôm nay → RAISE (KHÔNG fallback ca_lam / người đăng nhập)
  if v_ns is null then
    raise exception 'chưa có thợ nhận trạm — chọn thợ nhận trạm trước'; end if;
  v_tt := coalesce(kho.sq_tram_trang_thai(p_tram), 'chay');
  if v_tt <> 'chay' then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'TRAM_KHONG_CHAY', 'trạm đang "'||v_tt||'", không chạy'); end if;
  select qt, nhieu into v_qt, v_nhieu from kho.sq_qt_cua_tem(p_tem);
  v_mon := (select mon_id from kho.tem_ban_ve where ma_tam = p_tem order by phien_ban desc limit 1);   -- WP-08: đọc theo phiên bản neo
  if v_nhieu then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHIEU_QUY_TRINH', 'đơn này có nhiều quy trình, cần gán tấm vào món trước'); end if;
  if v_qt is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'CHUA_QUY_TRINH', 'sản phẩm này chưa có quy trình sản xuất'); end if;
  select b.thu_tu, b.buoc_truoc into v_buoc
    from kho.buoc_cua_mon(v_mon) b join kho.tram t on t.ma_tram = p_tram
    where b.hoat_dong = t.hoat_dong limit 1;
  if v_buoc.thu_tu is null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'SAI_TRAM', 'quy trình không có bước cho trạm này'); end if;

  -- Cổng tiền đề theo buoc_truoc (QD-01) — GIỮ NGUYÊN.
  v_nhanh := kho.nhanh_cua_tem(p_tem) ->> 'nhanh';
  v_thieu := null;
  foreach p in array coalesce(v_buoc.buoc_truoc, array[]::int[]) loop
    select b.hoat_dong, b.nhanh into v_pre_hd, v_pre_nhanh
      from kho.buoc_cua_mon(v_mon) b where b.thu_tu = p;
    if v_nhanh = 'chung' or v_pre_nhanh = 'chung' or v_pre_nhanh = v_nhanh then
      if not exists (select 1 from kho.su_kien_quet sq join kho.tram t on t.ma_tram = sq.ma_tram
        where sq.tem_ma = p_tem and sq.loai = 'ra' and sq.ket_qua = 'nhan' and t.hoat_dong = v_pre_hd) then
        v_thieu := concat_ws(', ', v_thieu, (select ten from kho.don_gia_baseline where hoat_dong = v_pre_hd));
      end if;
    end if;
  end loop;
  if v_thieu is not null then
    return kho.sq_chan(p_tem, p_tram, v_ns, v_loai, p_nguon, p_ghi_bu_cho, 'NHAY_BUOC', 'tấm này chưa qua ' || v_thieu); end if;

  -- ■2 HAI NÚT (db/165) — trạng thái giữ việc tại CHÍNH trạm này
  select count(*) filter (where loai='vao') - count(*) filter (where loai='ra')
    into v_dang from kho.su_kien_quet where tem_ma = p_tem and ma_tram = p_tram and ket_qua = 'nhan';
  if v_loai = 'vao' and v_dang > 0 then raise exception 'đang giữ việc này rồi'; end if;
  if v_loai = 'ra' and v_dang <= 0 then raise exception 'chưa nhận việc'; end if;

  -- ■2d cảnh báo giữ việc trạm khác (QD-69) — KHÔNG chặn
  if v_loai = 'vao' then
    select count(*) into v_giu from (
      select sq.tem_ma, sq.ma_tram, count(*) filter (where sq.loai='vao') - count(*) filter (where sq.loai='ra') d
      from kho.su_kien_quet sq
      where sq.nguoi_id = v_ns and sq.ket_qua = 'nhan' and not (sq.tem_ma = p_tem and sq.ma_tram = p_tram)
      group by sq.tem_ma, sq.ma_tram) s where s.d > 0;
    if v_giu > 0 then v_canh_bao := 'Bạn đang giữ ' || v_giu || ' việc chưa xong ở trạm khác'; end if;
  end if;

  -- ■4 giờ thật (db/165)
  if v_loai = 'ra' then
    select round(extract(epoch from (coalesce(p_ghi_bu_cho, now()) - max(kho.sq_luc(sq.*)))) / 60)::int
      into v_so_phut from kho.su_kien_quet sq
      where sq.tem_ma = p_tem and sq.ma_tram = p_tram and sq.loai = 'vao' and sq.ket_qua = 'nhan';
  end if;

  insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,nguon,ghi_bu_cho,ly_do_chan,so_hong,so_lam_lai,so_phut)
    values (p_tem, p_tram, v_ns, v_loai, 'nhan', p_nguon, p_ghi_bu_cho, case when p_nguon='tay' then p_ly_do else null end,
            coalesce(p_so_hong,0), coalesce(p_so_lam_lai,0), v_so_phut) returning id into v_sk;
  perform kho.capnhat_tien_do_tem(p_tem);
  select t.hoat_dong into v_hd from kho.tram t where t.ma_tram = p_tram;
  select mon_id into v_mon from kho.tem_ban_ve where ma_tam = p_tem;
  if v_mon is not null and v_hd in ('cat','thung','canh','ray','cup','cam','giuong_lap') then
    begin
      perform set_config('kho.back_flush_he_thong','1',true);
      v_bf := kho.xuat_back_flush(v_mon, case when v_hd='cat' then 'van' else 'phu_kien' end, v_sk);
      perform set_config('kho.back_flush_he_thong','',true);
    exception when others then v_bf := jsonb_build_object('ket_qua','loi','loi',left(SQLERRM,120)); end;
  end if;
  return jsonb_build_object('ok', true, 'loai', v_loai, 'ket_qua', 'nhan', 'nguoi_id', v_ns, 'buoc', v_buoc.thu_tu, 'nhanh', v_nhanh,
    'so_phut', v_so_phut, 'canh_bao', v_canh_bao,
    'back_flush', coalesce(v_bf->'dong','[]'::jsonb), 'bf_phieu', v_bf->>'phieu_so', 'thieu_he_so', coalesce(v_bf->'thieu_he_so','[]'::jsonb));
end $function$
;

-- ═══ quy_trinh_cua_loi ═══
CREATE OR REPLACE FUNCTION kho.quy_trinh_cua_loi(p_loi text, p_phien_ban int DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_qt text; v_pb int; v_buoc jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'quy_trinh_cua_loi: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  if not exists (select 1 from kho.san_pham_loi where ma_loi = p_loi) then
    raise exception 'quy_trinh_cua_loi: không có lõi "%"', p_loi; end if;
  select ma_quy_trinh into v_qt from kho.san_pham_loi where ma_loi = p_loi;
  if v_qt is null then
    return jsonb_build_object('chua_co_quy_trinh', true, 'ma_quy_trinh', null, 'buoc', '[]'::jsonb); end if;
  -- WP-08: phiên bản (NULL = hien_hanh)
  v_pb := coalesce(p_phien_ban, (select phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh=v_qt and pb.trang_thai='hien_hanh'));
  select coalesce(jsonb_agg(jsonb_build_object(
      'thu_tu', b.thu_tu, 'buoc_truoc', b.buoc_truoc, 'nhanh', b.nhanh,
      'hoat_dong', b.hoat_dong, 'ten_hoat_dong', (select d.ten from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'to_gia_von', (select d.ma_to from kho.don_gia_baseline d where d.hoat_dong = b.hoat_dong),
      'loai_buoc', b.loai_buoc, 'to_phu_trach', b.to_phu_trach,
      'gio_co_dinh', b.gio_co_dinh, 'gio_moi_don_vi', b.gio_moi_don_vi, 'la_tam', b.la_tam, 'ghi_chu', b.ghi_chu
    ) order by b.thu_tu), '[]'::jsonb)
    into v_buoc from kho.quy_trinh_buoc b where b.ma_quy_trinh = v_qt and b.phien_ban = v_pb;
  return jsonb_build_object('chua_co_quy_trinh', (v_buoc = '[]'::jsonb), 'ma_quy_trinh', v_qt, 'phien_ban', v_pb, 'buoc', v_buoc);
end $function$
;

-- ═══ kiem_quy_trinh ═══
CREATE OR REPLACE FUNCTION kho.kiem_quy_trinh(p_qt text, p_phien_ban int DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare loi jsonb := '[]'::jsonb; tmp jsonb; v_all int[]; v_pb int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','thiet_ke','xuong') then
    raise exception 'kiem_quy_trinh: chỉ ceo/ke_toan/thiet_ke/xuong'; end if;
  v_pb := coalesce(p_phien_ban, (select phien_ban from kho.quy_trinh_phien_ban pb where pb.ma_quy_trinh=p_qt and pb.trang_thai='hien_hanh'));
  select array_agg(thu_tu) into v_all from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_pb;
  if v_all is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','buoc_truoc_khong_ton_tai','thu_tu',b.thu_tu,'thieu',p)), '[]'::jsonb)
    into tmp from kho.quy_trinh_buoc b cross join lateral unnest(b.buoc_truoc) p
    where b.ma_quy_trinh = p_qt and b.phien_ban = v_pb and not (p = any (v_all));
  loi := loi || tmp;
  if not exists (select 1 from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_pb and cardinality(buoc_truoc) = 0) then
    loi := loi || jsonb_build_array(jsonb_build_object('loai','khong_co_buoc_khoi_dau')); end if;
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_pb),
  walk(seed, cur, path, cyc) as (
    select thu_tu, thu_tu, array[thu_tu], false from nodes
    union all
    select w.seed, n.thu_tu, w.path || n.thu_tu, n.thu_tu = any (w.path)
    from walk w join nodes n on w.cur = any (n.buoc_truoc)
    where not w.cyc and cardinality(w.path) <= (select count(*) from nodes)
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('loai','chu_trinh','tai',cur)), '[]'::jsonb) into tmp from walk where cyc;
  loi := loi || tmp;
  with recursive nodes as (select thu_tu, buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh = p_qt and phien_ban = v_pb),
  reach as (
    select thu_tu from nodes where cardinality(buoc_truoc) = 0
    union
    select n.thu_tu from nodes n join reach r on r.thu_tu = any (n.buoc_truoc)
  )
  select coalesce(jsonb_agg(jsonb_build_object('loai','khong_voi_toi','thu_tu',thu_tu)), '[]'::jsonb) into tmp
    from nodes where thu_tu not in (select thu_tu from reach);
  loi := loi || tmp;
  return loi;
end $function$
;

-- ═══ dung_lai_gio_don_moc ═══
CREATE OR REPLACE FUNCTION kho.dung_lai_gio_don_moc(p_ma_don text, p_moc text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
begin
  delete from kho.gio_don_da_tinh where ma_don = p_ma_don and moc = p_moc;
  if exists (
    select 1 from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
    where d.ma_don = p_ma_don and (
      not exists (select 1 from kho.buoc_cua_mon(dm.id))
      or exists (select 1 from kho.buoc_cua_mon(dm.id) qb where coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
           and ( not exists (select 1 from kho.so_don_vi_mon s where s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = p_moc)
                 or coalesce((select mau_so from kho.don_gia_baseline where hoat_dong = qb.hoat_dong), 0) = 0 )))
  ) then return; end if;
  insert into kho.gio_don_da_tinh(ma_don, ma_to, moc, gio, tinh_luc)
  select p_ma_don, coalesce(d2.ma_to, '(chưa rõ tổ)'), p_moc,
    sum( (case when coalesce(qb.loai_buoc,'nguoi') = 'tu_chay' then coalesce(qb.gio_co_dinh,0)
               when s.chot_luc is not null and s.gio_moi_don_vi_chot is not null then coalesce(s.gio_co_dinh_chot,0) + s.gio_moi_don_vi_chot * s.so_don_vi
               else coalesce(qb.gio_co_dinh,0) + coalesce(qb.gio_moi_don_vi,0) * s.so_don_vi end) * coalesce(dm.so_luong,1) ), now()
  from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
    join kho.buoc_cua_mon(dm.id) qb on true
    left join kho.so_don_vi_mon s on s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = p_moc and coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
    left join kho.don_gia_baseline d2 on d2.hoat_dong = qb.hoat_dong
  where d.ma_don = p_ma_don
  group by coalesce(d2.ma_to, '(chưa rõ tổ)');
end $function$
;

commit;
