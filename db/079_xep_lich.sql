-- db/079 — XẾP LỊCH: NGƯỢC (mặc định) · XUÔI · NÚT THẮT · ATP (L-22)
-- Căn cứ MES Meyer 5.4.5 (xếp ngược mặc định; vượt hôm nay → xếp xuôi; nút thắt), 5.4.3 (thùng thời gian +
--   điều kiện biên: thời gian CHỜ khô), 5.3.1 (nút thắt giới hạn cả công ty), glossary ATP; quản trị SX 3.2/3.3
--   (bốn vùng Đóng băng/Vững/Đầy/Mở theo tuần).
-- [TÔI ĐOÁN]: đóng băng = tuần đang chạy + tuần sau (khai được, không cứng); "còn chỗ" = tổ của bước đó còn chỗ.
-- THUẦN DB. Tuần = THỨ HAI ISO. Idempotent.
begin;

create or replace function kho.tuan_cua(d date) returns date language sql immutable as $$
  select d - (extract(isodow from d)::int - 1);
$$;

-- ─────────── VIỆC 1 · moc_lich + vung_cua_tuan ───────────
create table if not exists kho.moc_lich (ma text primary key, so_tuan int not null check (so_tuan >= 0), ghi_chu text);
insert into kho.moc_lich(ma, so_tuan, ghi_chu) values
  ('dong_bang', 2, '[TÔI ĐOÁN] tuần đang chạy + tuần sau — tấm đã/đang cắt, không đổi'),
  ('vung_chac', 2, 'sau đóng băng: đổi được nhưng cần lý do')
on conflict (ma) do update set so_tuan = excluded.so_tuan;
grant select on kho.moc_lich to authenticated;

-- ─────────── VIỆC 5 · bảng xep_lich (thùng thời gian) — khai trước để RPC dùng ───────────
create table if not exists kho.xep_lich (
  id          bigint generated always as identity primary key,
  ma_don      text not null references kho.don_hang(ma_don) on delete cascade,
  mon_id      uuid references kho.don_hang_mon(id) on delete cascade,
  buoc_thu_tu int not null,
  hoat_dong   text,
  loai_buoc   text,
  tuan_bat_dau date not null,
  ma_to       text,                                    -- null với bước chờ khô (tu_chay)
  gio         numeric not null default 0,
  kieu_xep    text not null check (kieu_xep in ('nguoc','xuoi')),
  xep_luc     timestamptz not null default now(),
  xep_boi     uuid,
  ly_do       text
);
create index if not exists idx_xep_lich_to_tuan on kho.xep_lich(ma_to, tuan_bat_dau);
create index if not exists idx_xep_lich_don on kho.xep_lich(ma_don);
grant select on kho.xep_lich to authenticated;

-- day/mo suy từ tải so năng lực (đóng băng/vững chắc khai ở moc_lich)
create or replace function kho.vung_cua_tuan(p_tuan date) returns text
  language plpgsql stable security definer set search_path = kho as $$
declare v_cur date; v_idx int; v_db int; v_vc int; v_tai numeric; v_nl numeric; mt text;
begin
  v_cur := kho.tuan_cua(current_date);
  v_idx := ((kho.tuan_cua(p_tuan) - v_cur) / 7);
  select so_tuan into v_db from kho.moc_lich where ma = 'dong_bang';
  select so_tuan into v_vc from kho.moc_lich where ma = 'vung_chac';
  if v_idx < v_db then return 'dong_bang'; end if;          -- quá khứ + tuần đóng băng
  if v_idx < v_db + v_vc then return 'vung_chac'; end if;
  -- 'day'/'mo' suy: tải đã xếp so năng lực (đầy nếu ≥ 90% ở tổ căng nhất)
  v_tai := 0; v_nl := 0;
  for mt in select unnest(array['cnc','dan_canh','cha_lot','son_pu','lap_rap','dong_goi','giuong']) loop
    select coalesce(sum(gio),0) into v_tai from kho.xep_lich where ma_to = mt and tuan_bat_dau = kho.tuan_cua(p_tuan);
    select gio_nen into v_nl from kho.nang_luc_to_tuan(mt, kho.tuan_cua(p_tuan), kho.tuan_cua(p_tuan)+7) limit 1;
    if v_nl is not null and v_nl > 0 and v_tai / v_nl >= 0.9 then return 'day'; end if;
  end loop;
  return 'mo';
