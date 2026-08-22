-- 131 — QUY ĐỔI ĐƠN VỊ THẬT (WP-35, QD-53). ERP Sagegg&Alfnes §3.3.4: mỗi vật tư MỘT đơn vị cơ sở = đơn vị người kho ĐẾM;
--   đơn vị khác quy về cơ sở qua bảng quy đổi; đơn vị cơ sở KHÔNG đổi khi đã có giao dịch. Sổ/tồn/giữ chỗ LUÔN ở đơn vị cơ sở.
--   BOM giữ đơn vị nguồn + thêm so_luong_co_so (đã quy về cơ sở) + he_so_ap_dung (snapshot).
--   ⚠ KHÔNG đụng bảng quy_doi hiện có (map mã plugin — tên sai nhưng đổi = vỡ app, để PHÁT SINH).
--   ⚠ dvt (có dấu) GIỮ NGUYÊN cho hiển thị app; thêm don_vi_co_so (no-dấu, FK don_vi.ma) = chuẩn hoá của dvt (KHÔNG đổi tên dvt → không vỡ app).
--   ⚠ IDEMPOTENT: create if not exists · create or replace · drop constraint/trigger if exists.
-- HOÀN TÁC: khôi phục ~/Downloads/wp35_truoc_db131.sql; drop table vat_tu_don_vi, don_vi cascade;
--   alter table vat_tu drop column don_vi_co_so; alter table don_hang_mon_bom drop column so_luong_co_so, drop column he_so_ap_dung;
--   chạy lại db/128 (ghi_bom_mon/bom_don_ds) + db/130 (ban_giao_xuong/giu_cho_ds).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ A1 · DANH MỤC ĐƠN VỊ ═══════════
create table if not exists kho.don_vi (
  ma text primary key check (ma ~ '^[a-z0-9]+$'),   -- chữ thường, không dấu, không khoảng trắng
  ten text not null
);
insert into kho.don_vi(ma,ten) values
 ('tam','tấm'),('m','mét'),('m2','mét vuông'),('cai','cái'),('bo','bộ'),('kg','kg'),
 ('lit','lít'),('cuon','cuộn'),('hop','hộp'),('tui','túi'),('lo','lọ'),('thanh','thanh')
 on conflict (ma) do nothing;
alter table kho.don_vi enable row level security; alter table kho.don_vi force row level security;
drop policy if exists don_vi_doc on kho.don_vi;
create policy don_vi_doc on kho.don_vi for select using (kho.current_vai_tro() is not null);
revoke insert,update,delete on kho.don_vi from anon, authenticated; grant select on kho.don_vi to authenticated;

-- ═══════════ A1b · chuẩn hoá tên đơn vị (dùng chung backfill + trigger) ═══════════
create or replace function kho.chuan_don_vi(p text) returns text language sql immutable as $cdv$
  select case btrim(coalesce(p,''))
    when 'cái' then 'cai' when 'tấm' then 'tam' when 'túi' then 'tui' when 'bộ' then 'bo'
    when 'cuộn' then 'cuon' when 'hộp' then 'hop' when 'lọ' then 'lo' when 'thanh' then 'thanh'
    when 'lít' then 'lit' when 'mét' then 'm' when 'mét vuông' then 'm2'
    when 'cai' then 'cai' when 'tam' then 'tam' when 'tui' then 'tui' when 'bo' then 'bo'
    when 'cuon' then 'cuon' when 'hop' then 'hop' when 'lo' then 'lo' when 'lit' then 'lit'
    when 'm' then 'm' when 'm2' then 'm2' when 'kg' then 'kg' else null end
$cdv$;

-- ═══════════ A2 · vat_tu.don_vi_co_so (chuẩn hoá từ dvt; dvt giữ cho hiển thị) ═══════════
alter table kho.vat_tu add column if not exists don_vi_co_so text;
update kho.vat_tu set don_vi_co_so = coalesce(kho.chuan_don_vi(dvt), 'cai')
 where don_vi_co_so is null;   -- OV-33 dvt rỗng / lạ → 'cai' [GĐ]
