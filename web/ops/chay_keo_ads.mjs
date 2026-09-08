// chay_keo_ads — CLI chạy THẬT lượt kéo ads vào prod (WP-100 L-100.3, cho mục F). KHÔNG in token.
//   token ở ROOT .env (togihome-kho/.env), KHÔNG web/.env (bài học L-91.4 — xem 01_HE_THONG.md §F).
//   cờ: --only=B|C|D (mặc định cả B+C+D) · --ngay=YYYY-MM-DD (B một ngày, cho F1).
//   Thoát mã ≠0 nếu có bất kỳ việc nào lỗi.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { docConfig } from './conn.mjs'
import { keoAdsLuot, keoChiAdsMetaNhip, keoChiAdsMetaCoSo, keoThayDoiMeta, keoNenTangMeta } from './keo_chi_ads_meta.mjs'
import { keoMauAdsMeta } from './keo_mau_ads_meta.mjs'   // [WP-103] E: kéo mẫu creative

function docToken() {
  const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')   // = togihome-kho/.env (ROOT)
  const m = env.split('\n').find(l => l.startsWith('META_CAPI_TOKEN='))
  const t = m ? m.slice('META_CAPI_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : ''
  if (!t) { console.error('THIẾU META_CAPI_TOKEN ở ROOT .env (togihome-kho/.env)'); process.exit(2) }
  return t
}
const arg = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null }

const only = arg('only'), ngay = arg('ngay')
const token = docToken()
const c = new pg.Client(await docConfig())
await c.connect()
let loi = []
try {
  if (only === 'B' && ngay) { console.log(`── B một ngày ${ngay} ──`); await keoChiAdsMetaCoSo(c, { token, range: { since: ngay, until: ngay } }) }
  else if (only === 'B') { console.log('── B cửa sổ 7 ngày + kéo bù ──'); await keoChiAdsMetaNhip(c, { token }) }
  else if (only === 'C') { console.log('── C sổ thay đổi 30 ngày ──'); await keoThayDoiMeta(c, { token }) }
  else if (only === 'D') { console.log('── D tách nền tảng 7 ngày ──'); await keoNenTangMeta(c, { token }) }
  else if (only === 'E') { console.log('── E kéo MẪU creative ──'); await keoMauAdsMeta(c, { token }) }
  else { console.log('── B + C + D + E (một lượt cron) ──'); const r = await keoAdsLuot(c, { token }); loi = r.loi
    try { await keoMauAdsMeta(c, { token }) } catch (e) { loi.push({ viec: 'E_mau', loi: String(e && e.message || e) }) } }
} catch (e) { loi.push({ viec: only || 'luot', loi: String(e && e.message || e) }) }
finally { await c.end() }

if (loi.length) { console.error('CÓ VIỆC LỖI:', JSON.stringify(loi)); process.exit(1) }
console.log('XONG (không lỗi).')
