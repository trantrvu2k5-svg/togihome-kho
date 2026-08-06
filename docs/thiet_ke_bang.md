# KHO-1 — Đề xuất thiết kế bảng (CHỜ CEO DUYỆT, chưa chạy migration)

Mọi bảng: `id uuid pk default gen_random_uuid()`, `tao_luc timestamptz default now()`,
`sua_luc timestamptz`, `nguoi_thao_tac uuid → nguoi_dung(id)`. **RLS bật cho MỌI bảng.**

## Danh mục

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `nguoi_dung` | id · ho_ten · vai_tro(`ceo`\|`kho`\|`tho`) · auth_uid(→auth.users) · dang_hoat_dong | map với Supabase Auth |
| `nhom` | id · ten · thu_tu | 22 nhóm phụ kiện + nhóm ván |
| `kho` | id · ten · dia_chi · la_mac_dinh bool | mặc định 1 dòng "Xưởng" |
| `nha_cung_cap` | id · ten · dien_thoai · dia_chi · **lead_time_ngay int** · **moq_sl numeric** | 2 cột cuối BẮT BUỘC cho gợi ý đặt mức 3 |
| `vat_tu` | id · **ma unique** · ten · loai(`pk`\|`van`) · nhom_id · dvt · so_moi_dvt · dvt_goc · do_day_mm(ván) · anh_ma · ton_toi_thieu · **can_kiem_tra bool** · **ghi_chu_co** text[] | 1 dòng/mã; cờ dữ liệu bẩn |

## Tồn + lô (bình quân gia quyền, vẫn lưu lô)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `ton` | id · vat_tu_id · kho_id · **(unique vat_tu_id,kho_id)** · so_luong numeric · gia_von_bq numeric | tồn hiện tại theo **mã × kho**; BQGQ |
| `lo_nhap` | id · vat_tu_id · kho_id · phieu_id · so_luong_nhap · **gia_von_lo** · con_lai numeric · ngay date | tra ngược từng lô; con_lai để FIFO nếu cần |

## Chứng từ (phiếu nhiều dòng, số tự sinh, nháp→ghi sổ)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `phieu` | id · **so_phieu unique** (`NK-2026-0001`/`XK-2026-0001`) · loai(`nhap`\|`xuat`\|`dieu_chinh`) · kho_id · **trang_thai**(`nhap`\|`ghi_so`) · ncc_id(nhập) · ly_do(xuất) · phieu_goc_id(điều chỉnh trỏ phiếu bị sửa) · ghi_so_luc · ghi_so_boi | nháp sửa được; ghi_so KHOÁ |
| `phieu_dong` | id · phieu_id · vat_tu_id · so_luong · don_gia · thanh_tien · ncc_id\|ly_do | dòng chứng từ |

## Thẻ kho (sổ cái — mỗi giao dịch 1 dòng)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `giao_dich` | id · vat_tu_id · kho_id · loai(`nhap`\|`xuat`\|`lay`\|`tra`\|`dieu_chinh`) · so_luong(±) · phieu_id · lo_nhap_id · **so_du_sau** numeric · nguon(`phieu`\|`quet_tem`) · nguoi_thao_tac · tao_luc | thẻ kho = filter theo vat_tu_id, sort tao_luc; giờ+phiếu+người+số dư sau |

Số phiếu tự sinh: bảng `chuoi_so(loai, nam, so_hien_tai)` + hàm `cap_so_phieu(loai)` khoá dòng (`for update`) — tránh trùng khi nhiều người lập cùng lúc.

## Cấu hình chặn (3 tháng đầu CHỈ GHI)

`cai_dat(khoa text pk, gia_tri jsonb)` — dòng `chan_ton_am = false`. Ghi sổ khi tồn sẽ âm:
VẪN ghi + `giao_dich` mang cờ `canh_bao='ton_am'`. Bật `true` sau để CHẶN. **Số dời một chỗ.**

## RLS — 3 vai trò (dự án đang KHÔNG có luật bảo vệ = lỗ hổng, bật ngay)

| Vai trò | vat_tu/nhom/kho/ncc | phieu/phieu_dong | giao_dich | ghi sổ / điều chỉnh |
|---|---|---|---|---|
| **ceo** | đọc + sửa | đọc + sửa mọi | đọc mọi | được (kể cả điều chỉnh) |
| **kho** (người phụ trách) | đọc + sửa | tạo/sửa NHÁP của mình + đọc mọi | đọc mọi | được ghi sổ + lập phiếu điều chỉnh |
| **tho** (quét điện thoại) | chỉ đọc | — | tạo dòng `lay`/`tra` qua quét tem + đọc của mình | KHÔNG |

- `ghi_so` = phiếu chuyển `nhap→ghi_so`: sinh `giao_dich` + cập nhật `ton`/`lo_nhap` (trong 1 transaction/RPC). Phiếu đã ghi sổ **immutable** (policy chặn UPDATE trừ cột `sua_luc` do điều chỉnh?) — sửa phải lập `phieu` loại `dieu_chinh` trỏ `phieu_goc_id`, để lại vết.
- Thợ **không** map mã NCC — định danh vật tư bằng **tem tự in** (mã = `vat_tu.ma`, in QR).

## Bán thành phẩm (MTS sau) — chừa chỗ

`vat_tu.loai` để enum mở (`pk`\|`van`\|`btp` sau). Chưa tạo bảng BTP lô này.
