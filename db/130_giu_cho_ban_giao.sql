-- 130 — GIỮ CHỖ MỀM lúc bàn giao (WP-32, QD-52). ERP Sagegg&Alfnes §3.3.7: giữ chỗ để on-hand khả dụng phản ánh đúng.
--   MỀM (soft) — giữ số lượng, KHÔNG gắn lô/serial (ván không serial). KHÔNG trừ tồn thật, KHÔNG INSERT giao_dich (WP-10: SX chưa chạm ton).
--   Trừ tồn THẬT để WP-33 back-flush theo quét. Khả dụng = tồn − giữ chỗ (+ PO đang về). Thiếu hàng VẪN bàn giao + báo (ERP 3.3.7).
--   Kích hoạt tự động trong ban_giao_xuong (QD-16 mốc chốt): đóng băng BOM du_kien→chuan rồi sinh giữ chỗ.
--   ⚠ IDEMPOTENT: create table/index if not exists · create or replace · drop trigger/policy if exists.
-- HOÀN TÁC: drop view v_ton_kha_dung; drop function giu_cho_ds, huy_giu_cho_don; drop trigger trg_huy_giu_cho on don_hang;
--   drop table giu_cho cascade; chạy lại db/071 (ban_giao_xuong bản không giữ chỗ).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ A · BẢNG giu_cho (soft, KHÔNG lô) ═══════════
create table if not exists kho.giu_cho (
  id uuid primary key default gen_random_uuid(),
  don_hang_id uuid not null references kho.don_hang(id) on delete cascade,
  don_hang_mon_id uuid references kho.don_hang_mon(id) on delete cascade,
  don_hang_mon_bom_id uuid references kho.don_hang_mon_bom(id) on delete cascade,
  vat_tu_id uuid not null references kho.vat_tu(id),
  kho_id uuid not null references kho.kho(id),
  so_luong_giu numeric(14,4) not null check (so_luong_giu > 0),
  so_luong_da_xuat numeric(14,4) not null default 0 check (so_luong_da_xuat >= 0),   -- WP-33 ghi
  trang_thai text not null default 'mo' check (trang_thai in ('mo','het','huy')),
  tao_luc timestamptz not null default now(),
  tao_boi uuid references kho.nguoi_dung(id),
  huy_luc timestamptz,
  ly_do text
);
create index if not exists gc_idx_vt_kho on kho.giu_cho(vat_tu_id, kho_id) where trang_thai = 'mo';
create index if not exists gc_idx_don on kho.giu_cho(don_hang_id);
create unique index if not exists gc_uq_bom_mo on kho.giu_cho(don_hang_mon_bom_id) where trang_thai = 'mo';

alter table kho.giu_cho enable row level security;
alter table kho.giu_cho force row level security;
drop policy if exists gc_doc on kho.giu_cho;
create policy gc_doc on kho.giu_cho for select using (coalesce(kho.current_vai_tro(),'') in ('kho','ceo','xuong','thiet_ke'));
revoke insert, update, delete on kho.giu_cho from anon, authenticated;   -- CHỈ RPC SecDef ghi
grant select on kho.giu_cho to authenticated;

-- ═══════════ C · trigger: đơn → huy thì giữ chỗ mo → huy (tam_ngung giữ nguyên) ═══════════
create or replace function kho.huy_giu_cho_don() returns trigger language plpgsql security definer set search_path = kho as $$
begin
  if new.trang_thai = 'huy' and coalesce(old.trang_thai,'') <> 'huy' then
    update kho.giu_cho set trang_thai='huy', huy_luc=now(), ly_do='don_huy' where don_hang_id = new.id and trang_thai='mo';
  end if;
  return new;
end $$;
drop trigger if exists trg_huy_giu_cho on kho.don_hang;
create trigger trg_huy_giu_cho after update of trang_thai on kho.don_hang
  for each row execute function kho.huy_giu_cho_don();

