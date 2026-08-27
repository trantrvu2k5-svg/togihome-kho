-- db/159 (WP-43 L-15) — GOM NEO XUÔI về MỘT nguồn: kho.neo_xuoi().
--   Trước: công thức "tuan_cua(current_date)+dong_bang×7" chép tay ở 3 chỗ (db/157 ban_giao_xuong,
--   db/158 luu_xep_lich, và db/085 tl_xep_thu còn neo thiếu dong_bang). Nay cả ba GỌI kho.neo_xuoi().
--   tl_xep_thu chỉ đổi ĐÚNG dòng neo 'xuoi'; logic preview + nhánh 'nguoc' GIỮ NGUYÊN.
begin;

-- (a) hàm neo DUY NHẤT
create or replace function kho.neo_xuoi() returns date
  language sql stable security definer set search_path = kho as $$
  select kho.tuan_cua(current_date) + (coalesce((select so_tuan from kho.moc_lich where ma='dong_bang'),0) * 7);
$$;
grant execute on function kho.neo_xuoi() to authenticated;

-- (b) ba chỗ dùng → gọi neo_xuoi()
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
  v_bom_cho jsonb;
  v_kieu text; v_xep jsonb; v_da_xep boolean := false; v_ly_do_xep text := null; v_so_dong_xep int := 0; v_i int; v_neo date;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','thiet_ke') then raise exception 'ban_giao_xuong: chỉ ceo/thiet_ke'; end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'DON_KHONG_TON_TAI: không có đơn "%"', p_ma_don; end if;
  v_ns := kho.current_ns();
  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then raise exception 'ban_giao_xuong: đơn "%" chưa ai nhận việc', p_ma_don; end if;
    if v_don.ma_ns_thiet_ke <> v_ns then raise exception 'ban_giao_xuong: đơn "%" không phải bạn cầm', p_ma_don; end if;
  end if;
  if v_don.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao') then
    raise exception 'DA_VAO_CHUYEN: đơn "%" đã ở "%" — không gửi lại', p_ma_don, v_don.trang_thai; end if;
  if v_don.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'DON_CHUA_CHOT: đơn "%" chưa chốt', p_ma_don; end if;
  if v_don.trang_thai not in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then
    raise exception 'TRANG_THAI_KHONG_DAY: đơn "%" ở "%" không gửi được', p_ma_don, v_don.trang_thai; end if;
  select string_agg(ten, ', ') into v_chua_gan from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'loi') = 'LOI_CHUA_GAN_QUY_TRINH') z;
  if v_chua_gan is not null then raise exception 'CHUA_GAN_QUY_TRINH: món chưa gán quy trình: %', v_chua_gan; end if;
  select string_agg(ten, ', ') into v_thieu_so from (
    select coalesce(nullif(btrim(m.ten),''), m.id::text) ten from kho.don_hang_mon m
    where m.don_id = v_don.id and (kho.gio_du_kien_cua_mon(m.id, 'chuan')->>'ok')::boolean is not true) z;
  if v_thieu_so is not null then raise exception 'THIEU_SO_DON_VI: món còn thiếu số: %', v_thieu_so; end if;

  select count(*) into v_miss
    from kho.so_don_vi_mon s join kho.don_hang_mon m on m.id = s.mon_id
    where m.don_id = v_don.id and s.moc = 'chuan' and s.chot_luc is null
      and not exists (
        select 1 from kho.quy_trinh_buoc b, kho.don_gia_baseline d
        where b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
              (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))
          and b.hoat_dong = s.hoat_dong and b.gio_moi_don_vi is not null
          and d.hoat_dong = s.hoat_dong and d.don_gia is not null);
  if v_miss > 0 then raise exception 'CHOT_THIEU_SO: % dòng số chuẩn thiếu phút/đơn giá để đóng băng — không bàn giao được', v_miss; end if;

  if p_danh_sach is null or jsonb_typeof(p_danh_sach) <> 'array' or jsonb_array_length(p_danh_sach) = 0 then
    raise exception 'THIEU_FILE_CAT: chưa đính kèm file cắt nào'; end if;
  v_le_mau := (coalesce(v_don.dong,'') = 'le' and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'CHUA_KHACH_DUYET: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT', p_ma_don; end if;

  -- ── VIỆC 1: file cắt + buoc_thiet_ke ──
  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  -- ── VIỆC 2: vào chuyền ──
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);

  -- ── VIỆC 3: đóng băng SỐ + PHÚT + ĐƠN GIÁ ──
  update kho.so_don_vi_mon s
    set gio_moi_don_vi_chot = (select b.gio_moi_don_vi from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        gio_co_dinh_chot = (select b.gio_co_dinh from kho.quy_trinh_buoc b, kho.don_hang_mon m
          where m.id = s.mon_id and b.hoat_dong = s.hoat_dong and b.ma_quy_trinh = coalesce(m.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi = sp.ma_loi where sp.ma = m.sp_id))),
        don_gia_chot = (select d.don_gia from kho.don_gia_baseline d where d.hoat_dong = s.hoat_dong),
        chot_luc = now(), chot_boi = v_ns
    where s.moc = 'chuan' and s.chot_luc is null
      and s.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- ── VIỆC 4: BOM du_kien→chuan ──
  select id into v_kho from kho.kho where la_mac_dinh limit 1;
  update kho.don_hang_mon_bom b set moc = 'chuan', chot_luc = now()
    where b.moc = 'du_kien' and b.chot_luc is null
      and b.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- ── VIỆC 5: giữ chỗ mềm ──
  with ins as (
    insert into kho.giu_cho(don_hang_id, don_hang_mon_id, don_hang_mon_bom_id, vat_tu_id, kho_id, so_luong_giu, tao_boi)
    select v_don.id, b.mon_id, b.id, b.vat_tu_id, v_kho, b.so_luong_co_so, v_ns
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is not null
    on conflict (don_hang_mon_bom_id) where trang_thai = 'mo' do nothing
    returning 1)
  select count(*) into v_giu_moi from ins;
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', m.id, 'ten', m.ten)), '[]'::jsonb) into v_mon_thieu
    from kho.don_hang_mon m
    where m.don_id = v_don.id and not exists (select 1 from kho.don_hang_mon_bom b where b.mon_id = m.id and b.moc = 'chuan');
  select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id', x.vat_tu_id, 'thieu', round(-x.kd, 4), 'don_vi', (select don_vi_co_so from kho.vat_tu where id=x.vat_tu_id))), '[]'::jsonb) into v_vt_thieu
    from (
      select v.vat_tu_id, coalesce(t.so_luong,0) - coalesce(g.giu,0) kd
      from (select distinct vat_tu_id from kho.giu_cho where don_hang_id = v_don.id and trang_thai='mo') v
      left join kho.ton t on t.vat_tu_id = v.vat_tu_id and t.kho_id = v_kho
      left join (select vat_tu_id, sum(so_luong_giu - so_luong_da_xuat) giu from kho.giu_cho where kho_id = v_kho and trang_thai='mo' group by vat_tu_id) g on g.vat_tu_id = v.vat_tu_id
    ) x where x.kd < 0;
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', b.mon_id, 'vat_tu_id', b.vat_tu_id,
           'ma', v.ma, 'ten', v.ten, 'don_vi', b.don_vi, 'so_luong', b.so_luong)), '[]'::jsonb) into v_bom_cho
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    left join kho.vat_tu v on v.id = b.vat_tu_id
    where m.don_id = v_don.id and b.moc = 'chuan' and b.so_luong_co_so is null;

  -- ═══ VIỆC 6 (WP-43): TỰ XẾP LỊCH — inline luu_xep_lich (chạy owner, KHÔNG gác vai), bọc EXCEPTION ═══
  --   [db/157] NEO XUÔI = tuần đầu NGOÀI đóng băng = tuan_cua(now) + dong_bang×7 (đọc động từ moc_lich).
  v_kieu := case when v_don.ngay_hen_khach is not null then 'nguoc' else 'xuoi' end;
  begin
    if v_kieu = 'nguoc' then
      v_xep := kho._sched(p_ma_don,'nguoc', kho.tuan_cua(v_don.ngay_hen_khach));
    else
      v_neo := kho.neo_xuoi();
      v_xep := kho._sched(p_ma_don,'xuoi', v_neo);
    end if;
    if (v_xep->>'ok')::boolean is not true then
      v_da_xep := false; v_ly_do_xep := coalesce(v_xep->>'loi','KHONG_XEP_DUOC');
    else
      for v_i in 0 .. jsonb_array_length(v_xep->'lich')-1 loop
        if kho.vung_cua_tuan((v_xep->'lich'->v_i->>'tuan')::date) = 'dong_bang' then
          raise exception 'ĐÓNG BĂNG: bước rơi vào tuần đóng băng (%) — cần Xếp lại đơn (ngoại lệ CEO)', (v_xep->'lich'->v_i->>'tuan'); end if;
      end loop;
      delete from kho.xep_lich where ma_don = p_ma_don;
      insert into kho.xep_lich(ma_don,mon_id,buoc_thu_tu,hoat_dong,loai_buoc,tuan_bat_dau,ma_to,gio,kieu_xep,xep_boi,ly_do)
      select p_ma_don, (e->>'mon_id')::uuid, (e->>'thu_tu')::int, e->>'hoat_dong', e->>'loai_buoc',
             (e->>'tuan')::date, e->>'ma_to', coalesce((e->>'gio')::numeric,0), v_kieu, v_ns, null
      from jsonb_array_elements(v_xep->'lich') e;
      get diagnostics v_so_dong_xep = row_count;
      v_da_xep := true; v_ly_do_xep := null;
    end if;
  exception when others then
    v_da_xep := false; v_ly_do_xep := SQLERRM;
  end;
  update kho.don_hang set chua_xep_duoc = not v_da_xep,
      ly_do_chua_xep = case when v_da_xep then null else v_ly_do_xep end, thu_xep_luc = now()
    where id = v_don.id;

  -- ═══ VIỆC 7 (WP-43): ghi SỔ NÚT THẮT tuần này — cũng nuốt lỗi, KHÔNG chặn bàn giao ═══
  begin perform kho.nut_that_ghi(); exception when others then null; end;

  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat',
    'mon_thieu_bom', coalesce(v_mon_thieu,'[]'::jsonb), 'vat_tu_thieu', coalesce(v_vt_thieu,'[]'::jsonb),
    'bom_cho_he_so', coalesce(v_bom_cho,'[]'::jsonb), 'giu_cho_moi', v_giu_moi,
    'da_xep', v_da_xep, 'ly_do_khong_xep', v_ly_do_xep, 'so_dong_xep_lich', v_so_dong_xep);
