-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 149 — WP-06 (QD-65): "Đã giao" do Sale bấm NHƯNG QUA CỔNG. Nới doi_trang_thai_don nhận da_giao,
--   CHỈ từ cho_giao, vai sale/ke_toan/ceo. KHÔNG sửa db/148 (migration đã áp = bất biến) — làm mới.
--
--   Nền (L-06c bước 1): da_giao là trạng thái mà SALE là đường DUY NHẤT (không RPC/trigger/app khác SET).
--   CEO uỷ quyền tôi quyết (25/08) → hướng A: giữ Sale bấm "Đã giao", nhưng đi qua doi_trang_thai_don
--   (không upsert thẳng nữa ở L-06c). Điểm chốt QD-65: da_giao là MỐC DOANH THU → cấm nhảy tắt, chỉ nhận
--   khi đơn ĐANG ở cho_giao.
--
--   Dấu vết: KHÔNG dựng bảng audit mới — trigger có sẵn trg_ghi_nk_don (AFTER UPDATE OF trang_thai) tự ghi
--   don_hang_nhat_ky(don_id, tu, den, nguoi_id, luc). doi_trang_thai_don chỉ UPDATE là dấu vết tự sinh.
--
--   HOÀN TÁC: chạy lại db/148 (bản doi_trang_thai_don cũ, chưa có nhánh da_giao).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.doi_trang_thai_don(p_don_id uuid, p_trang_thai_moi text, p_ly_do text default null)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
  v_cho text[] := array['bao_gia','bao_gia_thua','bao_gia_treo','tam_ngung','huy'];        -- whitelist thường
  v_sx  text[] := array['cho_cat','da_cat','dang_lam','xong_sx','cho_giao'];               -- [db/149] BỎ da_giao (xử riêng)
begin
  -- ═══ [QD-65] NHÁNH da_giao — "Đã giao": vai sale/ke_toan/ceo, CHỈ từ cho_giao ═══
  if p_trang_thai_moi = 'da_giao' then
    if v_vai not in ('sale','ke_toan','ceo') then
      raise exception 'doi_trang_thai_don(da_giao): chỉ sale/ke_toan/ceo (vai "%")', v_vai; end if;
    select * into v_don from kho.don_hang where id = p_don_id;
    if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
    if v_don.trang_thai = 'da_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" ĐÃ giao rồi', v_don.ma_don; end if;
    if v_don.trang_thai <> 'cho_giao' then
      raise exception 'doi_trang_thai_don: đơn "%" đang "%" — chưa ở bước CHỜ GIAO, không đánh dấu "Đã giao" được (da_giao là mốc chốt doanh thu, cấm nhảy tắt)', v_don.ma_don, v_don.trang_thai; end if;
    update kho.don_hang set trang_thai = 'da_giao' where id = p_don_id;   -- trg_ghi_nk_don TỰ ghi dấu vết người/lúc
    return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'da_giao');
  end if;

  -- ═══ các đích còn lại (KHÔNG da_giao) — như db/148 ═══
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'doi_trang_thai_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  if p_trang_thai_moi = any(v_sx) then
    raise exception 'doi_trang_thai_don: KHÔNG đổi sang "%" — vào sản xuất CHỈ qua bàn giao xưởng (QD-47)', p_trang_thai_moi; end if;
  if p_trang_thai_moi = 'moi_len_don' then
    raise exception 'doi_trang_thai_don: lên đơn dùng chot_don, không dùng hàm này'; end if;
  if not (p_trang_thai_moi = any(v_cho)) then
    raise exception 'doi_trang_thai_don: đích "%" không cho phép (chỉ: %, hoặc da_giao từ cho_giao)', p_trang_thai_moi, array_to_string(v_cho, ', '); end if;
  if p_trang_thai_moi in ('tam_ngung','huy') and coalesce(nullif(btrim(p_ly_do),''),'') = '' then
    raise exception 'doi_trang_thai_don: đổi sang "%" PHẢI có lý do', p_trang_thai_moi; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = p_trang_thai_moi then
    raise exception 'doi_trang_thai_don: đơn "%" ĐÃ ở "%"', v_don.ma_don, p_trang_thai_moi; end if;
  if coalesce(nullif(btrim(p_ly_do),''),'') <> '' then
    perform set_config('moc.ly_do_lui', p_ly_do, true); end if;
  update kho.don_hang
     set trang_thai = p_trang_thai_moi,
         ly_do_huy  = case when p_trang_thai_moi in ('huy','tam_ngung') then p_ly_do else ly_do_huy end
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', p_trang_thai_moi);
end $$;
grant execute on function kho.doi_trang_thai_don(uuid, text, text) to authenticated;

commit;
