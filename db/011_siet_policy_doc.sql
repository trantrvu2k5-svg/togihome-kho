-- SIẾT 011 — 11 policy ĐỌC: đổi USING (auth.uid() IS NOT NULL) -> xét VAI TRÒ tường minh.
--   Trước: bất kỳ phiên hợp lệ nào (kể cả vai trò NULL: gmail mồ côi, tài khoản đã ngừng) đọc được tồn/phiếu/thẻ kho.
--   Sau : chỉ ceo | kho | tho (có dòng người dùng + dang_hoat_dong) mới đọc.
-- Chạy lại nhiều lần được (ALTER POLICY thay biểu thức tại chỗ, KHÔNG tạo policy trùng).
--
-- ĐÃ ĐO — bảng phieu có HAI policy đọc permissive (doc_dang_nhap + phieu_doc), Postgres nối bằng OR.
--   Bỏ sót một cái là phieu VẪN RÒ -> sửa CẢ HAI (11 policy trên 10 bảng).
-- KHÔNG đụng policy bảng NGƯỜI DÙNG (tu_doc / ceo_sua_nd) — đổi sẽ khoá vòng đăng nhập. KHÔNG đụng grant, view, hàm, policy GHI.
begin;

alter policy "doc_dang_nhap" on kho.cai_dat       using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.giao_dich     using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.kho           using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.lo_nhap       using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.nha_cung_cap  using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.nhom          using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.phieu         using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.phieu_dong    using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.ton           using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "doc_dang_nhap" on kho.vat_tu        using (kho.current_vai_tro() in ('ceo','kho','tho'));
alter policy "phieu_doc"     on kho.phieu         using (kho.current_vai_tro() in ('ceo','kho','tho'));

commit;
