// WP-93 L-02 vế B · Kéo TÊN 6 tài khoản quảng cáo từ Meta (/me/adaccounts) → ads_tai_khoan_brand.ten_hien_thi.
//   Dùng layTaiKhoan (họ keo_chi_ads_meta.mjs) — KHÔNG viết đường xác thực mới. Token đọc từ .env (KHÔNG chôn vào file).
//   IDEMPOTENT: CHỈ update, không đẻ dòng, không đè bằng NULL (chỉ ghi khi Meta trả name khác giá trị đang có).
//   Token thiếu quyền / API lỗi → DỪNG, để nguyên NULL, in nguyên văn lỗi. CẤM bịa tên, CẤM suy tên từ tên chiến dịch (họ WP-90).
//   Script GIỮ (name-sync chạy lại được khi Meta đổi tên), không phải rác một-lần.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { layTaiKhoan } from './keo_chi_ads_meta.mjs'

const env = Object.fromEntries(readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env', 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const token = env.META_CAPI_TOKEN
if (!token) { console.error('DỪNG: thiếu META_CAPI_TOKEN trong .env — để nguyên NULL, KHÔNG bịa tên.'); process.exit(1) }

let tk
try { tk = await layTaiKhoan(globalThis.fetch, token) }
catch (e) { console.error('DỪNG (Meta lỗi): ' + String(e && e.message || e) + '\n→ để nguyên ten_hien_thi=NULL, KHÔNG bịa/suy tên.'); process.exit(1) }
console.log('Meta /me/adaccounts trả', tk.length, 'tài khoản.')

const c = new pg.Client(await docConfig()); await c.connect()
let n = 0
for (const a of tk) {
  if (!a.name) continue   // Meta không trả name → bỏ, KHÔNG đè NULL
  const r = await c.query(
    `update kho.ads_tai_khoan_brand set ten_hien_thi=$2 where act_id=$1 and coalesce(ten_hien_thi,'') <> $2`,
    [a.act_id, a.name])
  n += r.rowCount
}
console.log('Cập nhật ten_hien_thi:', n, 'dòng.')
const rows = (await c.query(
  `select m.act_id, m.ten_hien_thi, th.ten as brand
   from kho.ads_tai_khoan_brand m left join kho.thuong_hieu th on th.ma = m.brand_id
   where m.hieu_luc_den is null order by m.act_id`)).rows
console.table(rows)
await c.end()
