-- 146 — WP-37 tầng 1: MỞ CỬA BÁO GIÁ cho plugin (QD-63).
--   Đơn bao_gia/bao_gia_treo hiện trong danh sách plugin + nhận BOM/giá vốn mốc du_kien; vai tk_ban_hang đẩy được.
--   Đẩy ở báo giá KHÔNG giữ chỗ, KHÔNG đổi trạng thái, KHÔNG tem. bao_gia_thua KHÔNG mở. Giá vốn 1-dòng-ghi-đè.
--   ⚠ CHẠY QUA: cd web && node ops/run_sql.mjs ../db/146_wp37_cua_bao_gia.sql   (cổng backup QD-61 tự chạy)
--   IDEMPOTENT: drop+create hàm/trigger; chạy lại vô hại.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop trigger if exists trg_chan_bom_chuan_bao_gia on kho.don_hang_mon_bom;
--   drop function if exists kho.chan_bom_chuan_bao_gia();
--   -- rồi chạy lại db/050 (don_cho_thiet_ke bản cũ) + db/036 (ghi_gia_von_don bản cũ) để phục hồi guard vai/trạng thái.
--   commit;
-- ═══════════════════════════════

begin;

-- ═══════════ 2a · don_cho_thiet_ke — nới trạng thái + vai + trả cột trang_thai ═══════════
--   ĐỔI RETURN (thêm cột trang_thai) → phải DROP bản cũ trước (bẫy overload/đổi kiểu trả về, 03 §C).
drop function if exists kho.don_cho_thiet_ke();
create or replace function kho.don_cho_thiet_ke()
  returns table(ma_don text, loai text, dong text, ngay_hen_khach date, ghi_chu_don text, la_demo boolean,
                trang_thai text,
                mon_id uuid, sp_id text, ten text, kich_thuoc text, vat_lieu text, ma_mau text,
                so_luong numeric, ghi_chu_mon text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  -- WP-37/QD-63: thêm tk_ban_hang (thiết kế bán hàng). coalesce chống NULL (03 §C).
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke','tk_ban_hang') then
    raise exception 'don_cho_thiet_ke: chỉ ceo/kho/thiet_ke/tk_ban_hang'; end if;
  return query
    select d.ma_don, d.loai, d.dong, d.ngay_hen_khach, d.ghi_chu, d.la_demo,
           d.trang_thai,
           m.id, m.sp_id, m.ten, m.kt, m.vl, m.ma_mau, m.so_luong, m.chi_tiet
    from kho.don_hang d
    join kho.don_hang_mon m on m.don_id = d.id
    -- WP-37/QD-63: thêm bao_gia + bao_gia_treo (KHÔNG bao_gia_thua — đơn thua đã bỏ).
    where d.trang_thai in ('bao_gia','bao_gia_treo','moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')
    order by d.ngay_hen_khach nulls last, d.ma_don, m.tao_luc nulls last, m.id;
end $$;
grant execute on function kho.don_cho_thiet_ke() to authenticated;

-- ═══════════ 2b · ghi_gia_von_don — thêm tk_ban_hang (chữ ký GIỮ NGUYÊN) ═══════════
--   KHÔNG đổi gì khác; KHÔNG chạm don_hang.trang_thai (chỉ ghi don_hang_gia_von + giờ).
create or replace function kho.ghi_gia_von_don(ma_don text, khoi_1 numeric, khoi_2 numeric, khoi_3 numeric,
                                               gia_chuyen_giao numeric, gio_xuong numeric default null)
  returns jsonb language plpgsql security definer set search_path = kho as $$
#variable_conflict use_column
declare v_uid uuid; v_gio_ghi boolean := false;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke','tk_ban_hang') then
    raise exception 'ghi_gia_von_don: chỉ ceo/kho/thiet_ke/tk_ban_hang được đẩy giá vốn';
  end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = ghi_gia_von_don.ma_don) then
    raise exception 'ghi_gia_von_don: không có đơn "%"', ghi_gia_von_don.ma_don;
  end if;
  select nd.id into v_uid from kho.nguoi_dung nd where nd.auth_uid = auth.uid();
  insert into kho.don_hang_gia_von (ma_don, khoi_1, khoi_2, khoi_3, gia_chuyen_giao, nguoi_day, cap_nhat_luc)
    values (ghi_gia_von_don.ma_don, ghi_gia_von_don.khoi_1, ghi_gia_von_don.khoi_2, ghi_gia_von_don.khoi_3,
            ghi_gia_von_don.gia_chuyen_giao, v_uid, now())
  on conflict (ma_don) do update set
    khoi_1 = excluded.khoi_1, khoi_2 = excluded.khoi_2, khoi_3 = excluded.khoi_3,
    gia_chuyen_giao = excluded.gia_chuyen_giao, nguoi_day = excluded.nguoi_day, cap_nhat_luc = excluded.cap_nhat_luc;
  if gio_xuong is not null and gio_xuong > 0 then
    insert into kho.gio_thiet_ke_thuc (ma_don, ma_ns, loai_gio, gio_thuc, cap, ghi_luc)
      values (ghi_gia_von_don.ma_don, v_uid, 'xuong', gio_xuong, null, now());
    v_gio_ghi := true;
  end if;
  return jsonb_build_object('ok', true, 'ma_don', ghi_gia_von_don.ma_don, 'nguoi_day', v_uid,
                            'gio_da_ghi', v_gio_ghi, 'luc', now());
end $$;
grant execute on function kho.ghi_gia_von_don(text, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ═══════════ 2c · luu_so_don_vi — BỎ QUA ═══════════
--   Plugin KHÔNG gọi luu_so_don_vi (chỉ app Thiết kế web dùng — grep RPC plugin: don_cho_thiet_ke/ghi_bom_mon/
--   ghi_gia_von_don/day_tem_ban_ve/ghi_san_luong_don/bom_ma_kho_ds/quy_doi_export). KHÔNG nới vai (giữ ceo/thiet_ke).

-- ═══════════ 2d · GÁC MỚI — BOM ở đơn báo giá CHỈ được du_kien (chặn 'chuan') ═══════════
--   ghi_bom_mon (db/143) luôn ghi moc='du_kien' (không có tham số moc) → đơn bao_gia tự nhiên chỉ du_kien.
--   Trigger này chặn MỌI đường lách (insert/update trực tiếp moc='chuan') khi đơn còn bao_gia*.
--   AN TOÀN với ban_giao_xuong: nó set trang_thai='cho_cat' (db/140:162) TRƯỚC khi promote BOM→chuan
--   (db/140:181) → lúc promote đơn KHÔNG còn bao_gia* → trigger cho qua.
create or replace function kho.chan_bom_chuan_bao_gia() returns trigger
  language plpgsql security definer set search_path = kho as $$
begin
  if new.moc = 'chuan' and exists (
       select 1 from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
       where m.id = new.mon_id
         and d.trang_thai in ('bao_gia','bao_gia_treo','bao_gia_thua')) then
    raise exception 'BOM_BAO_GIA_CHI_DU_KIEN: đơn đang ở báo giá — BOM chỉ mốc du_kien, không chuan (chốt qua ban_giao_xuong mới lên chuan).';
  end if;
  return new;
end $$;
drop trigger if exists trg_chan_bom_chuan_bao_gia on kho.don_hang_mon_bom;
create trigger trg_chan_bom_chuan_bao_gia before insert or update on kho.don_hang_mon_bom
  for each row execute function kho.chan_bom_chuan_bao_gia();

commit;
