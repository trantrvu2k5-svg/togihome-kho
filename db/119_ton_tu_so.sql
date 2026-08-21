-- 119 — TỒN = TỔNG TỪ SỔ giao_dich (WP-11 / L-58). Bảng `ton` chỉ là CACHE, CHỈ trigger trên INSERT giao_dich ghi nó.
--   CĂN CỨ: ERP Sagegg & Alfnes §3.3.5 (tồn suy từ giao dịch; bảng tồn chỉ làm tươi khi có giao dịch hoàn tất).
--   ⚠ IDEMPOTENT: add column if not exists · create or replace hàm · drop policy/trigger if exists · drop function đúng chữ ký.
--   THỨ TỰ: (1) cột stt + backfill TRƯỚC khi khoá; (2) trigger cache tồn; (3) 2 RPC bỏ UPDATE ton; (4) append-only + khoá.
--
--   GHI QUÝ (đọc kỹ trước khi "sửa lại cho gọn"):
--   - Dấu nằm TRONG so_luong (nhập +, xuất −, điều chỉnh ±). delta = new.so_luong. so_du_sau do TRIGGER tính (nguồn duy nhất).
--   - giao_dich KHÔNG có cột đơn giá → gia_von_bq tính lại trong TRIGGER từ LÔ SỐNG (lo_nhap.gia_von_lo), chỉ khi có lô sống
--     có giá (đường không-lô: kiểm kê/seed → KHÔNG đụng gia_von_bq, giữ nguyên). Đây là điểm lệch với gợi ý "trigger không đụng
--     gia_von_bq" — chọn vậy vì T5 cấm RPC update ton mà giá vốn phải đúng; logic y hệt huy_phieu cũ. Xem QD-44 + báo cáo.
--   - Âm kho: RPC cũ CHO PHÉP (gắn cờ ton_am, không raise) → GIỮ cho phép; trigger chỉ gắn canh_bao='ton_am', KHÔNG raise.
--
-- HOÀN TÁC: chạy lại db/006/008/014/015/037 (bản RPC cũ + policy ghi_ceo_kho/gd_ceo_kho + quet_giao_dich) rồi
--   drop trigger gd_ins_cap_ton, gd_chan_sua on kho.giao_dich; drop function gd_cap_nhat_ton, gd_chan_sua_xoa;
--   alter table kho.giao_dich drop column stt; drop view v_ton_tu_so.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Gỡ trigger chặn-sửa TRƯỚC (để backfill UPDATE chạy được khi chạy lại migration).
drop trigger if exists gd_chan_sua on kho.giao_dich;

-- ═══════════ 1 · CỘT THỨ TỰ stt (bigserial) — "dòng cuối" = order by stt desc ═══════════
alter table kho.giao_dich add column if not exists stt bigint;
update kho.giao_dich g set stt = s.rn
  from (select id, row_number() over (order by tao_luc, id) rn from kho.giao_dich) s
  where s.id = g.id and g.stt is null;                       -- backfill: chỉ dòng chưa có stt
create sequence if not exists kho.giao_dich_stt_seq owned by kho.giao_dich.stt;
select setval('kho.giao_dich_stt_seq', coalesce((select max(stt) from kho.giao_dich), 0) + 1, false);
alter table kho.giao_dich alter column stt set default nextval('kho.giao_dich_stt_seq');
alter table kho.giao_dich alter column stt set not null;
create unique index if not exists uq_giao_dich_stt on kho.giao_dich(stt);
drop index if exists kho.ix_giao_dich_vt_kho_stt;
create index if not exists ix_giao_dich_vt_kho_stt on kho.giao_dich(vat_tu_id, kho_id, stt desc) include (so_du_sau, so_luong);  -- distinct-on "dòng cuối/mã" INDEX-ONLY + reconcile + v_ton_tu_so
create index if not exists ix_lo_nhap_vt_kho on kho.lo_nhap(vat_tu_id, kho_id) where lo_da_huy = false;  -- trigger tính gia_von_bq từ lô sống
grant usage on sequence kho.giao_dich_stt_seq to authenticated;   -- ceo/kho/tho INSERT giao_dich thẳng cần nextval(stt)

