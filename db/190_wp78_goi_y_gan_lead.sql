-- db/190 · WP-78 L-04 · Gợi ý lead theo SĐT + đường gắn có vết. QD-82/83.
--   ⚠ KHÔNG IDEMPOTENT: create function/trigger. Chạy ĐÚNG MỘT LẦN.
--   chuan_hoa_sdt = MỘT bản chuẩn hoá dùng chung (mirror laySdt của keo_lead_core, keo_lead_core stores sdt ĐÃ
--     chuẩn hoá lúc ingest; hàm này chuẩn hoá ĐẦU VÀO sale gõ về CÙNG dạng 0\d{9,10}). CẤM chép bản thứ hai đâu khác.
--     ⚠ COUPLING: chuan_hoa_sdt (SQL, truy vấn) và laySdt (JS, ingest Cloudflare) phải cho CÙNG dạng chuẩn — đổi
--     một bên phải đổi bên kia (runtime split không cho gọi chung một hàm).
--   ⚠ Cổng backup QD-61: dump fail → DỪNG. CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop trigger don_chan_sua_lead_id on kho.don_hang; drop function kho.don_chan_sua_lead_id,
--     kho.don_gan_lead(uuid,uuid,text), kho.lead_goi_y_theo_sdt(text), kho.chuan_hoa_sdt(text);
begin;

-- ── Chuẩn hoá SĐT (dùng chung; mirror laySdt): bỏ trắng/chấm/gạch/ngoặc; +84|84 đầu → 0; không 9–11 chữ số → NULL. ──
create or replace function kho.chuan_hoa_sdt(p text) returns text language sql immutable as $fn$
  with a as (select regexp_replace(coalesce(p,''), '[[:space:].()\-]', '', 'g') s),
  b as (select case
          when a.s like '+84%' then '0' || substr(a.s, 4)
          when a.s like '84%' and length(a.s) >= 11 then '0' || substr(a.s, 3)
          else a.s end s from a),
  c as (select regexp_replace(b.s, '\D', '', 'g') s from b)
  select case when c.s ~ '^\d{9,11}$' then c.s else null end from c;
$fn$;

-- ── VIỆC 1: gợi ý lead theo SĐT (CHỈ ĐỌC). Vai: sale/ceo. ads_user KHÔNG. ──
create or replace function kho.lead_goi_y_theo_sdt(p_sdt text)
returns table(lead_id uuid, ten_khach text, kenh text, ad_id text, muc_chac_chan text,
  khach_nhan_dau timestamptz, cham_cuoi timestamptz, chu_de text)
language plpgsql security definer set search_path to 'kho'
as $fn$
declare v_sdt text := kho.chuan_hoa_sdt(p_sdt);
begin
  if coalesce(kho.current_vai_tro(),'') not in ('sale','ceo') then
    raise exception 'lead_goi_y_theo_sdt: chỉ sale/ceo';
  end if;
  if v_sdt is null then return; end if;   -- SĐT gõ không hợp lệ → 0 dòng (không "gần đúng")
  return query
    select v.id, v.ten_khach,
      case when v.page_id like 'pzl%' then 'zalo' when v.page_id like 'igo%' then 'instagram' else 'messenger' end,
      v.ad_id, v.muc_chac_chan, v.thoi_diem_hoi_thoai, v.cham_cuoi_luc, v.loai_ma
    from kho.v_lead_hien_hanh v
    where v.sdt = v_sdt and v.sdt ~ '^\d{9,11}$'   -- sdt_hong/không parse được → không gợi ý
    order by v.thoi_diem_hoi_thoai desc
    limit 5;
end $fn$;
revoke execute on function kho.lead_goi_y_theo_sdt(text) from public, anon;
grant  execute on function kho.lead_goi_y_theo_sdt(text) to authenticated;

