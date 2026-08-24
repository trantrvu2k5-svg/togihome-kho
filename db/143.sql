-- 143 — WP-31 tầng ① (QD-62): nhận BOM chi tiết từ plugin.
--   Đọc: db/128 (bảng BOM + ghi_bom_mon) · db/131 (đơn vị) · db/132 (_bf_tinh/back-flush) · db/134 (QD-55 dòng chờ).
--   ① Hao hụt THEO DÒNG thắng theo mã: _bf_tinh dùng coalesce(b.hao_hut_pct, v.hao_hut_pct, ván?10:0)
--      → dòng ván nesting mang hao=0 xuất đúng số tấm (không ×1,1 hai lần). GIỮ CEIL + mọi thứ QD-54.
--   ② Ván đẩy đúng đơn vị cơ sở ('tam') đã giữ chỗ ngay (ghi_bom_mon: v_ds=v_cs → so_luong_co_so=so_luong) — GIỮ.
--   ③ Dòng chưa ghép mã (vat_tu_id NULL + ma_plugin) → sổ bom_cho_ghep, KHÔNG raise, KHÔNG chặn dòng khác.
--      ghi_bom_mon nhận thêm mỗi phần tử: hao_hut_pct (số, tuỳ chọn) + ma_plugin (text, tuỳ chọn). Chữ ký GIỮ NGUYÊN.
--   IDEMPOTENT: create or replace · create table/index if not exists · drop policy if exists.
--   HOÀN TÁC: drop table bom_cho_ghep cascade; drop function _bom_ghi_dong, bom_cho_ghep_ds, ghep_dong_cho;
--             chạy lại db/128 (ghi_bom_mon) + db/132 (_bf_tinh).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ ① HAO HỤT THEO DÒNG (một dòng đổi trong _bf_tinh) ═══════════
create or replace function kho._bf_tinh(p_mon_id uuid, p_nhom text)
  returns jsonb language plpgsql stable security definer set search_path to 'kho' as $$
declare d record; v_dong jsonb := '[]'::jsonb; v_thieu jsonb := '[]'::jsonb; v_xuat numeric;
begin
  for d in
    select x.vat_tu_id, x.ma, x.ten, x.don_vi_co_so, x.hao_hut_pct,
           sum(x.ket) chuan, bool_or(x.ket is null) co_chua, min(x.don_vi_bom) don_vi_bom
    from (
      select b.vat_tu_id, v.ma, v.ten, v.don_vi_co_so,
        coalesce(b.hao_hut_pct, v.hao_hut_pct, case when kho.la_nhom_van(v.nhom_id) then 10 else 0 end) hao_hut_pct,  -- ① dòng thắng mã
        b.don_vi don_vi_bom,
        case when b.so_luong_co_so is not null then b.so_luong_co_so
             when b.don_vi = v.don_vi_co_so then b.so_luong
             when uu.he_so is not null then b.so_luong * uu.he_so
             else null end ket
      from kho.don_hang_mon_bom b join kho.vat_tu v on v.id=b.vat_tu_id
      left join kho.vat_tu_don_vi uu on uu.vat_tu_id=b.vat_tu_id and uu.don_vi=b.don_vi
      where b.mon_id=p_mon_id and b.moc='chuan'
        and ((p_nhom='van' and kho.la_nhom_van(v.nhom_id)) or (p_nhom='phu_kien' and not kho.la_nhom_van(v.nhom_id)))
    ) x
    group by x.vat_tu_id, x.ma, x.ten, x.don_vi_co_so, x.hao_hut_pct
  loop
    if d.co_chua or d.chuan is null then
      v_thieu := v_thieu || jsonb_build_object('vat_tu_id',d.vat_tu_id,'ma',d.ma,'ten',d.ten,'don_vi_bom',d.don_vi_bom,'don_vi_co_so',d.don_vi_co_so);
    else
      v_xuat := kho.lam_tron_xuat(d.chuan * (1 + d.hao_hut_pct/100), d.don_vi_co_so);   -- GIỮ CEIL (QD-54)
      v_dong := v_dong || jsonb_build_object('vat_tu_id',d.vat_tu_id,'ma',d.ma,'ten',d.ten,'so_luong',v_xuat,'don_vi',d.don_vi_co_so,
        'so_luong_chuan',d.chuan,'hao_hut_pct_ap_dung',d.hao_hut_pct,'so_du_lam_tron', v_xuat - d.chuan*(1+d.hao_hut_pct/100));
    end if;
  end loop;
  return jsonb_build_object('dong', v_dong, 'thieu_he_so', v_thieu);
end $$;

