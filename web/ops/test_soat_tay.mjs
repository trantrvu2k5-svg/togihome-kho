// TEST CẮN — cờ ĐÃ SOÁT TAY (VIỆC 1). Chứng minh CẢ HAI VẾ trong 1 giao dịch (rollback, không đụng prod thật).
//   VẾ CHƯA VÁ (upsert KHÔNG guard) → giá trị sửa tay BỊ MẤT  → in ĐỎ.
//   VẾ ĐÃ VÁ  (upsert CÓ `where da_soat_tay=false`, y hệt import) → giá trị sửa CÒN NGUYÊN, dòng chưa soát VẪN cập nhật → XANH.
//   Chạy: cd web && node ops/test_soat_tay.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
let DO = 0, XANH = 0
const doo = (t, v) => { console.log((v ? '🟥 ĐỎ ' : '⬜ ') + t); if (v) DO++ }
const xanh = (t, v) => { console.log((v ? '✅ ' : '❌ ') + t); if (v) XANH++ }

// hai biến thể web có thật: một sẽ được đánh dấu ĐÃ SOÁT, một để nguyên (chưa soát)
const MA_SOAT = 'W1807-0', MA_MOI = 'W1807-1'
// upsert giả lập import (giá trị "web" mới muốn ghi đè)
const COLS = 'insert into kho.san_pham_mau(ma,ten,ma_loi,dai_mm,rong_mm,cao_mm,kt_nguon,vl_doan,vl_chua_xac_nhan,ngung) values($1,$2,$3,$4,$5,$6,$7,$8,$9,false)'
const SET = ' do update set ten=excluded.ten,dai_mm=excluded.dai_mm,vl_doan=excluded.vl_doan,vl_chua_xac_nhan=excluded.vl_chua_xac_nhan'
const UPSERT_CHUA_VA = COLS + ' on conflict (ma)' + SET                                             // KHÔNG guard
const UPSERT_DA_VA   = COLS + ' on conflict (ma)' + SET + ' where kho.san_pham_mau.da_soat_tay = false'  // CÓ guard (= import thật)
const argWeb = ma => [ma, 'TÊN WEB MỚI', 'WEB-1807', 1200, 880, 750, 'web-kt', 'WEB-GHIDE', true]

try {
  await c.query('begin')
  const loi = (await q1(`select ma_loi from kho.san_pham_mau where ma=$1`, [MA_SOAT]))?.ma_loi
  if (!loi) throw new Error('không có biến thể mẫu ' + MA_SOAT + ' — chạy import trước')
  // GIẢ LẬP người soát tay: đặt giá trị đặc trưng + cờ da_soat_tay=true
  await c.query(`update kho.san_pham_mau set da_soat_tay=true, soat_luc=now(), vl_doan='SOAT-GIU', dai_mm=9991, vl_chua_xac_nhan=false where ma=$1`, [MA_SOAT])
  await c.query(`update kho.san_pham_mau set da_soat_tay=false, vl_doan='CU-MOI', dai_mm=100 where ma=$1`, [MA_MOI])

  // ───────── VẾ CHƯA VÁ ─────────
  console.log('\n── VẾ CHƯA VÁ (upsert không guard) ──')
  await c.query('savepoint a')
  await c.query(UPSERT_CHUA_VA, argWeb(MA_SOAT))
  const a = await q1(`select vl_doan, dai_mm from kho.san_pham_mau where ma=$1`, [MA_SOAT])
  console.log(`   ${MA_SOAT}: vl_doan=${a.vl_doan} dai_mm=${a.dai_mm}  (đã soát 'SOAT-GIU'/9991)`)
  doo(`CHƯA VÁ: chạy lại import → giá trị soát tay BỊ MẤT (thành 'WEB-GHIDE')`, a.vl_doan === 'WEB-GHIDE' && Number(a.dai_mm) === 1200)
  await c.query('rollback to savepoint a')

  // ───────── VẾ ĐÃ VÁ ─────────
  console.log('\n── VẾ ĐÃ VÁ (upsert `where da_soat_tay=false` — y hệt import) ──')
  await c.query('savepoint b')
  await c.query(UPSERT_DA_VA, argWeb(MA_SOAT))   // dòng ĐÃ soát → phải BỎ QUA
  await c.query(UPSERT_DA_VA, argWeb(MA_MOI))    // dòng CHƯA soát → phải cập nhật bình thường
  const s = await q1(`select vl_doan, dai_mm from kho.san_pham_mau where ma=$1`, [MA_SOAT])
  const m = await q1(`select vl_doan, dai_mm from kho.san_pham_mau where ma=$1`, [MA_MOI])
  console.log(`   ${MA_SOAT} (đã soát): vl_doan=${s.vl_doan} dai_mm=${s.dai_mm}`)
  console.log(`   ${MA_MOI} (chưa soát): vl_doan=${m.vl_doan} dai_mm=${m.dai_mm}`)
  xanh(`ĐÃ VÁ: dòng đã soát tay CÒN NGUYÊN ('SOAT-GIU'/9991, không ghi đè)`, s.vl_doan === 'SOAT-GIU' && Number(s.dai_mm) === 9991)
  xanh(`ĐÃ VÁ: dòng CHƯA soát VẪN cập nhật bình thường ('WEB-GHIDE'/1200)`, m.vl_doan === 'WEB-GHIDE' && Number(m.dai_mm) === 1200)
  await c.query('rollback to savepoint b')

  await c.query('rollback')
  console.log(`\n══ VẾ CHƯA VÁ in ĐỎ: ${DO}/1 · VẾ ĐÃ VÁ XANH: ${XANH}/2 ══`)
  const okAll = DO === 1 && XANH === 2
  console.log(okAll ? '✅ CẮN ĐỦ HAI VẾ — cờ đã soát tay hoạt động đúng.' : '❌ THIẾU VẾ — DỪNG.')
  process.exitCode = okAll ? 0 : 1
} catch (e) { console.error('LỖI TEST:', e.message); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
