-- 135 — HOÁ ĐƠN NCC + KHỚP 3 CHIỀU + PHIẾU CHI + CÔNG NỢ PHẢI TRẢ (WP-22, QD-57).
--   CĂN CỨ ERP Sagegg&Alfnes §4.4 (3-way match: PO ↔ phiếu nhận ↔ hoá đơn) + §3.3.8 (giá vốn cập nhật theo hoá đơn) +
--     QD-40 (dòng tiền khép vòng) + QD-30 (VAT: đơn giá HĐ chưa VAT → giá vốn; tổng gồm VAT → công nợ/dòng tiền).
--   KHỚP: SL HĐ ≤ SL đã nhận (CHẶN) · lệch giá GHI không chặn · giá LÔ SỐNG đổi theo HĐ · đơn → da_khop_hd khi HĐ phủ hết
--     SL đã nhận VÀ mọi dòng nhận đủ đặt. Công nợ = Σ HĐ gồm VAT − Σ phiếu chi (TÍNH, không bảng). 1 HĐ ↔ 1 đơn mua [v1].
--   ⚠ LÔ lưu theo ĐƠN VỊ DÒNG đơn mua (WP-21 chưa quy về cơ sở — nợ WP-23); don_gia_hd cũng theo đơn vị dòng → gia_von_lo =
--     don_gia_hd TRỰC TIẾP (KHÔNG quy_ve_co_so: hàm đó quy đổi SỐ LƯỢNG, không quy GIÁ; quy giá về cơ sở sẽ lệch đơn vị với
--     so_luong_nhap của lô). Khi WP-23 đưa lô về cơ sở thì mới cần quy đổi giá.
--   ⚠ IDEMPOTENT: create table if not exists · create or replace · drop policy/trigger if exists.
-- HOÀN TÁC: drop table phieu_chi_ncc, hoa_don_ncc_dong, hoa_don_ncc cascade; drop các hàm hd_ncc_*/pc_*/con_phai_tra/
--   tinh_lai_gia_von_bq; chạy lại db/119 (gd_cap_nhat_ton bản inline) + db/126 (dm_chuyen_trang_thai không nhánh lùi) + db/116 (dong_tien_ky).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · BẢNG ═══════════
create table if not exists kho.hoa_don_ncc (
  id uuid primary key default gen_random_uuid(),
  so_hd text not null,
  loai_chung_tu text not null check (loai_chung_tu in ('hoa_don_vat','bang_ke')),
  ncc_id uuid not null references kho.nha_cung_cap(id),
  don_mua_id uuid not null references kho.don_mua(id),
  ngay_hd date not null default current_date,
  han_thanh_toan date not null,
  vat_pct numeric not null default 0 check (vat_pct in (0,5,8,10)),
  tong_chua_vat numeric not null default 0,
  tong_vat numeric not null default 0,
  tong_gom_vat numeric not null default 0,
  ghi_chu text,
  la_demo boolean not null default false,
  tao_boi uuid,
  tao_luc timestamptz not null default now(),
  da_xoa_luc timestamptz
);
create unique index if not exists hdn_uq_ncc_sohd on kho.hoa_don_ncc(ncc_id, so_hd) where da_xoa_luc is null;
create index if not exists hdn_idx_don on kho.hoa_don_ncc(don_mua_id);
create index if not exists hdn_idx_ncc on kho.hoa_don_ncc(ncc_id) where da_xoa_luc is null;
create index if not exists hdn_idx_han on kho.hoa_don_ncc(han_thanh_toan) where da_xoa_luc is null;

create table if not exists kho.hoa_don_ncc_dong (
  id uuid primary key default gen_random_uuid(),
  hoa_don_ncc_id uuid not null references kho.hoa_don_ncc(id) on delete cascade,
  don_mua_dong_id uuid not null references kho.don_mua_dong(id),
  so_luong numeric not null check (so_luong > 0),   -- đơn vị = đơn vị dòng đơn mua
  don_gia_hd numeric not null default 0,             -- CHƯA VAT, theo đơn vị dòng
  don_gia_don numeric not null default 0,            -- snapshot đơn giá dòng đơn lúc ghi HĐ
  lech_don_gia numeric not null default 0,           -- = don_gia_hd − don_gia_don
  thanh_tien numeric not null default 0
);
create index if not exists hdnd_idx_hd  on kho.hoa_don_ncc_dong(hoa_don_ncc_id);
create index if not exists hdnd_idx_dong on kho.hoa_don_ncc_dong(don_mua_dong_id);

create table if not exists kho.phieu_chi_ncc (
  id bigserial primary key,
  ngay_chi date not null default current_date,
  ncc_id uuid not null references kho.nha_cung_cap(id),
  hoa_don_ncc_id uuid references kho.hoa_don_ncc(id),   -- NULL = trả trước/ứng
  so_tien numeric not null check (so_tien > 0),          -- GỒM VAT (tiền thật)
  hinh_thuc text not null check (hinh_thuc in ('ck','tm')),
  ghi_chu text,
  la_demo boolean not null default false,
  tao_boi uuid,
  tao_luc timestamptz not null default now(),
  da_xoa_luc timestamptz
);
create index if not exists pcn_idx_ncc  on kho.phieu_chi_ncc(ncc_id) where da_xoa_luc is null;
create index if not exists pcn_idx_hd   on kho.phieu_chi_ncc(hoa_don_ncc_id) where da_xoa_luc is null;
create index if not exists pcn_idx_ngay on kho.phieu_chi_ncc(ngay_chi) where da_xoa_luc is null;