-- ═══════════ ③ SỔ DÒNG CHỜ GHÉP MÃ ═══════════
create table if not exists kho.bom_cho_ghep(
  id            uuid primary key default gen_random_uuid(),
  mon_id        uuid not null references kho.don_hang_mon(id) on delete cascade,
  ma_plugin     text not null,
  mo_ta         text,
  so_luong      numeric not null check (so_luong > 0),
  don_vi_plugin text,
  nguon         text not null check (nguon in ('cutlist','go_tay','uoc')),
  trang_thai    text not null default 'cho' check (trang_thai in ('cho','da_ghep','bo')),
  vat_tu_id     uuid references kho.vat_tu(id),
  tao_luc       timestamptz not null default now(),
  tao_boi       uuid references kho.nguoi_dung(id),
  ghep_luc      timestamptz,
  ghep_boi      uuid references kho.nguoi_dung(id)
);
create unique index if not exists bom_cho_ghep_uq on kho.bom_cho_ghep(mon_id, ma_plugin) where trang_thai='cho';
create index if not exists bom_cho_ghep_mon on kho.bom_cho_ghep(mon_id);
alter table kho.bom_cho_ghep enable row level security;
alter table kho.bom_cho_ghep force row level security;
drop policy if exists bcg_doc on kho.bom_cho_ghep;
create policy bcg_doc on kho.bom_cho_ghep for select
  using (kho.current_vai_tro() in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo'));
grant select on kho.bom_cho_ghep to authenticated;   -- GHI chỉ qua RPC (SecDef), không grant insert/update/delete

-- ═══════════ helper: ghi MỘT dòng BOM (một đường duy nhất — ghi_bom_mon & ghep_dong_cho cùng gọi) ═══════════
create or replace function kho._bom_ghi_dong(p_mon_id uuid, p_vat_tu_id uuid, p_so_luong numeric, p_don_vi text,
    p_nguon text, p_hao numeric, p_hoat_dong text, p_ghi_chu text, p_ns uuid)
  returns void language plpgsql security definer set search_path to 'kho' as $$
declare v_cs text; v_ds text; v_sco numeric; v_hs numeric;
begin
  select don_vi_co_so into v_cs from kho.vat_tu where id = p_vat_tu_id;
  if v_cs is null then raise exception '_bom_ghi_dong: vật tư % không tồn tại', coalesce(p_vat_tu_id::text,'(null)'); end if;
  if p_so_luong is null or p_so_luong <= 0 then raise exception '_bom_ghi_dong: số lượng phải > 0'; end if;
  if p_hoat_dong is not null and not exists(select 1 from kho.don_gia_baseline where hoat_dong = p_hoat_dong) then
    raise exception '_bom_ghi_dong: hoạt động "%" không có trong don_gia_baseline', p_hoat_dong; end if;
  v_ds := coalesce(p_don_vi, v_cs);
  if v_ds = v_cs then v_sco := p_so_luong;   -- ② đúng đơn vị cơ sở → giữ chỗ ngay
  else
    select he_so into v_hs from kho.vat_tu_don_vi where vat_tu_id = p_vat_tu_id and don_vi = v_ds;
    if v_hs is not null then v_sco := p_so_luong * v_hs;
    elsif p_nguon = 'cutlist' then v_sco := null;   -- QD-55: cutlist chờ hệ số (kho nhập sau)
    else raise exception '_bom_ghi_dong: vật tư % không có quy đổi cho đơn vị "%" (nguồn %, QD-53)', p_vat_tu_id, v_ds, p_nguon; end if;
  end if;
  insert into kho.don_hang_mon_bom(mon_id, vat_tu_id, so_luong, don_vi, so_luong_co_so, he_so_ap_dung, nguon, moc, hoat_dong, hao_hut_pct, ghi_chu, tao_boi)
    values(p_mon_id, p_vat_tu_id, p_so_luong, v_ds, v_sco, case when v_sco is null then null else v_sco/p_so_luong end,
           p_nguon, 'du_kien', p_hoat_dong, p_hao, p_ghi_chu, p_ns)
  on conflict (mon_id, vat_tu_id, nguon, moc, coalesce(hoat_dong,'')) do update
    set so_luong=excluded.so_luong, don_vi=excluded.don_vi, so_luong_co_so=excluded.so_luong_co_so,
        he_so_ap_dung=excluded.he_so_ap_dung, hao_hut_pct=excluded.hao_hut_pct, ghi_chu=excluded.ghi_chu, tao_boi=excluded.tao_boi;
end $$;

-- ═══════════ ghi_bom_mon (chữ ký GIỮ NGUYÊN) — thêm hao_hut_pct + ma_plugin + nhánh chờ ghép ═══════════
create or replace function kho.ghi_bom_mon(p_mon_id uuid, p_nguon text, p_dong jsonb)
  returns integer language plpgsql security definer set search_path to 'kho' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns();
  d jsonb; i int := 0; v_vt uuid; v_sl numeric; v_dv text; v_hd text; v_hao numeric; v_map text;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'ghi_bom_mon: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  if p_nguon not in ('cutlist','go_tay','uoc') then raise exception 'ghi_bom_mon: nguồn phải cutlist/go_tay/uoc'; end if;
  if not exists(select 1 from kho.don_hang_mon where id = p_mon_id) then raise exception 'ghi_bom_mon: món không tồn tại'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where mon_id = p_mon_id and moc = 'chuan') then
    raise exception 'BOM_DA_CHOT: BOM của món đã chốt (mốc chuẩn) — không đẩy lại du_kien được'; end if;
  -- DELETE-rồi-GHI cho CẢ BOM lẫn sổ chờ (đẩy lại không cộng dồn, không sinh dòng ma)
  delete from kho.don_hang_mon_bom where mon_id = p_mon_id and nguon = p_nguon and moc = 'du_kien';
  delete from kho.bom_cho_ghep where mon_id = p_mon_id and nguon = p_nguon and trang_thai = 'cho';
  for d in select * from jsonb_array_elements(coalesce(p_dong, '[]'::jsonb)) loop
    v_vt := nullif(d->>'vat_tu_id','')::uuid; v_sl := (d->>'so_luong')::numeric;
    v_dv := nullif(d->>'don_vi',''); v_hd := nullif(d->>'hoat_dong','');
    v_hao := nullif(d->>'hao_hut_pct','')::numeric; v_map := nullif(d->>'ma_plugin','');
    if v_sl is null or v_sl <= 0 then raise exception 'ghi_bom_mon: dòng % số lượng phải > 0', i+1; end if;
    if v_vt is null then
      -- ③ chưa ghép mã → sổ bom_cho_ghep (KHÔNG raise, KHÔNG chặn dòng khác)
      if v_map is null then raise exception 'ghi_bom_mon: dòng % thiếu cả vat_tu_id lẫn ma_plugin', i+1; end if;
      insert into kho.bom_cho_ghep(mon_id, ma_plugin, mo_ta, so_luong, don_vi_plugin, nguon, trang_thai, tao_boi)
        values(p_mon_id, v_map, nullif(d->>'ghi_chu',''), v_sl, v_dv, p_nguon, 'cho', v_ns)
      on conflict (mon_id, ma_plugin) where trang_thai='cho'
        do update set so_luong=excluded.so_luong, don_vi_plugin=excluded.don_vi_plugin, mo_ta=excluded.mo_ta, nguon=excluded.nguon, tao_boi=excluded.tao_boi, tao_luc=now();
    else
      perform kho._bom_ghi_dong(p_mon_id, v_vt, v_sl, v_dv, p_nguon, v_hao, v_hd, nullif(d->>'ghi_chu',''), v_ns);
    end if;
    i := i + 1;
  end loop;
  return i;
