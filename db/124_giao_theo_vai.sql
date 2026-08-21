-- 124 — VÁ LUẬT CHUYỂN: sale/tk_ban_hang (giao_thu) ĐƯỢC set da_giao (WP-03 (c) / L-67).
--   GỐC: chan_chuyen_theo_vai (db/038) gộp 'cho_giao','da_giao' → chỉ ceo/kho/xuong/ke_toan. Nhưng GIAO HÀNG là
--   việc của sale/tk_ban_hang (quyền giao_thu). Nút "Đã giao xong" ở Sale bấm bởi sale sẽ bị DB chặn.
--   VÁ: TÁCH hai trạng thái — cho_giao (xưởng tự set) giữ nguyên; da_giao (giao hàng) thêm sale + tk_ban_hang.
--   kiem_chuyen_trang_thai (db/109/111/115) KHÔNG chặn cho_giao→da_giao (chỉ chặn nhảy từ bao_gia) → giữ nguyên.
--   IDEMPOTENT: create or replace. HOÀN TÁC: chạy lại db/038 (dòng gộp cho_giao/da_giao).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.chan_chuyen_theo_vai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v text; ok boolean;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  if current_setting('chan.tu_mon', true) = '1' then return new; end if;         -- món tự đẩy: cho qua
  if current_setting('chan.off_vai', true) = '1' then return new; end if;         -- test đối chứng
  v := coalesce(kho.current_vai_tro(),'');
  ok := case
    when new.trang_thai in ('bao_gia','bao_gia_thua','bao_gia_treo','moi_len_don') then v in ('ceo','kho','sale','tk_ban_hang')
    when new.trang_thai in ('nhan_thiet_ke','dang_thiet_ke','xong_file')            then v in ('ceo','kho','thiet_ke')
    when new.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx')                then v in ('ceo','kho','xuong','tho')
    when new.trang_thai = 'cho_giao'                                               then v in ('ceo','kho','xuong','ke_toan')
    when new.trang_thai = 'da_giao'                                                then v in ('ceo','kho','xuong','ke_toan','sale','tk_ban_hang')
    when new.trang_thai in ('tam_ngung','huy')                                      then v in ('ceo','kho','sale','tk_ban_hang','xuong')
    else false end;
  if not ok then
    raise exception 'Vai "%" không được chuyển đơn sang trạng thái "%"', coalesce(nullif(v,''),'(chưa đăng nhập)'), new.trang_thai;
  end if;
  return new;
end $$;

commit;
