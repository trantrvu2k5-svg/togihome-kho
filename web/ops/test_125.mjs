// TEST PHẢI CẮN — 125 · xoa_demo bypass MOC_CHUAN chỉ khi GUC + demo (D8/WP-04). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!e) await c.query('release savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
// thử DELETE trực tiếp số chốt của 1 món (savepoint rollback). guc=true → mở cổng bypass.
async function delMoc(mon, guc) {
  await c.query('savepoint d')
  if (guc) await c.query("set local kho.xoa_demo='1'")
  let e = null; try { await c.query(`delete from kho.so_don_vi_mon where mon_id=$1`, [mon]) } catch (x) { e = x.message }
  try { await c.query('rollback to savepoint d') } catch (_) {}
  if (guc) await c.query("set local kho.xoa_demo='0'")
  return e
}
async function mkDon(ma, ten) {  // đơn + món + số CHỐT (moc chuan, chot_luc)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ten_khach) values($1,'cho_cat','le',9000000,0,0,$2)`, [ma, ten])
  const oid = (await one(`select id from kho.don_hang where ma_don=$1`, [ma])).id
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) values($1,'Tủ',1,9000000,false)`, [oid])
  const mon = (await one(`select id from kho.don_hang_mon where don_id=$1`, [oid])).id
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon,moc,chot_luc) values($1,'cat',1,'go_tay','chuan',now())`, [mon])
  return { oid, mon }
}
try {
  await c.query('begin')
  const dm = await mkDon('DEMO-C01', 'DEMO chốt')          // la_demo=true (ten DEMO*)
  const th = await mkDon('THAT-C01', 'Khách thật chốt')    // la_demo=false
  ok('#0 đơn demo la_demo=true · đơn thật false',
     (await one(`select la_demo from kho.don_hang where ma_don='DEMO-C01'`)).la_demo === true &&
     (await one(`select la_demo from kho.don_hang where ma_don='THAT-C01'`)).la_demo === false)

  console.log('── 1 · DELETE trực tiếp số chốt ──')
  ok('#1 KHÔNG GUC · đơn thật đã chốt → CHẶN', /MOC_CHUAN_DA_CHOT/.test(await delMoc(th.mon, false) || ''))
  ok('#1 KHÔNG GUC · đơn demo đã chốt → CHẶN (chưa mở cổng)', /MOC_CHUAN_DA_CHOT/.test(await delMoc(dm.mon, false) || ''))
  ok('#1 CÓ GUC · đơn THẬT đã chốt → VẪN CHẶN (chỉ bypass demo)', /MOC_CHUAN_DA_CHOT/.test(await delMoc(th.mon, true) || ''))
  ok('#1 CÓ GUC · đơn DEMO đã chốt → CHO XOÁ (không lỗi)', (await delMoc(dm.mon, true)) === null)

  console.log('\n── 2 · xoa_demo (đặt GUC bên trong) xoá đơn demo đã chốt ──')
  const xd = await as(U.ceo, `select kho.xoa_demo('DEMO-C01') g`)
  ok('#2 xoa_demo đơn demo đã chốt → OK (không còn MOC_CHUAN)', xd.e === null, xd.e)
  ok('#2 đơn demo đã bị xoá', Number((await one(`select count(*) n from kho.don_hang where ma_don='DEMO-C01'`)).n) === 0)
  ok('#2 đơn THẬT KHÔNG bị đụng', Number((await one(`select count(*) n from kho.don_hang where ma_don='THAT-C01'`)).n) === 1)
  const xt = await as(U.ceo, `select kho.xoa_demo('THAT-C01') g`)
  ok('#2 xoa_demo đơn THẬT → RAISE (không phải demo)', xt.e !== null && /KHÔNG phải demo/i.test(xt.e), xt.e)

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_125: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); process.exit(F === 0 ? 0 : 1) }