-- trigger: vat_tu MỚI (app/test) tự điền don_vi_co_so từ dvt (đường origin); NOT NULL không vỡ test cũ
create or replace function kho.vat_tu_fill_co_so() returns trigger language plpgsql as $vf$
begin if new.don_vi_co_so is null then new.don_vi_co_so := coalesce(kho.chuan_don_vi(new.dvt), 'cai'); end if; return new; end $vf$;
drop trigger if exists trg_vat_tu_fill_co_so on kho.vat_tu;
create trigger trg_vat_tu_fill_co_so before insert on kho.vat_tu for each row execute function kho.vat_tu_fill_co_so();
do $$ begin
  if exists(select 1 from kho.vat_tu where don_vi_co_so is null) then
    raise exception 'WP35: còn vat_tu chưa map don_vi_co_so: %', (select string_agg(ma,', ') from kho.vat_tu where don_vi_co_so is null); end if;
end $$;
alter table kho.vat_tu alter column don_vi_co_so set not null;
alter table kho.vat_tu drop constraint if exists vat_tu_don_vi_co_so_fk;
alter table kho.vat_tu add constraint vat_tu_don_vi_co_so_fk foreign key (don_vi_co_so) references kho.don_vi(ma);
comment on column kho.vat_tu.don_vi_co_so is 'WP-35/QD-53: đơn vị CƠ SỞ = đơn vị đếm trong kho (no-dấu, FK don_vi.ma). Sổ/tồn/giữ chỗ luôn ở đơn vị này. dvt giữ cho hiển thị.';

-- ═══════════ A3 · vat_tu_don_vi (quy đổi theo vật tư) ═══════════
create table if not exists kho.vat_tu_don_vi (
  vat_tu_id uuid not null references kho.vat_tu(id) on delete cascade,
  don_vi text not null references kho.don_vi(ma),
  he_so numeric(18,6) not null check (he_so > 0),   -- 1 [don_vi] = he_so × [don_vi_co_so]
  primary key (vat_tu_id, don_vi)
);
create or replace function kho.vtdv_khong_tu_quy_doi() returns trigger language plpgsql as $$
begin
  if new.don_vi = (select don_vi_co_so from kho.vat_tu where id = new.vat_tu_id) then
    raise exception 'WP35: "%" là đơn vị cơ sở của vật tư — không tự quy đổi', new.don_vi; end if;
  return new;
end $$;
drop trigger if exists trg_vtdv_khong_tu on kho.vat_tu_don_vi;
create trigger trg_vtdv_khong_tu before insert or update on kho.vat_tu_don_vi for each row execute function kho.vtdv_khong_tu_quy_doi();
alter table kho.vat_tu_don_vi enable row level security; alter table kho.vat_tu_don_vi force row level security;
drop policy if exists vtdv_doc on kho.vat_tu_don_vi;
create policy vtdv_doc on kho.vat_tu_don_vi for select using (kho.current_vai_tro() is not null);
revoke insert,update,delete on kho.vat_tu_don_vi from anon, authenticated; grant select on kho.vat_tu_don_vi to authenticated;

-- ═══════════ A4 · quy_ve_co_so (không làm tròn, không đoán) ═══════════
create or replace function kho.quy_ve_co_so(p_vat_tu uuid, p_don_vi text, p_so_luong numeric)
  returns numeric language plpgsql stable security definer set search_path = kho as $$
declare v_cs text; v_hs numeric;
begin
  select don_vi_co_so into v_cs from kho.vat_tu where id = p_vat_tu;
  if v_cs is null then raise exception 'WP35: vật tư % không tồn tại/không có đơn vị cơ sở', p_vat_tu; end if;
  if p_don_vi = v_cs then return p_so_luong; end if;
  select he_so into v_hs from kho.vat_tu_don_vi where vat_tu_id = p_vat_tu and don_vi = p_don_vi;
  if v_hs is null then raise exception 'WP35: vật tư % không có quy đổi cho đơn vị %', p_vat_tu, p_don_vi; end if;
  return p_so_luong * v_hs;
end $$;
grant execute on function kho.quy_ve_co_so(uuid,text,numeric) to authenticated;

-- ═══════════ A5 · KHOÁ đơn vị cơ sở khi đã có sổ/giữ chỗ/BOM chuẩn/lô ═══════════
create or replace function kho.chan_doi_don_vi_co_so() returns trigger language plpgsql as $$
begin
  if new.don_vi_co_so is distinct from old.don_vi_co_so then
    if exists(select 1 from kho.giao_dich where vat_tu_id=old.id)
       or exists(select 1 from kho.giu_cho where vat_tu_id=old.id)
       or exists(select 1 from kho.don_hang_mon_bom where vat_tu_id=old.id and moc='chuan')
       or exists(select 1 from kho.lo_nhap where vat_tu_id=old.id) then
      raise exception 'WP35: vật tư % đã có sổ/giữ chỗ/BOM chuẩn/lô — không đổi được đơn vị cơ sở (ERP 3.3.4)', old.ma; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_chan_doi_don_vi_co_so on kho.vat_tu;