-- phiếu chi gắn HĐ → ncc phải khớp ncc của HĐ (backstop; RPC chặn trước)
create or replace function kho.pcn_khop_ncc() returns trigger language plpgsql set search_path=kho as $$
declare v_ncc uuid;
begin
  if new.hoa_don_ncc_id is not null then
    select ncc_id into v_ncc from kho.hoa_don_ncc where id = new.hoa_don_ncc_id;
    if v_ncc is null then raise exception 'phieu_chi_ncc: hoá đơn không tồn tại'; end if;
    if v_ncc <> new.ncc_id then raise exception 'phieu_chi_ncc: NCC phiếu chi khác NCC hoá đơn'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pcn_khop_ncc_trg on kho.phieu_chi_ncc;
create trigger pcn_khop_ncc_trg before insert or update on kho.phieu_chi_ncc for each row execute function kho.pcn_khop_ncc();

-- RLS + grant (chỉ RPC SecDef ghi). hoa_don_ncc(+dong): kho/ceo/ke_toan đọc · phieu_chi_ncc: ceo/ke_toan (như phieu_thu).
alter table kho.hoa_don_ncc      enable row level security; alter table kho.hoa_don_ncc      force row level security;
alter table kho.hoa_don_ncc_dong enable row level security; alter table kho.hoa_don_ncc_dong force row level security;
alter table kho.phieu_chi_ncc    enable row level security; alter table kho.phieu_chi_ncc    force row level security;
drop policy if exists hoa_don_ncc_doc on kho.hoa_don_ncc;
drop policy if exists hoa_don_ncc_dong_doc on kho.hoa_don_ncc_dong;
drop policy if exists phieu_chi_ncc_doc on kho.phieu_chi_ncc;
create policy hoa_don_ncc_doc      on kho.hoa_don_ncc      for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','ke_toan'));
create policy hoa_don_ncc_dong_doc on kho.hoa_don_ncc_dong for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','ke_toan'));
create policy phieu_chi_ncc_doc    on kho.phieu_chi_ncc    for select using (coalesce(kho.current_vai_tro(),'') in ('ceo','ke_toan'));
revoke insert, update, delete on kho.hoa_don_ncc, kho.hoa_don_ncc_dong, kho.phieu_chi_ncc from anon, authenticated;
grant select on kho.hoa_don_ncc, kho.hoa_don_ncc_dong, kho.phieu_chi_ncc to authenticated;
grant usage, select on sequence kho.phieu_chi_ncc_id_seq to authenticated;

-- ═══════════ 2 · tinh_lai_gia_von_bq — TÁCH công thức gia_von_bq (một bản, gd_cap_nhat_ton gọi lại) ═══════════
create or replace function kho.tinh_lai_gia_von_bq(p_vat_tu uuid, p_kho uuid) returns numeric
  language sql security definer set search_path = kho as $$
  update kho.ton set
    gia_von_bq = (select round(sum(con_lai * gia_von_lo) / nullif(sum(con_lai), 0))
                  from kho.lo_nhap where vat_tu_id = p_vat_tu and kho_id = p_kho
                    and lo_da_huy = false and con_lai > 0 and gia_von_lo is not null),
    sua_luc = now()
  where vat_tu_id = p_vat_tu and kho_id = p_kho
  returning gia_von_bq;
$$;

-- gd_cap_nhat_ton: GIỮ nguyên trừ khối gia_von_bq → gọi tinh_lai_gia_von_bq (không đẻ công thức thứ hai)
create or replace function kho.gd_cap_nhat_ton() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare cur numeric; moi numeric;
begin
  select so_luong into cur from ton where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id for update;
  if not found then
    insert into ton(vat_tu_id, kho_id, so_luong) values(new.vat_tu_id, new.kho_id, 0)
      on conflict (vat_tu_id, kho_id) do nothing;
    select so_luong into cur from ton where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id for update;
  end if;
  moi := coalesce(cur,0) + new.so_luong;
  new.so_du_sau := moi;
  if moi < 0 then new.canh_bao := coalesce(new.canh_bao, 'ton_am'); end if;
  update ton set so_luong = moi, sua_luc = now() where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id;
  perform kho.tinh_lai_gia_von_bq(new.vat_tu_id, new.kho_id);   -- CÙNG một công thức (db/119 cũ inline → nay tách hàm)
  return new;
end $$;

