// TEST — WP-70 L-70r4 · hoiThoaiToLead gán cham_cuoi_luc (=updated_at) + moc_dang_ngo.
import { hoiThoaiToLead } from './keo_lead_core.mjs'
let P = 0, F = 0
const ok = (n, v, ex = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && ex ? '  — ' + ex : '')); v ? P++ : F++ }
const L = (h) => hoiThoaiToLead(h, 'P').lead

// 1. updated_at bình thường (gần inserted) → cham set, ngo false
{ const l = L({ id: '1', inserted_at: '2026-08-30T10:00:00Z', updated_at: '2026-08-30T10:05:00Z' })
  ok('1. updated bình thường → cham_cuoi set · moc_dang_ngo=false', l.cham_cuoi_luc === '2026-08-30T10:05:00Z' && l.moc_dang_ngo === false, JSON.stringify({ c: l.cham_cuoi_luc, n: l.moc_dang_ngo })) }

// 2. lệch 2 năm (contact cũ nhắn lại) → ngo true
{ const l = L({ id: '2', inserted_at: '2024-08-30T10:00:00Z', updated_at: '2026-08-30T10:00:00Z' })
  ok('2. lệch 2 năm → moc_dang_ngo=true', l.cham_cuoi_luc === '2026-08-30T10:00:00Z' && l.moc_dang_ngo === true, JSON.stringify(l.moc_dang_ngo)) }

// 3. thiếu updated_at → cham NULL + ngo true
{ const l = L({ id: '3', inserted_at: '2026-08-30T10:00:00Z' })
  ok('3. thiếu updated_at → cham_cuoi NULL · moc_dang_ngo=true', l.cham_cuoi_luc === null && l.moc_dang_ngo === true, JSON.stringify({ c: l.cham_cuoi_luc, n: l.moc_dang_ngo })) }

// 4. lệch 1 giờ → ngo false
{ const l = L({ id: '4', inserted_at: '2026-08-30T10:00:00Z', updated_at: '2026-08-30T11:00:00Z' })
  ok('4. lệch 1 giờ → moc_dang_ngo=false', l.moc_dang_ngo === false, JSON.stringify(l.moc_dang_ngo)) }

// 5. lệch đúng 25h → true (>24h)
{ const l = L({ id: '5', inserted_at: '2026-08-29T10:00:00Z', updated_at: '2026-08-30T11:00:00Z' })
  ok('5. lệch 25h → moc_dang_ngo=true', l.moc_dang_ngo === true, JSON.stringify(l.moc_dang_ngo)) }

// 6. giữ nguyên thoi_diem_hoi_thoai = inserted_at (không phá)
{ const l = L({ id: '6', inserted_at: '2025-01-01T00:00:00Z', updated_at: '2026-08-30T00:00:00Z' })
  ok('6. thoi_diem_hoi_thoai vẫn = inserted_at', l.thoi_diem_hoi_thoai === '2025-01-01T00:00:00Z', l.thoi_diem_hoi_thoai) }

console.log(`\n═══ test_moc: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
