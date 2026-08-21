-- 126 — ĐƠN MUA (WP-20): don_mua + don_mua_dong + don_mua_lich_su · 6 trạng thái · cổng RPC 1 đường ghi.
--   CĂN CỨ ERP Sagegg&Alfnes §4.2/4.3.1/4.3.3/4.4: gộp MỘT cột trạng thái (D365 tách 3 ô gây khó theo dõi);
--   cổng đặt ở DB (tinh thần QD-47) — không ai lách. da_nhan/da_khop_hd tạm ceo (WP-21/22 nối sau).
--   Số đơn: dùng cap_so_phieu('DM') → 'DM-2026-0001' (reset theo NĂM; chuoi_so CHƯA reset tháng → NNNN liên tục/năm).
--   IDEMPOTENT: create table if not exists · create or replace hàm · drop policy if exists trước create.
-- HOÀN TÁC: drop table don_mua_lich_su, don_mua_dong, don_mua cascade; drop 5 hàm dm_*.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · BẢNG ═══════════
create table if not exists kho.don_mua (
  id uuid primary key default gen_random_uuid(),
  so_don text not null unique,
  ncc_id uuid not null references kho.nha_cung_cap(id),
  kho_id uuid not null references kho.kho(id),
  ngay_dat date not null default current_date,
  ngay_can date not null,
  ngay_ncc_hen date,
  trang_thai text not null default 'moi' check (trang_thai in ('moi','da_gui','xac_nhan','da_nhan','da_khop_hd','huy')),
  ly_do_huy text,
  ghi_chu text,
  tao_boi uuid,
  tao_luc timestamptz not null default now(),
  cap_nhat_luc timestamptz not null default now()
);
create index if not exists dm_idx_tt   on kho.don_mua(trang_thai);
create index if not exists dm_idx_ncc  on kho.don_mua(ncc_id);
create index if not exists dm_idx_ngay on kho.don_mua(ngay_can);

create table if not exists kho.don_mua_dong (
  id uuid primary key default gen_random_uuid(),
  don_mua_id uuid not null references kho.don_mua(id) on delete restrict,
  stt int not null,
  vat_tu_id uuid not null references kho.vat_tu(id),
  so_luong numeric not null check (so_luong > 0),
  dvt text,
  don_gia numeric not null default 0 check (don_gia >= 0),
  so_luong_da_nhan numeric not null default 0,   -- WP-21 ghi
  ghi_chu text,
  unique (don_mua_id, stt)
);
create index if not exists dmd_idx_don on kho.don_mua_dong(don_mua_id);

create table if not exists kho.don_mua_lich_su (   -- append-only (như giao_dich)
  id uuid primary key default gen_random_uuid(),
  don_mua_id uuid not null references kho.don_mua(id) on delete restrict,
  luc timestamptz not null default now(),
  boi uuid,
  vai text,
  tu_trang_thai text,
  toi_trang_thai text,
  noi_dung jsonb
);
create index if not exists dmls_idx_don on kho.don_mua_lich_su(don_mua_id);

-- lịch sử KHÔNG sửa/xoá
create or replace function kho.dm_ls_append_only() returns trigger language plpgsql as $$
begin raise exception 'don_mua_lich_su: append-only — không UPDATE/DELETE'; end $$;
drop trigger if exists dmls_append_only on kho.don_mua_lich_su;
create trigger dmls_append_only before update or delete on kho.don_mua_lich_su
  for each row execute function kho.dm_ls_append_only();