-- ═══════════ 3 · dm_chuyen_trang_thai — THÊM nhánh LÙI da_khop_hd→da_nhan (chỉ GUC hệ thống, cho hd_ncc_xoa) ═══════════
create or replace function kho.dm_chuyen_trang_thai(p_id uuid, p_toi text, p_ngay_ncc_hen date default null, p_ly_do text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_tu text; v_hen date;
  v_hethong boolean := coalesce(current_setting('kho.dm_he_thong', true), '') = '1';
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
  elsif p_toi = 'da_nhan' and v_tu = 'da_khop_hd' then                          -- WP-22: LÙI khi xoá HĐ (chỉ hệ thống)
    if not v_hethong then raise exception 'dm_chuyen_trang_thai: lùi da_khop_hd→da_nhan chỉ hệ thống (hd_ncc_xoa)'; end if;
    update kho.don_mua set trang_thai='da_nhan', cap_nhat_luc=now() where id=p_id;
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
grant execute on function kho.dm_chuyen_trang_thai(uuid,text,date,text) to authenticated;

-- ═══════════ 4 · hd_ncc_ghi — khớp 3 chiều ═══════════
create or replace function kho.hd_ncc_ghi(p_don_mua_id uuid, p_so_hd text, p_loai text, p_ngay_hd date,
    p_han date, p_vat_pct numeric, p_ghi_chu text, p_dong jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_dm record; v_hd_id uuid;
  v_vat numeric; v_ngay date; v_han date; d jsonb; v_dd record;
  v_dong_id uuid; v_sl numeric; v_dg_hd numeric; v_da_hd numeric;
  v_chua numeric := 0; v_lech_n int := 0; v_lech_sum numeric := 0;
  v_kho uuid; v_canh text[] := '{}'; v_upd int; v_chua_khop boolean;
begin
  if v_vai not in ('kho','ke_toan','ceo') then raise exception 'hd_ncc_ghi: chỉ kho/ke_toan/ceo'; end if;
  select * into v_dm from kho.don_mua where id=p_don_mua_id for update;
  if v_dm.id is null then raise exception 'hd_ncc_ghi: đơn mua không tồn tại'; end if;
  if v_dm.trang_thai not in ('da_nhan','da_khop_hd') then
    raise exception 'HD_DON_CHUA_NHAN: đơn "%" đang "%" — chỉ khớp HĐ khi đã nhận', v_dm.so_don, v_dm.trang_thai; end if;
  if coalesce(btrim(p_so_hd),'') = '' then raise exception 'hd_ncc_ghi: thiếu số hoá đơn'; end if;
  if p_loai not in ('hoa_don_vat','bang_ke') then raise exception 'hd_ncc_ghi: loại chứng từ phải hoa_don_vat/bang_ke'; end if;
  if p_dong is null or jsonb_array_length(p_dong) = 0 then raise exception 'hd_ncc_ghi: HĐ phải có ít nhất một dòng'; end if;
  v_vat := case when p_loai='bang_ke' then 0 else coalesce(p_vat_pct,0) end;   -- bảng kê ép VAT 0
  if v_vat not in (0,5,8,10) then raise exception 'hd_ncc_ghi: VAT phải 0/5/8/10'; end if;
  v_ngay := coalesce(p_ngay_hd, current_date);
  v_han  := coalesce(p_han, v_ngay + 30);                                        -- [GIẢ ĐỊNH] +30 ngày
  v_kho := v_dm.kho_id;
  if exists(select 1 from kho.hoa_don_ncc where ncc_id=v_dm.ncc_id and so_hd=btrim(p_so_hd) and da_xoa_luc is null) then
    raise exception 'HD_TRUNG: NCC này đã có hoá đơn số "%"', btrim(p_so_hd); end if;

  insert into kho.hoa_don_ncc(so_hd, loai_chung_tu, ncc_id, don_mua_id, ngay_hd, han_thanh_toan, vat_pct, ghi_chu, la_demo, tao_boi)
    values(btrim(p_so_hd), p_loai, v_dm.ncc_id, p_don_mua_id, v_ngay, v_han, v_vat, nullif(btrim(p_ghi_chu),''), false, kho.current_ns())
    returning id into v_hd_id;

  for d in select * from jsonb_array_elements(p_dong) loop
    v_dong_id := (d->>'don_mua_dong_id')::uuid;
    v_sl := (d->>'so_luong')::numeric;
    v_dg_hd := coalesce((d->>'don_gia_hd')::numeric, 0);
    select * into v_dd from kho.don_mua_dong where id=v_dong_id and don_mua_id=p_don_mua_id;
    if v_dd.id is null then raise exception 'hd_ncc_ghi: dòng % không thuộc đơn %', v_dong_id, v_dm.so_don; end if;
    if v_sl is null or v_sl <= 0 then raise exception 'hd_ncc_ghi: số lượng HĐ phải > 0 (dòng %)', v_dd.stt; end if;
    -- KHỚP: Σ SL HĐ (chưa xoá, gồm dòng đang ghi) ≤ SL đã nhận
    select coalesce(sum(hd.so_luong),0) into v_da_hd
      from kho.hoa_don_ncc_dong hd join kho.hoa_don_ncc h on h.id=hd.hoa_don_ncc_id
      where hd.don_mua_dong_id=v_dong_id and h.da_xoa_luc is null and h.id <> v_hd_id;
    if v_da_hd + v_sl > v_dd.so_luong_da_nhan then
      raise exception 'HD_VUOT_NHAN: mã % (dòng %) — HĐ % + đã HĐ % > đã nhận %',
        (select ma from kho.vat_tu where id=v_dd.vat_tu_id), v_dd.stt, v_sl, v_da_hd, v_dd.so_luong_da_nhan;
    end if;
    insert into kho.hoa_don_ncc_dong(hoa_don_ncc_id, don_mua_dong_id, so_luong, don_gia_hd, don_gia_don, lech_don_gia, thanh_tien)
      values(v_hd_id, v_dong_id, v_sl, v_dg_hd, v_dd.don_gia, v_dg_hd - v_dd.don_gia, v_sl * v_dg_hd);
    v_chua := v_chua + v_sl * v_dg_hd;
    if v_dg_hd <> v_dd.don_gia then v_lech_n := v_lech_n + 1; v_lech_sum := v_lech_sum + (v_dg_hd - v_dd.don_gia) * v_sl; end if;
    -- GIÁ LÔ SỐNG đổi theo HĐ (ERP 3.3.8). Lô lưu theo đơn vị DÒNG → gia_von_lo = don_gia_hd trực tiếp (xem đầu file).
    update kho.lo_nhap l set gia_von_lo = v_dg_hd
      where l.lo_da_huy=false and l.con_lai>0 and l.kho_id=v_kho and l.vat_tu_id=v_dd.vat_tu_id
        and exists(select 1 from kho.phieu_dong pd where pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id and pd.don_mua_dong_id=v_dong_id);
    get diagnostics v_upd = row_count;
    if v_upd = 0 then
      v_canh := v_canh || ('mã '||(select ma from kho.vat_tu where id=v_dd.vat_tu_id)||' đã hết lô sống — giá vốn không đổi');
    else
      perform kho.tinh_lai_gia_von_bq(v_dd.vat_tu_id, v_kho);
    end if;
  end loop;

  update kho.hoa_don_ncc set tong_chua_vat = v_chua, tong_vat = round(v_chua * v_vat / 100),
    tong_gom_vat = v_chua + round(v_chua * v_vat / 100) where id = v_hd_id;

  -- ĐƠN → da_khop_hd khi: mọi dòng nhận đủ đặt (da_nhan=so_luong) VÀ HĐ phủ hết đã nhận (Σhd=da_nhan)
  select exists(
    select 1 from kho.don_mua_dong dd
    where dd.don_mua_id=p_don_mua_id
      and (dd.so_luong_da_nhan < dd.so_luong
           or coalesce((select sum(hd.so_luong) from kho.hoa_don_ncc_dong hd join kho.hoa_don_ncc h on h.id=hd.hoa_don_ncc_id
                        where hd.don_mua_dong_id=dd.id and h.da_xoa_luc is null),0) < dd.so_luong_da_nhan)
  ) into v_chua_khop;
  if not v_chua_khop and v_dm.trang_thai = 'da_nhan' then
    perform set_config('kho.dm_he_thong','1',true);
    perform kho.dm_chuyen_trang_thai(p_don_mua_id, 'da_khop_hd');
    perform set_config('kho.dm_he_thong','',true);
  end if;

  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(p_don_mua_id, kho.current_ns(), v_vai, v_dm.trang_thai,
           (select trang_thai from kho.don_mua where id=p_don_mua_id),
           jsonb_build_object('khop_hd', btrim(p_so_hd), 'tong_gom_vat', v_chua + round(v_chua*v_vat/100),
             'lech_gia_so_dong', v_lech_n, 'lech_gia_tong', v_lech_sum));

  return jsonb_build_object('ok',true,'id',v_hd_id,'so_hd',btrim(p_so_hd),
    'tong_chua_vat',v_chua,'tong_vat',round(v_chua*v_vat/100),'tong_gom_vat',v_chua+round(v_chua*v_vat/100),
    'vat_pct',v_vat,'lech_gia_so_dong',v_lech_n,'lech_gia_tong',v_lech_sum,
    'trang_thai_don',(select trang_thai from kho.don_mua where id=p_don_mua_id),
    'canh_bao', case when array_length(v_canh,1) is null then '[]'::jsonb else to_jsonb(v_canh) end);
end $$;
grant execute on function kho.hd_ncc_ghi(uuid,text,text,date,date,numeric,text,jsonb) to authenticated;

-- ═══════════ 5 · hd_ncc_xoa (xoá mềm) ═══════════
create or replace function kho.hd_ncc_xoa(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_hd record; r record; v_kho uuid; v_upd int; v_canh text[] := '{}';
begin
  if v_vai not in ('kho','ke_toan','ceo') then raise exception 'hd_ncc_xoa: chỉ kho/ke_toan/ceo'; end if;
  select * into v_hd from kho.hoa_don_ncc where id=p_id and da_xoa_luc is null for update;
  if v_hd.id is null then raise exception 'hd_ncc_xoa: hoá đơn không tồn tại hoặc đã xoá'; end if;
  if exists(select 1 from kho.phieu_chi_ncc where hoa_don_ncc_id=p_id and da_xoa_luc is null) then
    raise exception 'HD_CO_PHIEU_CHI: hoá đơn đã có phiếu chi — xoá phiếu chi trước'; end if;
  select kho_id into v_kho from kho.don_mua where id=v_hd.don_mua_id;
  -- ĐẢO giá lô về don_gia_don nếu lô còn sống VÀ dòng đó không còn HĐ khác (chưa xoá)
  for r in select hd.don_mua_dong_id, hd.don_gia_don, dd.vat_tu_id
           from kho.hoa_don_ncc_dong hd join kho.don_mua_dong dd on dd.id=hd.don_mua_dong_id
           where hd.hoa_don_ncc_id=p_id loop
    if not exists(select 1 from kho.hoa_don_ncc_dong hd2 join kho.hoa_don_ncc h2 on h2.id=hd2.hoa_don_ncc_id
                  where hd2.don_mua_dong_id=r.don_mua_dong_id and h2.id<>p_id and h2.da_xoa_luc is null) then
      update kho.lo_nhap l set gia_von_lo = r.don_gia_don
        where l.lo_da_huy=false and l.con_lai>0 and l.kho_id=v_kho and l.vat_tu_id=r.vat_tu_id
          and exists(select 1 from kho.phieu_dong pd where pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id and pd.don_mua_dong_id=r.don_mua_dong_id);
      get diagnostics v_upd = row_count;
      if v_upd > 0 then perform kho.tinh_lai_gia_von_bq(r.vat_tu_id, v_kho); end if;
    end if;
  end loop;
  update kho.hoa_don_ncc set da_xoa_luc = now() where id=p_id;
  -- đơn da_khop_hd → lùi da_nhan (không còn phủ đủ)
  if (select trang_thai from kho.don_mua where id=v_hd.don_mua_id) = 'da_khop_hd' then
    perform set_config('kho.dm_he_thong','1',true);
    perform kho.dm_chuyen_trang_thai(v_hd.don_mua_id, 'da_nhan', null, 'xoá HĐ '||v_hd.so_hd);
    perform set_config('kho.dm_he_thong','',true);
  end if;
  insert into kho.don_mua_lich_su(don_mua_id, boi, vai, tu_trang_thai, toi_trang_thai, noi_dung)
    values(v_hd.don_mua_id, kho.current_ns(), v_vai, null, null, jsonb_build_object('xoa_hd', v_hd.so_hd));
  return jsonb_build_object('ok',true,'id',p_id,'trang_thai_don',(select trang_thai from kho.don_mua where id=v_hd.don_mua_id));
end $$;
grant execute on function kho.hd_ncc_xoa(uuid) to authenticated;

-- ═══════════ 6 · hd_ncc_ds / hd_ncc_cua_ncc ═══════════
create or replace function kho.hd_ncc_ds(p_don_mua_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'hd_ncc_ds: chỉ kho/ceo/ke_toan'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'so_hd',h.so_hd,'loai',h.loai_chung_tu,'ngay_hd',h.ngay_hd,
      'han_thanh_toan',h.han_thanh_toan,'vat_pct',h.vat_pct,'tong_chua_vat',h.tong_chua_vat,'tong_vat',h.tong_vat,
      'tong_gom_vat',h.tong_gom_vat,
      'da_tra',coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.hoa_don_ncc_id=h.id and pc.da_xoa_luc is null),0),
      'con_lai',h.tong_gom_vat - coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.hoa_don_ncc_id=h.id and pc.da_xoa_luc is null),0),
      'so_dong',(select count(*) from kho.hoa_don_ncc_dong hd where hd.hoa_don_ncc_id=h.id),
      'lech_gia_so_dong',(select count(*) from kho.hoa_don_ncc_dong hd where hd.hoa_don_ncc_id=h.id and hd.lech_don_gia<>0))
      order by h.ngay_hd, h.tao_luc),'[]'::jsonb)
    from kho.hoa_don_ncc h where h.don_mua_id=p_don_mua_id and h.da_xoa_luc is null);
