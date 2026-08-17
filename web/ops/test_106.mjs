// TEST CẮN — 106 · bộ tạo SP ba tầng (sp_peek/sp_tao_loi_moi/sp_tao_bien_the/sp_kiem_ten_trung). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
try {
  await c.query('begin')
  console.log('── 1 · GUARD (ceo tạo được · xuong/sale/NULL chặn) ──')
  ok('#1 ceo sp_tao_loi_moi ĐƯỢC', (await asK(U.ceo, `select kho.sp_tao_loi_moi('TA','tên kt test')`)).e === null)
  for (const v of ['xuong','sale','NULLVAI']) ok(`#1 ${v} → CHẶN`, (await asK(U[v], `select kho.sp_tao_loi_moi('TA','x')`)).e !== null)

  console.log('\n── 2 · mã <dong>-NNN từ chuoi_so, ATOMIC (peek + tạo tăng) ──')
  const peek1 = (await asK(U.ceo, `select kho.sp_peek_ma_loi('GN') m`)).r[0].m
  ok('#2 peek đúng dạng GN-NNN', /^GN-\d{3}$/.test(peek1), peek1)
  const l1 = (await asK(U.ceo, `select kho.sp_tao_loi_moi('GN','giường A') g`)).r[0].g
  ok('#2 tạo lõi = peek', l1.ma_loi === peek1, l1.ma_loi + ' vs ' + peek1)
  const peek2 = (await asK(U.ceo, `select kho.sp_peek_ma_loi('GN') m`)).r[0].m
  ok('#2 peek kế tiếp TĂNG 1', peek2 !== peek1 && /^GN-\d{3}$/.test(peek2), peek2)

  console.log('\n── 3 · biến thể SKU <ma_loi>-NN + gắn dòng ──')
  const b1 = (await asK(U.ceo, `select kho.sp_tao_bien_the($1,'giường A 1m6','MDF','1600x2000',1600,2000,null) g`, [l1.ma_loi])).r[0].g
  ok('#3 SKU = <ma_loi>-NN', b1.ma === l1.ma_loi + '-01', b1.ma)
  const dg = (await c.query(`select dong_id from kho.san_pham_loi where ma_loi=$1`, [l1.ma_loi])).rows[0]
  ok('#3 lõi gắn dong_id=GN', dg.dong_id === 'GN')

  console.log('\n── 4 · kiểm TRÙNG tên (chuẩn hoá) + guard ──')
  ok('#4 sale gọi sp_kiem_ten_trung → CHẶN', (await asK(U.sale, `select kho.sp_kiem_ten_trung('x')`)).e !== null)
  const kt = (await asK(U.ceo, `select kho.sp_kiem_ten_trung('  TÊN   lạ HOÀN toàn 999 ') g`)).r[0].g
  ok('#4 tên lạ không trùng', kt.trung_niem_yet === false)

  console.log('\n── 5 · sp_loi_dong map ──')
  const m = (await asK(U.ceo, `select kho.sp_loi_dong() g`)).r[0].g
  ok('#5 map có lõi vừa tạo → GN', m[l1.ma_loi] && m[l1.ma_loi].dong === 'GN', JSON.stringify(m[l1.ma_loi]))

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_106: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
