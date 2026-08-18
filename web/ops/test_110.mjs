// TEST CẮN — 110 · lap_day_ky: guard · số suy · chưa chốt · bất biến bỏ trống (cả âm) · lọc đúng kỳ · tốc độ. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
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
const KY = '2099-05', KY_KHAC = '2099-06', KY_AM = '2099-07', KY_CHUA = '2099-09'

try {
  await c.query('begin')
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`); await c.query(`set local chan.off_khachmoi='1'`)

  // SEED số suy: 3 tổ × (10tr+2tr+1tr)=39tr cho KY
  const TO = ['cnc', 'dan_canh', 'lap_rap']
  for (const t of TO) await q(`insert into kho.luong_to(ma_ky,ma_to,luong_to,overhead_phan_bo,bao_hiem) values($1,$2,10000000,2000000,1000000)`, [KY, t])
  await q(`insert into kho.luong_to(ma_ky,ma_to,luong_to,overhead_phan_bo,bao_hiem) values($1,'cnc',7000000,0,0)`, [KY_CHUA]) // suy=7tr, KHÔNG tham số
  // tham số kỳ: KY chốt 50tr; KY_AM chốt 5tr (để âm)
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,chi_phi_nang_luc) values($1,'ban_hang',50000000)`, [KY])
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,chi_phi_nang_luc) values($1,'ban_hang',5000000)`, [KY_AM])
  // đơn da_giao + giá vốn khoi_2: KY: 6tr+4tr=10tr; KY_KHAC: 99tr (KHÔNG lọt); KY_AM: 8tr (>5tr → âm)
  const seedDon = async (ma, ky, k2) => {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ngay_giao) values($1,'da_giao','le',$2)`, [ma, ky + '-15'])
    await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values($1,0,$2,0,$2,'plugin')`, [ma, k2])
  }
  await seedDon('T110-a', KY, 6000000); await seedDon('T110-b', KY, 4000000)
  await seedDon('T110-khac', KY_KHAC, 99000000)
  await seedDon('T110-am', KY_AM, 8000000)

  console.log('── 1 · GUARD vai ──')
  ok('#1 NULLVAI → CHẶN', (await asK(U.NULLVAI, `select kho.lap_day_ky('${KY}')`)).e !== null)
  ok('#1 sale → CHẶN', (await asK(U.sale, `select kho.lap_day_ky('${KY}')`)).e !== null)
  ok('#1 ceo → QUA', (await asK(U.ceo, `select kho.lap_day_ky('${KY}') g`)).e === null)

  console.log('\n── 2 · số suy = tổng tay từ luong_to (39tr) ──')
  const g = await gK(U.ceo, `select kho.lap_day_ky('${KY}') g`)
  ok('#2 so_suy_tu_luong_to = 39.000.000', Number(g.so_suy_tu_luong_to) === 39000000, JSON.stringify(g.so_suy_tu_luong_to))

  console.log('\n── 3 · kỳ CHƯA chốt tham số → trả số suy + cờ ──')
  const gc = await gK(U.ceo, `select kho.lap_day_ky('${KY_CHUA}') g`)
  ok('#3 chua_chot_tham_so = true', gc.chua_chot_tham_so === true)
  ok('#3 chi_phi_nang_luc = null, mau_so_dung = số suy (7tr)', gc.chi_phi_nang_luc === null && Number(gc.mau_so_dung) === 7000000, JSON.stringify(gc))

  console.log('\n── 4 · bất biến tien_bo_trong = mau_so − tong_khoi_2 (dương + âm) ──')
  ok('#4 KY: mau=50tr, k2=10tr → bỏ trống 40tr · tỷ lệ 0,2', Number(g.mau_so_dung) === 50000000 && Number(g.tong_khoi_2) === 10000000 && Number(g.tien_bo_trong) === 40000000 && Math.abs(Number(g.ty_le_lap_day) - 0.2) < 1e-9, JSON.stringify(g))
  const ga = await gK(U.ceo, `select kho.lap_day_ky('${KY_AM}') g`)
  ok('#4 KY_AM: mau=5tr, k2=8tr → tien_bo_trong ÂM (−3tr) = vượt năng lực', Number(ga.tien_bo_trong) === -3000000 && Number(ga.tong_khoi_2) === 8000000, JSON.stringify(ga))
  ok('#4 bất biến chung: tien_bo_trong = mau_so − tong_khoi_2', Number(ga.tien_bo_trong) === Number(ga.mau_so_dung) - Number(ga.tong_khoi_2))

  console.log('\n── 5 · tong_khoi_2 chỉ đơn ĐÚNG kỳ (đơn kỳ khác không lọt) ──')
  ok('#5 KY tong_khoi_2 = 10tr (KHÔNG gồm 99tr của KY_KHAC)', Number(g.tong_khoi_2) === 10000000)
  const gk = await gK(U.ceo, `select kho.lap_day_ky('${KY_KHAC}') g`)
  ok('#5 KY_KHAC tong_khoi_2 = 99tr (đúng kỳ đó)', Number(gk.tong_khoi_2) === 99000000)

  console.log('\n── 6 · TỐC ĐỘ 100.000 đơn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ngay_giao) select 'P110-'||g,'da_giao','le',$1 from generate_series(1,100000) g`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'P110-'||g,0,500000,0,500000,'plugin' from generate_series(1,100000) g`)
  await c.query('analyze kho.don_hang'); await c.query('analyze kho.don_hang_gia_von'); await c.query('analyze kho.luong_to')
  await c.query('savepoint s6'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  const t0 = Date.now(); const r6 = await c.query(`select kho.lap_day_ky('${KY}') g`); const ms = Date.now() - t0
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); await c.query('release savepoint s6')
  ok(`#6 lap_day_ky trên 100.000+ đơn = ${ms}ms (<500) · tong_khoi_2=${Math.round(Number(r6.rows[0].g.tong_khoi_2)).toLocaleString('vi-VN')}đ`, ms < 500)

  await c.query('rollback')
  ok('rollback sạch', (await q(`select count(*)::int n from kho.don_hang where ma_don like 'T110-%' or ma_don like 'P110-%'`))[0].n === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_110: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