end $$;
grant execute on function kho.hd_ncc_ds(uuid) to authenticated;

-- hd_ncc_khop_dong: dữ liệu TỪNG DÒNG cho form khớp (SL đặt/đã nhận/đã có HĐ trước + đơn giá)
create or replace function kho.hd_ncc_khop_dong(p_don_mua_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'hd_ncc_khop_dong: chỉ kho/ceo/ke_toan'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('don_mua_dong_id',dd.id,'stt',dd.stt,'vat_tu_id',dd.vat_tu_id,
      'ma',v.ma,'ten',v.ten,'dvt',dd.dvt,'so_luong',dd.so_luong,'so_luong_da_nhan',dd.so_luong_da_nhan,'don_gia',dd.don_gia,
      'so_luong_da_hd', coalesce((select sum(hd.so_luong) from kho.hoa_don_ncc_dong hd join kho.hoa_don_ncc h on h.id=hd.hoa_don_ncc_id
                                  where hd.don_mua_dong_id=dd.id and h.da_xoa_luc is null),0)) order by dd.stt),'[]'::jsonb)
    from kho.don_mua_dong dd join kho.vat_tu v on v.id=dd.vat_tu_id where dd.don_mua_id=p_don_mua_id);
end $$;
grant execute on function kho.hd_ncc_khop_dong(uuid) to authenticated;

