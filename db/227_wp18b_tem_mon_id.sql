-- db/227 · WP-18b(1) L-19 · NỐI DÂY tem_ban_ve.mon_id (phương án a — CEO chốt, CẤM b)
--   Gốc lỗi (L-18): day_tem_ban_ve KHÔNG ghi mon_id → sq_ghi resolve món qua tem.mon_id=NULL → SAI_TRAM
--   mọi lượt quét, BẤT KỂ quy trình. Đây là WP-08 chưa nối dây (cột mon_id có, đường đẩy không set).
--   Sửa: day_tem_ban_ve nhận mon_id theo 3 nhánh; FK CASCADE (xoa_demo dọn được); client ĐÓNG (WP-11b).
-- QD-107. KHÔNG backfill tem cũ (đều demo, xoa_demo dọn).

begin;

-- ── B1a · FK mon_id → ON DELETE CASCADE (họ bài học WP-17b: cha xoá thì tem con xoá theo) ──
alter table kho.tem_ban_ve drop constraint if exists tem_ban_ve_mon_id_fkey;
alter table kho.tem_ban_ve
  add constraint tem_ban_ve_mon_id_fkey
  foreign key (mon_id) references kho.don_hang_mon(id) on delete cascade;

-- ── B1b · client ĐÓNG cột mon_id (WP-11b) ──
--   tem_ban_ve đang có TABLE-level INSERT/UPDATE (trùm mọi cột) + column-grant từng cột. Table-level
--   trùm nên revoke riêng mon_id vô ích. Theo mẫu don_hang (table-level chỉ SELECT): BỎ table-level
--   ghi + BỎ column-grant mon_id. Các cột khác vẫn có column-grant → client ghi được như cũ, chỉ
--   mon_id đóng. day_tem_ban_ve (SECURITY DEFINER, chạy như owner) KHÔNG bị ảnh hưởng.
revoke insert, update on kho.tem_ban_ve from authenticated;
revoke insert, update on kho.tem_ban_ve from anon;
revoke insert(mon_id), update(mon_id) on kho.tem_ban_ve from authenticated;
revoke insert(mon_id), update(mon_id) on kho.tem_ban_ve from anon;

