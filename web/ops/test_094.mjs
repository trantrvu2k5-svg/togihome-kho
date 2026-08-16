// TEST CẮN — 094 · sale_tien_do_mon (sale XEM tiến độ xưởng của đơn). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
try {
  await c.query('begin')
  // đơn SX + 2 món; món A: 2 tem (1 xong hết, 1 đang bước 2/5); món B: 1 tem bước 4/5
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T94','dang_lam','le','KH94')`)
  const donId = (await q(`select id from kho.don_hang where ma_don='T94'`))[0].id
  const mA = (await q(`insert into kho.don_hang_mon(don_id,ten,trang_thai) values($1,'Tủ áo A','dang_lam') returning id`, [donId]))[0].id
  const mB = (await q(`insert into kho.don_hang_mon(don_id,ten,trang_thai) values($1,'Kệ B','dang_lam') returning id`, [donId]))[0].id
  await q(`insert into kho.tien_do_tem(tem_ma,mon_id,ma_don,buoc_hien_tai,to_hien_tai,trang_thai,vao_luc,ra_luc,so_buoc_xong,tong_so_buoc)
    values ('t94a1',$1,'T94',5,'to_son','xong_het', now()-interval '3 days', now()-interval '2 days', 5,5),
           ('t94a2',$1,'T94',2,'to_cat','dang_lam', now()-interval '1 day',  now()-interval '2 hours',1,5),
           ('t94b1',$2,'T94',4,'to_lap','dang_lam', now()-interval '2 days', now()-interval '5 hours',3,5)`, [mA, mB])

  console.log('── 1 · mỗi món 1 dòng, bước = tem KÉM tiến độ nhất ──')
  const g = await gK(U.sale, `select kho.sale_tien_do_mon('T94') g`)
  const byId = Object.fromEntries((g || []).map(x => [x.mon_id, x]))
  ok('#1 trả 2 món', Array.isArray(g) && g.length === 2, JSON.stringify(g).slice(0, 120))
  const A = byId[mA] || {}, B = byId[mB] || {}
  ok('#1 món A: bước 2/5 (tem kém nhất, KHÔNG lấy tem đã xong)', A.buoc === 2 && A.tong_buoc === 5, JSON.stringify(A))
  ok('#1 món A: so_tem=2 · tem_xong=1', A.so_tem === 2 && A.tem_xong === 1)
  ok('#1 món B: bước 4/5 · tổ to_lap', B.buoc === 4 && B.to === 'to_lap')
  ok('#1 lan_quet = ra_luc gần nhất (món A quét cách 2h)', A.lan_quet && (Date.now() - new Date(A.lan_quet)) < 6 * 3600e3)

  console.log('\n── 3 · cổng vai + KHÔNG giá vốn ──')
  ok('#3 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.sale_tien_do_mon('T94')`)).e !== null)
  ok('#3 tho → CHẶN', (await asK(U.tho, `select kho.sale_tien_do_mon('T94')`)).e !== null)
  ok('#3 ceo xem được', Array.isArray(await gK(U.ceo, `select kho.sale_tien_do_mon('T94') g`)))
  const keys = Object.keys(A)
  ok('#3 KHÔNG trường giá vốn (gia_von/gia/tien/von)',
    !keys.some(k => /gia_von|^gia$|^tien$|von|doanh_thu|chuyen_giao/.test(k)), JSON.stringify(keys))

  console.log('\n── 4 · đơn KHÔNG có tem → mảng rỗng ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T94E','bao_gia','le','x')`)
  ok('#4 đơn không tem → []', JSON.stringify(await gK(U.sale, `select kho.sale_tien_do_mon('T94E') g`)) === '[]')

  await c.query('rollback')
  console.log('   (đã ROLLBACK T94/T94E)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_094: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
