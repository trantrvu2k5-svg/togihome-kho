-- HOÀN TÁC 011 — đưa 11 policy ĐỌC về ĐÚNG trạng thái trước khi vá: USING (auth.uid() IS NOT NULL).
-- Phao cứu sinh: chạy nếu file vá gây kẹt. Chạy lại nhiều lần được (ALTER POLICY idempotent).
--   node ops/run_sql.mjs ../db/011_hoan_tac.sql   (hoặc chạy trong Supabase SQL Editor bằng vai trò postgres)
-- CHỈ đụng 11 policy SELECT dưới đây. KHÔNG đụng nguoi_dung, grant, view, hàm, policy GHI.
begin;

alter policy "doc_dang_nhap" on kho.cai_dat       using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.giao_dich     using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.kho           using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.lo_nhap       using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.nha_cung_cap  using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.nhom          using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.phieu         using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.phieu_dong    using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.ton           using (auth.uid() is not null);
alter policy "doc_dang_nhap" on kho.vat_tu        using (auth.uid() is not null);
alter policy "phieu_doc"     on kho.phieu         using (auth.uid() is not null);

commit;
