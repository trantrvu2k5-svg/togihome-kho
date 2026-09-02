# 04 — HỆ TÀI CHÍNH (hoàn chỉnh)

> Cập nhật 2026-08-19 · tại tag **v-kho-105** · **thay bản cũ** (file này MỚI — trước đây nội dung tài chính rải trong 01).
> App Tài chính = 1 trong 7 app (project Cloudflare Pages riêng). Vai vào: **ceo · ke_toan**. Ô **Kỳ** (`YYYY-MM`) dùng chung mọi tab.

---

## A. SƠ ĐỒ 5 TẦNG — tầng nào phủ màn nào

```
TẦNG 1 · SỔ GỐC (người nhập tay)                    →  tab NHẬP SỔ + THAM SỐ
  tham_so_tai_chinh (VAT·hoa hồng·chi phí năng lực·quỹ·9 ngưỡng)  → Định giá bán, Nhận xét
  luong_to (lương+BH+overhead tổ)                                  → Sổ tham số xưởng
  chi_phi_ky (7 loại actuals)                                      → Chi phí kỳ
  chi_ads (gồm VAT)                                                → Kênh & CAC
  phieu_thu · giao_cod · giao_dich_von · quy_dau_ky                → Dòng tiền
        │
        ▼
TẦNG 2 · GIÁ VỐN ĐƠN (3 khối k1/k2/k3)              →  tab Giá vốn theo đơn
  don_hang_gia_von (plugin đẩy / nhập tay ceo·kho)   → gvdon; RPC gia_von_don_ds (phân trang)
        │
        ▼
TẦNG 3 · P/L KỲ (số dư đảm phí, phân khúc theo dong) →  tab P/L
  pl_ky → doanh thu thuần · biến phí · số dư đảm phí · định phí truy được/chung · lãi thuần (QD-27)
        │
        ▼
TẦNG 4 · PHÂN TÍCH CHUYÊN ĐỀ (một nguồn số với P/L)  →  tab Lãi theo đơn · Kênh & CAC · (Lấp đầy) · Dòng tiền
  cm_don_ky (CM/đơn) · kenh_cac_ky (CAC brand×kênh) · lap_day_ky (năng lực) · dong_tien_ky (7 khối tiền)
        │
        ▼
TẦNG 5 · NHẬN XÉT TỰ ĐỘNG (meta — gọi lại tầng 3+4) →  tab Nhận xét
  nhan_xet_ky = 8 luật đối chiếu ngưỡng, câu hỏi + bằng chứng + căn cứ (QD-41)
```

**Nguyên tắc xuyên suốt:** mọi con số do DB tính (RPC), client KHÔNG tính lại. Màn phân tích/nhận xét **tái dùng RPC nguồn**, không nhân bản công thức (một bản sự thật).

---

## B. 16 QUYẾT ĐỊNH TÀI CHÍNH (QD-27 → QD-42) — 1 dòng/QD