-- ═══════════ 2 · TRIGGER cache tồn (nguồn DUY NHẤT ghi ton) ═══════════
create or replace function kho.gd_cap_nhat_ton() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare cur numeric; moi numeric; co_lo boolean;
begin
  -- khoá dòng ton (tạo nếu chưa có)
  select so_luong into cur from ton where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id for update;
  if not found then
    insert into ton(vat_tu_id, kho_id, so_luong) values(new.vat_tu_id, new.kho_id, 0)
      on conflict (vat_tu_id, kho_id) do nothing;
    select so_luong into cur from ton where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id for update;
  end if;
  moi := coalesce(cur,0) + new.so_luong;        -- delta = new.so_luong (đã có dấu)
  new.so_du_sau := moi;                          -- TRIGGER là nguồn duy nhất của so_du_sau
  if moi < 0 then new.canh_bao := coalesce(new.canh_bao, 'ton_am'); end if;   -- giữ luật cũ: cho phép âm, chỉ gắn cờ
  -- gia_von_bq = bình quân gia quyền từ LÔ SỐNG có giá; NULL khi hết lô sống (y hệt huy_phieu cũ). Có ix_lo_nhap_vt_kho → nhanh.
  update ton set so_luong = moi, sua_luc = now(),
    gia_von_bq = (select round(sum(con_lai * gia_von_lo) / nullif(sum(con_lai), 0))
                  from lo_nhap where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id
                    and lo_da_huy = false and con_lai > 0 and gia_von_lo is not null)
    where vat_tu_id = new.vat_tu_id and kho_id = new.kho_id;
  return new;
end $$;
comment on function kho.gd_cap_nhat_ton() is 'QD-44: cache tồn — nguồn DUY NHẤT ghi ton (so_luong+so_du_sau+gia_von_bq từ lô), BEFORE INSERT giao_dich';
drop trigger if exists gd_ins_cap_ton on kho.giao_dich;
create trigger gd_ins_cap_ton before insert on kho.giao_dich for each row execute function kho.gd_cap_nhat_ton();

-- ═══════════ 3 · 2 RPC: BỎ mọi UPDATE ton (chỉ INSERT giao_dich + xử lý lo_nhap) ═══════════
create or replace function kho.ghi_so_phieu(p_loai text, p_ncc uuid, p_ly_do text, p_ghi_chu text, p_dong jsonb, p_ma_to text default null)
  returns jsonb language plpgsql security definer set search_path to 'kho' as $function$
declare vt text; sp text; pid uuid; kid uuid; uid uuid; d jsonb;
        vid uuid; sl numeric; dg numeric; cur numeric; moi numeric; am text[] := '{}';
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được ghi sổ'; end if;
  if p_loai not in ('nhap','xuat') then raise exception 'loai phải nhap/xuat'; end if;
  if p_loai = 'xuat' and p_ma_to is null then raise exception 'Phiếu xuất phải chọn TỔ nhận'; end if;
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
    select so_luong into cur from ton where vat_tu_id=vid and kho_id=kid; cur := coalesce(cur,0);   -- chỉ ĐỌC (trigger seed/ghi)
    if p_loai='nhap' then
      insert into lo_nhap(vat_tu_id,kho_id,phieu_id,so_luong_nhap,gia_von_lo,con_lai,nguoi_thao_tac)
        values(vid,kid,pid,sl,dg,sl,uid);                                                          -- lô TRƯỚC → trigger thấy để tính gia_von_bq
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(vid,kid,'nhap', sl, pid, 0, 'phieu', uid);                                          -- so_du_sau=0 placeholder → trigger ghi đè
    else
      moi := cur - sl;
      declare con numeric := sl; tru numeric; lg record;
      begin
        for lg in select id, con_lai from lo_nhap where vat_tu_id=vid and kho_id=kid and con_lai>0 order by tao_luc asc, id asc loop
          exit when con <= 0;
          tru := least(lg.con_lai, con);
          update lo_nhap set con_lai = con_lai - tru where id = lg.id;                             -- trừ lô TRƯỚC
          con := con - tru;
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,lo_nhap_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -tru, pid, lg.id, 0, 'phieu', uid);
        end loop;
        if con > 0 then
          insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
            values(vid,kid,'xuat', -con, pid, 0, 'phieu', uid);
        end if;
      end;
      if moi < 0 then am := am || vid::text; end if;
    end if;
  end loop;
  return jsonb_build_object('so_phieu', sp, 'ton_am', am);
