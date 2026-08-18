# Nhật ký quyết định kiến trúc — hệ kho / MES

> Mỗi quyết định một mục: ngày · nội dung · lý do · trạng thái.

## QD-01 (14/08) — Quy trình là ĐỒ THỊ CÓ NHÁNH
Quy trình là ĐỒ THỊ CÓ NHÁNH, đọc `buoc_truoc`, **CẤM suy `thu_tu - 1`**.
- **Lý do:** tủ áo có nhánh thùng và nhánh cánh chạy song song, gộp ở lắp ráp.
- **Trạng thái:** ĐÃ LÀM (v-kho-55).

## QD-02 (14/08) — Ranh giới hoạt động = bàn giao vật lý
Một hoạt động = một lần món rời tay thợ và bàn giao vật lý. Máy làm nhiều việc trong một lần gá = MỘT hoạt động. Hai tổ, hai lần bàn giao = HAI hoạt động.
- **Trạng thái:** ĐÃ LÀM (CLAUDE.md).

## QD-03 (14/08) — CẤM đẻ danh mục công đoạn thứ hai
CẤM đẻ danh mục công đoạn thứ hai. Mọi hoạt động FK về `don_gia_baseline` — bảng đang tính giá vốn theo hoạt động.
- **Trạng thái:** ĐÃ LÀM (v-kho-55).

## QD-04 (14/08) — 12 mã là HOẠT ĐỘNG THẬT, không trộn với bộ phận
12 mã hoạt động là HOẠT ĐỘNG THẬT, không trộn với bộ phận. `thung` và `canh` là việc lắp ráp ở tổ Lắp ráp, KHÔNG phải gói gộp. (Cảnh báo trước đó là sai, đã rút.)
- **Trạng thái:** ĐÃ XÁC NHẬN bằng bảng CEO lập với tổ trưởng.

## QD-05 (14/08) — Chà lót và Sơn PU là HAI hoạt động, có bước CHỜ KHÔ riêng
Chà lót và Sơn PU là HAI tổ, HAI hoạt động. Giữa chúng có CHỜ KHÔ — sẽ là bước riêng: có giờ, đơn giá công = 0, không ai quét, hệ thống tự suy.
- **Lý do:** nếu gộp, giờ khô sẽ nuốt vào đơn giá sơn và làm sai đơn giá; và mất khả năng đo khúc chờ.
- **Trạng thái:** ĐÃ LÀM (v-kho-56) — `loai_buoc='tu_chay'`, ràng buộc `gio_moi_don_vi=0`, dòng `cho_kho` trong don_gia_baseline; RPC bỏ qua không báo thiếu.

## QD-06 (14/08) — CUTLIST KHÔNG PHẢI ĐIỀU KIỆN BẮT BUỘC
Plugin chỉ dựng được 106 mẫu cố định. Món dựng tự do và hàng gỗ tự nhiên KHÔNG có cutlist, và đó là trạng thái bình thường, không phải lỗi.
Số đơn vị của mỗi hoạt động có BA nguồn, ghi rõ nguồn cho từng con số:
- `cutlist` — plugin sinh ra, tin cao
- `go_tay` — người nhập, tin trung bình
- `uoc` — áng chừng, chờ quét thật chỉnh lại

Hệ thống KHÔNG được chặn món vì thiếu cutlist. Chỉ được chặn khi KHÔNG CÓ nguồn nào cả.
- **Trạng thái:** ĐÃ LÀM (v-kho-56) — bảng `so_don_vi_mon(nguon in cutlist|go_tay|uoc)`; RPC `gio_du_kien_cua_mon` báo `THIEU_SO_DON_VI` khi thiếu CẢ BA, không phải thiếu riêng cutlist.

## QD-12 (14/08) — Thiết kế sản xuất được đẩy đơn sang cho_cat sau khi nhập đủ số
Thiết kế sản xuất được đẩy đơn sang `cho_cat` sau khi nhập đủ số đơn vị. Đúng vòng đời: thiết kế sản xuất dựng file, đẩy giá vốn + tem, đơn tự vào chờ cắt.
- **Soát trước khi mở quyền:** `dua_vao_chuyen` hiện chỉ **ceo/xuong** gọi được, và **chỉ đổi trang_thai** (moi_len_don/xong_file → cho_cat) — KHÔNG làm gì khác (không tem, không side-effect). An toàn để thiết kế cũng đẩy.
- **Cách mở (tight):** RPC `day_so_san_xuat` (ceo/thiet_ke) gác đủ 3 điều kiện (gán quy trình · đủ số · trạng thái đẩy được) rồi chuyển cho_cat qua cửa `chan.tu_mon='1'` (escape-hatch "món tự đẩy" có sẵn của trigger `chan_chuyen_theo_vai`). thiet_ke **KHÔNG** set cho_cat được bằng update thô — vai khác (sale/tho/ke_toan) vẫn bị chặn.
- **Trạng thái:** ĐÃ LÀM (db/068 · v-kho-62). ⚠ **Cơ chế `day_so_san_xuat` bị QD-14 (db/069) THAY** bằng
  `ban_giao_xuong` (gộp file + khách-duyệt + số). Nguyên tắc "thiết kế đẩy sang cho_cat sau khi đủ số" GIỮ NGUYÊN.

## QD-10 (14/08) — Giờ chuẩn hiện là số SUY, không phải số ĐO
Giờ chuẩn hiện là số **SUY**, không phải số **ĐO**. Khi có `su_kien_quet` (lô A2), giờ thật mỗi lượt chia cho số đơn vị của món ra giờ mỗi đơn vị đo được. Gom đủ số lượt thì ghi đè `gio_moi_don_vi` và **gỡ `la_tam`**. Trước khi có số đo, MỌI con số giờ phải hiển thị kèm dấu **[TẠM]** ở mọi màn.
- **Trạng thái:** nền đã có (`la_tam=true` mọi bước; giờ suy từ đơn giá ở db/064). Chờ lô A2 (su_kien_quet).

