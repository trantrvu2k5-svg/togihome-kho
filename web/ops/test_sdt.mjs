// TEST — WP-70 L-70r3 · laySdt chịu mọi dạng recent_phone_numbers (dạng thật: mảng object {phone_number,…}).
import { laySdt } from './keo_lead_core.mjs'
let P = 0, F = 0
const ok = (n, got, exp) => { const v = got === exp; console.log((v ? '✅' : '❌') + ' ' + n + '  → ' + JSON.stringify(got) + (v ? '' : ' (mong ' + JSON.stringify(exp) + ')')); v ? P++ : F++ }

// ── dạng THẬT mục B: mảng object có phone_number ──
ok('1. mảng object phone_number', laySdt([{ captured: '0979391888', phone_number: '0979391888', status: 3 }]), '0979391888')
ok('2. object phone_number đã 0 (captured thiếu 0)', laySdt([{ captured: '919937110', phone_number: '0919937110' }]), '0919937110')
ok('3. object +84 → 0', laySdt([{ captured: '+84986757652', phone_number: '+84986757652' }]), '0986757652')
ok('4. object có dấu chấm', laySdt([{ phone_number: '0945.286.831' }]), '0945286831')
ok('5. object có khoảng trắng', laySdt([{ phone_number: '094 7891037' }]), '0947891037')
ok('6. nhiều số → lấy ĐẦU (mới nhất)', laySdt([{ phone_number: '0983788578' }, { phone_number: '0947231354' }]), '0983788578')

// ── các dạng khác laySdt phải chịu ──
ok('7. mảng chuỗi (cũ)', laySdt(['0912345678']), '0912345678')
ok('8. mảng rỗng → NULL', laySdt([]), null)
ok('9. null → NULL', laySdt(null), null)
ok('10. undefined → NULL', laySdt(undefined), null)

// ── 3 ca BIÊN bắt buộc ──
ok('11. +84987654321 → 0987654321', laySdt([{ phone_number: '+84987654321' }]), '0987654321')
ok('12. rác (giá bị nhận nhầm) → phone_number vẫn parse nếu đủ số', laySdt([{ captured: '7 8.500.000 2', phone_number: '0785000002' }]), '0785000002')
ok('13. chuỗi rác không đủ số → NULL', laySdt([{ phone_number: 'abc-xyz' }]), null)
ok('14. object rỗng (không phone_number/captured) → NULL', laySdt([{ status: 0 }]), null)
ok('15. số quá ngắn → NULL', laySdt([{ phone_number: '12345' }]), null)

console.log(`\n═══ test_sdt: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