end $$;
grant execute on function kho.vung_cua_tuan(date) to authenticated;

-- ─────────── helper: bước của đơn (mon,thu_tu,hoat_dong,tổ,giờ,loai,buoc_truoc) ───────────
--   nguoi: giờ = gio_co_dinh + gio_moi_don_vi × so_don_vi('chuan') × so_luong; thiếu số → gio=null.
--   tu_chay (chờ khô): giờ = gio_co_dinh (thời gian), ma_to=null (KHÔNG chiếm năng lực tổ).
create or replace function kho.sched_buoc(p_ma_don text)
  returns table(mon_id uuid, thu_tu int, hoat_dong text, ma_to text, gio numeric, loai_buoc text, buoc_truoc int[])
  language plpgsql stable security definer set search_path = kho as $$
declare v_don uuid; m record; v_qt text;
begin
  select id into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don is null then raise exception 'sched_buoc: không có đơn "%"', p_ma_don; end if;
  for m in select id, sp_id, ma_quy_trinh, coalesce(so_luong,1) sl from kho.don_hang_mon where don_id = v_don loop
    v_qt := m.ma_quy_trinh;
    if v_qt is null and m.sp_id is not null then
      select l.ma_quy_trinh into v_qt from kho.san_pham_mau s join kho.san_pham_loi l on l.ma_loi = s.ma_loi where s.ma = m.sp_id;
    end if;
    if v_qt is null then continue; end if;
    return query
      select m.id, b.thu_tu, b.hoat_dong,
        case when coalesce(b.loai_buoc,'nguoi') = 'tu_chay' then null else d.ma_to end,
        case when coalesce(b.loai_buoc,'nguoi') = 'tu_chay' then coalesce(b.gio_co_dinh,0)
             else (select case when s.so_don_vi is null then null
                     else coalesce(b.gio_co_dinh,0) + coalesce(b.gio_moi_don_vi,0) * s.so_don_vi * m.sl end
                   from (select so_don_vi from kho.so_don_vi_mon sdv where sdv.mon_id = m.id and sdv.hoat_dong = b.hoat_dong and sdv.moc = 'chuan') s)
        end,
        coalesce(b.loai_buoc,'nguoi'), b.buoc_truoc
      from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
      where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi') in ('nguoi','tu_chay');
  end loop;
end $$;
grant execute on function kho.sched_buoc(text) to authenticated;

