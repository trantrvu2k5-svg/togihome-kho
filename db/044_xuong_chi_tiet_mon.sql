-- 044 — READ-RPC cho PANEL CHI TIẾT MÓN (app xưởng bản đầy đủ). Curated, guard ceo/kho/xuong/tho,
--   CHỈ field KHÔNG nhạy cảm (KHÔNG giá bán/giá vốn, KHÔNG tên/sđt khách). tho không đọc bảng -> qua RPC.
--   ⚠ CHỜ TEST XANH. CHƯA áp prod.
--
-- ══════════ HOÀN TÁC ══════════
--   begin; drop function if exists kho.xuong_chi_tiet_mon(uuid), kho.xuong_vet_mon(uuid),
--     kho.xuong_tho_list(), kho.tien_mon(uuid,text,uuid);
--     -- ghi_nhat_ky_mon(): chạy lại bản db/042 (bỏ nhánh đọc moc.nguoi_lam). commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- Danh sách THỢ (cho panel "chọn tên thợ"). Curated — chỉ id + tên, guard ceo/xuong/tho.
create or replace function kho.xuong_tho_list()
  returns table(id uuid, ho_ten text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong','tho') then
    raise exception 'xuong_tho_list: chỉ ceo/xuong/tho'; end if;
  return query select n.id, n.ho_ten from kho.nguoi_dung n
    where n.vai_tro = 'tho' and n.dang_hoat_dong order by n.ho_ten;
end $$;
grant execute on function kho.xuong_tho_list() to authenticated;

-- tien_mon 3 THAM SỐ: đẩy bước + GHI CHO thợ được CHỌN (không chỉ người bấm). Đặt cờ moc.nguoi_lam để
--   trg_ghi_nk_mon dùng làm nguoi_id. Bản 2 tham số (db/039) vẫn còn cho nơi khác gọi.
create or replace function kho.tien_mon(p_mon_id uuid, p_trang_thai text, p_nguoi_id uuid)
  returns jsonb language plpgsql security definer set search_path = kho as $$
begin
  perform set_config('moc.nguoi_lam', coalesce(p_nguoi_id::text,''), true);
  return kho.tien_mon(p_mon_id, p_trang_thai);   -- dùng lại lõi (guard + validate + update + dong_bo)
end $$;
grant execute on function kho.tien_mon(uuid, text, uuid) to authenticated;

-- ghi_nhat_ky_mon: nguoi_id = thợ ĐƯỢC CHỌN (moc.nguoi_lam) nếu có, else người bấm (auth.uid()). Còn lại GIỮ NGUYÊN db/042.
create or replace function kho.ghi_nhat_ky_mon() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_uid uuid; v_con int;
begin
  if new.trang_thai is not distinct from old.trang_thai then return new; end if;
  v_uid := nullif(current_setting('moc.nguoi_lam', true), '')::uuid;              -- thợ được chọn (nếu có)
  if v_uid is null then select id into v_uid from kho.nguoi_dung where auth_uid = auth.uid(); end if;
  insert into kho.don_hang_mon_nhat_ky(mon_id, don_id, tu, den, nguoi_id)
    values(new.id, new.don_id, old.trang_thai, new.trang_thai, v_uid);
  if new.trang_thai = 'da_cat' then
    perform set_config('moc.auto_xong','1',true);
    update kho.don_hang set ngay_vao_chuyen = coalesce(ngay_vao_chuyen, current_date) where id = new.don_id;
    perform set_config('moc.auto_xong','',true);
  end if;
  if new.trang_thai = 'xong_sx' then
    select count(*) into v_con from kho.don_hang_mon m where m.don_id = new.don_id and m.trang_thai <> 'xong_sx';
    if v_con = 0 then
      perform set_config('moc.auto_xong','1',true);
      update kho.don_hang set ngay_xong = coalesce(ngay_xong, current_date) where id = new.don_id;
      perform set_config('moc.auto_xong','',true);
    end if;
  end if;
  return new;
end $$;

-- Chi tiết 1 món + vài mốc đơn (không nhạy cảm) cho panel.
create or replace function kho.xuong_chi_tiet_mon(p_mon_id uuid)
  returns table(ma_don text, ten text, so_luong numeric, trang_thai text, vl text, kt text, ma_mau text,
                khong_gian jsonb, chi_tiet text, anh jsonb, ghi_chu_don text, file_tk text,
                ngay_hen_khach date, ngay_hen_khach_ban_dau date, ngay_du_kien date, danh_dau_gap boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_chi_tiet_mon: chỉ ceo/kho/xuong/tho'; end if;
  return query
  select d.ma_don, m.ten, m.so_luong, m.trang_thai, m.vl, m.kt, m.ma_mau, m.khong_gian, m.chi_tiet, m.anh,
         d.ghi_chu, d.file_tk, d.ngay_hen_khach, d.ngay_hen_khach_ban_dau, d.ngay_du_kien, d.danh_dau_gap
  from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
  where m.id = p_mon_id;
end $$;
grant execute on function kho.xuong_chi_tiet_mon(uuid) to authenticated;

-- "Đã qua tay ai" — vết đổi bước của MÓN (từ don_hang_mon_nhat_ky) + tên người. Curated cho cả tho.
create or replace function kho.xuong_vet_mon(p_mon_id uuid)
  returns table(luc timestamptz, tu text, den text, nguoi_ten text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_vet_mon: chỉ ceo/kho/xuong/tho'; end if;
  return query
  select k.luc, k.tu, k.den, n.ho_ten
  from kho.don_hang_mon_nhat_ky k left join kho.nguoi_dung n on n.id = k.nguoi_id
  where k.mon_id = p_mon_id
  order by k.luc desc;
end $$;
grant execute on function kho.xuong_vet_mon(uuid) to authenticated;

-- Thêm canh_dan vào xuong_tem_cua_don (để panel tính mét nẹp = Σ canh_dan.dai /1000). Đổi kiểu trả -> DROP+CREATE.
drop function if exists kho.xuong_tem_cua_don(text);
create or replace function kho.xuong_tem_cua_don(p_ma_don text)
  returns table(phien_ban int, lan_da_in int, ma_tam text, vai_tro text,
                dai numeric, rong numeric, day numeric, kien int, canh_dan jsonb, duong_dan_svg text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_pb int; v_lan int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_tem_cua_don: chỉ ceo/kho/xuong/tho'; end if;
  select max(t.phien_ban) into v_pb from kho.tem_ban_ve t where t.ma_don = p_ma_don;
  if v_pb is null then return; end if;
  select coalesce(max(l.lan_thu),0) into v_lan from kho.lan_in_tem l where l.ma_don = p_ma_don and l.phien_ban = v_pb;
  return query
    select v_pb, v_lan, b.ma_tam, b.vai_tro, b.dai, b.rong, b.day, b.kien, b.canh_dan, b.duong_dan_svg
    from kho.tem_ban_ve b where b.ma_don = p_ma_don and b.phien_ban = v_pb
    order by b.kien nulls last, b.ma_tam;
end $$;
grant execute on function kho.xuong_tem_cua_don(text) to authenticated;

commit;
