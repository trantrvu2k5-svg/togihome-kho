-- 111 — VÁ LỖ "+ Lên đơn": gác nguon_khach MỌI đường VÀO moi_len_don (không chỉ bao_gia→moi_len_don) (L-46b, vá L-45).
--   ⚠ IDEMPOTENT: create or replace (giữ chữ ký returns trigger — KHÔNG overload) → chạy 1 lần vẫn an toàn chạy lại.
--   LỖ (L-45b): app "+ Lên đơn" INSERT THẲNG moi_len_don không qua bao_gia → gác db/109 (chỉ soi UPDATE bao_gia→moi)
--     bỏ qua → đơn thiếu nguon_khach lọt.
--   VÁ: gác khi ĐƠN VÀO moi_len_don (INSERT thẳng HOẶC UPDATE từ trạng thái KHÁC moi_len_don).
--   Phạm vi: CHỈ người dùng THẬT (current_vai_tro() <> '') — app authenticated bị gác (đóng lỗ). Seed/service (raw,
--     không jwt → vai null) BỎ QUA → không vỡ ~15 test seed INSERT moi_len_don qua raw connection. GUC chan.off_nguon
--     vẫn bypass (cho seed asK(vai) mô phỏng đơn legacy). Không hồi tố: đơn đã ở moi_len_don tiến tiếp KHÔNG dính.
--
-- ══════════ HOÀN TÁC ══════════
--   begin; -- chạy lại bản db/109 (gác chỉ ở nhánh bao_gia→moi_len_don). commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.kiem_chuyen_trang_thai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_thieu text;
  v_day   text[] := array['nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
                          'dang_lam','xong_sx','cho_giao','da_giao'];
begin
  -- ═══ L-46b: GÁC nguồn khách khi ĐƠN VÀO moi_len_don (mọi đường), CHỈ người dùng thật, không hồi tố ═══
  if new.trang_thai = 'moi_len_don'
     and (tg_op = 'INSERT' or old.trang_thai is distinct from 'moi_len_don')   -- ĐANG VÀO (không phải đã ở đó)
     and coalesce(kho.current_vai_tro(), '') <> ''                              -- người dùng thật; seed/service (no vai) bỏ qua
     and current_setting('chan.off_nguon', true) is distinct from '1'          -- bypass seed/test
     and coalesce(nullif(btrim(new.nguon_khach), ''), '') = '' then
    raise exception 'Chưa chọn nguồn khách — chọn rồi mới chốt đơn.';
  end if;

  -- ═══ (giữ nguyên db/035/048) nhánh RỜI bao_gia: cấm nhảy thẳng SX + món thiếu giá + du_an cần giá vốn ═══
  if tg_op = 'UPDATE' and old.trang_thai = 'bao_gia' and new.trang_thai <> 'bao_gia' then
    if current_setting('chan.off_nhay', true) is distinct from '1'
       and new.trang_thai = any (v_day) then
      raise exception 'Đơn báo giá "%" phải LÊN ĐƠN (moi_len_don) trước — không nhảy thẳng sang %',
        new.ma_don, new.trang_thai;
    end if;
    if new.trang_thai = 'moi_len_don' then
      if current_setting('chan.off_mon_gia', true) is distinct from '1' then
        select string_agg(coalesce(nullif(btrim(m.ten),''), m.sp_id, '(món chưa tên)'), ', ')
          into v_thieu from kho.don_hang_mon m where m.don_id = new.id and coalesce(m.gia,0) <= 0;
        if v_thieu is not null then raise exception 'Chưa lên đơn được — món thiếu giá: %', v_thieu; end if;
      end if;
      if current_setting('chan.off_von_chuyen', true) is distinct from '1'
         and new.dong = 'du_an'
         and not exists (select 1 from kho.don_hang_gia_von g
                         where g.ma_don = new.ma_don and g.gia_chuyen_giao is not null) then
        raise exception E'Đơn thiết kế "%" cần GIÁ VỐN mới lên đơn được. Ba cách gỡ:\n  1) Thiết kế dựng hình rồi ĐẨY GIÁ VỐN từ plugin.\n  2) ceo/kho NHẬP GIÁ VỐN TAY ở app tài chính (tab Giá vốn theo đơn).\n  3) Nếu đơn KHÔNG cần dựng hình (mua ngoài/giường gỗ), ĐỔI LOẠI ĐƠN sang Lẻ.',
          new.ma_don;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Trigger gốc (db/035) bind BEFORE UPDATE → INSERT thẳng moi_len_don KHÔNG kích hàm. Tái tạo gồm INSERT.
drop trigger if exists trg_kiem_chuyen_trang_thai on kho.don_hang;
create trigger trg_kiem_chuyen_trang_thai before insert or update on kho.don_hang
  for each row execute function kho.kiem_chuyen_trang_thai();

do $$ begin
  raise notice 'db/111 OK: gác nguon_khach MỌI đường vào moi_len_don (người dùng thật) + trigger gồm INSERT — vá lỗ + Lên đơn.';
end $$;
commit;
