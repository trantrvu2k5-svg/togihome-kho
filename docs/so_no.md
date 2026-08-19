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

## Dữ liệu demo LỆCH seed — CỐ Ý (đừng tưởng lỗi)
Hai chỗ trạng thái đơn demo khác seed db/063 là **cố ý**, CEO đã duyệt giữ nguyên (2026-08-14):
- **CAN-A-DEMO:** `ma_ns_thiet_ke` + `buoc_thiet_ke` gán ở L-11 (seed = null/null). GIỮ — để đơn có người cầm,
  minh hoạ màn "Việc của tôi" và luồng bàn giao. **KHÔNG phải lỗi.**
- **DEMO-13:** gán qua RPC app (giao_viec/nhan_viec) ở phiên trước L-12. GIỮ — đây là đơn dùng thử **món tự do**
  (2 món sp_id=null). **KHÔNG phải lỗi.**

⚠ **Trái lại: mọi khác biệt của `so_don_vi_mon` với seed db/063 thì LÀ LỖI — phải DỪNG và soi.**
(Bối cảnh: L-10b từng ghi đè số Kệ tivi thành 18 → giờ đơn phình 34,10→47,96; xem ~/Downloads/soi_gio_48.md.)

## CÒN HỞ — số đóng băng nhưng GIỜ chưa (db/070, QD-15)
Mốc `chuan` chốt lúc bàn giao đóng băng **SỐ ĐƠN VỊ** (trigger cấm sửa). NHƯNG `gio_du_kien_cua_mon/_don`
vẫn nhân số đó với **PHÚT của `quy_trinh_buoc` HIỆN TẠI**. Nên nếu sửa PHÚT (gio_moi_don_vi) của một quy
trình, **GIỜ (và giá vốn) của đơn ĐÃ bàn giao vẫn đổi theo** — dù số đã đóng băng.
- **Đo được:** đơn cho_cat dùng TU-AO-MELAMINE, sửa phút bước cat 0,10→0,50 → giờ đơn 23,15→27,82.
- **Chưa vá (cố ý, CEO chốt L-13a):** lô này chỉ đóng băng SỐ. Đóng băng PHÚT (snapshot đơn giá/phút lúc bàn
  giao) để **lô sau**. Tab Quy trình (L-13) khi cảnh báo "món đã bàn giao giữ số cũ" phải nói RÕ: giữ **số**,
  còn **giờ** vẫn có thể đổi cho tới khi vá nốt phút.

## ĐÃ VÁ — đóng băng phút + đơn giá (db/071, QD-16)
Lỗ hở "số băng nhưng GIỜ chưa" (QD-15) **đã đóng**: bàn giao chốt cả phút (`gio_moi_don_vi_chot`/
`gio_co_dinh_chot`) và đơn giá (`don_gia_chot`). Sửa quy trình/đơn giá về sau KHÔNG đổi giờ+giá vốn đơn đã
bàn giao (đo: đơn cho_cat 23,15 giữ 23,15 khi sửa phút; đơn chưa bàn giao 23,15→27,82). test_071 8/0.

**Đơn cũ thiếu số chốt (VIỆC 3):** quét prod → **0 đơn** cho_cat+ có số chuan (các đơn demo cho_cat đều là món
tự do chưa nhập số). Không đơn nào cần vá, không chép số hiện tại vào (tránh bịa lịch sử). Hàm giờ vẫn trả cờ
`thieu_so_chot` nếu sau này gặp đơn cũ như vậy — không im lặng.

**Residual nhỏ CÒN LẠI:** bước `tu_chay` (chờ khô) KHÔNG có dòng số → phút của nó không đóng băng được qua cơ
chế cột-trên-số-row; giờ bước tu_chay vẫn LIVE. Quy trình đang dùng (TU-AO-MELAMINE) không có tu_chay nên đơn
hiện tại không dính. Đóng băng tu_chay để lô sau nếu có quy trình dùng nó cho hàng đã bàn giao.

