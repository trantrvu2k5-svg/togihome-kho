-- 109 — ÉP nguon_khach tại cổng chốt đơn + DEDUPE khách theo sdt + KHÁCH MỚI/CŨ (L-45).
--   ⚠ IDEMPOTENT: create or replace function + create trigger (drop trigger if exists trước) → chạy 1 lần vẫn an toàn chạy lại.
--   a) kiem_chuyen_trang_thai (CREATE OR REPLACE, GIỮ nguyên chữ ký returns trigger — KHÔNG overload): thêm gác
--      "rời bao_gia sang moi_len_don PHẢI có nguon_khach". CHỈ bắn khi UPDATE bao_gia→moi_len_don → KHÔNG hồi tố
--      (đơn INSERT thẳng moi_len_don hay đơn đã qua từ trước KHÔNG dính). Bypass test: GUC chan.off_nguon='1'.
--   b+c) tg_dong_bo_khach (BEFORE INSERT/UPDATE don_hang): upsert kho.khach theo sdt_khach + khi vào da_giao tính
--        khach_moi theo ngay_mua_dau (chưa có → mới=true + set ngay_mua_dau=ngay_giao; đã có → GIỮ, mới=false).
--   e) khach.sdt ĐÃ là UNIQUE PK (khach_pkey), 0 trùng — không cần thêm index.
--   ⚠ KHÔNG làm phần d (drop cột kgs/khach_sdt) — kgs là ARRAY "không gian" (KHÔNG phải kg), khach_sdt có FK+db/104.
--      Xem ~/Downloads/l45_nguon_khach.md — chờ CEO quyết lại.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop trigger if exists trg_dong_bo_khach on kho.don_hang;
--   drop function if exists kho.tg_dong_bo_khach();
--   -- kiem_chuyen_trang_thai: chạy lại bản db/048 (bỏ khối gác nguon_khach).
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ a. GÁC nguon_khach tại cổng bao_gia → moi_len_don ═══════════════
--   Bản gốc db/035 + db/048 (đọc LIVE trước khi sửa). Chỉ THÊM một khối gác trong nhánh moi_len_don; giữ y nguyên phần còn lại.
create or replace function kho.kiem_chuyen_trang_thai() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare
  v_thieu text;
  v_day   text[] := array['nhan_thiet_ke','dang_thiet_ke','xong_file','cho_cat','da_cat',
                          'dang_lam','xong_sx','cho_giao','da_giao'];
begin
  if tg_op = 'UPDATE' and old.trang_thai = 'bao_gia' and new.trang_thai <> 'bao_gia' then
    if current_setting('chan.off_nhay', true) is distinct from '1'
       and new.trang_thai = any (v_day) then
      raise exception 'Đơn báo giá "%" phải LÊN ĐƠN (moi_len_don) trước — không nhảy thẳng sang %',
        new.ma_don, new.trang_thai;
    end if;
    if new.trang_thai = 'moi_len_don' then
      -- L-45: ÉP nguồn khách tại cổng CHỐT đơn (nhắc mềm ở báo giá, cứng ở đây).
      if current_setting('chan.off_nguon', true) is distinct from '1'
         and coalesce(nullif(btrim(new.nguon_khach), ''), '') = '' then
        raise exception 'Chưa chọn nguồn khách — chọn rồi mới chốt đơn.';
      end if;
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

-- ═══════════════ b+c. DEDUPE khách + KHÁCH MỚI/CŨ ═══════════════
create or replace function kho.tg_dong_bo_khach() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_sdt text := nullif(btrim(new.sdt_khach), ''); v_nmd date;
begin
  if v_sdt is not null then
    -- b) upsert khach theo sdt (tạo nếu chưa có; nối ten nếu đang trống)
    insert into kho.khach(sdt, ten) values (v_sdt, nullif(btrim(new.ten_khach), ''))
      on conflict (sdt) do update set ten = coalesce(kho.khach.ten, excluded.ten);
    -- c) khi VÀO da_giao (lần đầu): tính khach_moi theo ngay_mua_dau
    if new.trang_thai = 'da_giao'
       and (tg_op = 'INSERT' or old.trang_thai is distinct from 'da_giao')
       and current_setting('chan.off_khachmoi', true) is distinct from '1' then
      select ngay_mua_dau into v_nmd from kho.khach where sdt = v_sdt;
      if v_nmd is null then
        new.khach_moi := true;
        update kho.khach set ngay_mua_dau = coalesce(new.ngay_giao, current_date)
          where sdt = v_sdt and ngay_mua_dau is null;   -- KHÔNG ghi đè ngay_mua_dau đã có
      else
        new.khach_moi := false;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_dong_bo_khach on kho.don_hang;
create trigger trg_dong_bo_khach before insert or update on kho.don_hang
  for each row execute function kho.tg_dong_bo_khach();

do $$ begin
  if to_regprocedure('kho.tg_dong_bo_khach()') is null then raise exception 'THIẾU tg_dong_bo_khach'; end if;
  raise notice 'db/109 OK: gác nguon_khach + dedupe khách + khach_moi. (phần drop cột kgs/khach_sdt HOÃN — xem báo cáo)';
end $$;
commit;