end $function$;
comment on function kho.ghi_so_phieu(text,uuid,text,text,jsonb,text) is 'QD-44: chỉ INSERT giao_dich + lo_nhap; KHÔNG update ton (trigger lo)';

create or replace function kho.huy_phieu(p_so_phieu text, p_ly_do text)
  returns text language plpgsql security definer set search_path to 'kho' as $function$
declare vt text; uid uuid; kid uuid; g record; sp_ng text; pid_ng uuid; vid uuid; qty numeric; rec record;
begin
  vt := current_vai_tro();
  if vt is null or vt not in ('ceo','kho') then raise exception 'Chỉ CEO/kho được huỷ phiếu'; end if;
  if p_ly_do is null or btrim(p_ly_do) = '' then raise exception 'Phải nhập lý do huỷ (sổ lệch mà không rõ vì sao thì vô dụng)'; end if;
  select * into g from phieu where so_phieu = p_so_phieu;
  if not found then raise exception 'Không có phiếu %', p_so_phieu; end if;
  if g.trang_thai = 'da_huy' then raise exception 'Phiếu % đã bị huỷ rồi — không huỷ hai lần', p_so_phieu; end if;
  if g.trang_thai <> 'ghi_so' then raise exception 'Chỉ huỷ được phiếu ĐÃ GHI SỔ — phiếu % đang ở trạng thái "%"', p_so_phieu, g.trang_thai; end if;
  kid := g.kho_id;
  select id into uid from nguoi_dung where auth_uid = auth.uid();
  if g.loai = 'nhap' then
    for rec in select l.con_lai, l.so_luong_nhap, v.ma from lo_nhap l join vat_tu v on v.id=l.vat_tu_id where l.phieu_id=g.id loop
      if rec.con_lai < rec.so_luong_nhap then
        raise exception 'Không huỷ được: lô của mã % đã xuất % (còn %/% cái). Phải dùng phiếu ĐIỀU CHỈNH thay vì huỷ.',
          rec.ma, (rec.so_luong_nhap - rec.con_lai), rec.con_lai, rec.so_luong_nhap; end if;
    end loop;
  end if;
  sp_ng := cap_so_phieu(case when g.loai='nhap' then 'HN' else 'HX' end);
  insert into phieu(so_phieu,loai,kho_id,trang_thai,ncc_id,ly_do,phieu_goc_id,ghi_so_luc,ghi_so_boi,nguoi_thao_tac)
    values(sp_ng,'dieu_chinh',kid,'ghi_so',g.ncc_id,p_ly_do,g.id,now(),uid,uid) returning id into pid_ng;
  insert into phieu_dong(phieu_id,vat_tu_id,so_luong,don_gia,thanh_tien,ncc_id,ly_do)
    select pid_ng, pd.vat_tu_id, -pd.so_luong, pd.don_gia, case when pd.thanh_tien is not null then -pd.thanh_tien end, pd.ncc_id, p_ly_do
    from phieu_dong pd where pd.phieu_id = g.id;
  if g.loai = 'nhap' then
    for vid in select distinct l.vat_tu_id from lo_nhap l where l.phieu_id=g.id loop
      select coalesce(sum(so_luong_nhap),0) into qty from lo_nhap where phieu_id=g.id and vat_tu_id=vid;
      update lo_nhap set lo_da_huy=true, con_lai=0 where phieu_id=g.id and vat_tu_id=vid;             -- đảo lô TRƯỚC → trigger tính lại gia_von_bq từ lô sống
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(vid,kid,'dieu_chinh', -qty, pid_ng, 0, 'phieu', uid);
    end loop;
  else
    for rec in select lo_nhap_id, so_luong from giao_dich where phieu_id=g.id and lo_nhap_id is not null loop
      update lo_nhap set con_lai = con_lai + (-rec.so_luong) where id = rec.lo_nhap_id;               -- trả con_lai TRƯỚC
    end loop;
    for rec in select vat_tu_id as vid, sum(-so_luong) as qty from giao_dich where phieu_id=g.id group by vat_tu_id loop
      insert into giao_dich(vat_tu_id,kho_id,loai,so_luong,phieu_id,so_du_sau,nguon,nguoi_thao_tac)
        values(rec.vid,kid,'dieu_chinh', rec.qty, pid_ng, 0, 'phieu', uid);
    end loop;
  end if;
  update phieu set trang_thai='da_huy', sua_luc=now() where id=g.id;
  return sp_ng;
