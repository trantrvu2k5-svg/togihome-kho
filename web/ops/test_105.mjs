// TEST CẮN — 105 · tầng dòng dong_san_pham + san_pham_loi.dong_id. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
try {
  await c.query('begin')
  console.log('── 1 · 10 dòng đề xuất đủ + PK ──')
  const ds = await q(`select ma_dong from kho.dong_san_pham order by thu_tu`)
  const canH = ['TA','GN','BLV','HB','BT','HK','KE','TG','BA','TD']
  ok('#1 đủ 10 dòng đúng mã', canH.every(m => ds.some(r => r.ma_dong === m)) && ds.length >= 10, ds.map(r=>r.ma_dong).join(','))
  ok('#1 ma_dong 2-3 chữ', ds.every(r => r.ma_dong.length >= 2 && r.ma_dong.length <= 3))

  console.log('\n── 2 · san_pham_loi.dong_id + FK NỐI DÂY ──')
  ok('#2 cột dong_id tồn tại', (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='san_pham_loi' and column_name='dong_id'`)).length === 1)
  // gán dòng cho 1 lõi thật (nếu có) — nối dây: đọc lại thấy đổi
  const loi = (await q(`select ma_loi from kho.san_pham_loi limit 1`))[0]
  if (loi) {
    await q(`update kho.san_pham_loi set dong_id='TA' where ma_loi=$1`, [loi.ma_loi])
    ok('#2 gán dong_id=TA rồi đọc lại thấy đổi (nối dây)', (await q(`select dong_id from kho.san_pham_loi where ma_loi=$1`, [loi.ma_loi]))[0].dong_id === 'TA')
  } else ok('#2 (không có lõi để thử — bỏ qua)', true)
  // FK chặn dòng không tồn tại
  let bad = null; await c.query('savepoint b')
  try { await q(`update kho.san_pham_loi set dong_id='KHONGCO' where ma_loi=$1`, [loi?.ma_loi || 'x']) } catch (e) { bad = e.message; await c.query('rollback to savepoint b') }
  ok('#2 FK chặn dong_id không tồn tại', bad !== null || !loi, bad)

  console.log('\n── 3 · số rác WEB đã sạch ──')
  ok('#3 không còn lõi WEB-*', (await q(`select count(*)::int n from kho.san_pham_loi where ma_loi like 'WEB-%'`))[0].n === 0)
  ok('#3 Σtotal_week_sold = 0 (số rác 2116 đã biến mất)', Number((await q(`select coalesce(sum(total_week_sold),0)::int s from kho.niem_yet`))[0].s) === 0)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_105: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
