// TEST CANH — WP-14b L-4 · web/src/ngay.js sinh ngày nghiệp vụ ghim TZ VN, độc lập giờ máy.
import { ngayNghiepVu, kyNghiepVu, congNgay } from '../src/ngay.js'
import { readFileSync } from 'fs'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const MOC = new Date('2026-07-01T00:30:00+07:00')   // nửa đêm VN 01/07 (= 2026-06-30T17:30Z)

// 3.1 — độc lập giờ máy: dù process.env.TZ là gì, Intl ghim VN → luôn 2026-07-01 / 2026-07
console.log('  process.env.TZ =', process.env.TZ || '(mặc định máy)')
ok("3.1 ngayNghiepVu(mốc nửa đêm VN) = 2026-07-01 (TZ máy=" + (process.env.TZ || '?') + ")", ngayNghiepVu(MOC) === '2026-07-01', ngayNghiepVu(MOC))
ok("3.1 kyNghiepVu(mốc) = 2026-07", kyNghiepVu(MOC) === '2026-07', kyNghiepVu(MOC))
ok("3.1 congNgay: 31/07 20:00 VN + 1 ngày = 2026-08-01", ngayNghiepVu(congNgay(new Date('2026-07-31T20:00:00+07:00'), 1)) === '2026-08-01', ngayNghiepVu(congNgay(new Date('2026-07-31T20:00:00+07:00'), 1)))
ok("3.1 kyNghiepVu(chuỗi ngày '2026-08-15 10:00') = 2026-08 (cắt chuỗi, không parse)", kyNghiepVu('2026-08-15 10:00') === '2026-08', kyNghiepVu('2026-08-15 10:00'))

// 3.2 PROVE-RED — nếu GỠ ghim TZ (dùng giờ máy) thì dưới UTC ra 2026-06-30 (lệch)
const brokenNgay = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) }
const brokenUTC = brokenNgay(new Date(MOC.getTime()))   // getFullYear/Month/Date theo giờ MÁY
const wouldBeWrong = (process.env.TZ === 'UTC') && brokenUTC === '2026-06-30'
if (process.env.TZ === 'UTC') {
  ok('3.2 PROVE-RED: bản GỠ-ghim (giờ máy) dưới TZ=UTC → ' + brokenUTC + ' (LỆCH, canh biết kêu)', wouldBeWrong, brokenUTC)
  console.log('     ↳ nguyên văn "đỏ": nửa đêm VN 01/07 → bản-không-ghim đọc thành ' + brokenUTC + ' = bệnh WP-14b')
  console.log('     ↳ so với ngay.js (ghim TZ) cùng lúc: ' + ngayNghiepVu(MOC) + ' (ĐÚNG)')
} else {
  console.log('  (3.2 prove-red: chạy lại với TZ=UTC để thấy bản gỡ-ghim đỏ; ngay.js ghim vẫn đúng)')
}

// 3.3 QUÉT sale.html + main.js + taichinh.js — KHÔNG còn toISOString().slice sinh ngày nghiệp vụ.
//   Danh sách trắng: generator demo sale.html (~1815-1950); [KỸ THUẬT] dùng toISOString() KHÔNG .slice (timestamptz) không khớp regex.
const RE = /toISOString\(\)\.slice\(0, ?(10|7)\)/
function quet(rel, demoRange) {
  const lines = readFileSync(new URL(rel, import.meta.url), 'utf8').split('\n')
  const vp = []
  lines.forEach((l, i) => {
    const ln = i + 1
    if (demoRange && ln >= demoRange[0] && ln <= demoRange[1]) return
    if (RE.test(l)) vp.push(rel.split('/').pop() + ':' + ln + ' ' + l.trim().slice(0, 60))
  })
  return vp
}
const viPham = [...quet('../public/togihome_sale.html', [1815, 1950]), ...quet('../src/main.js', null), ...quet('../src/taichinh.js', null)]
ok('3.3 quét sale.html + main.js + taichinh.js: 0 toISOString().slice sinh ngày (ngoài demo)', viPham.length === 0, 'CÒN: ' + viPham.join(' | '))

console.log(`\n═══ test_ngay: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
