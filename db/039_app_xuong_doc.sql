-- 039 — READ-RPC cho app XƯỞNG (nối dây BƯỚC 4). db/038 cho tho GHI (RPC) nhưng KHÔNG ĐỌC bảng
--   (RLS _doc = ceo/ke_toan/xuong; tho ngoài). App cần đọc -> RPC SECURITY DEFINER curated, guard
--   ceo/kho/xuong/tho, CHỈ trả field KHÔNG nhạy cảm: KHÔNG giá bán/giá vốn, KHÔNG tên khách.
--   + tien_mon: đẩy bước SX của MÓN (dhm RLS không cho tho ghi -> qua RPC). KHÔNG đụng grant/policy sẵn có.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.xuong_don_san_xuat(), kho.xuong_mon_cua_don(text),
--     kho.xuong_tem_cua_don(text), kho.tien_mon(uuid,text);
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. Đơn đang trong xưởng (để chọn ở màn In tem / Ghi lỗi). KHÔNG khách, KHÔNG giá.
create or replace function kho.xuong_don_san_xuat()
  returns table(ma_don text, trang_thai text, so_mon int, co_tem boolean)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_don_san_xuat: chỉ ceo/kho/xuong/tho'; end if;
  return query
    select d.ma_don, d.trang_thai,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
      exists(select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don)
    from kho.don_hang d
    where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')
       or exists(select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don)
    order by d.ma_don;
end $$;
grant execute on function kho.xuong_don_san_xuat() to authenticated;

-- 2. Món của 1 đơn (màn Việc + picker Ghi lỗi). id/ten/so_luong/trang_thai — KHÔNG gia.
create or replace function kho.xuong_mon_cua_don(p_ma_don text)
  returns table(id uuid, ten text, so_luong numeric, trang_thai text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_mon_cua_don: chỉ ceo/kho/xuong/tho'; end if;
  return query
    select m.id, m.ten, m.so_luong, m.trang_thai
    from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
    where d.ma_don = p_ma_don
    order by m.tao_luc nulls last, m.id;
end $$;
grant execute on function kho.xuong_mon_cua_don(text) to authenticated;

-- 3. Tem của đơn: PHIÊN BẢN mới nhất + số lượt ĐÃ in (để app hiện "lượt in kế = N+1, cắt lại nếu N≥1").
create or replace function kho.xuong_tem_cua_don(p_ma_don text)
  returns table(phien_ban int, lan_da_in int, ma_tam text, vai_tro text,
                dai numeric, rong numeric, day numeric, kien int, duong_dan_svg text)
  language plpgsql stable security definer set search_path = kho as $$
declare v_pb int; v_lan int;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'xuong_tem_cua_don: chỉ ceo/kho/xuong/tho'; end if;
  select max(t.phien_ban) into v_pb from kho.tem_ban_ve t where t.ma_don = p_ma_don;
  if v_pb is null then return; end if;
  select coalesce(max(l.lan_thu),0) into v_lan from kho.lan_in_tem l where l.ma_don = p_ma_don and l.phien_ban = v_pb;
  return query
    select v_pb, v_lan, b.ma_tam, b.vai_tro, b.dai, b.rong, b.day, b.kien, b.duong_dan_svg
    from kho.tem_ban_ve b where b.ma_don = p_ma_don and b.phien_ban = v_pb
    order by b.kien nulls last, b.ma_tam;
end $$;
grant execute on function kho.xuong_tem_cua_don(text) to authenticated;

-- 4. Đẩy bước SX của MÓN (màn Việc "Xong bước này"). SECURITY DEFINER -> tho ghi được dù dhm RLS không cho.
--    Update kích hoạt dong_bo_trang_thai_don -> đơn suy lại từ món (bước chậm nhất).
create or replace function kho.tien_mon(p_mon_id uuid, p_trang_thai text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_don uuid; v_ma text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong','tho') then
    raise exception 'tien_mon: chỉ ceo/kho/xuong/tho'; end if;
  if p_trang_thai not in ('cho_cat','da_cat','dang_lam','xong_sx') then
    raise exception 'tien_mon: trạng thái "%" không hợp lệ', p_trang_thai; end if;
  update kho.don_hang_mon set trang_thai = p_trang_thai where id = p_mon_id returning don_id into v_don;
  if v_don is null then raise exception 'tien_mon: không có món %', p_mon_id; end if;
  select ma_don into v_ma from kho.don_hang where id = v_don;
  return jsonb_build_object('ok',true,'mon_id',p_mon_id,'trang_thai',p_trang_thai,'ma_don',v_ma);
end $$;
grant execute on function kho.tien_mon(uuid, text) to authenticated;

commit;
