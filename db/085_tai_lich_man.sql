-- db/085 — RPC màn "Tải & lịch" (L-31, bám BẢN 4 / MES 5.4.4).
-- ĐƯỜNG CHÍNH "Xếp lại đơn": tl_xep_thu (xem trước, KHÔNG ghi) + luu_xep_lich (lưu, đã có).
--   → CẢ HAI gọi CHUNG kho._sched — cấm hai thuật toán (xem trước một đằng lưu một nẻo).
-- ĐƯỜNG PHỤ "Dời tay một bước": tl_doi_viec (per-việc; ba cổng gác + LÝ DO bắt buộc).
-- A1 việc trong ô · A2 đơn có vấn đề (ĐẾM + LIST cùng nguồn) · A3 tuần dời được · A4 ảnh hưởng dời (phụ).
-- Tải/tổ theo xep_lich (giờ ĐÃ XẾP) — khớp nhánh da_xep của tai_theo_to_tuan.

begin;

-- ── helper: ma_quy_trinh của 1 món · đơn sắp trễ · tên tổ ──
create or replace function kho.tl_qt_cua_mon(p_mon_id uuid) returns text
  language sql stable security definer set search_path = kho as $$
  select coalesce(dm.ma_quy_trinh,
           (select l.ma_quy_trinh from kho.san_pham_mau sm
              join kho.san_pham_loi l on l.ma_loi = sm.ma_loi where sm.ma = dm.sp_id))
  from kho.don_hang_mon dm where dm.id = p_mon_id $$;

create or replace function kho.tl_don_sap_tre(p_ma_don text) returns boolean
  language sql stable security definer set search_path = kho as $$
  select coalesce((
    select d.ngay_hen_khach is not null and exists(
      select 1 from kho.xep_lich x where x.ma_don = p_ma_don
        and x.tuan_bat_dau > kho.tuan_cua(d.ngay_hen_khach))
    from kho.don_hang d where d.ma_don = p_ma_don), false) $$;

create or replace function kho.tl_ten_to(p_ma_to text) returns text
  language sql stable security definer set search_path = kho as $$
  select coalesce((select ten from kho.to_san_xuat where ma_to = p_ma_to), p_ma_to) $$;

-- ═════════ A1 · tl_viec_trong_o ═════════
drop function if exists kho.tl_viec_trong_o(text, date, int, int);
create or replace function kho.tl_viec_trong_o(p_ma_to text, p_tuan_bat_dau date, p_gioi_han int default 12, p_bo_qua int default 0)
  returns table(viec_id bigint, ma_don text, ten_khach text, ten_san_pham text,
                buoc_thu_tu int, ten_buoc text, gio numeric, la_hang_lam_san boolean,
                don_sap_tre boolean, tong_so bigint)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_viec_trong_o: chỉ ceo/xuong'; end if;
  return query
  select xl.id, xl.ma_don, d.ten_khach, coalesce(dm.ten, d.ma_don),
         xl.buoc_thu_tu, coalesce(xl.hoat_dong,'—'), xl.gio,
         (coalesce(d.ten_khach,'') = '') as lms,
         kho.tl_don_sap_tre(xl.ma_don),
         count(*) over() as tong_so
  from kho.xep_lich xl
  join kho.don_hang d on d.ma_don = xl.ma_don
  left join kho.don_hang_mon dm on dm.id = xl.mon_id
  where xl.ma_to = p_ma_to and xl.tuan_bat_dau = p_tuan_bat_dau
  order by (coalesce(d.ten_khach,'') = '') desc, xl.buoc_thu_tu, xl.ma_don
  limit p_gioi_han offset p_bo_qua;
end $$;
grant execute on function kho.tl_viec_trong_o(text, date, int, int) to authenticated;

-- ═════════ A2 · tl_don_co_van_de (ĐẾM + LIST cùng CTE prob — không thể lệch, bài học L-30) ═════════
drop function if exists kho.tl_don_co_van_de(text, text, text, int, int);
create or replace function kho.tl_don_co_van_de(p_loai text default 'tat', p_ma_to text default null,
                p_tim text default null, p_gioi_han int default 12, p_bo_qua int default 0)
  returns table(ma_don text, ten_khach text, ngay_hen_khach date, loai_van_de text[], chi_tiet text,
                tong_so bigint, dem_tat bigint, dem_tre bigint, dem_thu_tu bigint, dem_dung bigint, dem_thieu bigint)
  language plpgsql stable security definer set search_path = kho as $$
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
        join kho.quy_trinh_buoc qb on qb.ma_quy_trinh = kho.tl_qt_cua_mon(a.mon_id) and qb.thu_tu = a.buoc_thu_tu
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
end $$;
grant execute on function kho.tl_don_co_van_de(text, text, text, int, int) to authenticated;

