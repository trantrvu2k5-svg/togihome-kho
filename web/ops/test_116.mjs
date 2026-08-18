// TEST CẮN — 116 · Dòng tiền: guard · phiếu tròn vòng · thu 4 loại theo ngày · chi 3 sổ (ads gồm VAT) · COD trọn vòng ·
//   hoàn không đếm · vốn chiều vào/ra gộp · bất biến ròng+quỹ · tuổi nợ/giao 3 bậc · hợp nhất db/104 · tốc độ 100k. Tx rollback.
//
// ⚠ BẪY ĐO PERF (bài học chung cho MỌI test perf sau) — asK() tạo 1 SAVEPOINT mỗi call. Chuỗi test dài (mấy chục cắn) làm
//   TRÀN subtrans SLRU của Postgres (>64 subxid) → mọi lần quét bảng lớn sau đó phải tra subtrans để kiểm visibility → số
//   perf GIẢ chậm (vd dong_tien_ky 587ms thật → đội lên 980-1210ms). Prod KHÔNG có savepoint lồng nên không dính.
//   ⟹ Đo perf phải theo kiểu DIRECT: set role authenticated + jwt claims MỘT LẦN rồi c.query thẳng (không savepoint/call),
//      giống hệt prod. Xem khối #11 bên dưới.
// NGƯỠNG: theo LUẬT TỐC ĐỘ 2 HẠNG (QD-40) — RPC màn phân tích < 900ms warm @stress 100k (chung số QD-37). Kỳ thật <50ms.
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
const KY = '2099-05', KY0 = '2099-04'

