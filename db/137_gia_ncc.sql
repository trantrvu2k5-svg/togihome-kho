-- 137 — WP-23: bảng giá NCC × vật tư + lead time + hạn TT theo NCC + chuẩn hoá đơn vị dòng đơn mua. CẤM COMMIT.
--   CĂN CỨ ERP Sagegg&Alfnes §4.3.4 (pricelist theo NCC×mặt hàng, fallback base=v_gia_tham_khao) · §4.3.5 (lead time master data,
--     ta gắn NCC×vật tư — chi tiết hơn sách, chủ đích) · §4.3.2 (hạn TT thuộc vendor master). Giá bảng CHƯA VAT (QD-57).
--   Lịch sử theo PATTERN db/134 (truong/gia_tri_cu/gia_tri_moi jsonb, append-only) — KHÔNG chế kiểu mới.
--   Đơn vị: chuẩn hoá qua don_vi.ma/ten (bỏ dấu) rồi kiểm ∈ {don_vi_co_so} ∪ {vat_tu_don_vi.don_vi} (QD-53) — mở khoá quy_ve_co_so (WP-25).
--   HOÀN TÁC: drop table gia_ncc_lich_su, gia_ncc; drop các hàm gia_ncc_*/goi_y_gia_dong_mua/vat_tu_thieu_lead_time/kiem_don_vi_hop_le;
--     drop trigger dmd_kiem_dvt on don_mua_dong; alter nha_cung_cap drop column han_thanh_toan_ngay; chạy lại db/135 (hd_ncc_ghi +30).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ 1 · nha_cung_cap: hạn thanh toán ═══
alter table kho.nha_cung_cap add column if not exists han_thanh_toan_ngay int not null default 30;

-- ═══ 2 · bảng gia_ncc + lịch sử (pattern db/134) ═══
create table if not exists kho.gia_ncc (
  id uuid primary key default gen_random_uuid(),
  ncc_id uuid not null references kho.nha_cung_cap(id),
  vat_tu_id uuid not null references kho.vat_tu(id),
  don_vi text not null,
  don_gia numeric not null check (don_gia >= 0),   -- CHƯA VAT (QD-57)
  lead_time_ngay int,
  ap_dung_tu date not null default current_date,
  ghi_chu text,
  tao_luc timestamptz not null default now(),
  nguoi_tao uuid,
  unique (ncc_id, vat_tu_id)
);
create index if not exists gncc_idx_vt on kho.gia_ncc(vat_tu_id);
create index if not exists gncc_idx_ncc on kho.gia_ncc(ncc_id);

create table if not exists kho.gia_ncc_lich_su (
  id bigserial primary key,
  gia_ncc_id uuid not null,
  ncc_id uuid, vat_tu_id uuid,
  truong text not null, gia_tri_cu jsonb, gia_tri_moi jsonb,
  nguoi uuid, luc timestamptz not null default now()
);
create index if not exists gncc_ls_idx on kho.gia_ncc_lich_su(gia_ncc_id, luc desc);
create or replace function kho.gncc_ls_append_only() returns trigger language plpgsql as $$
begin raise exception 'gia_ncc_lich_su: append-only (WP-23)'; end $$;
drop trigger if exists trg_gncc_ls_ao on kho.gia_ncc_lich_su;
create trigger trg_gncc_ls_ao before update or delete on kho.gia_ncc_lich_su for each row execute function kho.gncc_ls_append_only();

-- RLS: đọc kho/ceo/ke_toan (như bảng tab Kho khác); ghi qua RPC SecDef
alter table kho.gia_ncc enable row level security; alter table kho.gia_ncc force row level security;
alter table kho.gia_ncc_lich_su enable row level security; alter table kho.gia_ncc_lich_su force row level security;
drop policy if exists gia_ncc_doc on kho.gia_ncc;
drop policy if exists gia_ncc_ls_doc on kho.gia_ncc_lich_su;
create policy gia_ncc_doc on kho.gia_ncc for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','ke_toan'));
create policy gia_ncc_ls_doc on kho.gia_ncc_lich_su for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','ke_toan'));
revoke insert, update, delete on kho.gia_ncc, kho.gia_ncc_lich_su from anon, authenticated;
grant select on kho.gia_ncc, kho.gia_ncc_lich_su to authenticated;
grant usage, select on sequence kho.gia_ncc_lich_su_id_seq to authenticated;