end $$;
grant execute on function kho.ghi_bom_mon(uuid,text,jsonb) to authenticated;

-- ═══════════ RPC đọc + ghép ═══════════
create or replace function kho.bom_cho_ghep_ds(p_don_id uuid)
  returns table(id uuid, mon_id uuid, ten_mon text, ma_plugin text, mo_ta text, so_luong numeric,
                don_vi_plugin text, nguon text, trang_thai text, vat_tu_id uuid, tao_luc timestamptz)
  language plpgsql stable security definer set search_path to 'kho' as $$
begin
  if kho.current_vai_tro() is null then raise exception 'bom_cho_ghep_ds: chưa đăng nhập'; end if;
  return query
    select g.id, g.mon_id, m.ten, g.ma_plugin, g.mo_ta, g.so_luong, g.don_vi_plugin, g.nguon, g.trang_thai, g.vat_tu_id, g.tao_luc
    from kho.bom_cho_ghep g join kho.don_hang_mon m on m.id = g.mon_id
    where m.don_id = p_don_id and g.trang_thai = 'cho'
    order by m.ten, g.ma_plugin;
end $$;
grant execute on function kho.bom_cho_ghep_ds(uuid) to authenticated;

create or replace function kho.ghep_dong_cho(p_id uuid, p_vat_tu_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'kho' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); r record;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'ghep_dong_cho: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  select * into r from kho.bom_cho_ghep where id = p_id and trang_thai = 'cho';
  if r.id is null then raise exception 'ghep_dong_cho: dòng chờ không tồn tại hoặc đã xử lý'; end if;
  if not exists(select 1 from kho.vat_tu where id = p_vat_tu_id) then raise exception 'ghep_dong_cho: vật tư không tồn tại'; end if;
  if exists(select 1 from kho.don_hang_mon_bom where mon_id = r.mon_id and moc = 'chuan') then
    raise exception 'BOM_DA_CHOT: BOM của món đã chốt — không ghép thêm được'; end if;
  perform kho._bom_ghi_dong(r.mon_id, p_vat_tu_id, r.so_luong, r.don_vi_plugin, r.nguon, null, null, 'ghép từ '||r.ma_plugin, v_ns);
  update kho.bom_cho_ghep set trang_thai='da_ghep', vat_tu_id=p_vat_tu_id, ghep_luc=now(), ghep_boi=v_ns where id = p_id;
  return jsonb_build_object('ok', true, 'mon_id', r.mon_id, 'ma_plugin', r.ma_plugin, 'vat_tu_id', p_vat_tu_id);
end $$;
grant execute on function kho.ghep_dong_cho(uuid,uuid) to authenticated;

commit;
