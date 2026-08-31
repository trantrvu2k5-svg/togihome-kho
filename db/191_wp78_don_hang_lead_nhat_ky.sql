-- db/191 · WP-78 L-04 vá · Sổ vết ĐỔI LEAD (append-only) + don_gan_lead ghi vào đó. QD-83.
--   GỐC vá: don_hang_nhat_ky CHECK den = trạng-thái (enum), KHÔNG chứa được uuid lead → tách bảng riêng.
--   CÙNG KHUÔN don_hang_nhat_ky {don_id, tu, den, nguoi_id, luc, ly_do} (không phải kiểu vết thứ hai) — chỉ khác
--     kiểu cột tu/den = uuid lead thay vì text trạng-thái.
--   ⚠ KHÔNG IDEMPOTENT. Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: drop table kho.don_hang_lead_nhat_ky cascade; (khôi phục don_gan_lead bản db/190 nếu cần).
begin;

create table kho.don_hang_lead_nhat_ky (
  id       uuid primary key default gen_random_uuid(),
  don_id   uuid not null references kho.don_hang(id),
  tu       uuid null references kho.lead(id),          -- lead CŨ (NULL = gắn lần đầu)
  den      uuid not null references kho.lead(id),      -- lead MỚI
  nguoi_id uuid null,
  luc      timestamptz not null default now(),
  ly_do    text null
);
comment on table kho.don_hang_lead_nhat_ky is 'WP-78/QD-83: sổ vết ĐỔI lead trên đơn (append-only). Cùng khuôn don_hang_nhat_ky nhưng tu/den=uuid lead (don_hang_nhat_ky là trạng-thái).';
create index ix_dhlnk_don on kho.don_hang_lead_nhat_ky (don_id, luc desc);

-- append-only: cửa ghi DUY NHẤT = don_gan_lead (đường owner). Trigger chặn UPDATE/DELETE.
alter table kho.don_hang_lead_nhat_ky enable row level security;
alter table kho.don_hang_lead_nhat_ky force row level security;
revoke all on kho.don_hang_lead_nhat_ky from public, anon, authenticated;
create or replace function kho.dhlnk_chan_sua() returns trigger language plpgsql as $fn$
begin raise exception 'don_hang_lead_nhat_ky: sổ APPEND-ONLY — CẤM % (chỉ INSERT qua don_gan_lead)', tg_op; end $fn$;
create trigger dhlnk_chan_sua before update or delete on kho.don_hang_lead_nhat_ky for each row execute function kho.dhlnk_chan_sua();

-- ── don_gan_lead: ghi vết vào bảng MỚI (thay don_hang_nhat_ky) ──
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
  perform set_config('kho.don_gan_lead_ok','1',true);   -- mở cổng trigger don_hang.lead_id
  update kho.don_hang set
    lead_id = p_lead_id,
    nguon_khach = case when v_ad is not null then 'quang_cao' else nguon_khach end,   -- QD-76: chỉ xac_dinh (có ad) mới đổi
    sua_luc = now()
  where id = p_don_id;
  insert into kho.don_hang_lead_nhat_ky(don_id, tu, den, nguoi_id, luc, ly_do)
    values(p_don_id, v_old, p_lead_id, v_ns, now(), coalesce(nullif(btrim(p_ly_do),''), 'gắn lần đầu'));
  return jsonb_build_object('ket', case when v_old is null then 'gan_moi' else 'doi' end, 'lead_id', p_lead_id, 'nguon_khach_set', v_ad is not null);
end $fn$;
revoke execute on function kho.don_gan_lead(uuid,uuid,text) from public, anon;
grant  execute on function kho.don_gan_lead(uuid,uuid,text) to authenticated;

do $$ begin
  if to_regclass('kho.don_hang_lead_nhat_ky') is null then raise exception 'THIẾU bảng vết'; end if;
  raise notice 'db/191 OK: don_hang_lead_nhat_ky (append-only) + don_gan_lead ghi vào đó.';
end $$;
commit;
