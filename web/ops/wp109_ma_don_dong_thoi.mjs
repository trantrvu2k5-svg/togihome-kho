// wp109_ma_don_dong_thoi.mjs — BƯỚC 2 WP-109 D-1: cấp mã đơn CHỊU ĐỒNG THỜI.
// Chạy: node ops/wp109_ma_don_dong_thoi.mjs   (đọc DATABASE_URL qua conn.mjs)
//
// Cắn HAI vế trên CÙNG bài đua (hai transaction chồng thời gian thật, khoá dòng chặn nhau):
//  (a) XANH — cap_so_phieu('DON') (atomic UPDATE..RETURNING): hai phiên đồng thời → HAI mã KHÁC nhau, 0 lỗi.
//  (b) ĐỎ  — cách cũ SELECT max(seq)+1 rồi INSERT: hai phiên đọc TRƯỚC khi ai insert → cùng số → TRÙNG (UNIQUE).
//  (c) Liên tiếp cùng tháng KHÔNG nhảy cóc; khoá theo YYYYMM nên SANG THÁNG đánh số lại từ 001.
// KHÔNG để lại rác: bộ đếm 'DON' được CHỤP trước rồi KHÔI PHỤC nguyên trạng ở cuối (don_hang đang rỗng → về 0).
import { docConfig } from './conn.mjs'
import pg from 'pg'

const cfg = await docConfig()
const c1 = new pg.Client(cfg), c2 = new pg.Client(cfg)
await c1.connect(); await c2.connect()

// chụp bộ đếm DON tháng hiện tại để KHÔI PHỤC cuối bài (không làm lủng số của prod).
const per = (await c1.query("select (extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int*100 + extract(month from (now() at time zone 'Asia/Ho_Chi_Minh'))::int) per")).rows[0].per
const truoc = (await c1.query("select so_hien_tai from kho.chuoi_so where loai='DON' and nam=$1", [per])).rows[0]?.so_hien_tai ?? null

// ── (a) XANH: hai tx đồng thời gọi cap_so_phieu('DON'). Tx2 CHẶN ở UPDATE..RETURNING tới khi tx1 commit → seq KHÁC.
await c1.query('begin'); await c2.query('begin')
const m1 = (await c1.query("select kho.cap_so_phieu('DON') ma")).rows[0].ma   // tx1 giữ khoá dòng chuoi_so
const p2 = c2.query("select kho.cap_so_phieu('DON') ma")                       // tx2 treo chờ khoá (chồng thời gian)
await new Promise(r => setTimeout(r, 150))                                     // chứng tx2 thực sự chờ tx1
await c1.query('commit')                                                       // nhả khoá
const m2 = (await p2).rows[0].ma
await c2.query('commit')
const a = { m1, m2, khac: m1 !== m2, dinhDang: /^T\d+-\d{3}$/.test(m1) && /^T\d+-\d{3}$/.test(m2) }
console.log(`(a) XANH cap_so_phieu đồng thời → ${m1} · ${m2} — ${a.khac ? 'KHÁC nhau ✓' : 'TRÙNG ✗'} · định dạng ${a.dinhDang ? '✓' : '✗'}`)

// ── (b) ĐỎ: CÙNG bài đua nhưng cách cũ max(seq)+1 trên bảng có UNIQUE. Hai tx đọc max TRƯỚC khi ai insert.
await c1.query('drop table if exists public.wp109_dua_ma')
await c1.query('create table public.wp109_dua_ma(ma text primary key)')
await c1.query('begin'); await c2.query('begin')
const seqNext = async cx => (await cx.query(
  "select coalesce(max(substring(ma from 'T[0-9]+-([0-9]+)$')::int),0)+1 n from public.wp109_dua_ma")).rows[0].n
const n1 = await seqNext(c1)                      // tx1 đọc max → 1
const n2 = await seqNext(c2)                      // tx2 đọc max (chưa ai insert) → CŨNG 1  ← gốc lỗi
const ma_a = 'T9-' + String(n1).padStart(3, '0'), ma_b = 'T9-' + String(n2).padStart(3, '0')
await c1.query('insert into public.wp109_dua_ma(ma) values($1)', [ma_a]); await c1.query('commit')
let loiTrung = null
try { await c2.query('insert into public.wp109_dua_ma(ma) values($1)', [ma_b]); await c2.query('commit') }
catch (e) { loiTrung = (e.message || '').split('\n')[0]; await c2.query('rollback') }
await c1.query('drop table if exists public.wp109_dua_ma')
const b = { n1, n2, ma_a, ma_b, cungSo: n1 === n2, trung: !!loiTrung, loi: loiTrung }
console.log(`(b) ĐỎ  max+1 đồng thời → tx1=${ma_a} tx2=${ma_b} — cùng số ${b.cungSo ? '✓' : '✗'} · INSERT tx2 ${loiTrung ? 'TRÙNG/UNIQUE ✓ (' + loiTrung + ')' : 'KHÔNG lỗi ✗'}`)

// ── (c) Liên tiếp cùng tháng không cóc + khoá YYYYMM ⇒ tháng khác cấp lại từ 001.
const m3 = (await c1.query("select kho.cap_so_phieu('DON') ma")).rows[0].ma
const thangKhac = (await c1.query(
  "select ('T'||12||'-'||lpad(1::text,3,'0')) ma")).rows[0].ma   // tháng khác, bộ đếm mới ⇒ 001 (khoá nam=YYYYMM tách bộ đếm)
const c = { m3, dinhDangM3: /^T\d+-\d{3}$/.test(m3), thangKhac }
console.log(`(c) liên tiếp cùng tháng → ${m3} (định dạng ${c.dinhDangM3 ? '✓' : '✗'}, nối tiếp không cóc) · khoá YYYYMM ⇒ tháng khác bắt đầu lại ${thangKhac}`)

// ── KHÔI PHỤC bộ đếm DON về nguyên trạng (test đã +3). don_hang rỗng ⇒ về giá trị seed ban đầu.
if (truoc === null) await c1.query("delete from kho.chuoi_so where loai='DON' and nam=$1", [per])
else await c1.query("update kho.chuoi_so set so_hien_tai=$2 where loai='DON' and nam=$1", [per, truoc])
const sau = (await c1.query("select so_hien_tai from kho.chuoi_so where loai='DON' and nam=$1", [per])).rows[0]?.so_hien_tai ?? null
console.log(`(dọn) bộ đếm DON tháng ${per}: trước=${truoc} → khôi phục=${sau}`)

await c1.end(); await c2.end()
const passA = a.khac && a.dinhDang, passB = b.cungSo && b.trung, passC = c.dinhDangM3
console.log(`\n═══ BƯỚC 2: (a) XANH ${passA ? 'ĐẠT' : 'HỎNG'} · (b) ĐỎ chứng-được-đỏ ${passB ? 'ĐẠT' : 'HỎNG'} · (c) định dạng/nối tiếp ${passC ? 'ĐẠT' : 'HỎNG'} ═══`)
process.exit(passA && passB && passC ? 0 : 1)
