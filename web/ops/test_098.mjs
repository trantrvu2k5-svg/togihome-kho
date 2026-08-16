// TEST CẮN — 098 · vá rà L-64 app Tài chính (L-65). Tx rollback.
//   gia_von_don_ds: +ke_toan XEM · phân trang {tong,ds} · sale/tho/NULL CHẶN
//   niem_yet_info: gác vai ceo/ke_toan (trước HỞ) · sale/tho/NULL CHẶN
//   ghi_gia_von_tay: GIỮ ceo/kho · ke_toan CHẶN (XEM được, GHI không)
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
try {
  await c.query('begin')

  console.log('── 1 · gia_von_don_ds: ceo/kho/ke_toan XEM · sale/tho/NULL CHẶN ──')
  for (const v of ['ceo','kho','ke_toan']) ok(`#1 ${v} XEM ĐƯỢC`, (await asK(U[v], `select kho.gia_von_don_ds(50,0)`)).e === null)
  for (const v of ['sale','tho','NULLVAI']) ok(`#1 ${v} → CHẶN`, (await asK(U[v], `select kho.gia_von_don_ds(50,0)`)).e !== null)

  console.log('\n── 2 · phân trang {tong, ds} + limit thật ──')
  const g = await gK(U.ke_toan, `select kho.gia_von_don_ds(50,0) g`)
  ok('#2 trả object có tong + ds (mảng)', g && typeof g.tong === 'number' && Array.isArray(g.ds), JSON.stringify({tong:g.tong, ds:Array.isArray(g.ds)}))
  ok('#2 ds ≤ 50 (limit)', g.ds.length <= 50)
  const g2 = await gK(U.ke_toan, `select kho.gia_von_don_ds(2,0) g`)
  ok('#2 p_gioi_han=2 → ds ≤ 2', g2.ds.length <= 2, 'ds=' + g2.ds.length)
  ok('#2 tong KHÔNG đổi theo trang (đếm riêng)', g2.tong === g.tong, `${g2.tong} vs ${g.tong}`)
  ok('#2 đơn CHƯA có giá vốn lên đầu (co_gia_von false trước)', g.ds.length < 2 || !(g.ds[0].co_gia_von === true && g.ds.some(x => x.co_gia_von === false)))
  ok('#2 KHÔNG rò trường lạ (đúng bộ cột giá vốn)', g.ds.length === 0 || ['ma_don','co_gia_von','khoi_1','gia_chuyen_giao'].every(k => k in g.ds[0]), JSON.stringify(Object.keys(g.ds[0] || {})))

  console.log('\n── 3 · niem_yet_info: THÊM gác (trước HỞ) — ceo/ke_toan ĐƯỢC · sale/tho/NULL CHẶN ──')
  const ky = "select kho.niem_yet_info('2026-07')"
  for (const v of ['ceo','ke_toan']) ok(`#3 ${v} gọi ĐƯỢC`, (await asK(U[v], ky)).e === null)
  for (const v of ['sale','tho','NULLVAI']) ok(`#3 ${v} → CHẶN (trước HỞ)`, (await asK(U[v], ky)).e !== null)

  console.log('\n── 4 · ghi_gia_von_tay GIỮ ceo/kho — ke_toan XEM được nhưng GHI KHÔNG ──')
  // gọi với đơn không tồn tại: nếu QUA cổng vai sẽ báo "không có đơn"; nếu bị cổng chặn báo "chỉ ceo/kho"
  const thu = uid => asK(uid, `select kho.ghi_gia_von_tay('__KO_CO__', 1, 0, 0, 'test')`)
  ok('#4 ke_toan bị CỔNG VAI chặn (chỉ ceo/kho)', /chỉ ceo\/kho/.test((await thu(U.ke_toan)).e || ''), (await thu(U.ke_toan)).e)
  ok('#4 sale → CHẶN', (await thu(U.sale)).e !== null)
  const eCeo = (await thu(U.ceo)).e || ''
  ok('#4 ceo QUA cổng vai (chỉ vướng "không có đơn")', /không có đơn/.test(eCeo) && !/chỉ ceo\/kho/.test(eCeo), eCeo)

  console.log('\n── 5 · bản CŨ table không còn — no-arg nay rơi vào bản DEFAULT (int,int) trả jsonb ──')
  // KHÔNG còn proc no-arg RIÊNG (migration đã check to_regprocedure). Gọi no-arg → dùng default 50/0 → jsonb {tong,ds}.
  const g5 = await gK(U.ceo, `select kho.gia_von_don_ds() g`)
  ok('#5 no-arg dùng default → trả jsonb {tong,ds} (không phải table cũ)', g5 && typeof g5.tong === 'number' && Array.isArray(g5.ds), JSON.stringify(g5).slice(0,80))
  const nArgs = (await c.query(`select count(*)::int n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace where nn.nspname='kho' and proname='gia_von_don_ds'`)).rows[0].n
  ok('#5 chỉ CÒN 1 overload gia_von_don_ds (bản table cũ đã drop)', nArgs === 1, 'overloads=' + nArgs)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_098: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