-- ═════════ tl_xep_thu · CHẠY THỬ đường chính (dùng CHUNG _sched với luu_xep_lich) ═════════
drop function if exists kho.tl_xep_thu(text, date, text, boolean);
create or replace function kho.tl_xep_thu(p_ma_don text, p_tuan_giao date default null, p_kieu text default 'nguoc', p_ngoai_le boolean default false)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_neo date; v_han date; r jsonb; e jsonb; i int; v_cu date; v_thu int; v_mid uuid; v_to text; v_gio numeric;
  v_lich jsonb := '[]'::jsonb; v_ket jsonb := '[]'::jsonb; v_kx jsonb := '[]'::jsonb;
  v_max date; v_vung text; v_key text;
  v_delta jsonb := '{}'::jsonb;   -- "ma_to|tuan" -> net giờ
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_xep_thu: chỉ ceo/xuong'; end if;
  if p_kieu not in ('nguoc','xuoi') then raise exception 'tl_xep_thu: kiểu phải nguoc/xuoi'; end if;
  select ngay_hen_khach into v_han from kho.don_hang where ma_don = p_ma_don;
  -- NEO GIỐNG HỆT luu_xep_lich: nguoc từ (tuan_giao hoặc hẹn khách), xuoi từ tuần này
  if p_kieu='nguoc' then v_neo := kho.tuan_cua(coalesce(p_tuan_giao, v_han));
  else v_neo := kho.tuan_cua(current_date); end if;
  r := kho._sched(p_ma_don, p_kieu, v_neo);
  if (r->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'loi', r->>'loi', 'chi_tiet', r); end if;

  -- gom net giờ theo (tổ, tuần) + dựng lịch cũ→mới + bước rơi đóng băng
  for i in 0 .. jsonb_array_length(r->'lich')-1 loop
    e := r->'lich'->i;
    v_thu := (e->>'thu_tu')::int; v_mid := (e->>'mon_id')::uuid; v_to := e->>'ma_to'; v_gio := coalesce((e->>'gio')::numeric,0);
    select tuan_bat_dau into v_cu from kho.xep_lich x where x.mon_id=v_mid and x.buoc_thu_tu=v_thu limit 1;
    v_lich := v_lich || jsonb_build_object('thu_tu',v_thu,'hoat_dong',e->>'hoat_dong','ma_to',v_to,
                'ten_to', kho.tl_ten_to(v_to), 'gio',v_gio,'loai_buoc',e->>'loai_buoc',
                'tuan_cu',v_cu,'tuan_moi',(e->>'tuan')::date,'doi', v_cu is distinct from (e->>'tuan')::date);
    if v_to is not null then
      if v_cu is not null then
        v_key := v_to||'|'||v_cu; v_delta := jsonb_set(v_delta, array[v_key], to_jsonb(coalesce((v_delta->>v_key)::numeric,0) - v_gio)); end if;
      v_key := v_to||'|'||(e->>'tuan'); v_delta := jsonb_set(v_delta, array[v_key], to_jsonb(coalesce((v_delta->>v_key)::numeric,0) + v_gio));
    end if;
    -- cổng ĐÓNG BĂNG (mirror luu_xep_lich): bước rơi dong_bang mà không ngoại lệ → không lưu được
    v_vung := kho.vung_cua_tuan((e->>'tuan')::date);
    if v_vung = 'dong_bang' and not p_ngoai_le then
      v_kx := v_kx || jsonb_build_object('thu_tu',v_thu,'hoat_dong',e->>'hoat_dong','ma_to',v_to,'ly_do','tuần đóng băng '||to_char((e->>'tuan')::date,'DD/MM')); end if;
  end loop;

  -- ngược mà phải xếp xuôi (đầu chuỗi lùi trước tuần này) → không xếp nổi
  if p_kieu='nguoc' and (r->>'phai_xep_xuoi')::boolean then
    v_kx := v_kx || jsonb_build_object('thu_tu',0,'hoat_dong','(đầu chuỗi)','ma_to',null,
              'ly_do','lùi trước tuần này '||coalesce(r->>'so_ngay_thieu','?')||' ngày — hẹn quá gấp'); end if;

  -- tải đổi trước/sau từng tổ×tuần
  for v_key in select k from jsonb_object_keys(v_delta) as t(k) loop
    declare mt text; tw date; dd numeric; tr numeric; nl numeric; begin
      mt := split_part(v_key,'|',1); tw := split_part(v_key,'|',2)::date; dd := (v_delta->>v_key)::numeric;
      if abs(dd) < 0.05 then continue; end if;
      select coalesce(sum(gio),0) into tr from kho.xep_lich where ma_to=mt and tuan_bat_dau=tw;
      select gio_nen into nl from kho.nang_luc_to_tuan(mt, tw, tw+7) limit 1;
      v_ket := v_ket || jsonb_build_object('ma_to',mt,'ten_to',kho.tl_ten_to(mt),'tuan',tw,
                 'truoc',round(tr,1),'sau',round(tr+dd,1),'nang_luc',nl,'vuot', nl is not null and (tr+dd) > nl);
    end;
  end loop;

  select max((el->>'tuan')::date) into v_max from jsonb_array_elements(r->'lich') as t(el);
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'kieu', p_kieu, 'tuan_giao', v_neo,
    'lich', v_lich, 'tai_doi', v_ket, 'khong_xep_noi', v_kx,
    'xong_tuan', v_max,
    'xong_sau_hen_ngay', case when v_han is not null then greatest(0, (v_max - kho.tuan_cua(v_han))) else null end);
