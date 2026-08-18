// TEST CẮN — 108 · P/L + chi phí kỳ: guard · tròn vòng cpk · chép kỳ · bất biến pl_ky · fail-đóng · thiếu giá vốn · tốc độ. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tk:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
const KY = '2099-05', KY0 = '2099-04'   // KY0 = kỳ liền trước

try {
  await c.query('begin')
  // bypass cổng du_an-cần-giá-vốn (db/048) + món-thiếu-giá KHI SEED — chỉ trong tx test, rollback sạch
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`)

  // ── SEED: tham số kỳ + đơn da_giao (le/combo/du_an/khac) + giá vốn (thiếu 1) + chi phí kỳ ──
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01)`, [KY])
  // 4 đơn, mỗi phân khúc 1 đơn; đơn 'khac' để dong NULL
  const DON = [
    ['T108-le','le',120000000,2000000,1000000, true],
    ['T108-combo','combo',90000000,1000000,500000, true],
    ['T108-duan','du_an',60000000,3000000,0, true],
    ['T108-khac',null,30000000,0,0, false],   // dong NULL → cột 'khac'; KHÔNG có giá vốn → test thiếu
  ]
  // INSERT thẳng da_giao (cổng vai chỉ soi UPDATE-transition; INSERT bỏ qua). GUC off_von bỏ cổng du_an-cần-giá-vốn khi seed.
  for (const [ma,dong,gc,sh,lap,coGV] of DON) {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,la_demo) values($1,'da_giao',$2,$3,$4,$5,$6,false)`,
      [ma, dong, gc, sh, lap, KY + '-15'])
    if (coGV) await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values($1,$2,$3,$4,$5,'nhap_tay')`,
      [ma, gc * 0.30, gc * 0.10, gc * 0.03, gc * 0.43])
  }
  // chi phí kỳ: 1 chung (thuê) + 2 truy được (le, combo)
  await q(`insert into kho.chi_phi_ky(ma_ky,loai,so_tien,phan_khuc) values ($1,'thue_mat_bang',40000000,null),($1,'luong_sale',20000000,'le'),($1,'marketing_ads',10000000,'combo')`, [KY])
  // KY0 có sẵn 2 dòng (để test chép kỳ trước)
  await q(`insert into kho.chi_phi_ky(ma_ky,loai,so_tien,phan_khuc) values ($1,'thue_mat_bang',38000000,null),($1,'luong_vp',50000000,null)`, [KY0])

  console.log('── 1 · GUARD vai NULL ──')
  for (const fn of [`select kho.cpk_ds('${KY}')`, `select kho.cpk_ghi('${KY}','[]'::jsonb)`, `select kho.pl_ky('${KY}')`])
    ok('#1 NULLVAI → CHẶN: ' + fn.slice(12, 30), (await asK(U.NULLVAI, fn)).e !== null)

  console.log('\n── 2 · sale CHẶN · ke_toan QUA ──')
  ok('#2 sale pl_ky → CHẶN', (await asK(U.sale, `select kho.pl_ky('${KY}')`)).e !== null)
  ok('#2 ceo pl_ky → QUA', (await asK(U.ceo, `select kho.pl_ky('${KY}') g`)).e === null)

  console.log('\n── 3 · cpk_ghi → cpk_ds tròn vòng ──')
  const bo = [{ loai:'khau_hao', so_tien:'7000000', phan_khuc:null, ghi_chu:'CNC' }, { loai:'luong_vp', so_tien:'55000000', phan_khuc:'du_an', ghi_chu:'x' }]
  const gg = await asK(U.ceo, `select kho.cpk_ghi($1,$2::jsonb) g`, [KY0, JSON.stringify(bo)])
  ok('#3 cpk_ghi ok', gg.e === null && gg.r[0].g.so_dong === 2, gg.e)
  const ds = await gK(U.ceo, `select kho.cpk_ds($1) g`, [KY0])
  ok('#3 cpk_ds trả 2 dòng, tổng 62tr', ds.ds.length === 2 && Number(ds.tong_ky) === 62000000, JSON.stringify(ds.tong_ky))
  ok('#3 dòng khớp loại+tiền+phân khúc', ds.ds.some(r => r.loai === 'khau_hao' && Number(r.so_tien) === 7000000 && r.phan_khuc === null)
    && ds.ds.some(r => r.loai === 'luong_vp' && r.phan_khuc === 'du_an'))

  console.log('\n── 4 · cpk_chep_ky_truoc vào kỳ ĐÃ CÓ dòng → TỪ CHỐI ──')
  ok('#4 KY đã có dòng → chép bị từ chối', (await asK(U.ceo, `select kho.cpk_chep_ky_truoc('${KY}')`)).e !== null)
  // chép vào kỳ rỗng 2099-06 từ 2099-05 (KY có 3 dòng) → OK
  const chep = await asK(U.ceo, `select kho.cpk_chep_ky_truoc('2099-06') g`)
  ok('#4b chép 2099-06 ← 2099-05 (3 dòng)', chep.e === null && chep.r[0].g.ok === true && chep.r[0].g.so_dong === 3, JSON.stringify(chep.e || chep.r[0].g))

  console.log('\n── 5 · pl_ky BẤT BIẾN (máy kiểm) ──')
  const pl = await gK(U.ceo, `select kho.pl_ky('${KY}') g`)
  const D = pl.dong
  const near = (a, b, eps = 1) => Math.abs(Number(a) - Number(b)) < eps
  const colsum = (o) => Number(o.le) + Number(o.combo) + Number(o.du_an) + Number(o.khac)
  const LINES = ['doanh_thu_thuan','k1','k2','k3','ship_lap','hoa_hong','bien_phi','so_du_dam_phi','dinh_phi_truy','segment_margin']
  let a5 = true
  for (const ln of LINES) if (!near(colsum(D[ln]), D[ln].toan_cty)) { a5 = false; console.log('   lệch cột-hàng ở', ln, colsum(D[ln]), '≠', D[ln].toan_cty) }
  ok('#5a le+combo+du_an+khac = toan_cty (10 dòng)', a5)
  let b5 = true
  for (const col of ['toan_cty','le','combo','du_an','khac']) {
    if (!near(D.so_du_dam_phi[col], Number(D.doanh_thu_thuan[col]) - Number(D.bien_phi[col]))) b5 = false
    if (!near(D.segment_margin[col], Number(D.so_du_dam_phi[col]) - Number(D.dinh_phi_truy[col]))) b5 = false
  }
  if (!near(D.lai_thuan.toan_cty, Number(D.segment_margin.toan_cty) - Number(D.dinh_phi_chung.toan_cty))) b5 = false
  ok('#5b dòng3=1−2 · dòng5=3−4 · dòng7=5−6', b5)
  const sumGC = 120000000 + 90000000 + 60000000 + 30000000
  ok('#5c doanh_thu_thuan(toàn) × 1,1 = Σgia_chot (sai <1đ)', near(Number(D.doanh_thu_thuan.toan_cty) * 1.1, sumGC), `${D.doanh_thu_thuan.toan_cty}`)
  ok('#5d bien_phi gồm k1+k2+k3+ship+hoa (cột le)', near(D.bien_phi.le, Number(D.k1.le)+Number(D.k2.le)+Number(D.k3.le)+Number(D.ship_lap.le)+Number(D.hoa_hong.le)))
  ok('#5e định phí chung 40tr chỉ ở toan_cty; segment KHÔNG có', Number(D.dinh_phi_chung.toan_cty) === 40000000 && D.dinh_phi_chung.le === undefined)

  console.log('\n── 6 · kỳ KHÔNG tham số → pl_ky FAIL-ĐÓNG ──')
  const f6 = await asK(U.ceo, `select kho.pl_ky('2099-12')`)
  ok('#6 fail-đóng đúng thông báo "chưa có tham số"', f6.e !== null && /chưa có tham số/.test(f6.e), f6.e)

  console.log('\n── 7 · đơn thiếu giá vốn: vẫn doanh thu + đếm cảnh báo ──')
  ok('#7 T108-khac (không giá vốn) vẫn có doanh thu cột khac', Number(D.doanh_thu_thuan.khac) > 0 && Number(D.k1.khac) === 0)
  ok('#7 so_don_thieu_gia_von = 1, có T108-khac', pl.so_don_thieu_gia_von === 1 && pl.don_thieu.includes('T108-khac'), JSON.stringify(pl.don_thieu))

  console.log('\n── 8 · TỐC ĐỘ 100.000 đơn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,la_demo)
    select 'P108-'||g,'da_giao',(array['le','combo','du_an'])[1+g%3], 5000000+(g%50)*1000, 100000,50000, $1, false from generate_series(1,100000) g`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon)
    select 'P108-'||g, 1500000,500000,150000,2150000,'plugin' from generate_series(1,100000) g`)
  await c.query('analyze kho.don_hang'); await c.query('analyze kho.don_hang_gia_von'); await c.query('analyze kho.chi_phi_ky')
  // đo CHỈ 1 lời gọi RPC (asK bọc ~6 round-trip set role/savepoint ≈ 270ms RTT — KHÔNG phải compute của pl_ky)
  await c.query('savepoint s8'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  const t0 = Date.now(); const r8 = await c.query(`select kho.pl_ky('${KY}') g`); const ms = Date.now() - t0
  const big = r8.rows[0].g
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); await c.query('release savepoint s8')
  ok(`#8 pl_ky trên 100.000+ đơn = ${ms}ms (<500) · doanh thu toàn = ${Math.round(Number(big.dong.doanh_thu_thuan.toan_cty)).toLocaleString('vi-VN')}đ`, ms < 500)

  await c.query('rollback')
  const clean = (await q(`select count(*)::int n from kho.don_hang where ma_don like 'P108-%' or ma_don like 'T108-%'`))[0].n
  ok('#8b rollback sạch (0 đơn rác P108/T108)', clean === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_108: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