-- ── Trigger: don_hang.lead_id CHỈ đổi qua RPC (mở cổng bằng GUC transaction-local). Chặn UPDATE thẳng từ client. ──
create or replace function kho.don_chan_sua_lead_id() returns trigger language plpgsql as $fn$
begin
  if new.lead_id is distinct from old.lead_id and coalesce(current_setting('kho.don_gan_lead_ok', true),'') <> '1' then
    raise exception 'don_hang.lead_id: chỉ đổi qua RPC don_gan_lead (cổng DUY NHẤT, QD-83)';
  end if;
  return new;
end $fn$;
drop trigger if exists don_chan_sua_lead_id on kho.don_hang;
create trigger don_chan_sua_lead_id before update on kho.don_hang for each row execute function kho.don_chan_sua_lead_id();

-- ── VIỆC 2: cổng gắn lead DUY NHẤT (ngoài tao_don). Vai sale/ceo. ──
create or replace function kho.don_gan_lead(p_don_id uuid, p_lead_id uuid, p_ly_do text)
returns jsonb language plpgsql security definer set search_path to 'kho'
as $fn$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_old uuid; v_sdt_don text; v_sdt_lead text; v_ad text; v_ns uuid;
begin
  if v_vai not in ('sale','ceo') then raise exception 'don_gan_lead: chỉ sale/ceo'; end if;
  if p_lead_id is null then raise exception 'don_gan_lead: KHÔNG có đường gỡ về trống (QD-83) — đổi sang lead đúng, không để trống'; end if;
  select lead_id, sdt_khach into v_old, v_sdt_don from kho.don_hang where id = p_don_id;
  if not found then raise exception 'don_gan_lead: đơn % không tồn tại', p_don_id; end if;
  select sdt, ad_id into v_sdt_lead, v_ad from kho.lead where id = p_lead_id;
  if v_sdt_lead is null then raise exception 'don_gan_lead: lead % không tồn tại hoặc không có SĐT', p_lead_id; end if;
  if kho.chuan_hoa_sdt(v_sdt_don) is distinct from v_sdt_lead then
    raise exception 'don_gan_lead: SĐT lead (%) KHÔNG khớp SĐT khách trên đơn (%)', v_sdt_lead, coalesce(kho.chuan_hoa_sdt(v_sdt_don),'(đơn không có SĐT hợp lệ)');
  end if;
  if v_old is not distinct from p_lead_id then return jsonb_build_object('ket','khong_doi'); end if;
  if v_old is not null and coalesce(btrim(p_ly_do),'') = '' then
    raise exception 'don_gan_lead: ĐỔI lead bắt buộc có lý do (QD-83)';
  end if;
  v_ns := kho.current_ns();
  perform set_config('kho.don_gan_lead_ok','1',true);   -- mở cổng trigger (transaction-local)
  update kho.don_hang set
    lead_id = p_lead_id,
    nguon_khach = case when v_ad is not null then 'quang_cao' else nguon_khach end,   -- QD-76: chỉ xac_dinh (có ad) mới đổi
    sua_luc = now()
  where id = p_don_id;
  insert into kho.don_hang_nhat_ky(id, don_id, tu, den, nguoi_id, luc, ly_do)
    values(gen_random_uuid(), p_don_id, coalesce(v_old::text, '(chưa gắn)'), p_lead_id::text, v_ns, now(),
      coalesce(nullif(btrim(p_ly_do),''), 'gắn lần đầu'));
  return jsonb_build_object('ket', case when v_old is null then 'gan_moi' else 'doi' end, 'lead_id', p_lead_id, 'nguon_khach_set', v_ad is not null);
end $fn$;
revoke execute on function kho.don_gan_lead(uuid,uuid,text) from public, anon;
grant  execute on function kho.don_gan_lead(uuid,uuid,text) to authenticated;

do $$ begin
  if to_regprocedure('kho.don_gan_lead(uuid,uuid,text)') is null then raise exception 'THIẾU don_gan_lead'; end if;
  raise notice 'db/190 OK: chuan_hoa_sdt + lead_goi_y_theo_sdt + don_gan_lead + trigger chặn lead_id.';
end $$;
commit;
