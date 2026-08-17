// TEST CẮN — 104 · xuong_nhin_lai + sp_so_ban + dieu_hanh_cong_no_khach. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', NULLVAI:'00000000-0000-0000-0000-000000000000' }
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
  const XN = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.xuong]))[0].id

  console.log('── 1 · GUARD ──')
  const blocked = async (uid, call) => (await asK(uid, call)).e !== null
  ok('#1 xuong_nhin_lai: tho/sale/NULL chặn', (await blocked(U.tho, `select kho.xuong_nhin_lai(30,50)`)) && (await blocked(U.sale, `select kho.xuong_nhin_lai(30,50)`)) && (await blocked(U.NULLVAI, `select kho.xuong_nhin_lai(30,50)`)))
  ok('#1 xuong_nhin_lai: xuong/ceo OK', (await asK(U.xuong, `select kho.xuong_nhin_lai(30,50)`)).e === null && (await asK(U.ceo, `select kho.xuong_nhin_lai(30,50)`)).e === null)
  ok('#1 sp_so_ban: ceo/ke_toan OK · xuong/sale/NULL chặn', (await asK(U.ceo, `select kho.sp_so_ban(90,50)`)).e === null && (await asK(U.ke_toan, `select kho.sp_so_ban(90,50)`)).e === null && (await asK(U.xuong, `select kho.sp_so_ban(90,50)`)).e && (await asK(U.NULLVAI, `select kho.sp_so_ban(90,50)`)).e)
  ok('#1 cong_no_khach: ke_toan OK · sale/NULL chặn', (await asK(U.ke_toan, `select kho.dieu_hanh_cong_no_khach(100)`)).e === null && (await asK(U.sale, `select kho.dieu_hanh_cong_no_khach(100)`)).e && (await asK(U.NULLVAI, `select kho.dieu_hanh_cong_no_khach(100)`)).e)

  console.log('\n── 2 · xuong_nhin_lai KHÔNG tiền + 3 khối ──')
  const g0 = await gK(U.xuong, `select kho.xuong_nhin_lai(30,50) g`)
  ok('#2 đủ gio_to/loi/tac_quet', ['gio_to','loi','tac_quet'].every(k => k in g0))
  ok('#2 KHÔNG rò tiền (doanh_thu/gia_von/phai_thu)', !/doanh_thu|gia_von|gia_chuyen|phai_thu|con_thu|\btien\b/.test(JSON.stringify(g0)))

  console.log('\n── 3 · KHỐI lỗi & làm lại: gom loại×tổ + xu hướng tuần (delta, vì prod có sẵn lỗi) ──')
  const loiCnc = g => (g.loi || []).find(x => x.loai_loi === 'xuoc' && x.to === kho_ten_cnc) || { so_luong: 0, tuan_nay: 0, tuan_truoc: 0 }
  const kho_ten_cnc = (await q(`select kho.tl_ten_to('cnc') t`))[0].t || 'cnc'
  const base = loiCnc(await gK(U.xuong, `select kho.xuong_nhin_lai(30,50) g`))
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo) values('T104D','dang_lam','le','K',false)`)
  await q(`insert into kho.loi_lam_lai(ngay,ma_to,ma_don,loai_loi,so_luong) values(current_date-1,'cnc','T104D','xuoc',3)`)   // tuần này
  await q(`insert into kho.loi_lam_lai(ngay,ma_to,ma_don,loai_loi,so_luong) values(current_date-10,'cnc','T104D','xuoc',1)`) // tuần trước
  const after = loiCnc(await gK(U.xuong, `select kho.xuong_nhin_lai(30,50) g`))
  ok('#3 xuoc/cnc: tổng +4, tuần này +3, tuần trước +1', after.so_luong - base.so_luong == 4 && after.tuan_nay - base.tuan_nay == 3 && after.tuan_truoc - base.tuan_truoc == 1, JSON.stringify({base, after}))

  console.log('\n── 4 · sp_so_ban: món TỰ DO lặp (chuẩn hoá thường + gộp dấu cách) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo) values('T104M','moi_len_don','le','K',false)`)
  const donId = (await q(`select id from kho.don_hang where ma_don='T104M'`))[0].id
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,sp_id) values($1,'Kệ  TV   gỗ óc chó',1,null)`, [donId])   // dấu cách thừa
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,sp_id) values($1,'kệ tv gỗ óc chó',1,null)`, [donId])         // chữ thường
  const g2 = await gK(U.ceo, `select kho.sp_so_ban(90,50) g`)
  const monRow = (g2.mon_lap || []).find(x => x.ten === 'kệ tv gỗ óc chó')
  ok('#4 hai biến thể chữ/dấu cách gộp thành 1 ứng viên, số lần 2', monRow && monRow.so_lan == 2, JSON.stringify(monRow))
  ok('#4 sp_so_ban có theo_dong + mon_lap', ['theo_dong','mon_lap'].every(k => k in g2))

  console.log('\n── 5 · cong_no_khach: GOM theo khách (tổng cộng dồn) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_giao,doanh_thu,so_tien_thuc_thu) values('T104N1','da_giao','le','KHÁCH NỢ',false,current_date-10,10000000,2000000)`)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_giao,doanh_thu,so_tien_thuc_thu) values('T104N2','da_giao','le','KHÁCH NỢ',false,current_date-3,5000000,0)`)
  const g3 = await gK(U.ke_toan, `select kho.dieu_hanh_cong_no_khach(100) g`)
  const kh = (g3 || []).find(x => x.khach === 'KHÁCH NỢ')
  ok('#5 gom 2 đơn 1 khách: tổng 8+5=13tr, 2 đơn, lâu nhất 10 ngày', kh && Number(kh.tong_phai_thu) === 13000000 && kh.so_don == 2 && kh.lau_nhat == 10, JSON.stringify(kh))

  console.log('\n── 6 · LIMIT ──')
  ok('#6 xuong_nhin_lai gio_to ≤ p_gioi_han', (await gK(U.xuong, `select kho.xuong_nhin_lai(30,1) g`)).gio_to.length <= 1)
  ok('#6 cong_no_khach ≤ p_gioi_han', (await gK(U.ke_toan, `select kho.dieu_hanh_cong_no_khach(1) g`)).length <= 1)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_104: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
