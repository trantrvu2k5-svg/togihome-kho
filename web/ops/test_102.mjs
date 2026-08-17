// TEST CẮN — 102 · nhom_so_nguoi (số theo người 30 ngày). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tns:'85f5a6bf-dd52-487b-b7b1-6ddea4508333', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
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
  const SALE_NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.sale]))[0].id
  const TNS_NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.tns]))[0].id

  console.log('── 1 · GUARD truong_nhom_sale/ceo ──')
  for (const v of ['tns','ceo']) ok(`#1 ${v} GỌI ĐƯỢC`, (await asK(U[v], `select kho.nhom_so_nguoi(30,50)`)).e === null)
  for (const v of ['sale','xuong','NULLVAI']) ok(`#1 ${v} → CHẶN`, (await asK(U[v], `select kho.nhom_so_nguoi(30,50)`)).e !== null)

  console.log('\n── 2 · cấu trúc + KHÔNG giá vốn ──')
  const g0 = await gK(U.ceo, `select kho.nhom_so_nguoi(30,50) g`)
  ok('#2 có ds + so_ngay + nguong_tam=30', Array.isArray(g0.ds) && g0.so_ngay === 30 && g0.nguong_tam === 30)
  ok('#2 KHÔNG rò giá vốn', !/khoi_[123]|gia_von|gia_chuyen/.test(JSON.stringify(g0)))

  console.log('\n── 3 · đếm theo người đúng (2 sale, cửa sổ 30 ngày) ──')
  const base = g0.ds.reduce((s, x) => s + x.tao, 0)
  // SALE: 2 đơn (1 chốt), TNS: 1 đơn (0 chốt) — đều trong cửa sổ, giá bán 10tr
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_tao_bao_gia,tao_luc,sale_phu_trach,doanh_thu) values('T102A','moi_len_don','le','K',false,now()-interval '3 day',now()-interval '5 day',$1,10000000)`, [SALE_NS])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_tao_bao_gia,tao_luc,sale_phu_trach,doanh_thu) values('T102B','bao_gia','le','K',false,now()-interval '2 day',now()-interval '4 day',$1,20000000)`, [SALE_NS])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_tao_bao_gia,tao_luc,sale_phu_trach,doanh_thu) values('T102C','bao_gia','le','K',false,now()-interval '1 day',now()-interval '2 day',$1,10000000)`, [TNS_NS])
  // đơn NGOÀI cửa sổ (40 ngày) — không tính
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_tao_bao_gia,tao_luc,sale_phu_trach,doanh_thu) values('T102OLD','bao_gia','le','K',false,now()-interval '40 day',now()-interval '41 day',$1,10000000)`, [SALE_NS])
  const g1 = await gK(U.ceo, `select kho.nhom_so_nguoi(30,50) g`)
  const rowSale = g1.ds.find(x => x.sale_id === SALE_NS), rowTns = g1.ds.find(x => x.sale_id === TNS_NS)
  ok('#3 sale: tao=2, chot=1, ti_le=0.5', rowSale && rowSale.tao === 2 && rowSale.chot === 1 && Number(rowSale.ti_le) === 0.5, JSON.stringify(rowSale))
  ok('#3 tns: tao=1, chot=0', rowTns && rowTns.tao === 1 && rowTns.chot === 0, JSON.stringify(rowTns))
  ok('#3 đơn NGOÀI 30 ngày KHÔNG tính (tổng tao +3, không +4)', g1.ds.reduce((s, x) => s + x.tao, 0) - base === 3)
  ok('#3 gia_tri_tb sale = (10+20)/2 = 15tr', rowSale && Number(rowSale.gia_tri_tb) === 15000000)

  console.log('\n── 4 · TỔNG các hàng == tổng đơn cửa sổ (không rơi đơn) ──')
  const tongHang = g1.ds.reduce((s, x) => s + x.tao, 0)
  const tongThat = (await q(`select count(*)::int c from kho.don_hang where coalesce(la_demo,false)=false and ngay_tao_bao_gia is not null and ngay_tao_bao_gia >= now() - interval '30 days'`))[0].c
  ok('#4 sum(hàng.tao) == đếm đơn cửa sổ', tongHang === tongThat, `${tongHang} vs ${tongThat}`)

  console.log('\n── 5 · LIMIT ──')
  const gl = await gK(U.ceo, `select kho.nhom_so_nguoi(30,1) g`)
  ok('#5 p_gioi_han=1 → ds ≤ 1', gl.ds.length <= 1)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_102: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
