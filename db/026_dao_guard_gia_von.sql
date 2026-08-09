-- 026 — ĐẢO guard giá vốn từ DANH SÁCH CẤM (025) sang DANH SÁCH CHO PHÉP.
--   Lý do: 025 chặn theo TÊN 3 vai trò (sale/thiet_ke/xuong) -> vai trò MỚI hoặc vai_tro NULL (đã đăng nhập) LỌT qua.
--   Quy tắc mới trong quy_doi_export():
--     • đường anon/plugin (chưa đăng nhập user -> auth.uid() IS NULL): CHO đọc (plugin gọi bằng anon key).
--     • vai trò trong DANH SÁCH TRẮNG: ceo, kho, ke_toan, tho: CHO đọc.
--     • MỌI thứ còn lại (vai trò lạ, HOẶC đã đăng nhập mà vai_tro NULL/không hoạt động): RAISE.
--   KHÔNG đổi grant, KHÔNG đụng RLS -> không chạm quyền bảng của ceo/kho/tho.
--   node ops/run_sql.mjs ../db/026_dao_guard_gia_von.sql   (⚠ CHỜ CEO DUYỆT — CHƯA áp prod)
--
-- ══════════ HOÀN TÁC (trả về bản 025 — danh sách CẤM sale/thiet_ke/xuong) ══════════
--   begin;
--   create or replace function kho.quy_doi_export()
--     returns jsonb language plpgsql security definer set search_path = kho stable as $HT$
--   declare vt text := kho.current_vai_tro();
--   begin
--     if vt in ('sale','thiet_ke','xuong') then
--       raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', vt;
--     end if;
--     return coalesce(
--       (select jsonb_build_object('thoi_gian_xuat', to_char(max(q.tao_luc),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
--          'so_dong', count(*), 'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
--            'mo_ta_thiet_ke',q.mo_ta_thiet_ke,'ma_plugin',q.ma_plugin,'ma_kho',q.ma_kho,
--            'he_so_quy_doi',q.he_so_quy_doi,'gia_von_kho',t.gia_von_bq) order by q.mo_ta_thiet_ke),'[]'::jsonb))
--        from kho.quy_doi q left join kho.vat_tu v on v.ma=q.ma_kho left join kho.ton t on t.vat_tu_id=v.id
--        where q.trang_thai='DA_DUYET' and q.la_mac_dinh=true),
--       jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb));
--   end $HT$;
--   grant execute on function kho.quy_doi_export() to anon, authenticated;
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

create or replace function kho.quy_doi_export()
  returns jsonb language plpgsql security definer set search_path = kho stable as $$
declare vt text := kho.current_vai_tro();
begin
  -- CHO ĐỌC: đường anon/plugin (auth.uid() null) HOẶC vai trò trong danh sách trắng. Còn lại RAISE.
  if auth.uid() is null or vt in ('ceo','kho','ke_toan','tho') then
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
  end if;
  raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', coalesce(vt, '(không vai trò)');
end $$;

grant execute on function kho.quy_doi_export() to anon, authenticated;

commit;
