# 00 — LUẬT LÀM VIỆC (đọc trước tiên)

> Trích từ `CLAUDE.md` của repo `togihome-kho`. Đây là luật, KHÔNG phải gợi ý. Vi phạm = phải làm lại.

---

## LUẬT SỐ 1 — TRA SÁCH TRƯỚC KHI ĐỀ XUẤT

Project có ba sách: **MES_Meyer** (điều hành sản xuất) · **Garrison Managerial Accounting** (kế toán quản trị) · **giáo trình quản trị sản xuất**.

Trước khi đề xuất BẤT KỲ cấu trúc dữ liệu, quy trình, cách tính, hay luồng nghiệp vụ nào — **TRA SÁCH TRƯỚC**. Nói rõ sách nói gì, ở chương mục nào, rồi mới nói mình nghĩ gì. Sách không nói thì **NÓI THẲNG "sách không nói, đây là tôi đoán"**.

**Bảng tra nhanh:**
- Quy trình sản xuất gắn vào đâu, nhánh song song → MES ch.4.2.3, BẢNG 4.1
- Bảng vật tư suy từ quy trình → MES 4.2.4
- Đơn vị sản xuất, tem, truy vết → MES 4.4, 6.3
- Thu dữ liệu từ trạm, trạng thái máy → MES 6.1.3, 6.3.5
- Giờ chuẩn tự điều chỉnh → MES 5.4.2
- Định mức, chênh lệch, giá vốn → Garrison ch.9-10
- Lịch sản xuất, tải theo tổ, mốc đóng băng → quản trị sản xuất ch.6

**Đã vi phạm nhiều lần** (mỗi lần phải sửa lại sau): suy giờ từ đơn giá ra 4,5 phút/mét (vô lý gấp ba) · bắt CEO bấm giờ từng hoạt động ở xưởng (bất khả thi) · định nhồi mon_id vào tem (MES nói tem có định danh độc lập) · tách quy trình theo TẤM (BẢNG 4.1 đã cho sẵn: một work plan theo MÓN, phần A/B đi nhánh riêng rồi gộp cuối).

## LUẬT SỐ 2 — ĐỌC HẾT BÁO CÁO TRƯỚC KHI ĐỀ XUẤT

Nhiều lần câu trả lời nằm sẵn trong báo cáo vừa nhận mà không đọc kỹ, rồi đi đường vòng ba lô.

---

## KỶ LUẬT ẢNH KIỂM MẮT — CẤM sửa dữ liệu để ép màn đẹp

**CẤM sửa dữ liệu để màn hình đẹp cho ảnh chụp.** Ảnh phải phản ánh đúng thứ hệ làm được với dữ liệu đang có. Cần dữ liệu khác để minh hoạ → **DỰNG TRONG GIAO DỊCH rồi rollback**, hoặc **nói RÕ trong báo cáo đã sửa gì và khôi phục chưa**. Số/giờ/tồn/giá trong ảnh là **con số THẬT** — sai một con số là sai cả bản kiểm mắt.
- Đã vi phạm HAI lần (L-10b ghi đè số đơn vị Kệ tivi làm giờ phình; L-11 kéo đơn về trạng thái khác để chụp). Đừng lặp.

**CẤM nghiệm thu giao diện bằng bản tự render/shim.** Ảnh kiểm mắt phải chụp từ **TRANG DEPLOY THẬT, đăng nhập thật, trình duyệt thật**. Bản tự render (shim createElement→HTML, hay serve component tách rời) chỉ dùng lúc đang dựng, **KHÔNG có giá trị nghiệm thu** — nó bỏ mất CSS/JS bao quanh của app thật (vd `.ca button` ghi đè `.bg-o`), nên "giống" trên shim mà "sai" trên trang thật.
- **Dính ở L-51:** shim tự chấm giống v5 BA lần trong khi trang thật sai. **Gốc (L-52):** `.ca button{background:none…}` (đặc thù 0,1,1) đè `.bg-o`/nút (0,1,0) → mọi thẻ/nút mất nền màu trên trang thật; shim không có `.ca button` nên không thấy. Bài học: **CSS của app bao quanh màn — luôn kiểm cascade trên bundle/trang THẬT, không trên bản tách.**

## KỶ LUẬT MẬT KHẨU — CẤM tự đặt lại mật khẩu

**CẤM tự đặt lại mật khẩu bất kỳ tài khoản nào, kể cả `.local` dùng thử.** Cần đăng nhập để chụp ảnh thì **DỪNG và xin CEO** (như đã làm đúng ở L-19). Muốn tài khoản thử → tạo mới tiền tố `test_`, dùng xong XOÁ và in xác nhận.

## KỶ LUẬT CODE — CẤM đặt tên class CSS 1–2 ký tự

