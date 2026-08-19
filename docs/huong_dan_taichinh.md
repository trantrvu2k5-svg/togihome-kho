# NHỊP VẬN HÀNH APP TÀI CHÍNH

> Khung CEO chốt 18/08 — kiểm khớp UI thật 19/08 (L-52). Tên tab/nút/ô dưới đây đúng như trên màn. Vai dùng: **ceo · kế toán** (một số tab thao tác cần vai kho/xưởng/sale ở app khác).
>
> Ô **Kỳ** ở đầu mọi tab dùng CHUNG — đổi kỳ thì mọi số tính lại theo kỳ đã chọn.

---

## ĐẦU KỲ (ngày 1–3 — kế toán nhập, CEO duyệt)

**LUẬT: chốt tham số TRƯỚC khi kỳ chạy; giữa kỳ không sửa** (đổi giữa kỳ làm lệch mọi số đã tính).

1. **Chốt tham số kỳ** — tab **Định giá bán**, khối "Tham số kỳ":
   - **VAT (%)** (ô "Thuế VAT (%)") — vd 10.
   - **Hoa hồng**: "Hoa hồng sale/quản lý/thiết kế (%)" — **3,3 / 1,1 / 1,1** (% trên **doanh thu thuần**, QD-31).
   - **Chi phí năng lực / kỳ** — bấm nút **"Dùng số suy"** để lấy tự động từ lương tổ, hoặc gõ tay; lệch >10% số suy sẽ có cảnh báo mềm (không chặn).
   - Bấm **"Lưu tham số kỳ"**.
2. **Ngưỡng nhận xét** — tab **Nhận xét**, bảng "Ngưỡng của 8 luật" (◆ = đang dùng mặc định). Sửa nếu cần rồi bấm **"Lưu ngưỡng kỳ"** (áp từ kỳ đang chọn, kỳ cũ giữ nguyên). Để mặc định cũng được.
3. **Nhập lương tổ kỳ** — tab **Sổ tham số xưởng** (bảng lương tổ + % thời gian) → **"Lưu sổ tham số xưởng"**.
4. **Kiểm quỹ đầu kỳ** — tab **Dòng tiền**, ô "Quỹ đầu kỳ": số tự nối = quỹ cuối kỳ trước. Đối chiếu **số dư ngân hàng thật**; lệch → sửa **kèm lý do** (ô "Lý do (nếu sửa)") rồi **"Lưu quỹ đầu kỳ"**.

---

## HÀNG NGÀY

