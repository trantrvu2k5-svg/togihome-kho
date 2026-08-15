-- db/078 — NĂNG LỰC TỔ (có hiệu lực theo thời gian) + BẢNG TẢI THEO TUẦN (L-21)
-- Căn cứ: giáo trình quản trị sản xuất, ch. Lịch trình SX chính — "hoạch định năng lực sơ bộ":
--   bảng BỘ PHẬN × TUẦN = giờ, so tải với năng lực từng tuần để tìm tuần quá tải / dưới tải (ví dụ 6.4).
--   Năng lực NỀN không gồm tăng ca (tăng ca là 1 trong 4 đường xử quá tải).
-- [TÔI ĐOÁN] (sách không nói): chia tải thành BA TẦNG chắc chắn (đang làm / đã chốt / báo giá×tỷ lệ)
--   và hệ số hữu ích 0.88. Bốn mốc Đóng băng/Vững/Đầy/Mở: CHƯA làm (lô sau).
-- THUẦN DB, không màn. Idempotent.
begin;
create extension if not exists btree_gist;

-- ─────────── VIỆC 1 · bảng năng lực tổ theo thời gian ───────────
create table if not exists kho.nang_luc_to (
  id            bigint generated always as identity primary key,
  ma_to         text not null references kho.to_san_xuat(ma_to),
  tu_ngay       date not null,
  den_ngay      date,                                   -- null = còn hiệu lực
  so_nguoi      int  not null check (so_nguoi >= 0),
  gio_moi_ngay  numeric not null default 8,
  ngay_moi_tuan int not null default 7,
  he_so_huu_ich numeric not null default 0.88 check (he_so_huu_ich > 0 and he_so_huu_ich <= 1),
  ghi_chu       text,
  check (den_ngay is null or den_ngay >= tu_ngay),
  -- CHỒNG NHAU = tính tải sai → chặn cứng. daterange inclusive hai đầu; kề nhau (…31 · 01…) KHÔNG chồng.
  constraint nang_luc_to_khong_chong
    exclude using gist (ma_to with =, daterange(tu_ngay, den_ngay, '[]') with &&)
);
grant select on kho.nang_luc_to to authenticated;

-- gieo 7 tổ theo số CEO chốt (idempotent: chỉ chèn nếu tổ chưa có dòng nào)
insert into kho.nang_luc_to(ma_to, tu_ngay, den_ngay, so_nguoi, ghi_chu)
select v.ma_to, current_date, null, v.n,
  '[TẠM] hệ số hữu ích 0.88 từ báo cáo vận hành demo (88% công vào đơn, 12% sửa/mẫu/chờ); sẽ đo thật từ ca_lam khi máy quét chạy'
from (values ('cnc',5),('dan_canh',5),('cha_lot',10),('son_pu',4),('lap_rap',8),('dong_goi',9),('giuong',4)) v(ma_to,n)
where not exists (select 1 from kho.nang_luc_to n where n.ma_to = v.ma_to);

-- ─────────── nang_luc_to_tuan: giờ NỀN mỗi tuần (tuần canh theo tu_ngay), tỷ lệ ngày khi bắc cầu ───────────
--   Tuần k = [tu_ngay+7k, +7). Giờ tuần = Σ khoảng phủ: (so_nguoi×gio_ngay×ngay_tuan×he_so) × (số ngày phủ / 7).
--   KHÔNG khoảng nào phủ tuần → thieu_nang_luc=true, gio_nen=null (fail-đóng, KHÔNG coi là 0).
create or replace function kho.nang_luc_to_tuan(p_ma_to text, p_tu_ngay date, p_den_ngay date)
  returns table(tuan_bat_dau date, gio_nen numeric, thieu_nang_luc boolean)
  language plpgsql stable security definer set search_path = kho as $$
declare ws date; we date; v_gio numeric; v_days int;
begin
  ws := p_tu_ngay;
  while ws < p_den_ngay loop
    we := ws + 7;   -- [ws, we)
    select coalesce(sum(n.so_nguoi * n.gio_moi_ngay * n.ngay_moi_tuan * n.he_so_huu_ich * ov.d / 7.0), 0),
           coalesce(sum(ov.d), 0)
      into v_gio, v_days
      from kho.nang_luc_to n
      cross join lateral (
        select greatest(0, (least(we - 1, coalesce(n.den_ngay, we - 1)) - greatest(ws, n.tu_ngay)) + 1)::int d
      ) ov
      where n.ma_to = p_ma_to and ov.d > 0;
    tuan_bat_dau := ws;
    if v_days = 0 then gio_nen := null; thieu_nang_luc := true;
    else gio_nen := round(v_gio, 1); thieu_nang_luc := false; end if;
    return next;
    ws := we;
  end loop;