## QD-07 (14/08) — Bước CNC dùng mã `cat`; `cam` là hoạt động riêng
CEO chốt: bước CNC (cắt+khoan một lần gá) dùng mã **`cat`** (tổ cnc). **`cam`** = khoan cam/chốt RIÊNG ở tổ dan_canh, chạy SAU dán cạnh. Không dòng nào trong 13 mã là dòng chết.
- **Trạng thái:** ĐÃ LÀM (v-kho-56 · SQL mẫu + docs theo đúng điều này).

## QD-13 (14/08) — Quy trình + số đơn vị KHOÁ THEO MÓN, không theo biến thể
Món tự do (dựng riêng cho từng căn, không có trong catalog) là việc **CHÍNH** của công ty, không phải
ngoại lệ. Khoá nhập số theo biến thể nghĩa là hệ chỉ chạy được với món có sẵn trong danh mục — ngược với
mô hình kinh doanh. **Quy trình và số đơn vị khoá theo MÓN (`don_hang_mon.id`).** Món có lõi thì lõi chỉ
dùng để **GỢI Ý** quy trình, không bắt buộc.
- `so_don_vi_mon`: bỏ `ma_bien_the` → `mon_id` FK `don_hang_mon(id)`, unique `(mon_id, hoat_dong)`. Dữ liệu cũ
  chuyển sang theo `sp_id`; không có thì thôi.
- `gan_quy_trinh_mon`: ghi `don_hang_mon.ma_quy_trinh` (cột MỚI, cho NULL), KHÔNG sửa `san_pham_loi` nữa.
- `san_pham_loi.ma_quy_trinh` GIỮ NGUYÊN — dùng GỢI Ý: món có `sp_id` mở màn tự chọn sẵn quy trình của lõi,
  người vẫn đổi được.
- `nhap_so_don_don_hang`: **BỎ inner join `san_pham_mau` + bỏ `where sp_id is not null`** — gốc lỗi "0 món".
  Món tự do PHẢI hiện ra.
- ⚠ **`db/069` KHÔNG idempotent — chạy MỘT lần duy nhất.** Bước đổi khoá đọc `so_don_vi_mon.ma_bien_the`;
  chạy lần hai sẽ hỏng vì cột đã đổi thành `mon_id`. (Cảnh báo cùng nội dung ở đầu file SQL.)
- **Trạng thái:** ĐÃ LÀM (db/069).

## QD-14 (14/08) — Bàn giao xưởng gác BA chốt, gộp thành MỘT đường
Bàn giao xưởng gác **ba** điều kiện: **có file cắt · có bản thiết kế khách duyệt · đủ số đơn vị.** Bỏ chốt
khách-duyệt là để đơn chưa duyệt xuống xưởng — hỏng ván và cãi nhau với khách. Lệnh gộp nút (L-12) thiếu hai
chốt này, nay bổ sung.
- Màn Nhập số có mục **đính kèm file cắt** (dùng lại cơ chế upload của `gui_file_san_xuat`, KHÔNG viết lại).
- Nút cuối "Gửi file sản xuất cho xưởng" gọi **MỘT** RPC `ban_giao_xuong` làm cả ba: lưu file · kiểm 3 điều
  kiện · đẩy `cho_cat`. Gộp logic `gui_file_san_xuat` + `day_so_san_xuat`.
- Ba điều kiện mỗi cái một mã lỗi RIÊNG (server): `THIEU_FILE_CAT` · `CHUA_KHACH_DUYET` · `THIEU_SO_DON_VI`
  (kèm tên món). Cộng mã cũ: `CHUA_GAN_QUY_TRINH` · `DA_VAO_CHUYEN` · `DON_CHUA_CHOT` · `TRANG_THAI_KHONG_DAY`.
- **`day_so_san_xuat` GỠ BỎ** (QD-12 thay bằng `ban_giao_xuong`) — từ phía thiết kế chỉ CÒN MỘT đường sang
  `cho_cat`. `dua_vao_chuyen` (ceo/xuong) là đường operator, khác vai, giữ nguyên.
- **Trạng thái:** ĐÃ LÀM (db/069).

## QD-15 (14/08) — Số đơn vị có BA MỐC, không mốc nào ghi đè mốc nào
Số đơn vị mỗi món mỗi hoạt động có **ba mốc**:
- `du_kien` — thiết kế BÁN HÀNG ước, để báo giá khách.
- `chuan` — thiết kế SẢN XUẤT đếm chính xác, là cam kết; **chốt lúc bàn giao xuống xưởng**.
- `thuc_te` — máy quét đo (lô sau), kèm **số hỏng** và **số làm lại** ghi RIÊNG.

**Không mốc nào ghi đè mốc nào** (`so_don_vi_mon` unique `(mon_id, hoat_dong, moc)`). `nguon`
(cutlist/go_tay/uoc) nói số Ở ĐÂU RA; `moc` nói số THUỘC GIAI ĐOẠN NÀO — hai chuyện khác nhau, không gộp.
- **Chênh `du_kien→chuan`** = rủi ro báo giá (ai ước sai). **Chênh `chuan→thuc_te`** = hiệu suất xưởng, tách
  tiếp thành **lệch do hỏng/làm lại** và **lệch do đếm** (MES 6.3.5: hai nguyên nhân khác hẳn, không trộn).
- `so_hong`/`so_lam_lai` **chỉ có nghĩa với `thuc_te`** (check chặn ở mốc khác). Mốc `chuan` **chốt lúc bàn giao**
  (`chot_luc`/`chot_boi` + trigger cấm sửa) → tự nó là bản ghi lịch sử, **thay cho bảng snapshot riêng**; sửa
  quy trình về sau không đụng SỐ đã đóng băng. ⚠ **CÒN HỞ:** giờ vẫn tính từ `quy_trinh_buoc` HIỆN TẠI — sửa
  PHÚT quy trình thì GIỜ của đơn đã bàn giao vẫn đổi (số đóng băng, phút chưa). Ghi ở `docs/so_no.md`.
- **Căn cứ:** Garrison ch.9-10 (một chuẩn, hai lần đo chênh) · Meyer 4.5.2/6.3.5 (ODA ghi cả giờ lẫn số lượng
  thực tế; hàng hỏng/làm lại ghi riêng).
- **Trạng thái:** ĐÃ LÀM (db/070 · v-kho-65).

