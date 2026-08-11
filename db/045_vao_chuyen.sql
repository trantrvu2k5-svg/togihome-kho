-- 045 — VÁ VÒNG LUẨN QUẨN ĐƠN KẸT: hai cửa vào chuyền (tem tự bắc cầu · nút tay), gỡ khoá đồng bộ
--   món→đơn, tự sang cho_giao khi mọi món xong, bỏ "cửa sau" OR-tem ở danh sách xưởng.
--   node ops/run_sql.mjs ../db/045_vao_chuyen.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--
-- Bối cảnh (xem ~/Downloads/DO_don_khong_hien_app_xuong.md): đơn sale tạo ra ở moi_len_don, không app
--   nào có nút đưa vào cho_cat, trigger đồng bộ tự khoá tới khi đơn ĐÃ ở SX → đơn tàng hình ở app xưởng.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   -- 1. day_tem_ban_ve: chạy lại bản db/038 (bỏ đoạn bắc cầu cho_cat).
--   -- 3. dong_bo_trang_thai_don: chạy lại bản db/038 (cổng chỉ {cho_cat,da_cat,dang_lam,xong_sx}, bỏ cho_giao + bỏ nhánh cho_giao).
--   -- 6. xuong_don_san_xuat: chạy lại bản db/039 (thêm lại OR exists(tem) ở WHERE).
--   drop function if exists kho.dua_vao_chuyen(text);
--   comment on constraint don_hang_trang_thai_check on kho.don_hang is null;
--   -- ⚠ BACKFILL (mục 6) KHÔNG tự đảo được: các đơn đã đổi moi_len_don/xong_file(+tem)→cho_cat giữ nguyên
--   --   (cho_cat có thể là hợp lệ). Muốn đảo phải soi nhật ký/tay từng đơn.
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. BẮC CẦU TỰ ĐỘNG: đẩy tem xong → cho_cat (chỉ từ xong_file/moi_len_don) ═══════════════
--   Plugin (thiet_ke) đẩy tem = thiết kế xong = sẵn sàng cắt. Đơn bao_gia* KHÔNG chạm (không khớp WHERE).
--   thiet_ke KHÔNG nằm trong ma trận vai của cho_cat → đặt chan.tu_mon='1' để né chan_chuyen_theo_vai.
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_pb integer; t jsonb; v_bac boolean := false;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiet_ke';
  end if;
  if not exists (select 1 from kho.don_hang d where d.ma_don = p_ma_don) then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;
  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;   -- phien_ban tăng
  for t in select * from jsonb_array_elements(p_tam) loop
    -- duong_dan_svg TÍNH SERVER (deterministic): {ma_don}/{phien_ban}/{ma_tam an-toàn}.svg.
    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  -- BẮC CẦU: đơn ở xong_file/moi_len_don → cho_cat (vào chuyền). bao_gia* / đã-trong-SX: không khớp -> bỏ qua.
  perform set_config('chan.tu_mon','1',true);
  update kho.don_hang set trang_thai = 'cho_cat'
    where ma_don = p_ma_don and trang_thai in ('xong_file','moi_len_don');
  v_bac := found;
  perform set_config('chan.tu_mon','',true);

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',v_bac);
end $$;
grant execute on function kho.day_tem_ban_ve(text, jsonb) to authenticated;

-- ═══════════════ 2. ĐƯỜNG TAY: dua_vao_chuyen(ma_don) — đơn không qua plugin (giường gỗ, mua ngoài) ═══════════════
--   Guard fail-đóng: chỉ ceo/xuong. Chỉ từ moi_len_don/xong_file. bao_gia* → CHẶN. Đây là "bản số" của chữ
--   ký quản đốc nhận lệnh sản xuất. Vai ceo/xuong nằm trong ma trận cho_cat → KHÔNG cần né chan_chuyen_theo_vai.
create or replace function kho.dua_vao_chuyen(p_ma_don text)
  returns jsonb language plpgsql security definer set search_path = kho as $$
declare v_tt text;
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','xuong') then
    raise exception 'dua_vao_chuyen: chỉ ceo/xuong'; end if;
  select trang_thai into v_tt from kho.don_hang where ma_don = p_ma_don;
  if v_tt is null then raise exception 'dua_vao_chuyen: không có đơn "%"', p_ma_don; end if;
  if v_tt in ('bao_gia','bao_gia_thua','bao_gia_treo') then
    raise exception 'Đơn báo giá "%" chưa chốt — không đưa vào chuyền được. Lên đơn trước.', p_ma_don; end if;
  if v_tt not in ('moi_len_don','xong_file') then
    raise exception 'Đơn "%" đang ở "%" — chỉ đưa vào chuyền từ moi_len_don/xong_file.', p_ma_don, v_tt; end if;
  update kho.don_hang set trang_thai = 'cho_cat' where ma_don = p_ma_don;
  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'tu',v_tt,'den','cho_cat');
end $$;
grant execute on function kho.dua_vao_chuyen(text) to authenticated;