create or replace function kho.hd_ncc_cua_ncc(p_ncc_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'hd_ncc_cua_ncc: chỉ kho/ceo/ke_toan'; end if;
  return (select coalesce(jsonb_agg(x order by (x->>'con_lai')::numeric desc),'[]'::jsonb) from (
    select jsonb_build_object('id',h.id,'so_hd',h.so_hd,'ngay_hd',h.ngay_hd,'han_thanh_toan',h.han_thanh_toan,
      'tong_gom_vat',h.tong_gom_vat,
      'da_tra',coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.hoa_don_ncc_id=h.id and pc.da_xoa_luc is null),0),
      'con_lai',h.tong_gom_vat - coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.hoa_don_ncc_id=h.id and pc.da_xoa_luc is null),0)) x
    from kho.hoa_don_ncc h where h.ncc_id=p_ncc_id and h.da_xoa_luc is null) y
    where (x->>'con_lai')::numeric <> 0);
end $$;
grant execute on function kho.hd_ncc_cua_ncc(uuid) to authenticated;

-- ═══════════ 7 · pc_ghi / pc_xoa / pc_ds (chữ ký kiểu pt_*) ═══════════
create or replace function kho.pc_ghi(p_ngay date, p_ncc_id uuid, p_hoa_don_ncc_id uuid, p_so_tien numeric,
    p_hinh_thuc text, p_ghi_chu text default null)
  returns jsonb language plpgsql volatile security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_id bigint; v_ncc uuid; v_con numeric;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'pc_ghi: chỉ ceo/ke_toan'; end if;
  if p_ncc_id is null or not exists(select 1 from kho.nha_cung_cap where id=p_ncc_id) then raise exception 'pc_ghi: NCC không hợp lệ'; end if;
  if p_so_tien is null or p_so_tien <= 0 then raise exception 'pc_ghi: số tiền phải > 0'; end if;
  if coalesce(p_hinh_thuc,'') not in ('ck','tm') then raise exception 'pc_ghi: hình thức phải ck/tm'; end if;
  if p_hoa_don_ncc_id is not null then
    select ncc_id into v_ncc from kho.hoa_don_ncc where id=p_hoa_don_ncc_id and da_xoa_luc is null;
    if v_ncc is null then raise exception 'pc_ghi: hoá đơn không tồn tại/đã xoá'; end if;
    if v_ncc <> p_ncc_id then raise exception 'pc_ghi: NCC phiếu chi khác NCC hoá đơn'; end if;
    select tong_gom_vat - coalesce((select sum(so_tien) from kho.phieu_chi_ncc where hoa_don_ncc_id=p_hoa_don_ncc_id and da_xoa_luc is null),0)
      into v_con from kho.hoa_don_ncc where id=p_hoa_don_ncc_id;
    if p_so_tien > v_con then raise exception 'CHI_VUOT_HD: chi % vượt còn lại % của hoá đơn', p_so_tien, v_con; end if;
  end if;
  insert into kho.phieu_chi_ncc(ngay_chi, ncc_id, hoa_don_ncc_id, so_tien, hinh_thuc, ghi_chu, la_demo, tao_boi)
    values(coalesce(p_ngay, current_date), p_ncc_id, p_hoa_don_ncc_id, p_so_tien, p_hinh_thuc, nullif(btrim(p_ghi_chu),''), false, kho.current_ns())
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;
grant execute on function kho.pc_ghi(date,uuid,uuid,numeric,text,text) to authenticated;

