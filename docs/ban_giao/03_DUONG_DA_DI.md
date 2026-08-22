# 03 — ĐƯỜNG ĐÃ ĐI (để không lặp lại sai lầm)

> File quan trọng nhất. Đọc trước khi định "làm lại cho gọn" bất cứ thứ gì — phần lớn đã có lý do.

---

## A. LÝ DO TỪNG QD (đọc `docs/quyet_dinh.md` để đủ)

- **QD-01 — Quy trình là ĐỒ THỊ CÓ NHÁNH, đọc `buoc_truoc`, cấm suy `thu_tu-1`.** Vì tủ áo có nhánh thùng và nhánh cánh chạy song song, gộp ở lắp ráp. Suy `thu_tu-1` → chặn oan hai nhánh song song.
- **QD-02 — Một hoạt động = một lần bàn giao vật lý.** Máy làm 3 việc một lần gá = MỘT hoạt động. Ngược lại thì đếm sai số công đoạn → sai giá vốn.
- **QD-03 — CẤM đẻ danh mục công đoạn thứ hai.** Mọi hoạt động FK về `don_gia_baseline` (bảng đang tính giá vốn). Hai danh mục = hai bản sự thật, sẽ lệch.
- **QD-04 — 12 mã là HOẠT ĐỘNG THẬT, không trộn bộ phận.** `thung`/`canh` là việc lắp ráp, không phải gói gộp. (Cảnh báo cũ sai, đã rút.)
- **QD-05 — Chà lót ⟂ Sơn PU là HAI hoạt động, có CHỜ KHÔ riêng.** Gộp thì giờ khô nuốt vào đơn giá sơn → sai đơn giá + mất khả năng đo khúc chờ. Chờ khô = bước `tu_chay` (giờ có, công 0, không ai quét).
- **QD-06 — CUTLIST KHÔNG bắt buộc.** Món dựng tự do/gỗ tự nhiên không có cutlist — bình thường. Số có BA nguồn (`cutlist`/`go_tay`/`uoc`); chỉ chặn khi thiếu CẢ BA. Chặn vì thiếu cutlist = khoá hệ khỏi món tự do (việc chính).
- **QD-07 — CNC dùng mã `cat`; `cam` (khoan cam/chốt) là hoạt động RIÊNG ở tổ dán cạnh, chạy sau dán.** Không dòng nào trong 13 mã là dòng chết.
- **QD-10 — Giờ chuẩn hiện là số SUY, không phải ĐO.** Suy từ đơn giá (db/064), gắn `[TẠM]` mọi màn. Khi có quét thật (su_kien_quet) mới ghi đè và gỡ [TẠM]. Coi số suy là số đo = tự lừa mình.
- **QD-12 — Thiết kế SX đẩy đơn sang `cho_cat` sau khi đủ số.** *(Cơ chế `day_so_san_xuat` sau bị QD-14 thay bằng `ban_giao_xuong`; nguyên tắc giữ.)*
- **QD-13 — Quy trình + số đơn vị KHOÁ THEO MÓN (`don_hang_mon.id`), không theo biến thể.** Món tự do là việc CHÍNH; khóa theo biến thể = hệ chỉ chạy với hàng có sẵn danh mục (ngược mô hình). Lõi chỉ GỢI Ý quy trình.
- **QD-14 — Bàn giao xưởng gác BA chốt, gộp MỘT đường (`ban_giao_xuong`):** có file cắt · có bản khách duyệt · đủ số. Bỏ chốt khách-duyệt = đơn chưa duyệt xuống xưởng, hỏng ván + cãi khách.
- **QD-15 — Số đơn vị có BA MỐC (du_kien/chuan/thuc_te), không mốc nào ghi đè mốc nào.** `nguon` nói số Ở ĐÂU RA, `moc` nói số THUỘC GIAI ĐOẠN NÀO — hai chuyện khác nhau. Chênh du_kien→chuan = rủi ro báo giá; chênh chuan→thuc_te = hiệu suất xưởng. Gộp mốc = mất khả năng tách hai loại chênh này.
- **QD-16 — Bàn giao chốt CẢ số LẪN phút và đơn giá.** Đơn đã bàn giao là sự thật lịch sử: sửa quy trình/đơn giá về sau KHÔNG đổi giờ+giá vốn của nó. Không chốt phút = giá vốn đơn cũ trôi theo mỗi lần sửa quy trình.
- **QD-17 — Tab Quy trình (app Sản phẩm) nhập PHÚT không nhập giờ; mỗi sửa gọi `kiem_quy_trinh` (fail-đóng).** Nhập giờ thì hiện 0,0333 cho người — vô nghĩa. Không kiểm = routing hỏng (chu trình/trỏ sai) lọt xuống sản xuất.
- **QD-18 — Sổ quét là SỔ GHI THÊM bất biến; quét bị chặn VẪN ghi sổ; giờ chạm tay ≠ thời gian trôi qua.** Sổ có force RLS, chỉ INSERT+SELECT (kể cả ceo không sửa được) — sự thật lịch sử đính chính bằng dòng mới. Quét chặn mà không ghi = mất dấu vết. Chạm tay và trôi qua là hai số (MES 6.1.3), gộp = sai năng suất.
- **QD-19 — TRA SÁCH + ĐỌC HẾT BÁO CÁO trước khi đề xuất** (= LUẬT 1 & 2, xem file `00`).
- **QD-48 — Đơn mua = đầu đơn + dòng, MỘT cột trạng thái 6 giá trị, cổng ở DB (WP-20).** Sagegg&Alfnes §4.2/4.3.1/4.3.3/4.4: D365 tách 3 ô (đặt/nhận/khớp HĐ) gây khó theo dõi → gộp một cột `moi→da_gui→xac_nhan→da_nhan→da_khop_hd (+huy trước nhận)`. Chỉ đi tới, không lùi, qua RPC `dm_chuyen_trang_thai` — cổng ở DB (tinh thần QD-47), không ai lách. `da_nhan/da_khop_hd` tạm ceo, WP-21/22 nối (GUC `kho.dm_he_thong`). Số đơn `DM-YYYY-NNNN` qua `cap_so_phieu` (reset năm).
- **QD-49 — Nhận hàng đơn mua = phiếu nhập tự sinh qua `ghi_so_phieu`, gắn `don_mua_id` (WP-21, db/127).** Sagegg&Alfnes §4.4 + §3.3.5: `dm_nhan_hang` gọi ĐÚNG MỘT đường ghi (QD-03/44) → 1 phiếu nhập + sổ giao dịch + lô (giá vốn = đơn giá dòng, TẠM tới WP-22/13). Nhận một phần giữ `xac_nhan`; đủ mọi dòng mới `da_nhan` (tự chuyển, GUC). Vượt đặt → `DM_VUOT_SO_DAT` (không ghi nửa vời); sai trạng thái → `DM_SAI_TRANG_THAI`. Huỷ phiếu nhận = nút Huỷ hiện có (QD-43) → sổ đảo + trừ lại `so_luong_da_nhan`; đơn `da_nhan` → khoá huỷ (`DM_DA_NHAN_KHONG_HUY`, QD-48; đảo phải trả NCC — việc sau). `ghi_so_phieu` mở rộng TẠI CHỖ (giữ 6 tham số, không overload — tránh test_037 áp lại db/037 đụng "not unique"): dòng đọc `ghi_chu`/`don_mua_dong_id`, trả thêm `phieu_id`; kho vẫn mặc định, `dm_nhan_hang` guard đơn kho khác. Điện thoại & máy tính cùng RPC. `web/ops/test_127.mjs` 35/0.