-- ═══ 3 · kiểm đơn vị hợp lệ (dùng chung cho gia_ncc + don_mua_dong) — chuẩn hoá dấu qua don_vi ═══
create or replace function kho.kiem_don_vi_hop_le(p_vat_tu uuid, p_dv text) returns void
  language plpgsql stable security definer set search_path = kho as $$
declare v_cs text; v_key text;
begin
  select don_vi_co_so into v_cs from kho.vat_tu where id = p_vat_tu;
  if v_cs is null then raise exception 'kiem_don_vi: vật tư % không tồn tại', p_vat_tu; end if;
  v_key := coalesce((select ma from kho.don_vi where ma = p_dv or ten = p_dv limit 1), p_dv);
  if v_key = v_cs then return; end if;
  if exists (select 1 from kho.vat_tu_don_vi where vat_tu_id = p_vat_tu and don_vi = v_key) then return; end if;
  raise exception 'Đơn vị "%" không hợp lệ cho vật tư này — phải là đơn vị cơ sở hoặc có trong bảng quy đổi vat_tu_don_vi (QD-53)', p_dv;
end $$;

-- trigger gia_ncc: đơn vị hợp lệ
create or replace function kho.gia_ncc_kiem() returns trigger language plpgsql security definer set search_path = kho as $$
begin perform kho.kiem_don_vi_hop_le(new.vat_tu_id, new.don_vi); return new; end $$;
drop trigger if exists trg_gia_ncc_kiem on kho.gia_ncc;
create trigger trg_gia_ncc_kiem before insert or update on kho.gia_ncc for each row execute function kho.gia_ncc_kiem();

-- ═══ 6 · trigger don_mua_dong: dvt hợp lệ (mở khoá quy_ve_co_so, WP-25) ═══
create or replace function kho.dmd_kiem_dvt() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if new.dvt is not null and btrim(new.dvt) <> '' then perform kho.kiem_don_vi_hop_le(new.vat_tu_id, new.dvt); end if;
  return new;
end $$;
drop trigger if exists trg_dmd_kiem_dvt on kho.don_mua_dong;
create trigger trg_dmd_kiem_dvt before insert or update on kho.don_mua_dong for each row execute function kho.dmd_kiem_dvt();

-- ═══ 2b · gia_ncc_ghi (upsert + lịch sử) · gia_ncc_ds ═══
create or replace function kho.gia_ncc_ghi(p_ncc_id uuid, p_vat_tu_id uuid, p_don_vi text, p_don_gia numeric,
    p_lead_time_ngay int default null, p_ghi_chu text default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); v_old record; v_id uuid;
