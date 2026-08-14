# LUẬT LÀM VIỆC — Hệ kho / MES (togihome-kho)

> Repo này = hệ kho + web (Supabase schema `kho`, các app deploy, plugin đẩy dữ liệu).
> Khác repo plugin SketchUp (togihome-plugin, luật hình học tủ áo). Luật dưới đây cho phần **sản xuất / MES**.

## Quy trình sản xuất

### Ranh giới hoạt động = chỗ BÀN GIAO VẬT LÝ, không phải danh sách động tác

**Một hoạt động = một lần món RỜI TAY THỢ và tới trạm khác.**
Ranh giới là chỗ bàn giao vật lý, KHÔNG phải danh sách động tác.

- **Máy làm ba việc trong một lần gá = MỘT hoạt động** — một cặp quét vào/ra.
  (Ví dụ: CNC cắt + khoan cam + khoan chốt trong cùng một lần gá = một hoạt động, không tách ba.)
- **Ngược lại: hai tổ khác nhau, hai lần bàn giao = PHẢI là hai hoạt động** — kể cả khi nghe như một việc.

Hệ quả:
- Danh mục 12 hoạt động = **một bảng duy nhất `kho.don_gia_baseline`** (khoá `hoat_dong`). Hoạt động vừa là đơn vị **giá vốn** vừa là đơn vị **quy trình** — cùng một đối tượng. **CẤM đẻ bảng danh mục công đoạn thứ hai.**
- Thêm/bớt hoạt động = thêm/bớt dòng trong `don_gia_baseline` (cùng bảng), KHÔNG đẻ bảng mới.
- Quy trình (`quy_trinh_buoc`) là **đồ thị có nhánh** — đọc `buoc_truoc`, **CẤM suy bước trước bằng `thu_tu - 1`**. Trạm (`tram`) tra ngược từ hoạt động; thêm máy = thêm dòng trạm, không sửa quy trình.
