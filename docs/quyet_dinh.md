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
