// TEST CẮN — 099 · nguon_khach + sale_dai_so_bao_gia (dải 6 số). Tx rollback.
//   guard vai · limit so6 · KHÔNG giá vốn · ngưỡng [TẠM]=30 · số cộng-được đúng delta · CHECK nguon_khach.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tnsale:'85f5a6bf-dd52-487b-b7b1-6ddea4508333', tkbh:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
const SALE_NS = '6f30244c-b9e4-4985-925c-0dd7ac0f7b9a'
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

  console.log('── 1 · nguon_khach: cột + CHECK miền ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,nguon_khach) values('L67N1','bao_gia','le','K',$1)`, ['gioi_thieu'])
  ok('#1 nhận giá trị hợp lệ (gioi_thieu)', (await q(`select nguon_khach from kho.don_hang where ma_don='L67N1'`))[0].nguon_khach === 'gioi_thieu')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('L67N2','bao_gia','le','K')`)
  ok('#1 null hợp lệ (không bắt buộc)', (await q(`select nguon_khach from kho.don_hang where ma_don='L67N2'`))[0].nguon_khach === null)
  let bad = null; await c.query('savepoint b')
  try { await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,nguon_khach) values('L67N3','bao_gia','le','K','tiktok_bừa')`) } catch (e) { bad = e.message; await c.query('rollback to savepoint b') }
  ok('#1 CHECK chặn giá trị NGOÀI miền', bad !== null, 'lẽ ra chặn "tiktok_bừa"')

  console.log('\n── 2 · sale_dai_so_bao_gia: GUARD vai ──')
  for (const v of ['sale','tnsale','tkbh','ceo']) ok(`#2 ${v} GỌI ĐƯỢC`, (await asK(U[v], `select kho.sale_dai_so_bao_gia(50)`)).e === null)
  for (const v of ['xuong','tho','NULLVAI']) ok(`#2 ${v} → CHẶN`, (await asK(U[v], `select kho.sale_dai_so_bao_gia(50)`)).e !== null)

  console.log('\n── 3 · KHÔNG giá vốn + ngưỡng [TẠM] ──')
  const g0 = await gK(U.sale, `select kho.sale_dai_so_bao_gia(50) g`)
  ok('#3 đủ 6 số + tong_funnel + nguong_tam', ['so1_thua_gia','so2_hoi_den_gia','so3_chot_theo_treo','so4_vong_sua','so5_chot_tu_dung','so6_theo_sale'].every(k => k in g0) && g0.nguong_tam === 30)
  ok('#3 KHÔNG rò cột giá vốn (khoi_/gia_chuyen_giao/gia_von)', !/khoi_[123]|gia_chuyen_giao|gia_von/.test(JSON.stringify(g0)), JSON.stringify(g0).match(/\w*von\w*/g))
  ok('#3 so6 don_tb là GIÁ BÁN (khóa "don_tb", không "gia_von")', g0.so6_theo_sale.every(s => 'don_tb' in s && !('gia_von' in s)))

  console.log('\n── 4 · số CỘNG ĐƯỢC đúng delta khi thêm 4 đơn funnel ──')
  const base = g0
  // D1 thua-giá · D2 thua-khác · D3 chốt trong 7 ngày + tu_dung + có nhu cầu · D4 báo giá tu_dung=false không nhu cầu
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,tao_luc,ngay_tao_bao_gia,ly_do_thua,tu_dung,nguoi_tao,doanh_thu)
           values('L67D1','bao_gia_thua','le','Ka',false,now()-interval '6 day',now()-interval '4 day','gia_cao',false,$1,10000000)`, [SALE_NS])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,tao_luc,ngay_tao_bao_gia,ly_do_thua,tu_dung,nguoi_tao,doanh_thu)
           values('L67D2','bao_gia_thua','le','Kb',false,now()-interval '6 day',now()-interval '4 day','cham',false,$1,10000000)`, [SALE_NS])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,tao_luc,ngay_tao_bao_gia,ngay_chot,tu_dung,phong_cach,nguoi_tao,doanh_thu)
           values('L67D3','moi_len_don','le','Kc',false,now()-interval '6 day',(now()-interval '5 day')::date,(now()-interval '1 day')::date,true,'hiện đại',$1,20000000)`, [SALE_NS])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,tao_luc,ngay_tao_bao_gia,tu_dung,nguoi_tao,doanh_thu)
           values('L67D4','bao_gia','le','Kd',false,now()-interval '6 day',now()-interval '4 day',false,$1,10000000)`, [SALE_NS])
  const g1 = await gK(U.sale, `select kho.sale_dai_so_bao_gia(50) g`)
  ok('#4 tong_funnel +4', g1.tong_funnel - base.tong_funnel === 4, `${base.tong_funnel}→${g1.tong_funnel}`)
  ok('#4 so1 tổng_thua +2 · thua_gia +1', g1.so1_thua_gia.tong_thua - base.so1_thua_gia.tong_thua === 2 && g1.so1_thua_gia.thua_gia - base.so1_thua_gia.thua_gia === 1)
  ok('#4 so5 tu_dung.n +1 · giao_tk.n +3', g1.so5_chot_tu_dung.tu_dung.n - base.so5_chot_tu_dung.tu_dung.n === 1 && g1.so5_chot_tu_dung.giao_tk.n - base.so5_chot_tu_dung.giao_tk.n === 3)
  ok('#4 so4 co_nhu_cau.n +1 · khong.n +3', g1.so4_vong_sua.co_nhu_cau.n - base.so4_vong_sua.co_nhu_cau.n === 1 && g1.so4_vong_sua.khong.n - base.so4_vong_sua.khong.n === 3)
  ok('#4 so3 chốt≤7 ngày có tính D3 (d7.n +4, tỉ lệ>0)', g1.so3_chot_theo_treo.n - base.so3_chot_theo_treo.n === 4 && Number(g1.so3_chot_theo_treo.d7) > 0)
  ok('#4 so2 trung vị hỏi→giá = 2 ngày (D1..D4 đều 2)', Number(g1.so2_hoi_den_gia.trung_vi_ngay) >= 1)

  console.log('\n── 5 · so6 LIST có LIMIT ──')
  const gl = await gK(U.sale, `select kho.sale_dai_so_bao_gia(1) g`)
  ok('#5 p_gioi_han=1 → so6 ≤ 1 dòng', gl.so6_theo_sale.length <= 1, 'len=' + gl.so6_theo_sale.length)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_099: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
