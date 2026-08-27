-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 156 — WP-43: BÀN GIAO TỰ XẾP LỊCH (không bao giờ chặn bàn giao) + cờ chua_xep_duoc + sổ nút thắt tuần.
--   ① ban_giao_xuong thêm VIỆC 6 (tự xếp, bọc EXCEPTION — hỏng thì NUỐT, 5 việc trước VẪN LƯU) + VIỆC 7
--      (ghi sổ nút thắt, cũng nuốt lỗi). KHÔNG ngoại lệ → vùng đóng băng vẫn chặn ÊM.
--   ② don_hang += chua_xep_duoc/ly_do_chua_xep/thu_xep_luc; luu_xep_lich thành công DỌN cờ. tl_don_chua_xep().
--   ③ nut_that_tuan (PK tuan, UPSERT) + nut_that_ghi/nut_that_ds. _sched LỘ so_tuan_doi (v_disp có sẵn — KHÔNG
--      phát minh công thức mới).
--   HOÀN TÁC: xem cuối file.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ ② cột cờ + ③ bảng sổ ═══
alter table kho.don_hang
  add column if not exists chua_xep_duoc boolean not null default false,
  add column if not exists ly_do_chua_xep text,
  add column if not exists thu_xep_luc timestamptz;

create table if not exists kho.nut_that_tuan (
  tuan         date primary key,
  ma_to        text,
  so_tuan_doi  numeric not null default 0,
  ghi_luc      timestamptz not null default now()
);
grant select on kho.nut_that_tuan to authenticated;

