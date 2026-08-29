# LUẬT LÀM VIỆC — Hệ kho / MES (togihome-kho)

> Repo này = hệ kho + web (Supabase schema `kho`, các app deploy, plugin đẩy dữ liệu).
> Khác repo plugin SketchUp (togihome-plugin, luật hình học tủ áo). Luật dưới đây cho phần **sản xuất / MES**.

## LUẬT SỐ 1 — TRA SÁCH TRƯỚC KHI ĐỀ XUẤT

LUẬT SỐ 1 — TRA SÁCH TRƯỚC KHI ĐỀ XUẤT.
Project có ba sách: MES_Meyer (điều hành sản xuất) · Garrison Managerial
Accounting (kế toán quản trị) · giáo trình quản trị sản xuất.
Trước khi đề xuất BẤT KỲ cấu trúc dữ liệu, quy trình, cách tính, hay luồng
nghiệp vụ nào — TRA SÁCH TRƯỚC. Nói rõ sách nói gì, ở chương mục nào,
rồi mới nói mình nghĩ gì. Sách không nói thì NÓI THẲNG 'sách không nói,
đây là tôi đoán'.

Chỗ tra nhanh cho việc hay gặp:
- Quy trình sản xuất gắn vào đâu, nhánh song song → MES ch.4.2.3, BẢNG 4.1
- Bảng vật tư suy từ quy trình → MES 4.2.4
- Đơn vị sản xuất, tem, truy vết → MES 4.4, 6.3
- Thu dữ liệu từ trạm, trạng thái máy → MES 6.1.3, 6.3.5
- Giờ chuẩn tự điều chỉnh → MES 5.4.2
- Định mức, chênh lệch, giá vốn → Garrison ch.9-10
- Lịch sản xuất, tải theo tổ, mốc đóng băng → quản trị sản xuất ch.6

ĐÃ VI PHẠM NHIỀU LẦN, mỗi lần đều phải sửa lại sau:
- suy giờ từ đơn giá ra 4,5 phút/mét (vô lý gấp ba)
- bắt CEO đi bấm giờ từng hoạt động ở xưởng (bất khả thi)
- định nhồi mon_id vào tem, trong khi MES nói tem có định danh độc lập
- đề xuất tách quy trình theo TẤM, trong khi BẢNG 4.1 đã cho sẵn cách:
  một work plan theo món, phần A và phần B đi nhánh riêng rồi gộp ở bước cuối

LUẬT SỐ 2 — ĐỌC HẾT BÁO CÁO TRƯỚC KHI ĐỀ XUẤT.
Nhiều lần câu trả lời nằm sẵn trong báo cáo vừa nhận mà không đọc kỹ,
rồi đi đường vòng ba lô.

## KỶ LUẬT ẢNH KIỂM MẮT — CẤM sửa dữ liệu để ép màn đẹp

**CẤM sửa dữ liệu để ép màn hình đẹp cho ảnh chụp kiểm mắt.** Ảnh phải phản ánh đúng thứ hệ thống làm được
với dữ liệu đang có. Cần dữ liệu khác để minh hoạ thì **DỰNG TRONG GIAO DỊCH rồi rollback**, hoặc **nói RÕ
trong báo cáo là đã sửa gì và khôi phục chưa**.

- **Đã vi phạm HAI lần** (rút kinh nghiệm, đừng lặp): **L-10b** ghi đè số đơn vị Kệ tivi (CAN-A-DEMO) thành 18
  cho cả 5 hoạt động → giờ đơn phình 34,10 → 47,96 (CEO bắt được, đã khôi phục). **L-11** đưa CAN-A-DEMO từ
  `cho_cat` về `dang_thiet_ke` để chụp "Việc của tôi".
- Số/giờ/tồn/giá trong ảnh là **con số THẬT** — sai một con số là sai cả bản kiểm mắt. Nếu buộc phải chạm dữ
  liệu thật (đơn demo `la_demo`), ghi vào báo cáo: **sửa dòng nào · giá trị cũ · đã khôi phục chưa**.

