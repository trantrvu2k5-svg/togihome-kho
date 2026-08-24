-- 144 — WP-31 (QD-62) gỡ blocker map: quy_doi_export trả THÊM field cho cửa sổ đẩy plugin.
--   Đọc: db/025/026/134 (quy_doi_export) · db/143 (BOM). CHỈ DB.
--   quy_doi_export RETURNS jsonb (KHÔNG phải TABLE) → thêm khoá vào jsonb_build_object KHÔNG đổi kiểu trả
--     → create or replace ĐƯỢC, KHÔNG cần drop (bẫy 03 §C không áp ở đây).
--   THÊM 6 khoá (cuối object): vat_tu_id · ten · don_vi_co_so · la_mac_dinh · muc_tin_cay · dvt_plugin.
--   Lọc đổi: từ (trang_thai='DA_DUYET' AND la_mac_dinh) → chỉ trang_thai='DA_DUYET' (la_mac_dinh nay là CỘT
--     để plugin biết dòng mặc định). HÔM NAY: mọi dòng DA_DUYET đều là mặc định + duy nhất/ma_plugin
--     → trả ĐÚNG 26 dòng như cũ, caller pricing (plugin quy_doi.rb key theo ma_plugin) KHÔNG đổi.
--   ⚠ NỢ (báo CEO): các màu thay thế đang CHUA_DUYET → dropdown mới thấy 1 mã/ma_plugin tới khi duyệt màu.
--   IDEMPOTENT. HOÀN TÁC: chạy lại db/134 (quy_doi_export) + drop index plugin_ma_map_1default.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ VIỆC 2 · chặn ≥2 mặc định cùng một ma_plugin (hiện 0 nhóm vi phạm → tạo được) ═══
create unique index if not exists plugin_ma_map_1default on kho.plugin_ma_map(ma_plugin) where la_mac_dinh = true;

-- ═══ VIỆC 1 · mở rộng quy_doi_export (create or replace — jsonb, giữ tên + tham số + grant) ═══
create or replace function kho.quy_doi_export()
  returns jsonb language plpgsql stable security definer set search_path to 'kho' as $function$
declare vt text := kho.current_vai_tro();
begin
  -- CHO ĐỌC: đường anon/plugin (auth.uid() null) HOẶC vai trắng. Còn lại RAISE. (giữ nguyên guard db/026)
  if auth.uid() is null or vt in ('ceo','kho','ke_toan','tho') then
    return coalesce(
      (select jsonb_build_object(
         'thoi_gian_xuat', to_char(max(q.tao_luc), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         'so_dong', count(*),
         'quy_doi', coalesce(jsonb_agg(jsonb_build_object(
           'mo_ta_thiet_ke', q.mo_ta_thiet_ke, 'ma_plugin', q.ma_plugin, 'ma_kho', q.ma_kho,
           'he_so_quy_doi', q.he_so_quy_doi, 'gia_von_kho', t.gia_von_bq,
           -- 6 khoá WP-31 (thêm ở CUỐI):
           'vat_tu_id', v.id, 'ten', v.ten, 'don_vi_co_so', v.don_vi_co_so,
           'la_mac_dinh', q.la_mac_dinh, 'muc_tin_cay', q.muc_tin_cay, 'dvt_plugin', q.dvt_plugin
         ) order by q.ma_plugin, q.ma_kho), '[]'::jsonb))
       from kho.plugin_ma_map q
       left join kho.vat_tu v on v.ma = q.ma_kho
       left join kho.ton t on t.vat_tu_id = v.id
       where q.trang_thai = 'DA_DUYET'),
      jsonb_build_object('thoi_gian_xuat','khong_co_du_lieu','so_dong',0,'quy_doi','[]'::jsonb));
  end if;
  raise exception 'Vai trò "%" không được đọc giá vốn (bảng quy đổi).', coalesce(vt, '(không vai trò)');
end $function$;
grant execute on function kho.quy_doi_export() to anon, authenticated;

commit;
