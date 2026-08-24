-- 145 — WP-31 (QD-62): TÁCH hai đường map — pricing (default) ⟂ picker (mọi màu).
--   Đọc: db/144 (quy_doi_export + 6 khoá). CHỈ DB.
--   Lý do (L-101): db/144 nới export sang "mọi DA_DUYET" → rủi ro nếu sau duyệt 2 màu/ma_plugin thì
--     pricing (plugin quy_doi.rb key theo ma_plugin) last-wins ăn giá sai. Picker lại CẦN thấy mọi màu.
--     → export TRẢ VỀ defaults-only (đúng 1 dòng/ma_plugin); picker dùng RPC riêng bom_ma_kho_ds.
--   IDEMPOTENT. HOÀN TÁC: chạy lại db/144 (quy_doi_export) + drop function bom_ma_kho_ds.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ VIỆC 1 · quy_doi_export về defaults-only (DA_DUYET AND la_mac_dinh) — giữ 6 khoá db/144 ═══
create or replace function kho.quy_doi_export()
  returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare vt text := kho.current_vai_tro();
begin
  if auth.uid() is null or vt in ('ceo','kho','ke_toan','tho') then
    return coalesce(
      (select jsonb_build_object(
         'thoi_gian_xuat', to_char(max(q.tao_luc), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         'so_dong', count(*),
         'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
           'mo_ta_thiet_ke', q.mo_ta_thiet_ke, 'ma_plugin', q.ma_plugin, 'ma_kho', q.ma_kho,
           'he_so_quy_doi', q.he_so_quy_doi, 'gia_von_kho', t.gia_von_bq,
           'vat_tu_id', v.id, 'ten', v.ten, 'don_vi_co_so', v.don_vi_co_so,
           'la_mac_dinh', q.la_mac_dinh, 'muc_tin_cay', q.muc_tin_cay, 'dvt_plugin', q.dvt_plugin
         ) order by q.ma_plugin, q.ma_kho), '[]'::jsonb))
       from kho.plugin_ma_map q
       left join kho.vat_tu v on v.ma = q.ma_kho
       left join kho.ton t on t.vat_tu_id = v.id
       where q.trang_thai = 'DA_DUYET' and q.la_mac_dinh = true),   -- ĐÚNG 1 dòng/ma_plugin: pricing không còn cửa last-wins
      jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb));
  end if;
  raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', coalesce(vt, '(không vai trò)');
end $function$;
grant execute on function kho.quy_doi_export() to anon, authenticated;

-- ═══ VIỆC 2 · picker màu: bom_ma_kho_ds() — MỌI mã kho ghép được (kể cả CHUA_DUYET), CHỈ ĐỌC ═══
-- Ván: người dựng model chọn thẳng mã kho (độ tin từ MẮT người chọn, không từ map) → cho hiện cả CHUA_DUYET.
-- GIÁ vẫn chỉ ăn dòng đã duyệt (quy_doi_export) → màu chưa duyệt KHÔNG làm sai tiền.
create or replace function kho.bom_ma_kho_ds()
  returns table(ma_plugin text, vat_tu_id uuid, ma text, ten text, don_vi_co_so text,
                la_mac_dinh boolean, muc_tin_cay text, trang_thai text)
  language plpgsql stable security definer set search_path to 'kho' as $$
declare v_vai text := coalesce(kho.current_vai_tro(),'');
begin
  if v_vai not in ('thiet_ke','tk_ban_hang','truong_nhom','kho','ceo') then
    raise exception 'bom_ma_kho_ds: chỉ thiet_ke/tk_ban_hang/truong_nhom/kho/ceo (vai "%")', coalesce(nullif(v_vai,''),'(chưa đăng nhập)'); end if;
  return query
    select q.ma_plugin, v.id, q.ma_kho, v.ten, v.don_vi_co_so, q.la_mac_dinh, q.muc_tin_cay, q.trang_thai
    from kho.plugin_ma_map q left join kho.vat_tu v on v.ma = q.ma_kho
    order by q.ma_plugin, q.la_mac_dinh desc, q.ma_kho;   -- mặc định trước, rồi mã → dropdown thứ tự cố định
end $$;
grant execute on function kho.bom_ma_kho_ds() to authenticated;

commit;