-- ═══ ③a · _sched: LỘ so_tuan_doi trong nut_that (v_disp có sẵn) — thân GIỮ NGUYÊN, chỉ thêm 1 field ═══
CREATE OR REPLACE FUNCTION kho._sched(p_ma_don text, p_dir text, p_neo date, p_moc text DEFAULT 'chuan'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare
  s record; c date; w date; cap numeric; avail numeric; floor_w date; ceil_w date;
  v_lich jsonb := '[]'::jsonb; v_min date; v_max date; v_disp int; v_best_disp int := -1;
  v_nut jsonb := null; v_avail_c numeric; iter int;
begin
  floor_w := kho.tuan_cua(current_date);
  ceil_w  := p_neo + 12*7;
  drop table if exists _st; drop table if exists _bk;
  create temp table _st(sid serial, mon_id uuid, thu_tu int, hoat_dong text, ma_to text, gio numeric,
                        loai_buoc text, buoc_truoc int[], assigned date, disp int) on commit drop;
  create temp table _bk(ma_to text, tuan date, gio numeric) on commit drop;
  insert into _st(mon_id,thu_tu,hoat_dong,ma_to,gio,loai_buoc,buoc_truoc)
    select mon_id,thu_tu,hoat_dong,ma_to,gio,loai_buoc,buoc_truoc from kho.sched_buoc(p_ma_don, p_moc);
  if not exists (select 1 from _st) then return jsonb_build_object('ok',false,'loi','KHONG_CO_BUOC'); end if;
  if exists (select 1 from _st where loai_buoc='nguoi' and gio is null) then
    return jsonb_build_object('ok',false,'loi','THIEU_SO_DON_VI',
      'thieu', (select jsonb_agg(distinct hoat_dong) from _st where loai_buoc='nguoi' and gio is null)); end if;

  for s in select * from _st order by case when p_dir='nguoc' then -thu_tu else thu_tu end loop
    if p_dir='nguoc' then
      select min(t.assigned) into c from _st t where t.mon_id=s.mon_id and s.thu_tu = any(t.buoc_truoc) and t.assigned is not null;
      c := coalesce(c, p_neo);
    else
      select max(case when p.loai_buoc='tu_chay' then p.assigned+7 else p.assigned end) into c
        from _st p where p.mon_id=s.mon_id and p.thu_tu = any(s.buoc_truoc) and p.assigned is not null;
      c := coalesce(c, p_neo);
    end if;
    if s.loai_buoc='tu_chay' then
      update _st set assigned = case when p_dir='nguoc' then c-7 else c end, disp=0 where sid=s.sid; continue; end if;
    w := c; iter := 0; v_avail_c := null;
    loop
      if p_dir='nguoc' and w < floor_w then avail := 1e9;
      else
        select gio_nen into cap from kho.nang_luc_to_tuan(s.ma_to, w, w+7) limit 1;
        if cap is null then return jsonb_build_object('ok',false,'loi','THIEU_NANG_LUC','ma_to',s.ma_to,'tuan',w); end if;
        avail := cap
          - coalesce((select sum(x.gio) from kho.xep_lich x where x.ma_to=s.ma_to and x.tuan_bat_dau=w and x.ma_don<>p_ma_don),0)
          - coalesce((select sum(b.gio) from _bk b where b.ma_to=s.ma_to and b.tuan=w),0);
      end if;
      if v_avail_c is null then v_avail_c := avail; end if;
      if avail >= s.gio then exit; end if;
      if p_dir='nguoc' then w := w - 7; else
        w := w + 7; if w > ceil_w then
          return jsonb_build_object('ok',false,'loi','KHONG_XEP_DUOC_TRONG_12_TUAN','ma_to',s.ma_to,
            'gio_thieu', round(s.gio - greatest(v_avail_c,0),1)); end if;
      end if;
      iter := iter + 1; if iter > 200 then exit; end if;
    end loop;
    insert into _bk(ma_to,tuan,gio) values (s.ma_to, w, s.gio);
    v_disp := abs((c - w)) / 7;
    update _st set assigned=w, disp=v_disp where sid=s.sid;
    if v_disp > v_best_disp then v_best_disp := v_disp;
      if v_disp > 0 then v_nut := jsonb_build_object('ma_to', s.ma_to, 'tuan', c, 'so_tuan_doi', v_disp, 'gio_thieu', round(s.gio - greatest(v_avail_c,0),1)); end if;
    end if;
  end loop;

  select min(assigned), max(assigned) into v_min, v_max from _st;
  select jsonb_agg(jsonb_build_object('mon_id',mon_id,'thu_tu',thu_tu,'hoat_dong',hoat_dong,
           'ma_to',ma_to,'gio',gio,'loai_buoc',loai_buoc,'tuan',assigned) order by thu_tu) into v_lich from _st;
  if p_dir='nguoc' then
    return jsonb_build_object('ok',true,'kieu','nguoc','lich',v_lich,'ngay_bat_dau_som', v_min,
      'phai_xep_xuoi', v_min < floor_w,
      'so_ngay_thieu', case when v_min < floor_w then (floor_w - v_min) else 0 end, 'nut_that', v_nut);
  else
    return jsonb_build_object('ok',true,'kieu','xuoi','lich',v_lich,'ngay_xong_som', v_max + 6, 'nut_that', v_nut);
  end if;
end $function$;

-- ═══ ③b · nut_that_ghi (ghi tuần hiện tại, UPSERT) + nut_that_ds ═══
create or replace function kho.nut_that_ghi() returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare ws date := kho.tuan_cua(current_date); r jsonb; d record; v_hen date;
  v_ma_to text := null; v_disp numeric := 0; v_x numeric;
begin
  -- duyệt các đơn ĐÃ xếp (có xep_lich), re-run _sched, lấy nút thắt so_tuan_doi lớn nhất (cách tính giữ nguyên)
  for d in select distinct ma_don from kho.xep_lich loop
    select ngay_hen_khach into v_hen from kho.don_hang where ma_don = d.ma_don;
    if v_hen is not null then r := kho._sched(d.ma_don,'nguoc', kho.tuan_cua(v_hen));
    else r := kho._sched(d.ma_don,'xuoi', kho.tuan_cua(current_date)); end if;
    if (r->>'ok')::boolean is true and (r->'nut_that') is not null and (r->'nut_that') <> 'null'::jsonb then
      v_x := coalesce((r->'nut_that'->>'so_tuan_doi')::numeric, 0);
      if v_x > v_disp then v_disp := v_x; v_ma_to := r->'nut_that'->>'ma_to'; end if;
    end if;
  end loop;
  insert into kho.nut_that_tuan(tuan, ma_to, so_tuan_doi, ghi_luc) values (ws, v_ma_to, v_disp, now())
    on conflict (tuan) do update set ma_to = excluded.ma_to, so_tuan_doi = excluded.so_tuan_doi, ghi_luc = now();
  return jsonb_build_object('ok', true, 'tuan', ws, 'ma_to', v_ma_to, 'so_tuan_doi', v_disp);
end $$;
grant execute on function kho.nut_that_ghi() to authenticated;

create or replace function kho.nut_that_ds(p_so_tuan int default 4) returns jsonb
  language sql stable security definer set search_path = kho as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.tuan desc), '[]'::jsonb)
  from (select tuan, ma_to, so_tuan_doi, ghi_luc from kho.nut_that_tuan order by tuan desc limit greatest(p_so_tuan,1)) x;
