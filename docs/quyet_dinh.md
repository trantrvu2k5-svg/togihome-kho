# Nhật ký quyết định kiến trúc — hệ kho / MES

> Mỗi quyết định một mục: ngày · nội dung · lý do · trạng thái.

## QD-01 (14/08) — Quy trình là ĐỒ THỊ CÓ NHÁNH
Quy trình là ĐỒ THỊ CÓ NHÁNH, đọc `buoc_truoc`, **CẤM suy `thu_tu - 1`**.
- **Lý do:** tủ áo có nhánh thùng và nhánh cánh chạy song song, gộp ở lắp ráp.
- **Trạng thái:** ĐÃ LÀM (v-kho-55).

## QD-02 (14/08) — Ranh giới hoạt động = bàn giao vật lý
Một hoạt động = một lần món rời tay thợ và bàn giao vật lý. Máy làm nhiều việc trong một lần gá = MỘT hoạt động. Hai tổ, hai lần bàn giao = HAI hoạt động.
- **Trạng thái:** ĐÃ LÀM (CLAUDE.md).

## QD-03 (14/08) — CẤM đẻ danh mục công đoạn thứ hai
CẤM đẻ danh mục công đoạn thứ hai. Mọi hoạt động FK về `don_gia_baseline` — bảng đang tính giá vốn theo hoạt động.
- **Trạng thái:** ĐÃ LÀM (v-kho-55).

## QD-04 (14/08) — 12 mã là HOẠT ĐỘNG THẬT, không trộn với bộ phận
12 mã hoạt động là HOẠT ĐỘNG THẬT, không trộn với bộ phận. `thung` và `canh` là việc lắp ráp ở tổ Lắp ráp, KHÔNG phải gói gộp. (Cảnh báo trước đó là sai, đã rút.)
- **Trạng thái:** ĐÃ XÁC NHẬN bằng bảng CEO lập với tổ trưởng.

## QD-05 (14/08) — Chà lót và Sơn PU là HAI hoạt động, có bước CHỜ KHÔ riêng
Chà lót và Sơn PU là HAI tổ, HAI hoạt động. Giữa chúng có CHỜ KHÔ — sẽ là bước riêng: có giờ, đơn giá công = 0, không ai quét, hệ thống tự suy.
- **Lý do:** nếu gộp, giờ khô sẽ nuốt vào đơn giá sơn và làm sai đơn giá; và mất khả năng đo khúc chờ.
- **Trạng thái:** CHƯA LÀM — thuộc lô A1b.

## QD-06 (14/08) — CUTLIST KHÔNG PHẢI ĐIỀU KIỆN BẮT BUỘC
Plugin chỉ dựng được 106 mẫu cố định. Món dựng tự do và hàng gỗ tự nhiên KHÔNG có cutlist, và đó là trạng thái bình thường, không phải lỗi.
Số đơn vị của mỗi hoạt động có BA nguồn, ghi rõ nguồn cho từng con số:
- `cutlist` — plugin sinh ra, tin cao
- `go_tay` — người nhập, tin trung bình
- `uoc` — áng chừng, chờ quét thật chỉnh lại

Hệ thống KHÔNG được chặn món vì thiếu cutlist. Chỉ được chặn khi KHÔNG CÓ nguồn nào cả.
- **Trạng thái:** CHƯA LÀM — thuộc lô A1b.