## QD-16 (14/08) — Bàn giao chốt CẢ số LẪN phút và đơn giá (đơn đã bàn giao là sự thật lịch sử)
Bàn giao xuống xưởng chốt cả **số đơn vị** LẪN **phút/đơn vị** và **đơn giá**. **Đơn đã bàn giao là sự thật
lịch sử:** sửa quy trình (phút) hay sửa đơn giá về sau **KHÔNG đổi** giờ và giá vốn của nó. Mốc `du_kien` và
`thuc_te` **luôn tính live** — chúng không phải cam kết.
- `so_don_vi_mon` +`gio_moi_don_vi_chot`/`gio_co_dinh_chot`/`don_gia_chot` (chỉ chuan đã chốt; mốc khác NULL).
  `ban_giao_xuong` chép ba số này từ `quy_trinh_buoc` + `don_gia_baseline` HIỆN TẠI. **Chép thiếu bất kỳ số nào
  → CHẶN cả bàn giao** (`CHOT_THIEU_SO`, fail-đóng, không chốt một phần). Trigger cấm sửa (db/070) đã bao 3 cột mới.
- `gio_du_kien_cua_mon/_don` mốc chuan rẽ: dòng ĐÃ chốt dùng số chốt; CHƯA chốt tính live. Trả `nguon_gio` =
  `da_chot`/`live`/`thieu_so_chot` (đơn cũ bàn giao trước lô → thiếu số chốt → tính live + cờ, KHÔNG im lặng).
  `so_sanh_moc`: tiền công chuan đã chốt dùng `don_gia_chot`.
- **Đóng lỗ hở của QD-15** (số băng nhưng giờ chưa). ⚠ **Residual nhỏ (so_no.md):** bước `tu_chay` (chờ khô)
  không có dòng số → giờ nó vẫn live; TU-AO-MELAMINE không có tu_chay nên không ảnh hưởng dòng hiện tại.
- **Trạng thái:** ĐÃ LÀM (db/071 · v-kho-66).

## QD-17 (14/08) — Tab Quy trình (app Sản phẩm): sửa routing + phút, gác kiem_quy_trinh
Tab thứ 3 "Quy trình" app Sản phẩm (vai **ceo/thiet_ke**, ke_toan CHẶN — sửa quy trình đụng giá vốn thật). Sửa
bước/routing/phút của quy trình dùng chung; nhiều món dùng chung một quy trình. db/072 (RPC read + qt_luu_buoc/
qt_xoa_buoc/qt_chep) · db/073 (`qt_loi_text` nêu tên bước).
- **NHẬP PHÚT, không nhập giờ** — `gio_moi_don_vi = phút/60`; đọc ×60. Không bao giờ hiện 0,0333 cho người.
- Mỗi lần sửa bước → **`kiem_quy_trinh`**; hỏng (chu trình/trỏ sai/không khởi đầu/không với tới) → raise `QT_LOI`
  (rollback = fail-đóng), báo câu ĐÚNG lỗi + tên bước. Sửa khi có món dùng → hộp xác nhận tách **món chưa bàn giao
  (sẽ đổi)** vs **đã bàn giao (giữ nguyên)** — dựa QD-16.
- **Bảng 12 hoạt động CHỈ ĐỌC** (đơn giá đụng giá vốn thật → lô riêng).
- ⚠ **Hai nợ nhỏ (dang_o_dau.md):** (1) phút trong bảng 12 hoạt động lấy từ bước **ĐẠI DIỆN** — hai quy trình
  khai phút khác nhau cho cùng hoạt động thì chỉ hiện một số, không nói của QT nào (chưa hại: 3 QT đang khai giống
  nhau). (2) `gio_co_dinh` không sửa được trên màn (mẫu chỉ có phút/đơn vị); bước thêm mới đặt `gio_co_dinh=0`.
- **Trạng thái:** ĐÃ LÀM (db/072 · db/073 · v-kho-67).

## QD-18 (15/08) — Sổ quét: sổ ghi thêm bất biến, chặn vẫn ghi, giờ chạm tay ≠ thời gian trôi qua
Nền DB cho màn trạm quét (chưa dựng màn). db/074. **THUẦN DB, không màn, không button-sweep.**
- **Sổ quét là SỔ GHI THÊM, không ai sửa được — kể cả ceo.** `su_kien_quet` bật `force row level security`, chỉ
  có policy INSERT + SELECT, **không** policy UPDATE/DELETE ⇒ mọi vai (kể cả owner) bị từ chối sửa/xoá. Sổ = sự
  thật lịch sử, đính chính bằng cách **ghi dòng mới**, không tẩy dòng cũ.
- **Quét bị CHẶN vẫn PHẢI ghi sổ** (`ket_qua='chan'` + lý do). Cơ chế cốt lõi: hàm plpgsql mà INSERT **rồi**
  `raise` thì raise **cuốn ngược** chính dòng vừa ghi. Nên guard chặn **RETURN `{ok:false}`** (đã ghi dòng chan),
  **KHÔNG raise**. `quet_tem`/`ghi_bu` trả `{ok:false, loi, ly_do}` khi chặn; chỉ lỗi ĐẦU VÀO của `ghi_bu`
  (sai vai / sai loai) mới raise.
- **Thứ tự bước đọc `buoc_truoc` (QD-01), CẤM suy `thu_tu-1`.** Hai nhánh song song (vd cắt‖lót) KHÔNG chặn oan
  nhau — test 2 chứng: xong cả cắt lẫn lót thì quét gói (chờ cả hai) được nhận.
- **Ghi bù sau ca** (`ghi_bu`, chỉ xuong/ceo, tho KHÔNG): `nguon='tay'`, `ghi_bu_cho`=giờ THẬT của thao tác,
  `luc`=lúc gõ bù. Ghi bù **vẫn qua đủ guard thứ tự bước** — bù không phá thứ tự.
- **Giờ chạm tay ≠ thời gian trôi qua — HAI số khác nhau, không gộp** (MES 6.1.3). Chạm tay = Σ(ra−vào) từng
  cặp; trôi qua = mốc cuối − mốc đầu. Có khoảng chờ giữa hai trạm thì trôi qua > chạm tay (test 11).
