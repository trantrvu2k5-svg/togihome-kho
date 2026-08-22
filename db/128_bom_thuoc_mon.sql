-- 128 — BOM THUỘC MÓN (WP-30, QD-50): don_hang_mon_bom · ĐƠN CẤP · gắn don_hang_mon.id (QD-13), KHÔNG thuộc plugin/biến thể.
--   CĂN CỨ: ERP Sagegg&Alfnes §6.2 (dòng BOM = item trong item master → FK vat_tu.id), §6.3.1 (BOM đơn cấp; nhánh cánh/thùng/hộc
--   là phantom ở tầng quy trình — QD-01/MES 4.1 — KHÔNG lặp ở BOM), §6.3.6 (planned/actual → moc du_kien/chuan; thuc_te = sổ
--   giao_dich QD-44), §6.5.2/6.5.3 (BOM chỉ chứa vật tư TRUY ĐƯỢC theo món; vật tư phân xưởng giá trị thấp KHÔNG vào BOM).
--   Dùng ĐÚNG enum bảng số-đơn-vị (db/070): nguon∈{cutlist,go_tay,uoc}, moc∈{du_kien,chuan}, chot_luc+trigger cấm sửa.
--   Plugin đẩy = CAD-to-ERP: KHÔNG GUC riêng — plugin đăng nhập vai thiet_ke/kho/ceo (như ghi_gia_von_don db/034).
--   xoa_demo xoá được BOM demo qua CASCADE (don_hang→don_hang_mon→bom) + trigger bỏ qua khi GUC kho.xoa_demo='1' (db/125).
--   ⚠ IDEMPOTENT: create table/index if not exists · create or replace hàm · drop policy/trigger if exists.
--   KHÔNG nối ban_giao_xuong, KHÔNG chạm ton/giao_dich, KHÔNG sửa plugin, KHÔNG UI (để WP-31/32/33).
-- HOÀN TÁC: drop table kho.don_hang_mon_bom cascade; drop function ghi_bom_mon, bom_don_ds, chan_sua_bom_chot.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · BẢNG ═══════════
create table if not exists kho.don_hang_mon_bom (
  id uuid primary key default gen_random_uuid(),
  mon_id uuid not null references kho.don_hang_mon(id) on delete cascade,
  vat_tu_id uuid not null references kho.vat_tu(id),
  so_luong numeric(14,4) not null check (so_luong > 0),
  don_vi text,                                          -- RPC điền từ vat_tu.dvt khi NULL
  nguon text not null check (nguon in ('cutlist','go_tay','uoc')),   -- ENUM y bảng số-đơn-vị (db/070)
  moc text not null default 'du_kien' check (moc in ('du_kien','chuan')),  -- thuc_te KHÔNG ở BOM (sổ giao_dich, QD-44)
  hoat_dong text references kho.don_gia_baseline(hoat_dong),   -- trạm tiêu hao (nullable); FK cột THẬT 'hoat_dong'
  hao_hut_pct numeric,                                  -- % hao theo dòng — WP-33 điền (QD riêng)
  ghi_chu text,
  chot_luc timestamptz,                                 -- chốt lúc ban_giao_xuong (WP-32) → trigger cấm sửa
  tao_luc timestamptz not null default now(),
  tao_boi uuid references kho.nguoi_dung(id)
);
create unique index if not exists dhmb_uq on kho.don_hang_mon_bom(mon_id, vat_tu_id, nguon, moc, coalesce(hoat_dong,''));
create index if not exists dhmb_idx_mon on kho.don_hang_mon_bom(mon_id);
create index if not exists dhmb_idx_vt  on kho.don_hang_mon_bom(vat_tu_id, moc);   -- WP-42: tra ngược vật tư → món

-- ═══════════ 2 · TRIGGER cấm sửa/xoá dòng ĐÃ CHỐT (mượn cách MOC_CHUAN; bypass qua GUC xoa_demo như db/125) ═══════════
create or replace function kho.chan_sua_bom_chot() returns trigger language plpgsql as $$
begin
  if (tg_op = 'UPDATE' and old.chot_luc is not null) or (tg_op = 'DELETE' and old.chot_luc is not null) then
    if current_setting('kho.xoa_demo', true) = '1' then return coalesce(new, old); end if;   -- chỉ xoa_demo bật được GUC (ceo + đơn demo)
    raise exception 'BOM_DA_CHOT: dòng BOM của món "%" đã chốt (bàn giao xuống xưởng) — không sửa/xoá được', old.mon_id;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_chan_sua_bom_chot on kho.don_hang_mon_bom;
create trigger trg_chan_sua_bom_chot before update or delete on kho.don_hang_mon_bom
  for each row execute function kho.chan_sua_bom_chot();

-- ═══════════ 3 · RLS: đọc = mọi vai đăng nhập; ghi CHỈ qua RPC SecDef ═══════════
alter table kho.don_hang_mon_bom enable row level security;
alter table kho.don_hang_mon_bom force row level security;
drop policy if exists dhmb_doc on kho.don_hang_mon_bom;
create policy dhmb_doc on kho.don_hang_mon_bom for select using (kho.current_vai_tro() is not null);
revoke insert, update, delete on kho.don_hang_mon_bom from anon, authenticated;
grant select on kho.don_hang_mon_bom to authenticated;