| QD | Lô | Tóm tắt |
|---|---|---|
| **27** | L-43 | P/L nội bộ định dạng **số dư đảm phí**, phân khúc theo `dong` (lẻ/combo/dự án) — Garrison ch.6. |
| **28** | L-43 | Bảng `chi_phi_ky` = sổ **ACTUALS** thực chi, tách khỏi tham số dự toán. |
| **29** | L-43 | Nhãn **biến phí / định phí**: k1+k2+k3+ship+hoa hồng = biến phí; chi phí kỳ = định phí (truy được / chung). |
| **30** | L-42/43 | **Quy ước VAT**: giá chốt GỒM VAT (máy bóc); chi phí kỳ CHƯA VAT (có HĐ) / THỰC CHI (không HĐ); giá vốn CHƯA VAT. |
| **31** | L-43 | Hoa hồng = **phương án B**, cơ sở **doanh thu THUẦN** (sale 3,3% · quản lý 1,1% · thiết kế 1,1%). |
| **32** | L-43 | **RANH GIỚI khối ② ↔ chi phí kỳ**: 5 mục overhead TREO (khấu hao CNC · điện máy · điện xưởng · khấu hao xe tải · lương quản đốc) — KHÔNG nhập lại ở chi phí kỳ tới khi gỡ treo. |
| **33** | L-45 | **ÉP nguồn khách** tại cổng chốt đơn (6 giá trị nguon_khach), nhắc mềm ở báo giá. |
| **34** | L-45 | Khách **MỚI** xác định lúc `da_giao` theo `ngay_mua_dau` (toàn công ty — giữ cho P/L). |
| **35** | L-45 | Cột chuẩn **sđt + kg**; đính chính `kgs` KHÔNG phải cột trùng (array không-gian). |
| **36** | L-46 | Thước **LẤP ĐẦY năng lực bằng TIỀN** (Garrison App.3A): chi phí năng lực, bỏ trống → cảnh báo mềm. |
| **37** | L-47b | Màn **Lãi theo đơn** (CM/đơn), một nguồn số với `pl_ky`. Perf 100k ~527ms — CEO chấp nhận (gốc luật tốc độ 2 hạng). |
| **38** | L-48a | **Một thương hiệu một dòng** danh mục; brand thừa TẮT (ngưng) không xoá; view `thuong_hieu_ban` = 9 brand đang bật. |
| **39** | L-48 | Màn **Kênh & CAC** theo thương hiệu + bảng `chi_ads`; ads GỒM VAT (bóc ở CAC); gác ép thương hiệu; khách mới theo brand. |
| **40** | L-49 | Sổ **phiếu thu + COD + giao dịch vốn** + màn **Dòng tiền** 7 khối (Garrison ch.14: tách khu vốn, ghi gộp không bù trừ, khép vòng quỹ). **Luật tốc độ 2 hạng.** |
| **41** | L-50 | Màn **Nhận xét theo luật**: 8 luật + 9 ngưỡng tham số kỳ + im lặng mẫu mỏng + giọng câu hỏi (Garrison ch.6: cấm gợi ý cắt segment). Hạng META-MÀN. |
| **42** | L-51/52 | **Nav 3 nhóm** (Nhập sổ/Báo cáo/Tham số) + default theo vai + **tab Hướng dẫn** (docs render) + vá 10 chỗ hở nghiệp vụ. |

---

## C. BẢNG QUY ƯỚC VAT MỘT TRANG (chỗ sai nhiều nhất)

| Khoản | Nhập kiểu gì | Máy làm gì |
|---|---|---|
| **Giá chốt đơn** | GỒM VAT | bóc khi tính P/L |
| **Chi phí kỳ** | CHƯA VAT (có HĐ khấu trừ) / THỰC CHI (không HĐ) | dùng thẳng |
| **Chi ads** | GỒM VAT đúng hoá đơn | bóc ở màn CAC · giữ gồm ở Dòng tiền |
| **Công nợ khách** | GỒM VAT | dùng thẳng |
| **Giá vốn (k1/k2/k3) / giá ván plugin** | CHƯA VAT | dùng thẳng |

---

## D. LUẬT TỐC ĐỘ 2 HẠNG (QD-40, áp chung mọi RPC)

- **TÁC NGHIỆP** (người đứng chờ: ghi phiếu, chốt đơn, quét tem): **< 500ms** (tem thợ chờ < 300ms).
- **PHÂN TÍCH** (báo cáo tổng hợp: pl_ky, cm_don_ky, kenh_cac_ky, dong_tien_ky, con_phai_thu…): **< 900ms warm @stress 100k**.
- **META-MÀN** (RPC gọi lại nhiều RPC phân tích — `nhan_xet_ky` gọi 6 nguồn): ngân sách = **Σ các nguồn** (~2,6s @100k); từng nguồn vẫn <900ms.
- Gốc 900: plpgsql chạy tuần tự + 1 worker (PG tắt parallelism trong hàm) → quét 100k = sàn ~500-600ms + headroom. Kỳ THẬT vài trăm đơn <50ms.
- ⚠ **Bẫy đo perf:** đo qua savepoint mỗi call làm tràn subtrans SLRU → số giả chậm; phải đo DIRECT (set role 1 lần như prod).
- ⚠ **Bẫy overload:** thêm `param default` cho hàm có test-tự-nạp-lại → overload ambiguous; giữ chữ ký gốc + LIMIT trần.