$$;
grant execute on function kho.nut_that_ds(int) to authenticated;

-- ═══ ② tl_don_chua_xep (dải cảnh báo) ═══
create or replace function kho.tl_don_chua_xep() returns jsonb
  language sql stable security definer set search_path = kho as $$
  select coalesce(jsonb_agg(jsonb_build_object('ma_don', ma_don, 'ten_khach', ten_khach,
    'ly_do', ly_do_chua_xep, 'thu_xep_luc', thu_xep_luc) order by thu_xep_luc desc nulls last), '[]'::jsonb)
  from kho.don_hang where chua_xep_duoc;
$$;
grant execute on function kho.tl_don_chua_xep() to authenticated;

-- ═══ ① ban_giao_xuong + VIỆC 6 (tự xếp, EXCEPTION nuốt) + VIỆC 7 (nut_that_ghi) + return mở rộng ═══
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
  v_bom_cho jsonb;
  v_kieu text; v_xep jsonb; v_da_xep boolean := false; v_ly_do_xep text := null; v_so_dong_xep int := 0; v_i int;
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
  --   Hỏng (đóng băng / thiếu năng lực / v.v.) → NUỐT, 5 việc trên VẪN LƯU. KHÔNG ngoại lệ → đóng băng chặn ÊM.
  v_kieu := case when v_don.ngay_hen_khach is not null then 'nguoc' else 'xuoi' end;
  begin
    if v_kieu = 'nguoc' then v_xep := kho._sched(p_ma_don,'nguoc', kho.tuan_cua(v_don.ngay_hen_khach));
    else v_xep := kho._sched(p_ma_don,'xuoi', kho.tuan_cua(current_date)); end if;
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
end $function$;
grant execute on function kho.ban_giao_xuong(text, jsonb, text) to authenticated;

-- ═══ ② luu_xep_lich: DỌN cờ chua_xep_duoc khi xếp thành công (nút "Xếp lại đơn") ═══
CREATE OR REPLACE FUNCTION kho.luu_xep_lich(p_ma_don text, p_kieu text, p_ngoai_le boolean DEFAULT false, p_ly_do text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'kho'
AS $function$
declare v_vai text; r jsonb; e jsonb; i int; v_tuan date; v_vung text; n int := 0;
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai not in ('ceo','xuong') then raise exception 'luu_xep_lich: chỉ ceo/xuong (sale chỉ gọi atp)'; end if;
  if p_kieu not in ('nguoc','xuoi') then raise exception 'luu_xep_lich: kiểu phải nguoc/xuoi'; end if;
  if p_kieu='nguoc' then
    r := kho._sched(p_ma_don,'nguoc', kho.tuan_cua((select ngay_hen_khach from kho.don_hang where ma_don=p_ma_don)));
  else
    r := kho._sched(p_ma_don,'xuoi', kho.tuan_cua(current_date));
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
end $function$;
grant execute on function kho.luu_xep_lich(text, text, boolean, text) to authenticated;

commit;

-- HOÀN TÁC:
--   alter table kho.don_hang drop column chua_xep_duoc, drop column ly_do_chua_xep, drop column thu_xep_luc;
--   drop table kho.nut_that_tuan; drop function kho.nut_that_ghi(); drop function kho.nut_that_ds(int);
--   drop function kho.tl_don_chua_xep();
--   (ban_giao_xuong/_sched/luu_xep_lich: khôi phục bằng cách chạy lại db/131 + db/079)
