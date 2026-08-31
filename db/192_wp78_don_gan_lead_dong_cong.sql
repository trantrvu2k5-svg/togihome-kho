-- db/192 · WP-78 L-04 vá · don_gan_lead ĐÓNG cổng GUC ngay sau UPDATE (phòng thủ).
--   GỐC: set_config('kho.don_gan_lead_ok','1',true) là transaction-local → nếu ai bọc don_gan_lead + UPDATE khác
--     trong CÙNG một transaction, cổng còn mở cho UPDATE sau. Prod (PostgREST 1 RPC = 1 tx) không rò, nhưng đóng
--     cổng ngay sau UPDATE khiến bất biến "chỉ RPC đổi được lead_id" đúng KỂ CẢ khi bọc transaction.
--   ⚠ KHÔNG IDEMPOTENT (or-replace an toàn). Cổng backup QD-61, CẤM tự bật BO_QUA_BACKUP.
--   HOÀN TÁC: tạo lại don_gan_lead bản db/191.
begin;

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
  perform set_config('kho.don_gan_lead_ok','1',true);   -- MỞ cổng trigger don_hang.lead_id
  update kho.don_hang set
    lead_id = p_lead_id,
    nguon_khach = case when v_ad is not null then 'quang_cao' else nguon_khach end,
    sua_luc = now()
  where id = p_don_id;
  perform set_config('kho.don_gan_lead_ok','',true);    -- ĐÓNG cổng NGAY (chỉ mở đúng 1 UPDATE trên)
  insert into kho.don_hang_lead_nhat_ky(don_id, tu, den, nguoi_id, luc, ly_do)
    values(p_don_id, v_old, p_lead_id, v_ns, now(), coalesce(nullif(btrim(p_ly_do),''), 'gắn lần đầu'));
  return jsonb_build_object('ket', case when v_old is null then 'gan_moi' else 'doi' end, 'lead_id', p_lead_id, 'nguon_khach_set', v_ad is not null);
end $fn$;

do $$ begin raise notice 'db/192 OK: don_gan_lead đóng cổng GUC ngay sau UPDATE.'; end $$;
commit;
