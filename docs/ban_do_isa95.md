# Bản đồ ISA-95 — vị trí hệ Togihome

Hệ Togihome **trải cả cấp 4 lẫn cấp 3**. Sách MES giả định có ERP riêng ở trên đưa đơn xuống; Togihome không
có ERP tách rời — **không ai cấp đơn xuống, hệ TỰ SINH đơn**.

## Bốn cấp

| Cấp | Sơ đồ chuẩn có gì | Togihome có gì | Thiếu gì | Có cần không |
|---|---|---|---|---|
| **4 — ERP** | CRM · FIM · HRM · SRM · SCM | CRM (app sale) · FIM (app tài chính) | HRM · SRM · SCM | — |
| **3 — R&D** | CAD · CAM · CAP · DMU | plugin SketchUp = CAD+CAM · tab Quy trình = CAP | DMU | Không cần DMU |
| **3 — thực thi (MES)** | tài nguyên · quy trình · theo vết · thu dữ liệu · **lập lịch sản xuất** · **quản lý chất lượng** | tài nguyên (trạm/ca) · quy trình · theo vết (sổ quét) · thu dữ liệu (quét QR) | **lập lịch sản xuất · quản lý chất lượng** | — |
| **2 / 1 / 0** | SCADA · PLC · cảm biến/thiết bị | (không có) | — | **KHÔNG CẦN** — máy CNC không nối mạng, xưởng thủ công |

## LỖ LỚN NHẤT — Lập lịch sản xuất (Scheduling)

Nằm **giữa Quy trình và Theo vết**. **Bốn bài toán đang treo đều thuộc ô này:**
- ngày giao
- tải theo tổ
- nhu cầu vật tư
- bước tiếp theo
