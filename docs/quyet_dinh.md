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

## QD-36 (18/08) — Thước LẤP ĐẦY năng lực bằng TIỀN (Garrison App.3A) (L-46)

- **Căn cứ sách — Garrison Phụ lục 3A:** mẫu số overhead nên là **practical capacity**; chênh lệch (năng lực thừa)
  HIỆN thành dòng riêng **"Cost of Unused Capacity"** — là **chi phí kỳ, KHÔNG chôn vào giá vốn**, KHÔNG rải vào sản
  phẩm (RCA/Clopay: năng lực thừa phải hiện ra để thấy, không giấu vào đơn giá).
- **CEO chốt:** thước **TIỀN** cho P/L (lô này) chạy **SONG SONG** thước **GIỜ** (`nang_luc_to`, xếp lịch) — hai thước,
  không thay nhau.
  - Tham số kỳ mới `tham_so_tai_chinh.chi_phi_nang_luc` (đồng/kỳ). Mặc định **suy = Σ(luong_to + overhead_phan_bo +
    bao_hiem)** cùng kỳ; **CEO sửa tay được**; lệch >10% số suy → **cảnh báo mềm** (không chặn).
  - **Lấp đầy %** = Σ khoi_2 (đơn da_giao trong kỳ theo ngay_giao) ÷ chi_phi_nang_luc.
  - **Năng lực bỏ trống (đ)** = chi_phi_nang_luc − Σ khoi_2 (âm = **"vượt năng lực"** — làm nhiều hơn chuẩn, cũng là tín hiệu).
  - **Dòng này là THÔNG TIN** (dưới P/L + ô tab Điều hành) — **KHÔNG cộng/trừ vào lãi thuần** (lương tổ đã nằm trong
    giá vốn khối ②, trừ nữa là trùng).
- **RPC `lap_day_ky` KHÔNG fail-đóng** (khác `pl_ky`): số suy luôn tính được từ luong_to; kỳ chưa chốt tham số → trả
  số suy + cờ `chua_chot_tham_so`, dùng số suy làm mẫu số.
- **Trạng thái:** ĐÃ LÀM (db/110 cột + `lap_day_ky` jit=off; UI 3 màn P/L/Điều hành/Sổ tham số; test_110 13/0 gồm tốc
  độ 100k <500ms). **CHƯA commit.**

## QD-37 (18/08) — Màn "Lãi theo đơn" (CM/đơn) (L-47b)

- **Định nghĩa CM/đơn:** `dt_thuan − (khoi_1+khoi_2+khoi_3) − (ship_thuc_tra+lap_thuc_tra) − hoa_hong`;
  `dt_thuan = gia_chot ÷ (1+vat/100)`; `hoa_hong = (hh_sale+hh_quan_ly+hh_thiet_ke) × dt_thuan`; tham số vat/hh theo
  KỲ của `ngay_giao`; đơn = `da_giao`, kỳ theo `ngay_giao`. (Contribution margin — Garrison.)
- **BẤT BIẾN — hai màn một nguồn số:** Σ CM (mọi đơn da_giao trong kỳ, kể cả chưa trọn phần có) = dòng **SỐ DƯ ĐẢM
  PHÍ** của `pl_ky` cùng kỳ (test_113 đo **sai số 0**). Hàm chung `cm_don_raw` là nguồn per-đơn; `pl_ky` giữ bản gộp
  nhanh (công thức đồng nhất, khoá bằng bất biến).
- **Đơn CHƯA TRỌN** (thiếu giá vốn HOẶC thiếu ship/lắp): `cm_pct = NULL` → **LOẠI khỏi xếp hạng CM%** (đẩy xuống cuối)
  + **loại khỏi CM% trung bình**; chỉ đếm vào ô "chưa trọn". `cm` phần có VẪN cộng tổng kỳ + kèm nhãn `thieu[]`.
  **Lý do:** đơn thiếu giá vốn cho CM% cao GIẢ leo đầu bảng (CEO bắt trên mẫu 18/08) — chống số đẹp giả.
- **KHÔNG trừ CAC** (chi phí thu hút khách) — CAC báo cáo ở kênh riêng, nối QD-31 (hoa hồng phương án B).
- **Vai:** ceo/ke_toan; **sale CHẶN** (màn lộ giá vốn theo đơn).
- **RPC `cm_don_ky` trả sẵn `cm_tren_k2`** (= cm ÷ khoi_2) cho bài toán **chọn đơn khi xưởng kín** (Garrison ch.12,
  nguồn lực hạn chế — CM trên đơn vị nguồn lực ràng buộc = giờ khối ②); cột UI **bật sau**.
- **Perf 100k:** cm_don_ky ~527ms (quá ngưỡng 500 ~30ms) — **CEO chấp nhận** (100k đơn/kỳ là stress phi thực tế; kỳ
  THẬT vài trăm đơn <50ms). Nguyên nhân: PostgreSQL TẮT parallelism trong hàm plpgsql (SELECT/EXECUTE INTO) +
  instance `max_parallel_workers_per_gather=1`. Đã tối ưu tối đa (totals deferred + top-N hẹp + fetch-50 indexed).
  → **Con số này giờ là LUẬT TỐC ĐỘ 2 HẠNG (QD-40): mọi RPC màn phân tích < 900ms warm @stress 100k.** Không đẻ số lẻ nữa.
- **Trạng thái:** ĐÃ LÀM (db/113 `cm_don_raw`+`cm_don_ky`; tab "Lãi theo đơn"; test_113). **CHƯA commit.**

## QD-38 (18/08) — Một thương hiệu một dòng danh mục; brand thừa TẮT không xoá (L-48a)

- **CEO chốt:** danh mục `thuong_hieu` — **mỗi thương hiệu MỘT dòng**. Gộp **7 biến thể Togihome**
  (togihome-kr/bcc/gaming/hd/office/bh/vp) về `togihome` gốc: mọi bản ghi trỏ → `togihome` (thực tế 0 bản ghi),
  rồi **`ngung=true`** cho 7 dòng. **KHÔNG XOÁ** dòng — giữ lịch sử, tránh mồ côi FK (đơn/niêm-yết cũ vẫn tra được tên).
- **Showroom** (`loai='kenh_ban'`): **GIỮ dòng làm KÊNH**, không phải thương hiệu.
- **View chung `thuong_hieu_ban`** (đang bật + `loai≠kenh_ban` + có `ma_3chu`) = nguồn DUY NHẤT cho dropdown thương
  hiệu **cả app Sale lẫn Sản phẩm** → hai app CÙNG danh sách (9 brand: Togihome + Haigo/Khanh Concept/Mulig/Open
  Living/Sophia Concept/Thago/Togismart/Vufurni). Gộp điều kiện lọc về một chỗ, hết lệch giữa hai app.
- **Lý do:** CAC/báo cáo theo brand cần danh mục SẠCH — 8 biến thể Togihome làm loãng số theo thương hiệu.
- **KHÔNG đổi SKU:** mã 3 chữ biến thể (TKR/TBC…) không nằm trong SKU niêm yết nào (kiểm PHA 2) → định danh đã phát
  hành không gãy; kể cả có, CẤM đổi (gãy truy vết).
- **Trạng thái:** ĐÃ LÀM (db/114 view + ngung 7 biến thể; sale.js + sanpham.js đọc view chung; test_114 11/0). **CHƯA commit.**

## QD-39 (18/08) — Màn "Kênh & CAC theo thương hiệu" + bảng chi_ads (L-48)

- **chi_ads theo brand × kênh** (mỗi thương hiệu một team ads): bảng `chi_ads(ma_ky, thuong_hieu, kenh, so_tien_nhap,…)`.
  Kênh = 6 giá trị `nguon_khach`. Chi tiết FB/Google ghi vào `ghi_chu` (kênh con để **NGỎ cho v2**).
- **KHÁCH MỚI THEO BRAND (cho CAC):** SĐT lần đầu có đơn `da_giao` của **brand đó** (cặp sdt × thuong_hieu, min ngay_giao
  rơi vào kỳ). Khách cũ brand A mua brand B lần đầu = khách **MỚI của B**. **Cờ `khach_moi` toàn công ty (QD-34) GIỮ
  NGUYÊN cho P/L** — hai thước, hai câu hỏi (CAC dùng khách-mới-theo-brand; P/L dùng cờ toàn cty).
- **VAT ADS (CEO xác nhận 18/08 — KHÔNG có thuế nhà thầu):** kế toán nhập số **GỒM VAT** đúng hoá đơn vào `so_tien_nhap`
  (giữ vết); **chi ads THẬT = so_tien_nhap ÷ (1+vat/100)** SUY trong RPC (vat theo kỳ, không hardcode, không cột thứ hai).
  VAT ads **khấu trừ được → KHÔNG phải chi phí** (nối QD-30). **→ XOÁ câu "hỏi kế toán về thuế nhà thầu ads" khỏi danh
  sách treo** (CEO đã trả lời: không có).
- **CAC** = chi ads thật(brand,kênh) ÷ khách mới(brand,kênh); **`vo_han`** khi ads>0 & 0 khách mới; **`mau_mong`** khi
  khách mới <3 (UI in **mờ + \***, không kết luận trên mẫu mỏng).
- **CM sau ads = cm_kenh − ads đúng cặp brand×kênh, KHÔNG rải** sang kênh khách tự đến. `cm_kenh` = Σ cm từ `cm_don_raw`
  (MỘT nguồn số với màn Lãi theo đơn, CHỈ đơn trọn) — **bất biến Σ cm_kenh = Σ cm đơn trọn** (test_115 sai số 0đ).
- **Đơn thiếu nguon_khach/thuong_hieu → dòng "(chưa ghi …)"** — hiện thật, không giấu.
- **GÁC ép `thuong_hieu`** tại cổng chốt đơn (mở rộng `kiem_chuyen_trang_thai` db/109+111, cùng nguon_khach — vai thật,
  GUC `chan.off_thuonghieu`, không hồi tố; form Sale đã có * + chặn client). Nối QD-33.
- **Perf 100k:** kenh_cac_ky quét **2 vòng 100k** (cm_don_raw trọn + "khách mua brand lần đầu" all-time) → ~gấp đôi
  cm_don_ky (1 quét). Đo sạch **~910–930ms**, dao động tới ~1533ms khi DB bị nhiều test 100k liên tiếp làm nặng;
  PG tắt parallelism trong hàm → đây là sàn. **Ngưỡng test chốt <2000ms** (bền với dao động tải). Kỳ THẬT vài trăm
  đơn <50ms. Nối tiếp quyết định perf cm_don_ky (§QD trên: 100k là stress phi thực tế, CEO chấp nhận).
- **Trạng thái:** ĐÃ LÀM + duyệt mắt (db/115 chi_ads + ads_ds/ads_ghi/kenh_cac_ky + cm_don_raw(+thuong_hieu) + gác;
  tab "Kênh & CAC" app Tài chính bản `300abb14`; test_115 23/23). Commit v-kho-102.

## QD-40 (18/08) — Sổ phiếu thu + sổ COD + sổ giao dịch vốn + màn "Dòng tiền theo kỳ" (L-49)

- **CĂN CỨ SÁCH (Garrison ch.14 — direct method):** tách khu ĐẦU TƯ & VỐN (mua/bán tài sản, vay/trả vay, góp/rút vốn)
  khỏi kinh doanh; ghi GỘP KHÔNG BÙ TRỪ (vay mới + trả gốc = 2 dòng riêng, không cấn nhau); khép vòng quỹ:
  quỹ đầu kỳ + ròng KD + ròng ngoài KD = quỹ cuối kỳ. Dòng tiền ≠ P/L (P/L theo ngày giao; dòng tiền theo ngày tiền về/đi).
- **`phieu_thu` = NGUỒN SỰ THẬT thu tiền** (đơn·ngày·số tiền·loại đợt trong 4 loại coc/thu_khi_giao/thu_no/doi_soat_cod).
  Cột `don_hang.ngay_thu`/`so_tien_thuc_thu` cũ ĐÓNG BĂNG lịch sử — KHÔNG feed công thức mới. Thu trong kỳ gom theo NGÀY PHIẾU.
- **`giao_cod` = trạng thái tiền THỨ BA** (COD đã xuất xưởng, chưa đối soát) — tách khỏi "khách nợ". Bốn trạng thái tiền:
  khách nợ → ở nhà VC → đã thu · nhánh **hoàn** (KHÔNG sinh phiếu, tiền không đếm vào bất kỳ khối thu nào).
  Đối soát cả đợt 1 RPC/1 transaction: đơn không ở `dang_giao` → TỪ CHỐI cả đợt. Phí VC (chênh thu-hộ − thực-về) → `chi_phi_ky`
  loại `'khac'` ghi chú "phí VC/COD" (v1 ghi ngỏ tách loại). Tuổi ở nhà VC từ ngày xuất, >14 ngày đỏ.
- **`giao_dich_von`** — chiều tiền SUY từ loại: vào = vay_moi/ban_tai_san/gop_von; ra = tra_goc_vay/mua_tai_san/rut_von.
  **Lãi vay KHÔNG ở đây** — ghi `chi_phi_ky` loại `'khac'` "lãi vay" (v1); **gốc vay ở `giao_dich_von`** (tra_goc_vay). Tách rõ.
- **CHI = `chi_phi_ky` + `chi_ads` (Σ so_tien_nhap GỒM VAT — tiền THẬT chi ra, KHÁC màn CAC bóc VAT) + `luong_to` (lương+BH,
  KHÔNG overhead).** Vật tư (ván/phụ kiện) CHƯA có sổ chi theo kỳ → dòng tiền CHƯA gồm tiền mua ván (ghi ngỏ sổ NCC, không giả vờ đủ).
