# 01 — BẢN ĐỒ TOÀN HỆ

> Repo `togihome-kho` (hệ kho/MES) · Supabase schema `kho` · migrate: `cd web && node ops/run_sql.mjs ../db/NNN.sql`.
> Plugin SketchUp là repo RIÊNG (`togihome-plugin`, luật hình học tủ áo). Bảy app là bảy project Cloudflare Pages tách.

---

## A. BẢY APP

| App | Vai vào được | Các tab / màn | Làm được gì | Ghi bảng | Đọc bảng |
|---|---|---|---|---|---|
| **Sale** (`togihome-sale`) | sale (+ceo) | Sổ đơn hàng · Danh mục sản phẩm · Khách hàng. *(Báo giá = ô đếm + lọc trong Sổ đơn, CHƯA có màn riêng)* | Lên đơn/báo giá · sửa đơn · ghi khách duyệt/chê bản · gửi link khách · **KHÔNG thấy giá vốn** | don_hang · don_hang_mon · don_hang_nhat_ky · (ghi khách duyệt: ban_thiet_ke qua RPC) | san_pham_mau · khach · ban_thiet_ke · lead_time |
| **Thiết kế** (`togihome-thietke`) | thiet_ke · tk_ban_hang · ceo · truong_nhom_thiet_ke | Việc của tôi · Bảng công việc (kanban 5 cột) · Giờ & chi phí · **Nhập số sản xuất** (chỉ thiet_ke+ceo) | Nhận/giao việc · gửi bản 3D cho sale (tk_ban_hang) · nhập số ước · nhập số chuẩn + đẩy file/tem xưởng (thiet_ke) | ban_thiet_ke · anh_ban_thiet_ke · so_don_vi_mon · tem_ban_ve · file_san_xuat · gio_thiet_ke_thuc · don_hang(buoc_thiet_ke) | don_hang · don_hang_mon · quy_trinh_buoc · nang_luc_to |
| **Xưởng** (`togihome-xuong`) | xuong · tho · ceo · kho | 5 màn (Trạm quét · Tiến độ · Đếm/Quản đốc · Ghi lỗi · **Tải & lịch**) | Quét QR từng bước · đếm sản lượng · ghi lỗi/làm lại · quản đốc xếp việc · xem tải theo tổ + ATP | su_kien_quet · phieu_dem_ngay · loi_lam_lai · don_hang_mon(trang_thai) · tem_da_in · ca_lam · trang_thai_tram | tien_do_tem · gio_don_da_tinh · nang_luc_to · xep_lich |
| **Sản phẩm** (`togihome-sanpham`) | ceo · ke_toan | Cây · Danh sách (3 tầng: lõi→biến thể→niêm yết) · **Quy trình** | Khai/sửa sản phẩm 3 tầng · thương hiệu · sửa routing + phút quy trình (gác kiem) | san_pham_loi · san_pham_mau · niem_yet · gia_niem_yet · thuong_hieu · quy_trinh · quy_trinh_buoc | don_gia_baseline · bo_san_pham |
| **Kho** (`togihome-kho`) | ceo · kho | Nhập · Xuất · Tồn · Thẻ kho · Quy đổi | Ghi phiếu nhập/xuất (FIFO theo lô) · huỷ bằng phiếu ngược · duyệt bảng quy đổi mã | phieu · phieu_dong · lo_nhap · ton · giao_dich · vat_tu · quy_doi | nha_cung_cap · vat_tu |
| **Tài chính** (`togihome-taichinh`) | ceo · ke_toan | Tham số (2 tab) · **Giá vốn theo đơn** | Nhập lương tổ → 12 đơn giá hoạt động · nhập giá vốn TAY cho đơn không plugin | tham_so_tai_chinh · luong_to · don_gia_baseline · don_hang_gia_von | san_pham_mau_gia_von · gia_von_don_ds |
| **Plugin SketchUp** (repo riêng) | (chạy trên máy thiết kế) | — (trong SketchUp) | Dựng hình tủ · xuất cutlist/DXF · sinh tem · đẩy **giá vốn** + **tem** lên Supabase | don_hang_gia_von (ghi_gia_von_don) · tem_ban_ve | quy_doi (mã kho đã duyệt) |

---

## B. VÒNG ĐỜI ĐƠN — 15 trạng thái

`don_hang.trang_thai` (15 giá trị). Ba nhóm:

**① Báo giá** (trước sản xuất): `bao_gia` · `bao_gia_thua` · `bao_gia_treo`
**② Trước-SX / thiết kế:** `moi_len_don` · `nhan_thiet_ke`* · `dang_thiet_ke` · `xong_file`
**③ Sản xuất → giao:** `cho_cat` · `da_cat` · `dang_lam` · `xong_sx` · `cho_giao` · `da_giao`
**④ Dừng:** `tam_ngung` · `huy`