-- ═══════════ D · view v_ton_kha_dung + RPC giu_cho_ds ═══════════
create or replace view kho.v_ton_kha_dung as
with keys as (
  select vat_tu_id, kho_id from kho.ton
  union select vat_tu_id, kho_id from kho.giu_cho where trang_thai='mo'
  union select dd.vat_tu_id, d.kho_id from kho.don_mua_dong dd join kho.don_mua d on d.id=dd.don_mua_id where d.trang_thai in ('da_gui','xac_nhan')
)
select k.vat_tu_id, k.kho_id,
  coalesce(t.so_luong,0) as ton,
  coalesce(g.giu,0) as giu_cho,
  coalesce(po.dang_ve,0) as dang_ve,
  coalesce(t.so_luong,0) - coalesce(g.giu,0) as kha_dung,
  coalesce(t.so_luong,0) - coalesce(g.giu,0) + coalesce(po.dang_ve,0) as kha_dung_ke_ca_po
from keys k
left join kho.ton t on t.vat_tu_id=k.vat_tu_id and t.kho_id=k.kho_id
left join (select vat_tu_id, kho_id, sum(so_luong_giu - so_luong_da_xuat) giu from kho.giu_cho where trang_thai='mo' group by vat_tu_id, kho_id) g
  on g.vat_tu_id=k.vat_tu_id and g.kho_id=k.kho_id
left join (select dd.vat_tu_id, d.kho_id, sum(dd.so_luong - dd.so_luong_da_nhan) dang_ve from kho.don_mua_dong dd join kho.don_mua d on d.id=dd.don_mua_id
           where d.trang_thai in ('da_gui','xac_nhan') group by dd.vat_tu_id, d.kho_id) po
  on po.vat_tu_id=k.vat_tu_id and po.kho_id=k.kho_id;
comment on view kho.v_ton_kha_dung is 'WP-32/QD-52: khả dụng = tồn − giữ chỗ (+ PO đang về). Nền tồn+giữ chỗ+PO.';
grant select on kho.v_ton_kha_dung to authenticated;

create or replace function kho.giu_cho_ds(p_don_hang_id uuid)
  returns table(id uuid, mon_id uuid, ten_mon text, vat_tu_id uuid, ma text, ten text, so_luong_giu numeric,
                so_luong_da_xuat numeric, trang_thai text, nguon text, kho_id uuid)
  language plpgsql stable security definer set search_path = kho set jit='off' as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('kho','ceo','xuong','thiet_ke') then raise exception 'giu_cho_ds: chỉ kho/ceo/xuong/thiet_ke'; end if;
  return query
  select g.id, g.don_hang_mon_id, m.ten, g.vat_tu_id, v.ma, v.ten, g.so_luong_giu, g.so_luong_da_xuat, g.trang_thai, b.nguon, g.kho_id
  from kho.giu_cho g
  left join kho.don_hang_mon m on m.id = g.don_hang_mon_id
  left join kho.vat_tu v on v.id = g.vat_tu_id
  left join kho.don_hang_mon_bom b on b.id = g.don_hang_mon_bom_id
  where g.don_hang_id = p_don_hang_id
  order by g.trang_thai, m.tao_luc, v.ma;
end $$;
revoke all on function kho.giu_cho_ds(uuid) from public, anon;
grant execute on function kho.giu_cho_ds(uuid) to authenticated;

-- ═══════════ B · ban_giao_xuong + GIỮ CHỖ (copy verbatim db/071 + khối WP-32 trước return) ═══════════
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
    select v_don.id, b.mon_id, b.id, b.vat_tu_id, v_kho, b.so_luong, v_ns
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
  select coalesce(jsonb_agg(jsonb_build_object('vat_tu_id', x.vat_tu_id, 'thieu', round(-x.kd, 4))), '[]'::jsonb) into v_vt_thieu
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

do $$ begin
  if to_regclass('kho.giu_cho') is null then raise exception 'giu_cho CHƯA tạo'; end if;
  if to_regclass('kho.v_ton_kha_dung') is null then raise exception 'v_ton_kha_dung CHƯA tạo'; end if;
  if to_regprocedure('kho.giu_cho_ds(uuid)') is null then raise exception 'giu_cho_ds CHƯA tạo'; end if;
  raise notice 'db/130 OK: giu_cho (soft) + v_ton_kha_dung + giu_cho_ds + ban_giao_xuong sinh giữ chỗ + trigger huỷ.';
end $$;
commit;
