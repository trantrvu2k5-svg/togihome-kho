-- db/083 — gio_don_da_tinh: giờ mỗi đơn LƯU SẴN (materialize) + phân trang 3 RPC — L-28
-- Căn cứ MES 5.4.3: chia đơn vào thùng thời gian TRƯỚC khi xếp ("xếp cả pool cùng lúc → thời gian tính không
--   chấp nhận được"). Giờ mỗi đơn cũng vậy: tính SẴN một lần, cộng nhiều lần.
-- L-25: tai_theo_to_tuan ~6,5s ở 3.000 đơn (gọi gio_du_kien_cua_don TỪNG đơn mỗi call).
-- gio_don_da_tinh = bảng SUY RA (như tien_do_tem); nguồn là so_don_vi_mon × quy_trinh_buoc (chốt-aware, QD-16).
-- THUẦN DB.
begin;

-- ─────────── VIỆC 1 · bảng SUY RA ───────────
create table if not exists kho.gio_don_da_tinh (
  ma_don   text not null,
  ma_to    text not null,
  moc      text not null,
  gio      numeric not null,
  tinh_luc timestamptz not null default now(),
  primary key (ma_don, ma_to, moc)
);
create index if not exists idx_gdt_to_moc on kho.gio_don_da_tinh (ma_to, moc);
grant select on kho.gio_don_da_tinh to authenticated;

-- dung_lai_gio_don: tính lại giờ 1 đơn từ nguồn (chốt-aware, GIỮ NGUYÊN công thức gio_du_kien_cua_mon).
--   KHÔNG gác vai (chạy được từ trigger bất kỳ role); đơn thiếu số/quy trình → KHÔNG ghi dòng (như gio_du_kien ok=false).
create or replace function kho.dung_lai_gio_don(p_ma_don text)
  returns void language plpgsql security definer set search_path = kho as $$
declare m text;
begin
  delete from kho.gio_don_da_tinh where ma_don = p_ma_don;
  for m in select distinct s.moc from kho.so_don_vi_mon s
             join kho.don_hang_mon dm on dm.id = s.mon_id join kho.don_hang d on d.id = dm.don_id where d.ma_don = p_ma_don loop
    -- ĐƠN có ĐỦ số cho mốc m không? (mọi người-bước mọi món: có quy trình + có so_don_vi + có mẫu số)
    if exists (
      select 1 from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
        left join lateral (select coalesce(dm.ma_quy_trinh,
              (select l.ma_quy_trinh from kho.san_pham_mau sm join kho.san_pham_loi l on l.ma_loi = sm.ma_loi where sm.ma = dm.sp_id)) qt) qr on true
      where d.ma_don = p_ma_don and (
        qr.qt is null
        or exists (select 1 from kho.quy_trinh_buoc qb where qb.ma_quy_trinh = qr.qt and coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
             and ( not exists (select 1 from kho.so_don_vi_mon s where s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = m)
                   or coalesce((select mau_so from kho.don_gia_baseline where hoat_dong = qb.hoat_dong), 0) = 0 )))
    ) then continue; end if;   -- thiếu → không ghi dòng cho mốc này (đơn = "thiếu số", ngoài tải)
    insert into kho.gio_don_da_tinh(ma_don, ma_to, moc, gio, tinh_luc)
    select p_ma_don, coalesce(d2.ma_to, '(chưa rõ tổ)'), m,
      sum( (case when coalesce(qb.loai_buoc,'nguoi') = 'tu_chay' then coalesce(qb.gio_co_dinh,0)
                 when s.chot_luc is not null and s.gio_moi_don_vi_chot is not null then coalesce(s.gio_co_dinh_chot,0) + s.gio_moi_don_vi_chot * s.so_don_vi
                 else coalesce(qb.gio_co_dinh,0) + coalesce(qb.gio_moi_don_vi,0) * s.so_don_vi end)
           * coalesce(dm.so_luong,1) ), now()
    from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
      join lateral (select coalesce(dm.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sm join kho.san_pham_loi l on l.ma_loi = sm.ma_loi where sm.ma = dm.sp_id)) qt) qr on true
      join kho.quy_trinh_buoc qb on qb.ma_quy_trinh = qr.qt
      left join kho.so_don_vi_mon s on s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = m and coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
      left join kho.don_gia_baseline d2 on d2.hoat_dong = qb.hoat_dong
    where d.ma_don = p_ma_don
    group by coalesce(d2.ma_to, '(chưa rõ tổ)');
  end loop;