---

## B. HƯỚNG ĐÃ THỬ VÀ BỎ (bỏ vì gì)

- **Khớp 100 SP nhập từ web vào quy trình sản xuất** → bỏ. 100 SP web là để BÁN (niêm yết), không phải đơn vị sản xuất. Quy trình khóa theo MÓN (QD-13), không theo biến thể; ép khớp là ngược mô hình.
- **Đo giờ từng hoạt động bằng bấm giờ tay ở xưởng** → bỏ. Bất khả thi (CEO không thể đứng bấm giờ). Thay bằng giờ suy (QD-10), chờ quét thật đo.
- **Suy giờ chuẩn = đơn giá ÷ chi phí giờ tổ** → bỏ. Ra 4,5 phút/mét (vô lý gấp ba). Số giờ nay suy từ đơn giá qua db/064 (đúng đắn hơn, vẫn `[TẠM]`).
- **Gán quy trình theo LÕI thay vì theo MÓN** → bỏ (QD-13). Khóa theo lõi = hệ chỉ chạy với món có trong catalog. Lõi giờ chỉ dùng GỢI Ý.
- **Bảng snapshot riêng để đóng băng giá vốn** → bỏ (QD-15/16). Mốc `chuan` chốt lúc bàn giao (`chot_luc` + trigger cấm sửa) TỰ nó là bản ghi lịch sử — không cần bảng snapshot thứ hai.
- **Tách "Nhập số sản xuất" và "Gửi file" thành hai đường đẩy riêng** → bỏ (QD-14). Mỗi đường thiếu chốt → gộp thành MỘT cửa `ban_giao_xuong` gác đủ ba chốt.
- **Tách báo giá thành bảng/màn riêng** → bỏ. Báo giá chỉ là TRẠNG THÁI của đơn (`bao_gia`/`thua`/`treo`), dùng chung `don_hang` — tách sẽ nhân đôi dữ liệu đơn/khách/món. *(Hiện báo giá nằm trong Sổ đơn như ô đếm + lọc.)*
- **Dời từng bước thay vì xếp lại cả đơn** → bỏ. MES 5.4.4 nói NGƯỢC: có thay đổi thì xếp LẠI cả đơn. Màn Tải & lịch (v-kho-79) bám bản 4 / MES 5.4.4.
- **Kanban báo giá KÉO THẢ** → bỏ. Thực tế bước chuyển TỰ ĐỘNG theo sự kiện (nút hành động), "không ai kéo thả" — như kanban thiết kế đang chạy. Kanban báo giá sẽ là bảng PHẢN CHIẾU (đọc).