- **`do_gio_that`** nối sổ sang mốc `thuc_te`: món **chưa quét xong MỌI bước người → CHẶN** (`CHUA_QUET_XONG`),
  KHÔNG ghi dở dang (test 9). Xong đủ thì mỗi hoạt động ghi `so_don_vi_mon(moc='thuc_te', nguon='cutlist')`:
  số đơn vị = số tem khác nhau qua hoạt động, giờ chạm tay + hỏng/làm lại dồn theo. Ba mốc du_kien/chuan/thuc_te
  cùng sống một chỗ, so_sanh_moc tách chênh (test 10).
- **Trạng thái trạm ghi đầy đủ** (`trang_thai_tram`: chay/nghi/hong/cho_vat_tu/ve_sinh; non-chay bắt buộc ly_do) +
  `ca_lam` (một người một trạm tại một thời điểm) + `ly_do_dung`. Ai quét suy từ **ca trực**, không hỏi.
- **Trạng thái:** ĐÃ LÀM (db/074 · test_074 17/0 · v-kho-68).

## QD-19 (15/08) — TRA SÁCH trước khi đề xuất · đọc hết báo cáo trước khi đề xuất

LUẬT SỐ 1 — TRA SÁCH TRƯỚC KHI ĐỀ XUẤT.
Project có ba sách: MES_Meyer (điều hành sản xuất) · Garrison Managerial
Accounting (kế toán quản trị) · giáo trình quản trị sản xuất.
Trước khi đề xuất BẤT KỲ cấu trúc dữ liệu, quy trình, cách tính, hay luồng
nghiệp vụ nào — TRA SÁCH TRƯỚC. Nói rõ sách nói gì, ở chương mục nào,
rồi mới nói mình nghĩ gì. Sách không nói thì NÓI THẲNG 'sách không nói,
đây là tôi đoán'.

Chỗ tra nhanh cho việc hay gặp:
- Quy trình sản xuất gắn vào đâu, nhánh song song → MES ch.4.2.3, BẢNG 4.1
- Bảng vật tư suy từ quy trình → MES 4.2.4
- Đơn vị sản xuất, tem, truy vết → MES 4.4, 6.3
- Thu dữ liệu từ trạm, trạng thái máy → MES 6.1.3, 6.3.5
- Giờ chuẩn tự điều chỉnh → MES 5.4.2
- Định mức, chênh lệch, giá vốn → Garrison ch.9-10
- Lịch sản xuất, tải theo tổ, mốc đóng băng → quản trị sản xuất ch.6

ĐÃ VI PHẠM NHIỀU LẦN, mỗi lần đều phải sửa lại sau:
- suy giờ từ đơn giá ra 4,5 phút/mét (vô lý gấp ba)
- bắt CEO đi bấm giờ từng hoạt động ở xưởng (bất khả thi)
- định nhồi mon_id vào tem, trong khi MES nói tem có định danh độc lập
- đề xuất tách quy trình theo TẤM, trong khi BẢNG 4.1 đã cho sẵn cách:
  một work plan theo món, phần A và phần B đi nhánh riêng rồi gộp ở bước cuối

LUẬT SỐ 2 — ĐỌC HẾT BÁO CÁO TRƯỚC KHI ĐỀ XUẤT.
Nhiều lần câu trả lời nằm sẵn trong báo cáo vừa nhận mà không đọc kỹ,
rồi đi đường vòng ba lô.

## QD-20 (16/08) — NGÀY GIAO: atp() dừng ở NGÀY XONG XƯỞNG, CẤM cộng số giao hàng phỏng đoán

NGÀY GIAO: atp() dừng ở NGÀY XONG XƯỞNG. CẤM cộng số giao hàng phỏng đoán vào atp().

Hiện trạng atp(): phân giải TUẦN (giáo trình QTSX ch.6 mục 3.2 — hoạch định theo thời kỳ tuần) ·
trần tầm nhìn 12 tuần, vượt thì KHÔNG hứa (vùng 'mở') · đầu ra là ngày xong sản xuất, CHƯA cộng
vận chuyển + lắp — do đó CHƯA đúng định nghĩa ATP của MES_Meyer (ngày giao ràng buộc với khách).

Sự thật hiện tại: sale đang hứa miệng 5-6 ngày (Hà Nội, xưởng ở Thái Bình) và 10-12 ngày (tỉnh khác).
Đây là số THÓI QUEN, KHÔNG phải số đo — chưa từng đo lần nào. Khoảng này phụ thuộc ba nguồn biến động
tách rời: nhà xe thuê ngoài · xe công ty tự chở · thợ lắp thuê ngoài.

LÝ DO CẤM CỘNG: nhét số thói quen vào máy = biến phỏng đoán thành sự thật hệ thống, đúng bẫy QD-10
('coi số suy là số đo = tự lừa mình', đã dính vụ suy giờ ra 4,5 phút/mét). Gộp ba nguồn biến động thành
một hằng số cũng sai về nguyên tắc.

ĐƯỜNG RA: đo, không đoán. Ghi vào so_lech_hua (đã dựng từ v-kho-74, hiện rỗng) mỗi đơn giao xong:
ngày xong xưởng thật · ngày khách nhận thật · tỉnh/thành · ai chở (xe mình / nhà xe) · ai lắp. Đủ ~30 đơn
thì tính MAD theo giáo trình QTSX chương dự báo, tách theo tỉnh và theo kênh chở. Có MAD rồi mới cộng số
ĐO vào atp() và mới gỡ được chữ [TẠM].

TRONG LÚC CHƯA CÓ SỐ ĐO: màn hình cho sale ghi 'xong xưởng (dự kiến)', KHÔNG ghi 'ngày giao'. Sale tự
cộng như đang làm. Thà nói đúng phạm vi còn hơn hứa hộ một con số chưa ai kiểm.

- **Trạng thái:** đang chờ dữ liệu thật từ việc 6 (một đơn thật đi hết vòng).

## QD-21 (16/08) — buoc_thiet_ke thêm 'dung_xong' (dựng xong nhưng chưa gửi)

