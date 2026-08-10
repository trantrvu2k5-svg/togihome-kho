-- 038 — APP XƯỞNG: tiến độ theo món · tem (đẩy/in/đếm) · phiếu đếm · đơn giá hoạt động thực.
--   node ops/run_sql.mjs ../db/038_app_xuong.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--   Đã có từ 037 (KHÔNG dựng lại): to_san_xuat · phieu.ma_to · driver_tu_kho · SN-04/05/06 · chốt lỗ sơn.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.ty_le_truy_duoc(text,text), kho.don_gia_hoat_dong_thuc(text,text),
--     kho.ty_le_cat_lai(text), kho.driver_tu_tem(text,text), kho.ghi_lan_in_tem(text,int,text[]),
--     kho.day_tem_ban_ve(text,jsonb), kho.trang_thai_don_tu_mon(uuid);
--   drop trigger if exists trg_mon_day_don on kho.don_hang_mon; drop function if exists kho.dong_bo_trang_thai_don();
--   drop trigger if exists trg_chan_chuyen_vai on kho.don_hang; drop function if exists kho.chan_chuyen_theo_vai();
--   drop trigger if exists trg_phan_bo_100 on kho.phan_bo_hoat_dong; drop function if exists kho.kiem_phan_bo_100();
--   drop table if exists kho.tem_da_in, kho.lan_in_tem, kho.tem_ban_ve, kho.phieu_dem_ngay, kho.loi_lam_lai,
--     kho.luong_to, kho.phan_bo_hoat_dong, kho.san_luong_don cascade;
--   alter table kho.don_hang_mon drop column if exists trang_thai;
--   delete from storage.buckets where id='tem-svg';
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ A. TIẾN ĐỘ THEO MÓN ═══════════════
-- 1. Trạng thái sản xuất của MÓN. Trạng thái ĐƠN suy ra từ món (đơn = bước CHẬM NHẤT) — 1 nguồn.
alter table kho.don_hang_mon add column if not exists trang_thai text not null default 'cho_cat'
  check (trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx'));

--   Hàm suy trạng thái đơn từ món: bước CHẬM NHẤT (rank nhỏ nhất). Không món -> null.
create or replace function kho.trang_thai_don_tu_mon(p_don_id uuid)
  returns text language sql stable security definer set search_path = kho as $$
  select trang_thai from kho.don_hang_mon m
  where m.don_id = p_don_id
  order by case trang_thai when 'cho_cat' then 1 when 'da_cat' then 2 when 'dang_lam' then 3 when 'xong_sx' then 4 end
  limit 1;
$$;

--   Trigger: món đổi -> ĐỒNG BỘ don_hang.trang_thai (chỉ khi đơn đang trong dây sản xuất). GUC chan.tu_mon né role-gate.
create or replace function kho.dong_bo_trang_thai_don() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_don uuid; v_moi text; v_cur text;
begin
  v_don := coalesce(new.don_id, old.don_id);
  select trang_thai into v_cur from kho.don_hang where id = v_don;
  if v_cur not in ('cho_cat','da_cat','dang_lam','xong_sx') then return coalesce(new, old); end if;  -- chỉ đồng bộ khi đã vào SX
  v_moi := kho.trang_thai_don_tu_mon(v_don);
  if v_moi is not null and v_moi is distinct from v_cur then
    perform set_config('chan.tu_mon','1',true);
    update kho.don_hang set trang_thai = v_moi where id = v_don;
    perform set_config('chan.tu_mon','',true);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_mon_day_don on kho.don_hang_mon;
create trigger trg_mon_day_don after insert or update of trang_thai or delete on kho.don_hang_mon
  for each row execute function kho.dong_bo_trang_thai_don();

-- 3. VÁ LỖ: gác chuyển trạng thái THEO VAI (không chỉ điều kiện). Ma trận đích -> vai được set.
--    Update từ món (chan.tu_mon=1) né chốt này. GUC chan.off_vai để test đối chứng.
create or replace function kho.chan_chuyen_theo_vai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v text; ok boolean;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  if current_setting('chan.tu_mon', true) = '1' then return new; end if;         -- món tự đẩy: cho qua
  if current_setting('chan.off_vai', true) = '1' then return new; end if;         -- test đối chứng
  v := coalesce(kho.current_vai_tro(),'');
  ok := case
    when new.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo','moi_len_don') then v in ('ceo','kho','sale','tk_ban_hang')
    when new.trang_thai in ('nhan_thiet_ke','dang_thiet_ke','xong_file')            then v in ('ceo','kho','thiet_ke')
    when new.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx')                then v in ('ceo','kho','xuong','tho')
    when new.trang_thai in ('cho_giao','da_giao')                                   then v in ('ceo','kho','xuong','ke_toan')
    when new.trang_thai in ('tam_ngung','huy')                                      then v in ('ceo','kho','sale','tk_ban_hang','xuong')
    else false end;
  if not ok then
    raise exception 'Vai "%" không được chuyển đơn sang trạng thái "%"', coalesce(nullif(v,''),'(chưa đăng nhập)'), new.trang_thai;
  end if;
  return new;
end $$;
drop trigger if exists trg_chan_chuyen_vai on kho.don_hang;
create trigger trg_chan_chuyen_vai before update on kho.don_hang
  for each row execute function kho.chan_chuyen_theo_vai();

-- 2. Bốn trạng thái trước KHÔNG ai chuyển được — nay MỞ qua ma trận trên:
--    nhan_thiet_ke ← thiet_ke (nhận việc từ moi_len_don) · cho_cat ← xuong/kho (xong_file -> chờ cắt, mở đếm món)
--    cho_giao ← xuong (xong_sx -> chờ giao) · bao_gia_treo ← sale/tk_ban_hang (treo báo giá, khách chưa quyết)
--    (Chi tiết "ai · lúc nào" ở phần KẾT báo cáo.)

-- ═══════════════ B. TEM: plugin ĐẨY dữ liệu+SVG, xưởng IN ═══════════════
-- 4. tem_ban_ve — metadata từng tấm + đường dẫn SVG. phien_ban tăng mỗi lần plugin đẩy (ma_tam KHÔNG ổn định).
create table if not exists kho.tem_ban_ve (
  ma_don        text not null references kho.don_hang(ma_don) on delete cascade,
  phien_ban     integer not null,
  ma_tam        text not null,
  vai_tro       text,
  dai           numeric, rong numeric, day numeric,
  canh_dan      jsonb not null default '[]'::jsonb,      -- vị trí cạnh dán (T/D/L/R…)
  kien          integer,
  duong_dan_svg text,
  ghi_luc       timestamptz not null default now(),
  primary key (ma_don, phien_ban, ma_tam)
);
-- 5. lan_in_tem — mỗi lượt in. lan_thu tăng theo (ma_don, phien_ban). Lượt 2+ cùng phien_ban = CẮT LẠI.
create table if not exists kho.lan_in_tem (
  id        uuid primary key default gen_random_uuid(),
  ma_don    text not null,
  phien_ban integer not null,
  lan_thu   integer not null,
  ngay      date not null default current_date,
  ma_ns     uuid references kho.nguoi_dung(id),
  so_tem    integer,
  ghi_luc   timestamptz not null default now(),
  unique (ma_don, phien_ban, lan_thu)
);
-- 6. tem_da_in — in cả bộ hay đúng 1 tấm đều ghi.
create table if not exists kho.tem_da_in (
  id        uuid primary key default gen_random_uuid(),
  ma_don    text not null,
  phien_ban integer not null,
  lan_thu   integer not null,
  ma_tam    text not null
);
create index if not exists idx_tem_da_in on kho.tem_da_in (ma_don, phien_ban);

-- 8. RPC plugin đẩy tem: guard (ceo/kho/thiet_ke). Tự sinh phien_ban mới. danh_sach_tam = jsonb array.
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_pb integer; t jsonb;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiet_ke';
  end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = p_ma_don) then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;
  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;   -- phien_ban tăng
  for t in select * from jsonb_array_elements(p_tam) loop
    -- duong_dan_svg TÍNH SERVER (deterministic): {ma_don}/{phien_ban}/{ma_tam an-toàn}.svg.
    --   Client KHÔNG biết phien_ban trước khi gọi -> KHÔNG để client tự đặt path. Plugin tính LẠI y hệt để upload.
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,'so_tam',jsonb_array_length(p_tam));
end $$;
grant execute on function kho.day_tem_ban_ve(text, jsonb) to authenticated;

