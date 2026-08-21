// TEST PHẢI CẮN — huy_phieu (WP-16 pha 2 / L-55). CHẠY TRONG 1 GIAO DỊCH RỒI ROLLBACK — không để lại dữ liệu.
//   6 ca: huỷ nhập · huỷ xuất · huỷ 2 lần · huỷ phiếu chưa ghi sổ · huỷ nhập lô đã xuất · xích so_du_sau (+ bẻ thử).
//   Ba nguồn A/B/C sắp theo (tao_luc DESC, id DESC) — KHÔNG theo id UUID (L-53 dương tính giả BL-03).
//   vat_tu test tạo tiền tố 'test_HP_' TRONG tx; ROLLBACK cuối cùng xoá sạch (không cần DELETE tay, không tài khoản test_).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
// gọi RPC dưới vai uid; keep=true → giữ hiệu ứng trong tx, keep=false → rollback savepoint
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const reconcile = async (vid) => {
  const A = Number((await one(`select so_luong s from kho.ton where vat_tu_id=$1`, [vid]))?.s ?? 0)
  // ⚠ TRONG 1 TX now() đóng băng → mọi tao_luc bằng nhau; dùng ctid (thứ tự chèn vật lý) làm tiebreak thật.
  //   (Prod: ghi/huỷ ở tx khác → tao_luc khác → so_ba_nguon.sql sắp tao_luc DESC,id DESC là đủ — đã chứng minh 199/199.)
  const B = Number((await one(`select so_du_sau s from kho.giao_dich where vat_tu_id=$1 order by tao_luc desc, ctid desc limit 1`, [vid]))?.s ?? A)
  const C = Number((await one(`select coalesce(sum(con_lai),$2) s from kho.lo_nhap where vat_tu_id=$1 and lo_da_huy=false`, [vid, A]))?.s ?? A)
  return { A, B, C, khop: A === B && A === C }
}
const chainOk = async (vid) => {
  const g = await q(`select so_luong, so_du_sau from kho.giao_dich where vat_tu_id=$1 order by tao_luc asc, id asc`, [vid])
  let prev = null, good = true
  for (const r of g) { if (prev !== null && Math.abs((Number(prev) + Number(r.so_luong)) - Number(r.so_du_sau)) >= 0.001) good = false; prev = r.so_du_sau }
  return { good, n: g.length }
}
const mkVT = async (ma) => (await one(`insert into kho.vat_tu(ma,ten,loai) values($1,$2,'pk') returning id`, [ma, ma]))?.id
const NCC = async () => (await one(`select id from kho.nha_cung_cap limit 1`)).id
const nhap = (vid, sl, dg) => `select kho.ghi_so_phieu('nhap',$1,null,'test',$2::jsonb,null) g`
const spOf = r => r.r?.[0]?.g?.so_phieu