end $$;

-- dựng lại TOÀN BỘ (bảng suy ra — mất thì dựng lại)
create or replace function kho.dung_lai_gio_tat_ca()
  returns int language plpgsql security definer set search_path = kho as $$
declare n int := 0; t text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'dung_lai_gio_tat_ca: chỉ ceo/xuong'; end if;
  delete from kho.gio_don_da_tinh;
  for t in select distinct d.ma_don from kho.so_don_vi_mon s join kho.don_hang_mon dm on dm.id = s.mon_id join kho.don_hang d on d.id = dm.don_id loop
    perform kho.dung_lai_gio_don(t); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function kho.dung_lai_gio_tat_ca() to authenticated;

commit;

-- ─────────── VIỆC 2 · giữ ĐỒNG BỘ bằng TRIGGER (tự động, KHÔNG BỎ SÓT) ───────────
begin;
-- tách per-mốc để trigger chỉ tính lại mốc đổi (thuc_te KHÔNG kích → do_gio_that giữ nhanh)
create or replace function kho.dung_lai_gio_don_moc(p_ma_don text, p_moc text)
  returns void language plpgsql security definer set search_path = kho as $$
begin
  delete from kho.gio_don_da_tinh where ma_don = p_ma_don and moc = p_moc;
  if exists (
    select 1 from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
      left join lateral (select coalesce(dm.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sm join kho.san_pham_loi l on l.ma_loi = sm.ma_loi where sm.ma = dm.sp_id)) qt) qr on true
    where d.ma_don = p_ma_don and (
      qr.qt is null
      or exists (select 1 from kho.quy_trinh_buoc qb where qb.ma_quy_trinh = qr.qt and coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
           and ( not exists (select 1 from kho.so_don_vi_mon s where s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = p_moc)
                 or coalesce((select mau_so from kho.don_gia_baseline where hoat_dong = qb.hoat_dong), 0) = 0 )))
  ) then return; end if;
  insert into kho.gio_don_da_tinh(ma_don, ma_to, moc, gio, tinh_luc)
  select p_ma_don, coalesce(d2.ma_to, '(chưa rõ tổ)'), p_moc,
    sum( (case when coalesce(qb.loai_buoc,'nguoi') = 'tu_chay' then coalesce(qb.gio_co_dinh,0)
               when s.chot_luc is not null and s.gio_moi_don_vi_chot is not null then coalesce(s.gio_co_dinh_chot,0) + s.gio_moi_don_vi_chot * s.so_don_vi
               else coalesce(qb.gio_co_dinh,0) + coalesce(qb.gio_moi_don_vi,0) * s.so_don_vi end) * coalesce(dm.so_luong,1) ), now()
  from kho.don_hang d join kho.don_hang_mon dm on dm.don_id = d.id
    join lateral (select coalesce(dm.ma_quy_trinh,
          (select l.ma_quy_trinh from kho.san_pham_mau sm join kho.san_pham_loi l on l.ma_loi = sm.ma_loi where sm.ma = dm.sp_id)) qt) qr on true
    join kho.quy_trinh_buoc qb on qb.ma_quy_trinh = qr.qt
    left join kho.so_don_vi_mon s on s.mon_id = dm.id and s.hoat_dong = qb.hoat_dong and s.moc = p_moc and coalesce(qb.loai_buoc,'nguoi') <> 'tu_chay'
    left join kho.don_gia_baseline d2 on d2.hoat_dong = qb.hoat_dong
  where d.ma_don = p_ma_don
  group by coalesce(d2.ma_to, '(chưa rõ tổ)');
end $$;

create or replace function kho.dung_lai_gio_don(p_ma_don text)
  returns void language plpgsql security definer set search_path = kho as $$
