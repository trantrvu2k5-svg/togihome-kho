# Sổ nợ — lỗi cũ đã/đang treo

> Mỗi lỗi một mục: mô tả · lần ĐO gần nhất (còn/hết) · bằng chứng · nếu còn thì chỗ hỏng chính xác.
> ĐO KHÔNG SỬA: lô đo chỉ ghi kết quả, không đụng code ứng dụng.

## LỖI A — "app sale ghi đè trạng thái mọi đơn mỗi lần lưu"
**Mô tả:** trước đây app sale khi lưu MỘT đơn lại upsert CẢ danh sách đơn với `trang_thai`
suy từ `toTT` (thiếu máng) → đơn đang ở `cho_cat`/`cho_giao` bị ghi tụt về `moi_len_don`.

**Đo lần cuối (2026-08-14, `ops/test_069.mjs`): ✅ ĐÃ HẾT** — ba lớp chặn, đo được:
1. **App chỉ gửi đơn ĐỔI** — `web/src/sale.js:203-210`: `doiOrMoi = (v||[]).filter(d => snap[d.ma] !== JSON.stringify(d))`
   rồi `upsert(rows, {onConflict:'ma_don'})`. Lưu 1 đơn → chỉ 1 dòng đi lên, KHÔNG đụng đơn khác. (đọc code)
2. **Round-trip `toTT` song ánh 15 trạng thái** (db/047-era) — trang_thai không còn rơi về `moi_len_don`. (đọc code)
3. **Lưới cuối ở DB** — trigger `chan_lui_san_xuat` (db/047): sale/tk_ban_hang bị CHẶN tuyệt đối khi hạ đơn
   `cho_cat..cho_giao` về nhóm trước-SX. **Đo:** dựng 3 đơn (moi_len_don / cho_cat / cho_giao), sale lưu đơn
   moi_len_don → **2 đơn SX kia KHÔNG đổi**; sale thử hạ `cho_cat→moi_len_don` → **trigger raise** "Không được hạ
   đơn đang sản xuất". (test 069)

**Bằng chứng:** `test_069` in TRƯỚC/SAU: `T-LOIA-1=moi_len_don · T-LOIA-2=cho_cat · T-LOIA-3=cho_giao`
→ sau khi sale lưu T-LOIA-1: `T-LOIA-2=cho_cat · T-LOIA-3=cho_giao` (không đổi) + hạ SX bị chặn.

## LỖI B — "đơn kẹt ở moi_len_don, không vào được xưởng"
**Mô tả:** đơn lên xong đứng ở `moi_len_don`, không có đường sang `cho_cat` (vào xưởng).

**Đo lần cuối (2026-08-14, `ops/test_069.mjs`): ✅ ĐÃ HẾT** — có cửa hợp lệ, đo được:
- Dựng báo giá `T-LOIB` (1 món có giá) → sale **lên đơn** `bao_gia → moi_len_don` (đường app sale dùng) ✅
- ceo gọi **`dua_vao_chuyen('T-LOIB')`** → `moi_len_don → cho_cat` ✅ (đơn VÀO xưởng)

**Bằng chứng:** `test_069` in TRƯỚC/SAU: `T-LOIB=bao_gia` → lên đơn `moi_len_don` → vào xưởng `cho_cat`.

**Ghi chú đường vào chuyền (db/045):** hai cửa hợp lệ `moi_len_don/xong_file → cho_cat`:
(1) `dua_vao_chuyen` (ceo/xuong), (2) tem tự bắc cầu (món → đơn). L-10b thêm cửa thứ ba
`day_so_san_xuat` (ceo/thiet_ke). Sale KHÔNG tự đẩy sang cho_cat (đúng — vai sale chỉ tới moi_len_don);
đó không phải "kẹt", mà là chờ operator (xưởng/thiết kế) kéo vào chuyền.
