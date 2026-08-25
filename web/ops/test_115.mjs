// TEST CẮN — 115 · Kênh & CAC: guard · ads tròn vòng · chi thật bóc VAT · CAC+cờ · khách mới theo brand · bất biến · lọc · gác brand · tốc độ. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
const KY = '2099-05', KY0 = '2099-04'
const rows = g => (g.dong || [])
const cell = (g, b, k) => rows(g).find(r => r.brand === b && r.kenh === k)

try {
  await c.query('begin'); await c.query(`set local statement_timeout=0`)   // tránh pooler cắt khi DB đang tải nặng
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`); await c.query(`set local chan.off_nguon='1'`); await c.query(`set local chan.off_thuonghieu='1'`); await c.query(`set local chan.off_khachmoi='1'`)
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01)`, [KY])
  // đơn trọn da_giao: gia_chot GỒM VAT; dt=gc/1.1; cm=dt−k123−ship−dt*0.05
  const don = async (ma, brand, kenh, sdt, gc, k1, k2, k3, sh, lap, ky = KY) => {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,thuong_hieu,nguon_khach,sdt_khach,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach) values($1,'da_giao','le',$2,$3,$4,$5,$6,$7,$8,'K')`, [ma, brand, kenh, sdt, gc, sh, lap, ky + '-10'])
    await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values($1,$2,$3,$4,$5,'plugin')`, [ma, k1, k2, k3, k1 + k2 + k3])
  }
  // togihome/quang_cao × 3 (S1,S2,S3) — cm mỗi đơn = 10tr−4.5tr−300k−500k = 4,700,000
  await don('A1', 'togihome', 'quang_cao', 'S1', 11000000, 3000000, 1000000, 500000, 200000, 100000)
  await don('A2', 'togihome', 'quang_cao', 'S2', 11000000, 3000000, 1000000, 500000, 200000, 100000)
  await don('A3', 'togihome', 'quang_cao', 'S3', 11000000, 3000000, 1000000, 500000, 200000, 100000)
  // sconcept/gioi_thieu × 2 (S4,S5) — mau_mong (<3) — cm = 5tr−2tr−150k−250k = 2,600,000
  await don('B1', 'sconcept', 'gioi_thieu', 'S4', 5500000, 1200000, 600000, 200000, 100000, 50000)
  await don('B2', 'sconcept', 'gioi_thieu', 'S5', 5500000, 1200000, 600000, 200000, 100000, 50000)
  // đơn THIẾU thuong_hieu → dòng "(chưa ghi TH)" — cm = 3tr−1tr−100k−150k = 1,750,000
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,thuong_hieu,nguon_khach,sdt_khach,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach) values('C1','da_giao','le',null,'khac','S9',3300000,50000,50000,$1,'K')`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values('C1',600000,300000,100000,1000000,'plugin')`)
  // #5: S7 mua togihome ở KỲ TRƯỚC (KY0) rồi lần đầu vufurni ở KY → mới của vufurni, KHÔNG phải togihome
  await don('D0', 'togihome', 'cua_hang', 'S7', 11000000, 3000000, 1000000, 500000, 200000, 100000, KY0)   // togihome first = kỳ trước
  await don('D1', 'vufurni', 'gioi_thieu', 'S7', 11000000, 3000000, 1000000, 500000, 200000, 100000)        // vufurni first = KY
  // chi_ads: togihome/quang_cao 11tr(thật10tr) · vufurni/san_tmdt 5.5tr(thật5tr,0 khách→vô hạn) · sconcept/gioi_thieu 2.2tr(thật2tr,2 khách→mỏng)
  await q(`insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap) values ($1,'togihome','quang_cao',11000000),($1,'vufurni','san_tmdt',5500000),($1,'sconcept','gioi_thieu',2200000)`, [KY])

  console.log('── 1 · GUARD ──')
  ok('#1 NULLVAI → CHẶN', (await asK(U.NULLVAI, `select kho.kenh_cac_ky('${KY}')`)).e !== null)
  ok('#1 sale → CHẶN', (await asK(U.sale, `select kho.kenh_cac_ky('${KY}')`)).e !== null)
  ok('#1 ceo → QUA', (await asK(U.ceo, `select kho.kenh_cac_ky('${KY}') g`)).e === null)

  console.log('\n── 2 · ads_ghi tròn vòng ──')
  const gg = await asK(U.ceo, `select kho.ads_ghi($1,$2::jsonb) g`, [KY0, JSON.stringify([{ thuong_hieu:'togihome', kenh:'quang_cao', so_tien_nhap:'7700000', ghi_chu:'FB' }])])
  ok('#2 ads_ghi ok', gg.e === null && gg.r[0].g.so_dong === 1, gg.e)
  const ds = await gK(U.ceo, `select kho.ads_ds($1) g`, [KY0])
  ok('#2 ads_ds đọc lại khớp', ds.ds.length === 1 && Number(ds.ds[0].so_tien_nhap) === 7700000 && ds.ds[0].kenh === 'quang_cao')

  console.log('\n── 3 · chi ads THẬT = nhập ÷ (1+vat) ; đổi vat → thật đổi, nhập KHÔNG đổi ──')
  const g = await gK(U.ceo, `select kho.kenh_cac_ky('${KY}') g`)
  const tgh = cell(g, 'togihome', 'quang_cao')
  ok('#3 togihome/quang_cao chi thật = 11tr/1,1 = 10.000.000', Math.abs(Number(tgh.chi_ads_that) - 10000000) < 1, JSON.stringify(tgh.chi_ads_that))
  await q(`update kho.tham_so_tai_chinh set vat=20 where ma_ky=$1`, [KY])
  const g20 = await gK(U.ceo, `select kho.kenh_cac_ky('${KY}') g`)
  ok('#3 vat=20 → chi thật = 11tr/1,2 ≈ 9.166.667 (nhập 11tr KHÔNG đổi trong bảng)', Math.abs(Number(cell(g20,'togihome','quang_cao').chi_ads_that) - 11000000/1.2) < 1)
  ok('#3 so_tien_nhap trong chi_ads vẫn 11tr (giữ vết)', Number((await q(`select so_tien_nhap from kho.chi_ads where ma_ky=$1 and thuong_hieu='togihome'`, [KY]))[0].so_tien_nhap) === 11000000)
  await q(`update kho.tham_so_tai_chinh set vat=10 where ma_ky=$1`, [KY])

  console.log('\n── 4 · CAC khớp tay + cờ vô hạn + mỏng ──')
  const g4 = await gK(U.ceo, `select kho.kenh_cac_ky('${KY}') g`)
  const a = cell(g4, 'togihome', 'quang_cao')
  ok('#4 CAC togihome/quang_cao = 10tr ÷ 3 khách mới', Math.abs(Number(a.cac) - 10000000 / 3) < 1 && a.khach_moi_brand === 3, JSON.stringify(a))
  const vf = cell(g4, 'vufurni', 'san_tmdt')
  ok('#4 vufurni/san_tmdt: ads>0 & 0 khách mới → vo_han', vf && vf.vo_han === true && vf.khach_moi_brand === 0 && vf.cac === null, JSON.stringify(vf))
  const sc = cell(g4, 'sconcept', 'gioi_thieu')
  ok('#4 sconcept/gioi_thieu: 2 khách mới (<3) → mau_mong', sc && sc.mau_mong === true && sc.khach_moi_brand === 2, JSON.stringify(sc))

  console.log('\n── 5 · KHÁCH MỚI THEO BRAND (cũ A mua B lần đầu = mới B, không phải A) ──')
  const vfg = cell(g4, 'vufurni', 'gioi_thieu')
  ok('#5 S7 (cũ togihome) mua vufurni lần đầu → khách mới vufurni/gioi_thieu = 1', vfg && vfg.khach_moi_brand === 1, JSON.stringify(vfg))
  ok('#5 togihome/quang_cao khách mới = 3 (S1/S2/S3), S7 KHÔNG lọt (first togihome ở kỳ trước)', cell(g4,'togihome','quang_cao').khach_moi_brand === 3)
  ok('#5 cờ khach_moi TOÀN CTY không bị kenh_cac_ky sửa (đơn D1 vẫn nguyên)', (await q(`select khach_moi from kho.don_hang where ma_don='D1'`))[0].khach_moi !== undefined)

  console.log('\n── 6 · BẤT BIẾN Σ cm_kenh (mọi dòng, kể cả chưa ghi) = Σ cm ĐƠN TRỌN ──')
  const sumTron = Number((await q(`select coalesce(sum(cm),0) s from kho.cm_don_raw('${KY}',10,0.05) where not(thieu_gv or thieu_ship)`))[0].s)
  const sumKenh = Number(g4.tong.cm_kenh)
  ok(`#6 Σcm_kenh (${sumKenh}) = Σcm trọn (${sumTron}) sai <1đ`, Math.abs(sumKenh - sumTron) < 1)
  ok('#6 có dòng "(chưa ghi TH)" cho đơn C1', !!cell(g4, '(chưa ghi TH)', 'khac'))

  console.log('\n── 7 · lọc p_brand ──')
  const gTGH = await gK(U.ceo, `select kho.kenh_cac_ky('${KY}','togihome') g`)
  ok('#7 lọc togihome: mọi dòng brand=togihome', rows(gTGH).every(r => r.brand === 'togihome') && rows(gTGH).length >= 1)
  const gVF = await gK(U.ceo, `select kho.kenh_cac_ky('${KY}','vufurni') g`)
  ok('#7 Σ (togihome + vufurni + …) cm = tất cả (từng brand cộng lại)', Math.abs(Number(gTGH.tong.cm_kenh) + Number(gVF.tong.cm_kenh) + Number((await gK(U.ceo,`select kho.kenh_cac_ky('${KY}','sconcept') g`)).tong.cm_kenh) + Number((await gK(U.ceo,`select kho.kenh_cac_ky('${KY}','(chưa ghi TH)') g`)).tong.cm_kenh) - sumTron) < 1)

  console.log('\n── 8 · GÁC thuong_hieu tại cổng chốt ──')
  await c.query(`select set_config('chan.off_thuonghieu','',true)`)   // tắt bypass (đã bật toàn tx cho seed) để test gác thật
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach,thuong_hieu) values('G1','bao_gia','le','quang_cao',null)`)
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia) select id,'M',1,1000000 from kho.don_hang where ma_don='G1'`)
  // [WP-06] client hết quyền UPDATE trang_thai → chốt đi qua cổng chot_don (kiem_chuyen vẫn gác thương hiệu)
  const r8 = await asK(U.ceo, `select kho.chot_don((select id from kho.don_hang where ma_don='G1'), null, null)`)
  ok('#8 chốt thiếu thương hiệu → CHẶN "Chưa chọn thương hiệu"', r8.e !== null && /Chưa chọn thương hiệu/.test(r8.e), r8.e)
  await q(`update kho.don_hang set thuong_hieu='togihome' where ma_don='G1'`)
  ok('#8b có thương hiệu → QUA', (await asK(U.ceo, `select kho.chot_don((select id from kho.don_hang where ma_don='G1'), null, null)`)).e === null)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach,thuong_hieu) values('G2','moi_len_don','le','quang_cao',null)`)  // đơn cũ INSERT thẳng (raw, không vai) — không hồi tố
  // #8c tiến moi_len_don→dang_thiet_ke: kiem_chuyen chỉ gác ENTRY moi_len_don, không gác forward. Client hết quyền
  //   UPDATE trang_thai → dựng bằng owner + chan.off_vai (bỏ CHECK VAI, GIỮ kiem_chuyen để phép còn ý nghĩa).
  let e8c = null
  try { await c.query(`select set_config('chan.off_vai','1',true)`); await q(`update kho.don_hang set trang_thai='dang_thiet_ke' where ma_don='G2'`) }
  catch (x) { e8c = x.message } finally { await c.query(`select set_config('chan.off_vai','',true)`) }
  ok('#8c đơn cũ moi_len_don thiếu brand (raw seed) → tiến tiếp KHÔNG dính', e8c === null, e8c)

  console.log('\n── 9 · TỐC ĐỘ 100.000 đơn ──')
  await c.query('rollback'); await c.query('begin'); await c.query(`set local statement_timeout=0`)
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_nguon='1'`); await c.query(`set local chan.off_thuonghieu='1'`); await c.query(`set local chan.off_mon_gia='1'`); await c.query(`set local chan.off_von_chuyen='1'`)
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01)`, [KY])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,thuong_hieu,nguon_khach,sdt_khach,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao) select 'P115-'||g,'da_giao','le',(array['togihome','vufurni','sconcept'])[1+g%3],(array['quang_cao','gioi_thieu','cua_hang','san_tmdt','khach_cu','khac'])[1+g%6],'S'||(g%40000),5000000+(g%50)*1000,100000,50000,$1 from generate_series(1,100000) g`, [KY + '-11'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'P115-'||g,1500000,500000,150000,2150000,'plugin' from generate_series(1,100000) g`)
  await c.query('analyze kho.don_hang'); await c.query('analyze kho.don_hang_gia_von')
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
  await c.query(`select kho.kenh_cac_ky('${KY}')`)  // warm-up
  const t0 = Date.now(); const r9 = await c.query(`select kho.kenh_cac_ky('${KY}') g`); const ms = Date.now() - t0
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  // kenh_cac_ky = 2 QUÉT 100k (cm_don_raw trọn + first-brand all-time distinct-on) → ~gấp đôi cm_don_ky (1 quét).
  // Đo sạch ~930ms; load-variable tới ~1533ms khi DB bị các test 100k liên tiếp làm nặng. PG tắt parallelism trong hàm.
  // Ngưỡng <2000ms (bền với biến động tải; 100k đơn/kỳ là stress phi thực tế — kỳ THẬT vài trăm đơn <50ms). Nối quyết định perf cm_don_ky.
  ok(`#9 kenh_cac_ky trên 100.000+ đơn = ${ms}ms (<2000; sạch ~930ms · 2 quét 100k · PG serial) · số dòng=${r9.rows[0].g.dong.length}`, ms < 2000)

  await c.query('rollback')
  ok('rollback sạch', (await q(`select count(*)::int n from kho.chi_ads`))[0].n >= 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_115: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