Thêm giá trị `dung_xong` vào `buoc_thiet_ke`, đặt giữa `dang_dung` và `cho_duyet`:
`cho_nhan → dang_dung → dung_xong → cho_duyet → sua_gop_y → xong_file`. NULL vẫn là "chưa vào luồng".
Thiết kế bấm nút **"Đã dựng xong"** (RPC `danh_dau_dung_xong`, chỉ set khi đang `dang_dung`) để đánh dấu đã
dựng xong 3D nhưng CHƯA gửi cho sale.

- **LÝ DO:**
  1. **Kanban báo giá (việc 4) cần tách cột "bản mới chưa gửi".** Không có giá trị này thì "đang dựng" (còn làm
     dở) và "dựng xong chờ gửi" lẫn vào nhau — không tách được cột. (Đã nêu ở L-39: cột "Bản mới chưa gửi" KHÔNG
     suy được từ dữ liệu cũ.)
  2. **GIỮ đường `dang_dung → cho_duyet` (gửi thẳng).** Thiết kế dựng xong gửi luôn một phát là đường đang chạy;
     `dung_xong` là bước TUỲ CHỌN, KHÔNG bắt buộc. `gui_ban_thiet_ke` set `cho_duyet` từ bất kỳ bước nào — không chặn.
  3. **Kanban thiết kế BẮT BUỘC thêm cột.** `tk_bang_cong_viec` trả `cot = buoc_thiet_ke` (pass-through); nếu app
     (`thietke.js` COT_ORDER) không thêm cột `dung_xong` thì đơn ở bước này **BIẾN MẤT** khỏi "Bảng công việc"
     (không khớp cột nào). Nên lô này sửa kèm COT_ORDER + nhãn "Dựng xong, chưa gửi" + nút "Đã dựng xong".
- **AN TOÀN:** nới CHECK không vỡ đơn cũ; mọi câu đọc DB dùng `=xong_file`/`<>xong_file`/`is not null` nên coi
  `dung_xong` là "đang làm, chưa xong" — đúng nghĩa. Chuông sale (`sale_ban_cho_gui`) đếm `ban_thiet_ke.trang_thai`,
  KHÔNG đếm `buoc_thiet_ke` → đơn `dung_xong` (chưa có bản) KHÔNG lọt chuông.
- **Migration idempotent** (db/088): drop-if-exists + add constraint; chạy lại lần hai không hỏng.
- **Trạng thái:** ĐÃ LÀM (db/088 + test_088 13/0 + thietke.js). CHƯA commit — chờ CEO kiểm mắt.

## QD-22 (16/08) — Form "Báo giá mới" v5: +3 cột don_hang (phong_cach · ngan_sach_trieu · tu_dung)

- **Nội dung:** db/092 thêm 3 cột vào `don_hang` cho cụm "KHÁCH MUỐN GÌ" + "AI DỰNG BẢN 3D" của form
  báo giá v5: `phong_cach text` · `ngan_sach_trieu numeric (>=0)` · `tu_dung boolean default false`.
- **DÙNG LẠI, không đẻ trùng** (đã soi 66 cột don_hang): thương hiệu→`thuong_hieu` · loại→`loai` ·
  ngày hỏi giá→`ngay_tao_bao_gia` · sđt/tên/tỉnh→`sdt_khach`/`ten_khach`/`tinh_khach` ·
  link tham khảo→`link` (đã có ="Link sản phẩm") · yêu cầu riêng→`ghi_chu` (đã có, trùng nghĩa).
- **Lý do:** form v5 cần chỗ chứa phong cách + ngân sách khách (chưa có cột nào mang nghĩa này —
  `gia_goc`/`doanh_thu` là GIÁ BÁO chứ không phải NGÂN SÁCH khách). `tu_dung` để **đo cuối tháng**:
  sale tự dựng bản 3D (không qua thiết kế) chốt được bao nhiêu %.
- **Trạng thái:** ĐÃ LÀM (db/092 idempotent, chạy 2 lần OK). CHƯA commit — chờ CEO kiểm mắt.

## QD-23 (16/08) — Màn Báo giá là NHÀ CHÍNH của sale: mọi thao tác TẠI CHỖ (L-57)

- **Triết lý CEO chốt:** *"Sổ đơn hàng = quản lý đơn ĐÃ CÓ. Màn Báo giá = mọi hoạt động của sale
  ĐỂ CÓ đơn. Sale làm việc cả ngày ở màn Báo giá; mọi thao tác giai đoạn báo giá diễn ra TẠI màn
  này, không nhảy sang Sổ đơn. Dữ liệu màn này (lý do thua, ngày treo, vòng sửa, ai dựng) là nguồn
  phân tích tăng bán hàng."*
- **Hệ quả kỹ thuật (L-57):**
  - Menu app sale: **Báo giá đứng đầu** (kèm badge) → Sổ đơn hàng → Danh mục SP → Khách hàng.
    Đăng nhập sale → **mở mặc định màn Báo giá** (`tab` khởi tạo = "bg").
  - **SoDon LUÔN mount** (giữ tầng modal cho mọi tab), chỉ hiện NỘI DUNG khi `active` (tab="don").
    Modal (BaoGiaForm / XemDon / DonModal) tách khỏi `div.body` → render **TẠI CHỖ** trên bất kỳ tab
    → thao tác báo giá KHÔNG nhảy tab. Trước đây route qua `moMa`→`setTab("don")` nên nền là Sổ đơn.
  - **Ngoại lệ DUY NHẤT rời màn:** "Chốt giá, lên đơn" (`chot:`) → sang Sổ đơn, vì từ giây đó là đơn.
  - Kanban Cột = **bàn làm việc**: mỗi cột có nút hành động đúng cột (Gửi khách xem · Khách duyệt/chê ·
    Chốt giá lên đơn) + số ngày chờ/vòng sửa. **Ba số một nguồn** (`oCond`) giữ nguyên: ô == list == cột.
- **Trạng thái:** ĐÃ LÀM (togihome_sale.html; bấm thật test_sale_kiem 4 ca sống; ảnh 50-54). CHƯA commit.

