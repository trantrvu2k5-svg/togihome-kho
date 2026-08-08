-- 020 — RPC anon đọc bảng quy đổi ĐÃ DUYỆT (để plugin tự tải, khỏi chép tay).
--   Security-definer: chạy quyền owner nên vượt RLS, nhưng CHỈ trả các dòng DA_DUYET + la_mac_dinh
--   và giá vốn CỦA CHÚNG (6 dòng). KHÔNG mở nguyên bảng quy_doi/ton/vat_tu cho anon.
--   Phơi giá vốn 6 mã đã duyệt ra công khai — CEO đã đồng ý (đổi giá bịa bằng giá vốn thật cho plugin).
--   Idempotent (create or replace). Chỉ đổi ĐỊNH NGHĨA HÀM + grant, KHÔNG chạm dữ liệu.
--   node ops/run_sql.mjs ../db/020_rpc_quy_doi_export.sql
begin;

create or replace function kho.quy_doi_export()
  returns jsonb language sql security definer set search_path = kho stable as $$
  select coalesce(
    jsonb_build_object(
      'thoi_gian_xuat', to_char(max(q.tao_luc), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'so_dong', count(*),
      'quy_doi', coalesce(jsonb_agg(
        jsonb_build_object(
          'mo_ta_thiet_ke', q.mo_ta_thiet_ke,
          'ma_plugin',      q.ma_plugin,
          'ma_kho',         q.ma_kho,
          'he_so_quy_doi',  q.he_so_quy_doi,
          'gia_von_kho',    t.gia_von_bq
        ) order by q.mo_ta_thiet_ke), '[]'::jsonb)
    ),
    jsonb_build_object('thoi_gian_xuat', 'khong_co_du_lieu', 'so_dong', 0, 'quy_doi', '[]'::jsonb)
  )
  from kho.quy_doi q
  left join kho.vat_tu v on v.ma = q.ma_kho
  left join kho.ton    t on t.vat_tu_id = v.id
  where q.trang_thai = 'DA_DUYET' and q.la_mac_dinh = true;
$$;

revoke all on function kho.quy_doi_export() from public;
grant execute on function kho.quy_doi_export() to anon, authenticated;

commit;