-- ═══════════ 2 · RLS + grant (chỉ RPC SecDef ghi) ═══════════
alter table kho.don_mua           enable row level security; alter table kho.don_mua           force row level security;
alter table kho.don_mua_dong      enable row level security; alter table kho.don_mua_dong      force row level security;
alter table kho.don_mua_lich_su   enable row level security; alter table kho.don_mua_lich_su   force row level security;
do $$ declare r record; begin
  for r in select unnest(array['don_mua','don_mua_dong','don_mua_lich_su']) as t loop
    execute format('drop policy if exists %I_doc on kho.%I', r.t, r.t);
    execute format($f$create policy %I_doc on kho.%I for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','ke_toan'))$f$, r.t, r.t);
    execute format('revoke insert, update, delete on kho.%I from anon, authenticated', r.t);
    execute format('grant select on kho.%I to authenticated', r.t);
  end loop;
end $$;

-- ═══════════ 3 · RPC (SecDef, schema kho, 1 ĐƯỜNG GHI) ═══════════
-- dm_tao: tạo đơn + dòng. don_gia null → v_gia_tham_khao; không có → 0 + cờ cảnh báo.
create or replace function kho.dm_tao(p_ncc uuid, p_kho uuid default null, p_ngay_can date default null,
    p_ghi_chu text default null, p_dong jsonb default '[]'::jsonb, p_gui_ngay boolean default false)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_id uuid; v_so text; v_kho uuid;
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dg numeric; v_dvt text; v_canh text[] := '{}';
begin
  if v_vai not in ('kho','ceo') then raise exception 'dm_tao: chỉ kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  if p_ncc is null or not exists(select 1 from kho.nha_cung_cap where id=p_ncc) then raise exception 'dm_tao: nhà cung cấp không hợp lệ'; end if;
  if p_dong is null or jsonb_array_length(p_dong) = 0 then raise exception 'dm_tao: đơn phải có ÍT NHẤT MỘT dòng vật tư'; end if;
  v_kho := coalesce(p_kho, (select id from kho.kho where la_mac_dinh limit 1));
  v_so := kho.cap_so_phieu('DM');
  insert into kho.don_mua(so_don, ncc_id, kho_id, ngay_can, ghi_chu, tao_boi)
    values(v_so, p_ncc, v_kho, coalesce(p_ngay_can, current_date), p_ghi_chu, kho.current_ns()) returning id into v_id;
  for d in select * from jsonb_array_elements(p_dong) loop
    i := i + 1;
    v_vt := (d->>'vat_tu_id')::uuid;
    if v_vt is null or not exists(select 1 from kho.vat_tu where id=v_vt) then raise exception 'dm_tao: dòng % — vật tư không hợp lệ', i; end if;
    v_sl := (d->>'so_luong')::numeric;
    if v_sl is null or v_sl <= 0 then raise exception 'dm_tao: dòng % — số lượng phải > 0', i; end if;
    select dvt into v_dvt from kho.vat_tu where id=v_vt;
    v_dg := nullif(d->>'don_gia','')::numeric;
    if v_dg is null then
      select gia_tham_khao into v_dg from kho.v_gia_tham_khao where vat_tu_id=v_vt;
      if v_dg is null then v_dg := 0; v_canh := v_canh || (i::text); end if;
    end if;
    insert into kho.don_mua_dong(don_mua_id, stt, vat_tu_id, so_luong, dvt, don_gia, ghi_chu)
      values(v_id, i, v_vt, v_sl, v_dvt, v_dg, nullif(d->>'ghi_chu',''));
  end loop;
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(v_id, kho.current_ns(), v_vai, null, 'moi', jsonb_build_object('so_dong', i));
  if p_gui_ngay then perform kho.dm_chuyen_trang_thai(v_id, 'da_gui'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'so_don', v_so,
    'canh_bao_gia', case when array_length(v_canh,1) is null then null else 'Dòng '||array_to_string(v_canh,', ')||' KHÔNG có giá tham khảo → đơn giá = 0' end);
end $$;

-- dm_sua_dong: thay TOÀN BỘ dòng; chỉ khi moi/da_gui/xac_nhan; da_gui/xac_nhan ghi diff lich_su.
create or replace function kho.dm_sua_dong(p_id uuid, p_dong jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tt text; v_cu jsonb; v_moi jsonb;
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dg numeric; v_dvt text;
begin
  if v_vai not in ('kho','ceo') then raise exception 'dm_sua_dong: chỉ kho/ceo'; end if;
  select trang_thai into v_tt from kho.don_mua where id=p_id;
  if v_tt is null then raise exception 'dm_sua_dong: đơn không tồn tại'; end if;
  if v_tt not in ('moi','da_gui','xac_nhan') then raise exception 'dm_sua_dong: đơn ở "%" — chỉ sửa dòng khi moi/da_gui/xac_nhan', v_tt; end if;
  if p_dong is null or jsonb_array_length(p_dong) = 0 then raise exception 'dm_sua_dong: phải còn ÍT NHẤT MỘT dòng'; end if;
  select jsonb_agg(jsonb_build_object('stt',stt,'vat_tu_id',vat_tu_id,'so_luong',so_luong,'don_gia',don_gia) order by stt)
    into v_cu from kho.don_mua_dong where don_mua_id=p_id;
  delete from kho.don_mua_dong where don_mua_id=p_id;
  for d in select * from jsonb_array_elements(p_dong) loop
    i := i + 1; v_vt := (d->>'vat_tu_id')::uuid; v_sl := (d->>'so_luong')::numeric;
    if v_vt is null or not exists(select 1 from kho.vat_tu where id=v_vt) then raise exception 'dm_sua_dong: dòng % vật tư không hợp lệ', i; end if;
    if v_sl is null or v_sl <= 0 then raise exception 'dm_sua_dong: dòng % số lượng phải > 0', i; end if;
    select dvt into v_dvt from kho.vat_tu where id=v_vt;
    v_dg := coalesce(nullif(d->>'don_gia','')::numeric, (select gia_tham_khao from kho.v_gia_tham_khao where vat_tu_id=v_vt), 0);
    insert into kho.don_mua_dong(don_mua_id, stt, vat_tu_id, so_luong, dvt, don_gia, ghi_chu)
      values(p_id, i, v_vt, v_sl, v_dvt, v_dg, nullif(d->>'ghi_chu',''));
  end loop;
  update kho.don_mua set cap_nhat_luc=now() where id=p_id;
  -- LUÔN ghi audit sửa dòng (kể cả ở 'moi') — vết chỉnh sửa đơn đầy đủ (robot WP-20 bắt: kịch bản sửa TRƯỚC gửi).
  select jsonb_agg(jsonb_build_object('stt',stt,'vat_tu_id',vat_tu_id,'so_luong',so_luong,'don_gia',don_gia) order by stt)
    into v_moi from kho.don_mua_dong where don_mua_id=p_id;
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(p_id, kho.current_ns(), v_vai, v_tt, v_tt, jsonb_build_object('sua_dong', jsonb_build_object('truoc',v_cu,'sau',v_moi)));
  return jsonb_build_object('ok', true, 'so_dong', i);
end $$;

-- dm_chuyen_trang_thai: CỔNG CỨNG, không lùi.
create or replace function kho.dm_chuyen_trang_thai(p_id uuid, p_toi text, p_ngay_ncc_hen date default null, p_ly_do text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tu text; v_hen date;
  v_hethong boolean := coalesce(current_setting('kho.dm_he_thong', true), '') = '1';   -- GUC chưa set → false (không phải NULL)
  v_n int; v_xau int;
begin
  select trang_thai into v_tu from kho.don_mua where id=p_id for update;
  if v_tu is null then raise exception 'dm_chuyen_trang_thai: đơn không tồn tại'; end if;
  if p_toi = 'da_gui' and v_tu = 'moi' then
    if v_vai not in ('kho','ceo') then raise exception 'dm_chuyen_trang_thai: gửi NCC chỉ kho/ceo'; end if;
    select count(*), count(*) filter (where so_luong <= 0) into v_n, v_xau from kho.don_mua_dong where don_mua_id=p_id;
    if v_n = 0 then raise exception 'dm_chuyen_trang_thai: đơn chưa có dòng — không gửi được'; end if;
    if v_xau > 0 then raise exception 'dm_chuyen_trang_thai: còn dòng số lượng ≤ 0'; end if;
    update kho.don_mua set trang_thai='da_gui', cap_nhat_luc=now() where id=p_id;
  elsif p_toi = 'xac_nhan' and v_tu = 'da_gui' then
    if v_vai not in ('kho','ceo') then raise exception 'dm_chuyen_trang_thai: xác nhận chỉ kho/ceo'; end if;
    v_hen := coalesce(p_ngay_ncc_hen, (select ngay_can from kho.don_mua where id=p_id));
    update kho.don_mua set trang_thai='xac_nhan', ngay_ncc_hen=v_hen, cap_nhat_luc=now() where id=p_id;
  elsif p_toi = 'da_nhan' and v_tu = 'xac_nhan' then
    if not v_hethong and v_vai <> 'ceo' then raise exception 'dm_chuyen_trang_thai: nhận hàng TẠM chỉ ceo (WP-21 sẽ tự động)'; end if;
    update kho.don_mua set trang_thai='da_nhan', cap_nhat_luc=now() where id=p_id;
  elsif p_toi = 'da_khop_hd' and v_tu = 'da_nhan' then
    if not v_hethong and v_vai <> 'ceo' then raise exception 'dm_chuyen_trang_thai: khớp hoá đơn TẠM chỉ ceo (WP-22 sẽ nối)'; end if;
    update kho.don_mua set trang_thai='da_khop_hd', cap_nhat_luc=now() where id=p_id;
  elsif p_toi = 'huy' then
    if v_tu not in ('moi','da_gui','xac_nhan') then raise exception 'dm_chuyen_trang_thai: chỉ huỷ được TRƯỚC khi nhận (moi/da_gui/xac_nhan), đơn đang "%"', v_tu; end if;
    if v_vai not in ('kho','ceo') then raise exception 'dm_chuyen_trang_thai: huỷ chỉ kho/ceo'; end if;
    if coalesce(btrim(p_ly_do),'') = '' then raise exception 'dm_chuyen_trang_thai: huỷ phải có LÝ DO'; end if;
    update kho.don_mua set trang_thai='huy', ly_do_huy=p_ly_do, cap_nhat_luc=now() where id=p_id;
  else
    raise exception 'cổng không cho: %→%', v_tu, p_toi;
  end if;
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(p_id, kho.current_ns(), v_vai, v_tu, p_toi,
           case when p_toi='huy' then jsonb_build_object('ly_do',p_ly_do)
                when p_toi='xac_nhan' then jsonb_build_object('ngay_ncc_hen', v_hen) else null end);
  return jsonb_build_object('ok', true, 'tu', v_tu, 'toi', p_toi);
end $$;

-- dm_danh_sach: 1 dòng/PO + số liệu.
create or replace function kho.dm_danh_sach(p_trang_thai text default null, p_ncc uuid default null, p_tim text default null)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ds jsonb;
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'dm_danh_sach: chỉ kho/ceo/ke_toan'; end if;
  -- lọc TRƯỚC (index trang_thai/ncc + ilike), aggregate dòng bằng LATERAL (index don_mua_id), sort theo cột thật.
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'so_don',b.so_don,'ncc',b.ncc,'ncc_id',b.ncc_id,'kho',b.kho,
      'ngay_dat',b.ngay_dat,'ngay_can',b.ngay_can,'ngay_ncc_hen',b.ngay_ncc_hen,'trang_thai',b.trang_thai,
      'so_dong',b.so_dong,'tam_tinh',b.tam,
      'co_qua_ngay_can', b.trang_thai in ('da_gui','xac_nhan') and coalesce(b.ngay_ncc_hen,b.ngay_can) < current_date)
      order by b.ngay_dat desc, b.so_don), '[]'::jsonb) into v_ds
  from (
    select d.id, d.so_don, n.ten ncc, d.ncc_id, k.ten kho, d.ngay_dat, d.ngay_can, d.ngay_ncc_hen, d.trang_thai,
           dg.so_dong, dg.tam
    from kho.don_mua d join kho.nha_cung_cap n on n.id=d.ncc_id join kho.kho k on k.id=d.kho_id
    left join lateral (select count(*) so_dong, coalesce(sum(so_luong*don_gia),0) tam
                       from kho.don_mua_dong dd where dd.don_mua_id=d.id) dg on true
    where (p_trang_thai is null or d.trang_thai=p_trang_thai)
      and (p_ncc is null or d.ncc_id=p_ncc)
      and (nullif(btrim(coalesce(p_tim,'')),'') is null or d.so_don ilike '%'||p_tim||'%' or n.ten ilike '%'||p_tim||'%')
  ) b;
  return v_ds;