---

## C. CHỖ ĐÃ TỪNG SAI — và cách PHÁT HIỆN

- **Bẫy NULL trong guard vai (dính 4 lần).** `current_vai_tro()` trả NULL (chưa đăng nhập) → `NULL not in (...)` là NULL, không TRUE → guard hớ. Luôn `coalesce(...,'')`. **Phát hiện:** test vai NULL phải CHẶN.
- **Test xanh GIẢ vì chỉ chạy trên một đơn seed / vài chục dòng.** Logic đúng nhưng tốc độ/biên chưa đo. **Phát hiện:** đo ở 100.000 dòng; test cắn hai vế.
- **Class CSS 2 ký tự đụng class toàn cục** (`.mo` đụng nền modal). Không test nào bắt. **Phát hiện:** chỉ MẮT bắt → tiền tố theo màn.
- **File tĩnh fetch runtime bị CACHE → sửa UI KHÔNG tới prod** (WP-04). App Sale `napApp()` `fetch('/togihome_sale.html')` lúc chạy; Cloudflare Pages serve bản cũ (clean-URL redirect + edge cache), deploy không đẩy được nội dung mới → nút "Đã giao xong" đã code nhưng app chạy vẫn bản cũ. **Phát hiện:** curl prod so với dist local (size/chuỗi lệch). **Chữa:** UI đi qua BUNDLE CÓ HASH — `import togihome_sale.html?raw` inline vào bundle (như tab Hướng dẫn Tài chính), mọi sửa qua hash mới → chắc tới prod.
- **Sửa dữ liệu để ép ảnh đẹp (2 lần: L-10b, L-11).** **Phát hiện:** CEO soi con số. → dựng-rollback hoặc báo rõ.
- **Migration không idempotent** (db/069 đổi khóa `ma_bien_the→mon_id`; chạy lần 2 hỏng). **Phát hiện:** cảnh báo ở đầu file + chạy đúng một lần.
- **`create or replace` khi ĐỔI tham số KHÔNG thay bản cũ** → tạo overload mới, bản cũ vẫn còn, gọi nhầm. Phải `drop function` cũ trước (đã làm ở `atp`: drop `atp(text)` trước khi tạo `atp(text,text)`).
- **Băng đếm một kiểu, danh sách lọc một kiểu** (màn sale bản cũ: ô đếm 16, bấm ra 268). **Phát hiện:** bấm từng ô, đếm số dòng, so bằng nhau (L-36 kiểm 7 ô).
- **RPC timeout ở 10.000 tem mà mọi test xanh** (`tram_dang_cho`/`do_gio_that`). **Phát hiện:** đo ở quy mô thật, không vài chục dòng.
- **Đo trên dữ liệu CHƯA `ANALYZE`** → số nhiễu 5-10 lần (planner chọn sai kế hoạch). **Phát hiện:** luôn `ANALYZE` trước khi đo hiệu năng.

---

## D. CHỖ CÒN TỐI — chưa ai đọc kỹ, dễ phá nhầm

- **Luồng báo giá làm qua db/035 + db/036 mà KHÔNG có QD nào.** Ba trạng thái báo giá + tk_ban_hang + gio_theo_ket_qua ra đời không có mục quyết định. Chỉ QD-15 chạm `du_kien` gián tiếp. Ai sửa luồng báo giá phải đọc thẳng hai migration này (đã tóm ở `~/Downloads/bao_gia_tom_tat.txt` — L-34/L-38).
- **22 hàm chạm trạng thái báo giá, KHÔNG hàm nào có comment trong DB** (`obj_description` rỗng toàn bộ). Phần giải thích chỉ nằm ở khối `--` trên `create function` trong file migration. Sửa mù dễ đá nhau.
- **App Kho và app Tài chính chưa rà lại lần nào trong đợt này.** L-38/L-39 chỉ soi sale + thiết kế. Kho/Tài chính có thể còn lỗ tương tự (guard NULL, list không limit, badge/đếm lệch) — chưa ai kiểm.
- **`nhan_thiet_ke` là trạng thái MỒ CÔI** — trong miền 15 nhưng không app nào set. Đừng tưởng là bước sống rồi cắm logic vào.
- **`atp()` mới mở cho `tk_ban_hang` (v-kho-80)** bằng cách CHÉP verbatim thân hàm từ db/080 chỉ đổi 1 dòng vai. Nếu sau này sửa atp ở db/080, phải sửa CẢ bản trong db/086 (hai chỗ) — hoặc gộp lại. Đây là nợ nhỏ do "đổi vai phải redefine cả hàm".
