-- 037 — ĐO DRIVER TỪ XUẤT KHO: tổ sản xuất + phiếu xuất bắt buộc tổ + mã sơn/nẹp + driver_tu_kho.
--   node ops/run_sql.mjs ../db/037_kho_driver_to_san_xuat.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.driver_tu_kho(text, text);
--   drop function if exists kho.ghi_so_phieu(text,uuid,text,text,jsonb,text);  -- rồi chạy lại bản 5 tham số ở db/032.
--   delete from kho.vat_tu where ma in ('SN-04','SN-05','SN-06');
--   delete from kho.nhom where ten = 'Nẹp cạnh';
--   alter table kho.phieu drop constraint if exists chk_phieu_xuat_ma_to;
--   alter table kho.phieu drop column if exists ma_to;
--   drop table if exists kho.to_san_xuat;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ══════════ 1. TỔ SẢN XUẤT + phiếu xuất bắt buộc tổ ══════════
create table if not exists kho.to_san_xuat (
  ma_to    text primary key,
  ten      text not null,
  so_nguoi integer check (so_nguoi is null or so_nguoi >= 0)
);
insert into kho.to_san_xuat (ma_to, ten, so_nguoi) values
  ('cnc', 'CNC', null), ('dan_canh', 'Dán cạnh', null), ('cha_lot', 'Chà lót', null),
  ('son_pu', 'Sơn PU', null), ('lap_rap', 'Lắp ráp', null), ('dong_goi', 'Đóng gói', null),
  ('giuong', 'Giường', null)
  on conflict (ma_to) do nothing;
grant select on kho.to_san_xuat to authenticated;
revoke all on kho.to_san_xuat from anon;
alter table kho.to_san_xuat enable row level security;
drop policy if exists tsx_doc on kho.to_san_xuat;
create policy tsx_doc on kho.to_san_xuat for select using (kho.current_vai_tro() is not null);  -- mọi vai đăng nhập đọc danh sách tổ (để chọn khi tạo phiếu)

-- phieu.ma_to (NULL được). Phiếu loai='xuat' BẮT BUỘC có tổ; nhap/dieu_chinh không bắt buộc.
alter table kho.phieu add column if not exists ma_to text references kho.to_san_xuat(ma_to);
alter table kho.phieu drop constraint if exists chk_phieu_xuat_ma_to;
alter table kho.phieu add constraint chk_phieu_xuat_ma_to check (loai <> 'xuat' or ma_to is not null);

-- ══════════ 2. Mã sơn (nhóm Sơn) + nhóm Nẹp cạnh ══════════
insert into kho.nhom (id, ten, loai)
  select gen_random_uuid(), 'Nẹp cạnh', 'pk'
  where not exists (select 1 from kho.nhom where ten = 'Nẹp cạnh');
insert into kho.vat_tu (ma, ten, loai, nhom_id, dvt, dvt_goc) values
  ('SN-04', 'Sơn PU màu',  'pk', (select id from kho.nhom where ten = 'Sơn'), 'lít', 'lít'),
  ('SN-05', 'Sơn PU bóng', 'pk', (select id from kho.nhom where ten = 'Sơn'), 'lít', 'lít'),
  ('SN-06', 'Sơn lót',     'pk', (select id from kho.nhom where ten = 'Sơn'), 'lít', 'lít')
  on conflict (ma) do nothing;

-- ══════════ 3. driver_tu_kho(ma_ky, hoat_dong) — suy driver từ XUẤT kho ══════════
--   Σ |so_luong xuất| × so_moi_dvt (so_luong = đơn vị gói túi/hộp; × so_moi_dvt = số cái).
--   pu/lot cần ĐỊNH MỨC PHỦ (m²/lít) — chưa khai -> trả NULL + NOTICE THIẾU, KHÔNG đoán, KHÔNG ra 0.
--   RLS: ceo/ke_toan/xuong. sale KHÔNG.
create or replace function kho.driver_tu_kho(p_ma_ky text, p_hoat_dong text)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_from date; v_to date; v_val numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'driver_tu_kho: chỉ ceo/ke_toan/xuong';
  end if;
  -- pu/lot: cần định mức phủ (m²/lít) — CHƯA có -> THIẾU
  if p_hoat_dong in ('pu','lot') then
    raise notice 'driver_tu_kho(%,%): THIẾU định mức phủ (m²/lít) — chưa suy được từ lít sơn xuất.', p_ma_ky, p_hoat_dong;
    return null;
  end if;
  v_from := to_date(p_ma_ky || '-01', 'YYYY-MM-DD');
  v_to   := (v_from + interval '1 month')::date;
  select coalesce(sum(abs(g.so_luong) * coalesce(v.so_moi_dvt, 1)), 0) into v_val
  from kho.giao_dich g join kho.vat_tu v on v.id = g.vat_tu_id
  where g.loai = 'xuat' and g.tao_luc >= v_from and g.tao_luc < v_to
    and case p_hoat_dong
          when 'cam' then v.ma in ('OV-10','OV-11','OV-12')      -- chốt cam + ốc cam + chốt gỗ
          when 'cup' then v.ma like 'BL-%'                        -- bản lề
          when 'ray' then v.ma like 'RT-%'                        -- ray ngăn kéo
          when 'dan' then v.nhom_id = (select id from kho.nhom where ten = 'Nẹp cạnh')  -- nẹp dán cạnh
          else false
        end;
  if p_hoat_dong not in ('cam','cup','ray','dan') then
    raise notice 'driver_tu_kho(%,%): hoạt động không suy được từ xuất kho.', p_ma_ky, p_hoat_dong;
    return null;
  end if;
  return v_val;