create trigger trg_chan_doi_don_vi_co_so before update of don_vi_co_so on kho.vat_tu for each row execute function kho.chan_doi_don_vi_co_so();

-- ═══════════ A6 · don_hang_mon_bom + so_luong_co_so + he_so_ap_dung ═══════════
alter table kho.don_hang_mon_bom add column if not exists so_luong_co_so numeric;
alter table kho.don_hang_mon_bom add column if not exists he_so_ap_dung numeric;
-- backfill: 0 dòng hiện tại (PHA 0). Dòng nào don_vi = cơ sở → so_luong_co_so=so_luong, he_so=1.
update kho.don_hang_mon_bom set so_luong_co_so = so_luong, he_so_ap_dung = 1 where so_luong_co_so is null;
alter table kho.don_hang_mon_bom alter column so_luong_co_so set not null;
alter table kho.don_hang_mon_bom drop constraint if exists dhmb_don_vi_fk;   -- KHÔNG FK: don_vi nguồn để mở; đường THẬT ghi_bom_mon strict qua quy_ve_co_so
-- trigger auto-fill so_luong_co_so/he_so khi NULL (đường trực tiếp/fixture); ghi_bom_mon đã set sẵn nên no-op
create or replace function kho.bom_fill_co_so() returns trigger language plpgsql security definer set search_path=kho as $fill$
begin
  if new.so_luong_co_so is null then
    begin
      new.so_luong_co_so := kho.quy_ve_co_so(new.vat_tu_id, coalesce(new.don_vi, (select don_vi_co_so from kho.vat_tu where id=new.vat_tu_id)), new.so_luong);
    exception when others then new.so_luong_co_so := new.so_luong; end;   -- đơn vị lạ đường trực tiếp → identity (đường thật strict)
  end if;
  if new.he_so_ap_dung is null and coalesce(new.so_luong,0) <> 0 then new.he_so_ap_dung := new.so_luong_co_so / new.so_luong; end if;
  return new;
end $fill$;
drop trigger if exists trg_bom_fill_co_so on kho.don_hang_mon_bom;
create trigger trg_bom_fill_co_so before insert on kho.don_hang_mon_bom for each row execute function kho.bom_fill_co_so();

-- ═══════════ A7 · COMMENT: sổ luôn đơn vị cơ sở (không cột don_vi → không cần trigger) ═══════════
comment on table  kho.giao_dich          is 'so_luong LUÔN ở vat_tu.don_vi_co_so (WP-35)';
comment on table  kho.giu_cho            is 'so_luong_giu/so_luong_da_xuat LUÔN ở vat_tu.don_vi_co_so (WP-35)';
comment on column kho.phieu_dong.so_luong    is 'LUÔN ở vat_tu.don_vi_co_so (WP-35); phieu_dong không có cột đơn vị';
comment on column kho.lo_nhap.so_luong_nhap  is 'LUÔN ở vat_tu.don_vi_co_so (WP-35)';
comment on column kho.don_mua_dong.dvt       is 'đơn vị MUA (có thể ≠ cơ sở) — quy đổi khi nhận là WP-22/23 (PHÁT SINH)';

-- ═══════════ A8 · RPC ghi/xoá quy đổi ═══════════
create or replace function kho.vat_tu_don_vi_ghi(p_vat_tu uuid, p_don_vi text, p_he_so numeric)
  returns void language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo') then raise exception 'vat_tu_don_vi_ghi: chỉ kho/ceo'; end if;
  if not exists(select 1 from kho.don_vi where ma=p_don_vi) then raise exception 'WP35: đơn vị "%" chưa đăng ký trong don_vi', p_don_vi; end if;
  insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values(p_vat_tu,p_don_vi,p_he_so)
    on conflict (vat_tu_id,don_vi) do update set he_so = excluded.he_so;
end $$;
create or replace function kho.vat_tu_don_vi_xoa(p_vat_tu uuid, p_don_vi text)
  returns void language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo') then raise exception 'vat_tu_don_vi_xoa: chỉ kho/ceo'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where vat_tu_id=p_vat_tu and don_vi=p_don_vi and moc='chuan') then
    raise exception 'WP35: còn BOM chuẩn dùng đơn vị "%" — không xoá quy đổi', p_don_vi; end if;
  delete from kho.vat_tu_don_vi where vat_tu_id=p_vat_tu and don_vi=p_don_vi;
