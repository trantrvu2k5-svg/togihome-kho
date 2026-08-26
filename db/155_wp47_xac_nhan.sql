-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 155 — WP-47 (QD-68): VÁ LỖ A1 — đường XÁC NHẬN năng lực riêng, KHÔNG tách khoảng.
--   L-04 A1: nút "Lưu năng lực mới" (nl_ghi) đòi CÓ tổ đổi số → không "xác nhận số hiện có" được
--   (chip vàng không xoá được nếu số không đổi). Xác nhận ≠ sự kiện đổi năng lực → KHÔNG đẻ dòng
--   lịch sử giả (không đóng/mở khoảng, không đụng số) — chỉ set cờ trên khoảng ĐANG MỞ.
--   KHÔNG sửa nl_ghi (nl_ghi vẫn dùng khi số THẬT ở xưởng đổi).
--
--   HOÀN TÁC: drop function kho.nl_xac_nhan(text);
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.nl_xac_nhan(p_ma_to text)
  returns jsonb language plpgsql security definer set search_path = kho, public as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_ns uuid := kho.current_ns(); v_id bigint;
begin
  if v_vai not in ('xuong','ceo') then
    raise exception 'nl_xac_nhan: chỉ quản đốc (xuong) / ceo (vai "%")', v_vai; end if;
  if not exists (select 1 from kho.to_san_xuat where ma_to = p_ma_to) then
    raise exception 'nl_xac_nhan: không có tổ "%"', p_ma_to; end if;
  -- CHỈ set cờ trên khoảng ĐANG MỞ (den_ngay null). Không đóng/mở khoảng, không đụng số.
  update kho.nang_luc_to
     set xac_nhan = true, sua_boi = v_ns, sua_luc = now()
   where ma_to = p_ma_to and den_ngay is null
  returning id into v_id;
  if v_id is null then
    raise exception 'nl_xac_nhan: tổ "%" không có khoảng năng lực ĐANG MỞ', p_ma_to; end if;
  return jsonb_build_object('ok', true, 'ma_to', p_ma_to, 'id', v_id, 'xac_nhan', true);
end $$;
grant execute on function kho.nl_xac_nhan(text) to authenticated;

commit;
