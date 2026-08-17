// TEST CẮN — 100 · tab ĐIỀU HÀNH: dieu_hanh_bang + nới guard (sale_bao_gia_ds, sale_dai_so_bao_gia). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
try {
  await c.query('begin')

  console.log('── 1 · dieu_hanh_bang GUARD ceo/ke_toan ──')
  for (const v of ['ceo','ke_toan']) ok(`#1 ${v} GỌI ĐƯỢC`, (await asK(U[v], `select kho.dieu_hanh_bang(100)`)).e === null)
  for (const v of ['sale','xuong','tho','NULLVAI']) ok(`#1 ${v} → CHẶN`, (await asK(U[v], `select kho.dieu_hanh_bang(100)`)).e !== null)

  console.log('\n── 2 · NỚI guard: ke_toan nay gọi được sale_bao_gia_ds + sale_dai_so_bao_gia (cho phễu + dải) ──')
  ok('#2 ke_toan gọi sale_bao_gia_ds ĐƯỢC (trước chặn)', (await asK(U.ke_toan, `select kho.sale_bao_gia_ds(50)`)).e === null)
  ok('#2 ke_toan gọi sale_dai_so_bao_gia ĐƯỢC', (await asK(U.ke_toan, `select kho.sale_dai_so_bao_gia(50)`)).e === null)
  ok('#2 sale VẪN gọi được (không phá sale app)', (await asK(U.sale, `select kho.sale_bao_gia_ds(50)`)).e === null)
  ok('#2 NULL vẫn CHẶN sale_bao_gia_ds', (await asK(U.NULLVAI, `select kho.sale_bao_gia_ds(50)`)).e !== null)

  console.log('\n── 3 · cấu trúc + KHÔNG rò giá vốn theo đơn ──')
  const g0 = await gK(U.ceo, `select kho.dieu_hanh_bang(100) g`)
  ok('#3 đủ khối: sx/giao/tồn/ngưỡng', ['sx_tac','sx_dang','giao_chua_thu','phai_thu_tong','so_don_giao_no','ton_gia_tri','nguong_sx_lang'].every(k => k in g0))
  ok('#3 KHÔNG rò giá vốn THEO ĐƠN (khoi_/gia_chuyen_giao)', !/khoi_[123]|gia_chuyen_giao/.test(JSON.stringify(g0)))
  ok('#3 ton_gia_tri là SỐ (tổng giá trị tồn, hợp lệ cho ceo/ke_toan)', typeof g0.ton_gia_tri !== 'undefined')

  console.log('\n── 4 · giao-chưa-thu đúng + LIMIT ──')
  const base = g0.so_don_giao_no
  for (const i of [1,2,3]) await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_giao,doanh_thu,so_tien_thuc_thu) values('T100G${i}','da_giao','le','KG${i}',false,current_date-3,10000000,${i}000000)`)
  const g1 = await gK(U.ceo, `select kho.dieu_hanh_bang(100) g`)
  ok('#4 so_don_giao_no +3', g1.so_don_giao_no - base === 3, `${base}→${g1.so_don_giao_no}`)
  const t1 = (g1.giao_chua_thu || []).find(x => x.ma_don === 'T100G1')
  ok('#4 con_thu đúng (10tr − 1tr = 9tr)', t1 && Number(t1.con_thu) === 9000000, JSON.stringify(t1))
  const gl = await gK(U.ceo, `select kho.dieu_hanh_bang(2) g`)
  ok('#4 p_gioi_han=2 → giao_chua_thu ≤ 2 (nhưng đếm tổng vẫn đủ)', gl.giao_chua_thu.length <= 2 && gl.so_don_giao_no === g1.so_don_giao_no, `list=${gl.giao_chua_thu.length} tong=${gl.so_don_giao_no}`)
  ok('#4 phai_thu_tong tăng đúng +24tr (9+8+7)', g1.phai_thu_tong - g0.phai_thu_tong === 24000000, `+${g1.phai_thu_tong - g0.phai_thu_tong}`)

  console.log('\n── 5 · demo bị loại khỏi giao-nợ ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_giao,doanh_thu,so_tien_thuc_thu) values('T100DEMO','da_giao','le','KD',true,current_date-3,10000000,0)`)
  const g2 = await gK(U.ceo, `select kho.dieu_hanh_bang(100) g`)
  ok('#5 đơn demo KHÔNG vào giao-nợ', g2.so_don_giao_no === g1.so_don_giao_no, `${g1.so_don_giao_no} vs ${g2.so_don_giao_no}`)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_100: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
