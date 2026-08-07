# Triển khai web app kho

- **Nhà cung cấp:** Cloudflare Pages
- **Tên project:** `togihome-kho`
- **URL production:** https://togihome-kho.pages.dev (mỗi lần deploy có thêm URL bản riêng `https://<hash>.togihome-kho.pages.dev`)

## Biến môi trường — LẤY TỪ `web/.env` LÚC BUILD (không cấu hình trên Cloudflare)
Vite nhúng biến vào bundle lúc `vite build`. Bundle chỉ chứa:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (khoá **anon/publishable** — công khai, RLS bảo vệ)

**Tuyệt đối không** đặt `service_role`, mật khẩu DB, hay bất kỳ `DB_*` nào vào `web/.env` (chúng sẽ lọt vào bundle công khai). Các khoá đó chỉ dùng cho script `web/ops/*` chạy trên máy, truyền qua biến môi trường lúc chạy.

## Cổng bí mật (chạy trước mỗi lần deploy)
```
node web/ops/cong_bi_mat.mjs <thư mục>
```
Quét regex: `sb_secret_<≥8 ký tự>` · `eyJ<JWT>` · `service_role` · `SERVICE_ROLE` · `DB_PASS` · `DB_USER` · `DB_HOST`.
Khớp bất kỳ → in `CỔNG CẮN: <mã> tại <file>` + thoát mã ≠0. Sạch → `CỔNG SẠCH`, thoát 0.

## Deploy lại (chạy trong thư mục `web/`)
```
rm -rf dist && npx wrangler@latest ... # (dùng vite)
npm run build                                  # hoặc: npx vite build
node ops/cong_bi_mat.mjs dist                  # PHẢI in CỔNG SẠCH (exit 0) mới đi tiếp
npx --yes wrangler@latest login                # lần đầu; bấm Allow trên trình duyệt
npx --yes wrangler@latest pages deploy dist --project-name=togihome-kho --branch main
```
- Project đã tồn tại → lệnh deploy dùng lại, KHÔNG tạo trùng.
- Chưa có project: `npx wrangler@latest pages pages project create togihome-kho --production-branch main`.

## Nghiệm thu nhanh
```
curl -I --tlsv1.2 https://togihome-kho.pages.dev        # phải 200 (curl LibreSSL cũ cần --tlsv1.2)
```
Đường dẫn không tồn tại trả **200** (SPA: Cloudflare Pages phục vụ `index.html` cho mọi route) — bình thường.