- **Kế toán (5–10' mỗi sáng):** đối chiếu sao kê hôm qua → mỗi khoản tiền về = **1 phiếu thu**. Tab **Dòng tiền**, form **"Ghi phiếu thu"**: Mã đơn · Ngày · Số tiền · **Loại** (Cọc đơn mới / Thu khi giao / Thu nợ kỳ trước) → **"Ghi phiếu"**. (Loại "đối soát COD" KHÔNG ghi ở đây — dùng form đối soát bên dưới.)
- **Vận hành (lúc bàn giao shipper):** đơn COD rời xưởng → tab **Dòng tiền**, form **"Xuất COD (đơn giao thu hộ)"**: Mã đơn · Tiền thu hộ · Ngày xuất · Đơn vị VC → **"Ghi COD đang giao"**.
- **Sale (app Sale):** chốt đơn **bắt buộc điền Nguồn khách + Thương hiệu** — gác tự chặn, không điền không chốt được.

---

## HÀNG TUẦN

- **Đối soát COD:** nhà VC gửi bảng đối soát → copy **cột mã đơn + số tiền + ngày**, dán vào ô lớn của form **"Đối soát COD về đợt"** (tab Dòng tiền, mỗi dòng: `mã đơn, số tiền, ngày`) → **"Đối soát cả đợt"** (một nút, cả đợt một lần). Đơn **hoàn** → form **"Hoàn COD (hàng quay lại)"** → **"Ghi hoàn"** (không sinh phiếu, tiền không đếm).
- **Chi ads:** marketing đưa số đã chạy → tab **Kênh & CAC**, form "Nhập chi ads kỳ" (mỗi dòng: Thương hiệu · Kênh · **Số tiền (gồm VAT)** · Ghi chú · Người nhập) → **"Lưu kỳ"**. Nhập số **ĐÚNG HOÁ ĐƠN (gồm VAT)** — máy tự bóc VAT, ô hiển thị "thật:" bên cạnh.
- **CEO liếc:** tab **Nhận xét** (8 luật) + khối "Còn phải thu" (nợ già) & "Tiền ở nhà vận chuyển" (COD kẹt) ở tab **Dòng tiền**.

---

## CUỐI KỲ (ngày 1–5 tháng sau)

1. **Nhập đủ chi phí kỳ** — tab **Chi phí kỳ**: mỗi dòng chọn Loại (7 loại) · Số tiền · Phân khúc · Ghi chú → **"Lưu kỳ"** (có nút "Chép từ kỳ trước").
   - **Giá CHƯA VAT** với khoản có hoá đơn khấu trừ; **THỰC CHI** với lương/khấu hao/không hoá đơn.
   - **TRÁNH nhập 5 mục TREO overhead** (đã nằm trong đơn giá khối ② tới khi QD-32 gỡ treo): **khấu hao máy CNC · điện chạy máy · điện chiếu sáng xưởng · khấu hao xe tải · lương quản đốc**. (App có sẵn khối cảnh báo ranh giới này ở đầu tab.)
2. **Ghi giao dịch vốn tháng** — tab **Dòng tiền**, form "Ghi giao dịch vốn": Ngày · Loại (vay mới / trả gốc / mua–bán tài sản / góp–rút vốn) · Số tiền → **"Ghi giao dịch"**. **Lãi vay KHÔNG ghi ở đây** — ghi ở Chi phí kỳ (loại "Khác", ghi chú "lãi vay"); ở vốn chỉ ghi **gốc vay**.
3. **Xử cảnh báo trước khi họp số** — tab **P/L**: giải quyết hết cảnh báo "đơn giao thiếu giá vốn/ship-lắp" (truy người điền: thiết kế đẩy giá vốn từ plugin, hoặc ceo/kho nhập tay ở tab "Giá vốn theo đơn") rồi mới họp.

---

## ⭐ BẢNG QUY ƯỚC VAT MỘT TRANG (chỗ sai nhiều nhất — ĐỌC KỸ)

| Khoản | Nhập số kiểu gì | Máy làm gì |
|---|---|---|
| **Giá chốt đơn** | **GỒM VAT** | máy bóc khi tính P/L |
| **Chi phí kỳ** | **CHƯA VAT** (có HĐ khấu trừ) / **THỰC CHI** (không HĐ) | dùng thẳng |
| **Chi ads** | **GỒM VAT** đúng hoá đơn | bóc VAT ở màn CAC · giữ gồm ở Dòng tiền |
| **Công nợ khách** | **GỒM VAT** (khách nợ số có VAT) | dùng thẳng |
| **Giá ván (plugin)** | **CHƯA VAT** | dùng thẳng |

---

## AI LÀM GÌ (ma trận vai × sổ)

| Sổ / thao tác | Vai làm | Tab |
|---|---|---|
| Tham số kỳ (VAT, hoa hồng, chi phí năng lực) | kế toán → CEO duyệt | Định giá bán |
| Lương tổ | kế toán | Sổ tham số xưởng |
| Ngưỡng nhận xét | ceo / kế toán | Nhận xét |
| Quỹ đầu kỳ | ceo / kế toán | Dòng tiền |
| Phiếu thu | kế toán | Dòng tiền |
| Xuất / đối soát / hoàn COD | vận hành + kế toán | Dòng tiền |
| Chi ads | kế toán (số từ marketing) | Kênh & CAC |
| Chi phí kỳ | kế toán | Chi phí kỳ |
| Giao dịch vốn | kế toán / CEO | Dòng tiền |
| Giá vốn đơn (mua ngoài/giường) | ceo / kho | Giá vốn theo đơn |
| Nguồn khách + thương hiệu khi chốt | sale | (app Sale) |
| Đọc P/L · Lãi theo đơn · Nhận xét · Dòng tiền | ceo / kế toán | (báo cáo) |

---

## ❓ CÂU HỎI CÒN TREO — overhead (kèm cho kế toán)

> **QD-32 (chưa gỡ):** 5 khoản sau hiện đang **treo** — chúng có thể đã nằm trong `overhead_phan_bo` của đơn giá xưởng (khối ②), nên **KHÔNG nhập lại** ở Chi phí kỳ để tránh tính trùng. Cần kế toán làm rõ để CEO quyết đưa về đâu:
>
> 1. **Khấu hao máy CNC** — đang tính vào đơn giá tổ (khối ②) hay là định phí chung của công ty?
> 2. **Điện chạy máy** (điện sản xuất) — theo máy/tổ, hay gộp điện chung?
> 3. **Điện chiếu sáng xưởng** — định phí xưởng hay phân bổ theo tổ?
> 4. **Khấu hao xe tải giao hàng** — vào chi phí giao (ship) hay định phí chung?
> 5. **Lương quản đốc** — vào overhead tổ hay lương quản lý (chi phí kỳ)?
>
> Chốt xong 5 mục này → gỡ treo, cập nhật hướng dẫn "được/không được nhập ở Chi phí kỳ".

---

*Tài liệu này hiển thị ngay trong app Tài chính — tab **Hướng dẫn** (nhóm Tham số). Nguồn: `docs/huong_dan_taichinh.md`.*