end $$;
grant execute on function kho.tl_xep_thu(text, date, text, boolean) to authenticated;

-- ═════════ tl_so_viec_luoi · số việc mỗi ô (tổ×tuần) cho lưới ═════════
drop function if exists kho.tl_so_viec_luoi(date, date);
create or replace function kho.tl_so_viec_luoi(p_tu date, p_den date)
  returns table(ma_to text, tuan_bat_dau date, so_viec int)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_so_viec_luoi: chỉ ceo/xuong'; end if;
  return query
  select x.ma_to, x.tuan_bat_dau, count(*)::int
  from kho.xep_lich x
  where x.ma_to is not null and x.tuan_bat_dau >= kho.tuan_cua(p_tu) and x.tuan_bat_dau < p_den
  group by x.ma_to, x.tuan_bat_dau;
end $$;
grant execute on function kho.tl_so_viec_luoi(date, date) to authenticated;

-- ═════════ A3 · tl_tuan_doi_duoc (đường phụ: hộp dời tay) ═════════
drop function if exists kho.tl_tuan_doi_duoc(bigint, boolean, int);
create or replace function kho.tl_tuan_doi_duoc(p_viec_id bigint, p_ngoai_le boolean default false, p_so_tuan int default 12)
  returns table(tuan_bat_dau date, co_the_doi boolean, ly_do_khong text, vung text,
                gio_hien_co numeric, nang_luc numeric, se_vuot boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text; v xep_lich%rowtype; v_qt text; v_min date; v_max date; i int; v_tu date; v_ws date; v_vung text; v_nl numeric; v_gio numeric;
  v_pre int[]; v_suc int[];
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'tl_tuan_doi_duoc: chỉ ceo/xuong'; end if;
  select * into v from kho.xep_lich where id = p_viec_id;
  if not found then raise exception 'tl_tuan_doi_duoc: không thấy việc %', p_viec_id; end if;
  v_qt := kho.tl_qt_cua_mon(v.mon_id);
  select coalesce(qb.buoc_truoc,'{}') into v_pre from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and qb.thu_tu=v.buoc_thu_tu;
  select coalesce(array_agg(qb.thu_tu),'{}') into v_suc from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and v.buoc_thu_tu = any(qb.buoc_truoc);
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
end $$;
grant execute on function kho.tl_tuan_doi_duoc(bigint, boolean, int) to authenticated;

-- ═════════ A4 · tl_anh_huong_doi (đường phụ: chỉ tính) ═════════
drop function if exists kho.tl_anh_huong_doi(bigint, date);
create or replace function kho.tl_anh_huong_doi(p_viec_id bigint, p_tuan_moi date)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v xep_lich%rowtype; v_cu date; v_max_cu date; v_max_moi date; v_lui int;
  v_gcu numeric; v_gmoi numeric; v_nlcu numeric; v_nlmoi numeric; v_hen date; v_lms boolean;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'tl_anh_huong_doi: chỉ ceo/xuong'; end if;
  select * into v from kho.xep_lich where id = p_viec_id;
  if not found then raise exception 'tl_anh_huong_doi: không thấy việc %', p_viec_id; end if;
  v_cu := v.tuan_bat_dau;
  select coalesce(sum(gio),0) into v_gcu  from kho.xep_lich where ma_to=v.ma_to and tuan_bat_dau=v_cu;
  select coalesce(sum(gio),0) into v_gmoi from kho.xep_lich where ma_to=v.ma_to and tuan_bat_dau=p_tuan_moi;
  select gio_nen into v_nlcu  from kho.nang_luc_to_tuan(v.ma_to, v_cu,       v_cu+7) limit 1;
  select gio_nen into v_nlmoi from kho.nang_luc_to_tuan(v.ma_to, p_tuan_moi, p_tuan_moi+7) limit 1;
  select max(tuan_bat_dau) into v_max_cu from kho.xep_lich where ma_don=v.ma_don;
  select greatest(coalesce(max(tuan_bat_dau), p_tuan_moi), p_tuan_moi) into v_max_moi
    from kho.xep_lich where ma_don=v.ma_don and id <> p_viec_id;
  v_lui := (v_max_moi - v_max_cu);
  select ngay_hen_khach, (coalesce(ten_khach,'')='') into v_hen, v_lms from kho.don_hang where ma_don=v.ma_don;
  return jsonb_build_object(
    'viec_id', p_viec_id, 'ma_to', v.ma_to, 'ten_to', kho.tl_ten_to(v.ma_to), 'gio_viec', v.gio, 'la_hang_lam_san', v_lms,
    'tuan_cu', v_cu, 'tuan_moi', p_tuan_moi,
    'to_cu',  jsonb_build_object('truoc', round(v_gcu,1),  'sau', round(v_gcu - v.gio,1),  'nang_luc', v_nlcu),
    'to_moi', jsonb_build_object('truoc', round(v_gmoi,1), 'sau', round(v_gmoi + v.gio,1), 'nang_luc', v_nlmoi,
                                 'se_vuot', v_nlmoi is not null and (v_gmoi + v.gio) > v_nlmoi),
    'don_lui_ngay', v_lui,
    'tre_khach', (v_hen is not null and v_max_moi > kho.tuan_cua(v_hen)));
end $$;
grant execute on function kho.tl_anh_huong_doi(bigint, date) to authenticated;

-- ═════════ tl_doi_viec · ĐƯỜNG PHỤ dời tay 1 việc (ba cổng + LÝ DO bắt buộc) ═════════
drop function if exists kho.tl_doi_viec(bigint, date, boolean, text);
create or replace function kho.tl_doi_viec(p_viec_id bigint, p_tuan_moi date, p_ngoai_le boolean default false, p_ly_do text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_vai text; v xep_lich%rowtype; v_qt text; v_min date; v_max date; v_cu date; v_pre int[]; v_suc int[];
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'tl_doi_viec: chỉ ceo/xuong'; end if;
  -- ĐƯỜNG PHỤ: LÝ DO luôn bắt buộc (dời tay = ngoài kế hoạch, phải ghi vì sao)
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'tl_doi_viec: dời tay BẮT BUỘC có lý do (máy hỏng · thợ nghỉ · khách gọi gấp…)'; end if;
  select * into v from kho.xep_lich where id = p_viec_id;
  if not found then raise exception 'tl_doi_viec: không thấy việc %', p_viec_id; end if;
  if p_tuan_moi <> kho.tuan_cua(p_tuan_moi) then raise exception 'tl_doi_viec: tuần phải là thứ Hai (ISO)'; end if;
  v_cu := v.tuan_bat_dau; v_qt := kho.tl_qt_cua_mon(v.mon_id);
  -- cổng THỨ TỰ BƯỚC
  select coalesce(qb.buoc_truoc,'{}') into v_pre from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and qb.thu_tu=v.buoc_thu_tu;
  select coalesce(array_agg(qb.thu_tu),'{}') into v_suc from kho.quy_trinh_buoc qb where qb.ma_quy_trinh=v_qt and v.buoc_thu_tu = any(qb.buoc_truoc);
  select max(x.tuan_bat_dau) into v_min from kho.xep_lich x where x.mon_id=v.mon_id and x.buoc_thu_tu = any(v_pre);
  select min(x.tuan_bat_dau) into v_max from kho.xep_lich x where x.mon_id=v.mon_id and x.buoc_thu_tu = any(v_suc);
  if v_min is not null and p_tuan_moi < v_min then
    raise exception 'tl_doi_viec: sai thứ tự — bước trước ở tuần % (không lùi trước)', to_char(v_min,'DD/MM'); end if;
  if v_max is not null and p_tuan_moi > v_max then
    raise exception 'tl_doi_viec: sai thứ tự — bước sau ở tuần % (không dời sau)', to_char(v_max,'DD/MM'); end if;
  -- cổng ĐÓNG BĂNG — chỉ ceo + ngoại lệ + lý do
  if kho.vung_cua_tuan(p_tuan_moi) = 'dong_bang' then
    if not p_ngoai_le then raise exception 'tl_doi_viec: tuần ĐÓNG BĂNG (%) — cần ngoại lệ', p_tuan_moi; end if;
    if v_vai <> 'ceo' then raise exception 'tl_doi_viec: chỉ CEO mới xếp vào tuần đóng băng'; end if;
  end if;
  update kho.xep_lich
    set tuan_bat_dau = p_tuan_moi, ly_do = p_ly_do, xep_boi = kho.current_ns(), xep_luc = now()
    where id = p_viec_id;
  return jsonb_build_object('ok', true, 'viec_id', p_viec_id, 'tuan_cu', v_cu, 'tuan_moi', p_tuan_moi);
end $$;
grant execute on function kho.tl_doi_viec(bigint, date, boolean, text) to authenticated;

commit;