*(`nhan_thiet_ke` là **mồ côi** — không app nào set, giữ trong miền để không vỡ dữ liệu cũ.)*

**Ai chuyển · cổng chặn (trigger, đều ở DB):**
- `chan_chuyen_theo_vai` (db/038) — ma trận VAI theo trạng thái đích. Báo giá + moi_len_don: ceo/kho/sale/tk_ban_hang · thiết kế: ceo/kho/thiet_ke · SX: ceo/kho/xuong/tho · giao: ceo/kho/xuong/ke_toan.
- `kiem_chuyen_trang_thai` (db/035, sửa db/048) — rời `bao_gia`: cấm nhảy thẳng vào SX (phải qua moi_len_don) · mọi món phải có giá · đơn thiết kế (du_an) cần giá vốn.
- `moc_bao_gia` (db/036) — vào `bao_gia_thua` bắt buộc lý do thua; đóng/mở dấu ngày báo giá.
- `chan_lui_san_xuat` (db/047) — cấm hạ đơn đang SX về nhóm trước-SX (sale/tk_ban_hang chặn tuyệt đối; ceo/xuong phải có lý do).
- `dong_bo_trang_thai_don` (db/038, db/045) — đơn = bước CHẬM NHẤT của các món; mọi món xong_sx → đơn cho_giao.
- **Cửa vào chuyền** (moi_len_don/xong_file → cho_cat): `dua_vao_chuyen` (ceo/xuong) · tem tự bắc cầu · `ban_giao_xuong` (thiet_ke, gác 3 chốt: file + khách duyệt + đủ số).

**`buoc_thiet_ke` — 5 bước, TÁCH khỏi trang_thai đơn:**
`cho_nhan` → `dang_dung` → `cho_duyet` → `sua_gop_y` → `xong_file`. (NULL = chưa vào luồng.) Đổi bởi RPC: `nhan_viec_thiet_ke`→dang_dung · `gui_ban_thiet_ke`→cho_duyet · `phan_hoi_ban`(chê)→sua_gop_y · `ban_giao_xuong`/đẩy tem→xong_file. Một đơn có thể ở trang_thai=`bao_gia` trong khi buoc_thiet_ke chạy dang_dung→cho_duyet…

---

## C. LUỒNG MỘT ĐƠN — khách hỏi → giao xong

| Bước | Ai | App · Màn | RPC / hành động | Ghi bảng |
|---|---|---|---|---|
| 1. Khách hỏi giá | sale | Sale · Lên đơn | lưu (upsert, không RPC) → trang_thai `bao_gia` | don_hang · don_hang_mon · don_hang_nhat_ky |
| 2. Đơn vào chờ nhận TK bán hàng | (tự động) | Thiết kế · Việc chờ nhận | `tk_don_cho_nhan` lọc bao_gia → tk_ban_hang | — |
| 3. Nhận + dựng 3D | tk_ban_hang | Thiết kế · Việc của tôi | `nhan_viec_thiet_ke` (buoc=dang_dung) | don_hang(ma_ns_thiet_ke, buoc) |
| 3b. Ước số ngày giao *(mới, L-40)* | tk_ban_hang | Thiết kế · hộp Gửi bản | `tkbh_so_uoc` (mốc du_kien) | so_don_vi_mon(du_kien/uoc) |
| 4. Gửi bản cho sale | tk_ban_hang | Thiết kế · Gửi bản 3D | `gui_ban_thiet_ke` (buoc=cho_duyet) | ban_thiet_ke · anh_ban_thiet_ke |
| 5. Gửi link + khách xem | sale | Sale · chi tiết đơn | `link_gui_khach` → khách mở `xem-ban.html` (KHÔNG ghi lượt xem) | link_ban_khach |
| 6. Khách duyệt / chê | sale (thay khách) | Sale · chi tiết đơn | `phan_hoi_ban` (khach_duyet / khach_doi_y / chua_dung_yeu_cau) | ban_thiet_ke |
| 7. Chốt → lên đơn | sale | Sale · Chuyển thành đơn | upsert bao_gia→`moi_len_don` (qua kiem_chuyen_trang_thai) | don_hang |
| 8. Giá vốn | thiet_ke/plugin **hoặc** ceo/kho | plugin · **hoặc** Tài chính | `ghi_gia_von_don` **hoặc** `ghi_gia_von_tay` | don_hang_gia_von |
| 9. Dựng file SX + số chuẩn + vào chuyền | thiet_ke | Thiết kế · Nhập số sản xuất | `luu_so_don_vi`(chuan) + `ban_giao_xuong` → `cho_cat` | so_don_vi_mon(chuan) · file_san_xuat · tem_ban_ve |
| 10. Cắt → làm → xong | tho/xuong | Xưởng · Trạm quét | `quet_tem` mỗi bước (đơn theo bước chậm nhất) | su_kien_quet · don_hang_mon(trang_thai) |
| 11. Xong SX → chờ giao → giao | xuong/ke_toan | Xưởng | mọi món xong_sx → `cho_giao` → `da_giao` | don_hang |

