// WP-91 L-91.2 · Backfill/kéo chi ads Meta cho MỘT khoảng cụ thể, CÓ ghi sổ mốc + gộp kỳ tự động.
//   Dùng: node ops/keo_ads_backfill.mjs <since YYYY-MM-DD> <until YYYY-MM-DD>
//   Giữ (kéo lại khoảng bất kỳ). Token .env. Chặn khoá → thoát 0. Lỗi → thoát ≠0. KHÔNG in token.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { keoChiAdsMetaCoSo } from './keo_chi_ads_meta.mjs'

const [since, until] = process.argv.slice(2)
if (!/^\d{4}-\d{2}-\d{2}$/.test(since || '') || !/^\d{4}-\d{2}-\d{2}$/.test(until || '')) {
  console.error('DÙNG: node ops/keo_ads_backfill.mjs <since YYYY-MM-DD> <until YYYY-MM-DD>'); process.exit(1)
}
const env = Object.fromEntries(readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env', 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const token = env.META_CAPI_TOKEN
if (!token) { console.error('DỪNG: thiếu META_CAPI_TOKEN'); process.exit(1) }

const cfg = await docConfig(); cfg.statement_timeout = 120000
const c = new pg.Client(cfg); await c.connect()
try {
  const r = await keoChiAdsMetaCoSo(c, { token, range: { since, until } })
  if (r.skip === 'khoa') { await c.end(); process.exit(0) }         // đang có lượt chạy → thoát êm
  const loi = (r.taiKhoan || []).filter(t => t.loi)
  if (loi.length) console.log('  ⚠ LỖI tài khoản: ' + loi.map(x => x.ten + '=' + x.loi).join(' | '))
  await c.end(); process.exit(0)
} catch (e) {
  console.error('ads-keo LỖI: ' + (e.message || e))
  try { await c.end() } catch {}
  process.exit(1)
}
