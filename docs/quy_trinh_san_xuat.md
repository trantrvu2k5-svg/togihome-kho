# Quy trình sản xuất (routing) — tham chiếu

> Nguyên tắc ranh giới hoạt động: xem `CLAUDE.md` mục "Quy trình sản xuất".
> DB: `db/061` (nền) + `db/062` (dùng chung + giờ 2 phần + tự chạy + 3 nguồn). Test: `test_061` · `test_062`.

## Kiến trúc — quy trình DÙNG CHUNG nhiều lõi
Xưởng đẻ hàng trăm lõi/năm nhưng chỉ ~10–25 quy trình thật. Tủ áo 1m8 / 2m4 / đóng riêng một căn = CÙNG quy trình, chỉ khác **số đơn vị** của món.
- **`quy_trinh`** — `ma_quy_trinh` PK · `ten` · `mo_ta` · `dang_dung`.
- **`quy_trinh_buoc`** — thuộc QUY TRÌNH (không phải lõi): `ma_quy_trinh` FK · `thu_tu` (bội 100) · `buoc_truoc int[]` (rỗng = khởi đầu, ĐỒ THỊ có nhánh — đọc buoc_truoc, cấm suy thu_tu-1) · `nhanh` · `hoat_dong` FK→`don_gia_baseline` · `loai_buoc` ('nguoi'|'tu_chay') · **`gio_co_dinh`** (gá đặt, không theo kích thước) · **`gio_moi_don_vi`** (× số đơn vị) · `la_tam`. unique(ma_quy_trinh, thu_tu).
- **`san_pham_loi.ma_quy_trinh`** FK (NULL = lõi chưa gán). Gán lõi = 1 dòng update, KHÔNG nhân bản bước.
- **`tram`** — trạm QR: `ma_tram` PK · `hoat_dong` FK · `dang_dung`.

## 13 hoạt động = `don_gia_baseline(hoat_dong, ten)` — KHÔNG đẻ bảng thứ hai
| mã | tên | tổ |
|---|---|---|
| cat | Cắt CNC | cnc |
| dan | Dán cạnh | dan_canh |
| cam | Khoan cam/chốt | dan_canh |
| lot | Chà nhám+sơn lót | cha_lot |
| pu | Sơn PU (màu+bóng) | son_pu |
| son_canh | Sơn cạnh | son_pu |
| cup | Khoan cup bản lề | lap_rap |
| thung | Lắp ráp thùng | lap_rap |
| ray | Ghép+lắp ray ngăn kéo | lap_rap |
| canh | Lắp+căn chỉnh cánh | lap_rap |
| goi | Đóng gói | dong_goi |
| giuong_lap | Lắp ráp giường (gỗ TN) | giuong |
| cho_kho | Chờ khô (tự chạy, đơn giá công 0) | son_pu |

**CNC = `cat`** (cắt+khoan một lần gá). `cam` = khoan cam/chốt RIÊNG, chạy SAU dán cạnh. `thung`/`canh` là việc lắp ráp thật (không phải gói gộp). Không dòng nào chết.

## Số đơn vị của món — BA nguồn (`so_don_vi_mon`)
`ma_bien_the` + `hoat_dong` → `so_don_vi` · `nguon` ∈ {`cutlist` (tin cao) · `go_tay` (trung bình) · `uoc` (chờ quét)}.
**Cutlist KHÔNG bắt buộc** — món tự do / gỗ tự nhiên không có cutlist là bình thường. Chặn chỉ khi thiếu **CẢ BA** nguồn.

## RPC
- `quy_trinh_cua_loi(ma_loi)` → `{chua_co_quy_trinh, ma_quy_trinh, buoc:[...]}` (fail-đóng: luôn kèm cờ).
- `kiem_quy_trinh(ma_quy_trinh)` → mảng lỗi (rỗng = sạch): buoc_truoc trỏ thu_tu không tồn tại · chu trình · không với tới · không có bước khởi đầu.
- `gio_du_kien_cua_mon(ma_bien_the)` → giờ từng bước + tổng + **nguồn** từng số. Fail-đóng 3 mã RIÊNG: `LOI_CHUA_GAN_QUY_TRINH` · `THIEU_SO_DON_VI` (thiếu cả ba nguồn) · `THIEU_DON_GIA` (hoạt động chưa khai mẫu số). Bước `tu_chay` bỏ qua, không báo thiếu. Thiếu → `tong_gio=null`, KHÔNG trả 0.

## Quy trình MẪU đã seed: `TU-AO-MELAMINE` (8 bước, giờ [TẠM])
```
100 cat   {}         chung   Cắt CNC
200 dan   {100}      chung   Dán cạnh
250 cam   {200}      chung   Khoan cam/chốt
300 thung {250}      thùng   Lắp ráp thùng
310 cup   {250}      cánh    Khoan cup bản lề
320 ray   {300}      kéo     Ghép+lắp ray
400 canh  {300,310}  chung   Lắp+căn chỉnh cánh   ← gộp thùng+cánh
500 goi   {400,320}  chung   Đóng gói
```

## Gán quy trình cho lõi tủ áo + xem giờ dự kiến (CEO tự nhập)
```sql
-- 1) gán lõi vào quy trình dùng chung (thay <MA_LOI>):
update kho.san_pham_loi set ma_quy_trinh = 'TU-AO-MELAMINE' where ma_loi = '<MA_LOI>';

-- 2) nhập số đơn vị của một biến thể (thay <MA_BT>; nguồn cutlist|go_tay|uoc):
insert into kho.so_don_vi_mon(ma_bien_the, hoat_dong, so_don_vi, nguon) values
  ('<MA_BT>','cat',24,'go_tay'), ('<MA_BT>','dan',60,'go_tay') /* … đủ các hoạt động của quy trình … */;

-- 3) xem giờ dự kiến (kèm nguồn từng số):
select kho.gio_du_kien_cua_mon('<MA_BT>');
```

## Căn cứ sách

MES ch.4.2.3 BẢNG 4.1 — ví dụ work plan chuẩn:
   100 Cắt phần A · 200/210 Phay phần A (song song) · 300/310 Khoan phần A ·
   400 Mài phần A · 500 Lắp sơ bộ phần B · 600 Lắp sơ bộ 2 phần B ·
   700 Lắp phần A + phần B (gộp hai nhánh)
KẾT LUẬN: work plan gắn theo ARTICLE (món), KHÔNG gắn theo từng tấm.
Nhiều bộ phận đi nhánh khác nhau bên trong CÙNG một work plan, gộp ở bước cuối.
Cấu trúc hiện tại của Togihome (quy_trinh theo món + cột nhanh thùng/cánh)
ĐÚNG với sách. Không đổi.