- **CÔNG NỢ hợp nhất MỘT nguồn số:** `con_phai_thu` = gia_chot(coalesce doanh_thu/gia_cong_thuc, GỒM VAT) − Σ `phieu_thu`,
  đơn da_giao dư>0, **LOẠI đơn COD dang_giao** (tiền đó ở khối "ở nhà VC" — bất biến: 1 đơn không ở 2 khối). Tuổi nợ 3 bậc
  (≤30 / 31–60 / >60) từ ngày giao, già nhất lên đầu, phân trang 50. **db/104 `dieu_hanh_cong_no_khach` CHUYỂN sang nguồn
  `phieu_thu`** (thôi dùng so_tien_thuc_thu) → một số, màn cũ trỏ sang. (Prod ~1 đơn thật nên chuyển không vỡ; test #10 sweep xanh.)
- **QUỸ:** `tham_so_tai_chinh.quy_dau_ky` (thêm cột). Kỳ đầu nhập tay; kỳ sau RPC gợi ý = quỹ cuối kỳ trước (đầu + ròng KD +
  ròng ngoài kỳ trước, đệ quy 1 tầng); sửa phải kèm lý do → lưu vào `ghi_chu` tham số.
- **Perf 100k (QD-37 nối tiếp):** dong_tien_ky **587ms** · con_phai_thu **480ms** (đo direct min-of-4, warm — số THẬT ổn định).
  PG TẮT parallelism trong hàm plpgsql → quét 100k đơn + gộp 100k phiếu tuần tự = sàn ~500-600ms, **y hệt cm_don_ky (QD-37, 527ms
  CEO chấp nhận)**. Đã tối ưu: đổi `not exists` tương quan trong SELECT → LEFT JOIN anti-join (dong_tien_ky **2700→580ms**) +
  index phủ `phieu_thu(ma_don) include(so_tien)`. Ngưỡng test_116 #11 = **<900ms** (LUẬT 2 HẠNG dưới — chung số QD-37, không đẻ số lẻ).
- **Trạng thái:** ĐÃ LÀM + deploy (db/116: 3 bảng + pt/cod/von + dong_tien_ky/con_phai_thu + hợp nhất cong_no; tab "Dòng tiền"
  app Tài chính bản `468f8b9e`; test_116 48/48). CHƯA commit — chờ CEO kiểm mắt.

### LUẬT TỐC ĐỘ 2 HẠNG (CEO chốt 18/08 — áp CHUNG mọi RPC từ nay)

- **Hạng TÁC NGHIỆP** (người đứng chờ thao tác: ghi phiếu, chốt đơn, chuyển trạng thái…): **< 500ms**.
- **Hạng PHÂN TÍCH** (màn báo cáo/tổng hợp: `pl_ky`, `cm_don_ky`, `kenh_cac_ky`, `dong_tien_ky`, `con_phai_thu`, và MỌI màn
  phân tích sau): **< 900ms warm tại stress 100k**.
- **Hạng META-MÀN** (RPC GỌI LẠI nhiều RPC phân tích, không tính lại — vd `nhan_xet_ky` gọi 6 nguồn): ngân sách = **Σ các nguồn
  nó gọi** (không phải <900ms đơn lẻ). Từng nguồn vẫn phải <900ms. `nhan_xet_ky` @100k ~2,6s = tổng 6 nguồn + 1 count guard;
  real kỳ <100ms. CEO chốt 18/08 (L-50): giữ tái dùng thuần thay vì gộp-quét (tránh "hai bản công thức").
- **Gốc ngưỡng 900:** plpgsql chạy TUẦN TỰ + 1 worker (PG tắt parallelism trong hàm; instance `max_parallel_workers_per_gather=1`)
  → quét 100k tuần tự = sàn ~500-600ms, cho headroom tải → 900. Kỳ THẬT vài trăm đơn **<50ms** — 100k chỉ là stress.
- **RPC mới TỰ CHIẾU HẠNG** (không hỏi lại, hết ngoại lệ lẻ QD-37/38/39…). **Tác nghiệp CẤM mượn ngưỡng phân tích** — chậm quá
  500ms thì tối ưu/denormalize, không được viện "màn phân tích".
- Nợ mở: nếu 1 màn phân tích cần **<500ms** ở quy mô lớn thật → lô riêng denormalize (vd cột `da_thu` trên `don_hang` + trigger).

### BẪY ĐO PERF (bài học chung cho MỌI test perf sau)

- Test harness đo qua helper `asK()` tạo **1 SAVEPOINT mỗi call**. Chuỗi test dài (mấy chục cắn) → **>64 subxid → TRÀN subtrans
  SLRU của Postgres** → mọi lần quét bảng lớn sau đó phải tra subtrans kiểm visibility → **số perf GIẢ chậm** (dong_tien_ky 587ms
  thật đội lên 980-1210ms). Prod KHÔNG có savepoint lồng nên KHÔNG dính.
- **⟹ Đo perf phải DIRECT:** set role authenticated + jwt claims **MỘT LẦN** rồi `c.query` thẳng (không savepoint/call), giống hệt
  prod. Áp cho mọi test perf sau. (Ghi cả ở đầu `web/ops/test_116.mjs`.)

## QD-41 (18/08) — Màn "Nhận xét theo luật" (L-50)

- **8 LUẬT đối chiếu số kỳ**, mỗi luật một dòng nhận xét khi đủ điều kiện; mẫu mỏng → khối IM LẶNG kèm lý do (không phán); đạt →
  không spam (chỉ L4 và tổng thể có dòng ỔN). GIỌNG: câu nói được ↦ **CÂU HỎI** (không mệnh lệnh) ↦ bằng chứng số ↦ căn cứ
  (luật · nguồn màn · sách/QD). **Garrison ch.6: CẤM gợi ý cắt segment** (định phí chung không biến mất) — máy nêu chỗ đáng
  soi + đặt câu hỏi, quyết định vẫn của người.
- **8 luật:** L1 CẢNH BÁO đơn giao thiếu giá vốn/ship-lắp (cm_don_ky.so_thieu, không ngưỡng) · L2 ĐÁNG SOI k3/DT dòng lẻ >
  ngưỡng (cần ≥ mẫu đơn trọn lẻ) · L3 ĐÁNG SOI CM% kênh < TB − ngưỡng điểm % (cần ≥ khách mới) · L4 CẢNH BÁO kênh vô hạn
  (ads>0, 0 khách) · L5 ĐÁNG SOI lấp đầy ngoài dải [thấp,cao] — **hai câu KHÁC NHAU** (trống→"đơn CM dương dưới sàn có đáng
  nhận?" ch.12; kín→"ưu tiên theo CM/khối 2 không theo CM%" ch.12) · L6 ĐÁNG SOI nợ>60 / DT kỳ > ngưỡng + đơn già nhất · L7
  ĐÁNG SOI số COD kẹt >14 ngày ≥ ngưỡng · L8 CẢNH BÁO lãi P/L dương & ròng tiền âm > ngưỡng, **phân rã chênh** = nợ khách +
  ở nhà VC + ngoài KD + khác (cộng khớp, Garrison ch.14).
- **NGUỒN SỐ = TÁI DÙNG RPC màn gốc, KHÔNG tính lại công thức.** nhan_xet_ky GỌI pl_ky + cm_don_ky + kenh_cac_ky + lap_day_ky +
  con_phai_thu + dong_tien_ky, rút field. Chỉ 1 count guard (đơn trọn theo dòng cho mẫu L2) là truy vấn phụ — sample-size, không
  phải công thức tài chính.
- **NGƯỠNG = tham số kỳ** (9 cột NULLABLE trên `tham_so_tai_chinh`; NULL = dùng mặc định + trả cờ `nguong_mac_dinh`). Mặc định:
  k3_le 8% · mẫu đơn 5 · kênh_yếu 10 điểm% · mẫu khách 3 · lấp_đầy 75–95% · nợ_già 8% · cod_kẹt 2 đơn · lãi_hụt 50tr. `nguong_ghi`
  set không hồi tố (kỳ cũ giữ nguyên). L1/L4/L7 không cần ngưỡng chỉnh.
- **META-MÀN (perf):** nhan_xet_ky = Σ 6 nguồn ~2,6s @100k stress (đo direct); real kỳ <100ms. Xem LUẬT TỐC ĐỘ (hạng META-MÀN
  bổ sung ở QD-40). CEO chốt 18/08: giữ tái dùng thuần 6 RPC (bằng chứng đầy đủ: L1 bắt cả thiếu-GV lẫn ship/lắp; L6 hiện đơn nợ
  già nhất) thay vì trọn 4 RPC <900ms (nghèo bằng chứng).
- **Trạng thái:** ĐÃ LÀM (db/117: 9 ngưỡng + nguong_ghi + nhan_xet_ky 8 luật; tab "Nhận xét" app Tài chính; test_117). CHƯA
  commit — chờ CEO kiểm mắt.

## QD-42 (19/08) — Cấu trúc nav 3 nhóm + Hướng dẫn là một phần app (L-51/L-52)

- **NAV 2 CẤP, 3 NHÓM** (CEO chốt, thực thi L-52): **NHẬP SỔ** (Dòng tiền · Chi phí kỳ · Kênh & CAC · Giá vốn theo đơn) ·
  **BÁO CÁO** (Điều hành · P/L · Lãi theo đơn · Nhận xét) · **THAM SỐ** (Định giá bán · Sổ tham số xưởng · Hướng dẫn ·
  Quản lý tài khoản [CEO-only]). Chỉ XẾP CHỖ — giữ nguyên id/loader mỗi tab, không đập code màn.
- **DEFAULT THEO VAI:** `ke_toan` đáp thẳng **Dòng tiền** (nơi nhập chính, tránh lạc đường vào màn chỉ-đọc); vai khác đáp
  **Điều hành**. (Trước đây mọi vai đều mở Điều hành — người nhập liệu vào màn không nhập được gì.)
- **HƯỚNG DẪN LÀ MỘT PHẦN APP:** `docs/huong_dan_taichinh.md` = MỘT nguồn (repo), inline vào bundle qua `?raw`, render bằng
  mini-markdown ở tab "Hướng dẫn" (mọi vai đọc). Sửa tài liệu = sửa file docs → build lại. KHÔNG chép nội dung sang HTML/JS.
- **VÁ 10 CHỖ HỞ NGHIỆP VỤ (B3):** đơn vị "(đ)" + placeholder mọi ô tiền; nhắc **3,3/1,1/1,1** + "% trên DT thuần" ở hoa hồng;
  min/max/step + placeholder VAT; "(chưa VAT)" ở giá vốn tay (k1/k2/k3, QD-30); tooltip "đối soát COD ghi ở form COD" cho
  loại phiếu thu; placeholder mã đơn COD; prefill ngày hôm nay ô date dòng tiền; placeholder mặc-định + min ở ngưỡng nhận xét;
  "gồm VAT" + min ở ô ads; "CHƯA VAT nếu có HĐ" ở cột chi phí kỳ.
- **BÀI HỌC OVERLOAD (db/118):** thêm `param default` cho hàm có test-tự-nạp-lại tạo overload ambiguous → **giữ chữ ký gốc +
  LIMIT trần bên trong** (xem so_no.md §nợ hiệu năng L-29).
- **Trạng thái:** ĐÃ LÀM + deploy (nav 3 nhóm · tab Hướng dẫn · 10 vá · db/118 dọn nợ). Commit gộp L-51+L-52 (v-kho-105).

## QD-43 (21/08) — Huỷ phiếu kho = ghi dòng giao dịch ĐẢO, không sửa/xoá sổ

- **HUỶ PHIẾU = GHI DÒNG `giao_dich` ĐẢO** (`loai='dieu_chinh'`, `nguon='phieu'`, trỏ `phieu_id` gốc), KÈM đảo lô:
  huỷ NHẬP → `lo_da_huy=true`, `con_lai=0`, **tính lại `gia_von_bq` từ lô còn sống**; huỷ XUẤT → **trả `con_lai` theo
  `lo_nhap_id` gốc**. **CẤM xoá/sửa dòng sổ đã ghi.**
- **CHẶN:** phiếu nhập đã xuất một phần KHÔNG được huỷ → buộc lập **phiếu điều chỉnh**; chặn **huỷ hai lần**; chỉ huỷ
  phiếu `trang_thai='ghi_so'`.
- **Lý do:** ERP Sagegg-Alfnes §3.3.5 (tồn SUY từ giao dịch; bảng `ton` chỉ là cache làm tươi khi có giao dịch) + §3.4.2
  (lệch ghi thành giao dịch điều chỉnh, không sửa số trực tiếp) + **QD-18** (sổ ghi-thêm bất biến, đính chính bằng dòng mới).
  Hành vi có sẵn ở `db/015` từ trước; nay ghi QD để người sau KHÔNG "sửa lại cho gọn". Kiểm chứng: WP-16 (L-54/L-55),
  test `web/ops/test_huy_phieu.mjs` 6 ca (20/20).
- **Liên quan:** QD-18 (sổ bất biến). **WP-11 sẽ bỏ bước UPDATE `ton`** (tồn suy từ `giao_dich`, không giữ cache ghi tay).
- **Trạng thái:** đang áp dụng (`db/015`).

## QD-44 (21/08) — Tồn = tổng từ sổ giao_dich; bảng `ton` chỉ trigger ghi; sổ append-only, thứ tự bằng `stt` bigserial

- **`ton` = CACHE, KHÔNG phải nguồn.** Nguồn sự thật tồn = sổ `giao_dich` (Σ `so_luong`). Bảng `ton` chỉ được làm tươi bởi
  **MỘT trigger `gd_cap_nhat_ton` BEFORE INSERT `giao_dich`** (ghi `so_luong` + `so_du_sau` + `gia_von_bq`). **Không RPC, không
  người, không policy nào UPDATE `ton` nữa** (revoke + policy chỉ SELECT). 2 RPC `ghi_so_phieu`/`huy_phieu` XOÁ mọi `update ton`,
  chỉ còn INSERT `giao_dich` + xử lý `lo_nhap`.
- **`giao_dich` APPEND-ONLY:** revoke UPDATE/DELETE (authenticated chỉ INSERT/SELECT); policy `gd_doc`(select)+`gd_ghi`(insert
  ceo/kho)+`gd_tho_quet`(tho) theo mẫu `su_kien_quet`; force RLS; trigger `gd_chan_sua` chặn UPDATE/DELETE (đính chính bằng dòng
  điều chỉnh mới — QD-18).
- **Thứ tự = `stt` bigserial** (cột mới, backfill theo tao_luc rồi khoá). "Dòng cuối" = `max(stt)`. Lý do: **BL-03 dương tính giả**
  do sắp theo `id` UUID (L-53); và **nhiều dòng cùng `tao_luc` trong 1 transaction** (now() đóng băng — WP-16/L-55). `so_ba_nguon.sql`
  đổi sang `order by stt desc`.
- **GIẢ ĐỊNH (điểm lệch cần CEO duyệt):** `giao_dich` KHÔNG có cột đơn giá → `gia_von_bq` tính lại **trong trigger từ LÔ SỐNG**
  (`lo_nhap.gia_von_lo`, bình quân gia quyền — y hệt logic `huy_phieu` cũ), CHỈ khi có lô sống có giá; đường không-lô
  (kiểm kê/seed) KHÔNG đụng `gia_von_bq`. Khác gợi ý "trigger không đụng gia_von_bq" — chọn vậy vì cấm RPC update `ton` mà giá vốn
  phải đúng. **Âm kho: GIỮ cho phép** (gắn cờ `ton_am`, không raise — như RPC cũ).
- **Căn cứ:** ERP Sagegg & Alfnes §3.3.5. **Liên quan:** QD-18 (sổ bất biến), QD-43 (huỷ phiếu). Kiểm chứng: test `web/ops/test_119_ton_tu_so.mjs`.
- **CEO duyệt (21/08):** (1) `gia_von_bq` = bình quân lô sống là **TẠM** — chính sách giá vốn chốt ở **WP-13**. (2) Giữ policy
  `gd_tho_quet` (tho INSERT giao_dich thẳng) tới **WP-33** rồi revoke.
- **Trạng thái:** đang áp dụng (db/119).

## QD-45 (21/08) — Khai tử `quet_giao_dich` (db/037)

- **DROP `kho.quet_giao_dich(text,text,numeric)`** + revoke execute. Lý do: **0 caller suốt 2 tuần** (WP-17/L-56: không UI/JS/
  plugin/test/DB nào gọi; 0 dòng `nguon='quet_tem'` = chưa từng chạy thật), và nó là **đường ghi `ton` thứ hai** — cấm theo tinh
  thần QD-03 (một đường ghi). File `db/037` GIỮ làm lịch sử (comment trỏ QD-45). 45 dòng `kiem_ke` là SEED, GIỮ NGUYÊN (QD-18).
- **Trạng thái:** đang áp dụng (db/119).

## QD-46 (21/08) — Đơn demo = ma_don `DEMO-*`, cờ tự động, loại khỏi tài chính mặc định, xoá bằng `xoa_demo()` duy nhất

- **Cờ bắt theo MÃ ĐƠN HOẶC KHÁCH DEMO** (db/121, L-60): trigger `don_hang_tu_danh_dau_demo` set `la_demo=true` khi `ma_don
  ILIKE 'DEMO-%'` **HOẶC** `ten_khach ILIKE 'DEMO%'` **HOẶC** khách của đơn demo (nối `sdt_khach → khach.la_demo`). Lý do: Sale sinh
  mã `DH-…` nên bắt-theo-mã một mình không đủ; khách `ten ILIKE 'DEMO%'` cũng tự demo. Không nút bật/tắt trên màn (G1) — chỉ dữ liệu quyết.
- **Loại demo khỏi tài chính MẶC ĐỊNH:** 6 RPC (`cm_don_ky`, `cm_don_raw`, `gia_von_don_ds`, `pl_ky`, `kenh_cac_ky`, `lap_day_ky`)
  thêm tham số cuối `p_gom_demo boolean DEFAULT false` → mặc định `WHERE NOT la_demo`; `true` mới gom demo. Drop chữ ký cũ, tạo 1 bản
  (không đẻ overload — bài học QD-42). 4 RPC đã lọc sẵn (con_phai_thu, dieu_hanh_cong_no_khach, dong_tien_ky, nhan_xet_ky) giữ nguyên.
- **`xoa_demo(p_ma_don, p_xac_nhan)` là ĐƯỜNG XOÁ DUY NHẤT** (SECURITY DEFINER, chỉ ceo): `p_ma_don` → xoá 1 đơn (phải la_demo);
  NULL → xoá **TOÀN BỘ** la_demo (kể cả seed cũ) bắt buộc `p_xac_nhan='XOA_HET'` (G2). Xoá theo FK: su_kien_quet (theo tem qua
  tien_do_tem) + tem phụ + don_hang (CASCADE con) + khách demo mồ côi + phieu_dem_ngay (chỉ global).
- **"0 TÁC ĐỘNG" (sửa từ "0 dấu vết", WP-33/QD-54):** từ khi có back-flush, đơn demo CÓ thể sinh `giao_dich` (phiếu `xuat_sx`).
  `xoa_demo` đưa **tồn / giữ chỗ / công nợ về NHƯ CŨ** (phiếu `xuat_sx` demo → huỷ bằng **dòng đảo** HX, cặp ròng 0), nhưng **bản
  ghi vẫn còn** (phiếu XSX+HX, dòng đảo, giao_dich) mang `la_demo=true` — mọi màn/RPC danh sách phiếu **lọc `la_demo=false` mặc định**
  (tham số `p_gom_demo`). Lý do: **sổ append-only QD-44 THẮNG** (không xoá cứng sổ). `ton` vẫn khớp `so_ba_nguon` sau xoá.
- **Căn cứ:** MES Meyer §9.4 (pilot test) + §9.1.2 (triển khai từng quy trình). Kiểm chứng: `web/ops/test_120.mjs`.
- **Trạng thái:** đang áp dụng (db/120). Bàn giao chưa nối lịch (WP-43) → demo gọi `luu_xep_lich` tay (G3).
- **[sửa 25/08 theo chỉ đạo CEO]** Demo được nhận diện bằng **CỜ `la_demo`**. Tiền tố mã `DEMO-` chỉ là **MỘT cách bật cờ, không
  phải điều kiện**. Đơn do app tự cấp mã (`T8-*`) vẫn là demo hợp lệ nếu `la_demo=true`; `xoa_demo()` lọc theo **cờ**, không theo tiền tố.
  (Căn cứ WP-37/L-123: robot tạo đơn báo giá `T8-001` qua UI Sale — mã hệ cấp, không có ô nhập — vẫn `la_demo=true`, `xoa_demo('T8-001')` xoá được.)

## QD-47 (21/08) — Trạng thái đơn chỉ đổi qua CỔNG NGHIỆP VỤ của nó (WP-03, db/123)

- **(a) Tem KHÔNG phát hành lệnh SX** (ERP §6.4): `day_tem_ban_ve` chỉ LƯU tem, **không** còn bắc cầu `trang_thai='cho_cat'`.
  `ban_giao_xuong` là **cổng DUY NHẤT** chuyển `cho_cat`. Trước đây đẩy tem từ plugin làm đơn nhảy vào chuyền bỏ qua
  giá vốn/số/bàn giao. PHÁT SINH giữ nguyên (không sửa lô này): `day_so_san_xuat` (db/068, **chết** — không caller) và
  `dua_vao_chuyen` (db/045, **nút thủ công** quản đốc — cổng hợp lệ) cũng set cho_cat.
- **(b) thu-khi-giao chỉ SAU khi giao:** `pt_ghi` RAISE khi `loai='thu_khi_giao'` mà đơn ∉ {cho_giao, da_giao} — gợi ý
  dùng `loai='coc'`. Nhận tiền trước khi giao = cọc, không phải thu-khi-giao.
- **(c) da_giao phải có NÚT:** hiện không app nào có đường `cho_giao→da_giao` (Sale chỉ giao từ `xong_sx`). Mẫu tĩnh
  `~/Downloads/mau_nut_da_giao.html` (nút "Đã giao xong" ở thẻ `cho_giao` + modal xác nhận) **chờ CEO duyệt** rồi mới code.
- **Kiểm chứng:** `web/ops/test_123.mjs` (10/0). **Nợ:** `xoa_demo` không xoá được đơn đã bàn giao (trigger `MOC_CHUAN_DA_CHOT`
  chặn xoá số chốt) → D6 phải tạm gỡ trigger; nên cho `xoa_demo` một cờ bypass (WP sau). **→ VÁ ở db/125 (D8): GUC `kho.xoa_demo`.**

## QD-48 (21/08) — ĐƠN MUA: đầu đơn + dòng, MỘT cột trạng thái 6 giá trị, cổng ở DB (WP-20, db/126)

- **Đơn mua = đầu đơn (`don_mua`) + dòng đơn (`don_mua_dong`)**, MỘT cột `trang_thai` 6 giá trị:
  `moi→da_gui→xac_nhan→da_nhan→da_khop_hd` (+ `huy` chỉ TRƯỚC da_nhan). Chỉ đi tới, **không lùi**, qua RPC
  `dm_chuyen_trang_thai` (cổng cứng ở DB — không ai lách, tinh thần QD-47). `da_nhan`/`da_khop_hd` thuộc **WP-21/22**,
  tạm chỉ ceo (GUC `kho.dm_he_thong='1'` để RPC nhận-hàng/khớp-HĐ sau này bypass vai).
- **Lý do:** ERP Sagegg & Alfnes §4.2/4.3.1/4.3.3/4.4 — sách chỉ ra D365 tách **3 ô trạng thái** (đặt/nhận/khớp HĐ) gây
  khó theo dõi → **gộp MỘT cột**. Số đơn `DM-YYYY-NNNN` qua `cap_so_phieu('DM')` (reset theo NĂM; chuoi_so chưa reset tháng).
- **Đơn giá gợi ý** từ `v_gia_tham_khao` (chưa làm bảng giá NCC — để WP-23). `so_luong_da_nhan` dòng để WP-21 ghi.
- **Kiểm chứng:** `web/ops/test_126.mjs` (18/0, gồm 100k stress). Màn "Đơn mua" trong app Kho (nhóm Chứng từ, kho/ceo).
- **Trạng thái:** ĐANG ÁP DỤNG (db/126).

## QD-49 (22/08) — NHẬN HÀNG ĐƠN MUA = phiếu nhập tự sinh qua `ghi_so_phieu`, gắn `don_mua_id` (WP-21, db/127)

- **Nhận hàng không đẻ đường ghi mới.** `dm_nhan_hang(don_mua_id, dòng[{dong_id, so_luong, ghi_chu_lo}], ngày)` gọi
  **`ghi_so_phieu`** (đúng một đường ghi sổ — QD-03/QD-44) sinh **1 phiếu nhập + dòng sổ giao dịch + lô nhập** như nhập tay,
  rồi gắn `phieu.don_mua_id`. **Giá lô = đơn giá dòng đơn** (→ `gia_von_lo`) — TẠM tới WP-22/13 (khớp hoá đơn / giá vốn thật).
- **Nhận một phần giữ `xac_nhan`; đủ MỌI dòng mới `da_nhan`** (tự chuyển qua cổng, GUC `kho.dm_he_thong` — QD-48).
  **Vượt số đặt → CHẶN** (`DM_VUOT_SO_DAT`, không ghi nửa vời). Sai trạng thái → `DM_SAI_TRANG_THAI`. Vai kho/ceo.
- **Huỷ phiếu nhận = nút Huỷ phiếu hiện có (QD-43):** sổ đảo + trừ lại `so_luong_da_nhan` theo từng dòng
  (`phieu_dong.don_mua_dong_id`). Đơn **đã `da_nhan` → KHOÁ huỷ** (`DM_DA_NHAN_KHONG_HUY`, QD-48 — muốn đảo phải TRẢ HÀNG NCC, việc sau).
- **`ghi_so_phieu` mở rộng TẠI CHỖ, GIỮ chữ ký 6 tham số** (không overload — nếu không test_037 áp lại db/037 sẽ đụng "not
  unique"): dòng đọc thêm `ghi_chu` (→ `phieu_dong.ly_do`) + `don_mua_dong_id`; trả thêm `phieu_id`. Kho vẫn **mặc định** (xưởng 1
  kho) — `dm_nhan_hang` **guard** `don_mua.kho_id = kho mặc định` (mở đa kho ở WP sau mới nới).
- **Lý do:** ERP Sagegg & Alfnes §4.4 (nhận hàng đối chiếu PO) + §3.3.5 (tồn suy từ sổ) — sách không nói nhận-một-phần /
  nhận-vượt → **quyết CEO 22/08**. Điện thoại & máy tính dùng CHUNG `dm_nhan_hang` (không app riêng, không đường ghi thứ hai).
- **Kiểm chứng:** `web/ops/test_127.mjs` (35/0: một phần/nốt/vượt/sai-trạng-thái/vai/huỷ-đảo/huỷ-khoá + 100k stress
  159ms + so_ba_nguon 199/199 + test_119/huy_phieu/126/037 không vỡ). Màn "Nhận hàng" trong tab Đơn mua (bảng máy tính +
  thẻ điện thoại ≤480px). Chip "Nguồn: Đơn mua …" ở tab Phiếu nhập.
- **Trạng thái:** ĐANG ÁP DỤNG (db/127).
- **Việc phát sinh:** WP "Trả hàng NCC" (đảo sau `da_nhan`) · WP-22 (khớp hoá đơn — phiếu nhận đã có `don_mua_id` để nối) · đa kho.

## QD-50 (22/08) — BOM THUỘC MÓN: đơn cấp, gắn `don_hang_mon.id`, KHÔNG thuộc plugin/biến thể (WP-30, db/128)

- **BOM gắn MÓN** (`don_hang_mon_bom.mon_id`, QD-13), **ĐƠN CẤP**, không thuộc plugin/biến thể. Dòng BOM **FK `vat_tu`**.
  `nguon ∈ {cutlist, go_tay, uoc}` (cutlist = plugin/nesting; go_tay = người nhập; uoc = ước theo m²/lõi) — **món không cutlist
  VẪN có BOM** (QD-06). `moc ∈ {du_kien, chuan}`; **`thuc_te` KHÔNG ở BOM** mà là sổ `giao_dich` (QD-44). Mốc `chuan` chốt lúc
  `ban_giao_xuong` (WP-32, QD-16) qua `chot_luc` + trigger cấm sửa/xoá. Mỗi dòng có `hoat_dong` nullable (trạm tiêu hao,
  FK `don_gia_baseline` — WP-33 back-flush theo trạm). **BOM chỉ chứa vật tư TRUY ĐƯỢC theo món**; vật tư phân xưởng giá trị
  thấp (đinh, vít, keo sữa, nhám) KHÔNG vào BOM → xuất gộp, tính overhead (WP-41). **Đa cấp** chỉ mở khi có bán thành phẩm
  CẤT KHO dùng chung (WP-41; cấu trúc không cản — `vat_tu_id` trỏ cụm).
- **Lý do:** ERP Sagegg & Alfnes §6.2 (dòng BOM = item trong item master, "BOM là chìa khoá nối chuỗi cung ứng"; lệnh SX sao
  chép BOM riêng, sửa không chạm master → BOM của ta gắn MÓN; món tự do không có master, plugin đẩy thẳng = CAD-to-ERP),
  §6.3.1/6.3.2 (BOM đơn cấp; nhánh cánh/thùng/hộc kéo là phantom ở tầng quy trình — QD-01/MES 4.1 — không lặp ở BOM),
  §6.3.6 (planned/actual → `du_kien`/`chuan`; `thuc_te` = sổ), §6.5.2/6.5.3 (chỉ vật tư truy được; vật tư phân xưởng ngoài
  BOM; % hao theo dòng `hao_hut_pct` NULL, WP-33 điền) + QD-13/QD-15/QD-44. MES 4.2.4: parts list suy từ work-plan có thể chỉ
  là báo cáo — ta **VẪN lưu bảng** vì món tự do không có work-plan-chuẩn để suy + cần chốt lịch sử (QD-16). Sách không nói
  ETO-không-master-BOM: **đây là tôi đoán**.
- **Đường ghi:** `ghi_bom_mon(mon_id, nguon, dong[])` (SecDef, vai thiet_ke/tk_ban_hang/truong_nhom/kho/ceo) thay TOÀN BỘ dòng
  `du_kien` của (món, nguồn) — idempotent, plugin đẩy lại được. Plugin **KHÔNG dùng GUC riêng** — đăng nhập vai thật (như
  `ghi_gia_von_don` db/034). `bom_don_ds(don_id, moc)` trả mọi nguồn song song + `nguon_bom` ưu tiên (cutlist>go_tay>uoc) +
  `co_bom`. Ghi trực tiếp bị RLS chặn; dòng chốt bị trigger chặn (bypass CHỈ qua `xoa_demo`/GUC `kho.xoa_demo`, db/125).
- **Kiểm chứng:** `web/ops/test_128.mjs` **18/0** (go_tay/cutlist-đè/song-song/RLS/chốt/lỗi-rõ/vai/xoa_demo + @100k: bom_don_ds
  47ms · vat_tu-query 17ms). KHÔNG UI, KHÔNG nối `ban_giao_xuong`, KHÔNG chạm ton/giao_dich, KHÔNG sửa plugin (WP-31/32/33).
- **Trạng thái:** ĐANG ÁP DỤNG (db/128).
- **Việc phát sinh:** Ván thừa = dòng BOM âm (ERP 6.5.3) cần mã "ván lỡ cỡ" + định giá + kho tái chế (ngoài lộ trình) · cột
  phân loại vật tư (BOM/phân xưởng/hard-reserve theo lô) trên `vat_tu` → WP-41 cùng `pp_ke_hoach` · PO 3 tầng trạng thái
  (main/document/approval) — QD-48 chọn 1 cột, cân nhắc khi làm WP-22.

## QD-51 (22/08) — Tài khoản robot tiền tố `test_` là CỐ ĐỊNH, chỉ chạm đơn demo; mật khẩu trong `.env.robot` ngoài git (L-66)

- **6 tài khoản robot** `test_ceo·test_sale·test_thiet_ke·test_quan_doc(vai xuong)·test_tho·test_kho`
  (`ho_ten` tiền tố `test_`, `@togihome.local`) là **CỐ ĐỊNH** — tạo qua `qly_them_nguoi` (db/052), mật khẩu ngẫu nhiên ≥20 ký tự
  ghi `web/ops/.env.robot` (đã `.gitignore`, chmod 600, KHÔNG in ra, KHÔNG vào git). Dựng lại/idempotent: `node ops/dung_tk_robot.mjs`.
- **NGOẠI LỆ của luật "test_ dùng xong xoá"** (05 §D): robot là **vòng hồi quy CHUẨN sau mỗi lô**, không thể bắt CEO nhập mật khẩu
  mỗi lần → tài khoản giữ lại; chỉ **dữ liệu** demo bị `xoa_demo()` cuối vòng (0 dấu vết), **tài khoản KHÔNG xoá**.
- **An toàn (dev=prod cùng project):** trigger `chan_test_ngoai_demo` (db/129) — tài khoản `test_%` INSERT/UPDATE `don_hang`
  KHÔNG `la_demo` → RAISE `TEST_ROBOT_NGOAI_DEMO`. Đơn thật miễn nhiễm (chủ không phải `test_`). `giao_dich`/`phieu_thu`:
  robot demo hiện KHÔNG ghi → chưa gắn cổng; thêm khi có robot ghi vào chúng.
- **Cơ chế login:** `demo_phong_hop.py` nạp `.env.robot` → mặc định `DEMO_USER/DEMO_PASS = test_ceo` (ceo vào được cả 4 app,
  đúng cơ chế cũ) → **hết nhập mật khẩu tay**; env truyền tay vẫn ưu tiên. `demo_kiem.mjs`/`trams_don.mjs` nối DB trực tiếp
  (`docConfig`, read-only) — không login, không cần `.env.robot`.
- **Lý do:** 05 §D (robot = vòng hồi quy chuẩn). **Trạng thái:** ĐANG ÁP DỤNG (db/129 + .env.robot + dung_tk_robot.mjs).
- **Chạy hồi quy:** `cd web && python3 ops/demo_phong_hop.py`

## QD-52 (22/08) — GIỮ CHỖ MỀM lúc bàn giao: không trừ tồn, không gắn lô; thiếu hàng vẫn bàn giao và báo thiếu (WP-32, db/130)

- **Bàn giao xưởng (QD-16 mốc chốt) tự kích hoạt GIỮ CHỖ.** `ban_giao_xuong` sau 3 chốt cũ (đóng băng số/phút/đơn giá, gắn
  file cắt, chuyển `cho_cat`) làm thêm: (i) đóng băng BOM `du_kien→chuan` + `chot_luc`; (ii) sinh **`giu_cho`** MỀM một dòng mỗi
  dòng BOM chuan (3 nguồn cutlist/go_tay/uoc như nhau — bổ trợ, không thay thế), kho = xưởng mặc định.
- **MỀM (soft), KHÔNG hard:** ván không serial → giữ SỐ LƯỢNG, KHÔNG gắn lô. **KHÔNG trừ `ton`, KHÔNG INSERT `giao_dich`**
  (WP-10: SX chưa chạm tồn — chỉ THÊM đường mới). Trừ tồn THẬT để **WP-33 back-flush theo quét**.
- **Khả dụng (Q4 CEO chốt):** `v_ton_kha_dung.kha_dung = ton − giữ_chỗ`; `kha_dung_ke_ca_po = + PO đang về`
  (Σ `don_mua_dong.so_luong − so_luong_da_nhan` của đơn mua `da_gui/xac_nhan`).
- **Thiếu hàng VẪN bàn giao** (ERP 3.3.7: vật tư chưa có thì ghi nhận theo lệnh SX, giữ khi hàng về) → trả `vat_tu_thieu`
  (khả dụng âm) + `mon_thieu_bom` (món chưa có BOM) trong kết quả RPC, **KHÔNG chặn**. Chặn là việc WP-42 quyết.
- **Đơn → `huy`** ⇒ trigger `trg_huy_giu_cho` chuyển giữ chỗ `mo→huy`; `tam_ngung` giữ nguyên. Bàn giao lần 2 vô hại
  (`UNIQUE(don_hang_mon_bom_id) WHERE mo` + guard `DA_VAO_CHUYEN`).
- **Lý do:** ERP Sagegg & Alfnes §3.3.7 (giữ chỗ để on-hand khả dụng đúng; soft cho hàng không serial) + QD-16 + QD-44
  (một bản sự thật tồn) + WP-10. **Kiểm chứng:** `web/ops/test_130.mjs` (10 ca). **Trạng thái:** ĐANG ÁP DỤNG (db/130).

## QD-53 (22/08) — Mỗi vật tư MỘT đơn vị cơ sở = đơn vị đếm trong kho; quy đổi qua vat_tu_don_vi (WP-35, db/131)

- **Đơn vị cơ sở** `vat_tu.don_vi_co_so` (no-dấu, FK `don_vi.ma`) = đơn vị người kho ĐẾM. **Khoá** khi vật tư đã có
  sổ `giao_dich` / `giu_cho` / BOM `chuan` / `lo_nhap` (trigger `chan_doi_don_vi_co_so`). `dvt` (có dấu) GIỮ song song cho HIỂN THỊ
  (không đổi tên → không vỡ app).
- **Đơn vị khác** qua `vat_tu_don_vi(vat_tu_id, don_vi, he_so)`: 1 [don_vi] = `he_so` × [cơ sở]. Hàm `quy_ve_co_so(vat_tu,don_vi,so_luong)`
  (không làm tròn; đơn vị lạ/không quy đổi → RAISE — không tự chuẩn hoá ngầm). Ghi qua RPC `vat_tu_don_vi_ghi/xoa` (kho/ceo).
- **Sổ `giao_dich` / `giu_cho` / `phieu_dong` / `lo_nhap` LUÔN ở đơn vị cơ sở** (không cột đơn vị → COMMENT). **BOM giữ đơn vị nguồn**
  (`don_hang_mon_bom.don_vi`) + `so_luong_co_so` (đã quy về cơ sở) + `he_so_ap_dung` (snapshot — đổi hệ số sau KHÔNG làm BOM chốt trôi số).
  `ghi_bom_mon` quy về cơ sở; `ban_giao_xuong` giữ chỗ = `so_luong_co_so`; `bom_don_ds`/`giu_cho_ds` trả thêm cơ sở.
- **Trigger auto-fill** (`vat_tu_fill_co_so`, `bom_fill_co_so`) cho INSERT thẳng là **TẠM** (giữ 3 test cũ xanh) — **gỡ ở WP-91**
  sau khi 3 test đi qua RPC. Đường THẬT (`ghi_bom_mon`) vẫn strict qua `quy_ve_co_so`.
- **Lý do:** ERP Sagegg & Alfnes §3.3.4 tr.59 (một đơn vị cơ sở, khoá khi đã dùng, quy đổi qua bảng). `quy_doi` cũ là **map mã
  plugin** (tên sai nhưng đổi tên là việc riêng — giữ nguyên). **Kiểm chứng:** `web/ops/test_wp35.mjs` 20/0 (gồm @100k: quy_ve_co_so
  0,1ms · ghi_bom_mon 50 dòng 22ms) + so_ba_nguon 199/199 + test_119/huy_phieu/128/130 xanh. **Trạng thái:** ĐANG ÁP DỤNG (db/131).
- **Nợ (PHÁT SINH):** màn nhập quy đổi tab Tồn kho (mẫu trước) · đổi tên `quy_doi` · `don_mua_dong` đơn vị mua≠cơ sở (WP-22/23) ·
  làm tròn tấm lẻ (WP-33) · seed quy đổi m²→tấm CHƯA có (vat_tu thiếu cột dài/rộng).

## QD-54 (22/08) — BACK-FLUSH: quét CẮT tự xuất ván, quét LẮP tự xuất phụ kiện (WP-33, db/132) · DUYỆT

- **ERP §6.5.2:** vật tư tự ghi XUẤT khi công đoạn sau báo xong. Quét **CẮT** (`cat`) → back-flush **ván**; quét **LẮP**
  (`thung,canh,ray,cup,cam,giuong_lap`) → back-flush **phụ kiện**. Nối trong `sq_ghi` sau khi ghi NHẬN (QD-18 bọc exception —
  lỗi back-flush KHÔNG hỏng ghi sổ quét).
- **Lượng xuất = BOM chuẩn (`so_luong_co_so`) × (1 + hao_hut_pct) làm tròn** (`lam_tron_xuat`: tam/cai/cay/bo/chiec/thanh/cuon → CEIL;
  m/m2/kg/lit → round 3). Ghi kèm `phieu_dong.so_luong_chuan / hao_hut_pct_ap_dung / so_du_lam_tron` (WP-34/WP-94 đọc).
  **Hao hụt ván 10% / phụ kiện 0% = số khởi đầu [TẠM]; WP-34 đo lại sau 10 đơn thật.**
- **MỘT ĐƯỜNG GHI** qua `ghi_so_phieu('xuat_sx', nguon='quet_tem')` (QD-03/44 — không hàm ghi sổ mới). Idempotent theo
  `unique(mon_id, nhom_back_flush) where loai='xuat_sx'` → lần quét sau trả `da_xuat_truoc`. **Tồn âm VẪN xuất** (tín hiệu đếm sai
  — WP-14/42; `gd_cap_nhat_ton` chỉ gắn cờ). `xuat_back_flush` chỉ gọi NỘI BỘ (GUC `kho.back_flush_he_thong`; client → RAISE).
- **Giữ chỗ:** back-flush tăng `giu_cho.so_luong_da_xuat` (cap tại `so_luong_giu`); `huy_phieu` phiếu `xuat_sx` → sổ đảo + hoàn
  giữ chỗ. **BOM `thuc_te` = TỪ SỔ** (`bom_don_ds.thuc_te` / view `v_bom_thuc_te`) — KHÔNG ghi dòng (QD-50, một bản sự thật).
- **REVOKE `gd_tho_quet`** (hẹn từ QD-44): tho không còn INSERT `giao_dich` thẳng; mọi xuất qua RPC.
- **Kiểm chứng:** `web/ops/test_132.mjs` (quét thật + GUC + perf WARM 80–84ms @100k < 300 + so_ba_nguon 199/199 + 119/huy/128/130/wp35 xanh).
- **Trạng thái:** ĐANG ÁP DỤNG (db/132). Nợ: màn nhập hao hụt · toast back-flush trạm quét · WP-34 so thực tế · WP-94 ván thừa.

## QD-55 (22/08) — Thiếu hệ số KHÔNG chặn thợ (nới QD-53 cho cutlist) · đổi tên `quy_doi`→`plugin_ma_map` (WP-36, db/134) · DUYỆT

- **Plugin (`cutlist`) đẩy BOM đơn vị chưa có hệ số → dòng CHỜ** (`so_luong_co_so` NULL), KHÔNG raise. Người nhập (`go_tay`/`uoc`)
  VẪN strict (QD-53) → `test_wp35` giữ xanh. Quét CẮT: tem NHẬN như thường, ván bị HOÃN, `quet_tem` trả thêm
  `back_flush:[{ma,so_luong,don_vi,phieu_so,ton_con,ton_truoc}]` + `thieu_he_so:[{ma,don_vi_bom,don_vi_co_so}]`
  (toast xưởng: xanh = đã xuất · vàng = thiếu hệ số, tem chạy tiếp).
- **Back-flush tính LIVE** (snapshot NULL → quy đổi theo `vat_tu_don_vi` hiện tại), **KHÔNG sửa BOM đã chốt** (QD-53 test 11 bất biến).
  Kho nhập khổ/hao/đơn vị qua màn **"Đơn vị & hao hụt"** (`luu_tham_so_vat_tu`, vai kho/ceo) → cuối hàm gọi `chay_lai_back_flush`
  xuất bù các tem đã cắt còn chờ (idempotent theo `unique(mon,nhom)`, QD-54).
- **Khổ ván (`kho_dai_mm`×`kho_rong_mm`) → tự suy hệ số m²** = `1/(dài·rộng/1e6)` (nguồn "suy từ khổ"). **Hao hụt NULL = mặc định nhóm**
  (ván 10% · khác 0%) — `hao_hut_hieu_luc`; ghi tay ghi đè. Mọi thay đổi ghi `vat_tu_tham_so_lich_su` (append-only: trigger owner +
  revoke authenticated). `ban_giao_xuong` **bỏ qua dòng chờ** khi sinh giữ chỗ (`so_luong_giu` NOT NULL). Nhãn "thiếu hệ số" ở
  `tham_so_vat_tu_ds` theo **quy-được-hay-chưa** (KHÔNG theo snapshot NULL) → nhập xong nhãn tự tắt.
- **`quy_doi` đổi tên → `plugin_ma_map`** (đúng nghĩa: map MÃ plugin ↔ mã kho, KHÔNG phải quy đổi đơn vị). View compat `quy_doi`
  (`security_invoker`) DEPRECATED, gỡ ở WP-91. `quy_doi_export` + `nap/xuat_quy_doi.mjs` + màn Ghép mã (nay "Ghép mã plugin") trỏ bảng mới.
- **Lý do:** ERP §3.3.4 — mỗi vật tư MỘT đơn vị cơ sở khoá khi đã dùng, quy đổi qua BẢNG ĐĂNG KÝ (không hard-code); MES trạm quét
  KHÔNG chờ kho (dữ liệu cấu hình thiếu không được dừng sản xuất — ghi nợ, xử sau).
- **Kiểm chứng:** `web/ops/test_134.mjs` **34/0** (khổ→m², 12 m²→5 tấm ceil, guard hệ số/hao/cơ sở, lịch sử append-only, quét thiếu→xuất bù,
  snapshot bất biến, nhãn tự tắt, view compat) + perf `tham_so_vat_tu_ds` @100k 325ms<500 · `quet_tem` @100k 28ms<300 + robot prod 4 ảnh.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/134). Nợ: WP-34 đo hao thực · WP-91 gỡ view compat + trigger fill · WP-94 ván thừa (`so_du_lam_tron`).

## QD-56 (22/08, treo từ WP-01) — Bảo hiểm 60tr/tháng phân bổ THEO LƯƠNG (Garrison ch.3) · DUYỆT

- **60tr BHXH/tháng chia theo tỷ lệ lương:** 60/634 ≈ **9,5%**. ~**30,7tr** phân về **7 tổ sản xuất** theo lương tổ (vào `luong_to.bao_hiem`);
  ~**29,3tr** là dòng **"Bảo hiểm sale + văn phòng"** thuộc phân khúc **CHUNG** (không gán tổ SX).
- **Overhead phân bổ tổ = 0** (chủ ý): định phí (thuê xưởng, khấu hao, BH văn phòng…) nằm ở **Dòng chi**, P/L dùng **số dư đảm phí**
  (contribution margin) — KHÔNG đẩy định phí vào giá vốn đơn. Nhập BH ở CẢ giá vốn tổ LẪN dòng chi = **đếm đôi** → cấm.
- **Lý do:** Garrison *Managerial Accounting* ch.3 (phân bổ chi phí theo cơ sở hợp lý = lương) + ch.5 (CVP: định phí không vào đơn vị sp).
- **Trạng thái:** ÁP DỤNG (số nhập tay ở app Tài chính; `luong_to.bao_hiem` + `chi_phi_ky`/`luong_to` đã feed `dong_tien_ky` KHỐI 2).

## QD-57 (22/08, WP-22, db/135) — Hoá đơn NCC khớp 3 chiều + công nợ phải trả (ERP §4.4) · DUYỆT

- **Khớp 3 chiều** (PO ↔ phiếu nhận ↔ hoá đơn): **SL HĐ ≤ SL đã nhận** (CHẶN `HD_VUOT_NHAN`) · **lệch giá GHI không chặn** (`lech_don_gia`) ·
  **giá LÔ SỐNG đổi theo HĐ** (ERP §3.3.8: `gia_von_lo = don_gia_hd`, rồi `tinh_lai_gia_von_bq` — MỘT công thức, `gd_cap_nhat_ton` gọi lại) ·
  **đơn → `da_khop_hd`** khi HĐ phủ hết SL đã nhận VÀ mọi dòng nhận đủ đặt (xoá HĐ → lùi `da_nhan` qua GUC hệ thống).
- **Công nợ phải trả = Σ HĐ gồm VAT − Σ phiếu chi**, TÍNH bằng RPC `con_phai_tra` (KHÔNG bảng công nợ — cùng hình `con_phai_thu`).
  Phiếu chi gắn HĐ tuỳ chọn (chặn `CHI_VUOT_HD`); trống = **ứng trước** (nợ âm). Hạn TT mặc định **+30 ngày [GIẢ ĐỊNH]**.
- **VAT (QD-30):** đơn giá HĐ **chưa VAT** → giá vốn; tổng **gồm VAT** → công nợ + dòng tiền (KHỐI CHI `tra_ncc`). `bang_ke` ép VAT 0.
- **1 HĐ ↔ 1 đơn mua [v1]** (nhiều HĐ/đơn OK). ⚠ Lô hiện lưu theo **đơn vị DÒNG** (WP-21 chưa quy cơ sở — nợ WP-23) nên
  `gia_von_lo = don_gia_hd` trực tiếp, KHÔNG `quy_ve_co_so` (hàm đó quy SỐ LƯỢNG không quy GIÁ; quy giá về cơ sở sẽ lệch đơn vị lô).
- **Lý do:** ERP Sagegg&Alfnes §4.4 + giữ MỘT đường sổ (QD-03/44), Dòng tiền khép vòng (QD-40). Xoá mềm (`da_xoa_luc`), UNIQUE(ncc,so_hd).
- **Kiểm chứng:** `web/ops/test_hd_ncc.mjs` **23/0** (khớp/vượt/một phần/lệch giá→lô+bq/bảng kê/chi vượt/ứng âm/xoá hồi/đảo lô/dòng tiền/chặn sale) +
  perf @100k: `con_phai_tra` 627ms · `dong_tien_ky` 78ms · `hd_ncc_ghi` 98ms · `pc_ghi` 7ms + so_ba_nguon khớp + test_huy_phieu 21/0.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/135, DB+test; UI WP-22b sau). Nợ: WP-23 lô về đơn vị cơ sở (rồi mới quy giá) · UI màn khớp HĐ.

