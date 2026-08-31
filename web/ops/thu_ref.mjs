// L-79d-2 muc C — SOI payload Pancake tim ref 'w-' cho hoi thoai thu. TAM, KHONG commit.
//   KHONG in token/secret. KHONG in noi dung tin (chi quet khoa 'ref' + chuoi 'w-').
import { readFileSync } from 'fs'
const BASE = 'https://pages.fm/api/public_api/v2'
const PAGE = '576847645509797'   // messenger — CEO bam nut Messenger (stt 67,68,69, ref w-394/w-86)

// doc token tu .env (KHONG in ra)
const root = new URL('../../', import.meta.url).pathname
let raw = ''
try { raw = (readFileSync(root + '.env', 'utf8').split('\n').find(l => l.startsWith('PANCAKE_PAGES=')) || '').slice('PANCAKE_PAGES='.length).trim() } catch {}
const pages = JSON.parse(raw || '[]')
const pg = pages.find(p => String(p.page_id) === PAGE)
if (!pg) { console.log('KHONG co token cho page ' + PAGE + ' trong PANCAKE_PAGES'); process.exit(1) }
const token = pg.token || pg.page_access_token

// quet de quy: moi duong dan khoa chua 'ref' + moi chuoi bat dau 'w-'
function quet(obj, path, refHits, wHits) {
  if (obj == null) return
  if (typeof obj === 'string') { if (/^w-\d+-/.test(obj)) wHits.push(path + ' = ' + obj); return }
  if (typeof obj !== 'object') return
  for (const k of Object.keys(obj)) {
    const p = path ? path + '.' + k : k
    if (/ref/i.test(k)) {
      const v = obj[k]
      refHits.push(p + ' = ' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 120)))
    }
    quet(obj[k], p, refHits, wHits)
  }
}

async function soi(nhan, url) {
  const res = await fetch(url)
  console.log('\n=== ' + nhan + ' — HTTP ' + res.status + ' ===')
  const txt = await res.text()
  let j
  try { j = JSON.parse(txt) } catch { console.log('  KHONG phai JSON (100 ky tu dau): ' + txt.slice(0, 100).replace(/\n/g, ' ')); return null }
  if (!res.ok) { console.log('  loi'); return null }
  const top = Array.isArray(j) ? '(array ' + j.length + ')' : Object.keys(j).join(', ')
  console.log('  khoa top-level: ' + top)
  const refHits = [], wHits = []
  quet(j, '', refHits, wHits)
  console.log('  khoa chua "ref": ' + (refHits.length || 0))
  for (const h of refHits.slice(0, 30)) console.log('     ' + h)
  console.log('  chuoi bat dau "w-<so>-": ' + (wHits.length || 0))
  for (const h of wHits.slice(0, 30)) console.log('     ' + h)
  return j
}

// 1) conversation-list — tim hoi thoai thu (theo phone / ten / moi nhat)
const listUrl = `${BASE}/pages/${PAGE}/conversations?page_access_token=${encodeURIComponent(token)}`
const list = await soi('conversation-list', listUrl)
const convs = (list && (list.conversations || list.data)) || []
console.log('\n  tong hoi thoai trang dau: ' + convs.length)
function match(h) {
  const s = JSON.stringify(h)
  return s.includes('0979391888') || /vy test/i.test(s)
}
let target = convs.find(match)
console.log('  hoi thoai khop 0979391888/"vy test": ' + (target ? target.id : 'KHONG THAY'))
// in 6 hoi thoai moi nhat (id, inserted, updated, ten) de doi chieu thoi gian
console.log('  6 hoi thoai moi nhat:')
for (const h of convs.slice(0, 6)) {
  const ten = (h.customers && h.customers[0] && h.customers[0].name) || (h.from && h.from.name) || '?'
  console.log('     id=' + h.id + ' inserted=' + h.inserted_at + ' updated=' + h.updated_at + ' ten=' + ten)
}
if (!target) target = convs[0]   // neu khong khop, lay moi nhat de soi thu

if (target) {
  const id = target.id
  const cid = target.customer_id != null ? String(target.customer_id) : ''
  console.log('\n>>> hoi_thoai_id = ' + id + ' | customer_id = ' + cid)
  // dump khoa top-level cua hoi thoai dich (xem co field referral/ad/ref khong) — KHONG in noi dung
  console.log('  khoa cua hoi thoai dich: ' + Object.keys(target).join(', '))
  const rH = [], wH = []; quet(target, 'conv', rH, wH)
  console.log('  ref-key trong hoi thoai dich: ' + JSON.stringify(rH))
  console.log('  w- trong hoi thoai dich: ' + JSON.stringify(wH))
  // chi tiet + tin nhan (thu vai bien the URL, co customer_id)
  await soi('chi tiet hoi thoai', `${BASE}/pages/${PAGE}/conversations/${encodeURIComponent(id)}?page_access_token=${encodeURIComponent(token)}&customer_id=${encodeURIComponent(cid)}`)
  await soi('danh sach tin nhan', `${BASE}/pages/${PAGE}/conversations/${encodeURIComponent(id)}/messages?page_access_token=${encodeURIComponent(token)}&customer_id=${encodeURIComponent(cid)}`)
}
