-- WP-17b (2) L-15 · db/226 · quản đốc MỞ PHIÊN HỘ nhiều trạm (SỬA ĐÚNG BẢNG phien_tram/mo_phien).
-- ĐÍNH CHÍNH L-13 §C4: nguồn "ai làm" của quét (sq_ghi → phien_nguoi) là kho.phien_tram (mở bởi mo_phien),
--   KHÔNG phải ca_lam (mo_ca). ca_lam KHÔNG hàm giờ-công/sản-lượng nào đọc → để nguyên (đóng băng).
-- mo_phien VỐN đóng phiên theo TRẠM (nhường trạm), KHÔNG theo người → một người ĐÃ giữ được nhiều trạm sẵn.
--   Lệnh này chỉ THÊM: cột nguoi_mo (ai bấm) + gác "mở hộ chỉ xuong/ceo". nguoi_id vẫn = thợ → giờ công/quét gán đúng.

-- ═══ A1 · cột nguoi_mo (NULL=tự mở). Client ĐÓNG (WP-11b: cột mới không vào whitelist ghi) ═══
alter table kho.phien_tram add column if not exists nguoi_mo uuid references kho.nguoi_dung(id);
comment on column kho.phien_tram.nguoi_mo is 'WP-17b: ai BẤM mở phiên (quản đốc mở hộ); NULL = thợ tự mở. nguoi_id vẫn = người LÀM → giờ công/quét gán theo nguoi_id.';
grant select (nguoi_mo) on kho.phien_tram to authenticated;   -- UI đọc được; KHÔNG cấp UPDATE (PATCH cột này = 403)

-- ═══ A2 · mo_phien: thêm mở HỘ (p_nguoi ≠ người bấm) — chỉ xuong/ceo; ghi nguoi_mo ═══
create or replace function kho.mo_phien(p_nguoi uuid, p_tram text) returns jsonb
language plpgsql security definer set search_path to 'kho' as $function$
declare v_ten text; v_cur record; v_nhuong text := null; v_nhuong_id uuid := null;
        v_caller uuid; v_ho boolean;
begin
  perform kho.tram_gac_vai();   -- người vận hành trạm: tho/xuong/ceo
  v_caller := kho.current_ns();
  v_ho := (p_nguoi is distinct from v_caller);   -- [WP-17b] p_nguoi ≠ người bấm → MỞ HỘ
  if v_ho and coalesce(kho.current_vai_tro(),'') not in ('xuong','ceo') then
    raise exception 'mo_phien: mở phiên HỘ người khác chỉ quản đốc (xuong/ceo) — vai "%"',
      coalesce(nullif(kho.current_vai_tro(),''),'(chưa đăng nhập)');
  end if;
  select ho_ten into v_ten from kho.nguoi_dung where id = p_nguoi and dang_hoat_dong;
  if v_ten is null then raise exception 'không nhận ra thợ này (không có trong hệ hoặc đã khoá)'; end if;
  if not exists (select 1 from kho.tram where ma_tram = p_tram) then raise exception 'trạm "%" không có trong hệ', p_tram; end if;

  select id, nguoi_id, bat_dau into v_cur from kho.phien_tram where ma_tram = p_tram and ket_thuc is null limit 1;
  -- đã là phiên của CHÍNH người này TRONG NGÀY → không mở lại (idempotent, KHÔNG đẻ phiên thứ hai)
  if v_cur.id is not null and v_cur.nguoi_id = p_nguoi and v_cur.bat_dau::date = current_date then
    return jsonb_build_object('da_mo', true, 'nguoi_nhan', v_ten, 'nguoi_nhan_id', p_nguoi, 'nguoi_nhuong', null, 'nguoi_nhuong_id', null);
  end if;
  -- phiên người KHÁC (hoặc phiên cũ qua ngày) ở CHÍNH TRẠM này → ĐÓNG (nhường trạm). KHÔNG đụng trạm khác của thợ → giữ nhiều trạm.
  if v_cur.id is not null then
    update kho.phien_tram set ket_thuc = now() where id = v_cur.id;
    select ho_ten into v_nhuong from kho.nguoi_dung where id = v_cur.nguoi_id; v_nhuong_id := v_cur.nguoi_id;
  end if;
  insert into kho.phien_tram(ma_tram, nguoi_id, nguon, nguoi_mo)
    values (p_tram, p_nguoi, 'chon', case when v_ho then v_caller else null end);
  return jsonb_build_object('da_mo', false, 'nguoi_nhan', v_ten, 'nguoi_nhan_id', p_nguoi,
    'nguoi_nhuong', v_nhuong, 'nguoi_nhuong_id', v_nhuong_id, 'nguoi_mo_id', case when v_ho then v_caller else null end);
end $function$;