-- ── B2 · day_tem_ban_ve nhận mon_id theo 3 nhánh CEO chốt ──
--   1) nguồn gửi t->>'mon_id' → validate thuộc ĐƠN NÀY → ghi thẳng
--   2) nguồn KHÔNG gửi + đơn ĐÚNG 1 món → gán món duy nhất
--   3) nguồn KHÔNG gửi + đơn NHIỀU món (hoặc 0) → RAISE, nói rõ mấy món + cần gửi gì. CẤM đoán.
create or replace function kho.day_tem_ban_ve(p_ma_don text, p_tam jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'kho'
as $function$
declare
  v_pb integer; t jsonb; v_don kho.don_hang; v_le_mau_san boolean; v_vai text; v_ten text;
  v_so_mon int; v_mon_duy_nhat uuid; v_mon_id uuid;   -- [WP-18b] gán món cho tem
begin
  v_vai := coalesce(kho.current_vai_tro(),'');
  if v_vai = 'tk_ban_hang' then
    raise exception 'day_tem_ban_ve: thiết kế bán hàng không xuất file cắt (chỉ dựng 3D cho khách)';
  end if;
  if v_vai not in ('ceo','kho','thiet_ke') then
    raise exception 'day_tem_ban_ve: chỉ ceo/kho/thiết kế sản xuất';
  end if;
  select * into v_don from kho.don_hang d where d.ma_don = p_ma_don;
  if v_don.ma_don is null then
    raise exception 'day_tem_ban_ve: không có đơn "%"', p_ma_don;
  end if;
  -- [WP-37/QD-63] TEM KHÔNG PHÁT Ở BÁO GIÁ (estimate ≠ job/route card — ERP ch.6 · QD-47). Chặn cố ý, rõ ràng.
  if v_don.trang_thai in ('bao_gia','bao_gia_treo','bao_gia_thua') then
    raise exception 'day_tem_ban_ve: đơn "%" đang BÁO GIÁ — tem chỉ phát lúc sản xuất (QD-47), không ở báo giá', p_ma_don;
  end if;

  if v_vai = 'thiet_ke' then
    if v_don.ma_ns_thiet_ke is null then
      raise exception 'day_tem_ban_ve: đơn "%" CHƯA AI NHẬN việc thiết kế — nhận việc trước khi đẩy tem', p_ma_don;
    end if;
    if v_don.ma_ns_thiet_ke <> kho.current_ns() then
      select ho_ten into v_ten from kho.nguoi_dung where id = v_don.ma_ns_thiet_ke;
      raise exception 'day_tem_ban_ve: đơn "%" đang do % cầm — chỉ người cầm mới đẩy tem', p_ma_don, coalesce(v_ten,'người khác');
    end if;
  end if;

  -- [CỔNG KHOÁ CẮT] — không cắt ván khi khách chưa duyệt bản thiết kế (trừ đơn le mẫu sẵn).
  v_le_mau_san := (v_don.dong = 'le'
                   and not exists (select 1 from kho.don_hang_mon m where m.don_id = v_don.id and m.dung_moi));
  if not v_le_mau_san
     and not exists (select 1 from kho.ban_thiet_ke b where b.ma_don = p_ma_don and b.trang_thai = 'khach_duyet') then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có bản thiết kế nào KHÁCH DUYỆT — chưa được cắt ván.', p_ma_don;
  end if;

  -- [WP-18b] chuẩn bị gán món: đếm món + món duy nhất (nếu có). (array_agg vì min(uuid) không có)
  select count(*), (array_agg(m.id))[1] into v_so_mon, v_mon_duy_nhat
    from kho.don_hang_mon m where m.don_id = v_don.id;
  if v_so_mon = 0 then
    raise exception 'day_tem_ban_ve: đơn "%" chưa có món nào — không đẩy tem được. Lưu món trước.', p_ma_don;
  end if;

  select coalesce(max(phien_ban),0)+1 into v_pb from kho.tem_ban_ve where ma_don = p_ma_don;
  for t in select * from jsonb_array_elements(p_tam) loop
    -- [WP-18b] xác định món của TẤM NÀY theo 3 nhánh CEO chốt
    v_mon_id := nullif(t->>'mon_id','')::uuid;
    if v_mon_id is not null then
      -- nhánh 1: nguồn gửi — validate thuộc ĐƠN NÀY (nguồn không được gán tấm sang món đơn khác)
      if not exists (select 1 from kho.don_hang_mon m where m.id = v_mon_id and m.don_id = v_don.id) then
        raise exception 'day_tem_ban_ve: tấm "%" gửi mon_id % KHÔNG thuộc đơn "%".',
          t->>'ma_tam', v_mon_id, p_ma_don;
      end if;
    elsif v_so_mon = 1 then
      -- nhánh 2: nguồn không gửi + đơn 1 món → gán món duy nhất
      v_mon_id := v_mon_duy_nhat;
    else
      -- nhánh 3: nguồn không gửi + đơn nhiều món → RAISE, CẤM đoán
      raise exception 'day_tem_ban_ve: đơn "%" có % món — nguồn ĐẨY phải gửi "mon_id" cho từng tấm (tấm "%" thiếu) để biết tấm thuộc món nào. KHÔNG tự gán bừa.',
        p_ma_don, v_so_mon, t->>'ma_tam';
    end if;

    insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,canh_dan,kien,mon_id,duong_dan_svg)
      values(p_ma_don, v_pb, t->>'ma_tam', t->>'vai_tro',
             (t->>'dai')::numeric, (t->>'rong')::numeric, (t->>'day')::numeric,
             coalesce(t->'canh_dan','[]'::jsonb), (t->>'kien')::int, v_mon_id,
             p_ma_don||'/'||v_pb||'/'||replace(replace(t->>'ma_tam','|','_'),'#','_')||'.svg');
  end loop;

  update kho.don_hang set buoc_thiet_ke = 'xong_file' where ma_don = p_ma_don;

  return jsonb_build_object('ok',true,'ma_don',p_ma_don,'phien_ban',v_pb,
                            'so_tam',jsonb_array_length(p_tam),'vao_chuyen',false);
end $function$;

commit;
