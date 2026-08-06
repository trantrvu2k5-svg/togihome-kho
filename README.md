# Togihome — Hệ Kho

Cơ sở dữ liệu kho vật tư (Supabase/Postgres) + web app nội bộ.
MTO (làm theo đơn) + tồn bán thành phẩm, sau thêm MTS.

## Kiến trúc dữ liệu
- **Một dự án Supabase duy nhất**, tách bằng **schema**: kho → `kho` (sau: `crm`, `erp`)
  — để nối chung qua khoá ngoại/giao dịch. KHÔNG tách thành nhiều dự án.
- Khoá Supabase trong `.env` (xem `.env.example`) — **KHÔNG commit**.

## Cấu trúc thư mục
- `db/001_schema.sql` — bảng + RLS (tạo thẳng trong schema `kho`).
- `db/002_seed.sql` — nhập 199 mã (chịu chạy lại, không nhân dữ liệu).
- `db/003_don_lo_trung.sql` — dọn lô mở đầu bị nhân.
- `db/004_chuyen_schema.sql` — dời 12 bảng public→kho (CHỈ cho DB đã lỡ tạo ở public; cài mới bỏ qua).
- `scripts/` — parser xlsx + transform + gen_seed (nguồn thật của seed).
- `docs/thiet_ke_bang.md` — thiết kế bảng + RLS + cách web app đọc schema.

## ⚠ Mở schema cho API — CẤU HÌNH TRONG DB, KHÔNG qua dashboard
Schema được expose bằng role setting trong Postgres:
```sql
alter role authenticator set pgrst.db_schemas = 'public, kho, storage, graphql_public';
notify pgrst, 'reload config';
```
**Ô "Exposed schemas" trên Dashboard KHÔNG còn điều khiển được — DB config thắng.**
Thêm/bớt schema (crm, erp…) phải sửa bằng SQL trên. Web app: `createClient(url, key, { db: { schema: 'kho' } })`.

Trạng thái: KHO-1 — 199 mã đã nhập, 12 bảng trong schema `kho`, tồn PK 233.054.400đ.