## QD-24 (16/08) — Giá vốn theo đơn: ke_toan XEM được; ghi tay vẫn chỉ ceo/kho (L-65)

- **CEO chốt:** Giá vốn theo đơn — **ceo/kho/ke_toan XEM được**; **ghi tay chỉ ceo/kho**;
  **sale/tho/thiet_ke KHÔNG thấy**. **Lý do:** kế toán quản trị cần giá vốn để làm việc (Garrison —
  kế toán quản trị dùng giá thành để định giá, phân tích lãi/lỗ); sale vẫn cách ly như QĐ cũ (chống lộ
  giá vốn ra khâu bán hàng).
- **Hệ quả kỹ thuật (L-65, db/098):**
  - `gia_von_don_ds`: guard `ceo/kho` → **`ceo/kho/ke_toan`** + **phân trang** (mặc định 50/trang, đếm
    tổng riêng; trả `{tong, ds}`) — trước quét cả nghìn đơn không limit (nợ L-29). Đơn CHƯA có giá vốn
    xếp lên đầu nên form nhập tay nằm trọn trang 1.
  - `ghi_gia_von_tay`: **GIỮ NGUYÊN chỉ ceo/kho** (kế toán XEM, GHI không). Trong app Tài chính chỉ ceo
    ghi được → form nhập tay **ẩn với ke_toan** (`#gv_nhap`).
  - `niem_yet_info` (rà L-64 phát hiện HỞ, tiện vá cùng lô): thêm guard **ceo/ke_toan** (trước sale/tho/
    NULL gọi được — chỉ lộ metadata kỳ chốt, không tiền).
- **Trạng thái:** ĐÃ LÀM (db/098 áp prod 2× idempotent; togihome_taichinh.html + taichinh.js; bấm thật
  test_tc_kiem + kiểm chéo test_sale_kiem). **CHƯA commit** (lô rà L-64 → sửa L-65, chờ CEO duyệt commit).

## QD-25 (16/08) — Thu NGUỒN KHÁCH từ ngày đầu (L-67)

- **CEO chốt:** Mọi đơn/báo giá ghi **nguồn khách** ("Khách biết mình qua đâu?") — miền
  `quang_cao · gioi_thieu · cua_hang · san_tmdt · khach_cu · khac` (db/099, không bắt buộc).
- **Lý do thu NGAY, không đợi:** đây là **lỗ thu thập DUY NHẤT** — dữ liệu nguồn khách chỉ ghi được **tại
  lúc lên báo giá**; bỏ trống thì **vĩnh viễn không truy lại được** đơn đó biết mình qua đâu. Bịt lỗ TRƯỚC
  khi đơn thật chảy → sau này mới phân tích được kênh nào ra đơn (ROI quảng cáo vs giới thiệu…). Không thu
  = mất luôn, khác các số khác (tính lại từ đơn cũ được).
- **Không bắt buộc + nhắc mềm:** ô để trống vẫn lưu được; chỉ hiện ở dòng "Còn thiếu" (nhắc, không chặn) —
  ép cứng sẽ làm sale bịa cho xong, hỏng dữ liệu.
- **Trạng thái:** ĐÃ LÀM (db/099: cột + CHECK; 2 form sale + `donToRow`; bấm thật KIEM-L67 lưu đúng cột rồi
  xoá sạch). **CHƯA commit.** Xem [[man-bao-gia-form-db092]].

## QD-26 (17/08) — Mỗi đơn MỘT chủ (sale phụ trách) · ai đổi được (L-71)

- **CEO chốt:** Mỗi đơn thuộc **một sale phụ trách** (cột `sale_phu_trach` → nguoi_dung). Không có cột này thì
  mọi số "theo sale" (dải ⑥, màn trưởng nhóm, thưởng phạt) tính mò, và chuông "bản chờ gửi" réo chung cả phòng.
- **Tự gán:** lúc TẠO đơn, chủ = **người đang đăng nhập** (trigger `trg_gan_sale_phu_trach` BEFORE INSERT — đường
  ít xâm lấn, app không đổi, phủ mọi đường tạo). Seed/demo không JWT → NULL (không réo chuông).
- **Đổi chủ:** chỉ **truong_nhom_sale/ceo** (`doi_sale_phu_trach`, ghi nhật ký). **Sale thường KHÔNG tự đổi**
  (kể cả đơn mình) — chống tự nhận đơn ngon/đá đơn khó. Lý do: chủ đơn gắn thưởng phạt → phải có người trên duyệt.
- **Đơn cũ:** backfill từ nhật ký (nguoi_id dòng đầu = người tạo). Không truy được → NULL (toàn demo/seed, 0 đơn thật).
- **Siết theo chủ (gỡ nợ L-45):** chuông + màn Báo giá — sale thường chỉ ĐƠN MÌNH; trưởng nhóm/ceo cả nhóm
  (cùng câu điều kiện, thêm một vế lọc `sale_phu_trach = current_ns()`).
- **Trạng thái:** ĐÃ LÀM (db/101; siết sale_ban_cho_gui + sale_bao_gia_ds; app lọc "Ai phụ trách" + chi tiết chủ
  + nút đổi; bấm thật KIEM-L71). **CHƯA commit.** Xem [[sanpham-ba-truc-nhap-web-db060]].

## QD-27 (18/08) — P/L NỘI BỘ định dạng số dư đảm phí, phân khúc theo `dong` (L-43)

- **CEO chốt:** Báo cáo Lãi/Lỗ nội bộ theo **contribution format** (Garrison ch.6): Doanh thu thuần − Biến phí
  = Số dư đảm phí − Định phí truy được = **Segment margin** − Định phí chung (không rải) = Lãi thuần hoạt động.
- **Phân khúc = `don_hang.dong`** (`le`/`combo`/`du_an`; `dong` NULL/khác → cột "Khác" nếu phát sinh) — đây là
  discriminator DUY NHẤT có dữ liệu thật (`nguon_khach` 100% NULL, `so_mon` NULL — xem L-41).
- **Doanh thu** = `gia_chot` đơn **`da_giao`**, kỳ theo **`ngay_giao`** (không phải ma_ky_ap_dung).
- **Căn cứ:** Garrison ch.6 (segment margin; **CẤM rải common cost** vào phân khúc — bóp méo quyết định) + DACTA
  khối ④ (chi phí không phân bổ = định phí chung).
