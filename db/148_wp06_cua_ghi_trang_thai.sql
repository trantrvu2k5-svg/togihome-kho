-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 148 — WP-06 (QD-64): HAI CỬA RPC ghi trạng thái đơn cho app Sale. RPC là CỬA, 3 trigger là KHOÁ.
--   Nay client Sale UPDATE thẳng don_hang.trang_thai (grant-theo-cột db/131 + RLS dh_sua 7 vai) — TRẦN.
--   WP-06: chuyển MỌI lần ghi trạng thái của Sale qua 2 RPC dưới. KHÔNG viết lại / tắt / bypass GUC
--   3 trigger (trg_chan_chuyen_vai · trg_kiem_chuyen_trang_thai · trg_chan_lui_sx) — chúng vẫn KHOÁ.
--   REVOKE quyền cột nằm ở TẦNG L-06d (sau khi UI bỏ trang_thai khỏi payload, L-06c) — KHÔNG ở đây.
--
--   chot_don            : bao_gia|bao_gia_treo → moi_len_don (ghi nguồn+thương hiệu; để kiem_chuyen bắt món-giá).
--   doi_trang_thai_don  : whitelist {bao_gia, bao_gia_thua, bao_gia_treo, tam_ngung, huy} — lấy từ menu Sale
--                         (mã src/sale.js + public/togihome_sale.html). CHẶN CỨNG cho_cat + mọi trạng thái SX
--                         (da_cat/dang_lam/xong_sx/cho_giao/da_giao) — vào SX chỉ qua ban_giao_xuong (QD-47).
--   Cả hai: SECURITY DEFINER, search_path khoá, KHÔNG set chan.off_vai/chan.tu_mon. GRANT authenticated.
--
--   HOÀN TÁC: drop function kho.chot_don(uuid,text,text); drop function kho.doi_trang_thai_don(uuid,text,text);
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════ 1 · chot_don — chốt báo giá thành lên đơn ═══════════
drop function if exists kho.chot_don(uuid, text, text);
create function kho.chot_don(p_don_id uuid, p_nguon_khach text, p_thuong_hieu text)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
begin
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'chot_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'chot_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = 'moi_len_don' then
    raise exception 'chot_don: đơn "%" ĐÃ lên đơn rồi (moi_len_don)', v_don.ma_don; end if;
  if v_don.trang_thai not in ('bao_gia','bao_gia_treo') then
    raise exception 'chot_don: đơn "%" đang "%" — chỉ chốt được đơn báo giá (bao_gia/bao_gia_treo)', v_don.ma_don, v_don.trang_thai; end if;
  -- Ghi nguồn + thương hiệu (giữ giá trị cũ nếu tham số rỗng) rồi chuyển. kiem_chuyen_trang_thai (BEFORE UPDATE)
  --   TỰ bắt các điều kiện của nó (nguồn/thương hiệu trống, món giá<=0…) và RAISE — RPC KHÔNG chép lại luật đó,
  --   để lỗi nguyên văn nổi lên UI.
  update kho.don_hang
     set nguon_khach = coalesce(nullif(btrim(p_nguon_khach),''), nguon_khach),
         thuong_hieu = coalesce(nullif(btrim(p_thuong_hieu),''), thuong_hieu),
         trang_thai  = 'moi_len_don'
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', 'moi_len_don');
end $$;
grant execute on function kho.chot_don(uuid, text, text) to authenticated;

-- ═══════════ 2 · doi_trang_thai_don — các chuyển trạng thái CÒN LẠI của Sale ═══════════
drop function if exists kho.doi_trang_thai_don(uuid, text, text);
create function kho.doi_trang_thai_don(p_don_id uuid, p_trang_thai_moi text, p_ly_do text default null)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
  v_cho text[] := array['bao_gia','bao_gia_thua','bao_gia_treo','tam_ngung','huy'];   -- whitelist (từ menu Sale)
  v_sx  text[] := array['cho_cat','da_cat','dang_lam','xong_sx','cho_giao','da_giao'];
begin
  if v_vai not in ('ceo','kho','sale','tk_ban_hang') then
    raise exception 'doi_trang_thai_don: chỉ ceo/kho/sale/tk_ban_hang (vai "%")', v_vai; end if;
  -- CHẶN CỨNG: vào sản xuất chỉ qua ban_giao_xuong (QD-47); lên đơn dùng chot_don.
  if p_trang_thai_moi = any(v_sx) then
    raise exception 'doi_trang_thai_don: KHÔNG đổi sang "%" — vào sản xuất CHỈ qua bàn giao xưởng (QD-47)', p_trang_thai_moi; end if;
  if p_trang_thai_moi = 'moi_len_don' then
    raise exception 'doi_trang_thai_don: lên đơn dùng chot_don, không dùng hàm này'; end if;
  if not (p_trang_thai_moi = any(v_cho)) then
    raise exception 'doi_trang_thai_don: đích "%" không cho phép (chỉ: %)', p_trang_thai_moi, array_to_string(v_cho, ', '); end if;
  if p_trang_thai_moi in ('tam_ngung','huy') and coalesce(nullif(btrim(p_ly_do),''),'') = '' then
    raise exception 'doi_trang_thai_don: đổi sang "%" PHẢI có lý do', p_trang_thai_moi; end if;
  select * into v_don from kho.don_hang where id = p_don_id;
  if v_don.id is null then raise exception 'doi_trang_thai_don: không có đơn %', p_don_id; end if;
  if v_don.trang_thai = p_trang_thai_moi then
    raise exception 'doi_trang_thai_don: đơn "%" ĐÃ ở "%"', v_don.ma_don, p_trang_thai_moi; end if;
  -- Nếu là ĐƯỜNG LÙI từ sản xuất (chan_lui_san_xuat db/047 đòi lý do) → cung cấp moc.ly_do_lui (KHÔNG bypass,
  --   chỉ ĐẶT lý do đúng như db/047 yêu cầu). Vô hại nếu không phải đường lùi.
  if coalesce(nullif(btrim(p_ly_do),''),'') <> '' then
    perform set_config('moc.ly_do_lui', p_ly_do, true); end if;
  -- ly_do_huy: CHECK chk_huy_ly_do ép non-empty khi trạng thái ∈ (huy, tam_ngung).
  update kho.don_hang
     set trang_thai = p_trang_thai_moi,
         ly_do_huy  = case when p_trang_thai_moi in ('huy','tam_ngung') then p_ly_do else ly_do_huy end
   where id = p_don_id;
  return jsonb_build_object('ok', true, 'ma_don', v_don.ma_don, 'trang_thai', p_trang_thai_moi);
end $$;
grant execute on function kho.doi_trang_thai_don(uuid, text, text) to authenticated;

commit;