declare m text;
begin
  delete from kho.gio_don_da_tinh where ma_don = p_ma_don;
  for m in select distinct s.moc from kho.so_don_vi_mon s join kho.don_hang_mon dm on dm.id = s.mon_id join kho.don_hang d on d.id = dm.don_id where d.ma_don = p_ma_don loop
    perform kho.dung_lai_gio_don_moc(p_ma_don, m);
  end loop;
end $$;

-- đơn "đã bàn giao" = có so_don_vi chốt (chot_luc) — QD-16: giờ đã đóng băng, KHÔNG tính lại theo quy trình sống
create or replace function kho.don_da_ban_giao(p_ma_don text) returns boolean language sql stable security definer set search_path=kho as $$
  select exists (select 1 from kho.so_don_vi_mon s join kho.don_hang_mon dm on dm.id=s.mon_id join kho.don_hang d on d.id=dm.don_id
                 where d.ma_don=p_ma_don and s.chot_luc is not null);
$$;

-- (a) so_don_vi_mon đổi (chuan/du_kien) → tính lại đơn của món đó (thuc_te KHÔNG kích)
create or replace function kho._trg_gdt_sodv() returns trigger language plpgsql security definer set search_path=kho as $$
declare v_moc text; v_mon uuid; v_don text;
begin
  if TG_OP='DELETE' then v_moc:=OLD.moc; v_mon:=OLD.mon_id; else v_moc:=NEW.moc; v_mon:=NEW.mon_id; end if;
  if v_moc not in ('chuan','du_kien') then return null; end if;
  select d.ma_don into v_don from kho.don_hang_mon dm join kho.don_hang d on d.id=dm.don_id where dm.id=v_mon;
  if v_don is not null then perform kho.dung_lai_gio_don_moc(v_don, v_moc); end if;
  return null;
end $$;
drop trigger if exists trg_gdt_sodv on kho.so_don_vi_mon;
create trigger trg_gdt_sodv after insert or update or delete on kho.so_don_vi_mon for each row execute function kho._trg_gdt_sodv();

-- (b) don_hang_mon.ma_quy_trinh đổi → tính lại đơn đó (mọi mốc)
create or replace function kho._trg_gdt_mon() returns trigger language plpgsql security definer set search_path=kho as $$
declare v_don text;
begin
  select ma_don into v_don from kho.don_hang where id = NEW.don_id;
  if v_don is not null then perform kho.dung_lai_gio_don(v_don); end if;
  return null;
end $$;
drop trigger if exists trg_gdt_mon on kho.don_hang_mon;
create trigger trg_gdt_mon after update of ma_quy_trinh on kho.don_hang_mon for each row
  when (NEW.ma_quy_trinh is distinct from OLD.ma_quy_trinh) execute function kho._trg_gdt_mon();

-- (c) quy_trinh_buoc đổi (phút/bước/buoc_truoc) → tính lại MỌI đơn dùng quy trình đó, TRỪ đơn ĐÃ BÀN GIAO (QD-16)
create or replace function kho._trg_gdt_qtb() returns trigger language plpgsql security definer set search_path=kho as $$
declare v_qt text; v_don text;
begin
  v_qt := coalesce(NEW.ma_quy_trinh, OLD.ma_quy_trinh);
  for v_don in
    select distinct d.ma_don from kho.don_hang d join kho.don_hang_mon dm on dm.don_id=d.id
      join lateral (select coalesce(dm.ma_quy_trinh,
            (select l.ma_quy_trinh from kho.san_pham_mau sm join kho.san_pham_loi l on l.ma_loi=sm.ma_loi where sm.ma=dm.sp_id)) qt) qr on true
    where qr.qt = v_qt and not kho.don_da_ban_giao(d.ma_don)
  loop perform kho.dung_lai_gio_don(v_don); end loop;
  return null;
end $$;
drop trigger if exists trg_gdt_qtb on kho.quy_trinh_buoc;
create trigger trg_gdt_qtb after insert or update or delete on kho.quy_trinh_buoc for each row execute function kho._trg_gdt_qtb();