- **Trạng thái:** ĐÃ LÀM (db/108 `pl_ky`; tab P/L app tài chính; test_108 bất biến hàng-cột + tốc độ 100k <500ms).
  **CHƯA commit.** Xem [[man-bao-gia-form-db092]].

## QD-28 (18/08) — Bảng `chi_phi_ky` = sổ ACTUALS, tách khỏi tham số dự toán (L-43)

- **CEO chốt:** Chi phí kỳ (lương VP/sale, ads, thuê, khấu hao, điện nước, khác — 7 loại) ghi vào **bảng mới
  `chi_phi_ky`** (`ma_ky, loai, so_tien, phan_khuc NULL=chung, ghi_chu, nguoi_nhap, cap_nhat_luc`) — **sổ số
  ĐÃ CHI THẬT**.
- **TÁCH khỏi `tham_so_tai_chinh`** (là **dự toán**: hệ số/đầu người, ghi rõ "[TẠM]"). **Actuals và dự toán KHÔNG
  trộn** — trộn thì không biết số nào thật, số nào ước.
- `phan_khuc` NULL = **CHUNG** (định phí chung, chỉ trừ ở cột Toàn cty của P/L); `le`/`combo`/`du_an` = **truy được**
  (vào segment margin).
- **Trạng thái:** ĐÃ LÀM (db/108 bảng + `cpk_ds`/`cpk_ghi`/`cpk_chep_ky_truoc`; tab Chi phí kỳ). **CHƯA commit.**

## QD-29 (18/08) — Nhãn biến phí / định phí (L-43)

- **CEO chốt:** **Biến phí** = giá vốn khối 1 (vật tư) + khối 2 (hoạt động) + khối 3 (cấp đơn) + ship&lắp thực trả
  + hoa hồng %. **Định phí** = toàn bộ `chi_phi_ky`.
- **Lý do:** contribution format cần tách biến/định để ra số dư đảm phí; giá vốn 3 khối + ship&lắp + hoa hồng biến
  theo từng đơn, còn chi phí kỳ cố định trong kỳ.
- **Trạng thái:** ĐÃ LÀM (nhúng trong công thức `pl_ky`). **CHƯA commit.**

## QD-30 (18/08) — Quy ước VAT trong P/L (L-42/L-43)

- **CEO chốt (xác nhận 18/08):** `gia_chot` là giá **ĐÃ GỒM VAT**. P/L **bóc VAT**: doanh thu thuần =
  `gia_chot ÷ (1 + vat/100)`, `vat` đọc `tham_so_tai_chinh` **ĐÚNG kỳ**. **VAT không hiện** trong P/L (thu hộ nhà nước).
- **Giá ván nhập plugin CHƯA VAT** (CEO xác nhận 18/08 — kiểm L-42 truy `gia_tam` trong `luat_cau_tao.json`, không
  nhãn thuế; CEO xác nhận nguồn số chưa VAT) → **khối 1 dùng THẲNG, KHÔNG bóc ÷1,1**.
- **Chi phí kỳ:** nhập **CHƯA VAT** với khoản có hoá đơn khấu trừ; **số THỰC CHI** với lương/khấu hao/khoản không hoá đơn.
- **Trạng thái:** ĐÃ LÀM (nhúng `pl_ky` + chú thích 2 màn). **CHƯA commit.**

## QD-31 (18/08) — Hoa hồng trong P/L = phương án B (cơ sở doanh thu THUẦN) (L-43)

- **CEO chốt phương án B:** Hoa hồng P/L = `(hh_sale + hh_quan_ly + hh_thiet_ke) × DOANH THU THUẦN`, tỷ lệ đọc
  `tham_so_tai_chinh` theo kỳ. (Lưu ý: cột `hh_*` là **PHÂN SỐ** — hiện 0.03/0.01/0.01 = 5% — khớp `gia_bac_tu_gv`.)
- **CEO sẽ TỰ nhập** tỷ lệ tương đương **3,3/1,1/1,1** cho kỳ tới qua tab tham số (lệnh L-43 **KHÔNG** tự ghi tham số
  kỳ mới); **kỳ cũ giữ nguyên**.
- **Lý do B:** cơ sở doanh thu thuần → **miễn nhiễm đổi thuế suất** + **không trả % trên tiền thu hộ** (VAT).
- **NGỎ phương án C** (hệ số hoa hồng theo mức giảm giá so giá sàn) — **xét lại sau khi P/L chạy 2–3 kỳ** có số thật.
- **Tác động đường giá bán nếu CEO nâng 5%→5,5%** (rà read-only Việc 1c, đường giá bán KHÔNG sửa lô này):
  giá sàn `(tăng_1+phí)/(1−hh)` **+0,529%** (chính xác, độc lập dữ liệu); hệ số m `(dt·(1−hh)−ship−phí)/gcg` giảm
  **~0,64%** (vd gcg_TB 7,6tr → 1,245 → 1,238). Hoa hồng đường giá bán tính trên **giá sàn CHƯA VAT** (`bao_khach =
  gia_san×(1+vat)` cộng VAT sau) — đã đúng, không chỗ nào nhân trên giá CÓ VAT.
- **Trạng thái:** QUY ƯỚC CHỐT; đường giá bán CHƯA đụng (chờ CEO quyết nâng tham số ở lệnh sau). **CHƯA commit.**

## QD-32 (18/08) — RANH GIỚI khối ② (đơn giá xưởng) ↔ chi phí kỳ (L-43 Việc 0)