end $$;
grant execute on function kho.nang_luc_to_tuan(text, date, date) to authenticated;

-- ─────────── tỷ lệ chốt 3 tháng gần nhất (báo giá → đơn). <10 báo giá → 0 + cờ chưa đủ ───────────
create or replace function kho.ty_le_chot()
  returns table(ty_le numeric, du boolean, tong int, chot int)
  language sql stable security definer set search_path = kho as $$
  with bg as (
    select trang_thai from kho.don_hang
    where ngay_tao_bao_gia is not null and ngay_tao_bao_gia >= now() - interval '90 days'
  )
  select case when count(*) >= 10 then round(
             count(*) filter (where trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy'))::numeric
             / nullif(count(*),0), 4) else 0 end,
         count(*) >= 10, count(*)::int,
         count(*) filter (where trang_thai not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy'))::int
  from bg;
$$;
grant execute on function kho.ty_le_chot() to authenticated;

-- ─────────── VIỆC 2 · tai_theo_to_tuan: tổ × tuần, BA TẦNG tách riêng + năng lực + thiếu/thừa ───────────
create or replace function kho.tai_theo_to_tuan(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare
  d record; g jsonb; kv record; v_tang int; v_k int; v_nweeks int; v_tyle numeric; v_du boolean;
  v_ws date; nl record; t1 numeric; t2 numeric; t3 numeric; v_o jsonb := '[]'::jsonb; v_tuan jsonb := '[]'::jsonb;
  v_han date; v_gio numeric;
  ch1 int := 0; ch2 int := 0; ch3 int := 0; chg1 numeric := 0; chg2 numeric := 0; chg3 numeric := 0;
  ts1 int := 0; ts2 int := 0; ts3 int := 0;
  TO7 text[] := array['cnc','dan_canh','cha_lot','son_pu','lap_rap','dong_goi','giuong'];
  mt text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan') then
    raise exception 'tai_theo_to_tuan: chỉ ceo/xuong/ke_toan'; end if;
  v_nweeks := greatest(1, ceil((p_den_ngay - p_tu_ngay) / 7.0)::int);
  select ty_le, du into v_tyle, v_du from kho.ty_le_chot();

  drop table if exists _tai;
  create temp table _tai(ma_to text, k int, tang int, gio numeric) on commit drop;

  for d in
    select ma_don, trang_thai, ngay_hen_khach,
      case when trang_thai in ('cho_cat','da_cat','dang_lam') then 1
           when trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file') then 2
           when trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo') then 3 end as tang
    from kho.don_hang
    where trang_thai in ('cho_cat','da_cat','dang_lam','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file','bao_gia','bao_gia_thua','bao_gia_treo')
  loop
    v_tang := d.tang;
    g := kho.gio_du_kien_cua_don(d.ma_don, 'chuan');
    if (g->>'ok')::boolean is not true then         -- thiếu số đơn vị → đếm riêng, KHÔNG bỏ im lặng
      if v_tang=1 then ts1:=ts1+1; elsif v_tang=2 then ts2:=ts2+1; else ts3:=ts3+1; end if;
      continue;
    end if;
    v_han := d.ngay_hen_khach;
    if v_han is null then                            -- chưa có hạn → nhóm riêng (đếm đơn + giờ), KHÔNG đoán
      v_gio := coalesce((g->>'tong_gio_don')::numeric,0) * case when v_tang=3 then v_tyle else 1 end;
      if v_tang=1 then ch1:=ch1+1; chg1:=chg1+v_gio; elsif v_tang=2 then ch2:=ch2+1; chg2:=chg2+v_gio; else ch3:=ch3+1; chg3:=chg3+v_gio; end if;
      continue;
    end if;
    v_k := floor((v_han - p_tu_ngay) / 7.0)::int;
    if v_k < 0 then v_k := 0; end if;                -- quá hạn → dồn tuần đầu (không mất)
    if v_k >= v_nweeks then continue; end if;        -- ngoài tầm 4 tuần
    for kv in select key as ma_to, value::numeric as gio from jsonb_each_text(g->'theo_to') loop
      insert into _tai(ma_to, k, tang, gio)
        values (kv.ma_to, v_k, v_tang, kv.gio * case when v_tang=3 then v_tyle else 1 end);
    end loop;
  end loop;

  for v_k in 0 .. v_nweeks - 1 loop
    v_ws := p_tu_ngay + v_k*7;
    v_tuan := v_tuan || to_jsonb(v_ws);
    foreach mt in array TO7 loop
      select coalesce(sum(gio) filter (where tang=1),0), coalesce(sum(gio) filter (where tang=2),0), coalesce(sum(gio) filter (where tang=3),0)
        into t1,t2,t3 from _tai where ma_to=mt and k=v_k;
      select gio_nen, thieu_nang_luc into nl from kho.nang_luc_to_tuan(mt, v_ws, v_ws+7) limit 1;
      v_o := v_o || jsonb_build_array(jsonb_build_object(
        'ma_to', mt, 'tuan_bat_dau', v_ws,
        't1_dang_lam', round(t1,1), 't2_da_chot', round(t2,1), 't3_bao_gia', round(t3,1),
        'tong_tai', round(t1+t2+t3,1),
        'nang_luc', nl.gio_nen, 'thieu_nang_luc', coalesce(nl.thieu_nang_luc,true),
        'thieu_thua', case when nl.gio_nen is null then null else round(nl.gio_nen - (t1+t2+t3),1) end));
    end loop;
  end loop;

  return jsonb_build_object(
    'tu_ngay', p_tu_ngay, 'den_ngay', p_den_ngay, 'so_tuan', v_nweeks,
    'ty_le_chot', v_tyle, 'ty_le_chot_chua_du', not v_du,
    'tuan', v_tuan, 'o', v_o,
    'chua_co_han', jsonb_build_object('t1_don',ch1,'t2_don',ch2,'t3_don',ch3,
                     't1_gio',round(chg1,1),'t2_gio',round(chg2,1),'t3_gio',round(chg3,1)),
    'thieu_so', jsonb_build_object('t1_don',ts1,'t2_don',ts2,'t3_don',ts3));
end $$;
grant execute on function kho.tai_theo_to_tuan(date, date) to authenticated;

-- ─────────── VIỆC 3 · tai_qua_tai: các ô thiếu (thieu_thua<0), sắp thiếu giảm dần, quy ra người-tuần ───────────
create or replace function kho.tai_qua_tai(p_tu_ngay date, p_den_ngay date)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v jsonb; o jsonb; el jsonb; arr jsonb := '[]'::jsonb; i int; tt numeric; nl numeric; tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','ke_toan') then
    raise exception 'tai_qua_tai: chỉ ceo/xuong/ke_toan'; end if;
  v := kho.tai_theo_to_tuan(p_tu_ngay, p_den_ngay);
  o := v->'o';
  for i in 0 .. jsonb_array_length(o)-1 loop
    el := o->i;
    if el->>'thieu_thua' is null then continue; end if;
    tt := (el->>'thieu_thua')::numeric;
    if tt >= 0 then continue; end if;
    nl := (el->>'nang_luc')::numeric; tong := (el->>'tong_tai')::numeric;
    arr := arr || jsonb_build_array(jsonb_build_object(
      'ma_to', el->>'ma_to', 'tuan_bat_dau', el->>'tuan_bat_dau',
      'can_gio', tong, 'co_gio', nl, 'thieu_gio', round(-tt,1),
      'thieu_nguoi_tuan', round((-tt) / (8*7*0.88), 2)));   -- 1 người-tuần = 8×7×0.88 = 49.28 giờ
  end loop;
  -- sắp thiếu GIẢM DẦN (thiếu nhiều nhất trước)
  select coalesce(jsonb_agg(x order by (x->>'thieu_gio')::numeric desc), '[]'::jsonb) into arr
    from jsonb_array_elements(arr) x;
  return jsonb_build_object('tu_ngay', p_tu_ngay, 'den_ngay', p_den_ngay, 'so_o_qua_tai', jsonb_array_length(arr), 'o', arr);
end $$;
grant execute on function kho.tai_qua_tai(date, date) to authenticated;

commit;