## KỶ LUẬT MẬT KHẨU / ĐĂNG NHẬP — CẤM tự đặt lại mật khẩu

**CẤM tự đặt lại mật khẩu bất kỳ tài khoản nào, kể cả tài khoản `.local` dùng thử.** Cần đăng nhập để chụp ảnh
thì **DỪNG và xin CEO**, như đã làm đúng ở **L-19**.

- **Đã vi phạm ở L-31** (tự reset `ceo@togihome.local` thành `ceo12345` để chụp màn ceo-only, sau đó CEO yêu cầu
  đổi về `togihome2026` cho khớp các tài khoản `.local` khác). Đừng lặp.
- Muốn có tài khoản thử thì **TẠO MỚI có tiền tố `test_`**, dùng xong **XOÁ và in xác nhận** — không đụng tài khoản có sẵn.

## KỶ LUẬT CODE — CẤM đặt tên class CSS 1–2 ký tự

**CẤM đặt tên class CSS một hoặc hai ký tự** trong app dùng chung stylesheet. Class mới phải có **tiền tố theo
màn** (vd `qt-nhat`, `ns-mo`).
- **Đã dính:** class `.mo` (nghĩa "muted/nhạt") của tab Quy trình đụng `.mo` (nền modal, `position:fixed; inset:0`)
  của app Sản phẩm → hai ô Tổ và Dùng ở bị kéo khỏi lưới, trông như **trống rỗng**. **Không test nào bắt được,
  chỉ mắt bắt** (L-13d). Vá bằng đổi `s mo` → `s nhat`.

## KỶ LUẬT TEST — ĐO THEO LOẠI BẢNG

LÔ NÀO DỰNG RPC ĐỌC BẢNG LỚN THÌ PHẢI ĐO. **Mức đo theo LOẠI bảng (CEO chốt 29/08):**
- **Bảng SỔ** (append-only lớn thật: `giao_dich`, `su_kien_quet`, `xep_lich`, `lich_thu`, sổ mới sau này):
  đo **100.000 dòng**, ngưỡng theo hạng (TÁC NGHIỆP <500ms · PHÂN TÍCH <900ms).
- **Bảng CHỨNG TỪ** (`don_hang`, `phieu_thu`, `don_mua`, `hoa_don_ncc`, `gia_ncc`, `vat_tu`…):
  đo **30.000 dòng** — bằng ~3 năm quy mô thật (~200 đơn/ngày). **KHÔNG đo 100k nữa.**
- **Lý do:** 100k chứng từ = hàng chục năm doanh số; đo sai đối tượng làm CẢ HỌ RPC tài chính
  (`dong_tien_ky`, `con_phai_thu`, `cm_don_ky`…) hiện ĐỎ GIẢ.

RPC thợ đứng chờ (quet_tem) quá 300ms = ĐỎ. Test cắn hai vế bắt lỗi logic, KHÔNG bắt lỗi tốc độ.

## KỶ LUẬT DEPLOY FILE ?raw

File import `?raw` (`togihome_sale.html`, `togihome_taichinh.html`…) là CHUỖI với bundler, **build xanh KHÔNG chứng minh cú pháp đúng**. Hai cổng bắt buộc mỗi lần deploy:
1. **`node --check`** trên JS trích ra, **TRƯỚC build**.
2. **Mở prod bằng Chrome thật** xác nhận app boot + đủ nav, **SAU deploy** — không boot thì **rollback ngay**, chẩn đoán sau.

Đã dính: 29/08 lệch 1 dấu `)` làm chết app Sale trên prod, robot kẹt boot bị đọc nhầm thành lỗi harness.
Đã dính: tram_dang_cho và do_gio_that timeout ở 10.000 tem trong khi
mọi test đều xanh — vì test chạy trên vài chục dòng.

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