begin
  if v_vai not in ('kho','ceo') then raise exception 'gia_ncc_ghi: chỉ kho/ceo'; end if;
  if p_ncc_id is null or not exists(select 1 from kho.nha_cung_cap where id=p_ncc_id) then raise exception 'gia_ncc_ghi: NCC không hợp lệ'; end if;
  if p_vat_tu_id is null or not exists(select 1 from kho.vat_tu where id=p_vat_tu_id) then raise exception 'gia_ncc_ghi: vật tư không hợp lệ'; end if;
  if p_don_gia is null or p_don_gia < 0 then raise exception 'gia_ncc_ghi: đơn giá phải >= 0'; end if;
  perform kho.kiem_don_vi_hop_le(p_vat_tu_id, p_don_vi);   -- báo sớm (trigger cũng chặn)
  select * into v_old from kho.gia_ncc where ncc_id=p_ncc_id and vat_tu_id=p_vat_tu_id;
  if v_old.id is null then
    insert into kho.gia_ncc(ncc_id,vat_tu_id,don_vi,don_gia,lead_time_ngay,ghi_chu,nguoi_tao)
      values(p_ncc_id,p_vat_tu_id,p_don_vi,p_don_gia,p_lead_time_ngay,nullif(btrim(p_ghi_chu),''),v_ns) returning id into v_id;
    insert into kho.gia_ncc_lich_su(gia_ncc_id,ncc_id,vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi)
      values(v_id,p_ncc_id,p_vat_tu_id,'tao',null,jsonb_build_object('don_vi',p_don_vi,'don_gia',p_don_gia,'lead_time_ngay',p_lead_time_ngay),v_ns);
  else
    v_id := v_old.id;
    if v_old.don_gia is distinct from p_don_gia then insert into kho.gia_ncc_lich_su(gia_ncc_id,ncc_id,vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(v_id,p_ncc_id,p_vat_tu_id,'don_gia',to_jsonb(v_old.don_gia),to_jsonb(p_don_gia),v_ns); end if;
    if v_old.don_vi is distinct from p_don_vi then insert into kho.gia_ncc_lich_su(gia_ncc_id,ncc_id,vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(v_id,p_ncc_id,p_vat_tu_id,'don_vi',to_jsonb(v_old.don_vi),to_jsonb(p_don_vi),v_ns); end if;
    if v_old.lead_time_ngay is distinct from p_lead_time_ngay then insert into kho.gia_ncc_lich_su(gia_ncc_id,ncc_id,vat_tu_id,truong,gia_tri_cu,gia_tri_moi,nguoi) values(v_id,p_ncc_id,p_vat_tu_id,'lead_time_ngay',to_jsonb(v_old.lead_time_ngay),to_jsonb(p_lead_time_ngay),v_ns); end if;
    update kho.gia_ncc set don_vi=p_don_vi, don_gia=p_don_gia, lead_time_ngay=p_lead_time_ngay, ghi_chu=nullif(btrim(p_ghi_chu),''), ap_dung_tu=current_date where id=v_id;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;
revoke all on function kho.gia_ncc_ghi(uuid,uuid,text,numeric,int,text) from public, anon;
grant execute on function kho.gia_ncc_ghi(uuid,uuid,text,numeric,int,text) to authenticated;

create or replace function kho.gia_ncc_ds(p_ncc_id uuid default null)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'gia_ncc_ds: chỉ kho/ceo/ke_toan'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'ncc_id',g.ncc_id,'ncc',n.ten,'vat_tu_id',g.vat_tu_id,
      'ma',v.ma,'ten',v.ten,'don_vi',g.don_vi,'don_gia',g.don_gia,'lead_time_ngay',g.lead_time_ngay,'ap_dung_tu',g.ap_dung_tu,'ghi_chu',g.ghi_chu)
      order by n.ten, v.ma),'[]'::jsonb)
    from kho.gia_ncc g join kho.nha_cung_cap n on n.id=g.ncc_id join kho.vat_tu v on v.id=g.vat_tu_id
    where p_ncc_id is null or g.ncc_id=p_ncc_id);
end $$;
grant execute on function kho.gia_ncc_ds(uuid) to authenticated;

-- ═══ 4 · goi_y_gia_dong_mua: bảng giá NCC → fallback tham khảo ═══
create or replace function kho.goi_y_gia_dong_mua(p_ncc_id uuid, p_vat_tu_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); g record; v_ref numeric; v_cs text;
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'goi_y_gia_dong_mua: chỉ kho/ceo/ke_toan'; end if;
  select don_gia, don_vi, lead_time_ngay into g from kho.gia_ncc where ncc_id=p_ncc_id and vat_tu_id=p_vat_tu_id;
  if g.don_gia is not null then
    return jsonb_build_object('co',true,'don_gia',g.don_gia,'don_vi',g.don_vi,'lead_time_ngay',g.lead_time_ngay,'nguon','bang_gia_ncc');
  end if;
  select gia_tham_khao into v_ref from kho.v_gia_tham_khao where vat_tu_id=p_vat_tu_id;
  select don_vi_co_so into v_cs from kho.vat_tu where id=p_vat_tu_id;
  if v_ref is not null then
    return jsonb_build_object('co',true,'don_gia',v_ref,'don_vi',v_cs,'lead_time_ngay',null,'nguon','tham_khao');
  end if;
  return jsonb_build_object('co',false,'nguon',null);
end $$;
grant execute on function kho.goi_y_gia_dong_mua(uuid,uuid) to authenticated;

-- ═══ 7 · vat_tu_thieu_lead_time: ván chưa có dòng gia_ncc mang lead_time ═══
create or replace function kho.vat_tu_thieu_lead_time()
  returns jsonb language plpgsql stable security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('kho','ceo','ke_toan') then raise exception 'vat_tu_thieu_lead_time: chỉ kho/ceo/ke_toan'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id',v.id,'ma',v.ma,'ten',v.ten) order by v.ma),'[]'::jsonb)
    from kho.vat_tu v
    where kho.la_nhom_van(v.nhom_id) and v.ngung_dung=false
      and not exists(select 1 from kho.gia_ncc g where g.vat_tu_id=v.id and g.lead_time_ngay is not null));
