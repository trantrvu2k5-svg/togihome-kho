// TEST CẮN — 117 · Nhận xét theo luật: guard · từng luật vượt/dưới · mẫu mỏng im lặng · L5 hai chiều · L8 phân rã cộng khớp ·
//   đổi ngưỡng kỳ cũ không đổi · thiếu ngưỡng → mặc định+cờ · tốc độ meta-màn (Σ 6 nguồn) đo DIRECT. Tx rollback.
// ⚠ BẪY ĐO PERF: đo DIRECT (set role 1 lần, không savepoint/call) — xem docs/ban_giao/00_LUAT_LAM_VIEC.md.
// META-MÀN (CEO chốt): nhan_xet_ky = Σ 6 RPC phân tích (~1.5s @100k stress; real kỳ <100ms). Ngưỡng #8 = meta-tier.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
const KY = '2099-07', KYHI = '2099-08', KYDEF = '2099-09'
const nx = (g, l) => (g.nhan_xet || []).find(x => x.luat === l)
const im = (g, l) => (g.im_lang || []).find(x => x.luat === l)

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  for (const gg of ['off_von','off_von_chuyen','off_mon_gia','off_nguon','off_thuonghieu','off_nhay','off_khachmoi']) await c.query(`set local chan.${gg}='1'`)
  await q(`update kho.don_hang set la_demo=true where trang_thai='da_giao'`)   // cô lập nợ/COD cũ
  // tham số 3 kỳ: KY có chi_phí_nang_luc lớn (L5 trống) · KYHI nhỏ (L5 kín) · KYDEF không set ngưỡng
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke,chi_phi_nang_luc)
           values($1,'ban_hang',10,0.03,0.01,0.01,500000000),($2,'ban_hang',10,0.03,0.01,0.01,5000000),($3,'ban_hang',10,0.03,0.01,0.01,null)`, [KY, KYHI, KYDEF])

  // ── đơn KỲ (ngay_giao trong 2099-07) cho pl/cm/kenh ──
  const donKy = async (ma, dong, gc, k1, k2, k3, brand, kenh, gv = true, ky = KY) => {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,thuong_hieu,nguon_khach,la_demo)
             values($1,'da_giao',$2,$3,200000,100000,$4,'K',$5,$6,false)`, [ma, dong, gc, ky + '-15', brand, kenh])
    if (gv) await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values($1,$2,$3,$4,$5,'plugin')`, [ma, k1, k2, k3, k1 + k2 + k3])
  }
  // 6 đơn LẺ: k3=1tr, gia_chot 10tr (dt≈9.09tr) → k3/dt≈11% >8% · ≥5 đơn trọn → L2 ON. CM dương → lãi.
  for (let i = 1; i <= 6; i++) await donKy('LE' + i, 'le', 10000000, 2000000, 800000, 1000000, 'togihome', 'gioi_thieu')
  // 1 đơn LẺ thiếu giá vốn → L1 (so_thieu≥1)
  await donKy('LT1', 'le', 10000000, 0, 0, 0, 'togihome', 'gioi_thieu', false)
  // chi_ads brand KHÔNG có đơn giao (vo_han) → L4 ON
  await q(`insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap) values($1,'sconcept','san_tmdt',5000000)`, [KY])
  // giao dịch vốn mua tài sản 200tr trong KY → ròng ngoài KD −200tr → L8 ròng âm
  await q(`insert into kho.giao_dich_von(ngay,loai,so_tien) values('${KY}-10','mua_tai_san',200000000)`)

  // ── đơn NỢ (2026, tuổi 70) cho L6/con_phai_thu ── (không phiếu → con_lai = gia_chot)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo) values('NO1','da_giao','le',50000000, current_date - interval '70 days','Nợ già',false)`)
  // ── 2 COD dang_giao tuổi 16 → L7 ON (≥2) ──
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo) values('CD1','da_giao','le',8000000,current_date,'C1',false),('CD2','da_giao','le',8000000,current_date,'C2',false)`)
  await q(`insert into kho.giao_cod(ma_don,ngay_xuat,so_tien_thu_ho,trang_thai) values('CD1',current_date - interval '16 days',8000000,'dang_giao'),('CD2',current_date - interval '16 days',8000000,'dang_giao')`)

  console.log('── 1 · GUARD ──')
  ok('#1 NULLVAI → CHẶN', (await asK(U.NULLVAI, `select kho.nhan_xet_ky('${KY}')`)).e !== null)
  ok('#1 sale → CHẶN', (await asK(U.sale, `select kho.nhan_xet_ky('${KY}')`)).e !== null)
  ok('#1 ke_toan → QUA', (await asK(U.ke_toan, `select kho.nhan_xet_ky('${KY}') g`)).e === null)

  const g = await gK(U.ceo, `select kho.nhan_xet_ky('${KY}') g`)

  console.log('\n── 2 · TỪNG LUẬT bật đúng + có câu hỏi + căn cứ ──')
  ok('#2 L1 CẢNH BÁO (đơn thiếu giá vốn)', nx(g,'L1') && nx(g,'L1').muc === 'canh_bao' && /thiếu giá vốn/.test(nx(g,'L1').cau))
  ok('#2 L2 ĐÁNG SOI (k3 ăn dòng lẻ >8%)', nx(g,'L2') && nx(g,'L2').muc === 'dang_soi' && nx(g,'L2').so_lieu.pct > 8)
  ok('#2 L2 có CÂU HỎI không mệnh lệnh', nx(g,'L2') && /\?$/.test(nx(g,'L2').cau_hoi) && !/hãy |phải |cắt /i.test(nx(g,'L2').cau_hoi))
  ok('#2 L4 CẢNH BÁO vô hạn', nx(g,'L4') && nx(g,'L4').muc === 'canh_bao' && /vô hạn/.test(nx(g,'L4').cau))
  ok('#2 L5 ĐÁNG SOI trống', nx(g,'L5') && nx(g,'L5').muc === 'dang_soi' && nx(g,'L5').so_lieu.huong === 'trong')
  ok('#2 L6 ĐÁNG SOI nợ già', nx(g,'L6') && nx(g,'L6').muc === 'dang_soi' && /già nhất: NO1/.test(nx(g,'L6').bang_chung))
  ok('#2 L7 ĐÁNG SOI COD kẹt (2 đơn ≥ ngưỡng 2)', nx(g,'L7') && nx(g,'L7').muc === 'dang_soi' && nx(g,'L7').so_lieu.cod_ket === 2)
  ok('#2 L8 CẢNH BÁO lãi mà hụt tiền', nx(g,'L8') && nx(g,'L8').muc === 'canh_bao')
  ok('#2 mọi nhận xét có can_cu', (g.nhan_xet||[]).every(x => x.can_cu && x.can_cu.length > 5))

  console.log('\n── 3 · MẪU MỎNG → im lặng kèm lý do (KHÔNG phán) ──')
  // hạ mẫu L2 bằng cách nâng mau_toi_thieu_don lên 9 (chỉ 6 đơn lẻ) → im
  await asK(U.ke_toan, `select kho.nguong_ghi('${KY}', '{"mau_toi_thieu_don":"9"}'::jsonb)`)
  const g3 = await gK(U.ceo, `select kho.nhan_xet_ky('${KY}') g`)
  ok('#3 L2 mẫu mỏng → IM LẶNG', !nx(g3,'L2') && im(g3,'L2') && /chưa đủ mẫu/.test(im(g3,'L2').ly_do))
  ok('#3 im lặng KHÔNG phán (không có muc canh_bao/dang_soi)', im(g3,'L2') && im(g3,'L2').muc === undefined)
  await asK(U.ke_toan, `select kho.nguong_ghi('${KY}', '{"mau_toi_thieu_don":"5"}'::jsonb)`)   // trả lại

  console.log('\n── 4 · L5 hai chiều RA HAI CÂU KHÁC NHAU ──')
  // KYHI: chi_phi_nang_luc nhỏ (5tr) + k2 lớn → lấp đầy >95% kín
  for (let i = 1; i <= 3; i++) await donKy('HI' + i, 'combo', 20000000, 3000000, 5000000, 500000, 'togihome', 'cua_hang', true, KYHI)
  const gTrong = nx(g, 'L5'), gKin = nx(await gK(U.ceo, `select kho.nhan_xet_ky('${KYHI}') g`), 'L5')
  ok('#4 L5 trống (KY) và kín (KYHI) đều bật', gTrong && gKin && gTrong.so_lieu.huong === 'trong' && gKin.so_lieu.huong === 'kin')
  ok('#4 hai câu KHÁC NHAU', gTrong.cau !== gKin.cau && gTrong.cau_hoi !== gKin.cau_hoi)

  console.log('\n── 5 · L8 phân rã chênh CỘNG KHỚP ──')
  const s8 = nx(g, 'L8').so_lieu
  ok('#5 no+ovc+ngoai+khac = chênh', Math.abs((Number(s8.no_khach)+Number(s8.o_nha_vc)+Number(s8.ngoai_kd)+Number(s8.khac)) - Number(s8.chenh)) < 1, JSON.stringify(s8))
  ok('#5 chênh = lãi − ròng', Math.abs((Number(s8.lai)-Number(s8.rong)) - Number(s8.chenh)) < 1)

  console.log('\n── 6 · đổi ngưỡng kỳ KY → KYDEF không đổi ──')
  await asK(U.ke_toan, `select kho.nguong_ghi('${KY}', '{"nguong_k3_le":"20"}'::jsonb)`)
  const gDef = await gK(U.ceo, `select kho.nhan_xet_ky('${KYDEF}') g`)
  ok('#6 KYDEF nguong_k3_le vẫn mặc định 8 (không bị KY ghi đè)', Number(gDef.nguong.nguong_k3_le) === 8)
  const gKy = await gK(U.ceo, `select kho.nhan_xet_ky('${KY}') g`)
  ok('#6 KY nguong_k3_le = 20 (đã ghi)', Number(gKy.nguong.nguong_k3_le) === 20)
  ok('#6 KY k3=11% < 20% → L2 TẮT', !nx(gKy,'L2'))
  await asK(U.ke_toan, `select kho.nguong_ghi('${KY}', '{"nguong_k3_le":"8"}'::jsonb)`)   // trả lại

  console.log('\n── 7 · kỳ thiếu ngưỡng → mặc định + CỜ ──')
  ok('#7 KYDEF 9 ngưỡng đều trong cờ mặc định', Array.isArray(gDef.nguong_mac_dinh) && gDef.nguong_mac_dinh.length === 9)
  ok('#7 KY (đã ghi k3) → k3 KHÔNG trong cờ mặc định', !(gKy.nguong_mac_dinh || []).includes('nguong_k3_le'))

  console.log('\n── 8 · TỐC ĐỘ meta-màn @30k (chứng từ ~3 năm thật) (Σ 6 nguồn, đo DIRECT) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,thuong_hieu,nguon_khach,la_demo)
           select 'Z-'||g,'da_giao',(array['le','combo','du_an'])[1+g%3],5000000+(g%50)*1000,200000,100000,'${KY}-15','KH'||(g%5000),(array['togihome','vufurni'])[1+g%2],(array['quang_cao','gioi_thieu','cua_hang'])[1+g%3],false from generate_series(1,30000) g`)
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) select 'Z-'||g,1500000,800000,150000,2450000,'plugin' from generate_series(1,30000) g`)
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) select 'Z-'||g,'${KY}-15',2000000,'coc' from generate_series(1,30000) g`)
  await q(`insert into kho.giao_cod(ma_don,ngay_xuat,so_tien_thu_ho,trang_thai) select 'Z-'||g, current_date-((g%30)||' days')::interval,3000000,'dang_giao' from generate_series(1,6000) g`)
  await q(`analyze kho.don_hang`); await q(`analyze kho.don_hang_gia_von`); await q(`analyze kho.phieu_thu`); await q(`analyze kho.giao_cod`)
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ke_toan, role: 'authenticated' })])
  const best = async (sql) => { await c.query(sql); let m = 1e9; for (let i = 0; i < 4; i++) { const t = Date.now(); await c.query(sql); m = Math.min(m, Date.now() - t) } return m }
  const ms = await best(`select kho.nhan_xet_ky('${KY}')`)
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  console.log(`   ⏱  nhan_xet_ky=${ms}ms (min-of-4, warm, direct — meta-màn = Σ 6 nguồn)`)
  ok(`#8 nhan_xet_ky meta-màn < 3000ms (Σ 6 nguồn, @30k = ~3 năm chứng từ thật; real kỳ <100ms) =${ms}ms`, ms < 3000)

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_117: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F === 0 ? 0 : 1) }