-- ═══════════ 4 · RPC ghi_bom_mon — thay TOÀN BỘ dòng du_kien của (mon,nguon) bằng p_dong (idempotent) ═══════════
create or replace function kho.ghi_bom_mon(p_mon_id uuid, p_nguon text, p_dong jsonb)
  returns int language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns();
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dv text; v_hd text; v_dvt text;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'ghi_bom_mon: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'ghi_bom_mon: nguồn phải cutlist/go_tay/uoc'; end if;
  if not exists(select 1 from kho.don_hang_mon where id = p_mon_id) then raise exception 'ghi_bom_mon: món không tồn tại'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where mon_id = p_mon_id and moc = 'chuan') then
    raise exception 'BOM_DA_CHOT: BOM của món đã chốt (mốc chuẩn) — không đẩy lại du_kien được'; end if;
  delete from kho.don_hang_mon_bom where mon_id = p_mon_id and nguon = p_nguon and moc = 'du_kien';  -- thay toàn bộ (plugin đẩy lại được)
  for d in select * from jsonb_array_elements(coalesce(p_dong, '[]'::jsonb)) loop
    v_vt := (d->>'vat_tu_id')::uuid;
    v_sl := (d->>'so_luong')::numeric;
    v_dv := nullif(d->>'don_vi','');
    v_hd := nullif(d->>'hoat_dong','');
    select dvt into v_dvt from kho.vat_tu where id = v_vt;
    if v_dvt is null and not exists(select 1 from kho.vat_tu where id = v_vt) then raise exception 'ghi_bom_mon: vật tư % không tồn tại', coalesce(v_vt::text,'(null)'); end if;
    if v_sl is null or v_sl <= 0 then raise exception 'ghi_bom_mon: dòng % số lượng phải > 0', i+1; end if;
    if v_hd is not null and not exists(select 1 from kho.don_gia_baseline where hoat_dong = v_hd) then
      raise exception 'ghi_bom_mon: hoạt động "%" không có trong don_gia_baseline', v_hd; end if;
    insert into kho.don_hang_mon_bom(mon_id, vat_tu_id, so_luong, don_vi, nguon, moc, hoat_dong, ghi_chu, tao_boi)
      values(p_mon_id, v_vt, v_sl, coalesce(v_dv, v_dvt), p_nguon, 'du_kien', v_hd, nullif(d->>'ghi_chu',''), v_ns);
    i := i + 1;
  end loop;
  return i;
end $$;
revoke all on function kho.ghi_bom_mon(uuid,text,jsonb) from public, anon;
grant execute on function kho.ghi_bom_mon(uuid,text,jsonb) to authenticated;

-- ═══════════ 5 · RPC bom_don_ds — BOM cả đơn theo mốc (mọi nguồn song song + nguon_bom ưu tiên + co_bom) ═══════════
create or replace function kho.bom_don_ds(p_don_id uuid, p_moc text default 'du_kien')
  returns table(mon_id uuid, ten_mon text, vat_tu_id uuid, ma text, ten text, don_vi text, so_luong numeric,
                nguon text, hoat_dong text, chot_luc timestamptz, nguon_bom text, co_bom boolean)
  language plpgsql stable security definer set search_path = kho set jit = 'off' as $$
begin
  if kho.current_vai_tro() is null then raise exception 'bom_don_ds: chưa đăng nhập'; end if;
  if p_moc not in ('du_kien','chuan') then raise exception 'bom_don_ds: mốc phải du_kien/chuan'; end if;
  return query
  select m.id, m.ten, b.vat_tu_id, v.ma, v.ten, b.don_vi, b.so_luong, b.nguon, b.hoat_dong, b.chot_luc,
         -- nguon ưu tiên của MÓN: cutlist > go_tay > uoc (annotation; hàng vẫn trả mọi nguồn song song — QD-15)
         (select case when bool_or(bb.nguon='cutlist') then 'cutlist'
                      when bool_or(bb.nguon='go_tay')  then 'go_tay'
                      when bool_or(bb.nguon='uoc')     then 'uoc' end
          from kho.don_hang_mon_bom bb where bb.mon_id = m.id and bb.moc = p_moc) as nguon_bom,
         (b.id is not null) as co_bom                       -- LEFT JOIN → món chưa có BOM vẫn hiện, co_bom=false
  from kho.don_hang_mon m
  left join kho.don_hang_mon_bom b on b.mon_id = m.id and b.moc = p_moc
  left join kho.vat_tu v on v.id = b.vat_tu_id
  where m.don_id = p_don_id
  order by m.tao_luc, m.id,
    case b.nguon when 'cutlist' then 1 when 'go_tay' then 2 else 3 end nulls last, v.ma nulls last;
end $$;
revoke all on function kho.bom_don_ds(uuid,text) from public, anon;
grant execute on function kho.bom_don_ds(uuid,text) to authenticated;

-- ═══════════ KIỂM SAU MIGRATION ═══════════
do $$ begin
  if to_regclass('kho.don_hang_mon_bom') is null then raise exception 'bảng CHƯA tạo'; end if;
  if to_regprocedure('kho.ghi_bom_mon(uuid,text,jsonb)') is null then raise exception 'ghi_bom_mon CHƯA tạo'; end if;
  if to_regprocedure('kho.bom_don_ds(uuid,text)') is null then raise exception 'bom_don_ds CHƯA tạo'; end if;
  raise notice 'db/128 OK: don_hang_mon_bom (đơn cấp, gắn món) · ghi_bom_mon · bom_don_ds · trigger chốt (bypass xoa_demo).';
end $$;
commit;