## NỢ VẬN HÀNH — PHÂN MẢNH su_kien_quet (db/081, L-26)
**Việc lặp MỖI NĂM:** chạy `kho.tao_phan_manh_thang(nam, thang)` thêm đủ 12 tháng của năm KẾ TIẾP,
trước khi năm đó tới. Hiện đã tạo tới **2027-12**.
```sql
-- ví dụ tạo cả năm 2028 (chạy trong 2027):
do $$ declare d date := date '2028-01-01';
begin while d <= date '2028-12-01' loop
  perform kho.tao_phan_manh_thang(extract(year from d)::int, extract(month from d)::int);
  d := (d + interval '1 month')::date; end loop; end $$;
```
**⚠ CẢNH BÁO:** không thêm tháng thì dòng sổ quét của tháng thiếu rơi vào phân mảnh **DEFAULT** — KHÔNG lỗi,
KHÔNG ai biết, nhưng DEFAULT phình dần → truy vấn theo `luc` chậm dần (mất lợi ích phân mảnh). Không vỡ ngay,
hỏng ngầm. Đặt nhắc lịch hằng năm.

## NỢ HIỆU NĂNG — RPC trả danh sách KHÔNG giới hạn (L-29 VIỆC 4) — ✅ ĐÃ VÁ HẾT (L-51/db-118)
> Phát hiện khi vá phân trang 3 RPC xưởng (v-kho-78). **L-51 (db/118) đã thêm LIMIT trần cho cả 6 RPC còn lại** →
> nợ này ĐÓNG. `gia_von_don_ds` đã vá L-65 (db/098). Ước ở **3.000 đơn**.
>
> **CÁCH VÁ (bài học quan trọng — GIỮ CHỮ KÝ, KHÔNG thêm param):** thêm `limit <trần>` BÊN TRONG hàm, GIỮ NGUYÊN chữ ký gốc
> (zero-arg vẫn zero-arg). ⚠ **KHÔNG dùng `p_gioi_han int default N`** — nó tạo overload `(int,int)` SONG SONG bản `()`; khi test
> tự-nạp-lại migration cũ (test_054/056/057 nạp db/054…) tái tạo bản `()` → gọi `f()` khớp CẢ HAI → `function is not unique`
> (đã vấp NGAY trong L-51, bản đầu). Trần: 1000 (đơn/việc) · 2000 (sp niêm yết) — chặn thảm hoạ, không cắt dữ liệu thật.