-- 7. RPC ghi lượt in tem: guard fail-đóng (ceo/kho/xuong/tho). Tự tăng lan_thu theo (ma_don, phien_ban).
create or replace function kho.ghi_lan_in_tem(p_ma_don text, p_phien_ban integer, p_ma_tam text[])
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_lan integer; v_uid uuid; m text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'ghi_lan_in_tem: chỉ ceo/kho/xuong/tho được in tem';
  end if;
  if not exists (select 1 from kho.tem_ban_ve where ma_don=p_ma_don and phien_ban=p_phien_ban) then
    raise exception 'ghi_lan_in_tem: chưa có bản vẽ tem cho đơn "%" phiên bản %', p_ma_don, p_phien_ban;
  end if;
  select coalesce(max(lan_thu),0)+1 into v_lan from kho.lan_in_tem where ma_don=p_ma_don and phien_ban=p_phien_ban;
  select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid();
  insert into kho.lan_in_tem(ma_don,phien_ban,lan_thu,ma_ns,so_tem) values(p_ma_don,p_phien_ban,v_lan,v_uid,array_length(p_ma_tam,1));
  foreach m in array coalesce(p_ma_tam,'{}') loop
    insert into kho.tem_da_in(ma_don,phien_ban,lan_thu,ma_tam) values(p_ma_don,p_phien_ban,v_lan,m);
  end loop;
  return jsonb_build_object('ok',true,'lan_thu',v_lan,'cat_lai',(v_lan>1),'so_tem',coalesce(array_length(p_ma_tam,1),0));
