-- 025 — BỊT giá vốn khỏi vai trò sale/thiet_ke/xuong qua RPC quy_doi_export().
--   Duy nhất RPC này để 4 vai trò mới đọc được giá vốn (đo BƯỚC 2: v_ton_gia_von/quy_doi/ton/don_hang_gia_von
--   đều đã chặn bằng RLS; chỉ RPC — SECURITY DEFINER, grant authenticated — trả 26 mã kèm gia_von_kho).
--   Guard THEO current_vai_tro() BÊN TRONG hàm: chặn 'sale','thiet_ke','xuong'; GIỮ NGUYÊN ke_toan, ceo, kho,
--   tho, và anon (plugin gọi bằng anon key -> current_vai_tro()=null -> không bị chặn). KHÔNG đổi grant, KHÔNG
--   đụng RLS bảng nào -> quyền ceo/kho/tho không đổi.
--   node ops/run_sql.mjs ../db/025_bit_gia_von_vai_tro.sql
--
-- ══════════ HOÀN TÁC (trả về bản 020 KHÔNG guard: mọi authenticated đọc lại giá vốn) ══════════
--   begin;
--   create or replace function kho.quy_doi_export()
--     returns jsonb language sql security definer set search_path = kho stable as $HT$
--     select coalesce(
--       jsonb_build_object('thoi_gian_xuat', to_char(max(q.tao_luc),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
--         'so_dong', count(*), 'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
--           'mo_ta_thiet_ke',q.mo_ta_thiet_ke,'ma_plugin',q.ma_plugin,'ma_kho',q.ma_kho,
--           'he_so_quy_doi',q.he_so_quy_doi,'gia_von_kho',t.gia_von_bq) order by q.mo_ta_thiet_ke),'[]'::jsonb)),
--       jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb))
--     from kho.quy_doi q left join kho.vat_tu v on v.ma=q.ma_kho left join kho.ton t on t.vat_tu_id=v.id
--     where q.trang_thai='DA_DUYET' and q.la_mac_dinh=true; $HT$;
--   grant execute on function kho.quy_doi_export() to anon, authenticated;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.quy_doi_export()
  returns jsonb language plpgsql security definer set search_path = kho stable as $$
declare vt text := kho.current_vai_tro();
begin
  if vt in ('sale','thiet_ke','xuong') then
    raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', vt;
  end if;
  return coalesce(
    (select jsonb_build_object(
       'thoi_gian_xuat', to_char(max(q.tao_luc), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       'so_dong', count(*),
       'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
         'mo_ta_thiet_ke', q.mo_ta_thiet_ke, 'ma_plugin', q.ma_plugin, 'ma_kho', q.ma_kho,
         'he_so_quy_doi', q.he_so_quy_doi, 'gia_von_kho', t.gia_von_bq) order by q.mo_ta_thiet_ke), '[]'::jsonb))
     from kho.quy_doi q
     left join kho.vat_tu v on v.ma = q.ma_kho
     left join kho.ton t on t.vat_tu_id = v.id
     where q.trang_thai = 'DA_DUYET' and q.la_mac_dinh = true),
    jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb));
end $$;

grant execute on function kho.quy_doi_export() to anon, authenticated;

commit;