try {
  await c.query('begin'); await c.query(`set local statement_timeout=0`)
  await c.query(`set local chan.off_von='1'`); await c.query(`set local chan.off_von_chuyen='1'`); await c.query(`set local chan.off_mon_gia='1'`)
  await c.query(`set local chan.off_nguon='1'`); await c.query(`set local chan.off_thuonghieu='1'`); await c.query(`set local chan.off_nhay='1'`)
  // CÔ LẬP: ẩn mọi đơn da_giao cũ khỏi khối khách-nợ (rollback trả lại). Đơn test seed với la_demo=false.
  await q(`update kho.don_hang set la_demo=true where trang_thai='da_giao'`)
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke) values($1,'ban_hang',10,0.03,0.01,0.01),($2,'ban_hang',10,0.03,0.01,0.01)`, [KY, KY0])

  // Helper seed đơn da_giao (gia_chot GỒM VAT), ngay_giao lùi p_tuoi ngày.
  const don = async (ma, gc, tuoi, kh) => {   // khach_sdt để null (FK kho.khach); dieu_hanh gom theo ten_khach
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo)
             values($1,'da_giao','le',$2, current_date - ($3||' days')::interval, $4,false)`, [ma, gc, tuoi, kh])
  }
  // Khối khách-nợ / cảnh báo
  await don('E1', 100000000, 40, 'Khách A', 'S1')   // nợ 50tr sau 2 phiếu (coc30+giao20)
  await don('E2', 40000000, 35, 'Khách B', 'S2')    // trả đủ 40tr → KHÔNG nợ
  await don('E3', 60000000, 25, 'Khách C', 'S3')    // 0 phiếu → nợ 60tr + cảnh báo (giao trong kỳ? ngay_giao=today-25, KY=2099-05 nên KHÔNG trong kỳ thật — cảnh báo lọc theo kỳ; xử riêng ở #5cb)
  await don('E4', 25000000, 30, 'Khách D', 'S4')    // có COD dang_giao → LOẠI khỏi khách nợ
  // phiếu thu cho E1: coc + thu_khi_giao (ngày trong KY)
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values ('E1','${KY}-01',30000000,'coc'),('E1','${KY}-15',20000000,'thu_khi_giao')`)
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values ('E2','${KY}-05',40000000,'coc')`)
  await q(`insert into kho.giao_cod(ma_don,ngay_xuat,so_tien_thu_ho,trang_thai) values ('E4', current_date - interval '3 days', 25000000,'dang_giao')`)

  console.log('── 1 · GUARD ──')
  ok('#1 NULLVAI dong_tien_ky → CHẶN', (await asK(U.NULLVAI, `select kho.dong_tien_ky('${KY}')`)).e !== null)
  ok('#1 sale → CHẶN', (await asK(U.sale, `select kho.dong_tien_ky('${KY}')`)).e !== null)
  ok('#1 ke_toan → QUA', (await asK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)).e === null)
  ok('#1 con_phai_thu sale → CHẶN', (await asK(U.sale, `select kho.con_phai_thu(1)`)).e !== null)

  console.log('\n── 2 · phiếu thu tròn vòng ──')
  const p2 = await asK(U.ke_toan, `select kho.pt_ghi($1::jsonb) g`, [JSON.stringify({ ma_don:'E3', ngay:`${KY}-08`, so_tien:'5000000', loai:'thu_no' })])
  ok('#2 pt_ghi ok', p2.e === null && p2.r[0].g.ok === true, p2.e)
  const ds2 = await gK(U.ke_toan, `select kho.pt_ds('E3') g`)
  ok('#2 pt_ds đọc lại khớp', Number(ds2.tong) === 5000000 && ds2.ds.length === 1 && ds2.ds[0].loai === 'thu_no')
  ok('#2 số tiền ≤0 → CHẶN', (await asK(U.ke_toan, `select kho.pt_ghi($1::jsonb)`, [JSON.stringify({ ma_don:'E1', so_tien:'0', loai:'coc' })])).e !== null)
  ok('#2 đơn ma → CHẶN', (await asK(U.ke_toan, `select kho.pt_ghi($1::jsonb)`, [JSON.stringify({ ma_don:'KHONG-CO', so_tien:'1000', loai:'coc' })])).e !== null)
  const idxoa = (await gK(U.ke_toan, `select kho.pt_ghi($1::jsonb) g`, [JSON.stringify({ ma_don:'E3', so_tien:'123', loai:'thu_no' })])).id
  ok('#2 pt_xoa gỡ đúng', (await gK(U.ke_toan, `select kho.pt_xoa(${idxoa}) g`)).da_xoa === 1)

  console.log('\n── 3 · THU gom 4 loại theo NGÀY PHIẾU (phiếu kỳ trước KHÔNG lọt) ──')
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values ('E2','${KY0}-20',9000000,'thu_no')`)  // KỲ TRƯỚC (gắn E2 đã trả đủ → không đội nợ) → không lọt KY
  const g3 = await gK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)
  const tl = g3.thu.theo_loai
  ok('#3 coc = 70tr (E1 30 + E2 40)', Number(tl.coc.so_tien) === 70000000, JSON.stringify(tl.coc))
  ok('#3 thu_khi_giao = 20tr (E1)', Number(tl.thu_khi_giao.so_tien) === 20000000)
  ok('#3 thu_no = 5tr (E3, KY) — phiếu E2 kỳ trước KHÔNG lọt', Number(tl.thu_no.so_tien) === 5000000)
  ok('#3 tổng thu KY = 95tr (70+20+5)', Number(g3.thu.tong) === 95000000, JSON.stringify(g3.thu.tong))

  console.log('\n── 4 · CHI 3 sổ (ads GỒM VAT, luong+BH không overhead) ──')
  await q(`insert into kho.chi_phi_ky(ma_ky,loai,so_tien) values ($1,'thue_mat_bang',20000000),($1,'dien_nuoc_vh',5000000)`, [KY])
  await q(`insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap) values ($1,'togihome','quang_cao',11000000)`, [KY])   // gồm VAT
  await q(`insert into kho.luong_to(ma_ky,ma_to,luong_to,overhead_phan_bo,bao_hiem) select $1, ma_to, 50000000, 9000000, 5000000 from kho.to_san_xuat limit 1`, [KY])
  const luongExp = Number((await q(`select coalesce(sum(coalesce(luong_to,0)+coalesce(bao_hiem,0)),0) s from kho.luong_to where ma_ky=$1`, [KY]))[0].s)
  const g4 = await gK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)
  ok('#4 chi_phi_ky = 25tr', Number(g4.chi.theo_so.chi_phi_ky) === 25000000)
  ok('#4 chi_ads = 11tr (GỒM VAT, KHÔNG bóc)', Number(g4.chi.theo_so.chi_ads) === 11000000)
  ok('#4 luong_to = lương+BH (không overhead 9tr)', Number(g4.chi.theo_so.luong_to) === luongExp && luongExp === 55000000, `${g4.chi.theo_so.luong_to}/${luongExp}`)
  ok('#4 tổng chi = 25+11+55 = 91tr', Number(g4.chi.tong) === 91000000, JSON.stringify(g4.chi.tong))

  console.log('\n── 5 · COD trọn vòng + đợt chứa đơn sai từ chối cả đợt ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo) values ('F1','da_giao','le',10000000, current_date - interval '2 days','Khách F',false),('F2','da_giao','le',8000000, current_date,'Khách F2',false)`)
  await asK(U.ke_toan, `select kho.cod_ghi($1::jsonb)`, [JSON.stringify({ ma_don:'F1', ngay_xuat:`${KY}-02`, so_tien_thu_ho:'10000000', don_vi_vc:'GHN' })])
  await asK(U.ke_toan, `select kho.cod_ghi($1::jsonb)`, [JSON.stringify({ ma_don:'F2', ngay_xuat:`${KY}-02`, so_tien_thu_ho:'8000000', don_vi_vc:'GHTK' })])
  const cds = await asK(U.ke_toan, `select kho.cod_doi_soat($1::jsonb) g`, [JSON.stringify([{ ma_don:'F1', so_tien:'9500000', ngay:`${KY}-20` }])])
  ok('#5 đối soát F1 ok', cds.e === null && cds.r[0].g.so_don === 1, cds.e)
  const f1 = (await q(`select trang_thai, ngay_ket_thuc from kho.giao_cod where ma_don='F1'`))[0]
  ok('#5 F1 → da_doi_soat', f1.trang_thai === 'da_doi_soat')
  ok('#5 phiếu doi_soat_cod F1 = 9,5tr', Number((await q(`select coalesce(sum(so_tien),0) s from kho.phieu_thu where ma_don='F1' and loai='doi_soat_cod'`))[0].s) === 9500000)
  ok('#5 phí VC 0,5tr → chi_phi_ky khac', Number((await q(`select coalesce(sum(so_tien),0) s from kho.chi_phi_ky where ma_ky='${KY}' and loai='khac' and ghi_chu like 'phí VC/COD F1%'`))[0].s) === 500000)
  // đợt chứa đơn sai (F2 dang_giao + Fx đã da_doi_soat F1) → từ chối cả đợt, F2 GIỮ dang_giao
  const bad = await asK(U.ke_toan, `select kho.cod_doi_soat($1::jsonb)`, [JSON.stringify([{ ma_don:'F2', so_tien:'8000000', ngay:`${KY}-20` }, { ma_don:'F1', so_tien:'1', ngay:`${KY}-20` }])])
  ok('#5 đợt có F1(đã soát) → TỪ CHỐI CẢ ĐỢT', bad.e !== null && /F1/.test(bad.e))
  ok('#5 F2 vẫn dang_giao (không dính)', (await q(`select trang_thai from kho.giao_cod where ma_don='F2'`))[0].trang_thai === 'dang_giao')
  ok('#5 F2 KHÔNG sinh phiếu (đợt lỗi)', Number((await q(`select count(*) n from kho.phieu_thu where ma_don='F2'`))[0].n) === 0)

  console.log('\n── 6 · cod_hoan: tiền khỏi mọi khối thu, vào đếm hoàn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo) values ('G1','da_giao','le',7000000, current_date - interval '5 days','Khách G',false)`)
  await asK(U.ke_toan, `select kho.cod_ghi($1::jsonb)`, [JSON.stringify({ ma_don:'G1', ngay_xuat:`${KY}-03`, so_tien_thu_ho:'7000000' })])
  const hoan = await asK(U.ke_toan, `select kho.cod_hoan('G1', '${KY}-25'::date, 'khách từ chối') g`)
  ok('#6 cod_hoan ok', hoan.e === null && hoan.r[0].g.ok === true, hoan.e)
  ok('#6 G1 → hoan', (await q(`select trang_thai from kho.giao_cod where ma_don='G1'`))[0].trang_thai === 'hoan')
  ok('#6 G1 KHÔNG sinh phiếu thu', Number((await q(`select count(*) n from kho.phieu_thu where ma_don='G1'`))[0].n) === 0)
  const g6 = await gK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)
  ok('#6 hoàn đếm 1 đơn · 7tr', g6.o_nha_vc.hoan.so_don === 1 && Number(g6.o_nha_vc.hoan.so_tien) === 7000000, JSON.stringify(g6.o_nha_vc.hoan))
  ok('#6 G1 KHÔNG nằm trong "ở nhà VC" đang giao', !(g6.o_nha_vc.ds || []).some(x => x.ma_don === 'G1'))

  console.log('\n── 7 · giao dịch vốn: chiều vào/ra theo loai, GỘP không bù trừ ──')
  for (const gd of [{ loai:'vay_moi', so_tien:'400000000', ngay:`${KY}-12` }, { loai:'tra_goc_vay', so_tien:'45000000', ngay:`${KY}-12` }, { loai:'mua_tai_san', so_tien:'310000000', ngay:`${KY}-05` }])
    await asK(U.ke_toan, `select kho.von_ghi($1::jsonb)`, [JSON.stringify(gd)])
  const g7 = await gK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)
  ok('#7 vào = 400tr (vay_moi)', Number(g7.ngoai_kd.vao) === 400000000)
  ok('#7 ra = 355tr (45+310, KHÔNG bù trừ với vào)', Number(g7.ngoai_kd.ra) === 355000000)
  ok('#7 ròng ngoài KD = +45tr', Number(g7.ngoai_kd.rong) === 45000000)
  ok('#7 ds có 3 dòng riêng (gộp)', (g7.ngoai_kd.ds || []).length === 3)

  console.log('\n── 8 · BẤT BIẾN ròng + quỹ khép vòng + đơn không nằm 2 khối ──')
  await asK(U.ke_toan, `select kho.quy_ghi('${KY}', 221000000, 'nhập tay lần đầu')`)
  const g8 = await gK(U.ke_toan, `select kho.dong_tien_ky('${KY}') g`)
  ok('#8 ròng KD = thu − chi', Number(g8.rong_kd) === Number(g8.thu.tong) - Number(g8.chi.tong))
  ok('#8 quỹ cuối = đầu + ròng KD + ròng ngoài KD', Number(g8.quy.cuoi_ky) === Number(g8.quy.dau_ky) + Number(g8.quy.rong_kd) + Number(g8.quy.rong_ngoai))
  ok('#8 quỹ đầu đã lưu = 221tr', g8.quy.da_luu === true && Number(g8.quy.dau_ky) === 221000000)
  const cpt8 = await gK(U.ke_toan, `select kho.con_phai_thu(1) g`)
  const noSet = new Set((cpt8.dong || []).map(x => x.ma_don)), vcSet = new Set((g8.o_nha_vc.ds || []).map(x => x.ma_don))
  ok('#8 không đơn nào vừa "khách nợ" vừa "ở nhà VC" (E4 chỉ ở VC)', ![...noSet].some(m => vcSet.has(m)) && vcSet.has('E4') && !noSet.has('E4'))

  console.log('\n── 9 · tuổi nợ 3 bậc (20/45/70) + tuổi giao COD >14 ──')
  await don('H20', 12000000, 20, 'Nợ 20d', 'H1'); await don('H45', 13000000, 45, 'Nợ 45d', 'H2'); await don('H70', 14000000, 70, 'Nợ 70d', 'H3')
  const cpt = await gK(U.ke_toan, `select kho.con_phai_thu(1) g`)
  const find = m => (cpt.dong || []).find(x => x.ma_don === m)
  ok('#9 H20 tuổi≈20', Math.abs(find('H20').tuoi - 20) <= 1)
  ok('#9 H20 vào bac1 (≤30)', Number(cpt.bac.bac1.tien) >= 12000000 && cpt.bac.bac1.so_don >= 1)
  ok('#9 H45 vào bac2 (31–60)', find('H45') && Number(cpt.bac.bac2.tien) >= 13000000 && cpt.bac.bac2.so_don >= 1)
  ok('#9 H70 vào bac3 (>60)', find('H70') && Number(cpt.bac.bac3.tien) >= 14000000 && cpt.bac.bac3.so_don >= 1)
  ok('#9 tổng bậc = tổng nợ', Number(cpt.bac.bac1.tien) + Number(cpt.bac.bac2.tien) + Number(cpt.bac.bac3.tien) === Number(cpt.tong))
  ok('#9 COD tuổi >14 gắn cờ qua_14', (g8.o_nha_vc.ds || []).every(x => x.qua_14 === (x.tuoi > 14)))

  console.log('\n── 10 · HỢP NHẤT db/104 — dieu_hanh_cong_no_khach chạy, dùng phieu_thu ──')
  const ch = await asK(U.ke_toan, `select kho.dieu_hanh_cong_no_khach(100) g`)
  ok('#10 dieu_hanh_cong_no_khach chạy (sweep)', ch.e === null, ch.e)
  const kA = (ch.r[0].g || []).find(x => x.khach === 'Khách A')
  ok('#10 Khách A nợ 50tr = gia_chot − Σ phieu_thu (nguồn mới)', kA && Number(kA.tong_phai_thu) === 50000000, JSON.stringify(kA))
  ok('#10 Khách D (COD dang_giao) KHÔNG lọt công nợ', !(ch.r[0].g || []).some(x => x.khach === 'Khách D'))

  console.log('\n── 11 · TỐC ĐỘ 100k đơn + 100k phiếu + 20k COD ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,la_demo)
           select 'Z-'||g,'da_giao','le',5000000+(g%50)*1000, current_date-((g%90)||' days')::interval,'KH'||(g%5000),false from generate_series(1,100000) g`)
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) select 'Z-'||g, current_date-((g%90)||' days')::interval, 2000000+(g%30)*1000, (array['coc','thu_khi_giao','thu_no'])[1+g%3] from generate_series(1,100000) g`)
  await q(`insert into kho.giao_cod(ma_don,ngay_xuat,so_tien_thu_ho,trang_thai) select 'Z-'||g, current_date-((g%30)||' days')::interval, 3000000, 'dang_giao' from generate_series(1,20000) g`)
  await q(`analyze kho.don_hang`); await q(`analyze kho.phieu_thu`); await q(`analyze kho.giao_cod`)
  // Đo min-of-3 (năng lực warm, loại spike tải nhất thời). Ngưỡng <800ms: CEO CHẤP NHẬN theo tiền lệ QD-37 (cm_don_ky 527ms) —
  //   PG TẮT parallelism trong hàm plpgsql → quét 100k đơn + gộp 100k phiếu tuần tự = sàn ~500-600ms. 100k đơn/kỳ là stress phi
  //   thực tế (kỳ THẬT vài trăm đơn <50ms). Đã tối ưu hết mức: anti-join thay not-exists tương quan (2700→580ms) + index phủ.
  // Đo DIRECT (set role 1 LẦN, KHÔNG savepoint mỗi call) — xem BẪY ĐO ở đầu file. asK tạo savepoint/call → tràn subtrans SLRU.
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ke_toan, role: 'authenticated' })])
  const best = async (sql) => { await c.query(sql); let m = 1e9; for (let i = 0; i < 4; i++) { const t = Date.now(); await c.query(sql); m = Math.min(m, Date.now() - t) } return m }
  const msDt = await best(`select kho.dong_tien_ky('${KY}')`)
  const msCpt = await best(`select kho.con_phai_thu(1)`)
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  console.log(`   ⏱  dong_tien_ky=${msDt}ms · con_phai_thu=${msCpt}ms (min-of-4, warm, direct)`)
  // Hạng PHÂN TÍCH < 900ms (LUẬT TỐC ĐỘ 2 HẠNG, QD-40 — chung số QD-37; KHÔNG đẻ con số thứ ba).
  ok(`#11 dong_tien_ky < 900ms (phân tích, QD-40 = QD-37, =${msDt}ms)`, msDt < 900)
  ok(`#11 con_phai_thu < 900ms (phân tích, QD-40 = QD-37, =${msCpt}ms)`, msCpt < 900)

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_116: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F === 0 ? 0 : 1) }