- **Bối cảnh:** đơn giá hoạt động (khối ②) = `(lương_tổ + overhead_phan_bo + bảo hiểm) × %thời-gian ÷ mẫu số`
  (`ket_qua_don_gia`, db/038/040/048). Ngoài lương+BH, **chỉ `overhead_phan_bo` là phần "gánh thêm"** — và nó là
  **một cục NHẬP TAY/tổ, KHÔNG itemize ở đâu** trong code/data/doc. (`db/064:12` ghi "overhead = chi phí kỳ, không
  nhét/đơn vị" — nhưng đó là công thức `gio_chuan` dùng lương THUẦN; công thức đơn giá đ/sản-phẩm VẪN cộng overhead.)
- **BẢNG RANH GIỚI** (quy tắc "thà thiếu còn hơn trùng" — không kết luận được thì xếp vào CẤM):

  | ĐÃ/CÓ THỂ ở khối ② → **CẤM nhập chi_phi_ky** | CHƯA ở đâu → **PHẢI nhập chi_phi_ky** |
  |---|---|
  | Khấu hao máy CNC — TREO (có thể trong overhead tổ cnc) | Lương văn phòng (không phải tổ SX) |
  | Điện chạy máy — TREO (gắn tổ SX) | Lương sale |
  | Điện chiếu sáng xưởng — TREO | Marketing / Ads |
  | Khấu hao xe tải — TREO (không có tổ giao hàng, nhưng overhead là cục mù) | Thuê mặt bằng VP/showroom |
  | Lương quản đốc — TREO (giám sát mọi tổ) | Điện nước VP · chi phí NGOÀI sản xuất khác |

- **KHÔNG KẾT LUẬN ĐƯỢC 5 mục bên trái** vì `overhead_phan_bo` là cục mù → **TREO chờ CEO hỏi kế toán làm rõ
  overhead_phan_bo gồm gì**; tạm xếp CẤM để tránh tính trùng. Bảng này thành **dòng chú thích ranh giới trên màn
  Chi phí kỳ**.
- **Trạng thái:** RÀ XONG (read-only); nợ TREO chờ kế toán. **CHƯA commit.**

## QD-33 (18/08) — ÉP nguồn khách tại cổng CHỐT đơn (nhắc mềm ở báo giá) (L-45)

- **CEO chốt:** `nguon_khach` (6 giá trị, db/099) — **nhắc mềm** khi lên báo giá (để trống vẫn lưu), **ÉP CỨNG**
  khi chốt đơn (`bao_gia → moi_len_don`): thiếu → CHẶN với "Chưa chọn nguồn khách — chọn rồi mới chốt đơn."
- **Lý do:** CAC/phân khúc kênh cần dữ liệu **tại nguồn** — thời điểm chốt là cửa cuối còn hỏi được khách biết qua
  đâu; qua cửa đó thì vĩnh viễn mất. Ép ở báo giá thì sale bịa cho xong (hỏng dữ liệu); ép ở chốt thì đã có đơn thật.
- **KHÔNG hồi tố:** gác chỉ bắn khi UPDATE bao_gia→moi_len_don; đơn INSERT thẳng moi_len_don hay đã qua từ trước
  KHÔNG dính. Bypass test/backfill: GUC `chan.off_nguon`.
- **Trạng thái:** ĐÃ LÀM (db/109 gác trong `kiem_chuyen_trang_thai`; UI sale: label * + tooltip 2 form + chặn client
  ở "Chuyển thành đơn"; test_109 #1/#2). **CHƯA commit.**
- **MỞ RỘNG (L-46b, db/111):** vá lỗ "+ Lên đơn" — db/109 chỉ gác UPDATE bao_gia→moi_len_don, bỏ sót INSERT thẳng
  moi_len_don. db/111 gác **MỌI đường VÀO moi_len_don** (INSERT hoặc từ trạng thái khác), **CHỈ người dùng thật**
  (`current_vai_tro() <> ''` — seed/service raw không vai bỏ qua, GUC `chan.off_nguon` vẫn bypass), không hồi tố; trigger
  tái tạo gồm INSERT. UI: chặn client trong `luu` ("+ Lên đơn"). test_111 (8/0). Regression gác nguồn (từ db/109, pre-087
  chưa ai chạy) đã vá: test_056/069 thêm bypass off_nguon.

## QD-34 (18/08) — Khách MỚI xác định lúc da_giao theo ngay_mua_dau (L-45)

- **CEO chốt:** Tại thời điểm đơn `da_giao`, tra `khach` theo `sdt`: **chưa có `ngay_mua_dau`** → đơn `khach_moi=true`
  + set `khach.ngay_mua_dau = ngay_giao`. Đơn sau cùng sdt → `khach_moi=false`. **KHÔNG ghi đè** `ngay_mua_dau` đã có
  (backfill 8/9 dòng giữ nguyên).
- **Dedupe:** trigger `tg_dong_bo_khach` (BEFORE INSERT/UPDATE don_hang) upsert `kho.khach` theo `sdt_khach` (tạo nếu
  chưa có, nối `ten` nếu trống). `khach.sdt` đã là UNIQUE PK.
- **Trạng thái:** ĐÃ LÀM (db/109; UI: badge "Khách MỚI/CŨ" ở chi tiết đơn khi da_giao; test_109 #3/#4). **CHƯA commit.**

## QD-35 (18/08) — Cột chuẩn sđt + kg; ĐÍNH CHÍNH `kgs` KHÔNG phải cột trùng (L-45)

- **Chốt cột chuẩn:** số điện thoại = **`sdt_khach`** (điền 14/15); khối lượng = **`khoi_luong_kg`** (app đã map đúng
  từ trước — sale.js). Không đổi gì thêm cho 2 cột này.
- 🔴 **ĐÍNH CHÍNH báo cáo L-44:** `kgs` **KHÔNG phải** cột kg trùng — nó là **ARRAY "danh mục không gian"** (phòng
  khách/ngủ… mã 029), dùng **14× trong app Sale** (`f.kgs.includes`, `db.kgs`). **Drop = vỡ app.** → **GIỮ `kgs`.**
- **`khach_sdt`** (0 điền) tuy trùng ý nghĩa `sdt_khach` nhưng có **FK `fk_dh_khach → khach(sdt)`** (db/024) + đọc bởi
  **db/104 công nợ** + sale.js fallback. **HOÃN drop** — cần lô riêng (sửa db/104 + sale.js + gỡ FK) rồi mới drop an toàn.
- **Trạng thái:** cột chuẩn CHỐT; **drop `kgs` HUỶ (sai tiền đề); drop `khach_sdt` HOÃN chờ lô riêng.** **CHƯA commit.**