end $function$;
comment on function kho.huy_phieu(text,text) is 'QD-43+44: huỷ = ghi dòng đảo + đảo lô; KHÔNG update ton (trigger lo)';

-- ═══════════ 4 · APPEND-ONLY giao_dich (mẫu su_kien_quet) ═══════════
revoke update, delete on kho.giao_dich from public, anon, authenticated;
drop policy if exists gd_ceo_kho on kho.giao_dich;
drop policy if exists doc_dang_nhap on kho.giao_dich;
drop policy if exists gd_doc on kho.giao_dich;
drop policy if exists gd_ghi on kho.giao_dich;
create policy gd_doc on kho.giao_dich for select using (kho.current_vai_tro() is not null);
create policy gd_ghi on kho.giao_dich for insert with check (kho.current_vai_tro() = any(array['ceo','kho']));
-- gd_tho_quet (tho INSERT) GIỮ NGUYÊN — vai đang được ghi ở bước 0 (ceo/kho/tho).
alter table kho.giao_dich force row level security;
create or replace function kho.gd_chan_sua_xoa() returns trigger language plpgsql as $$
begin raise exception 'giao_dich là SỔ GHI THÊM — cấm UPDATE/DELETE (QD-44). Đính chính bằng dòng điều chỉnh mới.'; end $$;
create trigger gd_chan_sua before update or delete on kho.giao_dich for each row execute function kho.gd_chan_sua_xoa();

-- ═══════════ 5 · KHOÁ ton (chỉ SELECT; chỉ trigger owner ghi) ═══════════
revoke insert, update, delete on kho.ton from public, anon, authenticated;
drop policy if exists ghi_ceo_kho on kho.ton;
-- doc_dang_nhap (SELECT) trên ton GIỮ NGUYÊN.

-- ═══════════ 6 · KHAI TỬ quet_giao_dich (QD-45; db/037 giữ làm lịch sử) ═══════════
-- drop function xoá luôn mọi quyền execute — idempotent (chạy lại: hàm đã mất → no-op).
drop function if exists kho.quet_giao_dich(text,text,numeric);

-- ═══════════ 7 · VIEW kiểm chéo (chỉ test, app KHÔNG đọc) ═══════════
create or replace view kho.v_ton_tu_so as
  select vat_tu_id, kho_id, sum(so_luong) so_luong from kho.giao_dich group by vat_tu_id, kho_id;
comment on view kho.v_ton_tu_so is 'QD-44: tồn suy từ sổ (Σ so_luong) — đối chiếu cache ton; app KHÔNG đọc';

do $$ begin
  if to_regprocedure('kho.quet_giao_dich(text,text,numeric)') is not null then raise exception 'quet_giao_dich CHƯA drop'; end if;
  if exists(select 1 from pg_policies where schemaname='kho' and tablename='giao_dich' and cmd in ('ALL','UPDATE','DELETE')) then raise exception 'giao_dich còn policy ghi/sửa'; end if;
  raise notice 'db/119 OK: ton=Σ sổ (trigger) · giao_dich append-only (stt) · khai tử quet_giao_dich · v_ton_tu_so.';
end $$;
commit;