create or replace function kho.pc_xoa(p_id bigint) returns jsonb
  language plpgsql volatile security definer set search_path = kho as $$
declare v int; v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'pc_xoa: chỉ ceo/ke_toan'; end if;
  update kho.phieu_chi_ncc set da_xoa_luc=now() where id=p_id and da_xoa_luc is null; get diagnostics v = row_count;
  return jsonb_build_object('ok', v>0, 'da_xoa', v);
end $$;
grant execute on function kho.pc_xoa(bigint) to authenticated;

create or replace function kho.pc_ds(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
  v_from date := to_date(p_ky||'-01','YYYY-MM-DD'); v_to date := (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date;
  v jsonb; v_tong numeric;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'pc_ds: chỉ ceo/ke_toan'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ngay_chi, x.id),'[]'::jsonb), coalesce(sum(x.so_tien),0) into v, v_tong
    from (select pc.id, pc.ngay_chi, n.ten ncc, pc.ncc_id, pc.hoa_don_ncc_id, h.so_hd, pc.so_tien, pc.hinh_thuc, pc.ghi_chu
          from kho.phieu_chi_ncc pc join kho.nha_cung_cap n on n.id=pc.ncc_id
          left join kho.hoa_don_ncc h on h.id=pc.hoa_don_ncc_id
          where pc.da_xoa_luc is null and pc.ngay_chi>=v_from and pc.ngay_chi<v_to) x;
  return jsonb_build_object('ma_ky',p_ky,'ds',v,'tong',v_tong);
end $$;
grant execute on function kho.pc_ds(text) to authenticated;

-- ═══════════ 8 · con_phai_tra(p_ky, p_gom_demo) — công nợ phải trả theo NCC (TÍNH, cùng hình con_phai_thu) ═══════════
create or replace function kho.con_phai_tra(p_ky text default null, p_gom_demo boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = kho set jit='off' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
  v_asof date := case when p_ky is null or p_ky='' then current_date + 1
                      else (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date end;
  v jsonb; v_tong_hd numeric; v_tra numeric; v_con numeric;
begin
  if v_vai not in ('ceo','ke_toan') then raise exception 'con_phai_tra: chỉ ceo/ke_toan'; end if;
  with hd as (
    select h.ncc_id, h.tong_gom_vat, h.han_thanh_toan,
      h.tong_gom_vat - coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc
        where pc.hoa_don_ncc_id=h.id and pc.da_xoa_luc is null and pc.ngay_chi < v_asof),0) con_lai,
      h.so_hd, h.ngay_hd
    from kho.hoa_don_ncc h
    where h.da_xoa_luc is null and h.ngay_hd < v_asof and (p_gom_demo or coalesce(h.la_demo,false)=false)),
  pc_kg as (   -- phiếu chi KHÔNG gắn HĐ (ứng trước) → giảm nợ NCC
    select pc.ncc_id, sum(pc.so_tien) tra_ung from kho.phieu_chi_ncc pc
    where pc.da_xoa_luc is null and pc.hoa_don_ncc_id is null and pc.ngay_chi < v_asof
      and (p_gom_demo or coalesce(pc.la_demo,false)=false) group by pc.ncc_id),
  per as (
    select n.id ncc_id, n.ten,
      coalesce((select sum(tong_gom_vat) from hd where hd.ncc_id=n.id),0) tong_hd,
      coalesce((select sum(tong_gom_vat - con_lai) from hd where hd.ncc_id=n.id),0)
        + coalesce((select tra_ung from pc_kg where pc_kg.ncc_id=n.id),0) da_tra,
      coalesce((select sum(con_lai) from hd where hd.ncc_id=n.id),0)
        - coalesce((select tra_ung from pc_kg where pc_kg.ncc_id=n.id),0) con_lai,
      coalesce((select sum(con_lai) from hd where hd.ncc_id=n.id and hd.han_thanh_toan < current_date and con_lai>0),0) qua_han,
      (select max(current_date - han_thanh_toan) from hd where hd.ncc_id=n.id and hd.han_thanh_toan < current_date and con_lai>0) so_ngay_qua_han,
      (select max(ngay_hd) from hd where hd.ncc_id=n.id) hd_gan_nhat
    from kho.nha_cung_cap n
    where exists(select 1 from hd where hd.ncc_id=n.id) or exists(select 1 from pc_kg where pc_kg.ncc_id=n.id))
  select coalesce(jsonb_agg(jsonb_build_object('ncc_id',ncc_id,'ncc',ten,'tong_hd',tong_hd,'da_tra',da_tra,
      'con_lai',con_lai,'qua_han',qua_han,'so_ngay_qua_han',coalesce(so_ngay_qua_han,0),'hd_gan_nhat',hd_gan_nhat)
      order by con_lai desc),'[]'::jsonb),
    coalesce(sum(tong_hd),0), coalesce(sum(da_tra),0), coalesce(sum(con_lai),0)
    into v, v_tong_hd, v_tra, v_con from per;
  return jsonb_build_object('ma_ky',p_ky,'tong_hd',v_tong_hd,'tong_da_tra',v_tra,'tong_con_lai',v_con,'ds',v);