end $$;

-- dm_chi_tiet: đầu đơn + dòng + lịch sử + liên hệ NCC.
create or replace function kho.dm_chi_tiet(p_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v jsonb;
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'dm_chi_tiet: chỉ kho/ceo/ke_toan'; end if;
  select jsonb_build_object(
    'dau_don', (select jsonb_build_object('id',d.id,'so_don',d.so_don,'ncc',n.ten,'ncc_id',d.ncc_id,'kho',k.ten,
        'ngay_dat',d.ngay_dat,'ngay_can',d.ngay_can,'ngay_ncc_hen',d.ngay_ncc_hen,'trang_thai',d.trang_thai,
        'ly_do_huy',d.ly_do_huy,'ghi_chu',d.ghi_chu,
        'tam_tinh',(select coalesce(sum(so_luong*don_gia),0) from kho.don_mua_dong dd where dd.don_mua_id=d.id))
      from kho.don_mua d join kho.nha_cung_cap n on n.id=d.ncc_id join kho.kho k on k.id=d.kho_id where d.id=p_id),
    'lien_he_ncc', (select jsonb_build_object('ten',ten,'dien_thoai',dien_thoai,'dia_chi',dia_chi,'lead_time_ngay',lead_time_ngay)
      from kho.nha_cung_cap n join kho.don_mua d on d.ncc_id=n.id where d.id=p_id),
    'dong', (select coalesce(jsonb_agg(jsonb_build_object('stt',dd.stt,'vat_tu_id',dd.vat_tu_id,'ma',v.ma,'ten',v.ten,
        'so_luong',dd.so_luong,'dvt',dd.dvt,'don_gia',dd.don_gia,'thanh_tien',dd.so_luong*dd.don_gia,
        'so_luong_da_nhan',dd.so_luong_da_nhan,'ghi_chu',dd.ghi_chu) order by dd.stt), '[]'::jsonb)
      from kho.don_mua_dong dd join kho.vat_tu v on v.id=dd.vat_tu_id where dd.don_mua_id=p_id),
    'lich_su', (select coalesce(jsonb_agg(jsonb_build_object('luc',ls.luc,'vai',ls.vai,'boi',u.ho_ten,
        'tu',ls.tu_trang_thai,'toi',ls.toi_trang_thai,'noi_dung',ls.noi_dung) order by ls.luc), '[]'::jsonb)
      from kho.don_mua_lich_su ls left join kho.nguoi_dung u on u.id=ls.boi where ls.don_mua_id=p_id)
  ) into v;
  if v->'dau_don' is null then raise exception 'dm_chi_tiet: đơn không tồn tại'; end if;
  return v;
end $$;

grant execute on function kho.dm_tao(uuid,uuid,date,text,jsonb,boolean) to authenticated;
grant execute on function kho.dm_sua_dong(uuid,jsonb) to authenticated;
grant execute on function kho.dm_chuyen_trang_thai(uuid,text,date,text) to authenticated;
grant execute on function kho.dm_danh_sach(text,uuid,text) to authenticated;
grant execute on function kho.dm_chi_tiet(uuid) to authenticated;

commit;