## QD-58 (23/08, WP-25, db/136) — Lô nhập QUY VỀ đơn vị cơ sở lúc nhận (nới QD-57) · DUYỆT

> Backfill: commit `fca0069` đã trỏ QD-58 nhưng chưa ghi vào sổ — bổ sung ở đây cho đủ một bản sự thật.

- **Nhận hàng quy về cơ sở:** `dm_nhan_hang` đổi `con_lai`/`gia_von_lo` của lô về **đơn vị cơ sở** qua `quy_ve_co_so`
  (khoá đơn-vị chuẩn hoá: `coalesce((select ma from don_vi where ma=dvt or ten=dvt), dvt)`). Lô lưu thêm **snapshot**
  `he_so_ap_dung` · `don_vi_nguon` · `so_luong_nguon` (đơn vị + lượng lúc NHẬP, trước quy đổi) để đảo/khớp về sau chính xác.
- **HĐ NCC theo cơ sở:** `hd_ncc_ghi` tính `gia_von_lo = đơn giá HĐ (chưa VAT) ÷ he_so_ap_dung` (xoá HĐ đảo lại × hệ số).
  Sửa nợ QD-57 (giá lô lúc đó gán thẳng `don_gia_hd` vì lô còn theo đơn vị dòng) — nay lô đã ở cơ sở nên chia hệ số.
- **Migrate:** backfill 196 lô cũ `he_so_ap_dung=1` — **0 lô đổi số** trên prod (toàn PO đặt bằng đơn vị base). FIFO/xuất/back-flush trừ theo cơ sở.
- **Lý do:** khép QD-53 (mỗi vật tư MỘT đơn vị cơ sở) tới tận LÔ + GIÁ VỐN — sổ giá vốn bình quân (`tinh_lai_gia_von_bq`) mới cùng đơn vị.
- **Kiểm chứng:** `web/ops/test_136.mjs` **16/0** (m²→tấm 0,336 · giá/tấm · snapshot · FIFO cơ sở · huỷ đảo · base hệ số 1 · đơn vị lạ RAISE) + so_ba_nguon khớp + hồi quy 119/huy/127/132/135 xanh.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/136, DB+test).

## QD-59 (23/08, WP-23, db/137) — Bảng giá NCC × vật tư: lead time + hạn thanh toán theo NCC + chuẩn hoá đơn vị dòng PO (ERP §4.3.4) · CHỐT

- **Bảng giá `gia_ncc(ncc × vật tư)`:** đơn giá **CHƯA VAT** (khớp QD-57) + `lead_time_ngay` **theo (NCC × vật tư)** — mở rộng từ sách
  (Sagegg&Alfnes §4.3.4 để lead ở item×facility) vì **mỗi NCC giao khác nhau**; lịch sử đổi giá append-only (`gia_ncc_lich_su`, hình db/134).
- **Hạn thanh toán trên NCC** (`nha_cung_cap.han_thanh_toan_ngay`, mặc định **30 ngày**): HĐ NCC mới `han_thanh_toan = ngày HĐ + hạn NCC` (nới mặc định +30 phẳng của QD-57).
- **Gợi ý giá dòng PO** (`goi_y_gia_dong_mua`): ưu tiên **bảng giá NCC** (`nguon='bang_gia_ncc'`) → rơi về **giá tham khảo vật tư** (`tham_khao`) → trống.
  Điền sẵn **sửa được, v1 KHÔNG khoá** (giá thật vẫn do người mua chốt).
- **Chuẩn hoá đơn vị dòng PO:** mỗi dòng đơn mua có `don_vi` (mặc định = `vat_tu.dvt`); **ép về danh mục đơn vị của vật tư** — đơn vị lạ **RAISE ngay ở `dm_tao`/`dm_sua_dong`**
  (trigger `dmd_kiem_dvt`, chặn từ khâu tạo PO thay vì tới lúc nhận). Khép QD-53 tới dòng đặt mua.
- **"Ngày cần" đầu đơn** gợi ý = **hôm nay + MAX lead** các dòng có lead (không dòng nào có lead → để mặc định); sửa tay thì thôi tự gợi ý.
- **Kiểm chứng:** `web/ops/test_gia_ncc.mjs` **15/0** (gợi ý bảng giá/tham khảo/trống · đơn vị lạ RAISE · hạn TT +hạn NCC · `vat_tu_thieu_lead_time` · `dm_tao`/`dm_sua_dong` nhận `don_vi`) + robot `kiem_don_mua.py` xanh (dropdown đơn vị + nhãn nguồn giá).
- **Trạng thái:** ĐÃ ÁP DỤNG (db/137, DB+test+UI app Kho). Nợ: v2 tuỳ chọn khoá giá theo bảng · cảnh báo lệch giá HĐ so bảng.

## QD-60 (23/08, WP-41+WP-42, db/139–142) — Planning method + mức tồn min/max (ERP §8.3 · §7.3.2 · §7.3.7) · CHỐT

- **Cột `pp_ke_hoach` phân loại phương pháp cung ứng (ERP §8.3):**
  - **Vật tư = `ton_toi_thieu`** (min/max, §7.3.2/§7.3.7): **khả dụng = tồn − giữ chỗ + PO đang về**; dưới `ton_toi_thieu`
    → **đặt lên `muc_dat_len_toi`** (so_dat = max − khả dụng; thiếu max → min − khả dụng + cờ `thieu_muc_max`);
    **trước ngày = ngày hết − lead** của **NCC giá tốt nhất còn hiệu lực** (ngày hết = hôm nay + khả dụng ÷ tốc độ xuất 30n).
  - **Món tự do / thiết kế cả căn = `theo_don`**: **1 đơn : 1 lệnh SX** (giữ QD-13), **KHÔNG MRP** — không đẻ cột ở đơn hàng.
  - **Hàng niêm yết = `theo_nhu_cau`**: nhãn trước, gom lô làm sau.
  - **Trưng bày chưa phân loại** (niem_yet không có cờ trưng bày → backfill toàn bộ `theo_nhu_cau`).
  - **Floor stock (QD-50) NẰM NGOÀI cảnh báo.**
- **Tái dùng cột `ton_toi_thieu` (db/001):** GIỮ **148 mức thật** ai đó đã đặt; **54 giá trị 0-do-default → NULL** trong db/139.
  Từ nay **NULL = chưa đặt mức**, **0 = tường minh không cần dự trữ**; **mã tạo mới default NULL** (bỏ default 0). CEO quyết 23/08.
- **3 nhóm cảnh báo** (`kho.canh_bao_dat_hang`, SecDef kho/ceo): `canh_bao` (dưới min, có lead) · `thieu_lead` (dưới min, NCC chưa có lead)
  · `chua_co_muc` (min NULL). Đường ghi: `dat_muc_ton` (đặt mức) · `tao_po_tu_canh_bao` (gom theo NCC, đối chiếu gia_ncc, bọc `dm_tao`).
- **Kiểm chứng:** `test_139` **13/0** · `test_140` **17/0** (100k < 500ms) · `test_141` **17/0** · `test_142` **6/0** (100k 119ms);
  robot app Kho tab "Cần đặt hàng" xanh (3 nhóm 0/30/54 số thật). Đơn vị mức theo `don_vi_co_so` (QD-53/58).
- **Trạng thái:** ĐÃ ÁP DỤNG (db/139–142, DB+test+UI). Nợ: cảnh báo `theo_don`/`theo_nhu_cau` (MRP theo đơn) để lô sau.

## QD-61 (23/08, WP-96) — Không có backup thì không migrate (MES §7.2.5) · CHỐT

- **`run_sql.mjs` tự `pg_dump -Fc` prod ra `~/togihome_backup/`** (NGOÀI repo) **TRƯỚC khi gửi SQL**. Backup fail = **CHẶN migrate**.
- **Chặn khi:** dump fail · thiếu `pg_dump` · client **lệch major** với server · đĩa **< 2 GiB**. In nguyên văn lỗi, exit ≠ 0, KHÔNG chạy SQL.
- **Giữ 20 bản xoay vòng**, chỉ xoá đúng mẫu `pre_*.dump` (không đụng file lạ). In đường dẫn · MB · giây trước khi chạy SQL.
- **Cửa hậu `BO_QUA_BACKUP=1`** (chỉ cho file scratch) — bắt buộc in **cảnh báo ĐỎ**.
- **[sửa 29/08] SIẾT cửa hậu từ db/177:** *"Từ db/177: CẤM cờ BO_QUA_BACKUP, trừ khi CEO tự gõ trong lệnh (CEO_BO_QUA=<lý do>). Không backup không migrate — QD-61, siết 29/08."* Migration ≥177 + `BO_QUA_BACKUP` mà KHÔNG có `CEO_BO_QUA=<lý do>` (rỗng không tính) → **THOÁT LỖI, không chạy**; có đủ → chạy + in cảnh báo + ghi lý do vào log. Migration ≤176 giữ nguyên. **Lý do:** cờ mở sẵn thì nó thành mặc định — người sau bật mà không ai biết (đã dính db/174/176 dùng cờ). Dump bù cho db/176: `pre_bu_176_…dump`.
- **Lý do:** dev = prod cùng MỘT Supabase project (01 §D) — migrate là áp thẳng prod; 142 migration **không có sổ, không bọc transaction**. MES §7.2.5 xếp "execution and **checking** of complete data security" là bảo trì DB bắt buộc: **backup chưa restore thử thì chưa tính là backup**.
- **Kiểm khôi phục (L-93):** restore vào Postgres.app 17 local, **cắn hai vế 5/5** — `giao_dich` 235 · `don_mua_dong` 18 · `su_kien_quet` 181 · **107 bảng** · **329 function** đều khớp prod. Phạm vi đã kiểm: schema `kho`. **CHƯA kiểm:** auth/storage/realtime.
- **Ngoài phạm vi:** tách dev/prod = WP riêng (đắt hơn nhiều bậc); `run_sql.mjs` bọc transaction + sổ migration = WP riêng; VACUUM DB phình 643MB do rác test = WP riêng.
- **Trạng thái:** ĐÃ ÁP DỤNG (sửa `web/ops/run_sql.mjs`; `.gitignore` chặn `*.dump`). Client dump = Postgres.app PG17 (server PG 17.6).

## QD-62 (24/08, WP-31 tầng ①, db/143) — Nhận BOM chi tiết từ plugin: hao theo DÒNG · ván giữ chỗ ngay · sổ chờ ghép mã · CHỐT

- **Hao hụt THEO DÒNG BOM thắng hao theo MÃ vật tư** (ERP §6.5.3 cho khai scrap trên từng dòng BOM). `_bf_tinh` đổi sang `coalesce(b.hao_hut_pct, v.hao_hut_pct, ván?10:0)`.
  **Lý do:** số tấm ván từ **nesting đã gồm phần cắt bỏ THẬT** — cộng thêm 10% (QD-54) là **tính hao HAI LẦN**. Dòng ván plugin mang `hao_hut_pct=0` → xuất đúng số tấm; dòng nhập tay/ước để NULL → vẫn ×(1+10%) rồi CEIL như QD-54 (GIỮ nguyên).
- **Ván đẩy đúng ĐƠN VỊ CƠ SỞ ('tam') giữ chỗ NGAY** — `ghi_bom_mon`/`_bom_ghi_dong`: `don_vi = don_vi_co_so → so_luong_co_so = so_luong, he_so=1` (không thành dòng chờ). ⇒ `ban_giao_xuong` sinh giữ chỗ > 0, WP-42 cảnh báo đúng.
- **Dòng chưa ghép mã kho** (vat_tu_id NULL + ma_plugin, vd PK-BL02) → **sổ `bom_cho_ghep`** (không nhét vào BOM vì BOM bắt buộc vat_tu_id; không bỏ đi để khỏi mất dấu). **KHÔNG raise, KHÔNG chặn dòng khác, KHÔNG chặn thợ** (QD-55). Ghép sau qua `ghep_dong_cho` (đi ĐÚNG đường `_bom_ghi_dong`, không INSERT tắt).
- **Lệch đơn vị** (plugin 'cai' vs kho 'tui', ốc cam/chốt gỗ): cutlist không có hệ số → `so_luong_co_so=NULL` dòng chờ hệ số (QD-55), **không đoán hệ số** — kho khai ở tab Đơn vị & hao hụt (WP-36).
- **Chữ ký `ghi_bom_mon(p_mon_id,p_nguon,p_dong)` GIỮ NGUYÊN** (thêm khoá tuỳ chọn `hao_hut_pct`+`ma_plugin` mỗi phần tử — không đẻ overload). Đẩy lại = DELETE-rồi-GHI cho CẢ BOM lẫn `bom_cho_ghep` (không cộng dồn). Món `moc='chuan'` → chặn `BOM_DA_CHOT` (QD-16).
- **Kiểm chứng:** `web/ops/test_bom_plugin.mjs` **21/0** (hao 0 vs NULL · ván giữ chỗ sau bàn giao · lệch đơn vị chờ hệ số · sổ chờ ghép · đẩy lại ghi đè · ghép · chặn chốt · vai NULL). RLS `bom_cho_ghep` đọc 5 vai, ghi chỉ qua RPC.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/143, DB+test). Chưa UI (tầng ②③④).

## QD-63 (24/08, WP-37 tầng 1, db/146) — Plugin vào được từ luồng BÁO GIÁ · CHỐT

- **Đơn ở `bao_gia` / `bao_gia_treo` HIỆN trong danh sách đơn của plugin** (`don_cho_thiet_ke` nới danh sách trạng thái + trả thêm cột `trang_thai`) **và nhận được đẩy BOM + giá vốn ở mốc `du_kien`**. Vai **`tk_ban_hang`** (thiết kế bán hàng — người dựng hình lúc báo giá) được đẩy (`don_cho_thiet_ke` · `ghi_bom_mon` · `ghi_gia_von_don` thêm `tk_ban_hang` vào guard vai).
- **Đẩy ở báo giá KHÔNG sinh giữ chỗ · KHÔNG đổi trạng thái đơn · KHÔNG phát tem.** Cửa vào chuyền vẫn CHỈ là `ban_giao_xuong` (QD-47/QD-52/QD-14 giữ nguyên). `bao_gia_thua` **KHÔNG mở** (đơn thua = bỏ, không dựng).
- **GÁC MỚI** (chỗ dễ lọt): trigger `chan_bom_chuan_bao_gia` chặn `don_hang_mon_bom.moc='chuan'` khi đơn còn ở `bao_gia*` → BOM lúc báo giá **chỉ** `du_kien` (RAISE nếu ép 'chuan'). An toàn với `ban_giao_xuong` vì nó đặt `trang_thai='cho_cat'` (db/140:162) TRƯỚC khi promote BOM→chuan (db/140:181).
- **Giá vốn giữ MỘT dòng ghi đè — KHÔNG thêm cột `moc`.** Mốc `du_kien`/`chuan` đo ở **BOM + số đơn vị** (đã có cột `moc`+`chot_luc`+promote qua `ban_giao_xuong`). **Lý do không thêm mốc cho giá vốn:** 3 RPC tài chính đã LOẠI `bao_gia*` tại nguồn (`pl_ky`/`cm_don_ky` chỉ `trang_thai='da_giao'`; `gia_von_don_ds` db/120:13,25 `not in ('bao_gia','bao_gia_thua','bao_gia_treo','huy')`) → số giá vốn báo giá KHÔNG lọt tài chính trước khi chốt; thêm cột phải đổi PK `ma_don`→(`ma_don`,`moc`) + đụng ~25 hàm, lợi ích 0.
- **Số đơn vị 12-driver plugin đẩy (`ghi_san_luong_don` → `san_luong_don`) là SỐ LÀM VIỆC, KHÔNG có cột `moc` — bị GHI ĐÈ khi đẩy lại lúc thiết kế** (on conflict `ma_don` do update). **KHÔNG thêm cột `moc`.** Chỉ **BOM** (`don_hang_mon_bom`) giữ 2 mốc `du_kien`/`chuan` (promote ở `ban_giao_xuong`). Lý do: QD-15 cần 2 mốc để đo **chênh báo giá** — mà chênh đó đo ở BOM (vật tư/tấm ván) là đủ; số đơn vị per-hoạt-động (`so_don_vi_mon`) đã được **QD-16 chốt cứng tại `ban_giao_xuong`** (đóng băng số+phút+đơn giá), không cần mốc thứ hai cho bảng driver-tổng. (db/147 · WP-37 tầng 1b)
- **Cơ sở:** ERP 5.5.1 (báo giá = đơn chưa xác nhận, dùng chung chứng từ) · ERP ch.6 tr.131 (hàm "estimate" tính pre-calculation cost ở trạng thái *created*, TRƯỚC *release* — tính trước ≠ phát lệnh) · QD-15 (chênh `du_kien→chuan` = rủi ro báo giá, chỉ đo được nếu số sinh TỪ lúc báo giá). `luu_so_don_vi` KHÔNG nới vai (plugin không gọi — chỉ app Thiết kế web dùng).
- **Kiểm chứng:** `web/ops/test_146.mjs` (11 ca hai vế + đường dài promote). Dữ liệu DEMO-, xoá sạch.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/146, DB+test). Chưa UI (plugin nới trạng thái hiển thị — tầng sau).

## QD-64 (25/08, WP-06 tầng 1, db/148) — MỘT đường ghi trạng thái đơn: 2 RPC là CỬA, 3 trigger là KHOÁ · CHỐT

- **Vấn đề (L-06a):** client Sale UPDATE THẲNG `don_hang.trang_thai` qua PostgREST — grant-theo-cột (db/131) gồm cột
  `trang_thai` + RLS `dh_sua` cho **7 vai** (ceo/kho/sale/thiet_ke/xuong/ke_toan/tk_ban_hang). CHỈ app Sale ghi thẳng
  (`from('don_hang').upsert`, payload LUÔN kèm `trang_thai:toDB(d.tt)`); các app khác đổi qua RPC. Đường TRẦN — lỗ db/047 từng vá tay.
- **Quyết:** MỌI lần ghi trạng thái của Sale qua **HAI RPC, không hơn** (db/148):
  - `chot_don(p_don_id, p_nguon_khach, p_thuong_hieu)`: **bao_gia|bao_gia_treo → moi_len_don**.
  - `doi_trang_thai_don(p_don_id, p_trang_thai_moi, p_ly_do)`: whitelist **{bao_gia, bao_gia_thua, bao_gia_treo, tam_ngung, huy}**
    (lấy đúng tập từ menu Sale — `src/sale.js` + `public/togihome_sale.html`).
  - Cả hai **CHẶN CỨNG cho_cat + mọi trạng thái SX** (da_cat/dang_lam/xong_sx/cho_giao/da_giao) — vào SX chỉ qua
    `ban_giao_xuong` (QD-47); moi_len_don chỉ qua chot_don.