| RPC | Màn đang gọi | Trạng thái |
|---|---|---|
| ~~`gia_von_don_ds`~~ ✅ SỬA L-65 | Tài chính · "Giá vốn theo đơn" | phân trang (db/098) |
| ~~`xuong_don_cho_vao_chuyen`~~ ✅ L-51 | Xưởng · Quản đốc | LIMIT 1000 (db/118) |
| ~~`can_ceo_quyet`~~ ✅ L-51 | Xưởng · Quản đốc | LIMIT 1000 khối group-by (db/118) |
| ~~`sp_danh_sach`~~ ✅ L-51 | Sản phẩm (app #6) | LIMIT 2000 (db/118) |
| ~~`tk_bang_cong_viec`~~ ✅ L-51 | Thiết kế · bảng công việc | LIMIT 1000 (db/118) |
| ~~`tk_viec_cua_toi`~~ ✅ L-51 | Thiết kế · việc của tôi | LIMIT 1000 (db/118) |
| ~~`tk_don_cho_nhan`~~ ✅ L-51 | Thiết kế · đơn chờ nhận | LIMIT 1000 (db/118) |

**Bọc N+1 liên quan (không phải "list không limit"):** `web/src/xuong.js:taiViec` gọi `xuong_mon_cua_don` **một lần
mỗi đơn** → nổ N lời gọi. v-kho-78 đã chặn xuống **50/lần** nhờ gom-dồn `taiDon`, nhưng gốc N+1 vẫn còn.

**Đã chặn rồi (KHÔNG lo):** `tram_dang_cho` (limit 50 + phân trang, v-kho-76) · `tram_luot_gan_day` (limit 8) ·
`kanban_xuong`/`viec_uu_tien`/`xuong_don_san_xuat` (phân trang, v-kho-77+78) · các list cấu hình/danh mục (tổ,
hoạt động, lý do, quy trình, người dùng…) chặn theo bản chất. `sale_mon_cua_don` không limit nhưng bó theo số món/đơn (nhỏ).

## ĐÃ VÁ — chuông "bản chờ gửi" mọi sale thấy chung (nợ L-45 · vá L-71 db/101)
Gốc: đơn báo giá **chưa có cột chủ đơn** nên chuông `sale_ban_cho_gui` (db/087) réo chung cả phòng. **Vá L-71:**
thêm cột `don_hang.sale_phu_trach` (→ nguoi_dung), tự gán = người tạo lúc INSERT (trigger), backfill đơn cũ từ
nhật ký. Siết `sale_ban_cho_gui` + `sale_bao_gia_ds` theo chủ: **sale thường chỉ ĐƠN MÌNH**, truong_nhom_sale/ceo
CẢ NHÓM (thêm một vế lọc `sale_phu_trach = current_ns()`). Đổi chủ qua `doi_sale_phu_trach` (chỉ trưởng nhóm/ceo,
ghi nhật ký). Xem QD-26. Giữ trong sổ để không nghi lại.

## ĐÃ VÁ — huỷ đơn qua trang_thai='huy' (phát hiện L-48 · vá L-50 db/090)
Trigger `ghi_nhat_ky_don` (db/042) từng chèn `don_hang_nhat_ky` **KHÔNG có `ly_do`** → khi `den='huy'`/`tam_ngung`
vướng `chk_nk_huy_ly_do` (db/022) → mọi lệnh huỷ/tạm ngưng bị chặn.
- **ĐÃ VÁ (db/090):** `ghi_nhat_ky_don` chép `new.ly_do_huy` vào `don_hang_nhat_ky.ly_do` khi `den in
  ('huy','tam_ngung')`. KHÔNG nới constraint. Huỷ KHÔNG lý do vẫn bị chặn ở tầng `don_hang` check (db/021).
- **Đo (test_090 3/0):** huỷ CÓ lý do → chạy + nhật ký chép đúng lý do · huỷ KHÔNG lý do → chặn · tạm ngưng
  CÓ lý do → chạy. (Đã XOÁ HẲN đơn rác T8-015 ở L-48 vì lúc đó chưa vá.)

## test_sale_kiem — tài khoản kiểm tự động (L-54)
test_sale_kiem: tài khoản kiểm tự động, mật khẩu riêng trong .env.test, CEO duyệt giữ lâu dài (L-54).

## test_tk_kiem — tài khoản kiểm app Thiết kế (L-61)
test_tk_kiem: tài khoản kiểm tự động vai tk_ban_hang, mật khẩu riêng trong .env.test, CEO duyệt GIỮ LÂU DÀI (L-61) — để bấm-thật app Thiết kế (khối "Khách muốn gì"…) các lô sau. Tạo qua RPC chuẩn qly_them_nguoi.

## test_kho_kiem / test_tc_kiem — tài khoản kiểm app Kho + Tài chính (L-64)
test_kho_kiem (vai kho) + test_tc_kiem (vai ke_toan): tài khoản kiểm tự động, mật khẩu riêng trong .env.test, CEO duyệt GIỮ LÂU DÀI (L-64) — để rà/bấm-thật app Kho + app Tài chính các lô sau. Tạo qua RPC chuẩn qly_them_nguoi.

## test_tns_kiem — tài khoản kiểm trưởng nhóm sale (L-72)
test_tns_kiem (vai truong_nhom_sale): tài khoản kiểm tự động, mật khẩu riêng trong .env.test, CEO duyệt GIỮ LÂU DÀI (L-72) — để bấm-thật màn "Nhóm của tôi" (app Sale) + đổi chủ đơn các lô sau. Tạo qua RPC chuẩn qly_them_nguoi.

## test_tntk_kiem — tài khoản kiểm trưởng nhóm thiết kế (L-73)
test_tntk_kiem (vai truong_nhom_thiet_ke): tài khoản kiểm tự động, mật khẩu riêng trong .env.test, CEO duyệt GIỮ LÂU DÀI (L-73) — để bấm-thật khối "Nhóm" app Thiết kế. Tạo qua RPC chuẩn qly_them_nguoi (db/103 vừa THÊM 'truong_nhom_thiet_ke' vào whitelist qly_them_nguoi + qly_doi_vai — vai đã có trong guard nhưng trước chưa gán được).

## test_xuong_kiem — tài khoản kiểm quản đốc xưởng (L-74)
test_xuong_kiem (vai xuong): tài khoản kiểm tự động, mật khẩu riêng trong .env.test, CEO duyệt GIỮ LÂU DÀI (L-74) — để bấm-thật khối "Nhìn lại" app Xưởng (giờ chuẩn-vs-thực · lỗi&làm-lại · tắc quét). Tạo qua RPC chuẩn qly_them_nguoi.

## NỢ TEST ĐỎ PRE-EXISTING — 5 test + overload gui_ban_thiet_ke (rà L-51, chưa do L-51)
> Rà khi sweep test cho L-51 (dọn nợ). Các đỏ này CÓ TRƯỚC L-51, do các lô trước làm test-drift; **KHÔNG do db/118**.
> db/118 (L-51) đã kiểm sạch: test_118 24/0 + test_116 48/0 (dieu_hanh + drop khach_sdt không vỡ). Xử ở **lô riêng**.

| Test | Đỏ vì | Gốc (lô nào) | Cách xử dự kiến |
|---|---|---|---|
| `test_043` | `can_ceo_quyet` không ra `gap_chen_don_tre` — dữ liệu `viec_uu_tien` không dựng đủ tình huống | logic viec_uu_tien | dựng lại seed test cho 5 luật ưu tiên |
| `test_045` | test kỳ vọng `xuong_don_cho_vao_chuyen` trả `cho_cat`/`cho_giao`; hàm LIVE (byte-identical) chỉ trả `moi_len_don`/`xong_file` | hàm đổi định nghĩa ở lô trước, test chưa cập nhật | sửa kỳ vọng test theo hàm hiện hành |
| `test_056` | seed đơn KHÔNG điền `thuong_hieu` → dính **gác thương hiệu** (trigger db/115) | L-48 (gác brand) | thêm `set local chan.off_thuonghieu='1'` vào seed |
| `test_057` | (a) `gui_ban_thiet_ke(unknown,unknown,jsonb,jsonb) is not unique` — **overload** hàm; (b) gác thương hiệu | overload từ db/048 (memory ghi "test_057 đỏ sẵn từ db/048"); L-48 | drop overload thừa `gui_ban_thiet_ke` + off_thuonghieu seed |
| `test_104` | `dieu_hanh_cong_no_khach` nay đọc `phieu_thu` (không còn `so_tien_thuc_thu`); seed cũ dùng `so_tien_thuc_thu` → nợ = doanh thu đầy đủ | L-49 (hợp nhất công nợ về phieu_thu) | seed phiếu thu thay `so_tien_thuc_thu` |

**Nợ riêng — overload `gui_ban_thiet_ke`:** có ≥2 chữ ký cùng tên → gọi 4-tham-số bị `is not unique`. Cần drop bản thừa,
giữ 1 chữ ký (như bài học L-51: KHÔNG để 2 overload cùng tên gây ambiguous). Chạm app Thiết kế → lô riêng, không phình L-52.