end $$;
revoke all on function kho.vat_tu_don_vi_ghi(uuid,text,numeric) from anon;
revoke all on function kho.vat_tu_don_vi_xoa(uuid,text) from anon;
grant execute on function kho.vat_tu_don_vi_ghi(uuid,text,numeric) to authenticated;
grant execute on function kho.vat_tu_don_vi_xoa(uuid,text) to authenticated;

-- ═══════════ A9 · SEED quy đổi thật: KHÔNG (vat_tu không có cột dài/rộng → không tính m2→tấm). Xem GIẢ ĐỊNH báo cáo. ═══════════

-- ═══════════ B1 · ghi_bom_mon: quy về cơ sở + snapshot hệ số ═══════════
create or replace function kho.ghi_bom_mon(p_mon_id uuid, p_nguon text, p_dong jsonb)
  returns integer language plpgsql security definer set search_path = kho as $function$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns();
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dv text; v_hd text; v_cs text; v_ds text; v_sco numeric;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'ghi_bom_mon: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'ghi_bom_mon: nguồn phải cutlist/go_tay/uoc'; end if;
  if not exists(select 1 from kho.don_hang_mon where id = p_mon_id) then raise exception 'ghi_bom_mon: món không tồn tại'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where mon_id = p_mon_id and moc = 'chuan') then
    raise exception 'BOM_DA_CHOT: BOM của món đã chốt (mốc chuẩn) — không đẩy lại du_kien được'; end if;
  delete from kho.don_hang_mon_bom where mon_id = p_mon_id and nguon = p_nguon and moc = 'du_kien';
  for d in select * from jsonb_array_elements(coalesce(p_dong, '[]'::jsonb)) loop
    v_vt := (d->>'vat_tu_id')::uuid;
    v_sl := (d->>'so_luong')::numeric;
    v_dv := nullif(d->>'don_vi','');
    v_hd := nullif(d->>'hoat_dong','');
    select don_vi_co_so into v_cs from kho.vat_tu where id = v_vt;
    if v_cs is null then raise exception 'ghi_bom_mon: vật tư % không tồn tại', coalesce(v_vt::text,'(null)'); end if;
    if v_sl is null or v_sl <= 0 then raise exception 'ghi_bom_mon: dòng % số lượng phải > 0', i+1; end if;
    if v_hd is not null and not exists(select 1 from kho.don_gia_baseline where hoat_dong = v_hd) then
      raise exception 'ghi_bom_mon: hoạt động "%" không có trong don_gia_baseline', v_hd; end if;
    v_ds := coalesce(v_dv, v_cs);                    -- đơn vị nguồn: caller khai (no-dấu, don_vi.ma) hoặc = cơ sở
    v_sco := kho.quy_ve_co_so(v_vt, v_ds, v_sl);     -- đơn vị lạ/không quy đổi → RAISE → cả RPC rollback (atomic)
    insert into kho.don_hang_mon_bom(mon_id, vat_tu_id, so_luong, don_vi, so_luong_co_so, he_so_ap_dung, nguon, moc, hoat_dong, ghi_chu, tao_boi)
      values(p_mon_id, v_vt, v_sl, v_ds, v_sco, v_sco / v_sl, p_nguon, 'du_kien', v_hd, nullif(d->>'ghi_chu',''), v_ns);
    i := i + 1;
  end loop;
  return i;
end $function$;
revoke all on function kho.ghi_bom_mon(uuid,text,jsonb) from public, anon;
grant execute on function kho.ghi_bom_mon(uuid,text,jsonb) to authenticated;

-- ═══════════ B4 · bom_don_ds + so_luong_co_so/don_vi_co_so · giu_cho_ds + don_vi_co_so ═══════════
drop function if exists kho.bom_don_ds(uuid,text);
create or replace function kho.bom_don_ds(p_don_id uuid, p_moc text default 'du_kien')
  returns table(mon_id uuid, ten_mon text, vat_tu_id uuid, ma text, ten text, don_vi text, so_luong numeric,
                so_luong_co_so numeric, don_vi_co_so text, nguon text, hoat_dong text, chot_luc timestamptz, nguon_bom text, co_bom boolean)
  language plpgsql stable security definer set search_path = kho set jit = 'off' as $function$