- **RPC là CỬA, trigger là KHOÁ:** KHÔNG viết lại / tắt / bypass GUC 3 trigger (`trg_chan_chuyen_vai` gác VAI · `trg_kiem_chuyen_trang_thai`
  ép nguồn+thương hiệu+món-giá · `trg_chan_lui_sx` db/047). RPC chỉ trả lỗi trigger **NGUYÊN VĂN** lên UI, không chép lại luật.
  `p_ly_do` bắt buộc khi đích tam_ngung/huy; đặt `moc.ly_do_lui` (đúng cách db/047) khi là đường lùi — KHÔNG set `chan.off_vai`/`chan.tu_mon`.
- **Cơ sở:** ERP 3.4.1 (một đường ghi trạng thái, kiểm quyền tập trung) · QD-03 (RPC curated thay ghi thẳng bảng) · QD-47 (trạng thái đổi qua cổng nghiệp vụ).
- **4 tầng:** L-06b DB (đây) → L-06c UI Sale bỏ `trang_thai` khỏi payload + deploy → **L-06d REVOKE** quyền UPDATE cột client + test hai vế → L-06e robot live.
  **REVOKE Ở L-06d, KHÔNG ở đây:** PostgREST kiểm quyền theo CỘT CÓ TRONG PAYLOAD (không theo giá trị có đổi) → revoke trước khi UI bỏ field = mọi lưu đơn Sale prod hỏng **403**.
- **Kiểm chứng:** `web/ops/test_148.mjs` (13 ca hai vế + dọn). Dữ liệu DEMO-, rollback sạch, KHÔNG chạm T8-001.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/148, DB+test). Chưa UI/REVOKE (tầng L-06c/d).

## QD-65 (25/08, WP-06 tầng 2a, db/149) — "Đã giao" do Sale bấm QUA CỔNG, chỉ từ cho_giao · CHỐT

- **Nền (L-06c bước 1):** rà 4 trạng thái db/148 chặn — `cho_cat`/`cho_giao`/`nhan_thiet_ke` đều có đường khác
  (ban_giao_xuong · auto-sync khi mọi món xong_sx · nhan_viec_thiet_ke). Riêng **`da_giao` là đường DUY NHẤT qua
  Sale** — không RPC/trigger/app nào khác SET được (`update don_hang set trang_thai='da_giao'` = KHÔNG có trong DB;
  cm_don_ky/pl_ky/lap_day_ky chỉ `WHERE trang_thai='da_giao'`). "Ai đánh dấu đã giao" là quyết nghiệp vụ.
- **CEO uỷ quyền tôi quyết (25/08) → hướng A:** giữ Sale bấm "Đã giao", nhưng **đi qua `doi_trang_thai_don`** (không
  upsert thẳng trang_thai nữa — L-06c). db/149 nới `doi_trang_thai_don` nhận `da_giao`: vai **sale/ke_toan/ceo**,
  **CHỈ từ `cho_giao`** (mọi nguồn khác → lỗi rõ). **da_giao là MỐC CHỐT DOANH THU → cấm nhảy tắt** (bao_gia/cho_cat → da_giao chặn).
  KHÔNG đòi p_ly_do (việc thường ngày). 3 trạng thái db/148 còn lại (cho_cat/cho_giao/nhan_thiet_ke) **GIỮ NGUYÊN chặn**.
- **Dấu vết:** KHÔNG dựng bảng audit mới — dùng trigger có sẵn `trg_ghi_nk_don` (AFTER UPDATE OF trang_thai) tự ghi
  `don_hang_nhat_ky(don_id, tu, den, nguoi_id, luc)`. SELECT "ai bấm, lúc nào":
  `select nk.den, nd.ho_ten, nk.luc from kho.don_hang_nhat_ky nk join kho.don_hang d on d.id=nk.don_id left join kho.nguoi_dung nd on nd.id=nk.nguoi_id where d.ma_don=$1 and nk.den='da_giao' order by nk.luc desc limit 1`.
- **Cơ sở:** QD-47 (trạng thái qua cổng) · QD-64 (một đường ghi) · ERP 5.6 (giao hàng = mốc ghi nhận doanh thu, kiểm soát chặt).
- **PHÁT SINH (WP riêng):** hướng dài hạn là **đội giao hàng tự đánh dấu** (app/vai giao hàng gọi RPC riêng), không để Sale.
  Đảo hướng = thêm 1 RPC `danh_dau_da_giao` cho vai giao hàng + bỏ 1 nút "Đã giao" ở Sale — nhỏ, làm khi có app giao hàng.
- **Kiểm chứng:** `web/ops/test_149.mjs` (8 ca hai vế + dọn). DEMO-, rollback sạch, KHÔNG chạm T8-001.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/149, DB+test). Chưa UI (L-06c) / REVOKE (L-06d).

## QD-66 (25/08, WP-06 tầng 4, db/150) — ĐÓNG đường ghi trang_thai từ client · CHỐT

- **Vấn đề đo được (L-06c3):** với JWT sale, `PATCH /don_hang {"trang_thai":"da_giao"}` trả **HTTP 200** — client
  đổi thẳng trạng thái, nhảy tắt bỏ cổng. Nguyên nhân: quyền UPDATE là **TABLE-LEVEL** (`relacl authenticated=arw`),
  trùm mọi cột (không phải column-grant như L-06a tưởng).
- **Quyết (db/150):** **REVOKE UPDATE table-level** rồi **GRANT UPDATE lại trên 69 cột = mọi cột TRỪ `trang_thai`**
  (sinh động từ information_schema). Giữ INSERT (đơn mới vẫn tạo kèm trang_thai — trigger kiem_chuyen gác). KHÔNG đụng
  RLS / trigger / db/148·149. RPC SECURITY DEFINER chạy bằng owner → không ảnh hưởng.
- **MỌI chuyển trạng thái nay đi qua CỬA:** `chot_don` (→moi_len_don) · `doi_trang_thai_don` (bao_gia\*/tam_ngung/huy/da_giao) ·
  `ban_giao_xuong` (→cho_cat) · `nhan_viec_thiet_ke` (→nhan_thiet_ke) · trigger auto-sync `dong_bo_trang_thai_don` (→cho_giao khi món xong_sx).
- **BẰNG CHỨNG trước/sau (JWT test_sale, cùng đơn):**
  | phép | TRƯỚC (L-06c3) | SAU (L-06d) |
  |---|---|---|
  | `chot_don` (RPC) | 200 | **200** (cổng vẫn chạy) |
  | `PATCH trang_thai=da_giao` | **200** (lỗ) | **403** `permission denied 42501` (ĐÓNG) |
  | `PATCH ghi_chu` (cột thường) | 200 | **204** (app không hỏng) |
- **Cơ sở:** QD-64 (một đường ghi) · QD-47 (cổng nghiệp vụ) · nguyên tắc least-privilege (client chỉ ghi cột dữ liệu, không ghi trạng thái).
- **HOÀN TÁC:** `GRANT UPDATE ON kho.don_hang TO authenticated;` (khôi phục table-level UPDATE).
- **Test đổi theo (KHÔNG nới quyền):** test dùng `as(vai) update trang_thai` nay 403 → chuyển sang gọi RPC (chốt/huỷ) hoặc owner+`chan.off_vai`
  (setup forward). Đã vá test_090, test_115 (đỏ-thật do revoke) + gỡ 403 test_035/047/056/109/111/123. test_069 (test upsert-clobber cũ) cần rework riêng.
- **Trạng thái:** ĐÃ ÁP DỤNG (db/150, prod). UI đã deploy (edf983b0) bỏ trang_thai khỏi upsert nên revoke an toàn thứ tự.

## QD-67 (26/08, WP-07 tầng 1, db/151) — MỘT cửa TẠO đơn: `tao_don` ép khởi tạo `bao_gia` · CHỐT
- **Vấn đề:** sau WP-06 đóng đường ĐỔI trạng thái (QD-64/65/66), đường TẠO đơn vẫn hở — client `sale.js`
  INSERT `don_hang` KÈM `trang_thai` (`bao_gia` hoặc thẳng `moi_len_don`), tự chọn trạng thái khởi tạo.
- **Cơ sở sách (ERP Sagegg & Alfnes):** 5.5.1 báo giá = đơn CHƯA validate; khách nhận → CHUYỂN thành order,
  KHÔNG tạo mới ở trạng thái order · 5.3.3 trạng thái là thứ HỆ ghi theo mức đã đi trong quy trình bán, không
  phải thứ người nhập tự chọn. → **mọi đơn khởi tạo ở `bao_gia`; client KHÔNG gửi `trang_thai`.**
- **Quyết (db/151):** RPC `kho.tao_don(p_don jsonb, p_chot boolean)` SECURITY DEFINER, GRANT sale/ceo (theo
  `current_vai_tro()`→auth_uid). Thân: INSERT `don_hang` với `trang_thai := 'bao_gia'` HARD-CODE; nhận đúng
  bộ trường `donToRow` TRỪ `trang_thai`; `nguoi_tao` server gán `current_ns()`. Gác `ma_don` thiếu/trùng, lỗi
  rõ chữ. Nếu `p_chot=true` → gọi tiếp CỔNG `chot_don` (db/148) **cùng transaction** → `moi_len_don`; chot_don
  RAISE thì exception nổi ra, INSERT rollback theo (không đơn cụt). Hàm **CẤM UPDATE trang_thai** (không đẻ
  đường ghi thứ hai).
- **"+ Lên đơn" nay = `tao_don(p_chot=true)`** — đường vào `moi_len_don` vẫn CHỈ một cổng (QD-47/QD-64), vẫn bị
  `trg_kiem_chuyen_trang_thai` ép `nguon_khach` + `thuong_hieu`. Đơn 0 món qua được cổng món-giá (vacuous: không
  món giá≤0), món thêm sau như luồng client hiện tại.
- **Chữ ký:** `kho.tao_don(p_don jsonb, p_chot boolean default false) → table(id uuid, ma_don text, trang_thai text)`.
- **Thứ tự (như WP-06 L-06c→d):** UI chuyển sang gọi `tao_don` ở **L-133**; **REVOKE INSERT cột `trang_thai`** ở
  **L-134** (sau UI). Lệnh này CHỈ DB+test, KHÔNG sửa sale.js, KHÔNG revoke, KHÔNG deploy.
- **Test:** `web/ops/test_wp07.mjs` 6/0 — a) chot=false→bao_gia · b) chot=true→moi_len_don + nhật ký người chốt +
  nguoi_tao server · c) chot=true thiếu nguồn→RAISE + rollback sạch (0 đơn cụt) · d) vai xuong→CHẶN.
- **Cơ sở:** ERP 5.5.1/5.3.3 + WP-06 một cổng (QD-64). **HOÀN TÁC:** `drop function kho.tao_don(jsonb, boolean);`
- **Trạng thái:** ĐÃ ÁP DỤNG (db/151, DB+test). Chưa UI (L-133) / REVOKE INSERT (L-134).

## QD-68 (26/08, WP-47 tầng DB, db/154) — LỊCH: NGUỒN/SUY · CHỐT
- **`nang_luc_to` + `moc_lich` = bảng NGUỒN** người nhập qua RPC (`nl_ghi` quản-đốc(xuong)/ceo · `moc_lich_ghi`
  ceo). **`xep_lich` = bảng SUY** — client KHÔNG ghi được (RLS chỉ policy SELECT; ghi chỉ qua `luu_xep_lich`/
  `tl_doi_viec` SECURITY DEFINER).
- **Sửa năng lực = MỞ KHOẢNG hiệu lực mới, không đè:** `nl_ghi` đóng khoảng đang mở (`den_ngay = p_tu_ngay−1`)
  rồi mở khoảng mới (`den_ngay` NULL, `xac_nhan=true`). Khoảng ngày CHÍNH LÀ lịch sử — số cũ giữ nguyên cho lịch
  cũ đã tính. `p_tu_ngay < CURRENT_DATE` → RAISE (cấm sửa ngược quá khứ). EXCLUDE gist chặn chồng khoảng.
- **Nghỉ lễ/Tết = khoảng có `ngay_moi_tuan = 0`** (hợp lệ), không phải bảng ngày-lễ riêng. `moc_lich` = BỀ RỘNG
  (số tuần) vùng đóng-băng cuộn theo tuần hiện tại (QD trước: chỉ `vung_cua_tuan` đọc), KHÔNG phải ngày lễ.
- **FORCE RLS — KHÔNG force:** hàm ghi/đọc là DEFINER owner=postgres → chủ bỏ qua RLS khi không force → client
  chỉ SELECT. (Ghi chú: owner `postgres` có `BYPASSRLS`=true nên thực tế bỏ qua RLS *kể cả* force — bẫy "FORCE
  giết luu_xep_lich" KHÔNG xảy ra ở DB này; ta vẫn chọn KHÔNG force = belt-and-suspenders, không phụ thuộc
  BYPASSRLS. chứng minh: test_wp47 4.7 owner ghi được khi RLS bật.)
- **Vai nhập năng lực = `xuong` (quản đốc) + ceo** (không có role 'quan_doc' trong CHECK vai_tro; quản đốc là
  vai `xuong` theo db/043 — đầu bài viết "quan_doc" = `xuong`).
- **Không FORCE RLS** — owner (postgres) có `BYPASSRLS` nên RLS ở đây **là tường chắn phía CLIENT** (authenticated
  chỉ SELECT), không phải tường chắn phía hàm DEFINER (chúng chạy bằng owner, luôn ghi được).