-- ─────────── LÕI xếp lịch (dùng chung nguoc/xuoi) ───────────
--   p_dir='nguoc': neo=tuần giao, lùi; quá khứ = năng lực vô hạn (để phát hiện PHAI_XEP_XUOI).
--   p_dir='xuoi' : neo=tuần bắt đầu, tiến; quá 12 tuần → KHONG_XEP_DUOC.
create or replace function kho._sched(p_ma_don text, p_dir text, p_neo date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare
  s record; c date; w date; cap numeric; avail numeric; floor_w date; ceil_w date;
  v_lich jsonb := '[]'::jsonb; v_min date; v_max date; v_disp int; v_best_disp int := -1;
  v_nut jsonb := null; v_thieu numeric; v_avail_c numeric; iter int;
begin
  floor_w := kho.tuan_cua(current_date);
  ceil_w  := p_neo + 12*7;
  drop table if exists _st; drop table if exists _bk;
  create temp table _st(sid serial, mon_id uuid, thu_tu int, hoat_dong text, ma_to text, gio numeric,
                        loai_buoc text, buoc_truoc int[], assigned date, disp int) on commit drop;
  create temp table _bk(ma_to text, tuan date, gio numeric) on commit drop;
  insert into _st(mon_id,thu_tu,hoat_dong,ma_to,gio,loai_buoc,buoc_truoc)
    select mon_id,thu_tu,hoat_dong,ma_to,gio,loai_buoc,buoc_truoc from kho.sched_buoc(p_ma_don);
  if not exists (select 1 from _st) then return jsonb_build_object('ok',false,'loi','KHONG_CO_BUOC'); end if;
  if exists (select 1 from _st where loai_buoc='nguoi' and gio is null) then
    return jsonb_build_object('ok',false,'loi','THIEU_SO_DON_VI',
      'thieu', (select jsonb_agg(distinct hoat_dong) from _st where loai_buoc='nguoi' and gio is null)); end if;

  for s in select * from _st order by case when p_dir='nguoc' then -thu_tu else thu_tu end loop
    -- ràng buộc hàng xóm
    if p_dir='nguoc' then
      select min(t.assigned) into c from _st t where t.mon_id=s.mon_id and s.thu_tu = any(t.buoc_truoc) and t.assigned is not null;
      c := coalesce(c, p_neo);
    else
      select max(case when p.loai_buoc='tu_chay' then p.assigned+7 else p.assigned end) into c
        from _st p where p.mon_id=s.mon_id and p.thu_tu = any(s.buoc_truoc) and p.assigned is not null;
      c := coalesce(c, p_neo);
    end if;

    if s.loai_buoc='tu_chay' then
      update _st set assigned = case when p_dir='nguoc' then c-7 else c end, disp=0 where sid=s.sid;
      continue;
    end if;

    w := c; iter := 0; v_avail_c := null;
    loop
      if p_dir='nguoc' and w < floor_w then avail := 1e9;        -- quá khứ = vô hạn (phát hiện phải xếp xuôi)
      else
        select gio_nen into cap from kho.nang_luc_to_tuan(s.ma_to, w, w+7) limit 1;
        if cap is null then return jsonb_build_object('ok',false,'loi','THIEU_NANG_LUC','ma_to',s.ma_to,'tuan',w); end if;
        avail := cap
          - coalesce((select sum(x.gio) from kho.xep_lich x where x.ma_to=s.ma_to and x.tuan_bat_dau=w and x.ma_don<>p_ma_don),0)
          - coalesce((select sum(b.gio) from _bk b where b.ma_to=s.ma_to and b.tuan=w),0);
      end if;
      if v_avail_c is null then v_avail_c := avail; end if;       -- năng lực còn tại tuần MONG MUỐN
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
    if v_disp > v_best_disp then                                  -- nút thắt = tổ bị dời nhiều nhất
      v_best_disp := v_disp;
      if v_disp > 0 then v_nut := jsonb_build_object('ma_to', s.ma_to, 'tuan', c,
        'gio_thieu', round(s.gio - greatest(v_avail_c,0),1)); end if;
    end if;
  end loop;

  select min(assigned), max(assigned) into v_min, v_max from _st;
  select jsonb_agg(jsonb_build_object('mon_id',mon_id,'thu_tu',thu_tu,'hoat_dong',hoat_dong,
           'ma_to',ma_to,'gio',gio,'loai_buoc',loai_buoc,'tuan',assigned) order by thu_tu)
    into v_lich from _st;

  if p_dir='nguoc' then
    return jsonb_build_object('ok',true,'kieu','nguoc','lich',v_lich,
      'ngay_bat_dau_som', v_min,
      'phai_xep_xuoi', v_min < floor_w,
      'so_ngay_thieu', case when v_min < floor_w then (floor_w - v_min) else 0 end,
      'nut_that', v_nut);
  else
    return jsonb_build_object('ok',true,'kieu','xuoi','lich',v_lich,
      'ngay_xong_som', v_max + 6, 'nut_that', v_nut);
  end if;
end $$;

-- ─────────── VIỆC 2 · xep_nguoc (mặc định) ───────────
create or replace function kho.xep_nguoc(p_ma_don text, p_ngay_giao date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke') then
    raise exception 'xep_nguoc: vai không xem được'; end if;
  return kho._sched(p_ma_don, 'nguoc', kho.tuan_cua(p_ngay_giao));
end $$;
grant execute on function kho.xep_nguoc(text, date) to authenticated;

-- ─────────── VIỆC 3 · xep_xuoi + cảnh báo xong sớm ───────────
create or replace function kho.xep_xuoi(p_ma_don text, p_ngay_bat_dau date default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; v_han date; v_som int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke') then
    raise exception 'xep_xuoi: vai không xem được'; end if;
  r := kho._sched(p_ma_don, 'xuoi', kho.tuan_cua(coalesce(p_ngay_bat_dau, current_date)));
  if (r->>'ok')::boolean is not true then return r; end if;
  select ngay_hen_khach into v_han from kho.don_hang where ma_don = p_ma_don;
  if v_han is not null then
    v_som := v_han - (r->>'ngay_xong_som')::date;
    if v_som > 7 then
      r := r || jsonb_build_object('canh_bao',
        'xong sớm ' || v_som || ' ngày — hàng nằm kho, cân nhắc nhường chỗ cho đơn gấp hơn', 'xong_som_ngay', v_som);
    end if;
  end if;
  return r;
end $$;
grant execute on function kho.xep_xuoi(text, date) to authenticated;

-- ─────────── VIỆC 4 · atp — "hứa được ngày nào" ───────────
create or replace function kho.atp(p_ma_don text)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_han date; r jsonb; x jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke') then
    raise exception 'atp: vai không xem được'; end if;
  select ngay_hen_khach into v_han from kho.don_hang where ma_don = p_ma_don;
  if v_han is not null then
    r := kho._sched(p_ma_don, 'nguoc', kho.tuan_cua(v_han));
    if (r->>'ok')::boolean is not true then return r; end if;       -- THIEU_SO_DON_VI / THIEU_NANG_LUC
    if (r->>'phai_xep_xuoi')::boolean is not true then
      return jsonb_build_object('ok',true,'ma_don',p_ma_don,'ngay_hua_duoc',v_han,'xep_bang','nguoc',
        'lich',r->'lich','nut_that',r->'nut_that'); end if;
  end if;
  -- không hạn HOẶC lùi vượt hôm nay → xếp xuôi
  x := kho._sched(p_ma_don, 'xuoi', kho.tuan_cua(current_date));
  if (x->>'ok')::boolean is not true then
    return x || jsonb_build_object('ma_don',p_ma_don);              -- KHONG_XEP_DUOC / THIEU_*
  end if;
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'ngay_hua_duoc',(x->>'ngay_xong_som')::date,
    'xep_bang','xuoi','lich',x->'lich','nut_that',x->'nut_that',
    'vi', case when v_han is null then 'don_khong_han' else 'lui_vuot_hom_nay' end);
end $$;
grant execute on function kho.atp(text) to authenticated;

-- ─────────── VIỆC 5 · luu_xep_lich (ceo/xuong; đóng băng chặn trừ ngoại lệ ceo) ───────────
create or replace function kho.luu_xep_lich(p_ma_don text, p_kieu text, p_ngoai_le boolean default false, p_ly_do text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
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
  -- cổng đóng băng: bước nào rơi tuần 'dong_bang' → CHẶN, trừ (ngoai_le VÀ ceo VÀ có ly_do)
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
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'kieu',p_kieu,'so_dong',n);
end $$;
grant execute on function kho.luu_xep_lich(text, text, boolean, text) to authenticated;

commit;

-- ─────────── VIỆC 6 · tai_theo_to_tuan đọc thêm xep_lich (theo BƯỚC) + vùng ───────────
begin;
create or replace function kho.tai_theo_to_tuan(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare
  d record; g jsonb; kv record; v_tang int; v_k int; v_nweeks int; v_tyle numeric; v_du boolean;
  v_ws date; nl record; t1 numeric; t2 numeric; t3 numeric; v_o jsonb := '[]'::jsonb; v_tuan jsonb := '[]'::jsonb;
  v_han date; v_gio numeric; v_tu date;
  ch1 int := 0; ch2 int := 0; ch3 int := 0; chg1 numeric := 0; chg2 numeric := 0; chg3 numeric := 0;
  ts1 int := 0; ts2 int := 0; ts3 int := 0;
  TO7 text[] := array['cnc','dan_canh','cha_lot','son_pu','lap_rap','dong_goi','giuong'];
  mt text; xl record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan') then
    raise exception 'tai_theo_to_tuan: chỉ ceo/xuong/ke_toan'; end if;
  v_tu := kho.tuan_cua(p_tu_ngay);                              -- canh THỨ HAI để khớp xep_lich
  v_nweeks := greatest(1, ceil((p_den_ngay - v_tu) / 7.0)::int);
  select ty_le, du into v_tyle, v_du from kho.ty_le_chot();

  drop table if exists _tai;
  create temp table _tai(ma_to text, k int, tang int, gio numeric) on commit drop;

  for d in
    select ma_don, trang_thai, ngay_hen_khach,
      case when trang_thai in ('cho_cat','da_cat','dang_lam') then 1
           when trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then 2
           when trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then 3 end as tang,
      exists(select 1 from kho.xep_lich x where x.ma_don = don_hang.ma_don) as da_xep
    from kho.don_hang
    where trang_thai in ('cho_cat','da_cat','dang_lam','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','bao_gia','bao_gia_thua','bao_gia_treo')
  loop
    v_tang := d.tang;
    if d.da_xep then                                           -- ĐÃ XẾP → tải theo TỪNG BƯỚC (không dồn cả đơn)
      for xl in select ma_to, tuan_bat_dau, gio from kho.xep_lich where ma_don = d.ma_don and ma_to is not null loop
        v_k := ((xl.tuan_bat_dau - v_tu) / 7);
        if v_k < 0 or v_k >= v_nweeks then continue; end if;
        insert into _tai(ma_to,k,tang,gio) values (xl.ma_to, v_k, v_tang, xl.gio * case when v_tang=3 then v_tyle else 1 end);
      end loop;
      continue;
    end if;
    g := kho.gio_du_kien_cua_don(d.ma_don, 'chuan');
    if (g->>'ok')::boolean is not true then
      if v_tang=1 then ts1:=ts1+1; elsif v_tang=2 then ts2:=ts2+1; else ts3:=ts3+1; end if; continue; end if;
    v_han := d.ngay_hen_khach;
    if v_han is null then
      v_gio := coalesce((g->>'tong_gio_don')::numeric,0) * case when v_tang=3 then v_tyle else 1 end;
      if v_tang=1 then ch1:=ch1+1; chg1:=chg1+v_gio; elsif v_tang=2 then ch2:=ch2+1; chg2:=chg2+v_gio; else ch3:=ch3+1; chg3:=chg3+v_gio; end if; continue; end if;
    v_k := floor((kho.tuan_cua(v_han) - v_tu) / 7.0)::int;
    if v_k < 0 then v_k := 0; end if;
    if v_k >= v_nweeks then continue; end if;
    for kv in select key as ma_to, value::numeric as gio from jsonb_each_text(g->'theo_to') loop
      insert into _tai(ma_to, k, tang, gio) values (kv.ma_to, v_k, v_tang, kv.gio * case when v_tang=3 then v_tyle else 1 end);
    end loop;
  end loop;

  for v_k in 0 .. v_nweeks - 1 loop
    v_ws := v_tu + v_k*7;
    v_tuan := v_tuan || to_jsonb(v_ws);
    foreach mt in array TO7 loop
      select coalesce(sum(gio) filter (where tang=1),0), coalesce(sum(gio) filter (where tang=2),0), coalesce(sum(gio) filter (where tang=3),0)
        into t1,t2,t3 from _tai where ma_to=mt and k=v_k;
      select gio_nen, thieu_nang_luc into nl from kho.nang_luc_to_tuan(mt, v_ws, v_ws+7) limit 1;
      v_o := v_o || jsonb_build_array(jsonb_build_object(
        'ma_to', mt, 'tuan_bat_dau', v_ws, 'vung', kho.vung_cua_tuan(v_ws),
        't1_dang_lam', round(t1,1), 't2_da_chot', round(t2,1), 't3_bao_gia', round(t3,1),
        'tong_tai', round(t1+t2+t3,1),
        'nang_luc', nl.gio_nen, 'thieu_nang_luc', coalesce(nl.thieu_nang_luc,true),
        'thieu_thua', case when nl.gio_nen is null then null else round(nl.gio_nen - (t1+t2+t3),1) end));
    end loop;
  end loop;

  return jsonb_build_object(
    'tu_ngay', v_tu, 'den_ngay', p_den_ngay, 'so_tuan', v_nweeks,
    'ty_le_chot', v_tyle, 'ty_le_chot_chua_du', not v_du,
    'tuan', v_tuan, 'o', v_o,
    'chua_co_han', jsonb_build_object('t1_don',ch1,'t2_don',ch2,'t3_don',ch3,'t1_gio',round(chg1,1),'t2_gio',round(chg2,1),'t3_gio',round(chg3,1)),
    'thieu_so', jsonb_build_object('t1_don',ts1,'t2_don',ts2,'t3_don',ts3));
end $$;
commit;