end $function$
;

CREATE OR REPLACE FUNCTION kho.luu_xep_lich(p_ma_don text, p_kieu text, p_ngoai_le boolean DEFAULT false, p_ly_do text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; r jsonb; e jsonb; i int; v_tuan date; v_vung text; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'luu_xep_lich: chỉ ceo/xuong (sale chỉ gọi atp)'; end if;
  if p_kieu not in ('nguoc','xuoi') then raise exception 'luu_xep_lich: kiểu phải nguoc/xuoi'; end if;
  if p_kieu='nguoc' then
    r := kho._sched(p_ma_don,'nguoc', kho.tuan_cua((select ngay_hen_khach from kho.don_hang where ma_don=p_ma_don)));
  else
    -- [db/158] neo xuôi ĐỒNG BỘ với ban_giao_xuong (db/157): tuần đầu NGOÀI vùng đóng băng, đọc động moc_lich
    r := kho._sched(p_ma_don,'xuoi',
           kho.neo_xuoi());
  end if;
  if (r->>'ok')::boolean is not true then return r; end if;
  for i in 0 .. jsonb_array_length(r->'lich')-1 loop
    v_tuan := (r->'lich'->i->>'tuan')::date; v_vung := kho.vung_cua_tuan(v_tuan);
    if v_vung = 'dong_bang' then
      if not p_ngoai_le then raise exception 'luu_xep_lich: bước rơi vào tuần ĐÓNG BĂNG (%) — cần ngoại lệ', v_tuan; end if;
      if v_vai <> 'ceo' then raise exception 'luu_xep_lich: chỉ CEO mới xếp vào tuần đóng băng'; end if;
      if coalesce(btrim(p_ly_do),'') = '' then raise exception 'luu_xep_lich: ngoại lệ đóng băng BẮT BUỘC có lý do'; end if;
    end if;
  end loop;
  delete from kho.xep_lich where ma_don = p_ma_don;
  for i in 0 .. jsonb_array_length(r->'lich')-1 loop
    e := r->'lich'->i;
    insert into kho.xep_lich(ma_don,mon_id,buoc_thu_tu,hoat_dong,loai_buoc,tuan_bat_dau,ma_to,gio,kieu_xep,xep_boi,ly_do)
      values (p_ma_don, (e->>'mon_id')::uuid, (e->>'thu_tu')::int, e->>'hoat_dong', e->>'loai_buoc',
              (e->>'tuan')::date, e->>'ma_to', coalesce((e->>'gio')::numeric,0), p_kieu, kho.current_ns(), p_ly_do);
    n := n + 1;
  end loop;
  -- [WP-43] xếp lại thành công → DỌN cờ chua_xep_duoc (dải cảnh báo tắt)
  update kho.don_hang set chua_xep_duoc = false, ly_do_chua_xep = null, thu_xep_luc = now() where ma_don = p_ma_don;
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'kieu',p_kieu,'so_dong',n);
end $function$
;

CREATE OR REPLACE FUNCTION kho.tl_xep_thu(p_ma_don text, p_tuan_giao date DEFAULT NULL::date, p_kieu text DEFAULT 'nguoc'::text, p_ngoai_le boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
  else v_neo := kho.neo_xuoi(); end if;
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
end $function$
;

commit;

-- HOÀN TÁC: chạy lại db/157 + db/158 + db/085 (khôi phục 3 hàm); drop function kho.neo_xuoi();
