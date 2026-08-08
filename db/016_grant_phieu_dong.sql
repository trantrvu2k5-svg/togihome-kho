-- 016 — CẤP QUYỀN ĐỌC phieu_dong cho web (role authenticated). CEO duyệt nới CẤM ở lô giao diện.
--   Bảng phieu_dong đã có policy SELECT (doc_dang_nhap: ceo/kho/tho) nhưng THIẾU grant tầng bảng
--   -> role authenticated không đọc được đơn giá/thành tiền/số dòng. Cấp grant cho khớp policy.
--   Lưu ý: policy đã cho tho đọc -> sau grant, thợ cũng đọc được giá dòng (CEO đã biết & đồng ý).
--   Chỉ đổi QUYỀN, KHÔNG chạm dữ liệu. Chạy lại nhiều lần được.
begin;
grant select on kho.phieu_dong to authenticated;
commit;
