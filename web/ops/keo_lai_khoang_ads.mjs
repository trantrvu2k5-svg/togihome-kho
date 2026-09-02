// WP-93 L-05 vế B · Kéo LẠI chi phí Meta cho TOÀN khoảng đang có (để backfill luot_bam_link cho data cũ).
//   Khoảng = min/max ngày ĐỌC TỪ chi_chien_dich_ngay (KHÔNG đoán). Chạy theo lô ≤14 ngày để không đụng giới hạn Meta.
//   Dùng lại keoChiAdsMeta (họ keo_chi_ads_meta.mjs) với opts.range — KHÔNG viết đường xác thực/ghi mới.
//   Script GIỮ (kéo lại một khoảng bất kỳ khi cần vá số), không phải rác một-lần. Token đọc .env (KHÔNG chôn).
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { keoChiAdsMeta } from './keo_chi_ads_meta.mjs'

const env = Object.fromEntries(readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env', 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const token = env.META_CAPI_TOKEN
if (!token) { console.error('DỪNG: thiếu META_CAPI_TOKEN trong .env — KHÔNG kéo.'); process.exit(1) }

const d = s => s.toISOString().slice(0, 10)                              // UTC → 'YYYY-MM-DD'
const parse = str => new Date(str + 'T00:00:00Z')                        // text ngày → UTC midnight (tránh lệch múi giờ)
const addDays = (s, n) => { const x = new Date(s); x.setUTCDate(x.getUTCDate() + n); return x }

const cfg = await docConfig(); cfg.statement_timeout = 60000
const c = new pg.Client(cfg); await c.connect()

// Đọc min/max dạng TEXT (to_char) — KHÔNG qua JS Date của pg (parse về local midnight → toISOString lệch −1 ngày ở UTC+7).
const mm = (await c.query(`select to_char(min(ngay),'YYYY-MM-DD') mn, to_char(max(ngay),'YYYY-MM-DD') mx from kho.chi_chien_dich_ngay`)).rows[0]
if (!mm.mn) { console.log('Bảng rỗng — không có gì để kéo lại.'); await c.end(); process.exit(0) }
const tu = parse(mm.mn), den = parse(mm.mx)
console.log(`Khoảng đang có: ${d(tu)} → ${d(den)}. Kéo lại theo lô ≤14 ngày…`)

let tongCd = 0, tongAd = 0
for (let s = tu; s <= den; s = addDays(s, 14)) {
  const e = addDays(s, 13) > den ? den : addDays(s, 13)
  const r = await keoChiAdsMeta(c, { token, range: { since: d(s), until: d(e) } })
  if (r.skip) { console.log(`  lô ${d(s)}→${d(e)}: SKIP (${r.skip})`); continue }
  const loi = r.taiKhoan.filter(t => t.loi)
  tongCd += r.upsertCd || 0; tongAd += r.upsert || 0
  console.log(`  lô ${d(s)}→${d(e)}: chiến dịch upsert ${r.upsertCd} · ad upsert ${r.upsert}` + (loi.length ? ` · LỖI ${loi.length} TK: ${loi.map(x => x.ten + '=' + x.loi).join(' | ')}` : ''))
}
console.log(`Xong kéo lại: chiến dịch ${tongCd} dòng · ad ${tongAd} dòng.`)

// ── B3 · Bảng đối chiếu 5 chiến dịch đang chi: impressions · clicks tổng · bấm-vào-link · CTR theo link ──
const rows = (await c.query(`
  select campaign_id, campaign_name, sum(hien_thi)::bigint ht, sum(luot_bam)::bigint clicks, sum(luot_bam_link)::bigint link
  from kho.chi_chien_dich_ngay where ngay >= $1 and ngay <= $2 and chi_tieu > 0
  group by campaign_id, campaign_name having sum(chi_tieu) > 0
  order by sum(chi_tieu) desc`, [d(tu), d(den)])).rows
console.log('\n── B3 · Đối chiếu bấm-vào-link (khoảng ' + d(tu) + '→' + d(den) + ') ──')
console.log('chiến dịch'.padEnd(42) + 'impr'.padStart(9) + 'clicks'.padStart(9) + 'link'.padStart(8) + '  CTR-link')
for (const r of rows) {
  const ctr = r.ht > 0 && r.link != null ? (Number(r.link) * 100 / Number(r.ht)).toFixed(2) + '%' : '—'
  console.log((r.campaign_name || '').slice(0, 40).padEnd(42) + String(r.ht).padStart(9) + String(r.clicks).padStart(9) + String(r.link ?? '—').padStart(8) + '  ' + ctr)
}

// Cổng GIUONG: đối chiếu THẲNG với Meta trên CÙNG khoảng vừa kéo (KHÔNG hard-code 488 — số đó thuộc cửa sổ 27/08→02/09
//   của L-04, khác span bảng). Nguồn ĐÚNG = link lưu khớp inline_link_clicks Meta. Lệch → DỪNG, báo, KHÔNG sửa tay.
const g = rows.find(r => /GIUONG/i.test(r.campaign_name || ''))
if (g) {
  const u = 'https://graph.facebook.com/v21.0/' + g.campaign_id + '/insights?fields=inline_link_clicks&time_range=' +
    encodeURIComponent(JSON.stringify({ since: d(tu), until: d(den) })) + '&access_token=' + encodeURIComponent(token)
  const j = await (await fetch(u)).json()
  const meta = j.error ? null : (j.data && j.data[0] ? Number(j.data[0].inline_link_clicks) : null)
  const ok = g.link != null && meta != null && Math.abs(Number(g.link) - meta) <= 30
  console.log(`\nCổng GIUONG (${d(tu)}→${d(den)}): link lưu = ${g.link} · Meta inline_link_clicks = ${meta ?? (j.error && j.error.message)} → ${ok ? 'KHỚP — nguồn ĐÚNG' : 'LỆCH — DỪNG, kiểm nguồn, KHÔNG sửa tay'}`)
  if (!ok) { await c.end(); process.exit(2) }
} else console.log('\n⚠ Không thấy chiến dịch GIUONG trong khoảng — kiểm lại.')

await c.end()