end $$;
grant execute on function kho.ghi_lan_in_tem(text, integer, text[]) to authenticated;

-- 9. driver_tu_tem — đếm trên tem_da_in (MỌI lượt in, KỂ CẢ cắt lại — khác cutlist).
create or replace function kho.driver_tu_tem(p_ma_ky text, p_hoat_dong text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_from date; v_to date; v numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'driver_tu_tem: chỉ ceo/ke_toan/xuong';
  end if;
  v_from := to_date(p_ma_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  if p_hoat_dong = 'goi' then   -- số KIỆN phân biệt
    select count(distinct (t.ma_don, t.phien_ban, b.kien)) into v
    from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
    join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
    where l.ngay>=v_from and l.ngay<v_to and b.kien is not null;
    return v;
  end if;
  if p_hoat_dong = 'dan' then   -- Σ chiều dài cạnh dán (m). canh_dan = [{vi_tri, dai_mm}] do plugin đẩy (canh.dai thật).
    select coalesce(sum(coalesce((e->>'dai')::numeric,0))/1000.0, 0) into v
    from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
    join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
    cross join lateral jsonb_array_elements(b.canh_dan) e
    where l.ngay>=v_from and l.ngay<v_to;
    return v;
  end if;
  -- cat / thung / canh: đếm tem theo vai_tro
  select count(*) into v
  from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
  join kho.tem_ban_ve b on b.ma_don=t.ma_don and b.phien_ban=t.phien_ban and b.ma_tam=t.ma_tam
  where l.ngay>=v_from and l.ngay<v_to
    and case p_hoat_dong
      when 'cat'   then true
      when 'thung' then b.vai_tro = any(array['hong','vach','hau','noc','day','be'])
      when 'canh'  then b.vai_tro = any(array['canh_cua','canh_lua'])
      else false end;
  if p_hoat_dong not in ('cat','thung','canh') then return null; end if;
  return v;
end $$;
grant execute on function kho.driver_tu_tem(text, text) to authenticated;

-- 10. ty_le_cat_lai — Σ tem lượt 2+ (cùng phien_ban) ÷ Σ tem mọi lượt.
create or replace function kho.ty_le_cat_lai(p_ma_ky text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_from date; v_to date; v_lai numeric; v_tong numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then raise exception 'ty_le_cat_lai: chỉ ceo/ke_toan/xuong'; end if;
  v_from := to_date(p_ma_ky||'-01','YYYY-MM-DD'); v_to := (v_from + interval '1 month')::date;
  select count(*) filter (where l.lan_thu > 1), count(*) into v_lai, v_tong
  from kho.tem_da_in t join kho.lan_in_tem l on l.ma_don=t.ma_don and l.phien_ban=t.phien_ban and l.lan_thu=t.lan_thu
  where l.ngay>=v_from and l.ngay<v_to;
  if coalesce(v_tong,0)=0 then return null; end if;
  return round(v_lai / v_tong, 4);
end $$;
grant execute on function kho.ty_le_cat_lai(text) to authenticated;

-- ═══════════════ C. PHIẾU ĐẾM NGÀY (chỉ 3 hoạt động) + GHI LỖI ═══════════════
-- 11. phieu_dem_ngay — CHỈ pu/lot/giuong_lap (5 từ tem, 3 từ kho — không ghi tay nữa).
create table if not exists kho.phieu_dem_ngay (
  id        uuid primary key default gen_random_uuid(),
  ngay      date not null default current_date,
  ma_to     text not null references kho.to_san_xuat(ma_to),
  hoat_dong text not null check (hoat_dong in ('pu','lot','giuong_lap')),
  so_luong  numeric not null check (so_luong >= 0),
  ma_ns     uuid references kho.nguoi_dung(id),        -- NULL = cả tổ (mặc định); có = một người (chỉ cha_lot/lap_rap/dong_goi)
  ghi_luc   timestamptz not null default now()
);
create index if not exists idx_pdn on kho.phieu_dem_ngay (ngay, hoat_dong);

-- 12. loi_lam_lai — nguồn chất lượng.
create table if not exists kho.loi_lam_lai (
  id         uuid primary key default gen_random_uuid(),
  ngay       date not null default current_date,
  ma_to      text references kho.to_san_xuat(ma_to),
  ma_don     text,
  mon_id     uuid references kho.don_hang_mon(id) on delete set null,
  loai_loi   text,
  so_luong   numeric check (so_luong is null or so_luong >= 0),
  ma_ns_ghi  uuid references kho.nguoi_dung(id)
);

-- ═══════════════ D. ĐƠN GIÁ HOẠT ĐỘNG THỰC ═══════════════
-- 13. luong_to — GIỮ cấu trúc: đơn giá = (lương + overhead + bảo hiểm) ÷ driver.
create table if not exists kho.luong_to (
  ma_ky            text not null,
  ma_to            text not null references kho.to_san_xuat(ma_to),
  luong_to         numeric check (luong_to is null or luong_to >= 0),
  overhead_phan_bo numeric check (overhead_phan_bo is null or overhead_phan_bo >= 0),
  bao_hiem         numeric check (bao_hiem is null or bao_hiem >= 0),
  primary key (ma_ky, ma_to)
);
-- 14. phan_bo_hoat_dong — % thời gian mỗi tổ trên từng hoạt động. Tổng % mỗi tổ 1 kỳ = 100%.
create table if not exists kho.phan_bo_hoat_dong (
  ma_ky              text not null,
  ma_to              text not null references kho.to_san_xuat(ma_to),
  hoat_dong          text not null,
  phan_tram_thoi_gian numeric not null check (phan_tram_thoi_gian >= 0),
  primary key (ma_ky, ma_to, hoat_dong)
);
create or replace function kho.kiem_phan_bo_100() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_ky text; v_to text; v_tong numeric;
begin
  v_ky := coalesce(new.ma_ky, old.ma_ky); v_to := coalesce(new.ma_to, old.ma_to);
  if current_setting('chan.off_100', true) = '1' then return coalesce(new,old); end if;
  select coalesce(sum(phan_tram_thoi_gian),0) into v_tong from kho.phan_bo_hoat_dong where ma_ky=v_ky and ma_to=v_to;
  if abs(v_tong - 100) > 1e-6 then
    raise exception 'Phân bổ tổ "%" kỳ % = %%% (phải = 100%%)', v_to, v_ky, round(v_tong,2);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists trg_phan_bo_100 on kho.phan_bo_hoat_dong;
create constraint trigger trg_phan_bo_100 after insert or update or delete on kho.phan_bo_hoat_dong
  deferrable initially deferred for each row execute function kho.kiem_phan_bo_100();

-- 15. don_gia_hoat_dong_thuc — (lương×% + overhead + bảo hiểm) ÷ mẫu số. Mẫu số: tem -> kho -> phiếu đếm. Thiếu -> NULL+THIẾU.
create or replace function kho.don_gia_hoat_dong_thuc(p_ma_ky text, p_hoat_dong text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_tu numeric; v_mau numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'don_gia_hoat_dong_thuc: chỉ ceo/ke_toan'; end if;
  -- TỬ SỐ: Σ (lương_tổ + overhead + bảo hiểm) × %thời-gian của tổ cho hoạt động này
  select coalesce(sum((coalesce(lt.luong_to,0)+coalesce(lt.overhead_phan_bo,0)+coalesce(lt.bao_hiem,0)) * pb.phan_tram_thoi_gian/100.0),0)
    into v_tu
  from kho.phan_bo_hoat_dong pb join kho.luong_to lt on lt.ma_ky=pb.ma_ky and lt.ma_to=pb.ma_to
  where pb.ma_ky=p_ma_ky and pb.hoat_dong=p_hoat_dong;
  -- MẪU SỐ theo thứ tự: tem -> kho -> phiếu đếm
  begin v_mau := kho.driver_tu_tem(p_ma_ky, p_hoat_dong); exception when others then v_mau := null; end;
  if v_mau is null or v_mau = 0 then begin v_mau := kho.driver_tu_kho(p_ma_ky, p_hoat_dong); exception when others then v_mau := null; end; end if;
  if v_mau is null or v_mau = 0 then
    select sum(so_luong) into v_mau from kho.phieu_dem_ngay
    where hoat_dong=p_hoat_dong and to_char(ngay,'YYYY-MM')=p_ma_ky;
  end if;
  if v_mau is null or v_mau = 0 then
    raise notice 'don_gia_hoat_dong_thuc(%,%): THIẾU mẫu số (không nguồn nào có số) — trả NULL.', p_ma_ky, p_hoat_dong;
    return null;
  end if;
  return round(v_tu / v_mau);
end $$;
grant execute on function kho.don_gia_hoat_dong_thuc(text, text) to authenticated;

-- 16. ty_le_truy_duoc — Σ driver truy về đơn (san_luong_don) ÷ Σ driver tổng (phiếu đếm). + lương truy/không-truy.
create or replace function kho.ty_le_truy_duoc(p_ma_ky text, p_hoat_dong text)
  returns table (ty_le numeric, luong_truy numeric, luong_khong_truy numeric)
  language plpgsql stable security definer set search_path = kho as $$
declare v_truy numeric; v_tong numeric; v_luong numeric; v_r numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'ty_le_truy_duoc: chỉ ceo/ke_toan'; end if;
  -- driver truy về đơn: cột hoạt động trong san_luong_don, cộng theo kỳ (đơn đóng dấu kỳ)
  execute format('select coalesce(sum(s.%I),0) from kho.san_luong_don s join kho.don_hang d on d.ma_don=s.ma_don where d.ma_ky_ap_dung=$1', p_hoat_dong)
    into v_truy using p_ma_ky;
  -- driver TỔNG (mẫu số phủ 100%): tem -> kho -> phiếu đếm
  begin v_tong := kho.driver_tu_tem(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end;
  if v_tong is null or v_tong=0 then begin v_tong := kho.driver_tu_kho(p_ma_ky,p_hoat_dong); exception when others then v_tong := null; end; end if;
  if v_tong is null or v_tong=0 then select sum(so_luong) into v_tong from kho.phieu_dem_ngay where hoat_dong=p_hoat_dong and to_char(ngay,'YYYY-MM')=p_ma_ky; end if;
  if v_tong is null or v_tong=0 then return; end if;   -- không mẫu số -> trả rỗng (THIẾU)
  v_r := round(least(v_truy/v_tong,1.0),4);
  -- LƯƠNG hoạt động = tử số đơn giá (lương×%+oh+bh) của hoạt động
  select coalesce(sum((coalesce(lt.luong_to,0)+coalesce(lt.overhead_phan_bo,0)+coalesce(lt.bao_hiem,0))*pb.phan_tram_thoi_gian/100.0),0)
    into v_luong from kho.phan_bo_hoat_dong pb join kho.luong_to lt on lt.ma_ky=pb.ma_ky and lt.ma_to=pb.ma_to
    where pb.ma_ky=p_ma_ky and pb.hoat_dong=p_hoat_dong;
  ty_le := v_r; luong_truy := round(v_luong*v_r); luong_khong_truy := round(v_luong*(1-v_r));  -- không truy = CHI PHÍ KỲ nhà máy
  return next;
end $$;
grant execute on function kho.ty_le_truy_duoc(text, text) to authenticated;

-- ═══════════════ E. SAN_LUONG_DON (driver plugin truy về đơn — item 18) ═══════════════
create table if not exists kho.san_luong_don (
  ma_don   text primary key references kho.don_hang(ma_don) on delete cascade,
  cat numeric, dan numeric, cam numeric, lot numeric, pu numeric, cup numeric,
  thung numeric, ray numeric, canh numeric, goi numeric, son_canh numeric, giuong_lap numeric,
  ghi_luc  timestamptz not null default now()
);

-- RPC plugin ghi 12 driver truy về đơn (đi kèm đẩy giá vốn). Guard (ceo/kho/thiet_ke) — thiet_ke không có insert policy trực tiếp.
create or replace function kho.ghi_san_luong_don(p_ma_don text, p_drv jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then raise exception 'ghi_san_luong_don: chỉ ceo/kho/thiet_ke'; end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = p_ma_don) then raise exception 'ghi_san_luong_don: không có đơn "%"', p_ma_don; end if;
  insert into kho.san_luong_don(ma_don,cat,dan,cam,lot,pu,cup,thung,ray,canh,goi,son_canh,giuong_lap,ghi_luc)
    values(p_ma_don,(p_drv->>'cat')::numeric,(p_drv->>'dan')::numeric,(p_drv->>'cam')::numeric,(p_drv->>'lot')::numeric,
      (p_drv->>'pu')::numeric,(p_drv->>'cup')::numeric,(p_drv->>'thung')::numeric,(p_drv->>'ray')::numeric,
      (p_drv->>'canh')::numeric,(p_drv->>'goi')::numeric,(p_drv->>'son_canh')::numeric,(p_drv->>'giuong_lap')::numeric, now())
  on conflict (ma_don) do update set cat=excluded.cat,dan=excluded.dan,cam=excluded.cam,lot=excluded.lot,pu=excluded.pu,
    cup=excluded.cup,thung=excluded.thung,ray=excluded.ray,canh=excluded.canh,goi=excluded.goi,son_canh=excluded.son_canh,
    giuong_lap=excluded.giuong_lap,ghi_luc=now();
  return jsonb_build_object('ok',true,'ma_don',p_ma_don);
end $$;
grant execute on function kho.ghi_san_luong_don(text, jsonb) to authenticated;

-- ═══════════════ RLS — xuong/tho ghi phần mình · ceo/ke_toan/xuong đọc · sale/tk_ban_hang/truong KHÔNG ═══════════════
do $$
declare t text;
begin
  foreach t in array array['tem_ban_ve','lan_in_tem','tem_da_in','phieu_dem_ngay','loi_lam_lai','luong_to','phan_bo_hoat_dong','san_luong_don'] loop
    execute format('grant select, insert, update on kho.%I to authenticated', t);
    execute format('revoke all on kho.%I from anon', t);
    execute format('alter table kho.%I enable row level security', t);
    execute format('drop policy if exists %I_doc on kho.%I', t, t);
    execute format($p$create policy %I_doc on kho.%I for select using (kho.current_vai_tro() = any(array['ceo','ke_toan','xuong']))$p$, t, t);
    execute format('drop policy if exists %I_ghi on kho.%I', t, t);
    execute format($p$create policy %I_ghi on kho.%I for insert with check (kho.current_vai_tro() = any(array['ceo','kho','xuong','tho']))$p$, t, t);
    execute format('drop policy if exists %I_sua on kho.%I', t, t);
    execute format($p$create policy %I_sua on kho.%I for update using (kho.current_vai_tro() = any(array['ceo','kho','xuong','tho']))$p$, t, t);
  end loop;
end $$;

-- Storage bucket TEM SVG — PRIVATE, đọc: ceo/kho/xuong/tho/thiet_ke. Ghi: ceo/kho/thiet_ke (plugin).
insert into storage.buckets (id, name, public) values ('tem-svg','tem-svg',false) on conflict (id) do nothing;
drop policy if exists tem_svg_doc on storage.objects;
create policy tem_svg_doc on storage.objects for select
  using (bucket_id='tem-svg' and kho.current_vai_tro() = any(array['ceo','kho','xuong','tho','thiet_ke']));
drop policy if exists tem_svg_ghi on storage.objects;
create policy tem_svg_ghi on storage.objects for insert
  with check (bucket_id='tem-svg' and kho.current_vai_tro() = any(array['ceo','kho','thiet_ke']));

commit;
