# Quy trình sản xuất (routing) — tham chiếu

> Nguyên tắc ranh giới hoạt động: xem `CLAUDE.md` mục "Quy trình sản xuất".
> DB: `db/061_quy_trinh_san_xuat.sql` (v-kho-55). Test: `web/ops/test_061.mjs`.

## Bảng
- **`quy_trinh_buoc`** — routing theo LÕI, đồ thị có nhánh (nội bộ, không đẩy web):
  `ma_loi` FK→san_pham_loi · `thu_tu` (bội 100) · `buoc_truoc int[]` (rỗng = khởi đầu) · `nhanh` · `hoat_dong` FK→`don_gia_baseline` · `to_phu_trach` · `gio_chuan` [TẠM] · `la_tam` · `ghi_chu` · unique(ma_loi, thu_tu).
- **`tram`** — trạm QR: `ma_tram` PK · `ten` · `hoat_dong` FK · `dang_dung`. Một trạm một hoạt động; một hoạt động nhiều trạm.

## 12 hoạt động = `don_gia_baseline(hoat_dong)` — KHÔNG đẻ bảng thứ hai
`cam · canh · cat · cup · dan · giuong_lap · goi · lot · pu · ray · son_canh · thung`. (Phủ sóng + tổ + đơn giá: báo cáo `phu_song_hoat_dong.md`.)

## RPC
- `quy_trinh_cua_loi(ma_loi)` → `{chua_co_quy_trinh, buoc:[...]}` (fail-đóng: luôn kèm cờ).
- `kiem_quy_trinh(ma_loi)` → mảng lỗi (rỗng = sạch): buoc_truoc trỏ thu_tu không tồn tại · chu trình · không với tới từ khởi đầu · không có bước khởi đầu.

## Quy trình tủ quần áo MẪU (5 bước có nhánh — CNC cắt+khoan gộp một hoạt động)

Nhánh THÙNG và CÁNH chạy song song sau bước CNC, gộp lại ở Lắp ráp:

```
100 CNC (cắt+khoan)  buoc_truoc {}          [khởi đầu]
200 Dán cạnh         buoc_truoc {100}       nhánh thùng
210 Chà lót          buoc_truoc {100}       nhánh cánh
310 Sơn PU           buoc_truoc {210}       nhánh cánh
400 Lắp ráp          buoc_truoc {200,310}   ← GỘP hai nhánh
```

⚠ **Mã bước CNC (100): chờ chốt `cam` vs `cat`.** `don_gia_baseline`: `cam`→tổ dan_canh (420đ, 0 lần dùng) · `cat`→tổ cnc (3.360đ). CEO ghi `cam`; nếu bước CNC thuộc tổ CNC thì có thể là `cat`. Xem `phu_song_hoat_dong.md`. SQL mẫu hiện để `cam`, đổi `cat` nếu chốt vậy.

Kiểm sau khi nhập: `select kho.kiem_quy_trinh('<ma_loi>');` phải trả `[]`.
