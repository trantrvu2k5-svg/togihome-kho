-- db/195 · WP-79 L-09 vá · REFRESH v_lead_hien_hanh để lộ 4 cột khớp (db/194).
--   v_lead_hien_hanh = 'select distinct on(...) *' — view khoá DANH SÁCH CỘT lúc tạo (db/175), KHÔNG tự nhặt cột
--   thêm sau. Không refresh → khop_click_lead đọc l.khoa_khop báo "column does not exist". create or replace nối thêm
--   cột ở CUỐI (Postgres cho phép append cột, không đổi thứ tự cột cũ).
--   ⚠ or-replace an toàn chạy lại. Cổng backup QD-61.
begin;
create or replace view kho.v_lead_hien_hanh as
  select distinct on (page_id, hoi_thoai_id) *
  from kho.lead
  order by page_id, hoi_thoai_id, stt desc;
grant select on kho.v_lead_hien_hanh to authenticated;
do $$ begin
  perform 1 from information_schema.columns where table_schema='kho' and table_name='v_lead_hien_hanh' and column_name='khoa_khop';
  if not found then raise exception 'v_lead_hien_hanh THIẾU cột khoa_khop sau refresh'; end if;
  raise notice 'db/195 OK: v_lead_hien_hanh thấy 4 cột khớp.';
end $$;
commit;
