-- 047 — CHỐT CHẶN Ở DB: cấm HẠ đơn đang sản xuất về moi_len_don/pre-SX. Vá app thôi thì lần sau ai sửa app
--   lại phá tiếp — trigger này là lưới cuối. Xem ~/Downloads/vong_chay/BAO_CAO_vong_chay.md.
--   node ops/run_sql.mjs ../db/047_chan_lui_san_xuat.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop trigger if exists trg_chan_lui_sx on kho.don_hang; drop function if exists kho.chan_lui_san_xuat(); commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Cấm đơn ĐANG/ĐÃ vào sản xuất (cho_cat..cho_giao) tụt về nhóm TRƯỚC-sản-xuất (moi_len_don, báo giá, thiết kế).
--   Chỉ ceo/xuong được lùi, và PHẢI có lý do (đặt GUC moc.ly_do_lui). Sale/tk_ban_hang: CHẶN tuyệt đối.
--   Bỏ qua khi món tự đẩy (chan.tu_mon=1) — món chỉ đi trong nhóm SX, không chạm nhánh này. Test: chan.off_lui=1.
--   KHÔNG chặn: đi TỚI (moi_len_don->cho_cat), đi trong SX (cho_giao->dang_lam khi món lùi), huỷ/tạm ngưng.
create or replace function kho.chan_lui_san_xuat() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_sx  text[] := array['cho_cat','da_cat','dang_lam','xong_sx','cho_giao'];
  v_lui text[] := array['moi_len_don','bao_gia','bao_gia_thua','bao_gia_treo','nhan_thiet_ke','dang_thiet_ke','xong_file'];
  v text;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  if current_setting('chan.tu_mon', true) = '1' then return new; end if;   -- món tự đẩy: tin
  if current_setting('chan.off_lui', true) = '1' then return new; end if;   -- test đối chứng
  if old.trang_thai = any(v_sx) and new.trang_thai = any(v_lui) then
    v := coalesce(kho.current_vai_tro(), '');
    if v not in ('ceo','xuong') then
      raise exception 'Không được hạ đơn "%" đang sản xuất (%) về "%" — chỉ ceo/xuong (vai "%").',
        new.ma_don, old.trang_thai, new.trang_thai, coalesce(nullif(v,''),'(chưa đăng nhập)');
    end if;
    if nullif(btrim(coalesce(current_setting('moc.ly_do_lui', true), '')), '') is null then
      raise exception 'Hạ đơn "%" từ sản xuất về "%" phải CÓ LÝ DO (đặt moc.ly_do_lui).', new.ma_don, new.trang_thai;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_chan_lui_sx on kho.don_hang;
create trigger trg_chan_lui_sx before update on kho.don_hang
  for each row execute function kho.chan_lui_san_xuat();

commit;