---

## D. BẢN ĐỒ BẢNG (88 bảng — nhóm theo miền; NGUỒN = người/hệ nhập gốc, SUY = tính ra)

**Đơn hàng & khách:** `don_hang`(NGUỒN, sale) · `don_hang_mon`(NGUỒN, sale) · `don_hang_gia_von`(NGUỒN, plugin/tài chính) · `don_hang_nhat_ky`·`don_hang_mon_nhat_ky`(SUY, trigger, bất biến) · `khach`(NGUỒN, sale) · `gio_don_da_tinh`(SUY, materialize giờ đơn).

**Bản thiết kế:** `ban_thiet_ke`·`anh_ban_thiet_ke`(NGUỒN, thiết kế) · `link_ban_khach`(SUY, RPC) · `tem_ban_ve`·`tem_da_in`·`lan_in_tem`·`tien_do_tem`(NGUỒN/SUY, tem) · `file_san_xuat`(NGUỒN, thiết kế) · `dung_lai_ban`.

**Sản phẩm 3 tầng:** `san_pham_loi`(lõi) · `san_pham_mau`(biến thể) · `niem_yet`·`gia_niem_yet`(niêm yết) · `san_pham_mau_gia_von` · `bo_san_pham`·`bo_san_pham_mon` · `thuong_hieu` · `noi_tran_sp`·`noi_tran_ky`(NGUỒN, app sản phẩm).

**Quy trình & số:** `quy_trinh`·`quy_trinh_buoc`(NGUỒN, app sản phẩm — routing đồ thị nhánh) · `don_gia_baseline`(NGUỒN, 13 hoạt động = vừa giá vốn vừa quy trình) · `so_don_vi_mon`(NGUỒN, thiết kế/quét — BA MỐC du_kien/chuan/thuc_te) · `phan_bo_hoat_dong`(overhead).

**Xưởng & quét:** `su_kien_quet`(+ partition tháng, NGUỒN bất biến, sổ quét) · `tram`·`to_san_xuat`·`nang_luc_to`·`ca_lam`·`trang_thai_tram`·`ly_do_dung` · `phieu_dem_ngay`·`san_luong_don` · `loi_lam_lai` · `xep_lich`·`moc_lich`(SUY, lịch) · `nhan_vai_tro_tam`.

**Kho vật tư:** `vat_tu`·`ton`·`lo_nhap`·`phieu`·`phieu_dong`·`giao_dich`·`nha_cung_cap`·`quy_doi`(NGUỒN, app kho) · `vat_lieu_ban`·`mau_sac`·`khong_gian`·`don_vi_van_chuyen`(danh mục).

**Người & tài chính:** `nguoi_dung`·`nhom`·`tho`·`vai_phu`·`quyen_duyet_giam` · `luong_to`·`tham_so_tai_chinh`·`trang_thai_tham_so` · `cai_dat`·`chuoi_so`·`nhat_ky_danh_muc`·`nhat_ky_giao_viec` · `gio_thiet_ke_thuc`.

---

## E. VỊ TRÍ TRONG ISA-95 (đọc `docs/ban_do_isa95.md`)

Hệ Togihome **trải cả cấp 4 lẫn cấp 3**. KHÔNG có ERP tách rời — **không ai cấp đơn xuống, hệ TỰ SINH đơn**.
- **Cấp 4 (ERP):** có CRM (app sale) · FIM (app tài chính). Thiếu HRM/SRM/SCM (chưa cần).
- **Cấp 3 (R&D):** plugin SketchUp = CAD+CAM · tab Quy trình = CAP.
- **Cấp 3 (MES thực thi):** có tài nguyên (trạm/ca) · quy trình · theo vết (sổ quét) · thu dữ liệu (quét QR). **THIẾU: lập lịch sản xuất · quản lý chất lượng.**
- **Cấp 2/1/0 (SCADA/PLC/cảm biến):** KHÔNG CẦN — CNC không nối mạng, xưởng thủ công.

**LỖ LỚN NHẤT = Lập lịch sản xuất** (giữa Quy trình và Theo vết). Bốn bài toán đang treo đều thuộc ô này: **ngày giao · tải theo tổ · nhu cầu vật tư · bước tiếp theo**. (Phần ngày giao đang được nối lại — xem file `02`.)
