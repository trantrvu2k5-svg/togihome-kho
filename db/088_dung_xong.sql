-- db/088 — cờ 'dung_xong' cho buoc_thiet_ke (L-46b · VIỆC 2 · QD-21)
--   Thêm bước GIỮA "đang dựng" và "đã gửi": lúc thiết kế dựng xong 3D nhưng CHƯA bấm gửi cho sale.
--   Miền mới: cho_nhan → dang_dung → dung_xong → cho_duyet → sua_gop_y → xong_file. NULL = chưa vào luồng.
--   Kanban báo giá (việc 4) cần cột "bản mới chưa gửi" = đơn ở dung_xong; không có giá trị này thì không tách được.
--
--   ⚠ IDEMPOTENT — chạy lại lần hai KHÔNG hỏng: nới CHECK bằng drop-if-exists + add; RPC create-or-replace
--     (chữ ký không đổi nên không cần drop). (db/069 từng dính lỗi không idempotent — lô này tránh.)
--   ⚠ KHÔNG đụng gui_ban_thiet_ke: đường gửi THẲNG dang_dung→cho_duyet (dựng xong gửi luôn) PHẢI còn chạy.
--   Chạy: cd web && node ops/run_sql.mjs ../db/088_dung_xong.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.danh_dau_dung_xong(text);
--   alter table kho.don_hang drop constraint if exists don_hang_buoc_thiet_ke_check;
--   alter table kho.don_hang add constraint don_hang_buoc_thiet_ke_check
--     check (buoc_thiet_ke in ('cho_nhan','dang_dung','cho_duyet','sua_gop_y','xong_file'));
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─────────── 1. Nới CHECK: thêm 'dung_xong' (idempotent) ───────────
alter table kho.don_hang drop constraint if exists don_hang_buoc_thiet_ke_check;
alter table kho.don_hang add  constraint don_hang_buoc_thiet_ke_check
  check (buoc_thiet_ke in ('cho_nhan','dang_dung','dung_xong','cho_duyet','sua_gop_y','xong_file'));

-- ─────────── 2. RPC danh_dau_dung_xong: thiết kế bấm "Đã dựng xong" ───────────
--   VÌ SAO CÓ HÀM NÀY: đánh dấu đơn đã DỰNG XONG 3D nhưng CHƯA gửi cho sale, để kanban tách được cột
--   "bản mới chưa gửi" (khác với "đang dựng" = còn làm dở). Không thay đường gửi thẳng — thiết kế vẫn có thể
--   bỏ qua bước này mà gửi bản luôn (gui_ban_thiet_ke set cho_duyet từ bất kỳ bước nào).
--   CHỈ cho set khi đang ở 'dang_dung' (đang dựng); bước khác gọi vào → chặn, báo rõ bước hiện tại.
create or replace function kho.danh_dau_dung_xong(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_vai text := coalesce(kho.current_vai_tro(),''); v_don kho.don_hang;
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom_thiet_ke','ceo') then
    raise exception 'danh_dau_dung_xong: chỉ thiet_ke/tk_ban_hang/truong_nhom_thiet_ke/ceo (vai "%")',
      coalesce(nullif(v_vai,''),'(chưa đăng nhập)');
  end if;
  select * into v_don from kho.don_hang where ma_don = p_ma_don;
  if v_don.ma_don is null then raise exception 'danh_dau_dung_xong: không có đơn "%"', p_ma_don; end if;
  if v_don.buoc_thiet_ke is distinct from 'dang_dung' then
    raise exception 'danh_dau_dung_xong: đơn "%" đang ở bước "%" — chỉ đánh dấu DỰNG XONG khi đang dựng (dang_dung)',
      p_ma_don, coalesce(v_don.buoc_thiet_ke,'(chưa vào luồng)');
  end if;
  update kho.don_hang set buoc_thiet_ke = 'dung_xong' where ma_don = p_ma_don;
  return jsonb_build_object('ok', true, 'ma_don', p_ma_don, 'buoc_thiet_ke', 'dung_xong');
end $$;
grant execute on function kho.danh_dau_dung_xong(text) to authenticated;

do $$ begin
  if to_regprocedure('kho.danh_dau_dung_xong(text)') is null then raise exception 'THIẾU danh_dau_dung_xong'; end if;
  raise notice 'db/088 OK: buoc_thiet_ke +dung_xong · danh_dau_dung_xong (gác vai, chỉ từ dang_dung)';
end $$;

commit;