-- gieo giờ cho đơn ĐANG CÓ (chạy trực tiếp — dung_lai_gio_don không gác vai)
do $$ declare t text; begin
  for t in select distinct d.ma_don from kho.so_don_vi_mon s join kho.don_hang_mon dm on dm.id=s.mon_id join kho.don_hang d on d.id=dm.don_id loop
    perform kho.dung_lai_gio_don(t);
  end loop;
end $$;
commit;

-- ─────────── VIỆC 3 · tai_theo_to_tuan SUM gio_don_da_tinh (không gọi gio_du_kien mỗi đơn) ───────────
begin;
create or replace function kho.tai_theo_to_tuan(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare
  d record; kv record; v_tang int; v_k int; v_nweeks int; v_tyle numeric; v_du boolean;
  v_ws date; nl record; t1 numeric; t2 numeric; t3 numeric; v_o jsonb := '[]'::jsonb; v_tuan jsonb := '[]'::jsonb;
  v_han date; v_gio numeric; v_tu date;
  ch1 int := 0; ch2 int := 0; ch3 int := 0; chg1 numeric := 0; chg2 numeric := 0; chg3 numeric := 0;
  ts1 int := 0; ts2 int := 0; ts3 int := 0;
  TO7 text[] := array['cnc','dan_canh','cha_lot','son_pu','lap_rap','dong_goi','giuong'];
  mt text; xl record;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan') then
    raise exception 'tai_theo_to_tuan: chỉ ceo/xuong/ke_toan'; end if;
  v_tu := kho.tuan_cua(p_tu_ngay);
  v_nweeks := greatest(1, ceil((p_den_ngay - v_tu) / 7.0)::int);
  select ty_le, du into v_tyle, v_du from kho.ty_le_chot();
  drop table if exists _tai; create temp table _tai(ma_to text, k int, tang int, gio numeric) on commit drop;

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
    if d.da_xep then
      for xl in select ma_to, tuan_bat_dau, gio from kho.xep_lich where ma_don = d.ma_don and ma_to is not null loop
        v_k := ((xl.tuan_bat_dau - v_tu) / 7);
        if v_k < 0 or v_k >= v_nweeks then continue; end if;
        insert into _tai(ma_to,k,tang,gio) values (xl.ma_to, v_k, v_tang, xl.gio * case when v_tang=3 then v_tyle else 1 end);
      end loop;
      continue;
    end if;
    -- GIỜ ĐÃ TÍNH SẴN: không rows ('chuan') = thiếu số (ngoài tải)
    if not exists (select 1 from kho.gio_don_da_tinh where ma_don=d.ma_don and moc='chuan') then
      if v_tang=1 then ts1:=ts1+1; elsif v_tang=2 then ts2:=ts2+1; else ts3:=ts3+1; end if; continue; end if;
    v_han := d.ngay_hen_khach;
    if v_han is null then
      v_gio := coalesce((select sum(gio) from kho.gio_don_da_tinh where ma_don=d.ma_don and moc='chuan'),0) * case when v_tang=3 then v_tyle else 1 end;
      if v_tang=1 then ch1:=ch1+1; chg1:=chg1+v_gio; elsif v_tang=2 then ch2:=ch2+1; chg2:=chg2+v_gio; else ch3:=ch3+1; chg3:=chg3+v_gio; end if; continue; end if;
    v_k := floor((kho.tuan_cua(v_han) - v_tu) / 7.0)::int;
    if v_k < 0 then v_k := 0; end if;
    if v_k >= v_nweeks then continue; end if;
    for kv in select ma_to, gio from kho.gio_don_da_tinh where ma_don=d.ma_don and moc='chuan' loop
      insert into _tai(ma_to, k, tang, gio) values (kv.ma_to, v_k, v_tang, kv.gio * case when v_tang=3 then v_tyle else 1 end);
    end loop;
  end loop;

  for v_k in 0 .. v_nweeks - 1 loop
    v_ws := v_tu + v_k*7; v_tuan := v_tuan || to_jsonb(v_ws);
    foreach mt in array TO7 loop
      select coalesce(sum(gio) filter (where tang=1),0), coalesce(sum(gio) filter (where tang=2),0), coalesce(sum(gio) filter (where tang=3),0)
        into t1,t2,t3 from _tai where ma_to=mt and k=v_k;
      select gio_nen, thieu_nang_luc into nl from kho.nang_luc_to_tuan(mt, v_ws, v_ws+7) limit 1;
      v_o := v_o || jsonb_build_array(jsonb_build_object(
        'ma_to', mt, 'tuan_bat_dau', v_ws, 'vung', kho.vung_cua_tuan(v_ws),
        't1_dang_lam', round(t1,1), 't2_da_chot', round(t2,1), 't3_bao_gia', round(t3,1), 'tong_tai', round(t1+t2+t3,1),
        'nang_luc', nl.gio_nen, 'thieu_nang_luc', coalesce(nl.thieu_nang_luc,true),
        'thieu_thua', case when nl.gio_nen is null then null else round(nl.gio_nen - (t1+t2+t3),1) end));
    end loop;
  end loop;

  return jsonb_build_object(
    'tu_ngay', v_tu, 'den_ngay', p_den_ngay, 'so_tuan', v_nweeks,
    'ty_le_chot', v_tyle, 'ty_le_chot_chua_du', not v_du, 'tuan', v_tuan, 'o', v_o,
    'chua_co_han', jsonb_build_object('t1_don',ch1,'t2_don',ch2,'t3_don',ch3,'t1_gio',round(chg1,1),'t2_gio',round(chg2,1),'t3_gio',round(chg3,1)),
    'thieu_so', jsonb_build_object('t1_don',ts1,'t2_don',ts2,'t3_don',ts3));
end $$;
commit;

-- ─────────── VIỆC 4 · phân trang 3 RPC (gioi_han mặc định 50, bo_qua 0, kèm tong_so) ───────────
-- ⚠ CẮT BỚT: caller cũ (0 tham số) NAY chỉ 50 dòng. App xưởng cần sửa: taiKanban (kanban_xuong),
--   taiQuanDoc (viec_uu_tien), taiDon (xuong_don_san_xuat) — đọc tong_so + truyền gioi_han/bo_qua để phân trang.
begin;
drop function if exists kho.kanban_xuong();
create or replace function kho.kanban_xuong(p_gioi_han int default 50, p_bo_qua int default 0)
  returns table(ma_don text, cot text, to_goi_y text, dong text, ten_rut_gon text,
                so_mon_qua int, so_mon_tong int, la_tre boolean, la_gap boolean, la_mau_moi boolean, ngay_hen_khach date, tong_so bigint)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'kanban_xuong: chỉ ceo/xuong'; end if;
  return query
  select d.ma_don, coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai) as cot,
    case coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai)
      when 'cho_cat' then 'CNC (cắt)' when 'da_cat' then 'Dán cạnh / khoan' when 'dang_lam' then 'Lắp ráp'
      when 'xong_sx' then 'Xong SX' when 'cho_giao' then 'Chờ giao' else '—' end as to_goi_y,
    d.dong,
    coalesce((select m.ten from kho.don_hang_mon m where m.don_id = d.id order by m.tao_luc nulls last, m.id limit 1), d.ma_don) as ten,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id and m.trang_thai is distinct from coalesce(kho.trang_thai_don_tu_mon(d.id), d.trang_thai)) as so_qua,
    (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id) as so_tong,
    (d.ngay_hen_khach is not null and d.ngay_hen_khach < current_date) as la_tre,
    d.danh_dau_gap, (d.loai = 'mau_moi') as la_mau_moi, d.ngay_hen_khach,
    count(*) over() as tong_so
  from kho.don_hang d
  where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')
  order by d.ma_don limit p_gioi_han offset p_bo_qua;