-- ═══════════════ 3. GỠ KHOÁ đồng bộ món→đơn + 4. mọi món xong_sx → đơn cho_giao ═══════════════
--   Cổng cũ (db/038): chỉ đồng bộ khi đơn ∈ {cho_cat,da_cat,dang_lam,xong_sx}. Thêm cho_giao để đơn đã
--   sang cho_giao vẫn theo món (nếu món lùi bước). moi_len_don/bao_gia*/xong_file VẪN thoát — hai cửa ở
--   mục 1/2 là lối duy nhất vào chuyền. MỚI: khi món suy ra 'xong_sx' (mọi món xong) → đơn tự sang cho_giao.
create or replace function kho.dong_bo_trang_thai_don() returns trigger
  language plpgsql security definer set search_path = kho as $$
declare v_don uuid; v_moi text; v_cur text; v_dich text;
begin
  v_don := coalesce(new.don_id, old.don_id);
  select trang_thai into v_cur from kho.don_hang where id = v_don;
  if v_cur not in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao') then
    return coalesce(new, old); end if;                                   -- chỉ đồng bộ khi đã vào chuyền
  v_moi := kho.trang_thai_don_tu_mon(v_don);
  if v_moi is null then return coalesce(new, old); end if;
  v_dich := case when v_moi = 'xong_sx' then 'cho_giao' else v_moi end;  -- mọi món xong_sx -> đơn cho_giao
  if v_dich is distinct from v_cur then
    perform set_config('chan.tu_mon','1',true);
    update kho.don_hang set trang_thai = v_dich where id = v_don;
    perform set_config('chan.tu_mon','',true);
  end if;
  return coalesce(new, old);
end $$;
-- (trigger trg_mon_day_don đã trỏ vào hàm này từ db/038 — create or replace là đủ, không dựng lại trigger)

-- ═══════════════ 5. nhan_thiet_ke mồ côi: GIỮ trong CHECK, ghi rõ không dùng trong luồng hiện tại ═══════════════
comment on constraint don_hang_trang_thai_check on kho.don_hang is
  'Miền 15 trạng thái. LƯU Ý: nhan_thiet_ke KHÔNG dùng trong luồng hiện tại — không app nào set (sale bỏ qua, '
  'không có app thiết kế web). Giữ trong miền để không vỡ dữ liệu/nhật ký cũ; ĐỪNG xoá.';

-- ═══════════════ 6. BỎ CỬA SAU: xuong_don_san_xuat bỏ nhánh OR exists(tem) ═══════════════
--   Sau mục 1, đẩy tem đã tự đưa đơn sang cho_cat -> nhánh OR-tem thừa, và nó làm đơn moi_len_don(+tem) hiện
--   SAI CỘT trên kanban (đứng ở moi_len_don nhưng lọt list). Bỏ nhánh: đơn hiện theo ĐÚNG trang_thai. co_tem
--   vẫn trả ở SELECT (app hiện cờ tem). BACKFILL bên dưới lo các đơn đã có tem mà còn kẹt moi_len_don/xong_file.
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
    where d.trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')   -- BỎ: or exists(tem)
    order by d.ma_don;
end $$;
grant execute on function kho.xuong_don_san_xuat() to authenticated;

-- BACKFILL 1 lần: đơn ĐÃ có tem nhưng còn kẹt moi_len_don/xong_file → cho_cat (khớp luật mục 1, không để
--   đơn có tem biến mất khỏi xưởng sau khi bỏ OR-tem). bao_gia*/đã-SX không chạm. In số đơn đã đổi.
do $$
declare v_n int;
begin
  perform set_config('chan.tu_mon','1',true);
  with up as (
    update kho.don_hang d set trang_thai = 'cho_cat'
    where d.trang_thai in ('moi_len_don','xong_file')
      and exists (select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don)
    returning 1)
  select count(*) into v_n from up;
  perform set_config('chan.tu_mon','',true);
  raise notice 'BACKFILL: % đơn (moi_len_don/xong_file + có tem) → cho_cat', v_n;
end $$;

-- ═══════════════ 7. READ-RPC cho khối "Đơn chờ vào chuyền" (Quản đốc) ═══════════════
--   Đơn ở moi_len_don/xong_file mà CHƯA có tem (đơn có tem đã tự vào cho_cat ở mục 1 → không hiện ở đây).
--   Curated: KHÔNG giá/khách. Guard ceo/kho/xuong (khối nằm ở tab Quản đốc — tho bị ẩn tab, không gọi).
create or replace function kho.xuong_don_cho_vao_chuyen()
  returns table(ma_don text, trang_thai text, so_mon int, ngay_hen_khach date)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','kho','xuong') then
    raise exception 'xuong_don_cho_vao_chuyen: chỉ ceo/kho/xuong'; end if;
  return query
    select d.ma_don, d.trang_thai,
      (select count(*)::int from kho.don_hang_mon m where m.don_id = d.id),
      d.ngay_hen_khach
    from kho.don_hang d
    where d.trang_thai in ('moi_len_don','xong_file')
      and not exists (select 1 from kho.tem_ban_ve t where t.ma_don = d.ma_don)
    order by d.ngay_hen_khach nulls last, d.ma_don;
end $$;
grant execute on function kho.xuong_don_cho_vao_chuyen() to authenticated;

commit;