end $$;
grant execute on function kho.driver_tu_kho(text, text) to authenticated;

-- ══════════ 4. ghi_so_phieu NHẬN TỔ (p_ma_to) — phiếu xuất bắt buộc tổ ══════════
--   Body FIFO GIỮ NGUYÊN (byte-identical với bản live); chỉ thêm p_ma_to + set phieu.ma_to + chốt rõ.
drop function if exists kho.ghi_so_phieu(text, uuid, text, text, jsonb);   -- bỏ bản 5 tham số (nhường bản có tổ)
create or replace function kho.ghi_so_phieu(p_loai text, p_ncc uuid, p_ly_do text, p_ghi_chu text, p_dong jsonb,
                                            p_ma_to text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare vt text; sp text; pid uuid; kid uuid; uid uuid; d jsonb;
        vid uuid; sl numeric; dg numeric; cur numeric; curgia numeric; moi numeric; am text[] := '{}';
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được ghi sổ'; end if;
  if p_loai not in ('nhap','xuat') then raise exception 'loai phải nhap/xuat'; end if;
  if p_loai = 'xuat' and p_ma_to is null then raise exception 'Phiếu xuất phải chọn TỔ nhận'; end if;   -- [037] chốt rõ (CHECK cũng chặn)
  select id into kid from kho where la_mac_dinh limit 1;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  sp := cap_so_phieu(case when p_loai='nhap' then 'NK' else 'XK' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,ma_to,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp,p_loai,kid,'ghi_so',p_ncc,p_ly_do,p_ma_to,now(),uid,uid) returning id into pid;
  for d in select * from jsonb_array_elements(p_dong) loop
    vid := (d->>'vat_tu_id')::uuid; sl := (d->>'so_luong')::numeric; dg := nullif(d->>'don_gia','')::numeric;
    if sl is null or sl <= 0 then continue; end if;
    insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do)
      values(pid,vid,sl,dg, case when dg is not null then sl*dg end, p_ncc, p_ly_do);
    select so_luong,gia_von_bq into cur,curgia from ton where vat_tu_id=vid and kho_id=kid;
    if not found then insert into ton(vat_tu_id,kho_id,so_luong) values(vid,kid,0); cur:=0; curgia:=null; end if;
    if p_loai='nhap' then
      moi := cur + sl;
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac)
        values(vid,kid,pid,sl,dg,sl,uid);
      update ton set so_luong=moi, sua_luc=now(),
        gia_von_bq = case when dg is not null then round((coalesce(cur,0)*coalesce(curgia,0)+sl*dg)/nullif(moi,0)) else curgia end
        where vat_tu_id=vid and kho_id=kid;
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,canh_bao,nguoi_thao_tac)
        values(vid,kid,'nhap', sl, pid, moi, 'phieu', case when moi<0 then 'ton_am' end, uid);
    else
      moi := cur - sl;
      update ton set so_luong=moi, sua_luc=now() where vat_tu_id=vid and kho_id=kid;
      declare con numeric := sl; dsau numeric := cur; tru numeric; lg record;
      begin
        for lg in select id, con_lai from lo_nhap
                    where vat_tu_id=vid and kho_id=kid and con_lai > 0 order by tao_luc asc, id asc loop
          exit when con <= 0;
          tru := least(lg.con_lai, con);
          update lo_nhap set con_lai = con_lai - tru where id = lg.id;
          con := con - tru; dsau := dsau - tru;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,lo_nhap_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -tru, pid, lg.id, dsau, 'phieu', uid);
        end loop;
        if con > 0 then
          dsau := dsau - con;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,canh_bao,nguoi_thao_tac)
            values(vid,kid,'xuat', -con, pid, dsau, 'phieu', 'ton_am', uid);
          am := am || vid::text;
        end if;
      end;
    end if;
  end loop;
  return jsonb_build_object('so_phieu', sp, 'ton_am', am);
end $$;
grant execute on function kho.ghi_so_phieu(text, uuid, text, text, jsonb, text) to authenticated;

commit;
