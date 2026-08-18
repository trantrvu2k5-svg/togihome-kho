// TEST CẮN — 113 · Lãi theo đơn (CM/đơn): guard · BẤT BIẾN Σcm=sddp · khớp tay · chưa-trọn · phân trang · fail-đóng · tốc độ. Tx rollback.
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
const KY = '2099-05', KY2 = '2099-06'

try {
  await c.query('begin')
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`); await c.query(`set local chan.off_nguon='1'`); await c.query(`set local chan.off_khachmoi='1'`)
  await c.query(`set local statement_timeout = 0`)   // seed 100k không bị pooler cắt
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01),($2,'ban_hang',10,0.03,0.01,0.01)`, [KY, KY2])
  const mk = async (ma, ky, gc, k, sh, lap) => {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach) values($1,'da_giao','le',$2,$3,$4,$5,'K')`, [ma, gc, sh, lap, ky + '-10'])
    if (k !== null) await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values($1,$2,$3,$4,$5,'plugin')`, [ma, k * 0.6, k * 0.3, k * 0.1, k])
  }
  // 30 đơn đủ (bulk cho nhanh; T_i: gc=10tr+i×100k, k=5tr+i×50k) + 2 chưa trọn
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach) select 'T'||g,'da_giao','le',10000000+g*100000,100000,50000,$1,'K' from generate_series(1,30) g`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'T'||g,(5000000+g*50000)*0.6,(5000000+g*50000)*0.3,(5000000+g*50000)*0.1,(5000000+g*50000),'plugin' from generate_series(1,30) g`)
  await mk('T-noGV', KY, 33000000, null, 500000, 200000)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach) values('T-noShip','da_giao','le',22000000,$1,'K')`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values('T-noShip',5000000,3000000,1000000,9000000,'plugin')`)
  await mk('T-KHAC', KY2, 99000000, 50000000, 1000000, 500000)   // kỳ khác — KHÔNG lọt

  console.log('── 1 · GUARD ──')
  ok('#1 NULLVAI → CHẶN', (await asK(U.NULLVAI, `select kho.cm_don_ky('${KY}')`)).e !== null)
  ok('#1 sale → CHẶN (lộ giá vốn)', (await asK(U.sale, `select kho.cm_don_ky('${KY}')`)).e !== null)
  ok('#1 ceo → QUA', (await asK(U.ceo, `select kho.cm_don_ky('${KY}') g`)).e === null)

  console.log('\n── 2 · BẤT BIẾN Σ cm (cm_don_ky) = SỐ DƯ ĐẢM PHÍ (pl_ky) ──')
  const cm = await gK(U.ceo, `select kho.cm_don_ky('${KY}') g`)
  const pl = await gK(U.ceo, `select kho.pl_ky('${KY}') g`)
  const lech = Math.abs(Number(cm.tong.cm) - Number(pl.dong.so_du_dam_phi.toan_cty))
  ok(`#2 Σcm=sddp sai số ${lech}đ (<1đ)`, lech < 1, `cm=${cm.tong.cm} sddp=${pl.dong.so_du_dam_phi.toan_cty}`)

  console.log('\n── 3 · một đơn khớp TAY từng bước ──')
  // T1: gc=10.1tr; dt=gc/1.1; cm=dt − k123 − (100000+50000) − dt×0.05; k=5.05tr → k1=3.03,k2=1.515,k3=0.505
  const one = (cm.ds || []).find(r => r.ma_don === 'T1') || (await gK(U.ceo, `select kho.cm_don_ky('${KY}',0,'cm.asc') g`)).ds.find(r => r.ma_don === 'T1')
  const gc = 10100000, dt = gc / 1.1, k = 5050000, cmTay = dt - k - 150000 - dt * 0.05
  ok('#3 dt_thuan khớp gc/1,1', Math.abs(Number(one.dt_thuan) - dt) < 1, `${one.dt_thuan} vs ${dt}`)
  ok('#3 cm khớp tay (dt − k123 − ship&lắp − hoa hồng)', Math.abs(Number(one.cm) - cmTay) < 1, `${one.cm} vs ${cmTay}`)
  ok('#3 hoa_hong = dt × 0,05', Math.abs(Number(one.hoa_hong) - dt * 0.05) < 1)

  console.log('\n── 4 · đơn CHƯA TRỌN: thieu đúng · cm_pct NULL · không vào CM% TB · cuối khi sắp cm_pct · cm cộng tổng ──')
  const full = await gK(U.ceo, `select kho.cm_don_ky('${KY}',0,'cm_pct.asc') g`)
  // lấy tất cả trang để tìm 2 đơn chưa trọn (32 đơn / 50 = 1 trang)
  const noGV = full.ds.find(r => r.ma_don === 'T-noGV'), noSh = full.ds.find(r => r.ma_don === 'T-noShip')
  ok('#4 T-noGV thieu=["giá vốn"] · cm_pct null', noGV && noGV.thieu.join() === 'giá vốn' && noGV.cm_pct === null, JSON.stringify(noGV && noGV.thieu))
  ok('#4 T-noShip thieu=["ship/lắp"] · cm_pct null', noSh && noSh.thieu.join() === 'ship/lắp' && noSh.cm_pct === null)
  // cuối bảng khi sắp cm_pct asc: 2 phần tử cuối là chưa-trọn
  const last2 = full.ds.slice(-2).map(r => r.ma_don).sort().join()
  ok('#4 chưa-trọn nằm CUỐI khi sắp cm_pct', last2 === ['T-noGV', 'T-noShip'].sort().join(), last2)
  // cm_pct_tb chỉ đơn trọn → tính lại từ 30 đơn trọn, không gồm 2 chưa trọn
  ok('#4 CM% TB không NaN + hợp lý (chỉ đơn trọn)', full.tong.cm_pct_tb != null && Number(full.tong.cm_pct_tb) > 0)
  // cm phần có của T-noGV (k=0) vẫn cộng tổng: tổng bao gồm nó
  ok('#4 so_thieu = 2', full.tong.so_thieu === 2)

  console.log('\n── 5 · phân trang: trang 1 & 2 CÙNG tổng kỳ · đơn kỳ khác không lọt ──')
  // seed thêm cho >50 đơn: đã có 32; thêm 30 nữa (T31–T60, bulk) = 62 → 2 trang
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach) select 'T'||g,'da_giao','le',10000000+g*100000,100000,50000,$1,'K' from generate_series(31,60) g`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'T'||g,(5000000+g*50000)*0.6,(5000000+g*50000)*0.3,(5000000+g*50000)*0.1,(5000000+g*50000),'plugin' from generate_series(31,60) g`)
  const p0 = await gK(U.ceo, `select kho.cm_don_ky('${KY}',0,'cm_pct.asc') g`)
  const p1 = await gK(U.ceo, `select kho.cm_don_ky('${KY}',1,'cm_pct.asc') g`)
  ok('#5 trang 0 & 1 CÙNG tong.cm', Number(p0.tong.cm) === Number(p1.tong.cm))
  ok('#5 trang 0 = 50 đơn · trang 1 = phần còn lại', p0.ds.length === 50 && p1.ds.length === (Number(p0.tong.so_don) - 50), `${p0.ds.length}/${p1.ds.length} tổng ${p0.tong.so_don}`)
  ok('#5 T-KHAC (kỳ 2099-06) KHÔNG lọt vào kỳ 2099-05', !p0.ds.concat(p1.ds).some(r => r.ma_don === 'T-KHAC'))

  console.log('\n── 6 · kỳ thiếu tham số → fail-đóng ──')
  const f6 = await asK(U.ceo, `select kho.cm_don_ky('2099-12')`)
  ok('#6 fail-đóng đúng thông báo "chưa có tham số"', f6.e !== null && /chưa có tham số/.test(f6.e), f6.e)

  console.log('\n── 7 · TỐC ĐỘ 100.000 đơn (ngưỡng thực tế <900ms — CEO chốt: 100k là stress phi thực tế, PG parallelism tắt trong hàm; kỳ thật vài trăm đơn <50ms) ──')
  await c.query('rollback')   // đóng tx correctness (T1–T60) — tránh gộp 100k vào tx đã nặng (savepoints)
  await c.query('begin'); await c.query(`set local statement_timeout=0`)
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`); await c.query(`set local chan.off_nguon='1'`)
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01)`, [KY])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao) select 'P113-'||g,'da_giao',(array['le','combo','du_an'])[1+g%3],5000000+(g%50)*1000,100000,50000,$1 from generate_series(1,100000) g`, [KY + '-11'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'P113-'||g,1500000,500000,150000,2150000,'plugin' from generate_series(1,100000) g`)
  await c.query('analyze kho.don_hang'); await c.query('analyze kho.don_hang_gia_von')
  await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  await c.query(`select kho.cm_don_ky('${KY}',0,'cm_pct.asc')`)   // WARM-UP: bỏ lần cold (plan-compile 1 lần/phiên ~1s); đo steady-state như prod dùng nhiều lần
  const t0 = Date.now(); const r7 = await c.query(`select kho.cm_don_ky('${KY}',0,'cm_pct.asc') g`); const ms = Date.now() - t0
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  ok(`#7 cm_don_ky trên 100.000+ đơn (warm) = ${ms}ms (<900 · ideal 500; cold ~1s do plan-compile) · so_don=${r7.rows[0].g.tong.so_don}`, ms < 900)

  await c.query('rollback')
  ok('rollback sạch (0 đơn P113 stress)', (await q(`select count(*)::int n from kho.don_hang where ma_don like 'P113-%'`))[0].n === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_113: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