end $$;
grant execute on function kho.kanban_xuong(int, int) to authenticated;

drop function if exists kho.xuong_don_san_xuat();
create or replace function kho.xuong_don_san_xuat(p_gioi_han int default 50, p_bo_qua int default 0)
  returns table(ma_don text, trang_thai text, so_mon int, co_tem boolean, tong_so bigint)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then raise exception 'xuong_don_san_xuat: chỉ ceo/kho/xuong/tho'; end if;
  return query
    select d.ma_don, d.trang_thai,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
      exists(select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don),
      count(*) over() as tong_so
    from kho.don_hang d
    where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')
    order by d.ma_don limit p_gioi_han offset p_bo_qua;
end $$;
grant execute on function kho.xuong_don_san_xuat(int, int) to authenticated;

drop function if exists kho.viec_uu_tien();
create or replace function kho.viec_uu_tien(p_gioi_han int default 50, p_bo_qua int default 0)
  returns table(ma_don text, ten_mon text, to_goi_y text, rank_uu_tien int, ly_do text,
                ngay_hen_khach date, so_ngay_lien_quan int, tong_so bigint)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then raise exception 'viec_uu_tien: chỉ ceo/xuong'; end if;
  return query
  with don_sx as (
    select d.id, d.ma_don, d.trang_thai, d.loai, d.ngay_hen_khach, d.danh_dau_gap, d.ma_ns_danh_dau, d.ly_do_gap
    from kho.don_hang d where d.trang_thai in ('cho_cat','da_cat','dang_lam')
  ),
  bottleneck as (
    select ds.id, ds.ma_don, ds.trang_thai as don_tt, ds.loai, ds.ngay_hen_khach, ds.danh_dau_gap, ds.ly_do_gap,
      m.ten as ten_mon, m.trang_thai as mon_tt,
      (current_date - coalesce((select max(k.luc) from kho.don_hang_mon_nhat_ky k where k.mon_id = m.id), m.tao_luc)::date) as ngay_dung
    from don_sx ds
    join lateral (select m2.* from kho.don_hang_mon m2 where m2.don_id = ds.id and m2.trang_thai <> 'xong_sx'
      order by case m2.trang_thai when 'cho_cat' then 1 when 'da_cat' then 2 when 'dang_lam' then 3 else 9 end limit 1) m on true
  ),
  xep as (
    select b.*, case
        when b.ngay_hen_khach is not null and b.ngay_hen_khach < current_date then 1
        when b.danh_dau_gap and b.ma_don is not null then 2
        when b.ngay_dung > 3 then 3
        when b.ngay_hen_khach is not null then 4
        when b.loai = 'mau_moi' then 5 else 4 end as rk
    from bottleneck b
  )
  select x.ma_don, x.ten_mon,
    case x.mon_tt when 'cho_cat' then 'CNC (cắt)' when 'da_cat' then 'Dán cạnh / khoan' when 'dang_lam' then 'Lắp ráp' else '—' end,
    x.rk,
    case x.rk
      when 1 then 'Quá hạn ' || (current_date - x.ngay_hen_khach) || ' ngày (hẹn ' || to_char(x.ngay_hen_khach,'DD/MM') || ')'
      when 2 then 'GẤP — có người duyệt: ' || coalesce(x.ly_do_gap,'(không rõ)')
      when 3 then 'Đứng yên ' || x.ngay_dung || ' ngày ở bước ' || x.mon_tt
      when 4 then case when x.ngay_hen_khach is not null then 'Còn ' || (x.ngay_hen_khach - current_date) || ' ngày tới hạn' else 'Thường' end
      when 5 then 'Mẫu mới (không hạn khách)' else 'Thường' end,
    x.ngay_hen_khach,
    case x.rk when 1 then (current_date - x.ngay_hen_khach) when 3 then x.ngay_dung when 4 then coalesce(x.ngay_hen_khach - current_date, 9999) else 0 end,
    count(*) over() as tong_so
  from xep x
  order by x.rk asc,
    case x.rk when 1 then -(current_date - x.ngay_hen_khach) when 3 then -x.ngay_dung when 4 then coalesce(x.ngay_hen_khach - current_date, 9999) else 0 end asc,
    x.ma_don
  limit p_gioi_han offset p_bo_qua;
end $$;
grant execute on function kho.viec_uu_tien(int, int) to authenticated;
commit;