---

## E. LUỒNG TIỀN — 4 TRẠNG THÁI (QD-40)

```
KHÁCH NỢ  ──(COD xuất xưởng)──▶  Ở NHÀ VẬN CHUYỂN  ──(đối soát về)──▶  ĐÃ THU
(giá chốt − Σ phiếu thu)         (giao_cod dang_giao,               (phieu_thu doi_soat_cod
                                  tuổi >14 đỏ)                        + phí VC → chi_phi_ky)
                                        │
                                   (hàng quay lại)
                                        ▼
                                     HOÀN — KHÔNG sinh phiếu, tiền không đếm
```
- Nguồn sự thật thu tiền = `phieu_thu` (cột `ngay_thu`/`so_tien_thuc_thu` cũ trên đơn ĐÓNG BĂNG lịch sử).
- Công nợ hợp nhất MỘT nguồn: `con_phai_thu` & `dieu_hanh_cong_no_khach` cùng đọc `phieu_thu`, cùng LOẠI đơn COD dang_giao (1 đơn không ở 2 khối).
- Ngoài kinh doanh (`giao_dich_von`): vào = vay_moi/ban_tai_san/gop_von; ra = tra_goc_vay/mua_tai_san/rut_von. Lãi vay ở chi_phi_ky, gốc vay ở đây.
- Đối chiếu quỹ khép vòng: **quỹ đầu kỳ + ròng KD + ròng ngoài KD = quỹ cuối kỳ** (lệch số dư ngân hàng thật = có thu/chi quên ghi).

---

## F. BẢNG "ĐỂ SAU" (nợ + ghi ngỏ tài chính — điều kiện kích hoạt)