Trong app dùng chung stylesheet, class mới phải có **tiền tố theo màn** (vd `qt-nhat`, `ns-mo`).
- Đã dính: class `.mo` của tab Quy trình đụng `.mo` (nền modal `position:fixed;inset:0`) của app Sản phẩm → hai ô bị kéo khỏi lưới, trông trống rỗng. **Không test nào bắt được, chỉ mắt bắt.**

## KỶ LUẬT TEST — ĐO Ở MỨC 100.000 DÒNG

Lô nào dựng RPC đọc bảng lớn thì phải **đo ở mức 100.000 dòng**. Test cắn hai vế (bắt lỗi logic, không bắt lỗi tốc độ).
- Đã dính: `tram_dang_cho`/`do_gio_that` timeout ở 10.000 tem trong khi mọi test đều xanh — vì test chạy trên vài chục dòng.

**LUẬT TỐC ĐỘ 2 HẠNG (CEO chốt 18/08 — QD-40):**
- **Hạng TÁC NGHIỆP** (người đứng chờ: ghi phiếu, chốt đơn, `quet_tem`…): **< 500ms** (tem thợ chờ: < 300ms).
- **Hạng PHÂN TÍCH** (màn báo cáo: `pl_ky`/`cm_don_ky`/`kenh_cac_ky`/`dong_tien_ky`/`con_phai_thu`… và mọi màn phân tích sau): **< 900ms warm @100k**.
- Gốc 900: plpgsql chạy tuần tự + 1 worker (PG tắt parallelism trong hàm) → quét 100k = sàn ~500-600ms + headroom tải. Kỳ thật <50ms.
- **Hạng META-MÀN** (RPC gọi lại nhiều RPC phân tích, không tính lại — vd `nhan_xet_ky` gọi 6 nguồn): ngân sách = **Σ các nguồn** (~2,6s @100k); từng nguồn vẫn <900ms. Real kỳ <100ms.
- RPC mới **tự chiếu hạng**, hết ngoại lệ lẻ. **Tác nghiệp CẤM mượn ngưỡng phân tích** — chậm thì tối ưu/denormalize.

**BẪY ĐO PERF — phải đo DIRECT, không savepoint:**
- Helper test `asK()` tạo **1 savepoint mỗi call**. Chuỗi test dài (>64 subxid) → **tràn subtrans SLRU của Postgres** → quét bảng lớn sau đó chậm GIẢ (587ms thật → 980-1210ms). Prod không có savepoint lồng nên không dính.
- ⟹ Đo perf: **set role + jwt claims MỘT LẦN rồi `c.query` thẳng** (giống prod), KHÔNG bọc savepoint mỗi call. (Đã dính L-49; xem đầu `web/ops/test_116.mjs`.)

## RANH GIỚI HOẠT ĐỘNG = chỗ BÀN GIAO VẬT LÝ (QD-02)

Một hoạt động = một lần món RỜI TAY THỢ và tới trạm khác. Máy làm ba việc trong một lần gá = MỘT hoạt động. Hai tổ, hai lần bàn giao = PHẢI hai hoạt động. Danh mục 13 hoạt động = một bảng duy nhất `don_gia_baseline`. **CẤM đẻ bảng danh mục công đoạn thứ hai.**

## MỌI QUYẾT ĐỊNH NGHIỆP VỤ PHẢI CÓ QD

Mỗi quyết định cấu trúc/quy trình/cách tính ghi một mục trong `docs/quyet_dinh.md`: ngày · nội dung · **lý do** · trạng thái. Không có QD = quyết định chưa tồn tại, người sau không biết vì sao làm vậy. (Xem file `03_DUONG_DA_DI.md` cho lý do từng QD.)

---

## CÁCH LÀM VIỆC VỚI CEO (quan trọng — đọc kỹ)

- **CEO không viết code.** CEO dán lệnh vào Claude Code.
- **Lệnh phải gộp sẵn MỘT khối dán được ngay**, không bắt CEO tự ghép từ nhiều mẩu.
- **Mỗi lệnh có số hiệu (L-xx)** để CEO biết dán cái nào.
- **Màn có giao diện: VẼ FILE MẪU HTML trước, CEO duyệt bằng mắt, RỒI MỚI code.** Không code UI khi chưa có mẫu duyệt.
- **Mặc định CẤM COMMIT.** Làm xong thì deploy, chụp ảnh, **DỪNG chờ CEO kiểm mắt**. Chỉ commit khi CEO ra lệnh commit riêng.
- **Tự quyết những chuyện quyết được.** Đừng hỏi ngược CEO những thứ đọc code hoặc tra sách là biết.
- **Báo cáo dài KHÔNG gửi file `.md`** — CEO gửi lên bị RỖNG (đã dính 5 lần). **IN THẲNG RA TERMINAL**, chia nhiều lần, mỗi lần gọn một màn hình để chụp ảnh. (File `.md` chỉ để LƯU vào `~/Downloads/` hoặc repo, không phải để CEO đọc trên chat.)