begin
  if kho.current_vai_tro() is null then raise exception 'bom_don_ds: chưa đăng nhập'; end if;
  if p_moc not in ('du_kien','chuan') then raise exception 'bom_don_ds: mốc phải du_kien/chuan'; end if;
  return query
  select m.id, m.ten, b.vat_tu_id, v.ma, v.ten, b.don_vi, b.so_luong, b.so_luong_co_so, v.don_vi_co_so, b.nguon, b.hoat_dong, b.chot_luc,
         (select case when bool_or(bb.nguon='cutlist') then 'cutlist' when bool_or(bb.nguon='go_tay') then 'go_tay' when bool_or(bb.nguon='uoc') then 'uoc' end
          from kho.don_hang_mon_bom bb where bb.mon_id = m.id and bb.moc = p_moc) as nguon_bom,
         (b.id is not null) as co_bom
  from kho.don_hang_mon m
  left join kho.don_hang_mon_bom b on b.mon_id = m.id and b.moc = p_moc
  left join kho.vat_tu v on v.id = b.vat_tu_id
  where m.don_id = p_don_id
  order by m.tao_luc, m.id, case b.nguon when 'cutlist' then 1 when 'go_tay' then 2 else 3 end nulls last, v.ma nulls last;
end $function$;
revoke all on function kho.bom_don_ds(uuid,text) from public, anon; grant execute on function kho.bom_don_ds(uuid,text) to authenticated;

drop function if exists kho.giu_cho_ds(uuid);
create or replace function kho.giu_cho_ds(p_don_hang_id uuid)
  returns table(id uuid, mon_id uuid, ten_mon text, vat_tu_id uuid, ma text, ten text, so_luong_giu numeric,
                so_luong_da_xuat numeric, don_vi_co_so text, trang_thai text, nguon text, kho_id uuid)
  language plpgsql stable security definer set search_path = kho set jit='off' as $function$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('kho','ceo','xuong','thiet_ke') then raise exception 'giu_cho_ds: chỉ kho/ceo/xuong/thiet_ke'; end if;
  return query
  select g.id, g.don_hang_mon_id, m.ten, g.vat_tu_id, v.ma, v.ten, g.so_luong_giu, g.so_luong_da_xuat, v.don_vi_co_so, g.trang_thai, b.nguon, g.kho_id
  from kho.giu_cho g
  left join kho.don_hang_mon m on m.id = g.don_hang_mon_id
  left join kho.vat_tu v on v.id = g.vat_tu_id
  left join kho.don_hang_mon_bom b on b.id = g.don_hang_mon_bom_id
  where g.don_hang_id = p_don_hang_id
  order by g.trang_thai, m.tao_luc, v.ma;
end $function$;
revoke all on function kho.giu_cho_ds(uuid) from public, anon; grant execute on function kho.giu_cho_ds(uuid) to authenticated;

