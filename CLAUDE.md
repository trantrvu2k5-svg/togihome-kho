# LUẬT LÀM VIỆC — Hệ kho / MES (togihome-kho)

> Repo này = hệ kho + web (Supabase schema `kho`, các app deploy, plugin đẩy dữ liệu).
> Khác repo plugin SketchUp (togihome-plugin, luật hình học tủ áo). Luật dưới đây cho phần **sản xuất / MES**.

## KỶ LUẬT ẢNH KIỂM MẮT — CẤM sửa dữ liệu để ép màn đẹp

**CẤM sửa dữ liệu để ép màn hình đẹp cho ảnh chụp kiểm mắt.** Ảnh phải phản ánh đúng thứ hệ thống làm được
với dữ liệu đang có. Cần dữ liệu khác để minh hoạ thì **DỰNG TRONG GIAO DỊCH rồi rollback**, hoặc **nói RÕ
trong báo cáo là đã sửa gì và khôi phục chưa**.

- **Đã vi phạm HAI lần** (rút kinh nghiệm, đừng lặp): **L-10b** ghi đè số đơn vị Kệ tivi (CAN-A-DEMO) thành 18
  cho cả 5 hoạt động → giờ đơn phình 34,10 → 47,96 (CEO bắt được, đã khôi phục). **L-11** đưa CAN-A-DEMO từ
  `cho_cat` về `dang_thiet_ke` để chụp "Việc của tôi".
- Số/giờ/tồn/giá trong ảnh là **con số THẬT** — sai một con số là sai cả bản kiểm mắt. Nếu buộc phải chạm dữ
  liệu thật (đơn demo `la_demo`), ghi vào báo cáo: **sửa dòng nào · giá trị cũ · đã khôi phục chưa**.

## KỶ LUẬT CODE — CẤM đặt tên class CSS 1–2 ký tự

**CẤM đặt tên class CSS một hoặc hai ký tự** trong app dùng chung stylesheet. Class mới phải có **tiền tố theo
màn** (vd `qt-nhat`, `ns-mo`).
- **Đã dính:** class `.mo` (nghĩa "muted/nhạt") của tab Quy trình đụng `.mo` (nền modal, `position:fixed; inset:0`)
  của app Sản phẩm → hai ô Tổ và Dùng ở bị kéo khỏi lưới, trông như **trống rỗng**. **Không test nào bắt được,
  chỉ mắt bắt** (L-13d). Vá bằng đổi `s mo` → `s nhat`.

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