end $$;
grant execute on function kho.vat_tu_thieu_lead_time() to authenticated;

-- ═══ 5 · hd_ncc_ghi: hạn TT theo NCC ═══
CREATE OR REPLACE FUNCTION kho.hd_ncc_ghi(p_don_mua_id uuid, p_so_hd text, p_loai text, p_ngay_hd date, p_han date, p_vat_pct numeric, p_ghi_chu text, p_dong jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
  v_han  := coalesce(p_han, v_ngay + coalesce((select han_thanh_toan_ngay from kho.nha_cung_cap where id=v_dm.ncc_id), 30));  -- WP-23: hạn theo NCC ([GĐ] 30 khi chưa nhập)
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
    -- GIÁ LÔ SỐNG đổi theo HĐ (ERP 3.3.8). Lô ở CƠ SỞ (WP-25) → gia_von_lo = đơn giá HĐ ÷ hệ số áp dụng lúc nhận.
    update kho.lo_nhap l set gia_von_lo = v_dg_hd / coalesce(l.he_so_ap_dung, 1)
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
end $function$;

-- ═══ 5b · dm_tao / dm_sua_dong: nhận đơn vị chọn per dòng (WP-23) ═══
CREATE OR REPLACE FUNCTION kho.dm_tao(p_ncc uuid, p_kho uuid DEFAULT NULL::uuid, p_ngay_can date DEFAULT NULL::date, p_ghi_chu text DEFAULT NULL::text, p_dong jsonb DEFAULT '[]'::jsonb, p_gui_ngay boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
    v_dvt := coalesce(nullif(d->>'don_vi',''), (select dvt from kho.vat_tu where id=v_vt));  -- WP-23: nhận đơn vị chọn per dòng
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
end $function$;
CREATE OR REPLACE FUNCTION kho.dm_sua_dong(p_id uuid, p_dong jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kho'
AS $function$
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
    v_dvt := coalesce(nullif(d->>'don_vi',''), (select dvt from kho.vat_tu where id=v_vt));  -- WP-23: nhận đơn vị chọn per dòng
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
end $function$;

-- ═══ 6b · AUDIT dvt lạ trong don_mua_dong hiện có (in ra, KHÔNG sửa im lặng) ═══
do $audit$
declare r record; n int := 0; v_key text; v_cs text;
begin
  for r in select dd.id, dd.dvt, dd.vat_tu_id, v.ma, v.don_vi_co_so, dm.so_don
           from kho.don_mua_dong dd join kho.vat_tu v on v.id=dd.vat_tu_id join kho.don_mua dm on dm.id=dd.don_mua_id
           where dd.dvt is not null and btrim(dd.dvt) <> ''
  loop
    v_key := coalesce((select ma from kho.don_vi where ma=r.dvt or ten=r.dvt limit 1), r.dvt);
    if v_key = r.don_vi_co_so then continue; end if;
    if exists(select 1 from kho.vat_tu_don_vi where vat_tu_id=r.vat_tu_id and don_vi=v_key) then continue; end if;
    raise notice 'DVT LẠ · đơn % · mã % · dvt "%" (chuẩn hoá "%") ∉ {cơ sở %} ∪ vat_tu_don_vi', r.so_don, r.ma, r.dvt, v_key, r.don_vi_co_so;
    n := n + 1;
  end loop;
  raise notice 'WP-23 §6: % dòng đơn mua có dvt LẠ (0 = tất cả hợp lệ).', n;
end $audit$;

do $$ begin
  if to_regclass('kho.gia_ncc') is null then raise exception 'THIẾU gia_ncc'; end if;
  if to_regprocedure('kho.goi_y_gia_dong_mua(uuid,uuid)') is null then raise exception 'THIẾU goi_y_gia_dong_mua'; end if;
  raise notice 'db/137 OK: gia_ncc + lịch sử + goi_y_gia + hạn TT theo NCC + trigger dvt don_mua_dong + vat_tu_thieu_lead_time.';
end $$;
commit;