-- ═══════════ B2 · ban_giao_xuong: giữ chỗ = so_luong_co_so · vat_tu_thieu kèm don_vi (copy db/130 + vá) ═══════════
CREATE OR REPLACE FUNCTION kho.ban_giao_xuong(p_ma_don text, p_danh_sach jsonb, p_ghi_chu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
declare v_vai text; v_ns uuid; v_don kho.don_hang; v_le_mau boolean;
  v_chua_gan text; v_thieu_so text; v_miss int; f jsonb; n int := 0; v_kho uuid; v_giu_moi int := 0; v_mon_thieu jsonb; v_vt_thieu jsonb;
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

  -- CHỐT-COMPLETE: mọi dòng chuan chép được ĐỦ phút + đơn giá? Thiếu → CHẶN cả bàn giao (KHÔNG chốt một phần)
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

  for f in select * from jsonb_array_elements(p_danh_sach) loop
    insert into kho.file_san_xuat(ma_don, loai_file, duong_dan, ten_goc, co_byte, ma_ns_gui, ghi_chu)
      values (p_ma_don, coalesce(f->>'loai_file','khac'), f->>'duong_dan', f->>'ten_goc', (f->>'co_byte')::bigint, v_ns, p_ghi_chu);
    n := n + 1;
  end loop;
  update kho.don_hang set buoc_thiet_ke = 'xong_file' where id = v_don.id;
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat' where id = v_don.id;
  perform set_config('chan.tu_mon','0',true);

  -- CHỐT: đóng băng SỐ + PHÚT + ĐƠN GIÁ (chép từ quy_trinh_buoc + don_gia_baseline HIỆN TẠI)
  --   dùng subquery tương quan theo s (UPDATE...FROM không cho tham chiếu s trong JOIN ON)
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
  -- ═══ WP-32 (ERP 3.3.7): đóng băng BOM du_kien→chuan + sinh GIỮ CHỖ mềm (KHÔNG trừ tồn, KHÔNG gắn lô) ═══
  select id into v_kho from kho.kho where la_mac_dinh limit 1;
  -- (i) BOM du_kien → chuan (đóng băng); trigger db/128 CHO PHÉP vì old.chot_luc còn NULL
  update kho.don_hang_mon_bom b set moc = 'chuan', chot_luc = now()
    where b.moc = 'du_kien' and b.chot_luc is null
      and b.mon_id in (select id from kho.don_hang_mon where don_id = v_don.id);
  -- (ii) mỗi dòng BOM chuan → 1 giữ chỗ (kho xưởng mặc định); bàn giao lần 2 vô hại nhờ UNIQUE(bom_id) WHERE mo
  with ins as (
    insert into kho.giu_cho(don_hang_id, don_hang_mon_id, don_hang_mon_bom_id, vat_tu_id, kho_id, so_luong_giu, tao_boi)
    select v_don.id, b.mon_id, b.id, b.vat_tu_id, v_kho, b.so_luong_co_so, v_ns
    from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id = b.mon_id
    where m.don_id = v_don.id and b.moc = 'chuan'
    on conflict (don_hang_mon_bom_id) where trang_thai = 'mo' do nothing
    returning 1)
  select count(*) into v_giu_moi from ins;
  -- (iii) món KHÔNG có dòng BOM chuan → cảnh báo mon_thieu_bom (KHÔNG chặn bàn giao)
  select coalesce(jsonb_agg(jsonb_build_object('mon_id', m.id, 'ten', m.ten)), '[]'::jsonb) into v_mon_thieu
    from kho.don_hang_mon m
    where m.don_id = v_don.id and not exists (select 1 from kho.don_hang_mon_bom b where b.mon_id = m.id and b.moc = 'chuan');
  -- (iv) khả dụng âm sau giữ chỗ → báo vat_tu_thieu (KHÔNG chặn — chờ hàng về, ERP 3.3.7; chặn là việc WP-42)
  select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id', x.vat_tu_id, 'thieu', round(-x.kd, 4), 'don_vi', (select don_vi_co_so from kho.vat_tu where id=x.vat_tu_id))), '[]'::jsonb) into v_vt_thieu
    from (
      select v.vat_tu_id, coalesce(t.so_luong,0) - coalesce(g.giu,0) kd
      from (select distinct vat_tu_id from kho.giu_cho where don_hang_id = v_don.id and trang_thai='mo') v
      left join kho.ton t on t.vat_tu_id = v.vat_tu_id and t.kho_id = v_kho
      left join (select vat_tu_id, sum(so_luong_giu - so_luong_da_xuat) giu from kho.giu_cho where kho_id = v_kho and trang_thai='mo' group by vat_tu_id) g on g.vat_tu_id = v.vat_tu_id
    ) x where x.kd < 0;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'so_file', n, 'tu', v_don.trang_thai, 'den', 'cho_cat',
    'mon_thieu_bom', coalesce(v_mon_thieu,'[]'::jsonb), 'vat_tu_thieu', coalesce(v_vt_thieu,'[]'::jsonb), 'giu_cho_moi', v_giu_moi);
end $function$;
grant execute on function kho.ban_giao_xuong(text, jsonb, text) to authenticated;

-- ═══════════ KIỂM ═══════════
do $$ begin
  if to_regclass('kho.don_vi') is null or to_regclass('kho.vat_tu_don_vi') is null then raise exception 'bảng WP-35 CHƯA tạo'; end if;
  if to_regprocedure('kho.quy_ve_co_so(uuid,text,numeric)') is null then raise exception 'quy_ve_co_so CHƯA tạo'; end if;
  if exists(select 1 from kho.vat_tu where don_vi_co_so is null) then raise exception 'còn vat_tu thiếu don_vi_co_so'; end if;
  raise notice 'db/131 OK: don_vi + vat_tu_don_vi + quy_ve_co_so + khoá đơn vị cơ sở + BOM so_luong_co_so + RPC quy về cơ sở.';
end $$;
commit;