| Việc | Vì sao chưa làm | Điều kiện kích hoạt |
|---|---|---|
| **Gỡ treo 5 mục overhead** (QD-32) | Chưa rõ khấu hao CNC / điện máy / điện xưởng / khấu hao xe tải / lương quản đốc nằm ở khối ② hay định phí chung | CEO hỏi kế toán làm rõ → phân bổ lại → mở nhập ở chi phí kỳ |
| **CAC tối đa (WP-76, 01/09, QD-91)** | `cac_toi_da_ky` 5 dải × 2 cột; `bien_muc_tieu` NULL — **cấm suy từ he_so_m**; giá sàn chỉ hiện khi người nhập CAC dự kiến (1,5tr placeholder đã cắt khỏi tử số); cột ngắn hạn KHOÁ tới khi k3 tách biến/định | HAI cột: **ngắn hạn** = CM đơn − chi phí tăng thêm − chi phí cơ hội khi nguồn lực kín (nhận/không nhận đơn) · **dài hạn = giá sàn** = gánh định phí phân bổ + biên mục tiêu (đặt giá niêm yết, giá tối thiểu đơn lẻ). Cột nào dẫn đọc từ thước lấp đầy năng lực QD-36 | ⚠ Khối ③ CHƯA có tử số (luong_to thiếu nhóm thiết kế; chi_phi_ky kỳ 08 = 0). 1,5tr trong DACTA là PLACEHOLDER. Biên mong muốn: he_so_m + ô biên mục tiêu (trống → chỉ hiện CAC hoà vốn) |
| **App Quảng cáo (WP-93, 02/09)** | RPC `ads_*`: `ads_bang_ky` · `ads_tong_so_sanh` · `ads_viec_phai_lam` · `ads_do_phu` · `ads_ad_ngay` + bảng tham số `ads_nguong` (ngưỡng lưu bảng có khoảng hiệu lực, QD-93; [TẠM]: 5 gốc + nhịp-chung/gộp/cờ-ẩn-tỷ-lệ thêm ở L-04·05). Đèn trần CAC mức chiến dịch không lộ số (QD-92) | CTR/CPC theo `inline_link_clicks`, KHÔNG theo `clicks` tổng |
| **Chi ads (01/09)** | `chi_ads_ngay`/`chi_chien_dich_ngay` kéo tự động từ Meta (chi NGUYÊN TRẠNG + nhãn `chua_ro_vat` — chưa rõ gồm VAT chưa; CEO đối chiếu 1 hoá đơn Meta tháng 8 để chốt hệ số). `chi_ads` hạt kỳ × brand nay TỰ GỘP (WP-90, QD-90, v-kho-142). **CƠ CHẾ xong, VẬN HÀNH chưa: bộ kéo Meta KHÔNG có lịch chạy nào (không cron/launchd/Action) — số chỉ tươi khi có người gõ tay `node keo_chi_ads_meta.mjs`.** Nợ WP-91: (i) scheduler kéo + gọi `chi_ads_gop_meta` định kỳ; (ii) mốc tiến + dải đỏ khi trễ. phủ 1/9 brand (6 tài khoản đều SCONCEPT); chi_ads KHÔNG vào pl_ky, chỉ qua Dòng tiền. **Từ 02/09 (WP-93): CTR/CPC tính trên `inline_link_clicks` (bấm-vào-link), KHÔNG phải mọi lượt bấm — số CTR trước 02/09 sai CAO ~2,2×; bộ kéo từng lệch múi giờ −1 ngày (gán sai ngày), đã vá + kéo lại toàn khoảng.** | ⚠ CAC 08 = vô hạn vì khách mới = 0 (hệ chưa có đơn thật). Mốc kiểm lại 01/10 |
| **Bảo hiểm & overhead — QD-56** | Bảo hiểm 60tr/tháng toàn công ty, không biết từng người → phân bổ theo lương (Garrison ch.3): 60/634tr ≈ 9,5% → 30,7tr về 7 tổ theo lương tổ, 29,3tr dòng "Bảo hiểm sale+VP" phân khúc CHUNG. **Overhead phân bổ tổ = 0**: định phí chung nằm ở Dòng chi, P/L số dư đảm phí (QD-40–42) không đẩy định phí vào giá vốn đơn — nhập cả hai = đếm đôi | Điểm hoà vốn: định phí ≈ 1,9 tỷ/tháng ≈ 23 tỷ/năm trên DT 60 tỷ → tỷ lệ số dư đảm phí cần **≥ 38%** |
| ~~**Sổ NCC vật tư**~~ **ĐÃ LÀM 23/08 (WP-22, QD-57, v-kho-117)** | `hoa_don_ncc` → `con_phai_tra` → `phieu_chi_ncc` → Dòng tiền khối 6 "Trả NCC". Việc tay: ghi phiếu chi mỗi lần trả tiền NCC | Nợ nhỏ: `con_phai_tra` 627ms ở ca xấu 100k HĐ/1 NCC → denormalize nếu cần |
| **Kênh con FB/Google** (QD-39 ngỏ) | CAC v1 gom theo 6 kênh gốc; chi tiết ghi vào ghi_chu | Marketing cần tách hiệu quả từng nền tảng |
| **Tách loại phí VC/COD** (QD-40) | v1 ghi vào chi_phi_ky loại 'khac' ghi chú "phí VC/COD" | Cần báo cáo riêng chi phí giao vận |
| **Tách loại lãi vay** (QD-40) | v1 ghi chi_phi_ky loại 'khac' ghi chú "lãi vay" | Cần tách chi phí tài chính khỏi "khác" |
| **Denormalize `da_thu`** trên don_hang | dong_tien_ky/con_phai_thu ~580ms @100k đạt hạng phân tích; chưa cần | Nếu 1 màn cần <500ms ở quy mô lớn thật |
| **Bảng lịch sử nhận xét** | L-50 v1 tính lại mỗi lần mở; chưa lưu vết theo kỳ | CEO muốn so nhận xét giữa các kỳ |
| **5 test đỏ pre-existing + overload gui_ban_thiet_ke** | Drift từ L-48/L-49 + nợ db/048 — không do lô tài chính | Lô riêng dọn test (xem so_no.md) |