try {
  await c.query('begin'); await c.query(`set local statement_timeout=0`)
  const ncc = await NCC()

  console.log('── CA1 · huỷ phiếu NHẬP (lô chưa xuất) ──')
  const A = await mkVT('test_HP_A')
  const n1 = await as(U.ceo, `select kho.ghi_so_phieu('nhap',$1,null,'test',$2::jsonb,null) g`, [ncc, JSON.stringify([{ vat_tu_id: A, so_luong: 10, don_gia: 1000 }])], true)
  const spN1 = spOf(n1)
  ok('CA1 nhập tạo ton=10, gia_von_bq=1000 (tiền đề)', Number((await one(`select so_luong from kho.ton where vat_tu_id=$1`, [A])).so_luong) === 10 && Number((await one(`select gia_von_bq from kho.ton where vat_tu_id=$1`, [A])).gia_von_bq) === 1000)
  const h1 = await as(U.ceo, `select kho.huy_phieu($1,'test huỷ nhập') g`, [spN1], true)
  ok('CA1 huỷ chạy KHÔNG lỗi', h1.e === null, h1.e)
  ok('CA1 ton giảm đúng → 0', Number((await one(`select so_luong from kho.ton where vat_tu_id=$1`, [A])).so_luong) === 0)
  const lo1 = await one(`select lo_da_huy, con_lai from kho.lo_nhap where vat_tu_id=$1`, [A])
  ok('CA1 lo_da_huy=true, con_lai=0', lo1.lo_da_huy === true && Number(lo1.con_lai) === 0)
  ok('CA1 có 1 dòng giao_dich dieu_chinh đảo dấu (-10)', Number((await one(`select count(*) n from kho.giao_dich where vat_tu_id=$1 and loai='dieu_chinh' and so_luong=-10`, [A])).n) === 1)
  ok("CA1 phieu.trang_thai='da_huy'", (await one(`select trang_thai from kho.phieu where so_phieu=$1`, [spN1])).trang_thai === 'da_huy')
  ok('CA1 gia_von_bq = NULL (không còn lô sống)', (await one(`select gia_von_bq from kho.ton where vat_tu_id=$1`, [A])).gia_von_bq === null)
  const r1 = await reconcile(A); ok(`CA1 ba nguồn khớp sau huỷ (A=${r1.A} B=${r1.B} C=${r1.C})`, r1.khop && r1.A === 0)

  console.log('\n── CA2 · huỷ phiếu XUẤT ──')
  const B = await mkVT('test_HP_B')
  await as(U.ceo, `select kho.ghi_so_phieu('nhap',$1,null,'test',$2::jsonb,null) g`, [ncc, JSON.stringify([{ vat_tu_id: B, so_luong: 10, don_gia: 1000 }])], true)
  const x2 = await as(U.ceo, `select kho.ghi_so_phieu('xuat',null,'test','g',$1::jsonb,'cnc') g`, [JSON.stringify([{ vat_tu_id: B, so_luong: 4 }])], true)
  const spX2 = spOf(x2)
  ok('CA2 xuất 4 → ton=6, lô con_lai=6 (tiền đề)', Number((await one(`select so_luong from kho.ton where vat_tu_id=$1`, [B])).so_luong) === 6 && Number((await one(`select con_lai from kho.lo_nhap where vat_tu_id=$1`, [B])).con_lai) === 6)
  const h2 = await as(U.ceo, `select kho.huy_phieu($1,'test huỷ xuất') g`, [spX2], true)
  ok('CA2 huỷ xuất KHÔNG lỗi', h2.e === null, h2.e)
  ok('CA2 ton cộng lại → 10', Number((await one(`select so_luong from kho.ton where vat_tu_id=$1`, [B])).so_luong) === 10)
  ok('CA2 con_lai trả đúng theo lo_nhap_id gốc → 10', Number((await one(`select con_lai from kho.lo_nhap where vat_tu_id=$1`, [B])).con_lai) === 10)
  const r2 = await reconcile(B); ok(`CA2 ba nguồn khớp (A=${r2.A} B=${r2.B} C=${r2.C})`, r2.khop && r2.A === 10)

  console.log('\n── CA3 · huỷ LẦN 2 cùng phiếu → lỗi ──')
  const before3 = await reconcile(A)
  const h3 = await as(U.ceo, `select kho.huy_phieu($1,'huỷ lại') g`, [spN1])
  ok('CA3 huỷ 2 lần → LỖI "không huỷ hai lần"', h3.e !== null && /không huỷ hai lần/i.test(h3.e), h3.e || 'không lỗi')
  const after3 = await reconcile(A)
  ok('CA3 ba nguồn KHÔNG đổi so với sau CA1', JSON.stringify(before3) === JSON.stringify(after3))

  console.log('\n── CA4 · huỷ phiếu CHƯA ghi sổ → lỗi ──')
  const kid = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  await c.query(`insert into kho.phieu(so_phieu,loai,kho_id,trang_thai) values('test_HP_NHAP','nhap',$1,'nhap')`, [kid])
  const h4 = await as(U.ceo, `select kho.huy_phieu('test_HP_NHAP','x') g`)
  ok('CA4 huỷ phiếu trang_thai=nhap → LỖI "ĐÃ GHI SỔ"', h4.e !== null && /ĐÃ GHI SỔ/i.test(h4.e), h4.e || 'không lỗi')

  console.log('\n── CA5 · huỷ NHẬP mà lô đã xuất một phần → lỗi ──')
  const D = await mkVT('test_HP_C')
  const n5 = await as(U.ceo, `select kho.ghi_so_phieu('nhap',$1,null,'test',$2::jsonb,null) g`, [ncc, JSON.stringify([{ vat_tu_id: D, so_luong: 10, don_gia: 1000 }])], true)
  const spN5 = spOf(n5)
  await as(U.ceo, `select kho.ghi_so_phieu('xuat',null,'test','g',$1::jsonb,'cnc') g`, [JSON.stringify([{ vat_tu_id: D, so_luong: 4 }])], true)
  ok('CA5 lô đã xuất một phần (con_lai=6<10) (tiền đề)', Number((await one(`select con_lai from kho.lo_nhap where vat_tu_id=$1`, [D])).con_lai) === 6)
  const h5 = await as(U.ceo, `select kho.huy_phieu($1,'huỷ nhập đã xuất') g`, [spN5])
  ok('CA5 → LỖI buộc dùng phiếu ĐIỀU CHỈNH', h5.e !== null && /ĐIỀU CHỈNH/i.test(h5.e), h5.e || 'không lỗi')

  console.log('\n── CA6 · xích so_du_sau liên tục (+ bẻ thử) ──')
  const ch = await chainOk(B)   // B: nhập+10 → xuất-4 → dieu_chinh+4  = xích liên tục
  ok(`CA6 xích so_du_sau VT_B liên tục (${ch.n} dòng) = XANH`, ch.good)
  await c.query('savepoint be')
  await c.query(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,tao_luc) values($1,$2,'dieu_chinh',1,999,'kiem_ke',now())`, [B, kid])
  const chBad = await chainOk(B)
  ok('CA6 BẺ: chèn 1 dòng sds sai (999) → kiểm bắt được (đỏ)', chBad.good === false)
  await c.query('rollback to savepoint be')

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_huy_phieu: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally {
  await c.query('rollback').catch(() => {})   // XOÁ SẠCH mọi vat_tu/phieu/giao_dich test — không để lại gì
  await c.end(); process.exit(F === 0 ? 0 : 1)
}
