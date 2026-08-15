-- db/080 — atp() nhận tham số MỐC + so_lech_hua (L-23 Phần B)
-- Bối cảnh (QD-15 + kiểm A): atp đọc so_don_vi_mon 'chuan' (thiết kế SX nhập SAU chốt). Sale cần hứa TRƯỚC chốt →
--   dùng mốc 'du_kien' (ước bán hàng). Cho atp chọn mốc; mốc trống → thử mốc kia + cờ (KHÔNG im lặng đổi).
-- THUẦN DB. Idempotent (drop overload cũ rồi tạo bản có tham số mốc).
begin;

-- sched_buoc + mốc (mặc định 'chuan' → mọi caller cũ giữ nguyên)
drop function if exists kho.sched_buoc(text);
create or replace function kho.sched_buoc(p_ma_don text, p_moc text default 'chuan')
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
                   from (select so_don_vi from kho.so_don_vi_mon sdv where sdv.mon_id = m.id and sdv.hoat_dong = b.hoat_dong and sdv.moc = p_moc) s)
        end,
        coalesce(b.loai_buoc,'nguoi'), b.buoc_truoc
      from kho.quy_trinh_buoc b left join kho.don_gia_baseline d on d.hoat_dong = b.hoat_dong
      where b.ma_quy_trinh = v_qt and coalesce(b.loai_buoc,'nguoi') in ('nguoi','tu_chay');
  end loop;
end $$;
grant execute on function kho.sched_buoc(text, text) to authenticated;

-- _sched + mốc (đưa xuống sched_buoc)
drop function if exists kho._sched(text, text, date);
create or replace function kho._sched(p_ma_don text, p_dir text, p_neo date, p_moc text default 'chuan')
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
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
      if v_disp > 0 then v_nut := jsonb_build_object('ma_to', s.ma_to, 'tuan', c, 'gio_thieu', round(s.gio - greatest(v_avail_c,0),1)); end if;
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
end $$;

-- lõi ATP một mốc (KHÔNG lùi mốc) — dùng cho atp() và so_lech_hua()
create or replace function kho._atp_moc(p_ma_don text, p_moc text)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_han date; r jsonb; x jsonb;
begin
  select ngay_hen_khach into v_han from kho.don_hang where ma_don = p_ma_don;
  if v_han is not null then
    r := kho._sched(p_ma_don, 'nguoc', kho.tuan_cua(v_han), p_moc);
    if (r->>'ok')::boolean is not true then return r; end if;
    if (r->>'phai_xep_xuoi')::boolean is not true then
      return jsonb_build_object('ok',true,'ngay_hua_duoc',v_han,'xep_bang','nguoc','lich',r->'lich','nut_that',r->'nut_that'); end if;
  end if;
  x := kho._sched(p_ma_don, 'xuoi', kho.tuan_cua(current_date), p_moc);
  if (x->>'ok')::boolean is not true then return x; end if;
  return jsonb_build_object('ok',true,'ngay_hua_duoc',(x->>'ngay_xong_som')::date,'xep_bang','xuoi',
    'lich',x->'lich','nut_that',x->'nut_that','vi', case when v_han is null then 'don_khong_han' else 'lui_vuot_hom_nay' end);
end $$;

-- atp(ma_don, moc) — đọc mốc truyền vào; trống → thử mốc kia + cờ DA_DUNG_MOC_KHAC
drop function if exists kho.atp(text);
create or replace function kho.atp(p_ma_don text, p_moc text default 'chuan')
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare r jsonb; r2 jsonb; v_khac text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke') then
    raise exception 'atp: vai không xem được'; end if;
  if p_moc not in ('du_kien','chuan') then raise exception 'atp: mốc phải du_kien/chuan'; end if;
  r := kho._atp_moc(p_ma_don, p_moc);
  if (r->>'loi') = 'THIEU_SO_DON_VI' then
    v_khac := case p_moc when 'chuan' then 'du_kien' else 'chuan' end;
    r2 := kho._atp_moc(p_ma_don, v_khac);
    if (r2->>'ok')::boolean is true then
      return r2 || jsonb_build_object('ma_don',p_ma_don,'moc_da_dung',v_khac,
        'do_tin', case when v_khac='chuan' then 'cao' else 'uoc' end,
        'da_dung_moc_khac', true, 'moc_yeu_cau', p_moc); end if;
    return jsonb_build_object('ok',false,'loi','THIEU_SO_DON_VI','ma_don',p_ma_don,'moc_yeu_cau',p_moc,
      'ca_hai_moc_trong', true);
  end if;
  if (r->>'ok')::boolean is not true then return r || jsonb_build_object('ma_don',p_ma_don); end if;
  return r || jsonb_build_object('ma_don',p_ma_don,'moc_da_dung',p_moc,
    'do_tin', case when p_moc='chuan' then 'cao' else 'uoc' end, 'da_dung_moc_khac', false);
end $$;
grant execute on function kho.atp(text, text) to authenticated;

-- so_lech_hua(ma_don): ngày hứa theo du_kien vs chuan; lệch > 3 ngày → cảnh báo (QD-15: chênh du_kien→chuan = rủi ro báo giá)
create or replace function kho.so_lech_hua(p_ma_don text)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare a jsonb; b jsonb; v_lech int; da date; db_ date;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan','sale','thiet_ke') then
    raise exception 'so_lech_hua: vai không xem được'; end if;
  a := kho._atp_moc(p_ma_don, 'du_kien');
  b := kho._atp_moc(p_ma_don, 'chuan');
  if (a->>'ok')::boolean is not true or (b->>'ok')::boolean is not true then
    return jsonb_build_object('ok',true,'so_sanh_duoc',false,
      'du_kien_ok',(a->>'ok')::boolean is true, 'chuan_ok',(b->>'ok')::boolean is true,
      'ly_do','thiếu số ở một mốc — chưa so được'); end if;
  da := (a->>'ngay_hua_duoc')::date; db_ := (b->>'ngay_hua_duoc')::date;
  v_lech := abs(da - db_);
  return jsonb_build_object('ok',true,'so_sanh_duoc',true,
    'ngay_hua_du_kien', da, 'ngay_hua_chuan', db_, 'lech_ngay', v_lech,
    'canh_bao', case when v_lech > 3 then 'ước bán hàng (du_kien) lệch ' || v_lech || ' ngày so với số chuẩn — rủi ro báo giá' else null end);
end $$;
grant execute on function kho.so_lech_hua(text) to authenticated;

commit;