end $$;
grant execute on function kho.con_phai_tra(text, boolean) to authenticated;

-- ═══════════ 9 · dong_tien_ky — thêm khối 'tra_ncc' (CHI KD) + con_no_ncc ═══════════
create or replace function kho.dong_tien_ky(p_ky text) returns jsonb
  language plpgsql stable security definer set search_path = kho set jit='off' as $$
declare
  v_from date := to_date(p_ky||'-01','YYYY-MM-DD'); v_to date := (to_date(p_ky||'-01','YYYY-MM-DD')+interval '1 month')::date;
  v_thu jsonb; v_tong_thu numeric; v_chi jsonb; v_tong_chi numeric;
  v_vc jsonb; v_vc_tong numeric; v_vc_don int; v_hoan jsonb;
  v_no jsonb; v_canhbao jsonb; v_cb_so int; v_von jsonb; v_von_vao numeric; v_von_ra numeric;
  v_quy_luu numeric; v_quy_dau numeric; v_goi_y numeric; v_rong_kd numeric; v_rong_ngoai numeric; v_prev jsonb;
  c_luong numeric; c_ads numeric; c_cpk numeric; c_tra_ncc numeric; v_con_no_ncc numeric;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan') then raise exception 'dong_tien_ky: chỉ ceo/ke_toan'; end if;

  select jsonb_object_agg(loai, jsonb_build_object('so_phieu',sp,'so_tien',st,'so_dot',sd,'so_don',so_don)), coalesce(sum(st),0)
    into v_thu, v_tong_thu
  from (select loai, count(*) sp, coalesce(sum(so_tien),0) st,
          count(distinct ngay) filter(where loai='doi_soat_cod') sd,
          count(*) filter(where loai='doi_soat_cod') so_don
        from kho.phieu_thu where ngay>=v_from and ngay<v_to group by loai) x;

  -- KHỐI 2 — CHI: chi_phi_ky + chi_ads GỒM VAT + luong_to (lương+BH) + TRẢ NCC (phieu_chi_ncc, WP-22).
  c_cpk   := (select coalesce(sum(so_tien),0) from kho.chi_phi_ky where ma_ky=p_ky);
  c_ads   := (select coalesce(sum(so_tien_nhap),0) from kho.chi_ads where ma_ky=p_ky);
  c_luong := (select coalesce(sum(coalesce(luong_to,0)+coalesce(bao_hiem,0)),0) from kho.luong_to where ma_ky=p_ky);
  c_tra_ncc := (select coalesce(sum(so_tien),0) from kho.phieu_chi_ncc
                where da_xoa_luc is null and coalesce(la_demo,false)=false and ngay_chi>=v_from and ngay_chi<v_to);
  v_tong_chi := c_cpk + c_ads + c_luong + c_tra_ncc;
  v_chi := jsonb_build_object('chi_phi_ky',c_cpk,'chi_ads',c_ads,'luong_to',c_luong,'tra_ncc',c_tra_ncc);
  v_rong_kd := v_tong_thu - v_tong_chi;

  select coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'nguon_khach',nguon_khach,
      'don_vi_vc',don_vi_vc,'so_tien_thu_ho',so_tien_thu_ho,'ngay_xuat',ngay_xuat,'tuoi',tuoi,'qua_14',tuoi>14)
      order by tuoi desc),'[]'::jsonb)
    into v_vc from (
      select g.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.nguon_khach,
             g.don_vi_vc, g.so_tien_thu_ho, g.ngay_xuat, (current_date-g.ngay_xuat) tuoi
      from kho.giao_cod g join kho.don_hang d on d.ma_don=g.ma_don
      where g.trang_thai='dang_giao' order by (current_date-g.ngay_xuat) desc limit 50) y;
  select coalesce(sum(so_tien_thu_ho),0), count(*) into v_vc_tong, v_vc_don from kho.giao_cod where trang_thai='dang_giao';
  select jsonb_build_object('so_don',count(*),'so_tien',coalesce(sum(so_tien_thu_ho),0)) into v_hoan
    from kho.giao_cod where trang_thai='hoan' and ngay_ket_thuc>=v_from and ngay_ket_thuc<v_to;

  with pt as (select ma_don, sum(so_tien) da_thu, count(*) c from kho.phieu_thu group by ma_don),
  cod as (select ma_don from kho.giao_cod where trang_thai='dang_giao'),
  base as (
    select d.ma_don, coalesce(nullif(btrim(d.ten_khach),''),'(chưa tên)') khach, d.dong, d.ngay_giao,
           coalesce(d.gia_chot,d.doanh_thu,d.gia_cong_thuc,0)-coalesce(pt.da_thu,0) con_lai,
           coalesce(pt.c,0) so_phieu, (current_date-d.ngay_giao) tuoi,
           (cod.ma_don is null) khong_cod
    from kho.don_hang d left join pt on pt.ma_don=d.ma_don left join cod on cod.ma_don=d.ma_don
    where d.trang_thai='da_giao' and d.ngay_giao is not null and coalesce(d.la_demo,false)=false)
  select jsonb_build_object(
      'tong', coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod),0),
      'so_don', count(*) filter(where con_lai>0 and khong_cod),
      'bac1', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi<=30),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi<=30)),
      'bac2', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>30 and tuoi<=60)),
      'bac3', jsonb_build_object('tien',coalesce(sum(con_lai) filter(where con_lai>0 and khong_cod and tuoi>60),0),'so_don',count(*) filter(where con_lai>0 and khong_cod and tuoi>60))),
    coalesce(jsonb_agg(jsonb_build_object('ma_don',ma_don,'khach',khach,'dong',dong,'ngay_giao',ngay_giao)) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to),'[]'::jsonb),
    count(*) filter(where so_phieu=0 and khong_cod and ngay_giao>=v_from and ngay_giao<v_to)
    into v_no, v_canhbao, v_cb_so from base;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'ngay',ngay,'loai',loai,
      'vao', case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end,
      'ra',  case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end,
      'ghi_chu',ghi_chu) order by ngay, id),'[]'::jsonb),
    coalesce(sum(case when loai in ('vay_moi','ban_tai_san','gop_von') then so_tien else 0 end),0),
    coalesce(sum(case when loai in ('tra_goc_vay','mua_tai_san','rut_von') then so_tien else 0 end),0)
    into v_von, v_von_vao, v_von_ra from kho.giao_dich_von where ngay>=v_from and ngay<v_to;
  v_rong_ngoai := v_von_vao - v_von_ra;

  -- công nợ phải trả NCC (as-of cuối kỳ) — dòng phụ cho UI
  v_con_no_ncc := coalesce((
    select sum(h.tong_gom_vat) from kho.hoa_don_ncc h where h.da_xoa_luc is null and coalesce(h.la_demo,false)=false and h.ngay_hd < v_to),0)
    - coalesce((select sum(so_tien) from kho.phieu_chi_ncc pc where pc.da_xoa_luc is null and coalesce(pc.la_demo,false)=false and pc.ngay_chi < v_to),0);

  select quy_dau_ky into v_quy_luu from kho.tham_so_tai_chinh where ma_ky=p_ky;
  v_prev := kho.dong_tien_rong(to_char((v_from - interval '1 month'),'YYYY-MM'));
  select coalesce(quy_dau_ky,0) + (v_prev->>'rong_kd')::numeric + (v_prev->>'rong_ngoai')::numeric into v_goi_y
    from kho.tham_so_tai_chinh where ma_ky=to_char((v_from - interval '1 month'),'YYYY-MM');
  v_quy_dau := coalesce(v_quy_luu, v_goi_y);

  return jsonb_build_object(
    'ma_ky',p_ky,
    'thu', jsonb_build_object('theo_loai',coalesce(v_thu,'{}'::jsonb),'tong',v_tong_thu),
    'chi', jsonb_build_object('theo_so',v_chi,'tong',v_tong_chi),
    'rong_kd', v_rong_kd,
    'o_nha_vc', jsonb_build_object('tong',v_vc_tong,'so_don',v_vc_don,'ds',v_vc,'hoan',v_hoan),
    'khach_no', v_no,
    'con_no_ncc', v_con_no_ncc,
    'canh_bao', jsonb_build_object('so_don',v_cb_so,'ds',v_canhbao),
    'ngoai_kd', jsonb_build_object('vao',v_von_vao,'ra',v_von_ra,'rong',v_rong_ngoai,'ds',v_von),
    'quy', jsonb_build_object('dau_ky',v_quy_dau,'da_luu',(v_quy_luu is not null),'goi_y',v_goi_y,
      'rong_kd',v_rong_kd,'rong_ngoai',v_rong_ngoai,'cuoi_ky',v_quy_dau + v_rong_kd + v_rong_ngoai)
  );
end $$;
grant execute on function kho.dong_tien_ky(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.hd_ncc_ghi(uuid,text,text,date,date,numeric,text,jsonb)') is null then raise exception 'THIẾU hd_ncc_ghi'; end if;
  if to_regprocedure('kho.con_phai_tra(text,boolean)') is null then raise exception 'THIẾU con_phai_tra'; end if;
  if to_regprocedure('kho.tinh_lai_gia_von_bq(uuid,uuid)') is null then raise exception 'THIẾU tinh_lai_gia_von_bq'; end if;
  raise notice 'db/135 OK: hoa_don_ncc + dong + phieu_chi_ncc + hd_ncc_* + pc_* + con_phai_tra + tinh_lai_gia_von_bq + dm lùi + dong_tien_ky(tra_ncc).';
end $$;
commit;
