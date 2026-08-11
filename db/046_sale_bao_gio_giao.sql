-- 046 — PHẦN A app sale "bao giờ giao": RPC CURATED cho sale (cột trả về tự chọn, KHÔNG phụ thuộc RLS).
--   Vì sao bọc RPC thay vì query thẳng: mai thêm cột giá vào don_hang_mon là query thẳng LỘ ngay; RPC lọc sẵn.
--   node ops/run_sql.mjs ../db/046_sale_bao_gio_giao.sql   (⚠ CHỜ TEST XANH. CHƯA áp prod.)
--   Guard sale-RPC: ceo/sale/tk_ban_hang/truong_nhom_sale (fail-đóng). KHÔNG nới guard gốc lead_time/mon_dung_yen.
--
-- ══════════ HOÀN TÁC ══════════
--   begin;
--   drop function if exists kho.sale_mon_cua_don(text), kho.sale_lead_time(text,text), kho._lead_time_core(text,text,int);
--   -- lead_time: chạy lại bản db/042 (thân inline, bỏ nhánh gọi _lead_time_core).
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══════════════ 1. Tách LÕI lead_time (KHÔNG guard) — dùng chung cho lead_time (ceo/ke_toan/xuong) và sale_lead_time ═══════════════
--   Lõi = đúng query db/042. lead_time GIỮ NGUYÊN guard + trả 7 cột y hệt; chỉ chuyển phần tính vào lõi.
create or replace function kho._lead_time_core(p_dong text, p_sku text, p_so_don int)
  returns table(cho_tb numeric, lam_tb numeric, tong_tb numeric, tong_nhanh int, tong_cham int, so_don int, canh_bao text)
  language sql stable security definer set search_path = kho as $$
  with d as (
    select (dh.ngay_vao_chuyen - dh.ngay_chot) cho,
           (dh.ngay_xong - dh.ngay_vao_chuyen)  lam,
           (dh.ngay_xong - dh.ngay_chot)        tong
    from kho.don_hang dh
    where dh.ngay_chot is not null and dh.ngay_xong is not null and dh.ngay_vao_chuyen is not null
      and (p_dong is null or dh.dong = p_dong)
      and (p_sku is null or exists (select 1 from kho.don_hang_mon m where m.don_id = dh.id and m.ten ilike '%'||p_sku||'%'))
    order by dh.ngay_xong desc
    limit greatest(p_so_don, 1)
  )
  select round(avg(cho),1), round(avg(lam),1), round(avg(tong),1), min(tong)::int, max(tong)::int, count(*)::int,
         case when count(*) < 5 then 'chưa đủ đơn để tin (' || count(*) || ' đơn)' else null end
  from d;
$$;

-- lead_time: guard GIỮ NGUYÊN (ceo/ke_toan/xuong), output y hệt db/042 — nay gọi lõi.
create or replace function kho.lead_time(p_dong text default null, p_sku text default null, p_so_don int default 20)
  returns table(cho_tb numeric, lam_tb numeric, tong_tb numeric, tong_nhanh int, tong_cham int, so_don int, canh_bao text)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','ke_toan','xuong') then
    raise exception 'lead_time: chỉ ceo/ke_toan/xuong'; end if;
  return query select * from kho._lead_time_core(p_dong, p_sku, p_so_don);
end $$;
grant execute on function kho.lead_time(text, text, int) to authenticated;

-- ═══════════════ 2. sale_lead_time(dong, sku) — CHỈ NGÀY, không tiền. Guard sale/tk_ban_hang/truong_nhom_sale/ceo ═══════════════
create or replace function kho.sale_lead_time(p_dong text default null, p_sku text default null)
  returns table(trung_binh numeric, nhanh_nhat int, cham_nhat int, so_don_can_cu int)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang','truong_nhom_sale') then
    raise exception 'sale_lead_time: chỉ ceo/sale/tk_ban_hang/truong_nhom_sale'; end if;
  return query
    select c.tong_tb, c.tong_nhanh, c.tong_cham, c.so_don   -- tổng (chốt→xong); KHÔNG trả tiền
    from kho._lead_time_core(p_dong, p_sku, 20) c;
end $$;
grant execute on function kho.sale_lead_time(text, text) to authenticated;

-- ═══════════════ 3. sale_mon_cua_don(ma_don) — trạng thái + số ngày tắc từng món. KHÔNG gia/tho/tiền ═══════════════
--   so_ngay_tac = số ngày món CHƯA đổi trạng thái (từ nhật ký; món xong_sx = 0). Curated đúng cột CEO chốt.
create or replace function kho.sale_mon_cua_don(p_ma_don text)
  returns table(mon_id uuid, ten text, vat_lieu text, ma_mau text, kich_thuoc text,
                sl numeric, ghi_chu text, trang_thai text, so_ngay_tac int)
  language plpgsql stable security definer set search_path = kho as $$
begin
  if coalesce(kho.current_vai_tro(),'') not in ('ceo','sale','tk_ban_hang','truong_nhom_sale') then
    raise exception 'sale_mon_cua_don: chỉ ceo/sale/tk_ban_hang/truong_nhom_sale'; end if;
  return query
    select m.id, m.ten, m.vl, m.ma_mau, m.kt, m.so_luong, m.chi_tiet, m.trang_thai,
      case when m.trang_thai = 'xong_sx' then 0
           else (current_date - coalesce(
                   (select max(k.luc) from kho.don_hang_mon_nhat_ky k where k.mon_id = m.id),
                   m.tao_luc)::date) end
    from kho.don_hang_mon m join kho.don_hang d on d.id = m.don_id
    where d.ma_don = p_ma_don
    order by m.tao_luc nulls last, m.id;
end $$;
grant execute on function kho.sale_mon_cua_don(text) to authenticated;

commit;
