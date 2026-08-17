# 02 — ĐÃ LÀM & ĐANG DỞ

---

## A. ĐÃ LÀM — theo tag (v-kho-1 → v-kho-94)

**Nền kho (1–15):** 1 chuyển 12 bảng sang schema kho · 2 web 6 màn + đăng nhập · 4 lô mở đầu ván theo kiểm kê · 5 vá focus + cổng bí mật + deploy Cloudflare · 6 tồn tươi từ máy chủ · 7 thợ đăng nhập mã cá nhân + siết policy vai · 8 bỏ đường vào của thợ · 9–10 ảnh vật tư về bucket, hết phụ thuộc Drive · 11 bố cục điện thoại · 12 hướng dẫn có ảnh tự sinh · 13 xuất kho FIFO + huỷ bằng phiếu ngược · 14–15 bảng quy đổi mã thiết kế↔kho + hàm cho plugin đọc.

**Đơn hàng & giá (16–28):** 16 Sổ đơn hàng (don_hang tách giá vốn khỏi sale + món + nhật ký) · 17 bảy vai trò · 18 sáu bảng danh mục lên đơn · 19 app lên đơn nối Supabase · 20 vá huỷ phiếu + whitelist giá vốn · 21 sale hết thấy giá vốn · 22 đường giá bán (giá sàn theo tầng) · 23 cấu hình + VAT rời KEYLESS sang DB · 24 trần giảm giá phân tầng · 25 fail-đóng thiếu he_so_m + vai trưởng nhóm sale · 26 tách app sale project riêng · 27 vá bẫy NULL guard vai · 28 app tài chính (project #3).

**Báo giá & thiết kế bán hàng (29–33):** 29 đường ghi giá vốn từ plugin · 30 trạng thái báo giá · 31 lưu báo giá chỉ cần tên món · 32 báo giá thua/treo + vai tk_ban_hang + đo giờ · 33 phiếu xuất bắt buộc tổ + driver từ kho.

**App xưởng & thời gian (34–45):** 34 app xưởng (tem/tiến độ/đếm/lỗi) · 35 sổ tham số xưởng (lương tổ → 13 đơn giá) · 36 giao diện tài chính · 37 ghi vết thời gian + lead time · 38 quản đốc + nền xếp việc · 39 app xưởng bản đầy đủ 5 màn · 40 hai cửa vào chuyền + tách lệnh SX/phiếu giao · 41 lệnh SX + lô + lắp đặt · 42 sale "bao giờ giao" · 43 vá sale ghi đè trạng thái · 44 nhập giá vốn tay · 45 dữ liệu demo + RPC kéo đơn.

**Bản thiết kế & sản phẩm 3 tầng (46–54):** 46 quản lý bản thiết kế (phiên bản + duyệt + khoá cắt + link khách) · 47 vá login/đăng xuất/tài khoản · 48 sắp thẻ trạng thái + vá đăng nhập 4 app · 49 nền app thiết kế (chia việc + kanban + 2 vai) · 50 gio_uoc full_can 5→15 · 51 nền BA TẦNG sản phẩm · 52 quản lý thương hiệu · 53 app thiết kế (project #6) · 54 nhập 100 SP web + biến thể ba trục.

**Quy trình sản xuất & giờ (55–67):** 55 xương quy trình (routing đồ thị nhánh + trạm QR) · 56 quy trình DÙNG CHUNG + giờ 2 phần + bước tự chạy + 3 nguồn số · 57 đơn full-căn demo chạy thử · 58 giờ chuẩn suy từ đơn giá · 59–61 CEO chỉnh tay giờ dan/cam/cat/goi · 62 màn Nhập số sản xuất · 64 khoá số theo MÓN + bàn giao gộp 3 chốt · 65 ba mốc số (du_kien/chuan/thuc_te) · 66 đóng băng phút + đơn giá lúc bàn giao · 67 tab Quy trình (app Sản phẩm).

**Trạm quét & lập lịch (68–80):** 68 sổ quét (nền DB mốc thuc_te) · 69 nhãn tấm người-đọc · 70 tấm tự biết nhánh · 71 màn TRẠM QUÉT · 72 năng lực tổ theo thời gian + bảng tải tuần · 73 xếp lịch ngược/xuôi/nút thắt + ATP · 74 atp() theo mốc + so_lech_hua · 75 partition su_kien_quet · 76 tien_do_tem lưu sẵn (vá timeout) · 77 materialize giờ đơn + phân trang · 78 phân trang 3 màn xưởng · 79 màn "Tải & lịch" · **80 thiết kế bán hàng nhập SỐ ƯỚC (mốc du_kien) — atp() sống lại.**

**Màn BÁO GIÁ của sale (81–85):** 81 chuông "bản chờ gửi" + nối datalist ds-sp · 82 cờ dung_xong + vá kanban rớt hàng · **84 CỤM MÀN BÁO GIÁ (L-48→L-55):** RPC nền `sale_bao_gia_ds` (db/091) + vỏ v5 + scope CSS `.bg-man` + toggle Danh-sách/Cột · vá huỷ đơn (db/090) · **form Báo giá RIÊNG `BaoGiaForm`** tách HAI luồng (báo-giá vs lên-đơn thẳng), cắt "Lưu báo giá" khỏi form Lên đơn · "Chuyển thành đơn" đổ sẵn dữ liệu báo giá · đơn báo giá ẩn "Lệnh sản xuất" + món "chưa chốt" · 3 cột nhu cầu (db/092) · bộ bấm-thật `ui_test_sale.py` + luật cấm shim + tài khoản kiểm `test_sale_kiem`. · **85 (L-57→L-60):** màn Báo giá là **NHÀ CHÍNH của sale** (menu đứng đầu + mở mặc định + mọi thao tác báo giá TẠI CHỖ, không nhảy tab; kanban Cột = bàn làm việc, nút theo cột) · "xong xưởng (dự kiến)" gọi atp() client-side (không gộp RPC vì atp tạo temp-table/lần) · nối "Khách muốn gì" sang app Thiết kế (db/095 + thietke.js) · **Tiến độ xưởng** trong Sổ đơn (db/094, đọc tien_do_tem, sale chỉ xem) · **DÒNG ĐỜI ĐƠN** trong XemDon (db/096, gộp nhật-ký + bản + phản-hồi + link) · ép lưới `.bg-man` (mọi khối chung mép). QD-22 (3 cột nhu cầu) · QD-23 (triết lý nhà-chính). Tài khoản kiểm app Thiết kế `test_tk_kiem`.

**Chuông thiết kế · rà Kho/Tài chính (86–87):** **86 (L-62):** CHUÔNG HAI CHIỀU app Thiết kế (db/097 `tk_chuong` — 3 mục *việc chờ nhận · khách phản hồi bản mình dựng · đơn chốt-thua*, badge==list, `luc_tk_xem` mốc đã-xem dùng chung; UI `tkc-` badge + panel mở tại chỗ). · **87 (L-64 rà + L-65 sửa):** **RÀ app Kho + Tài chính** (2 app chưa soi) — app Kho sạch; app Tài chính 3 lỗi + vá db/098: `gia_von_don_ds` cho **ke_toan XEM** + **phân trang** {tong,ds} 50/trang (bỏ khỏi nợ L-29) · `niem_yet_info` thêm gác vai (trước HỞ) · bảng bọc `overflow-x` (390px hết tràn) · `ghi_gia_von_tay` GIỮ ceo/kho (ke_toan XEM, GHI không). QD-24. Tài khoản kiểm `test_kho_kiem`/`test_tc_kiem`.

**Nguồn khách + dải số (88):** **88 (L-67):** cột `don_hang.nguon_khach` (miền 6 giá trị, không bắt buộc) — **lỗ thu thập DUY NHẤT**, bịt trước khi đơn thật chảy (QD-25) · ô "Khách biết mình qua đâu?" ở CẢ 2 form sale (báo giá + lên đơn), nhắc mềm · **dải 6 số mặt-đồng-hồ** dưới khối thua/treo (`sale_dai_so_bao_gia`): thua-vì-giá · hỏi→thấy-giá · chốt 7/14/25 ngày · vòng-sửa có/không nhu cầu · chốt tự-dựng vs giao-TK · theo sale. Mỗi số dán **[TẠM·n]** khi n<30 (mẫu nhỏ không kết luận), KHÔNG giá vốn. **Chưa** phải màn Phân tích đầy đủ (việc 8) — đợi đơn thật.

**Điều hành + chủ đơn (90):** **90 (L-69+L-71):** ① **tab Điều hành** app Tài chính (ceo/ke_toan, tab đầu, chỉ đọc) — 5 khối gom số sẵn (Đang tắc · Phễu · Dải 6 số · Xưởng · Tiền), RPC `dieu_hanh_bang` (SX-tắc/giao-nợ/tồn) + nới guard sale_bao_gia_ds/sale_dai_so_bao_gia +ke_toan; ô bấm mở list (ô==list); sale chặn. ② **chủ đơn** `don_hang.sale_phu_trach` (mỗi đơn một sale, vá nợ L-45): tự gán = người tạo (trigger), backfill nhật ký, đổi chủ `doi_sale_phu_trach` (trưởng nhóm/ceo); siết chuông + màn Báo giá theo chủ (sale chỉ đơn mình); app lọc "Ai phụ trách" + chi tiết chủ. QD-26.

**Sáu ghế nhìn số + dọn web (91–93):** **91 (L-72):** màn **"Nhóm của tôi"** app Sale (trưởng nhóm sale) — tắc nhóm + phễu theo người + số theo người 30 ngày (`nhom_so_nguoi`); đổi chủ tại chỗ. **92 (L-73):** khối **"Nhóm"** app Thiết kế (trưởng nhóm TK) — việc/giờ-ước-thực/chất-lượng-bản (`tk_nhom`); db/103 mở whitelist gán vai truong_nhom_thiet_ke. **93 (L-74+L-77):** ① app Xưởng **"Nhìn lại"** (quản đốc: giờ chuẩn-vs-thực theo tổ · lỗi&làm-lại · tắc quét — `xuong_nhin_lai`, không tiền) · ② app Sản phẩm **"Số bán theo dòng"** (`sp_so_ban`) · ③ Tài chính **công nợ gom theo khách** (`dieu_hanh_cong_no_khach`) · ④ **dọn 100 SP web test** (xoá 100 lõi/272 biến thể/272 niêm yết, backup ~/Downloads; số rác "Bán/tuần 2116" = cột web-scrape, không phải lỗi tính) · ⑤ **tầng dòng** `dong_san_pham` (10 dòng) + `san_pham_loi.dong_id` (db/105). Tài khoản kiểm: test_tns_kiem · test_tntk_kiem · test_xuong_kiem.

**SP chuẩn từ đầu (94):** **94 (L-77):** BỎ 100 SP web test (xoá 100 lõi/272 biến thể/272 niêm yết, backup; số rác "Bán/tuần 2116" = cột web-scrape) · **tầng dòng** dong_san_pham 11 dòng (TA/GN/BLV/HB/BT/HK/KE/TG/BA/TD/TB) + san_pham_loi.dong_id · **form "+ Thêm SP" 3 bước** (lõi→biến thể→niêm yết): mã tự sinh <dong>-NNN từ chuoi_so, tên 3 kênh (website 60-90 / sàn TMĐT 100-120 / nội bộ=mã) ghép theo luật skill + self-check 7 nguyên tắc + cảnh báo trùng · Cây nhóm theo dòng gập/mở · **demo 12 lõi/24 biến thể** seed QUA RPC từ file luật cấu tạo (tủ 2/3/4 cánh · giường UD9A · BLV005/7/8 · NORDLI · OY4V · OV2V), giá [TẠM]. db/105·106. Nợ mở: 200 ảnh bucket mồ côi chờ CEO xoá (cần service_role).

*(Không có tag v-kho-3, 63, **83** (cụm màn Báo giá treo từ L-48 nên nhảy 82→84), **89** (nhảy 88→90 lô L-72); các số L-xx trong commit là số LỆNH, khác số tag.)*

---

## B. ĐANG DỞ (rà L-26 → L-40)

- **L-40 / v-kho-80 (vừa commit):** DB + test 18/18 + deploy XONG. **UI hộp "Số ước" CHỜ CEO kiểm mắt** — ảnh 1440px chưa chụp (mở modal cần đăng nhập app thiết kế; theo kỷ luật mật khẩu phải xin CEO login, không tự đăng nhập). Xem `~/Downloads/lo_so_uoc.md`.
- **L-33 → L-39: đọc-hiểu (read-only), KHÔNG code.** Kết quả in ra terminal + vài `.md` ở `~/Downloads/` (doc_luong_bao_gia, doc_man_so_don_hang…). Không có gì để commit; là nền để làm màn Báo giá.
- **Màn BÁO GIÁ app Sale: CHƯA code.** Đã có mẫu HTML (xem mục C). Đây là việc lớn kế tiếp.
- **`test_079 #1` đỏ sẵn** — do hardcode ngày `'2026-10-10'` trong khi đồng hồ trôi sang 2026-08-16 (tính ra 2026-10-11). Logic đúng (`xep_bang=nguoc`). Ngoài phạm vi L-40, CHƯA sửa (chờ CEO quyết có nới số hardcoded).
- **File lạ `web/ops/test_040.mjs`** chưa track, chạy còn **2 đỏ** (drift từ db/040 cũ). KHÔNG commit (không đưa test đỏ vào cây). Cần rà riêng hoặc xoá.

---

## C. FILE MẪU HTML — trạng thái duyệt

| File | Màn | Ở đâu | Test | CEO duyệt | Code vào app |
|---|---|---|---|---|---|
| `man_tai_lich_quy_mo_v4.html` | Tải & lịch (xưởng) | `~/Downloads/x/` (+ bản gốc) | có (`test_man_tai_lich.md`) | ✅ (L-31) | ✅ **đã code** (v-kho-79) |
| `man_bao_gia_v3.html` | Báo giá (sale) | `~/Downloads/` | ✅ L-36, 18 mục pass (`test_bao_gia_v3.md`) | — | ❌ chưa |
| `man_bao_gia_v4.html` · `man_bao_gia_v5.html` | Báo giá (sale) — bản mới hơn | `~/Downloads/` | **KHÔNG KẾT LUẬN ĐƯỢC** — tôi chỉ test v3; v4/v5 tạo sau (16/08), tôi chưa test/chưa rõ CEO duyệt chưa | ❌ chưa |

> **v5 là bản báo giá MỚI NHẤT trên đĩa** nhưng tôi không có bằng chứng nó đã test hay đã duyệt — chat mới phải hỏi CEO "dùng bản báo giá nào (v3 đã test, hay v5 mới)?" trước khi code.

---

## D. VIỆC CÒN LẠI (thứ tự CEO đã chốt)

1. **Thiết kế nhập số ước khi gửi bản (L-40)** — mắt xích để `atp()` sống lại. → *DB xong, UI chờ kiểm mắt.*
2. **Tín hiệu cho sale** — ô đếm "bản mới chờ gửi khách" (hiện sale KHÔNG có thông báo/badge nào; phải tự mở từng đơn).
3. **Cờ "dựng xong chưa gửi"** — `buoc_thiet_ke` thiếu giá trị này; kanban báo giá không tách được cột "Bản mới chưa gửi" (xem file `03` mục D).
4. **Nối datalist `ds-sp` vào ô tên món** — datalist đã có nhưng MỒ CÔI (không ô nào trỏ tới); sale đang gõ tay hoàn toàn, không gợi ý từ danh mục.
5. **Kanban báo giá (app Sale)** — bảng PHẢN CHIẾU (đọc), KHÔNG kéo thả (bước chuyển tự động theo sự kiện, như kanban thiết kế).
6. **Code màn Báo giá vào app Sale** (từ mẫu đã duyệt).
7. **Một đơn thật đi hết vòng** — CEO tự làm, chặn mọi thứ (nghiệm thu end-to-end).
8. **Màn Phân tích & Cải tiến** (MES 6.4 + DMAIC).
9. **Sáu RPC list không giới hạn** (nợ L-29; `gia_von_don_ds` đã vá L-65) — xem mục E.
10. **Quy trình sơn PU** (hàng sơn, thêm lot/pu/son_canh/cho_kho vào routing).
11. **Xếp cả kho đơn cùng lúc** (MES 5.4.6) — hiện xếp từng đơn.

---

## E. NỢ KỸ THUẬT (đọc `docs/so_no.md`)

- **LỖI A & B** (app sale ghi đè trạng thái · đơn kẹt moi_len_don): **ĐÃ HẾT**, đo được (test_069). Giữ trong sổ để không nghi lại.
- **CÒN HỞ → ĐÃ VÁ:** số đóng băng nhưng giờ chưa (QD-15) → db/071 chốt cả phút+đơn giá (QD-16). **Residual nhỏ:** bước `tu_chay` (chờ khô) giờ vẫn LIVE — quy trình đang bán không dùng nên chưa hại.
- **NỢ VẬN HÀNH:** mỗi năm phải chạy `tao_phan_manh_thang` thêm 12 tháng năm kế tiếp cho `su_kien_quet` (hiện tạo tới 2027-12). Quên → dòng rơi vào phân mảnh DEFAULT, chậm dần ngầm.
- **NỢ HIỆU NĂNG (L-29 việc 4): CÒN 6 RPC** trả danh sách KHÔNG limit (`xuong_don_cho_vao_chuyen`, `can_ceo_quyet`, `sp_danh_sach`, `tk_bang_cong_viec`, `tk_viec_cua_toi`, `tk_don_cho_nhan`). **Nặng nhất `gia_von_don_ds` ĐÃ VÁ L-65 (db/098)** — phân trang 50/trang, 50ms/3.011 đơn. Cộng N+1 ở `xuong.js:taiViec` (đã chặn 50/lần nhưng gốc còn). 6 RPC còn lại CHƯA sửa, chờ CEO quyết lô.
- **Demo lệch seed CỐ Ý** (CAN-A-DEMO, DEMO-13): KHÔNG phải lỗi. Nhưng mọi lệch `so_don_vi_mon` với seed db/063 thì LÀ lỗi — phải dừng soi.