- **Cơ sở sách:** ERP 7.2 (capacity calendar = master data) · ERP 7.3.3 (time fence do doanh nghiệp đặt, trong
  fence máy không tự xếp lại) · MES 5.4.4 ("shift models are entered manually, the algorithm determines the
  rest") · QTSX ch.6 vd 6.4 (năng lực = số cho trước, tải = số tính ra).
- **Nghỉ lễ CHẠY sẵn (test 4.8):** khoảng `ngay_moi_tuan=0` → `nang_luc_to_tuan` trả `gio_nen=0` cho tuần đó
  (không phải null/thiếu). `_sched` thấy cap=0 → đẩy việc sang tuần kế (available≤0 → `w:=w+7`). Không cần sửa
  `_sched`, không nợ — khai nghỉ bằng khoảng ngay_moi_tuan=0 là đủ để máy né tuần nghỉ.
- **XÁC NHẬN năng lực đi bằng `nl_xac_nhan(p_ma_to)` (db/155), KHÔNG tách khoảng** — chỉ set `xac_nhan=true`
  trên khoảng ĐANG MỞ (xoá chip "chưa xác nhận"), không đóng/mở khoảng, không đụng số, không đẻ dòng lịch sử
  giả. Bấm hai lần vô hại. `nl_ghi` (tách khoảng, mở khoảng mới) **chỉ dùng khi SỐ THẬT ở xưởng đổi** — xác nhận
  ≠ sự kiện đổi năng lực. (Vá lỗ L-04 A1: nút "Lưu năng lực mới" đòi có tổ đổi số nên không xác-nhận-không-đổi
  được.) Vai xuong/ceo; test_wp47 5.1-5.4.
- **HOÀN TÁC:** xem đầu db/154 + `drop function kho.nl_xac_nhan(text)` (db/155). **Trạng thái:** ĐÃ ÁP DỤNG
  (db/154+155, DB+test). UI Năng lực tổ đã dựng (L-03, app Xưởng); **nút xác nhận (nl_xac_nhan) chưa nối vào UI**.

## QD-69 (27/08, WP-43) — VIỆC THẬT THẮNG SỐ SUY · CHỐT

- **Nguyên tắc:** Bàn giao, quét, và mọi **sự kiện có thật ngoài đời** KHÔNG BAO GIỜ bị lịch — hay bất kỳ **số suy**
  nào — chặn. Số suy hỏng thì **gắn cờ + dải cảnh báo KHÔNG nút tắt**, KHÔNG nuốt im, KHÔNG chặn việc thật.
- **Họ QD-55** (thiếu hệ số không chặn thợ — cấu hình thiếu ghi nợ, xử sau, không dừng sản xuất). Cùng tinh thần:
  dữ liệu/số suy khuyết → nợ hiện mặt, việc thật đi tiếp.
- **Chạy thật ở WP-43 đường 1:** việc 6 trong `ban_giao_xuong` (tự gọi `_sched` ghi `xep_lich`) bọc
  `BEGIN…EXCEPTION WHEN OTHERS` → xếp lịch hỏng thì NUỐT lỗi, **5 việc trước VẪN LƯU**, đơn vẫn vào `cho_cat`.
  Xếp không được → cột `chua_xep_duoc` + `ly_do_chua_xep` (lý do thật) + **dải ĐỎ ở màn Tải & lịch không có nút
  tắt** (`tl_don_chua_xep`). "Nuốt lỗi" ở đây = không chặn việc thật, KHÔNG PHẢI giấu — cờ + dải đỏ phơi ra.
- **Phân biệt với QD-68:** QD-68 nói `xep_lich` là bảng SUY (client không ghi). QD-69 nói THÊM: khi số suy đó
  tính hỏng, nó không được phép kéo việc thật (bàn giao) hỏng theo.
- **Cơ sở sách:** MES 5.4.4 (thao tác thật do người/máy trạm quyết, thuật toán chỉ lấp phần còn lại) · ERP 7.3
  (fence/lịch là số kế hoạch, không phủ quyết sự kiện thực thi).
- **Trạng thái:** ĐÃ CHẠY (db/156-159, v-kho-128; `test_wp43` 6.2/7.3 chứng minh bàn giao thành công khi xếp
  hỏng, cờ bật, lịch để trống).

## QD-70 (28/08, WP-46a tiền đề WP-46, db/165) — HAI NÚT: loai do NGƯỜI khai, bỏ đoán chẵn/lẻ · CHỐT

- **Phát sinh từ L-31.** Đo luồng quét thật cho thấy `sq_ghi` tự đoán vào/ra bằng `case (số vao − số ra) > 0
  then 'ra'`: cú **quét thứ 2 cùng trạm ÂM THẦM thành 'ra'** — thợ tưởng nhận lại, máy lại đánh dấu XONG. Máy
  đoán hộ ý người → sai không thấy được.
- **CEO chốt HAI NÚT.** loai (`vao`|`ra`) do **người khai**, không do máy đếm. `sq_ghi` bỏ hẳn nhánh đoán; thiếu/lạ
  loai → **RAISE** (lỗi lập trình phải nổ, không default). Hai luật: (a) 'vao' khi đang giữ 'vao' chưa đóng ở CHÍNH
  trạm → RAISE "đang giữ việc này rồi"; (b) 'ra' khi chưa 'vao' → RAISE "chưa nhận việc". Cổng tiền đề `buoc_truoc`
  (QD-01) GIỮ NGUYÊN. Giữ việc dở ở trạm khác rồi 'vao' trạm mới → **CHO PHÉP + cảnh báo trong jsonb** (QD-69, việc
  thật thắng — thợ có thể làm 2 món cùng lúc thật).
- **KHÔNG tự đóng việc treo.** `viec_dang_giu(p_ma_ns)` chỉ **HIỆN** việc đang giữ (tem·món·bước·trạm·người·giữ bao
  lâu), không truyền = cả xưởng (quản đốc), có = riêng người (trạm quét). Tự đóng sau X giờ = quay lại đúng bệnh
  chẵn/lẻ, chỉ tinh vi hơn — CẤM. Người xử, không phải máy.
- **Giờ thật thu NGAY.** Ghi 'ra' → lưu `su_kien_quet.so_phut` (phút cặp vào-ra). Chỉ LƯU, chưa dùng chỉnh gì. Lý
  do: không thu lúc nó xảy ra thì sau không dựng lại được (MES 5.4.2 để việc sau).
- **Hệ quả UI (CHƯA deploy):** `tram_quet`/`quet_tem` thêm tham số `p_loai` (mặc định `'vao'` = nút "Nhận việc") để
  chữ ký RPC vẫn khớp lời gọi web 4 tham số hiện tại. Nút "Xong việc" (`'ra'`) chờ UI WP-46. Nghĩa là sau db/165,
  nút quét đơn hiện CHỈ ghi 'vao'; quét lần 2 cùng trạm → "đang giữ việc này rồi" (đúng ý, hết âm thầm 'ra').
- **Cơ sở sách:** MES 5.4.2 (thu dữ liệu thực thi tại nguồn, đúng lúc) · MES 5.4.4 + QD-69 (thao tác thật do người
  quyết) · QD-01 (đồ thị buoc_truoc).
- **Trạng thái:** ĐÃ CHẠY prod (db/165, backup pre-migrate; `test_wp46a` 9/0; hồi quy wp43·44·45·47 = 26·15·11·28,
  TỔNG 89/0). CHƯA commit, CHƯA tag, CHƯA deploy UI.

## QD-71 (28/08, WP-08, db/169→173) — ĐỒ THỊ QUY TRÌNH CÓ PHIÊN BẢN; MÓN NEO PHIÊN BẢN LÚC BÀN GIAO · CHỐT

Đồ thị quy trình có phiên bản; món neo phiên bản lúc bàn giao.

- `quy_trinh_buoc` thêm `phien_ban`, khoá `(ma_quy_trinh, phien_ban, thu_tu)`; bảng `quy_trinh_phien_ban` vừa là
  bản phát hành vừa là lịch sử; mỗi mẫu đúng một bản `hien_hanh`.
- `don_hang_mon.quy_trinh_phien_ban` = điểm neo, `ban_giao_xuong` ghi bản `hien_hanh` lúc chốt (cùng mốc chốt BOM
  du_kien→chuan của QD-16). Món chưa bàn giao đọc bản `hien_hanh`.
- Mọi hàm chạy theo món đọc bước qua `buoc_cua_mon(mon_id)`; cấm hàm theo-món tự SELECT `quy_trinh_buoc` (một
  nguồn suy).
- Sửa mẫu ĐANG có món neo = phát hành bản mới (copy-on-write, giữ nguyên `thu_tu` vì `buoc_truoc[]` trỏ `thu_tu`),
  bản cũ chuyển `'cu'` và còn đọc được; mẫu chưa ai chạy thì sửa tại chỗ. Lý do sửa bắt buộc khi có món neo.
- Kéo đơn đang chạy sang bản mới chỉ qua `qt_doi_phien_ban_mon`, bắt buộc lý do, chặn món đã giao, ghi sổ
  append-only `mon_doi_phien_ban`.
- `quy_trinh_buoc` + `quy_trinh_phien_ban`: `authenticated` chỉ SELECT, chỉ RPC DEFINER ghi.

**LÝ DO:** MES 4.2.5 buộc lưu trữ mọi phiên bản cũ và giữ chúng đọc được (truy vết, và sản xuất lại theo bản cũ).
ERP (Sagegg & Alfnes) 6.5.5: thay đổi kỹ thuật mặc định áp cho đơn MỚI, đơn đang chạy giữ bản cũ; kéo đơn đang
chạy sang bản mới là hành động tường minh có lý do, không phải tác dụng phụ. Trước WP-08, sửa mẫu đổi ngay đường đi
của mọi đơn đang chạy kể cả đã bàn giao — thợ đang làm giữa chừng thì bước nhảy dưới chân.

- **Trạng thái:** ĐÃ CHẠY prod (db/169-173, backup pre-migrate; `test_wp08` 24/0; hồi quy bảy bộ + WP-46 = 126/2,
  2 đỏ là ô nhiễm chéo nhóm sale khi chạy tuần tự — 5 file đó pass đơn lẻ 89/0, không đụng WP-08). UI tab Quy trình
  app sanpham đã deploy + CEO kiểm mắt 4 ảnh + bấm nút thật (TU-BEP sửa tại chỗ, phiên bản không tăng; đổi tên;
  hoàn nguyên). PHÁT SINH: (a) nút kéo đơn sang bản mới chưa lên UI; (b) `quy_trinh_cua_mon` còn lưới
  `min(phien_ban)` — gỡ khi chắc mọi mẫu đều có dòng `hien_hanh`.

## QD-72 (29/08, WP-75 L-1, db/174) — MỐC BÀN GIAO (TRỤC 2) · LỊCH THU THEO ĐỢT · CỬA CỌC DỰ ÁN · CHỐT

Ba việc quanh mốc bàn giao / dòng tiền, một migration (siết ràng buộc):

- **Mốc bàn giao là TRỤC THỨ HAI cạnh 15 trạng thái** (ERP 5.3.3, hai trục). `don_hang.moc_ban_giao`
  (`chua_giao`→`da_giao_chua_lap`→`da_lap_xong`) + `moc_dat_luc`/`moc_nguoi`. Client KHÔNG ghi được (cột mới =
  0 grant, db/150 vẫn 69 cột). Chỉ TIẾN 1 nấc, LÙI chỉ CEO + lý do (`dat_moc_ban_giao`). Vào `da_giao_chua_lap`
  TỰ ĐỘNG khi đơn sang `da_giao` (nhánh có sẵn của `doi_trang_thai_don`, không mở đường ghi thứ hai). Backfill lịch
  sử: `trang_thai='da_giao'` → `da_giao_chua_lap`; còn lại `chua_giao` (đây là suy đoán lịch sử — số dòng: 1 đơn
  → `chua_giao` 1, `da_giao_chua_lap` 0 tại thời điểm migrate).
- **Lịch thu theo ĐỢT sửa bằng TÁCH KHOẢNG + lý do, cấm ghi đè** (khuôn QD-68). `lich_thu(don_hang_id, so_dot, moc,
  ty_le, ngay_han, hieu_luc_tu/den, ly_do)`. Σ tỷ lệ đợt đang hiệu lực = 100 (constraint trigger DEFERRABLE — kiểm
  cuối transaction). `lt_ghi` đóng khoảng cũ rồi chèn bộ mới; đơn đã chốt thiếu lý do → RAISE. `lt_sinh_mac_dinh`
  (gọi từ `chot_don`): dự án 30/40/30 theo mốc chốt/đã-giao/lắp-xong, lẻ+combo 1 đợt 100% mốc đã-giao. Client chỉ
  SELECT; ghi qua RPC DEFINER. `lich_thu_den_han` lấy "đã thu" QUA CÙNG định nghĩa với `con_phai_thu` (VIEW
  `v_tien_da_thu` — cấm chép công thức, bài học 03 §C).
- **Cọc chặn bàn giao (dự án)** vì cọc là TIỀN THẬT (`phieu_thu` loai='coc'), không phải số suy → không vênh QD-69.
  Ngưỡng `tham_so_tai_chinh.coc_toi_thieu_du_an_pct` (=30, không hardcode). Thiếu cọc → RAISE nêu cần/đã/thiếu.
  Cửa vượt CHỈ CEO + lý do, ghi vết 3 cột (`vuot_coc_boi/luc/ly_do`). Đơn lẻ không gác.
- **Khách ứng trước là khoản PHẢI TRẢ** — bóc tách trong khối thu, KHÔNG cộng thêm vào doanh thu (Garrison ch.14
  Exhibit 14-2 + cấm đếm đôi họ QD-56). **Vế này L-3 mới code** — QD ghi trước để L-3 khỏi trôi.

**LÝ DO:** ERP 5.3.3 tách trục thực thi (15 trạng thái sản xuất) khỏi trục giao-nhận-lắp (mốc bàn giao) — một đơn
"đã giao" nhưng "chưa lắp" là trạng thái tiền-doanh-thu có thật, cần trục riêng chứ không nhồi vào 15 trạng thái.
QD-68 (đợt = tách khoảng + lý do) áp cho lịch thu để mọi thay đổi điều khoản thanh toán có vết, không ghi đè. Cọc là
tiền thật nên chặn được ở cổng bàn giao mà không mâu thuẫn QD-69 (việc thật thắng số suy) — vì nó KHÔNG phải số suy.

- **Lịch thu ĐỌC qua RPC theo đơn** (`lich_thu_cua_don`) — client KHÔNG nhân tỷ lệ × giá chốt (04 §A); vá lỗ L-1 (chỉ có ghi `lt_ghi` + lọc `lich_thu_den_han`, thiếu đường đọc cả bộ đợt của một đơn cho thẻ đơn).
- **[L-3] Khách ứng trước (Garrison ch.14 + QD-56):** khối THU của `dong_tien_ky` bóc **2 lát con** — "Thu của đơn đã giao" vs "Khách ứng trước" — là **LÁT CẮT** của cùng tổng (KHÔNG cộng thêm khối; `tong = da_giao + ung_truoc`). **Định nghĩa "đã giao" = `don_hang.moc_ban_giao <> 'chua_giao'`** (KHÔNG dùng `trang_thai='da_giao'`) — vì moc_ban_giao là trục GIAO-NHẬN chính xác (ERP 5.3.3), doanh thu ghi nhận khi GIAO HÀNG; `trang_thai='da_giao'` chỉ là trạng thái SX, và mọi đơn `da_giao` đã tự set `moc_ban_giao≠chua_giao` nên moc bao trùm + chính xác hơn. Bảng "Số dư khách ứng trước" khép vòng theo mốc giao (`moc_dat_luc`): đầu + nhận thêm − kết chuyển = còn giữ. Lọc demo qua `p_gom_demo` (mặc định false — màn BÁO CÁO, khác màn đòi tiền L-2a). Tests a/b/c 7/0.
- **[L-2] điều chỉnh ngoài db/174 gốc L-1:** `lich_thu_den_han` (a) guard nới `ceo|ke_toan` → thêm `sale` (màn đòi tiền App Sale — chỉ ĐỌC); (b) enrich 4 trường `khach/so_dot_tong/ngay_dat_moc/tuoi` cho cột tab; (c) **lọc demo qua `p_gom_demo boolean DEFAULT false`** (khuôn QD-46) — mặc định ẨN demo (dòng demo lọt danh sách đòi tiền = gọi nhầm khách), `true` mới hiện.
- **[L-6] gộp phép bóc** vào MỘT pass tính khối thu (`with p as materialized`) — 1 lần quét `phieu_thu⋈don_hang` thay 2. Số dư ứng trước (quét thứ 3 theo `moc_dat_luc`) giữ nguyên.
- **[L-8] LUẬT ĐO sửa (CEO chốt 29/08):** RPC đọc **chứng từ** (`don_hang`, `phieu_thu`…) đo ở **30.000** (~3 năm thật), KHÔNG 100k; chỉ bảng **SỔ** đo 100k. 100k chứng từ = hàng chục năm → làm cả họ RPC tài chính đỏ giả. `test_117` sửa về 30k → **24/0** (#8 `nhan_xet_ky` 1555ms<3000). Ghi vào `CLAUDE.md` + `00_LUAT_LAM_VIEC.md`.

**5 GIẢ ĐỊNH (CEO duyệt 29/08):**

| # | Giả định | Vì sao | Gỡ khi nào |
|---|---|---|---|
| 1 | Cọc dự án tối thiểu **30%** | `tham_so_tai_chinh.coc_toi_thieu_du_an_pct`, CEO chỉnh được | CEO chốt số khác → sửa tham số, không sửa code |
| 2 | Mẫu đợt dự án **30/40/30** (lẻ/combo 1 đợt 100%) | `lt_sinh_mac_dinh` mặc định | CEO chốt tỷ lệ khác → sửa `lt_sinh_mac_dinh` |
| 3 | Vai bấm mốc = **sale\|ceo** | Q-C CEO chốt (mốc bàn giao) | CEO đổi vai → sửa guard `dat_moc_ban_giao` |
| 4 | **"đã giao" = `moc_ban_giao≠chua_giao`** (bóc lát kế toán) | trục giao-nhận ERP 5.3.3, doanh thu ghi khi giao (Garrison) | cần theo `trang_thai='da_giao'` → sửa `dong_tien_ky` |
| 5 | **Cọc = `phieu_thu` loai='coc'** (tiền thật), KHÔNG dùng `don_hang.tien_coc` (số khai) | cọc là tiền thật nên chặn bàn giao không vênh QD-69 | nếu đổi nguồn cọc → sửa cửa cọc `ban_giao_xuong` |

- **Trạng thái: CEO DUYỆT 29/08 · CHỐT.** ĐÃ CHẠY prod (db/174, gồm gộp bóc L-6). `test_wp75` 8/0 · `test_117` 24/0
  (30k) · a/b/c 6/0 · hồi quy wp07/08/43/44/45 + 116 XANH. Đo @30k: `dong_tien_ky` 329ms · `con_phai_thu` 222ms ·
  `cm_don_ky` 359ms · `kenh_cac_ky` 210ms · `pl_ky` 120ms · `lap_day_ky` 101ms · `nhan_xet_ky` 1487ms — tất cả <ngưỡng.
  test_047/069 ĐỎ **PRE-EXISTING** (permission denied client-role, chứng minh trên hàm gốc), không đụng WP-75.
  4 lô UI deploy prod (sale/thietke/taichinh) qua 2 cổng ?raw (node --check + Chrome boot). 3 điều ĐỊNH NGHĨA XONG đều ĐẠT.

## QD-73 (29/08, WP-70 L-01, db/175) — NHÃN MỨC CHẮC CHẮN NGUỒN QUẢNG CÁO 4 BẬC · CHỐT

`lead.muc_chac_chan` 4 bậc, số suy PHẢI đeo nhãn (họ QD-10/15/69 — không trộn số suy với số xác định):
- **`xac_dinh`** — có `ad_id` từ Pancake (hội thoại đính kèm ad_id thật).
- **`suy_ref`** — khớp log nút chat web theo psid + thời điểm (suy từ hành vi, chưa có ad_id).
- **`doi_chieu_lo`** — chỉ ước theo lô ngày; **CẤM gán cho lead lẻ**, chỉ hiện ở màn TỔNG.
- **`khong_biet`** — không suy được.

**LÝ DO:** nguồn quảng cáo phần lớn là số SUY (Pancake không luôn trả ad_id). Trộn suy với xác định = báo cáo ads
dối. Đeo nhãn để màn tổng tách được "chắc" khỏi "ước". (Sách ERP 5.5.1 không nói về nguồn ads — đây là QĐ nội bộ.)
**Trạng thái:** ĐÃ CHẠY (db/175, CHECK 4 bậc trên `lead.muc_chac_chan`). CHƯA commit/tag (đóng ở lô sau).

## QD-74 (29/08, WP-70 L-01, db/175) — chu_de LÀ DANH MỤC ĐÓNG · CHỐT

`kho.chu_de` (ma/ten/hieu_luc_tu/den/ly_do/dang_bat) — **danh mục ĐÓNG dùng chung**: ads (WP-70), dự báo (WP-73),
gom lô (QD-60). Sửa = **TÁCH KHOẢNG + lý do** (khuôn QD-68): đóng `hieu_luc_den` dòng cũ + thêm mã mới. **CẤM UPDATE
đè `ma`/`ten`** (trigger `chu_de_cam_sua` RAISE). Seed 0 dòng — CEO điền 5–8 chủ đề tay.
**LÝ DO:** ba việc (ads/dự báo/gom lô) dùng BA danh mục khác nhau thì không đối chiếu với nhau được. Một danh mục
đóng, đổi có vết.
**Trạng thái:** ĐÃ CHẠY (db/175). CHƯA commit/tag.

## QD-75 (29/08, WP-70 L-01, db/175) — lead LÀ SỔ APPEND-ONLY, HIỆN HÀNH = stt LỚN NHẤT · CHỐT

`kho.lead` = **sổ append-only** (khuôn `giao_dich`/`su_kien_quet` db/119, QD-44). Mỗi lần kéo Pancake thấy đổi (có sđt,
đổi thẻ, gán chủ đề) ghi **dòng MỚI** (không sửa dòng cũ) → sổ giữ lịch sử. `dau_van` (hash tập trường theo dõi) trùng
dòng hiện hành → KHÔNG ghi (chống phình). Hiện hành = `v_lead_hien_hanh` (mỗi `(page_id,hoi_thoai_id)` lấy `stt` lớn
nhất). Cửa ghi DUY NHẤT = `lead_ghi` (SecDef); client bị revoke INSERT/UPDATE/DELETE. **CẤM cột nội dung tin nhắn.**
**LÝ DO:** prospect là dữ liệu biến động (Pancake cập nhật liên tục); ghi đè mất lịch sử attribution. Append-only +
`stt` cho "dòng cuối" tường minh (bài học WP-11).
**Trạng thái:** ĐÃ CHẠY (db/175, bảng RỖNG — bộ kéo Pancake là L-02). CHƯA commit/tag.

## QD-78 (30/08, WP-79 L-79b, db/183) — CÚ CLICK NÚT CHAT LÀ SỔ BÊN HỆ KHO · CHỐT

Cú click nút chat trên web là **SỔ GHI THÊM bên hệ kho** (`kho.click_chat`); nền web CHỈ đóng góp chuỗi `href`.

**Lý do:** web D2C sắp thay bằng Shopify (CEO 30/08) — tín hiệu nguồn KHÔNG được chết theo nền web. Ref sai/rác
VẪN ghi sổ, chỉ đeo cờ `ref_hop_le=false`, KHÔNG chặn người dùng (họ QD-69: việc thật thắng số suy). Chỉ `kenh`
sai mới từ chối. Khuôn sổ append-only theo QD-18/QD-44 (RLS+FORCE + trigger chặn UPDATE/DELETE; cửa ghi duy nhất =
RPC `ghi_click_chat` đường owner/Worker, KHÔNG grant anon/authenticated). KHÔNG lưu IP/nội dung.

**Trạng thái:** hiệu lực (db/183).

## QD-79 (31/08, WP-70 L-70r4, db/185) — LEAD CÓ HAI MỐC · cờ moc_dang_ngo · CHỐT

Lead giữ **HAI mốc**, không gộp một: `thoi_diem_hoi_thoai` = **ngày quen khách** (`inserted_at` Pancake) ·
`cham_cuoi_luc` = **lần chạm cuối** (`updated_at` Pancake) · cờ `moc_dang_ngo` bật khi hai mốc lệch > 24h
HOẶC thiếu `updated_at`.

**Lý do:** gộp một mốc là **mất một câu hỏi** (khách từ bao giờ ≠ hoạt động gần nhất). `updated_at` NHÍCH cả
khi CHÍNH MÌNH trả lời khách (last_sent_by = page) → đây là "chạm cuối", KHÔNG phải "giờ khách nhắn" — tên cột
`cham_cuoi_luc` nói đúng điều đó, không đặt tên `khach_nhan_luc`. Đối chiếu cửa sổ 30′ của WP-79 đọc
`cham_cuoi_luc`, KHÔNG đọc `thoi_diem_hoi_thoai` (bài học lead Vy: quen 05/2025, nhắn 30/08 — lệch 480 ngày).
Cờ `moc_dang_ngo` dùng để **HẠ MỨC/đeo nhãn**, KHÔNG loại cứng (contact cũ nhắn lại chính là ca doi_chieu_lo
khớp được); **chỉ loại cứng khi `cham_cuoi_luc` NULL**. Họ QD-15 (ba mốc) + QD-10 (số suy đeo nhãn).

**Trạng thái:** hiệu lực (db/185; backfill 4.576 lead qua ghiLoLead).

## QD-80 (31/08, WP-70 L-70r1→r8) — finally KHÔNG đáng tin · khoá TỰ HẾT HẠN · đèn soi MỐC TIẾN · CHỐT

Cơ chế dọn dẹp đặt trong `finally` **KHÔNG đáng tin**: nền tảng (Cloudflare) giết tiến trình (Exceeded CPU) thì
`finally`/`catch` **không chạy** → khoá không được nhả. Vì vậy: **khoá phải TỰ HẾT HẠN theo thời gian**
(`held_at < now() - 3 phút` mới chiếm lại, có ghi log "thu hồi khoá treo"). Và **đèn sức khoẻ soi MỐC TIẾN**
(`lan_keo_luc` per page), **KHÔNG soi số lượt/số lỗi**.

**Lý do:** sự cố 30/08 sống **8 giờ** với `loi_lien_tiep = 0` và `so_luot` tăng 1.446 lượt — cron "xanh" mà mốc
đứng, không kéo được gì. Mọi đèn dựa lượt/lỗi đều **mù** kiểu đó. Gốc: Free-plan CPU 10ms + `lead_ghi` hỏi DB
**từng dòng** (tới 540 câu/lượt) → gộp lô `lead_ghi_lo` (540→~18 câu) sống cả dưới 10ms (db/187→188). Kèm bài
học **test-qua-giả**: test bằng driver KHÁC prod (pg vs postgres.js) che bug mã-hoá-kép chuỗi→jsonb, chỉ lộ ở
prod — cổng kiểm cuối phải chạy đúng RUNTIME thật.

**Trạng thái:** hiệu lực (worker-keo-lead: xoay vòng page · try/catch mỗi page · commit theo trang · khoá 3′ ·
đèn `v_keo_lead_suc_khoe` db/186 · gộp lô db/188). **Chưa chứng minh:** tải thật (TRAN_TRANG=10 chưa chạm, kỳ
vắng) · tỷ lệ lỗi Cloudflare sạch (đọc lại sau 24h).

## QD-81 (31/08, WP-78 L-02, db/189) — VAI ads_user: đọc quy kết + GIÁ TRỊ đơn, KHÔNG đọc tài chính · CHỐT

Thêm vai `ads_user` vào danh mục `nguoi_dung.vai_tro`. **Ranh giới:**
- **ĐƯỢC đọc** (qua RPC `ads_ad_ngay`, SECURITY DEFINER): lead (quy kết `ad_id`, luồng, chủ đề, mốc, SĐT) · đơn
  gắn lead ở mức **SỐ ĐƠN + GIÁ TRỊ ĐƠN** (`doanh_thu`, gồm VAT theo 04 §C) + trạng thái tới `da_giao`.
- **KHÔNG được đọc:** giá vốn, lãi/CM, lương, dòng tiền, công nợ, chi phí kỳ, P/L — toàn bộ họ RPC tài chính
  (`pl_ky`, `cm_don_ky`, `dong_tien_ky`, `nhan_xet_ky`, `con_phai_thu`…). Các RPC đó đã guard `current_vai_tro()
  not in ('ceo','ke_toan')` → `ads_user` tự bị từ chối; và KHÔNG grant `ads_user` bảng giá vốn nào.

**Lý do:** ERP 2.7 xếp CRM là **add-on ghép vào ERP**, không phải mô-đun lõi kế toán. **Giá trị đơn KHÔNG phải
P/L** — người chạy ads cần nó để đọc CAC theo dải giá trị (họ QD-WP-76); giá vốn/lãi thì không được chạm.

**Trạng thái:** hiệu lực (db/189: +vai · RPC `ads_ad_ngay` mức ad_id×ngày · index lead(ad_id) + don_hang(lead_id)).
Chi tiêu ad = **CHƯA CÓ NGUỒN** (`chi_ad` NULL, `nguon_chi='chua_co_nguon'`) — Pancake không trả spend (WP-78 L-01);
CẤM suy chi bằng chia đều. Hai bậc phễu đầu (hiển thị/bấm) chờ nguồn Meta.

## QD-82 (31/08, WP-78 L-04, db/190) — GẮN LEAD = máy GỢI Ý, người XÁC NHẬN một chạm · CHỐT

Gắn lead vào đơn: hệ tra SĐT khách trên đơn → **gợi ý** lead trùng (RPC `lead_goi_y_theo_sdt`); **người bấm xác
nhận** thì mới gắn (RPC `don_gan_lead`). **Không xác nhận = không gắn.** CẤM gắn NGẦM kể cả khi trùng đúng một
lead. CẤM nhập tay `ad_id` ở bất cứ đâu.

**Lý do:** một SĐT KHÔNG chắc một người (khách cũ nhắn lại, số dùng chung). Gắn ngầm = máy tự quyết nguồn khách
→ trái QD-76 (chỉ mức xác định mới đổi `nguon_khach`). `don_gan_lead` set `nguon_khach='quang_cao'` chỉ khi lead
`xac_dinh` (có `ad_id`); lead không xác định thì KHÔNG đổi `nguon_khach`. Lead `sdt_hong`/số không parse được →
KHÔNG gợi ý (số không đáng tin thì không gắn).

**Trạng thái:** hiệu lực (db/190: `lead_goi_y_theo_sdt` + `chuan_hoa_sdt` dùng chung).

## QD-83 (31/08, WP-78 L-04, db/190) — ĐỔI lead ghi VẾT dòng mới, KHÔNG có đường gỡ về trống · CHỐT

`don_gan_lead` là **cổng DUY NHẤT** ghi `don_hang.lead_id` ngoài `tao_don` (trigger chặn UPDATE thẳng từ client).
Đổi lead: **BẮT BUỘC lý do**, ghi **dòng vết mới** `don_hang_lead_nhat_ky` (tu = lead cũ, den = lead mới, ai · lúc
nào · lý do), KHÔNG sửa đè dòng cũ. SĐT của lead phải KHỚP SĐT khách trên đơn (chuẩn hoá) — lệch → từ chối.
(Sổ vết lead TÁCH khỏi `don_hang_nhat_ky` — bảng đó CHECK `den` = trạng-thái, không chứa được uuid lead; bảng
mới CÙNG KHUÔN `{don_id, tu, den, nguoi_id, luc, ly_do}`, KHÔNG phải kiểu vết thứ hai.)
**GỠ về trống: KHÔNG CÓ ĐƯỜNG** — gắn nhầm thì đổi sang lead đúng; không có lead đúng thì để nguyên + ghi lý do.

**Lý do:** họ QD-16/18 — đơn đã chốt là sự thật lịch sử, đính chính bằng DÒNG MỚI (append-only), không xoá về trống.

## QD-85 (31/08, WP-79 L-09, db/194) — KHỚP CLICK↔LEAD CỬA-SỔ-1:1, mức suy_ref có khoa_khop · CHỐT

Sau khi thực nghiệm chốt **không kênh nào có khoá xác định** (Zalo query-string CHẾT L-08b, Messenger CHẾT 2 phép thử) —
`lead.muc_chac_chan` phân giải như sau (kiện toàn QD-73, KHÔNG đụng `doi_chieu_lo`):

- **(1) `doi_chieu_lo` GIỮ NGUYÊN** = ước theo lô ngày, **CẤM gán lead lẻ**, chỉ hiện màn TỔNG (QD-73 nguyên vẹn).
- **(2) `suy_ref`** = lead khớp về MỘT dòng log nút chat web (`click_chat`). Hai dạng khoá **cùng mức**:
  - **(a) psid** = khớp XÁC ĐỊNH — *hiện KHÔNG kênh nào phát psid ra link* (Zalo/Messenger đều không), nên đường này **treo tới khi có nguồn psid**.
  - **(b) cửa sổ thời gian + kênh** — CHỈ gán khi trong cửa sổ có **ĐÚNG MỘT click và ĐÚNG MỘT lead** (song ánh 1:1).
- **(3) n click × m lead** (n>1 hoặc m>1, hoặc n=0): **KHÔNG gán gì, để `khong_biet`**. CẤM chọn gần nhất, CẤM chia, CẤM đoán,
  CẤM nới cửa sổ khi không khớp. Ghi lý do loại: `nhieu_click` / `nhieu_lead` / `khong_co_click`.
- **(4) Lead gán bằng (b) mang cột `khoa_khop='cua_so_1_1'`** — không trộn hai chất lượng (psid xác định vs cửa-sổ suy) vào một
  nhãn. Cột thêm trên lead: `ma_click · loai_ma_click · khoa_khop · khop_luc`.
- **(5) Điều kiện đạt WP-79** = `SELECT ≥1 lead THẬT mang suy_ref` (khoá `cua_so_1_1`) sau mốc `wp79b_ma_click_tu`.

**Cơ chế ghi (tôn trọng QD-75 append-only):** matcher `khop_click_lead` UPDATE **TẠI CHỖ** 4 cột + `muc_chac_chan` trên
DÒNG HIỆN HÀNH (khuôn don_gan_lead QD-83: enrichment DẪN XUẤT khác lịch sử nội dung Pancake). **KHÔNG đụng `dau_van`** → nhịp
kéo vẫn thấy `khong_doi`, khớp bền cho tới khi hội thoại có tin mới (lúc đó dòng mới append, matcher pass sau khớp lại).
`nguon_khach` KHÔNG đổi (tao_don khoá theo `ad_id`, không theo muc_chac_chan → suy_ref vẫn ='khac', sổ tài chính sạch, QD-76).

**Lý do sửa xếp loại:** khớp cửa-sổ-30′ **không thuộc mức nào** của QD-73 (không phải xác-định-psid, không phải ước-lô);
chữ `doi_chieu_lo` trong tiêu chí đạt của L-05 là **LỖI XẾP LOẠI** — nó là `suy_ref` khoá cửa-sổ, đã sửa ở (2b)/(4).

**GIỚI HẠN (CEO cần biết):** khoá THỜI GIAN chỉ phân giải được khi **lưu lượng THƯA** — cửa sổ có >1 lead cùng kênh thì
mù có chủ đích (để `khong_biet`, không đoán). Giờ đông khách = độ phủ thấp. Đo thật ở VIỆC 4c (tỷ lệ lead-đơn-độc-trong-cửa-sổ).

**Trạng thái:** db/194 (4 cột + `khop_click_lead(p_tu,p_den,p_dry)`); bám nhịp kéo lead, KHÔNG cron thứ hai. CHƯA commit/tag.

## QD-84 (31/08, WP-79b L-06, db/193) — MÃ CLICK giữ NGUYÊN VĂN nhãn 'chua_giai', KHÔNG suy ad_id/chiến dịch · CHỐT

Bắt mã click (`fbclid`/`gclid`) + `utm_*` ở **trang đích** (GTM ghi vào `sessionStorage`, giữ QUA TRANG), mang qua
`/chat` vào 8 cột thô trên `kho.click_chat` (`ma_click, loai_ma_click, utm_source/medium/campaign/content/term, trang_dat`).
Quyết định cứng:

- **`fbclid` = MÃ CLICK, KHÔNG phải mã quảng cáo.** Giữ **NGUYÊN VĂN** — không cắt, không hash, không đoán chiến dịch từ
  nó. Chỉ chặn **trần độ dài** (ma_click 512 · loai 16 · utm 256 · trang_dat 1024), KHÔNG làm sạch nội dung.
- **CẤM đặt cột tên `ad_id`/`campaign_id`.** Mọi chỗ đọc mã click mang nhãn **`chua_giai`**. Giải mã click→chiến dịch là
  việc của **Meta Marketing API (WP-77)**, không suy từ chuỗi này ở tầng nào.
- **Có mã click KHÔNG nâng mức chắc chắn** (`muc_chac_chan` giữ theo QD-73/76). `nguon_khach` KHÔNG đổi vì có mã click.
  Mã click là DỮ LIỆU THÔ chờ giải, không phải bằng chứng quảng cáo.
- **MỐC bật (VIỆC 4):** `tham_so_van_hanh.wp79b_ma_click_tu` (epoch giây). Lead/click **TRƯỚC mốc = TRỐNG VĨNH VIỄN** —
  CẤM lấp ngược bằng bất kỳ cách suy nào. Mọi màn đọc mã click phải hiện được câu "chỉ có từ <mốc>".

**Nối dây tới lead (VIỆC 3) — HOÃN CÓ CHỦ ĐÍCH:** WP-79 **CHƯA có** máy khớp click↔lead theo cửa sổ 30′ (đã soi, không
tồn tại). Không có đường khớp thì **KHÔNG thêm cột `ma_click` chết vào `lead`** (luật §5 nối-dây: cột không ai bơm = luật
chết). Mã click dừng ở `click_chat` tới khi WP-79 dựng máy khớp. Báo khoảng trống, không lấp bằng cột treo.

**Lý do:** họ QD-10/15/76 — số chưa giải đeo nhãn, không trộn vào số xác định; sổ tài chính/nguồn khách phải SẠCH.

## QD-86 (31/08, WP-78 L-05c→f) — CẤM XOÁ DÒNG khỏi sổ append-only trên dữ liệu thật (không phụ thuộc có trigger hay chưa) · CHỐT

**CẤM XOÁ DÒNG khỏi mọi sổ append-only trên dữ liệu thật — BẤT KỂ bảng đó đã có trigger chặn hay chưa.** Chưa có
trigger **KHÔNG phải là được phép**, chỉ là **chưa cài răng** (vd `su_kien_quet` hở tới L-05f). Cấm mọi cách VÒNG:
**tắt/drop trigger** · **`session_replication_role='replica'` ngoài tx-rollback** · **chạy bằng vai owner**.
Sổ: `giao_dich` · `su_kien_quet` · `click_chat` · `don_hang_lead_nhat_ky` · `vat_tu_tham_so_lich_su` · `lead`
(mở rộng khi có sổ mới). Mỗi sổ chỉ có **một cửa ghi**; **KHÔNG có cửa dọn.**

Dọn demo = **0 TÁC ĐỘNG** chứ không 0 dấu vết (QD-46 sửa 22/08):
- **(a) Để nguyên** — `la_demo` đã lọc khỏi mọi báo cáo/KPI (QD-46); bản ghi demo tồn tại KHÔNG hại.
- **(b) Cần biến mất khỏi tồn/công nợ** → qua `xoa_demo()`: **sổ SỐ DƯ** (giao_dich) ghi **dòng-đảo** (huy_phieu); **sổ
  LOG THÔ** (su_kien_quet) **để NGUYÊN** — sự kiện đã xảy ra, đảo vô nghĩa (QD-18). **KHÔNG xoá dòng sổ** trong cả hai.

**Ngoại lệ DUY NHẤT:** CEO **tự gõ** lệnh tắt trigger trong lệnh dán — **máy KHÔNG BAO GIỜ tự thêm** (cùng khuôn
`BO_QUA_BACKUP` QD-61).

**Kèm:** mọi lệnh `DELETE` dọn demo **phải ràng buộc `la_demo`**, không chỉ ràng theo mã đơn — mã gõ nhầm thì không
có hàng rào thứ hai.

**RANH GIỚI — hai việc khác bản chất, đừng gộp:**
- **(a) DỌN trên dữ liệu THẬT** (xoá dòng sổ đã tồn tại, dù là demo): **CẤM tắt trigger.** Đây là phạm vi QD-86.
- **(b) SEED fixture trong transaction có ROLLBACK** (`session_replication_role='replica'` hoặc `savepoint→rollback`):
  **ĐƯỢC.** Không chạm dữ liệu thật; rollback đóng cửa lại; cấm nhóm này thì mọi test dựng dữ liệu chết mà không bảo
  vệ được gì.
- **Phân biệt bằng CÂU HỎI:** sau khi chạy xong, có dòng nào trong prod **BIẾN MẤT** không? **Có = (a), cấm. Không =
  (b), được.**

**Lý do:** L-07 (31/08) đã kết luận không tự gỡ chốt sổ; **L-05 CÙNG NGÀY lại làm đúng việc đó** (tắt `dhlnk_chan_sua`
trên bảng vết để xoá 2 dòng demo) — luật mòn bằng ngoại lệ nhỏ, nên khoá thành điều khoản.

**Dấu vết việc đã rồi:** đã xảy ra **một lần ở L-05 (31/08)**, **không thiệt hại** vì bảng vết `don_hang_lead_nhat_ky`
trước đó còn RỖNG (2 dòng xoá là dữ liệu demo tôi vừa tạo); trigger đã bật lại (`tgenabled='O'`). Ghi lại để **không
thành tiền lệ** — không hoàn tác được, nhưng từ nay cấm lặp.

## QD-93 (02/09, WP-93 L-01, db/205) — NGƯỠNG cảnh báo ads lưu THAM SỐ có lịch sử, không nhét vào code · CHỐT

- **`ads_nguong(ma, gia_tri, hieu_luc_tu, hieu_luc_den, ly_do, nguoi_ghi)`** — khoảng hiệu lực + EXCLUDE gist chống chồng
  (khuôn QD-68/QD-90). Sửa ngưỡng = **đóng khoảng cũ + mở mới có lý do**, KHÔNG sửa đè, KHÔNG sửa code. RPC đọc qua `ads_nguong_lay(ma, ngày)`.
- **5 ngưỡng seed (QĐ-c), tất cả `[TẠM]`:** `chi_cao_khong_hoi_thoai=500.000đ · tang_dot_bien_pct=50 · tang_dot_bien_tuyet_doi=300.000đ ·
  ad_moi_du_ngay=3 · den_sat_tran_pct=85`. ly_do='khởi tạo WP-93 [TẠM]'.
- **Lý do:** Garrison ch.10 (quản trị theo NGOẠI LỆ) — ngưỡng phải chỉnh được mà không sửa code; và biểu đồ kiểm soát theo
  độ lệch chuẩn (tr.438) cần chuỗi kỳ → số hiện tại chưa đo được, **rà lại khi có 8 tuần dữ liệu thật**.
- **Trạng thái:** ĐÃ LÀM DB (db/205). `ads_viec_phai_lam` đọc ngưỡng từ bảng (test_wp93 T4 bẻ ngưỡng → kết quả đổi). Chưa UI (L-02).

## QD-92 (02/09, WP-92 L-01, db/205) — ĐÈN TRẦN CAC mức CHIẾN DỊCH, 5 trạng thái, KHÔNG lộ số trần ra app ads · CHỐT

- **Đèn ở MỨC CHIẾN DỊCH** (QĐ-b). Dải trần của một chiến dịch = **dải giá trị đơn thật quy kết cho chính nó** (bình quân
  giá trị đơn) → tra `cac_toi_da_ky` (WP-76). Đèn nằm ở chiến dịch nhưng trần chia theo dải giá trị ĐƠN → phải **bắc cầu qua đơn thật**.
- **5 trạng thái:** `con_du` (CAC < 85%×trần) · `sat_tran` (85–100%) · `vuot_tran` (>100%) · `chua_du_so` (có đường quy kết
  nhưng chưa có đơn thật) · `khong_do_duoc` (chiến dịch dẫn web, nền tảng không đóng hội thoại). Tách bạch hai loại "không có số".
- **RPC (`ads_bang_ky`) TUYỆT ĐỐI KHÔNG trả CON SỐ TRẦN ra client** — không lộ biên cho người chạy ads; số trần chỉ ở app Tài chính.
  RPC chỉ trả trạng thái đèn (chuỗi), trần tính nội bộ rồi bỏ.
- **CHƯA có map campaign↔ad** trong schema → chưa có đường campaign→đơn → `don_qua_ket=0` → thực tế mọi chiến dịch chỉ ra
  `khong_do_duoc` (objective dẫn web: OUTCOME_SALES…) hoặc `chua_du_so` (tin nhắn). 3 trạng thái con_du/sat_tran/vuot_tran là
  **CƠ CHẾ mở sẵn**, với tới khi có đường quy kết (WP-77 vế a CAPI + map campaign↔ad).
- **XONG CƠ CHẾ, KHÔNG tag XONG (QĐ-a):** trần chưa có số thật (WP-76 còn điều kiện: cần ≥1 đơn thật) — không lặp lỗi WP-79.
- **Gộp theo `objective`** chứ không "dạng nội dung" (VIỆC 0b): nguồn `chi_chien_dich_ngay` KHÔNG có trường dạng nội dung
  (video/ảnh/carousel) → gộp theo số thật đang có. Đổi tiêu chí so mẫu duyệt, ghi rõ ở đây.
- **Trạng thái:** ĐÃ LÀM DB (db/205: `ads_bang_ky`/`ads_tong_so_sanh`/`ads_viec_phai_lam`, grant ceo/ads_user). Chưa UI (L-02).

## QD-91 (01/09, WP-76 L-76c, db/203) — CAC tối đa đọc theo DẢI GIÁ TRỊ ĐƠN, hai cột NGẮN HẠN / DÀI HẠN · CHỐT

RPC `cac_toi_da_ky(p_ky, p_gom_demo=false, p_nguong=ARRAY[3e6,7e6,15e6,40e6])` — mỗi dải một dòng, HAI cột CAC.
Nguồn SDĐP/biến phí = `cm_don_raw` (một bản sự thật, 04 §A — KHÔNG viết công thức lần hai). Định nghĩa per-đơn:
- `dt_thuan = gia_chot/(1+vat/100)` · `SDĐP (đảm phí) = dt_thuan − k1 − k2 − ship − hoa` (KHÔNG trừ k3) · `cac_hoa_von = SDĐP − k3` (= `cm_don_raw.cm`).

**Công thức HAI CỘT:**
- **cac_ngan_han = SDĐP − chi phí TĂNG THÊM − chi phí CƠ HỘI.**
  · chi phí tăng thêm: chỉ phần khối ③ là tiền chi thêm thật; lương thiết kế/CNC trả theo tháng KHÔNG phải tăng thêm.
    k3 hiện **chưa tách biến/định** → cờ `k3_chua_tach`, phần tăng thêm = **0** (CẤM lặng lẽ trừ cả k3).
  · chi phí cơ hội: **chỉ khác 0 khi nguồn lực ĐANG KÍN**; đọc kín/trống từ `lap_day_ky` (QD-36, `ty_le_lap_day` ≥ `nguong_lap_day_cao`) —
    KHÔNG tự đặt ngưỡng mới. Kín mà không có pool đơn thay thế để định giá đơn-vị-nguồn-lực-ràng-buộc → cờ `thieu_chi_phi_co_hoi`, cột NULL.
- **cac_dai_han = SDĐP − khối ③ đầy đủ − bien_muc_tieu × (giá chốt bóc VAT)** = `cac_hoa_von − bien_muc_tieu×dt_thuan`.
  · `bien_muc_tieu` NULL → cac_dai_han NULL + cờ `thieu_bien`; **vẫn trả `cac_hoa_von`**. CẤM lấy `he_so_m` thay biên mục tiêu.
- **gia_toi_thieu = (khối ③ + CAC dự kiến của dải `n_cac`) ÷ tỷ lệ SDĐP** — đọc theo cột DÀI HẠN.
- Trả kèm `cot_dang_sang ∈ {ngan_han, dai_han}` suy từ lap_day_ky (kín→ngắn hạn · trống→dài hạn) + lý do bằng chữ.
- Ràng buộc: **khối ④ (định phí chung: giám đốc xưởng, kế toán, phần mềm) KHÔNG vào cả hai cột ở mức đơn** (Garrison ch.6) —
  cột dài hạn gánh định phí QUA biên mục tiêu, không rải định phí vào từng đơn. k3 lưu cả đơn, không chia món (L-76a). Dải 0 đơn → `chua_co_don`, số NULL (họ cờ `vo_han` WP-90).

**Lý do (vì sao HAI cột, không một):** khuôn *Special Orders* (Garrison ch.12 tr.542-543) chỉ đúng cho đơn **MỘT LẦN** khi còn công
suất trống; bán lẻ đơn chiếc chạy **quanh năm** — dùng MỘT cột (chỉ biến phí tăng thêm) thì đơn nào cũng "lãi" mà cả năm không đơn nào
phủ định phí. **Khối ③ không phải hằng số:** còn trống → làm thêm đơn ≈ 0 chi phí tăng thêm (ch.12 tr.541 Opportunity Cost); kín việc →
một giờ dành cho đơn này là đơn tốt hơn bị đẩy ra, đo bằng **số dư đảm phí trên đơn vị nguồn lực ràng buộc** (ch.12 tr.543-544). Cột
ngắn hạn = quyết định KHI KÍN (nhận đơn nào); cột dài hạn = giá sàn để KHÔNG lỗ định phí về dài. DACTA §1 (số suy đeo nhãn, không trộn số đo).

**Trạng thái:** dải 5 mức (`p_nguong`) và `bien_muc_tieu` là **THAM SỐ** — sửa dải/biên = **tách khoảng + lý do** (khuôn QD-68), KHÔNG sửa đè.
`bien_muc_tieu` thêm cột NULL (chưa chốt, ô nhập UI là lệnh sau) — KHÔNG backfill, KHÔNG suy từ he_so_m. ĐÃ LÀM DB+test (db/203, test_wp76c); UI/deploy/tag là lệnh sau.

## QD-90 (01/09, WP-90 L-21, db/201) — BẢN ĐỒ tài khoản quảng cáo → brand (khoảng hiệu lực); chi_ads GỘP tự động từ chi_ads_ngay · CHỐT

- **Bản đồ act_id → brand là BẢNG có khoảng hiệu lực** (`ads_tai_khoan_brand`, họ QD-68), **KHÔNG ghi cứng trong code**; nạp
  **theo từng brand** (triển khai lần lượt). Đổi brand = **đóng khoảng cũ + mở mới** (EXCLUDE gist chặn chồng), CẤM sửa đè.
  Nạp lô 1: **6 tài khoản → `sconcept`** (Sophia Concept), hieu_luc_tu `2026-08-01` (đầu kỳ mốc). 3 TK có chi, 3 chưa.
- **`chi_ads` (hạt kỳ×brand×kênh, app Tài chính đọc) lấy số bằng GỘP từ `chi_ads_ngay`** qua bản đồ (`chi_ads_gop_meta`),
  **THAY nhập tay** — kênh `quang_cao`, từ **MỐC = ngày sớm nhất có trong `chi_ads_ngay`** trở đi. **Trước mốc giữ số tay.**
- **Brand chưa nạp thì chi ads của nó CHƯA vào hệ** — RPC `ads_do_phu_brand` trả **brand đã phủ / tổng brand đang bán**
  (`thuong_hieu_ban`), hiện **1/9**, để không ai đọc tổng chi ads trong hệ như **tổng chi của công ty**. Nạp brand thứ hai → số tự đổi.
- **Tài khoản chưa có trong bản đồ: KHÔNG đoán brand** — chi của nó **treo ở mục "chưa gán"** (`chi_treo_chua_gan` + `so_tk_chua_gan`),
  **phải đếm được**, không im lặng nuốt.
- **HAI CHẤT LƯỢNG TÁCH NHÃN (04 §C):** `chi_ads` thêm cột **`nguon`** (`nhap_tay`/`meta_tu_dong`) + **`nhan_vat`**
  (`gom_vat` cho nhập tay · `chua_ro_vat` cho Meta). **CAC (`kenh_cac_ky`) đọc cột này** → **rẽ theo nhãn**: `gom_vat` ÷(1+VAT)
  như cũ; `chua_ro_vat` **lấy nguyên, KHÔNG bóc VAT số chưa rõ**. Kỳ chỉ-nhập-tay → CAC **byte-identical** (nhãn mặc định `gom_vat`).
- **HAI CỬA GHI TÁCH `nguon`:** `ads_ghi` (nhập tay) chỉ xoá/ghi `nguon='nhap_tay'`; gộp chỉ đụng `meta_tu_dong` — **không giẫm nhau**.
  **Số nhập tay kỳ đã qua KHÔNG bị đè**; gộp **idempotent** (unique một dòng auto mỗi kỳ×brand×kênh; chạy lại không cộng chồng).
  Gặp dòng nhập tay cùng (kỳ,brand,quang_cao) ở kỳ ≥ mốc → **gộp NHƯỜNG** (không đè), đếm ở `bo_qua_vi_nhap_tay`.
- **Nghiệm thu (L-21):** kỳ **2026-08** chi_ads tự lên **7.378.315 = Σ chi_ads_ngay** (khớp tuyệt đối, 3 TK). CAC 2026-08 sconcept:
  trước = chưa có dòng → sau = chi 7.378.315, **0 khách mới brand → CAC vô hạn** (đang đốt tiền chưa ra khách sconcept). `test_wp90` **9/0**.
- **PHÁT SINH (ngoài lô):** ① nối bộ kéo Meta → gọi `chi_ads_gop_meta` sau mỗi vòng upsert (tự làm tươi) · ② RPC sửa bản đồ
  (đóng/mở khoảng) khi TK đổi brand · ③ sửa MÀN Tài chính hiện "phủ 1/9" + khối treo. Đều là việc riêng (lô này chỉ DB+test).

## QD-89 (01/09, WP-78 L-20, db/200) — TRỤC app Quảng cáo = CHIẾN DỊCH/tài khoản × ngày; mức ad_id là khối PHỤ · CHỐT

Đổi trục màn app Quảng cáo:

- **Trục CHÍNH = chiến dịch × ngày** (`ads_chien_dich_ngay`, đọc `chi_chien_dich_ngay`): chi/hiển thị/bấm có số thật;
  **đơn/doanh thu/CAC = NULL + nhãn `'cho_capi'`** (quy kết đi qua CAPI vế a, CHƯA có). `objective` nguyên trạng.
- **Mức `ad_id` xuống KHỐI PHỤ, thu gọn mặc định** — ghi rõ "chỉ đúng cho quảng cáo TIN NHẮN". Giữ `ads_ad_ngay` +
  `chi_ads_ngay` nguyên (không đụng chữ ký — app còn gọi).
- **Lý do (đo thật L-19):** 6 ad đang tiêu tiền đều `OUTCOME_SALES/OFFSITE_CONVERSIONS` — **chuyển đổi dẫn vào web,
  KHÔNG đóng ad_id lên hội thoại**; giao với 21 ad có hội thoại = **0 mã** (cấu trúc, không tạm thời). Trục ad_id chỉ đo
  được loại **tin nhắn** (đã tắt). Chi phí thì có ở MỌI cấp → trục chiến dịch đo được tiền đang chạy.
- **Quy kết đơn cho ad chuyển đổi đi qua CAPI + web pixel** (khử trùng event_id, WP-77 vế a). **CẤM ghép tạm bằng ad_id,
  CẤM suy doanh thu theo tỷ lệ chi** (họ QD-10/15: số suy đeo nhãn, không trộn số xác định).
- **Câu trung thực đầu màn (CEO duyệt) sửa lại:** chi = số thật Meta chưa rõ VAT; đơn/CAC chưa có vì ad chuyển-đổi-dẫn-web;
  12,7% lead có mã là **DI SẢN** ad tin nhắn đã tắt, KHÔNG phải phần quy kết của tiền đang chạy.

**Nghiệm thu (L-20):** chiến dịch "Cố định COMBO NGỦ NÂU" ngày 30/08 — app `325.899 · 3.636 · 220` **KHỚP tuyệt đối** Meta.
Bộ kéo thêm cấp campaign (`chi_chien_dich_ngay`, cùng khuôn, một nguồn số). `ads_chien_dich_ngay` guard ceo/ke_toan/ads_user.

**Trạng thái:** db/200 · UI đổi trục (deploy togihome-ads) · `test_chi_ads_ngay` 5/0 · hồi quy năm-bộ 95/0. CHƯA commit/tag.

## QD-88 (01/09, WP-77 L-18, db/199) — chi_ads_ngay là bảng ĐỒNG BỘ (upsert), chi nguyên trạng nhãn chua_ro_vat · CHỐT

Kéo chi phí Meta mức **ad × ngày** vào `chi_ads_ngay`, nối vào `ads_ad_ngay` (cột chi/CAC ở app Quảng cáo):

- **`chi_ads_ngay` là bảng ĐỒNG BỘ, KHÔNG phải sổ append-only.** Meta chốt số muộn (~72h chi phí một ngày còn đổi) →
  kéo lại cùng `(act_id, ad_id, ngày)` **CẬP NHẬT dòng đó** (upsert theo khoá), không đẻ dòng mới. **Khác họ QD-44/86**
  (sổ bất biến) — ghi rõ để không ai nhầm; vì vậy `chi_ads_ngay` **KHÔNG** có trigger chặn UPDATE.
- **`chi_tieu` lưu NGUYÊN TRẠNG số Meta trả** — CẤM +VAT, CẤM quy đổi, CẤM làm tròn. Nhãn `nhan_vat='chua_ro_vat'` cho
  MỌI dòng tới khi có QD gỡ. **Gỡ nhãn** = đối chiếu hoá đơn Meta **một tài khoản một tháng** (chi_tieu tổng ↔ số trên
  hoá đơn) để biết Meta trả gồm hay chưa gồm VAT, RỒI ghi QD mới. KHÔNG tự đoán.
- **Không có dòng chi khớp `(ad_id, ngày)` → `chi_ad` NULL + `nguon_chi='chua_co_nguon'`.** KHÔNG suy, KHÔNG nội suy
  ngày thiếu, **KHÔNG bịa 0** (0 nghĩa là "chi bằng 0", khác "không có dữ liệu").
- **`cac_ad` = `chi_ad ÷ số đơn chốt của ad đó trong ngày`; 0 đơn → NULL** (CẤM chia 0, CẤM ghi 0). Hiện mọi ad đều 0 đơn
  gắn lead → `cac_ad` NULL toàn bộ — ĐÚNG, không phải lỗi. Grain này (**ad×ngày ÷ đơn chốt**) KHÁC `kenh_cac_ky`
  (**brand×kênh ÷ khách mới**) → là metric khác, KHÔNG phải công thức CAC thứ hai (không chép, không dùng chung được).
- **`chi_ads` cũ (db/115, hạt kỳ×brand, app Tài chính đọc) KHÔNG đụng** — hai hạt khác nhau, không phá màn CAC kế toán.

**VIỆC 4 (chi_ads cũ thôi nhập tay) TẮC — việc riêng:** để `chi_ads` lấy số từ `chi_ads_ngay` gộp lên cần **bản đồ
ad → brand**, mà bản đồ này **CHƯA CÓ** trong hệ (soi: không có bảng ad_brand/map nào). KHÔNG tự đoán brand từ tên ad →
**DỪNG vế này**, `chi_ads` tạm giữ nhập tay của kế toán. Vế 3 (nối `ads_ad_ngay`) chạy độc lập, đã xong.

**Nghiệm thu số thật (L-18):** ad "TNTT Bàn học điều chỉnh chiều cao - 11/8" ngày 25/08 kéo về **chi 180.384 · hiển thị
3.331 · bấm 189** — khớp tuyệt đối Trình quản lý quảng cáo. Bộ kéo `keo_chi_ads_meta.mjs` (khuôn worker-keo-lead, 6 tài
khoản động, cô lập lỗi từng tài khoản, retry ≤3, tài khoản DISABLED vẫn kéo) — **chưa deploy cron**, chạy tay 1 vòng.

**Trạng thái:** db/199 · `test_chi_ads_ngay` 5/0. Chưa nối vế (a) [công tắc meta_capi_bat vẫn TẮT]. CHƯA commit/tag.

## QD-77 (30/08, WP-70 L-08, db/182) — BA CHIỀU TÁCH BẠCH · loai_thuong_mai là bảng gốc phân loại · CHỐT

Chat não duyệt (iii-b) 29/08. Phân loại sản phẩm là **BA CHIỀU tách bạch, cấm trộn vào một cột:**
- **DÒNG** (`kho.dong_san_pham`, 11) = xưởng **LÀM** gì (BOM, định mức, giá vốn).
- **LOẠI THƯƠNG MẠI** (`kho.loai_thuong_mai`, 10, **danh mục ĐÓNG**) = công ty **BÁN** gì. Rộng hơn dòng vì gồm hàng
  săn (Sofa · Thảm · Chăn ga · Đèn) xưởng không làm — 4 loại này KHÔNG có dòng trỏ tới, ra 0 tới khi có SKU.
- **PHÒNG** (`kho.khong_gian`, 4) = khách **DÙNG** ở đâu.

Quyết định cứng:
- **`loai_thuong_mai` là bảng gốc DUY NHẤT của phân loại thương mại. BỎ `kho.chu_de`** (đã drop, 0 dòng nên không mất
  data). Danh mục đóng, **sửa = tách khoảng + lý do** (tinh thần QD-74; trigger `loai_cam_sua` chặn đè `ma`/`ten`).
- **Nối dòng→loại qua `kho.dong_loai`** (dong_ma PK → loai_ma FK), NHIỀU DÒNG MỘT LOẠI. Dòng chưa có trong cầu → NULL
  "chưa gán", CẤM auto-gán.
- **Lead suy loại QUA ĐƠN CHỐT:** lead → `don_hang.lead_id` → `don_hang_mon` → biến thể → `san_pham_loi.dong_id` →
  `dong_loai` → loai_ma. **Đơn nhiều loại → lấy loại của món GIÁ TRỊ LỚN NHẤT** (một đơn một loại thì bảng cộng được;
  chia tỷ lệ theo món làm số đơn thành số lẻ). Lead chưa chốt → NULL "chưa gán" (sự thật, không phải lỗi).
- **Bảng loại ở màn CAC: chi quảng cáo & CAC = NULL** (cần bản đồ quảng-cáo→loại, thuộc WP-78). CẤM chia đều để lấp ô.

**LÝ DO bỏ đề xuất CD-TUAO/CD-KE… (L-07):** lấy 12 dòng-xưởng làm chủ đề thì khách hỏi thảm/đèn/chăn ga rơi hết ra
"chưa gán" — sai hướng. `chu_de` (L-01) chỉ là chỗ tạm, chưa có dữ liệu nên bỏ sạch, thay bằng chiều thương mại thật.
Tên 10 loại ghi Y HỆT chữ tool ngoài của CEO (WP-09 khớp từng ký tự).

## QD-76 (29/08, WP-70 L-02a, db/176) — CHỈ MỨC XÁC ĐỊNH MỚI ĐỔI ĐƯỢC NGUỒN KHÁCH · CHỐT

Sửa LỖI mapping của L-01 (đã bơm số suy vào sổ tài chính). `tao_don(p_lead_id)` map `nguon_khach`:
- **`lead.ad_id NOT NULL`** (mức `xac_dinh`) → `nguon_khach = 'quang_cao'`.
- **Mọi mức khác** (`suy_ref` · `doi_chieu_lo` · `khong_biet`, hoặc ad_id NULL) → `nguon_khach = 'khac'`.
- **CẤM suy 'quang_cao'** từ `suy_ref`/`doi_chieu_lo`/`khong_biet`.
Nhãn suy GIỮ NGUYÊN trong `lead.muc_chac_chan` (màn Kênh&CAC db/115 hiện tỷ lệ `khong_biet` đầu màn) — mất nhãn
mới là mất, còn `nguon_khach` thì phải SẠCH.

**LÝ DO:** L-01 map mọi mức ≠ `khong_biet` → `'quang_cao'`. Nhưng `suy_ref`/`doi_chieu_lo` là SỐ SUY — một lead vào
từ nút chat web không quảng cáo sẽ ăn chi phí quảng cáo khi màn CAC chia theo `nguon_khach`. Đúng họ QD-69 (việc thật
thắng số suy) + QD-10/15 (số suy đeo nhãn, không trộn với số xác định). 6 giá trị `nguon_khach` thật: `quang_cao ·
gioi_thieu · cua_hang · san_tmdt · khach_cu · khac` → quảng cáo='quang_cao', mặc định='khac' (không thêm giá trị mới).

Kèm lô này: `lead_ghi` thêm **cửa GUC `kho.lead_he_thong`** (khuôn WP-21 db/127) cho bộ kéo nền (vai NULL) — KHÔNG mở
vai mới, cửa ghi vẫn một `lead_ghi`. Bảng **`lead_moc_keo`** (mốc kéo mỗi trang, UPDATE được — MỐC không append-only)
để L-02b không kéo lại từ đầu; ghi qua `lead_moc_ghi` (cùng cửa GUC).

**Trạng thái:** ĐÃ CHẠY (db/176; `test_lead` 18/0 gồm ca chặn lỗi mapping). CHƯA commit/tag.

## QD-94 (02/09, WP-72 L-72, db/035+036 bù + db/209) — VÒNG ĐỜI BÁO GIÁ: ba trạng thái · thua bắt lý do · hạn trả lời tham số · quá hạn chỉ bật đèn · CHỐT

Trả nợ vùng tối 03 §D (luồng báo giá db/035+036 ra đời KHÔNG có QD). Chốt cấu trúc:

- **BA trạng thái báo giá, mỗi cái một lý do tồn tại:**
  - `bao_gia` — đơn đang chào giá, CHƯA cam kết: bỏ qua mọi cổng chốt giá, không doanh thu, không kéo vào `he_so_m`. Đứng TRƯỚC `moi_len_don`.
  - `bao_gia_treo` — khách chưa trả lời dứt khoát (còn cân nhắc): kết thúc TẠM, **KHÔNG bắt lý do** (chưa có kết luận để ghi).
  - `bao_gia_thua` — khách đã từ chối: kết thúc DỨT, **BẮT BUỘC `ly_do_thua`** (danh mục đóng 5 giá trị `gia_cao/cham/doi_y/chon_noi_khac/khac`) + `ghi_chu_thua` tuỳ chọn — để phân tích vì sao mất đơn.
- **Thua bắt lý do, treo không.** Ép ở HAI tầng: cổng `doi_trang_thai_don` (bản mới, nhận `p_ly_do_thua`, từ chối sớm với câu tiếng Việt) VÀ trigger `moc_bao_gia` (chốt cuối, chặn cả UPDATE thẳng). Không nới trigger.
- **Hạn trả lời có THAM SỐ theo loại đơn** (`han_bao_gia_mac_dinh`, khoảng hiệu lực khuôn QD-93): đơn lẻ (`dong` ≠ du_an) = **7 ngày**, dự án (`dong='du_an'`) = **21 ngày** [TẠM]. `moc_bao_gia` tự đặt `han_tra_loi = ngay_tao_bao_gia::date + so_ngay` khi vào `bao_gia` nếu chưa có; **sale sửa được từng đơn**, trigger KHÔNG ghi đè giá trị đã có.
- **Quá hạn CHỈ bật đèn, máy KHÔNG tự đóng đơn thay sale.** `han_tra_loi` quá hạn → màn hiện nhóm `qua_han`/`sap_het_han` (≤3 ngày) để sale ĐÒI khách trả lời; trạng thái đơn giữ nguyên tới khi sale tự đánh dấu thua/treo.
- **Lý do:** ERP (Sagegg&Alfnes §5.5.1) nói theo dõi báo giá SẮP HẾT HẠN để đòi khách trả lời — KHÔNG nói tự đóng. Máy tự đóng đơn = máy quyết thay người (họ QD-69: việc thật của người thắng số máy suy).

**Trạng thái:** db/209 (`han_tra_loi` + `han_bao_gia_mac_dinh` + `moc_bao_gia` mở rộng + `doi_trang_thai_don` bản mới + `sale_bao_gia_ds` bổ sung + `sale_bao_gia_han_dem`). UI `togihome_sale.html`/`sale.js`. CHƯA commit/tag — chờ CEO kiểm mắt.

## QD-95 (02/09, WP-10 L-10, db/212) — CỘT NGHIỆP VỤ DO RPC GHI thì client KHÔNG cầm grant UPDATE · CHỐT

Cột nghiệp vụ mà đường ghi hợp lệ là một RPC cổng thì **client tuyệt đối không giữ quyền UPDATE cột đó** ở tầng API.
`ly_do_thua` + `ghi_chu_thua` **revoke khỏi `authenticated`** (db/212); đường ghi DUY NHẤT còn lại là `doi_trang_thai_don`
(SECURITY DEFINER, đã kiểm `prosecdef=true` trước khi revoke).

- **Lý do:** grant db/150 (QD-66) viết theo **danh sách CẤM** ("mọi cột TRỪ `trang_thai`") thay vì danh sách CHO PHÉP →
  mọi cột nghiệp vụ **sinh sau** (`ly_do_thua`/`ghi_chu_thua` từ db/036) **tự động lọt ra tầng API**. WP-72 (QD-94) chặn "đóng
  thua không lý do" ở tầng RPC, NHƯNG L-10A nghiệm thu bằng dữ liệu: `PATCH don_hang {ly_do_thua}` bằng JWT sale vẫn **THÀNH
  CÔNG** (bỏ cổng), và **không để lại vết ai sửa** (`don_hang_nhat_ky` chỉ ghi chuyển trạng thái, không ghi sửa cột đơn lẻ).
- **Bài học grant:** danh sách CẤM là bẫy — cột mới mặc định HỞ. Cột nghiệp vụ mới do RPC ghi phải revoke NGAY khi thêm.
- **Nghiệm thu (L-10B, role=authenticated, BEGIN/ROLLBACK):** chặn ĐỎ (`ly_do_thua`+`ghi_chu_thua` → permission denied) ·
  thông XANH (`doi_trang_thai_don` đóng thua → `ly_do_thua='gia_cao'`) · đối chứng XANH (`ghi_chu` vẫn UPDATE được — chỉ 2/70
  cột bị siết). Họ QD-64/66/67.

**Trạng thái:** db/212 áp prod (dump QD-61). Hồi quy: test_wp72 7/0 · test_091 7/0 · test_099 20/0 · test_146 12/0; test_036
chết ở kết nối (DATABASE_URL+SSL, nợ môi trường sẵn có — KHÔNG do revoke, logic dòng 49 vẫn đúng). CHƯA commit/tag — robot tầng
PostgREST + commit ở L-10C.

## QD-96 (02/09, WP-11b L-11b, db/213) — QUYỀN GHI TẦNG API KHAI THEO DANH SÁCH CHO-PHÉP, cột mới mặc định ĐÓNG · CHỐT

Grant UPDATE của client (`authenticated`) trên bảng nghiệp vụ **khai theo DANH SÁCH CHO-PHÉP (whitelist)**, VIẾT TAY tên từng cột —
**KHÔNG sinh động từ `information_schema`**. Cột `don_hang` sinh SAU **mặc định ĐÓNG** (không trong list = không grant).

- **Lý do (đảo db/150/QD-66):** db/150 grant theo **danh sách CẤM** ("mọi cột TRỪ trang_thai", sinh động) nên MỌI cột nghiệp vụ
  thêm sau tự hở ra tầng API. Đã trả giá 2 lần: `ly_do_thua` (WP-10, db/212) + `han_tra_loi` (db/209 phải vá riêng db/211). Danh
  sách CẤM là **bệnh cấu trúc**, không phải sự cố — cứ thêm cột là hở, không ai biết cho tới khi có người probe.
- **db/213:** revoke hết rồi grant lại **63 cột** viết tay = 41 cột client-ghi (donToRow 40 + `han_tra_loi`) + 22 cột NGỜ giữ hiện
  trạng. **Rớt 5** (0 client ghi): `id`·`ma_don`·`tao_luc` (định danh/mốc DB) + `la_demo`·`sale_phu_trach` (hệ-tự-ghi, ngoài payload).
  `nguoi_tao` GIỮ MỞ dù hệ-tự-ghi (db/153) vì `donToRow:74` còn gửi trong payload → gỡ khỏi payload rồi revoke ở lô UI sau.
- **TEST CANH bắt buộc** (`web/ops/test_grant_don_hang.mjs` + `db/grant_don_hang_whitelist.txt` một-cột-một-dòng): so grant thực
  tế với whitelist hai chiều — cột hở ngoài whitelist HOẶC revoke nhầm cột → ĐỎ, nêu tên cột.
- **Thêm cột nghiệp vụ mới = VIẾT RPC (SECURITY DEFINER), KHÔNG nới whitelist cho xanh test.** Đó là cả điểm của WP.
- **Nghiệm thu (L-11bB, BEGIN/ROLLBACK):** thông XANH (payload 40 cột donToRow + `han_tra_loi` UPDATE OK — màn Sale không chết) ·
  chặn (5 cột rớt + trang_thai/ly_do_thua → permission denied) · canh biết kêu (bẩn grant `la_demo` → test đỏ đúng cột). Họ QD-64/66/67.

**Trạng thái:** db/213 áp prod (dump QD-61). Hồi quy: test_wp72 7/0 · 091 7/0 · 099 20/0 · 146 12/0 · 116 48/0 · 117 24/0 ·
test_grant_don_hang 3/0; test_118 #2 (sdt cong_no) + test_036 (SSL) là nợ cũ owner/môi-trường, KHÔNG do revoke. CHƯA commit/tag —
kiểm cuối trình duyệt + robot ở L-11bC. Nhóm NGỜ (24 cột, gồm doanh_thu/gia_goc/ma_ky_ap_dung — 0 dòng thật) đo riêng lô sau.

## QD-97 (02/09, WP-11c L-11cB, db/214) — SIẾT 22 CỘT NGỜ don_hang: DB/RPC ghi thì client KHÔNG cầm grant · CHỐT

Nối tiếp QD-96: **thu quyền UPDATE của client (`authenticated`) trên 22 cột NGỜ còn lại** của `don_hang`. Whitelist **63 → 41 cột**.

- **Đo (L-11cA):** cả 22 cột **client GHI 0/22** — không cột nào nằm trong payload `sale.js:255` donToRow (40 cột) hay `sale.js:379`
  datHan. Đều do **DB/trigger/RPC SECURITY DEFINER** ghi (mốc thời gian, người phụ trách, cờ gấp, mốc báo giá, đếm món/tổ-hợp) →
  client không cần cầm grant (QD-95). 22 cột = 3 tài chính + 19 mốc/người/cờ.
- **3 cột tài chính:** `doanh_thu` (DB path db/021 ghi) · `ma_ky_ap_dung` (**0/6 dòng populated, KHÔNG hàm/trigger/client nào GHI**
  — 12 hàm "khả nghi" ở L-11cA hoá ra đều chỉ ĐỌC làm bộ lọc kỳ giá `where ma_ky_ap_dung = p_ma_ky`; comment db/028 "đóng dấu
  lúc chốt" là ý định CHƯA hiện thực) · `gia_goc` (**0 dòng, 0 writer**, chỉ còn ở 1 cột CSV export sale.html).
- **gia_goc: CEO chốt REVOKE, KHÔNG DROP** — chưa hiểu hết vòng đời cột thì không xoá; xét drop lại ở WP-11f. `ma_ky_ap_dung` cùng
  cảnh (dead-ish) nhưng vẫn là bộ lọc kỳ giá được ĐỌC → giữ cột, chỉ revoke quyền ghi.
- **Rủi ro thật DUY NHẤT** = trigger/RPC DEFINER ghi cột revoke có gãy không. **Nghiệm thu vế RPC:** `tao_don` (DEFINER, INSERT
  hard-code `trang_thai='bao_gia'`) → BEFORE trigger `trg_moc_bao_gia` **stamp `ngay_tao_bao_gia`** (cột vừa revoke) NGAY lúc tạo →
  SELECT thấy cột có giá trị. DEFINER chạy như owner → revoke trên `authenticated` KHÔNG chạm. ✓
- **Nghiệm thu 4 vế (L-11cB, BEGIN/ROLLBACK, jwt sale thật):** THÔNG (40 cột donToRow + `han_tra_loi` UPDATE OK — màn Sale sống) ·
  CHẶN (22 cột revoke + trang_thai/ly_do_thua/la_demo → permission denied 42501) · CANH (whitelist 41 khớp grant; bẩn `grant
  doanh_thu` trong tx → test bắt đúng cột) · RPC (trên) → **16/0**. Whitelist cập nhật CÙNG migration (bản khai ý định ↔ thi hành
  phải khớp; CẤM thêm cột vào whitelist cho xanh test — cột mới thì viết RPC).

**Trạng thái:** db/214 áp prod (dump QD-61). Hồi quy: test_wp72 7/0 · 091 7/0 · 099 20/0 · 146 12/0 · 116 48/0 · 117 24/0 ·
test_grant_don_hang 3/0 (41 cột) · test_wp11c 16/0. test_118 #2 + test_036 = nợ cũ owner/môi-trường, KHÔNG do revoke. CHƯA
commit/tag — probe prod + robot + commit gộp + tag ở L-11cC. Nhóm NGỜ đóng xong; còn 41 cột client-ghi thật.

## QD-98 (03/09, WP-11d L-11d, db/215+216+217+218) — 2 BẢNG TIỀN rời danh-sách-CẤM: luong_to đi RPC sẵn, tham_so_tai_chinh mở đúng 20/45 cột (1 RPC màn sống + 1 RPC cửa ngủ) · CHỐT

Nối QD-96/97: thu quyền ghi trực tiếp của client (`authenticated`/`anon`) trên **2 bảng THAM SỐ tiền** — cùng bệnh danh-sách-CẤM
(grant mọi cột, cột mới tự hở). Hai bảng ra **hai kết luận khác nhau** (đo L-11d-1):

- **`kho.luong_to` [A] — revoke thuần (db/215).** Mọi đường ghi ĐÃ qua RPC `ghi_so_tham_so_xuong` (SECURITY DEFINER, owner
  postgres, delete+insert 7 cột); client chỉ `.select` thẳng (taichinh.js:1372). Revoke INSERT/UPDATE/DELETE, **GIỮ SELECT 7**.
  Không đụng UI. Nghiệm thu: probe 2a/2b **403/42501**, RPC ceo **200**; robot app Tài chính tab Sổ tham số xưởng bấm Lưu **3/3**;
  md5 22 dòng giữ nguyên.
- **`kho.tham_so_tai_chinh` [B] — dựng RPC + swap UI + revoke, DB+UI CHUNG một lệnh (06 §1c) (db/216 RPC, db/217 revoke).**
  Đo có 2 call-site `.update` (20/45 cột): app Tài chính `luuKy` (13 cột) + app Sale `c2:cfg` (8 cột, trùng `vat`). Dựng 2 RPC
  `luu_tham_so_ban_hang`(13) + `luu_cau_hinh_van_hanh`(8) — SECURITY DEFINER, chặn vai ceo/ke_toan, UPDATE theo ma_ky (0 dòng→RAISE),
  chỉ 20 cột trong chữ ký. Swap 2 call-site `.update`→`rpc`, deploy 2 app, cổng bundle prod xác nhận, rồi revoke → giữ SELECT 45.
  Đường thẳng nay **403/42501** cả PATCH 13/PATCH 8/POST.
  - **ĐÍNH CHÍNH (L-11d-5/6):** chỉ **`luu_tham_so_ban_hang` phục vụ MÀN SỐNG** (Định giá bán, tab-ban — robot bấm nút "Lưu tham
    số kỳ" thật, DOM). **`luu_cau_hinh_van_hanh` CHƯA CÓ MÀN GỌI**: component `ThietLap` (màn c2:cfg, 8 ô) ĐỊNH NGHĨA ở
    togihome_sale.html:11078 nhưng **chưa từng mount** (không `createElement`, không NAV0, không router) → đường ghi c2:cfg là **cửa
    ngủ**. Robot L-11d-4 ghi qua `storage.set('c2:cfg')` = đúng tầng persistence nhưng KHÔNG phải màn DOM → khai "2 màn 7/7" là SAI,
    thực chỉ **1 màn DOM** nghiệm thu được. GIỮ NGUYÊN `luu_cau_hinh_van_hanh` (7 cột gio_mo_cua/ghi_de/n_* được ĐỌC ra cảnh báo thật,
    không đường ghi khác — luật [3] cấm gỡ cửa ghi duy nhất của tham số đang dùng); **nối màn ở WP-13b/WP-91** (dựng ThietLap).
  - **25 cột còn lại KHÔNG có đường ghi client** (he_so_m do `tinh_he_so_m`; mốc/ngưỡng/giờ do RPC con quy_ghi/nguong_ghi/dat_ship_du_toan).

- **Lý do:** bảng THAM SỐ (2 dòng / 22 dòng) không phải bảng SỔ → không đo perf (luật 00). Kỳ mới của tham_so_tai_chinh sinh ở
  **tầng owner** (seed db/028 / SQL owner), KHÔNG qua client (cả 8 app 0 `.insert`) → revoke INSERT không chặn tạo kỳ.
- **Test canh** (khuôn test_grant_don_hang): `test_grant_luong_to` 4/0 · `test_grant_tham_so` 4/0 — 0 cột ghi client, SELECT đủ,
  cột MỚI thêm KHÔNG tự mở. **Thêm cột tham số = cho vào RPC theo màn, ĐỪNG grant.**
- **Kỳ trùng ngày ĐÃ SỬA (db/218, L-11d-7):** kỳ 2026-08 nhập tay lệch `ngay_ap_dung`=2026-07-01 (trùng kỳ 07) → mọi chỗ chọn "kỳ
  hiện hành" bằng `order by ngay_ap_dung desc limit 1` (2 chỗ sale.js + 12 RPC: gia_san_don/cau_hinh_sale/bang_gia…) trả BẤT ĐỊNH,
  hôm nay lấy **kỳ 07** cho ngữ cảnh tháng 8. Sửa đúng 1 dòng: 2026-08 → **2026-08-01** (nay chọn đúng kỳ 08). Chặn trùng vĩnh viễn:
  `tstc_ngay_ap_dung_duy_nhat` (UNIQUE) + `tstc_ngay_khop_ma_ky` (CHECK tháng khớp ma_ky — gốc bệnh nhập tay lệch; CHECK+PK khiến
  trùng-ngày bất khả, UNIQUE dự phòng). test_ky_tham_so 5/0.
- **PHÁT SINH (ngoài WP-11d, không sửa):** (1) `ThietLap` code chết trong sale (chưa mount) + 7 cột (gio_mo_cua/ghi_de/n_ads/n_cac/
  n_kg/n_no/n_giam) được ĐỌC mà không màn sửa → chờ WP dựng màn. (2) `luuKy` rewrite 13 cột từ input mỗi lần Lưu (round-trip
  input≠DB không bit-identical). (3) tham_so_tai_chinh không có cột vết sửa → RPC không ghi ai/khi. (4) Không có đường tự phục vụ
  tạo kỳ mới trong app (sinh ở tầng owner).

**Trạng thái:** db/215+216+217+218 áp prod (dump QD-61). md5 luong_to giữ nguyên; tham_so_tai_chinh đổi ĐÚNG 1 cột (ngay_ap_dung
kỳ 08) — cố ý (db/218). CHƯA commit/tag — commit gộp + tag ở L-11d-8.

## QD-99 (03/09, WP-14b L-2, db/219) — MÚI GIỜ DB = Asia/Ho_Chi_Minh; ngày nghiệp vụ KHÔNG đi qua UTC · CHỐT

`SHOW timezone` của Postgres = **UTC** → `now()::date` / `current_date` trả **sai ngày mọi lúc 00:00–07:00 giờ VN**
(đo lúc L-2: `now()::date`=2026-09-02 khi VN đã 2026-09-03). Làm **~170 chỗ nghiệp vụ SQL** sai cùng một kiểu: DEFAULT ngày
chứng từ · `p_ngay` null→DB điền · hạn báo giá · hạn TT · xếp lịch tuần · cảnh báo đặt hàng · cửa sổ N ngày. **Sửa GỐC** (1 cấu
hình) thay vì 170 điểm. Đây là **BỆNH LẦN 2** (lần 1: bộ kéo Meta lệch −1 ngày, WP-90).

- **db/219:** `alter database postgres` + `alter role {authenticator, authenticated, anon, service_role, postgres}` **set timezone
  to 'Asia/Ho_Chi_Minh'`. Ghi vào 6 scope trong `pg_db_role_setting`.
- **Đường app THẬT (PostgREST) ĐÃ nhận VN:** REST trả `timestamptz` với offset **+07:00** (test canh vế 2). PostgREST nối TRỰC
  TIẾP (vai `authenticator`) → session mới nhận role-default VN.
- ⚠ **Node/script nối qua POOLER Supavisor VẪN thấy UTC** (Supavisor ghim `timezone=UTC` ở startup, `RESET timezone`→UTC). Đây
  KHÔNG phải đường app — chỉ ảnh hưởng script `ops/*`. Kiểm TZ phải qua REST (offset), không qua node.
- **An toàn (bước 0):** 0 CHECK/index/generated dùng now()/current_date (không dòng nào vi phạm khi đổi). `to_char(now(),'YY')` mã
  SP/brand: VN đúng hơn, chỉ lệch ở biên 31/12.
- ⚠ **NỢ NEO PARTITION:** `su_kien_quet` bound cũ neo `+00` (tuyệt đối, KHÔNG dịch). `tao_phan_manh_thang` (db/081) dùng
  `make_date` → SAU đổi TZ, partition MỚI tạo ở VN-midnight (+07), **lệch/chồng mốc UTC cũ**. 18 partition sẵn tới ~2028-01 nên
  chưa cấp bách; **NEO offset '+00' cho hàm ở lệnh sau**.
- **Test canh `test_tz_vn.mjs` 4/0:** catalog 6 scope VN · PostgREST offset +07 · logic VN đúng (mốc '2026-07-01 00:30+07'→date
  2026-07-01) · **PROVE-RED**: dưới UTC cùng mốc → 2026-06-30 (lùi 1 ngày — canh biết kêu).
- **Kiểm mắt:** app Tài chính + Kho boot, **console 0 lỗi**, DevTools thật (ảnh `wp14b_taichinh.png`, `wp14b_kho.png`). Tổng tồn
  bất biến TZ: SUM(ton.so_luong)=6389,84 khớp app(VN)=node(UTC).
- **PHẠM VI:** L-2 chỉ sửa DB. **JS trình duyệt vẫn dùng `toISOString().slice()` (15 chỗ nghiệp vụ) → còn lệch, sửa ở L-4.**
  `chot_don` stamp `ma_ky_ap_dung` → L-3.

**Trạng thái:** db/219 áp prod (dump QD-61). Hồi quy: test_tz_vn 4/0 · wp72 7/0 · 091/099/146 · grant×3 · rpc_tham_so 10/0 ·
ky_tham_so 5/0 · 116 48/0 · 117 24/0 · so_ba_nguon khớp (0 lệch). 0 đỏ mới. CHƯA commit/tag.

## QD-100 (03/09, WP-14b L-3, db/220) — ma_ky_ap_dung = kỳ tham số THỰC DÙNG, đóng dấu lúc chốt bởi chot_don, bất biến · CHỐT

`don_hang.ma_ky_ap_dung` = kỳ tham số THỰC DÙNG lúc chốt đơn, do `chot_don` ghi (qua `kho.ky_gia_hien_hanh()`), **KHÔNG suy từ
ngày chốt**. **ĐẢO kết luận WP-11c:** cột này THÔI là ứng viên DROP ở WP-11f — nó là bản ghi lịch sử cần thiết.

- **Lý do:** cổng tra giá (`gia_san_don`·`gia_bao_khach`·`tran_giam_gia` + 7 hàm giá) chọn dòng `tham_so_tai_chinh` bằng
  `order by ngay_ap_dung desc nulls last, ma_ky desc limit 1` = **kỳ MỚI NHẤT, KHÔNG lọc theo ngày**. Kỳ ra giá KHÔNG phải hàm
  của ngày chốt → **suy ngược theo ngày là SAI nguyên tắc** (không chỉ vì múi giờ — L-2/QD-99 đã vá TZ). Garrison ch.10: đóng dấu
  tại thời điểm giao dịch. Đo L-3: 3 cổng giá cùng một biểu thức (không phải ba sự thật) → gộp được.
- **db/220:** `kho.ky_gia_hien_hanh()` = MỘT nguồn sự thật cho "kỳ giá đang dùng" (04 §A cấm nhân bản); `chot_don` GỌI nó (không
  inline). ⚠ **10 hàm giá còn inline biểu thức y hệt (nợ CŨ, có trước L-3)** → consolidate cho chúng gọi lại ở lệnh riêng (cần
  golden byte-identical giá, không đụng pricing sống ở lệnh stamp này) — PHÁT SINH.
- **chot_don:** ghi `ma_ky_ap_dung = coalesce(ma_ky_ap_dung, ky_gia_hien_hanh())` — **chỉ khi NULL, KHÔNG đè**. Trả cờ
  `thieu_tham_so=(v_ky is null)`: khi chưa có dòng tham số thì NULL + cờ, **KHÔNG chặn sale chốt** (chặn bán hàng vì thiếu tham số
  hại hơn). Client không gửi gì thêm; cột ngoài whitelist từ db/214, KHÔNG mở lại.
- **Trigger `trg_chan_sua_ma_ky_ap_dung`:** đông cứng cột sau khi đóng dấu (họ `chot_luc` QD-50 — nhãn đã đóng là lịch sử).
- **KHÔNG backfill** đơn cũ (0 dòng có giá trị; đơn chốt trước cơ chế không biết kỳ nào — bịa là sai). COMMENT cột ghi rõ NULL =
  chốt trước cơ chế này.
- **Test `test_dong_dau_ky.mjs` 5/0:** 3.1 chốt→ma_ky_ap_dung=ky_gia_hien_hanh (2026-08) · 3.2 **cùng ngày, hai kỳ khác nhau**
  (A=2026-08, B=2026-09) chứng KHÔNG suy theo ngày · 3.3 sửa đã đóng dấu→CHẶN nguyên văn · 3.4 PROVE-RED (gỡ dòng stamp→NULL) ·
  3.5 PATCH JWT sale→403/42501 (db/214 chưa hở). Hồi quy: 146/grant_don_hang/rpc_tham_so/ky_tham_so/tz_vn + so_ba_nguon XANH, 0 đỏ mới.
- **Robot kiểm mắt (giới hạn trung thực):** đi tới MÀN CHỐT thật (nút "Chốt, lên đơn" hiện = luật 03/09), **console 0 lỗi**, ảnh
  `wp14b_l3_chot.png` (DevTools thật). **Chốt-hoàn-tất qua UI bị chặn vì đơn demo THIẾU MÓN** (validation UI cần món tên/màu/giá) —
  đây là order-setup, KHÔNG phải cơ chế stamp. Cơ chế đã chứng end-to-end bằng test 5/0 (gọi ĐÚNG rpc `chot_don` mà nút UI
  sale.js:241 gọi). Full UI end-to-end (đơn có món) để lệnh sau nếu CEO cần.

**Trạng thái:** db/220 áp prod (dump QD-61). CHƯA commit/tag.

## QD-101 (04/09, WP-13b L-2, db/222) — mở kỳ tham số bằng RPC + vết sửa + 7 tham số vận hành quyền CEO · CHỐT

CEO giao "tự quyết" 5 điểm (Q1–Q5). Tầng DB dựng xong; UI (app Tài chính tab Tham số) để lệnh sau.

- **(a) Mở kỳ mới = RPC `kho.mo_ky_moi(p_ky, p_chep_tu, p_chep_chi_phi, p_chep_luong)`** — vai ceo/ke_toan (khuôn
  `cpk_chep_ky_truoc`). Chép TOÀN BỘ cột tham_so từ **kỳ liền trước** + `chi_phi_ky` (tái dùng `cpk_chep_ky_truoc`) +
  `luong_to`/`phan_bo_hoat_dong` (tái dùng `ghi_so_tham_so_xuong`, dựng jsonb từ kỳ nguồn) — mỗi phần MỘT cờ bật/tắt.
  **Chỉ cho mở kỳ LIỀN SAU kỳ mới nhất** (chặn 3 lỗi tiếng Việt rõ: đã tồn tại · quá khứ · nhảy cóc); muốn khác → SQL tầng
  owner như db/221. **Lý do (Garrison ch.10):** định mức đặt cho kỳ TỚI, không phải chép lại kỳ cũ — hệ đang đúng bệnh
  09←08←07. Kỳ vừa chép mang **nhãn CHƯA SOÁT = `xac_nhan_luc IS NULL`** (KHÔNG chặn dùng); `xac_nhan_ky(p_ky)` bỏ nhãn.
- **(b) `tham_so_tai_chinh` +4 cột vết sửa** (`nguoi_sua·sua_luc·chep_tu_ky·xac_nhan_luc`, đều NULL được). Client **ĐỌC**
  được (SELECT 45→49) nhưng **KHÔNG ghi** — cột mới mặc định ĐÓNG với write (WP-11b); PATCH thẳng → 401/42501 (test T8 REST).
- **(c) 7 tham số vận hành sửa ở app TÀI CHÍNH tab Tham số, quyền CEO** (Q5: 7 cột nằm trong `tham_so_tai_chinh` đã kỳ-hoá,
  app Tài chính có sẵn ô Kỳ + đúng vai; component `ThietLap` ở app Sale để nguyên, không xoá). `luu_cau_hinh_van_hanh`
  **siết ceo/ke_toan → CEO thôi** (Q3) + ghi thêm `nguoi_sua/sua_luc`. **Nhãn thật 3 ngưỡng (đọc từ chỗ tiêu thụ
  `togihome_sale.html:10702`, không suy từ tên cột):** `n_ads`="chi quảng cáo trên doanh thu" (%) · `n_kg`="kilogam mỗi
  triệu" (kg/tr) · `n_giam`="giảm giá" (%). (`n_cac`="chi phí thu hút khách" đ · `n_no`="công nợ đã giao chưa thu" đ.)
- **2 ĐÍNH CHÍNH đầu bài WP-13b:** ① `gio_mo_cua` chỉ **1 app đọc** (sale.js:190 qua RPC `cau_hinh_sale`), KHÔNG phải 6.
  ② `n_ads/n_cac/n_kg/n_no/n_giam` **KHÔNG trùng** bảng `ads_nguong` của WP-93 (ads_nguong = 8 ngưỡng báo-động-ad có khoảng
  hiệu lực: chi_cao_khong_hoi_thoai, den_sat_tran_pct…; khác cả tên lẫn nghĩa) — không phải hai bảng danh mục.

**Test `test_mo_ky_moi.mjs` 17/0** (tx-rollback, không để rác prod): T1 md5 45 cột giá khớp kỳ nguồn + vết đúng · T2 đã-tồn-tại ·
T3 nhảy-cóc · T4 quá-khứ (2 nhánh) · T5 sale từ-chối · T6 cờ tắt=0/bật=khớp nguồn · T7 xác-nhận + gọi-lại-báo-đã · T8
authenticated 0-UPDATE/có-SELECT + REST 401/42501 · T9 ke_toan từ-chối/ceo-đổi-7-số+vết. **Hồi quy:** grant_tham_so 4/0
(SELECT 45→49, ghi vẫn 0) · rpc_tham_so 10/0 · grant_luong_to 4/0 · **ky_tham_so 5/0** (sửa fixture trôi: 2026-09 đã tồn tại
do db/221 → 5c dùng 2026-11, baseline count động — KHÔNG do db/222).

**Trạng thái:** db/222 áp prod (dump QD-61, backup 7.09MB). CHƯA commit/deploy/tag (L-2 chỉ DB; UI + commit ở lệnh sau).

## QD-102 (04/09, WP-13b L-6, db/223) — ky_gia_hien_hanh() = kỳ ĐÃ XÁC NHẬN mới nhất (chưa có → kỳ mới nhất) · CHỐT

CEO chốt (chat não, D-1): **giá chạy kỳ đã SOÁT, không chạy kỳ vừa chép**. Kỳ mới mở (mo_ky_moi) nằm **CHỜ**
(`xac_nhan_luc IS NULL`); giá vẫn chạy kỳ cũ tới khi CEO soát số và bấm **Xác nhận số kỳ này**.

- **db/223 · `ky_gia_hien_hanh()`** đổi: `coalesce( (kỳ xac_nhan_luc NOT NULL mới nhất), (kỳ mới nhất) )`.
  **Dự phòng khi CHƯA kỳ nào xác nhận = kỳ mới nhất** — hệ KHÔNG bao giờ mất giá. Hôm nay 3 kỳ 07/08/09
  đều chưa xác nhận → trả 2026-09 = **KHÔNG đổi giá lúc deploy** (test vế 1).
- **Một nguồn sự thật:** **10 hàm giá** THÔI inline `order by ngay_ap_dung desc limit 1`, GỌI `ky_gia_hien_hanh()`:
  `gia_san_don · gia_san_don_i · gia_bao_khach · gia_bac_tu_gv · bang_gia · tang_1_mon · gio_thiet_ke ·
  tran_giam_gia · kiem_giam_gia · cau_hinh_sale` (11 chỗ; kiem_giam_gia 2). Vá nợ 00/WP-91 (§QD-100 đã cảnh báo).
- **GIỮ NGUYÊN (ngoài họ giá):** `ban_giao_xuong` · `vuot_coc_canh_bao` (chọn **cọc%** `coc_toi_thieu_du_an_pct`
  theo `ma_ky = to_char(current_date,'YYYY-MM')` — chọn theo THÁNG, khác pattern, không phải giá) ·
  `mo_ky_moi` (cần kỳ-mới-nhất-THẬT để tính "liền sau", không phải kỳ giá). `chot_don` đã gọi sẵn (QD-100).
- **HỆ QUẢ phải biết:** xác nhận một kỳ **CŨ hơn** thì **giá LÙI về kỳ đó** (test vế 2: xác nhận 08 khi 09 chưa
  → giá về 2026-08). `chot_don` đóng dấu `ma_ky_ap_dung` theo `ky_gia_hien_hanh()` lúc chốt (test vế 5: kỳ 10
  chưa xác nhận → stamp 2026-09; xác nhận rồi → 2026-10).
- **Test `test_ky_xac_nhan.mjs` 9/0** (tx-rollback, 0 rác): 1 chưa-xác-nhận=2026-09 · 2 lùi-2026-08 (ĐỎ-được) ·
  3 cả hai=2026-09 · 4 mở-10-chưa=09/xác-nhận-10=10 · 5 chot_don stamp theo kỳ. Hồi quy: mo_ky_moi 17 ·
  ky_tham_so 5 · grant_tham_so 4 · rpc_tham_so 10 — XANH. UI dòng "Kỳ đang áp giá" (D1).

**Trạng thái:** db/223 áp prod (backup 7.11MB). UI + deploy L-6. **DỪNG chờ CEO kiểm mắt.** CHƯA commit/tag (commit ở L-7).

## QD-103 (04/09, WP-13b L-6b) — GIÁ THEO KỲ, BA LỚP TÁCH BẠCH · CHỐT (chỉ ghi sổ, KHÔNG code lớp 2/3 trong WP-13b)

CEO chốt: giá vận hành theo BA lớp độc lập. **RANH GIỚI: QD này KHÔNG được cài trong WP-13b** — lớp 2 (phần thiếu) và
lớp 3 (cảnh báo) tách WP riêng (xem phạm vi L-6b §C).

1. **Đơn ĐÃ CHỐT — giá bất biến, mang nhãn `ma_ky_ap_dung`** (QD-100). **Trạng thái: ĐANG CHẠY.**
   Bằng chứng A1: `chot_don` đóng dấu `coalesce(ma_ky_ap_dung, ky_gia_hien_hanh())`; trigger `trg_chan_sua_ma_ky_ap_dung`
   đông cứng; đơn đã chốt giữ `gia_chot` lưu, KHÔNG gọi lại hàm giá → đổi `ky_gia_hien_hanh()` (QD-102) không đụng đơn cũ
   (8 đơn qua chốt, 2 có nhãn — số cũ, không backfill).

2. **Báo giá đã gửi khách CHƯA chốt — đóng dấu giá lúc GỬI, giữ tới hết hạn** (7 ngày đơn lẻ / 21 ngày dự án, WP-72);
   hết hạn thì báo lại theo kỳ hiện hành. Lý do: báo giá là **lời hứa có thời hạn**, không phải con trỏ tới bảng giá.
   - **Đóng dấu giá: ĐANG CHẠY** — `tao_don` GHI `gia_chot/gia_cong_thuc/doanh_thu` lúc tạo báo giá; `sale_bao_gia_ds`
     ĐỌC cột lưu (KHÔNG gọi `gia_bao_khach`/`ky_gia_hien_hanh` live) → **báo giá đã gửi KHÔNG tự đổi giá khi kỳ đổi**.
   - **Hết-hạn-báo-lại-theo-kỳ: CHƯA CÓ CODE** — mốc hạn (`han_tra_loi`·`ngay_ket_thuc_bao_gia`, dùng ở `sale_bao_gia_ds`·
     `moc_bao_gia`·`sale_bao_gia_han_dem`) chỉ để ĐẾM/HIỂN THỊ; chưa có cơ chế hết hạn → tái định giá theo kỳ hiện hành.
     Cũng chưa gắn nhãn kỳ lên báo giá (chỉ đóng băng giá trị `gia_chot`, không con trỏ kỳ). → tách WP.

3. **Giá niêm yết (web/sàn) — chỉ đổi khi NGƯỜI sửa; đổi tham số kỳ KHÔNG bao giờ tự sửa `gia_niem_yet`.**
   - **"Không tự đổi": ĐANG ĐÚNG** — A3: `gia_niem_yet` (bảng `niem_yet`) chỉ ghi bởi `chot_niem_yet`/`tao_niem_yet`
     (người gọi); **KHÔNG trigger trên `niem_yet`, KHÔNG job/hàm kỳ-driven** nào sửa nó.
   - **Cảnh báo mã dưới giá sàn khi kỳ được XÁC NHẬN (QD-102): CHƯA CÓ** — A3: không hàm nào so `gia_niem_yet` với giá sàn.
     Cấm tự đổi giá; chỉ gửi cảnh báo CEO/người phụ trách giá. → tách WP.
   - **Phụ thuộc dữ liệu (A4):** 24 niêm yết đang bán, **0 tính được giá sàn** — `niem_yet.ma_bien_the` ("TA-*", từ nhập
     100 SP) KHÔNG khớp keyspace `san_pham_mau_gia_von` ("UB8D-*/SF-*", 14 dòng) → thiếu giá vốn per SKU. Cảnh báo lớp 3
     ngày đầu bật sẽ kêu **0 mã vì THIẾU GIÁ VỐN**, không phải vì mọi mã trên sàn. Nợ nền: map giá vốn catalog↔niêm yết (db058).

## QD-104 (04/09, WP-15b(2) L-10, db/224) — BÁO GIÁ: đóng dấu kỳ lúc gửi · hết-hạn là NHÃN · báo-lại chỉ khi người bấm · CHỐT

Cài lớp 2 của QD-103 ở tầng DB (UI để lệnh sau). **Hết hạn KHÔNG tự đổi giá — hết hạn là NHÃN; đổi giá CHỈ khi người bấm.**

- **Đóng dấu kỳ lúc gửi:** cột mới `don_hang.ma_ky_bao_gia` (khác `ma_ky_ap_dung` của đơn CHỐT, QD-100). Trigger
  `moc_bao_gia` stamp `ma_ky_bao_gia = ky_gia_hien_hanh()` khi tạo báo giá (cùng chỗ set `han_tra_loi`). **Cột mới ĐÓNG
  với client (WP-11b) — chỉ trigger/RPC DEFINER ghi.** (A4: KHÔNG có cột tương đương → cột MỚI, không đẻ trùng.)
- **Hạn THẬT = `han_tra_loi`** (= `ngay_tao_bao_gia` + `han_bao_gia_so_ngay(dong)`; **lẻ=7 · dự án=21**, phân loại theo cột
  `dong='du_an'`). `ngay_ket_thuc_bao_gia` = lúc rời báo giá. Set bởi trigger `moc_bao_gia` (WP-72).
- **Cờ hết-hạn = TRƯỜNG TÍNH, KHÔNG cột trạng thái, KHÔNG job:** `sale_bao_gia_ds` thêm `ma_ky_bao_gia` · `het_han`
  (bool) · `so_ngay_qua_han`, tính từ `han_tra_loi` so `current_date` (múi giờ DB đã VN, QD-99 — không toISOString).
- **RPC `bao_gia_lai(p_don_id)`** — báo lại theo kỳ, **CHỈ khi người bấm** (cấm job/tự động):
  - chặn nếu đơn KHÔNG còn ở báo giá (bao_gia/bao_gia_treo) — không lặp vụ chot_don đơn da_giao; chặn nếu CHƯA quá hạn
    (còn hạn → giữ giá đã đóng dấu, lớp 2); chặn nếu món thiếu sp_id/giá vốn (không tự tính lại được).
  - tính lại giá qua `gia_san_don()` (đã theo `ky_gia_hien_hanh()` = kỳ ĐÃ XÁC NHẬN, QD-102); ghi `gia_chot`/`doanh_thu`
    + `ma_ky_bao_gia` mới; **gia hạn `han_tra_loi` += 7/21 theo dòng**; vết `bao_gia_lai_luc`/`bao_gia_lai_boi` (khuôn
    nguoi_sua/sua_luc QD-101). Trả JSON **5 trường**: giá cũ · giá mới · kỳ cũ · kỳ mới · hạn mới (người dùng THẤY chênh lệch).
- **Ràng buộc dữ liệu (thật):** nhiều món **sp_id=null** (món chữ tự do) → server không tự tính lại được → RPC báo lỗi
  tiếng Việt rõ, KHÔNG đoán. Recompute chỉ chạy cho món có sp_id + giá vốn trong `san_pham_mau_gia_von`.
- **Test `test_bao_gia_lai.mjs` 11/0** (tx-rollback): 1 còn-hạn+kỳ-đổi→giá giữ nguyên · 2 quá hạn→het_han+số ngày · 3
  báo-lại đổi giá/kỳ/hạn+JSON 5 trường · 4 còn-hạn chặn · 5 đã-giao chặn · 6 client PATCH cột mới 401/403 · 7 dự án +21.
  Hồi quy: ky_xac_nhan 9 · mo_ky_moi 17 · grant_don_hang 3 · **dong_dau_ky 5** (vá drift db/221: 2026-09 đã tồn tại → dùng 2026-10).

**Trạng thái:** db/224 áp prod (dump QD-61, backup 7.12MB). UI báo-giá-lại + cờ hết-hạn để lệnh sau. CHƯA commit/deploy.

## QD-105 (04/09, WP-17b(1) L-14, db/225) — xoa_demo dọn ĐỦ: NỚI append-only su_kien_meta ĐÚNG MỘT ĐƯỜNG · CHỐT

Cổng hồi quy phải **xoá sạch được sau mỗi vòng** (nếu không tự bẩn dần, mất tác dụng — L-9/L-12 tích T9-010/T9-011).
Blocker duy nhất (L-13) = **`su_kien_meta`** (append-only WP-77 + FK NO ACTION, không escape). NỚI luật WP-77 **đúng một đường**:

- **db/225:** `su_kien_meta.don_id` + `don_hang_lead_nhat_ky.don_id` → **ON DELETE CASCADE**; trigger `sm_chan_sua`/`dhlnk_chan_sua`
  thêm **escape DELETE HẸP NHẤT**: cho xoá CHỈ khi `current_setting('kho.xoa_demo')='1'` **VÀ** dòng thuộc đơn `la_demo=true`.
  Ngoài đó DELETE vẫn raise nguyên như cũ. **KHÔNG tắt trigger** — đây là policy-theo-la_demo, đúng khuôn `chan_sua_moc_chot`
  (MOC_CHUAN) đã có → người sau đọc thấy MỘT lối, không hai lối.
- **Bẫy CASCADE:** escape đòi `exists(don_hang la_demo)`, mà lúc CASCADE cha đã bị xoá → check false → trượt. Vì vậy
  **`xoa_demo` xoá `su_kien_meta`/`lead_nhat_ky` TƯỜNG MINH TRƯỚC `don_hang`** (lúc cha còn) + bổ sung NO ACTION không-cascade
  (`tem_ban_ve`, `mon_doi_phien_ban`). Bảng CASCADE khác để nguyên (tự cascade). `xoa_demo` đã set GUC `kho.xoa_demo=1` (L13).
- **Dữ liệu THẬT vẫn append-only TUYỆT ĐỐI:** chỉ dòng đơn `la_demo` mới xoá được, chỉ qua `xoa_demo`. Đơn thật (dù GUC=1) bị chặn.
- **`giao_dich`/`su_kien_quet` KHÔNG đụng** (QD-44/45; hai sổ không nối đơn) — cố ý giữ, không sót.
- **Test `test_xoa_demo.mjs` 6/0:** 1 xoá-sạch T9-010 (su_kien_meta 1→0) · 2 **đơn THẬT REAL-XD1 + con NGUYÊN** (ca quan trọng
  nhất) · 2b la_demo→0 · 3 DELETE không-GUC chặn · 4 DELETE đơn-thật-có-GUC VẪN chặn (escape đòi la_demo) · 5 giao_dich/su_kien_quet
  giữ. Hồi quy: bao_gia_lai 11 · ky_xac_nhan 9 · mo_ky_moi 17 · grant_don_hang 3 · dong_dau_ky 5.

**Trạng thái:** db/225 áp prod (dump QD-61, backup 7.14MB). Dọn 9 đơn demo thật (C). CHƯA commit.

## QD-106 (04/09, WP-17b(2) L-15, db/226) — quản đốc MỞ PHIÊN HỘ nhiều trạm (phien_tram/mo_phien) · CHỐT

**ĐÍNH CHÍNH L-13 §C4 (tôi kết luận nhầm):** nguồn "ai làm" của quét (`sq_ghi` → `phien_nguoi`) là **`kho.phien_tram`**
(mở bởi **`mo_phien`**), **KHÔNG phải `ca_lam`** (mở bởi `mo_ca`). `ca_lam` **KHÔNG hàm giờ-công/sản-lượng nào đọc** (chỉ
2 hàm hiển thị `tram_man`/`tram_ca_hom_nay` chọn theo `ma_tram` — an toàn) → để nguyên, coi như đóng băng. CEO chốt sửa
**đúng bảng phien_tram**, không đụng ca_lam/mo_ca.

- **`mo_phien` VỐN đóng phiên theo TRẠM (nhường trạm), KHÔNG theo người** → một người ĐÃ giữ được nhiều trạm sẵn (không cần
  bỏ auto-close như tưởng ở A2). Nút thắt bước-8 THẬT: demo gọi **nhầm `mo_ca`** (ca_lam, vô dụng với quét) thay `mo_phien`.
- **db/226:** `phien_tram` +cột **`nguoi_mo`** (ai BẤM; NULL=thợ tự mở; client ĐÓNG WP-11b, chỉ SELECT). `mo_phien` thêm:
  mở **HỘ** (`p_nguoi ≠ current_ns()`) **chỉ vai xuong/ceo**; ghi `nguoi_mo=người bấm`. **`nguoi_id` vẫn = người LÀM** →
  giờ công/quét (`phien_nguoi`) gán đúng người làm, KHÔNG bao giờ gán quản đốc. Idempotent (mở trùng → `da_mo=true`).
- **A3 rà chỗ đọc ca_lam:** 3 hàm (`sq_ghi` dùng phien_tram không ca_lam · `tram_man`/`tram_ca_hom_nay` chọn theo `ma_tram`)
  — **KHÔNG chỗ nào giả định "một người một ca" theo nguoi_id** → không sửa lan (≤3 chỗ, an toàn).
- **Không đẻ vai mới:** dùng `tram_gac_vai` (tho/xuong/ceo); chỉ thêm quyền **mở hộ** cho xuong/ceo.
- **Test `test_mo_phien_ho.mjs` 7/0:** 1 thợ tự mở→nguoi_mo NULL · 2 xuong mở hộ A ở 2 trạm→A giữ ≥2, nguoi_mo=xuong ·
  3 thợ mở hộ→từ chối · 4 mở hộ trùng→da_mo=true · 5 `phien_nguoi`=A (người LÀM, không quản đốc) · 6 client PATCH nguoi_mo 403.
  Hồi quy: xoa_demo 6 (vá fixture T9-010 đã xoá L-14) · bao_gia_lai 11 (vá fixture T9-007/008) · ky_xac_nhan 9 · mo_ky_moi 17 ·
  grant_don_hang 3 · dong_dau_ky 5 · **wp46 (phiên thợ)**.

**Trạng thái:** db/226 áp prod (dump QD-61, backup 7.14MB). Demo bước-8 đổi mo_ca→mo_phien + UI mở-hộ ở L-16. CHƯA commit.

## QD-107 (04/09, WP-18b(1) L-19, db/227) — MỘT NGUỒN cho "món của lượt quét" = tem_ban_ve.mon_id · CHỐT

Gốc lỗi (L-18, chẩn lại tận gốc): `day_tem_ban_ve` — hàm DUY NHẤT tạo tem — **không ghi `tem_ban_ve.mon_id`**
(WP-08 thêm cột + versioning nhưng đường đẩy tem không nối dây). `sq_ghi`/`sq_tem_mon` resolve món của
lượt quét **CHỈ** qua `tem.mon_id`, nên luôn nhận NULL → SAI_TRAM (`"quy trình không có bước cho trạm này"`)
**mọi** lượt quét, BẤT KỂ quy trình. Nhãn L-16/L-17 "SP demo thiếu quy_trinh_buoc" là đọc nhầm thông báo —
mã đó nổ cả khi mon_id=NULL.

CEO chốt **phương án (a)** (CẤM (b) — không fallback "đơn 1 món" ở `sq_ghi`, kể cả tạm):

- **NGUỒN DUY NHẤT resolve món lượt quét = `tem_ban_ve.mon_id`.** `plan_don`/`trams_don.mjs` đọc `don_hang_mon`
  **CHỈ** để LẬP KẾ HOẠCH (liệt kê trạm cần quét), **CẤM** dùng resolve lượt quét (họ bệnh hai-bản atp/neo_xuoi).
  A3 xác nhận: mọi đường quét (sq_ghi · sq_tem_mon · tram_quet · viec_dang_giu · chay_lai_back_flush) đều đi
  qua `tem.mon_id`; `don_hang_mon` chỉ JOIN lấy TÊN/BOM SAU khi có mon_id → không có nguồn thứ hai (không sửa sq_ghi).
- **Luật gán mon_id ở `day_tem_ban_ve` (3 nhánh, CEO chốt):**
  1. Nguồn ĐẨY gửi `t->>'mon_id'` (plugin WP-31 đã biết món qua `gan_mon`) → validate thuộc ĐƠN NÀY → ghi thẳng.
  2. Nguồn không gửi + đơn **đúng 1 món** → gán món duy nhất đó.
  3. Nguồn không gửi + đơn **nhiều món** (hoặc 0) → **RAISE** (nói rõ mấy món + cần gửi `mon_id`). CẤM đoán/gán bừa.
  Gửi mon_id của đơn KHÁC → RAISE (không gán chéo đơn).
- **FK `tem_ban_ve.mon_id` → `don_hang_mon` ON DELETE CASCADE** (họ bài học WP-17b: cha xoá → tem con xoá theo,
  xoa_demo dọn được, không tái lập blocker). Client **ĐÓNG** cột (bỏ table-level ghi + column-grant mon_id, mẫu don_hang).
- **KHÔNG backfill tem cũ mon_id NULL** — đều là demo, `xoa_demo` dọn.
- **Plugin gửi mon_id qua `meta_tam` + đóng vòng robot = việc (2)(3), lô sau (L-20).** L-19 chỉ nối tầng DB.

Test `test_tem_mon_id.mjs` 10/0: 1 nguồn gửi→ghi đúng · 2 một-món→gán duy nhất · 3 nhiều-món→RAISE · 3b gán-chéo-đơn→RAISE ·
4 chuỗi thật (quét trạm trong quy trình KHÔNG SAI_TRAM · trạm ngoài vẫn chặn) · 5 hai món mỗi tem đúng món · 6 xoa_demo CASCADE ·
7 client PATCH mon_id chặn. Hồi quy 10 cổng xanh; wp43/44/45/47 vẫn đỏ (nợ fixture T8-001, xử L-20).

## QD-108 (05/09, WP-18b(2)(3) L-20/21, db/228) — dong_phien: NỬA CÒN THIẾU của cặp mo_phien/dong_phien · CHỐT

`dong_phien(p_tram)` — đóng phiên trạm qua ĐƯỜNG NGHIỆP VỤ. **Guard KHỚP mo_phien:** thợ đóng phiên
CỦA MÌNH; đóng HỘ người khác chỉ quản đốc (xuong/ceo). Đóng phiên đã đóng → `da_dong=false`, KHÔNG raise
(không lỗi lặp). Client **KHÔNG** ghi thẳng `phien_tram.ket_thuc` (chỉ qua RPC — cột đóng WP-11b).

**Lý do sinh ra:** trước đó KHÔNG có đường đóng phiên (chỉ `mo_phien` đóng-khi-mở-mới; UI "Không phải tôi"
= nhượng, vẫn để mở). Không có nó thì phiên treo lại sau mỗi vòng demo → cổng hồi quy tự bẩn
(uq_phien_tram_mo, họ bài học WP-17b). Robot (L-20/21) gọi `dong_phien` cuối vòng → phiên treo=0.

**KHAI THẲNG PHẠM VI:** `db/228` sinh trong lô WP-18b(2)(3) ở **L-20** — **NGOÀI phạm vi lệnh L-20**
("plugin + 4 test + robot"). Tạo vì C/D cần đường-nghiệp-vụ-đóng-phiên mà lệnh C2 chỉ tới ("gọi RPC");
không giấu. Hợp thức ở QD này (L-21), đóng gói commit ở L-22.

Test `test_dong_phien.mjs` 5/0: 1 thợ tự đóng ✓ · 2 thợ đóng người khác ✗ (chỉ quản đốc) · 3 xuong đóng hộ ✓ ·
4 đóng phiên đã đóng → da_dong=false không lỗi lặp · 5 client KHÔNG UPDATE ket_thuc.

**Nối dây robot (QD-107 họ hàng):** bước GHI của quét đi qua MÀN thật; đẩy đơn cho_giao KHÔNG bằng
`tien_mon` qua RPC (đi-tắt = KẸT theo luật 00) mà bằng **bấm nút "Xong bước" (#pXong) trên màn Xưởng**
(`xuong.js:461 xongBuoc→tien_mon`) — đó là BƯỚC NGƯỜI LÀM. L-16 bỏ đường-RPC-tắt là đúng; L-21 thay
bằng cú bấm trên màn (không đảo quyết định CEO).

## QD-110 (05/09, WP-90 mở lại L-23) — NGHIỆM THU DỮ LIỆU KÉO BẰNG CHÍNH NGUỒN NGOÀI + kiểm ĐỘ PHỦ · CHỐT

**Luật:** Số kéo từ nguồn ngoài (Meta, Pancake, ngân hàng…) chỉ coi là ĐẠT khi đối chiếu với **CHÍNH nguồn
ngoài đó**. So bảng này với bảng khác TRONG hệ là **nghiệm thu VÒNG TRÒN**: kéo thiếu thì hai bên vẫn khớp và
vẫn sai. Và phải kiểm **ĐỘ PHỦ** (đủ ngày, đủ đối tượng) — KHÔNG chỉ kiểm tổng.

**Sự cố gốc (L-21→L-22):** L-21 nghiệm thu "chi_ads khớp chi_ads_ngay tuyệt đối" — hai chỗ CÙNG hệ, cùng nguồn.
Nhưng cả hai cùng thiếu 22/31 ngày tháng 8 (cửa sổ kéo 7 ngày chưa chạy đều, chỉ chạm 08-23→08-31). Hỏi Meta
mới lộ: **sổ thiếu 77% chi ads tháng 8** (9,79tr / 42,64tr thật). Cùng họ WP-79: nghiệm thu bằng ĐỊNH NGHĨA,
không bằng dữ liệu chạy.

**Hệ quả bắt buộc:** mọi WP kéo dữ liệu ngoài từ nay, trong điều kiện XONG phải có **một phép đối chiếu với
nguồn ngoài** + kiểm **độ phủ** (đủ ngày × đủ đối tượng), không chỉ tổng.

- **RPC `chi_ads_kiem_do_phu(p_tu,p_den)`** (db/230): đo coverage theo **mốc đã kéo** (`ads_moc_keo.khoang`),
  KHÔNG theo row — ngày KHÔNG-tiêu-tiền không có row nhưng VẪN đã kéo → không tính trống (nếu đếm row thì
  auto-backfill kéo lại vô hạn ngày-0-đồng). Coverage là TOÀN-tài-khoản (một lượt kéo cả 6 TK) → báo theo THÁNG;
  gap per-account (một TK Meta lỗi riêng) nghiệm thu bằng Meta, không bằng đếm row.
- **Bộ kéo tự kéo bù:** `keoChiAdsMetaNhip` đọc do_phu 90 ngày → kéo bù ngày CHƯA KÉO rồi cửa sổ 7 ngày
  (GIỮ NGUYÊN, bắt số Meta chốt muộn). Idempotent. Lịch chạy đều = khuôn worker sẵn có (scheduler ở L-91.3),
  KHÔNG đẻ cron thứ hai.
- **Nạp lịch sử 90 ngày (L-23):** chi_ads_ngay 44→604 dòng (89 ngày, 06-07→09-05); tháng 8 **Meta=Sổ=42.643.934 · chênh 0%** (từ 77%
  thiếu); 90 ngày Meta 117,62tr vs sổ 117,62tr (chênh 2.216 ≈ 0%, Meta chốt muộn 2 TK). do_phu sau nạp: mọi
  tháng ĐỦ. CAC tháng 8 vẫn vô hạn — vì **0 đơn** (chuyện thiếu đơn), KHÔNG phải chuyện chi ads (số chi nay đúng).

Test: `test_chi_ads_do_phu.mjs` 3/0 (do_phu phát hiện đúng ngày trống · ngày-0-đồng-đã-kéo KHÔNG tính trống ·
nạp 2 lần không nhân đôi). Nền sổ mốc: `test_ads_moc_keo.mjs` 10/0 (QD-109).
