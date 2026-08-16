// TEST CẮN — 097 · tk_chuong (chuông 2 chiều app Thiết kế) + luc_tk_xem. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
try {
  await c.query('begin')
  // TK người dựng = tk_ban_hang thử (auth uid cố định trong DB thử)
  const TKUID = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='tk_ban_hang' limit 1`))[0]?.auth_uid
  const TKNS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [TKUID]))[0].id
  // (a) đơn bao_gia chưa ai nhận · (b) bản mình dựng khách chê chưa xem · (c) đơn chốt có bản mình dựng
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T97A','bao_gia','le','KHa')`)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T97B','bao_gia','le','KHb')`)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T97C','moi_len_don','le','KHc')`)
  const idC = (await q(`select id from kho.don_hang where ma_don='T97C'`))[0].id
  const banB = (await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui,ma_ns_phan_hoi,luc_phan_hoi,ghi_chu_phan_hoi)
     values('T97B',1,$1,'chua_dung_yeu_cau',now()-interval '2 days',$1,now()-interval '1 day','cánh tủ tối màu') returning id`, [TKNS]))[0].id
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) values('T97C',1,$1,'khach_duyet',now()-interval '3 days')`, [TKNS])
  await q(`insert into kho.don_hang_nhat_ky(don_id,tu,den,nguoi_id,luc) values($1,'bao_gia','moi_len_don',$2,now()-interval '2 hours')`, [idC, TKNS])

  console.log('── 1 · 3 mục · badge == list ──')
  const g = await gK(TKUID, `select kho.tk_chuong(50) g`)
  ok('#1 mục a có T97B/T97A (việc chờ nhận)', g.a && g.a.tong >= 2 && g.a.ds.some(x => x.ma_don === 'T97A'), JSON.stringify(g.a && g.a.tong))
  ok('#1 badge==list cả 3 mục', g.a.tong === g.a.ds.length && g.b.tong === g.b.ds.length && g.c.tong === g.c.ds.length)
  const bB = (g.b.ds || []).find(x => x.ma_don === 'T97B')
  ok('#1 mục b: khách chê KÈM lý do', bB && /khách chê: cánh tủ tối màu/.test(bB.viec), JSON.stringify(bB))
  const cC = (g.c.ds || []).find(x => x.ma_don === 'T97C')
  ok('#1 mục c: đã chốt thành đơn', cC && cC.viec === 'đã chốt thành đơn', JSON.stringify(cC))
  ok('#1 tong = a+b+c', g.tong === g.a.tong + g.b.tong + g.c.tong)
  // ceo/nhóm thấy CẢ NHÓM (T97B do TK dựng, chưa xem) — kiểm TRƯỚC khi đánh dấu (luc_tk_xem là mốc DÙNG CHUNG)
  ok('#1 ceo thấy CẢ NHÓM (T97B dù không phải bản ceo dựng)', (await gK(U.ceo, `select kho.tk_chuong(50) g`)).b.ds.some(x => x.ma_don === 'T97B'))

  console.log('\n── 2 · đánh dấu ĐÃ XEM → mục b/c tụt ──')
  await asK(TKUID, `select kho.tk_danh_dau_xem('T97B')`)
  await asK(TKUID, `select kho.tk_danh_dau_xem('T97C')`)
  const g2 = await gK(TKUID, `select kho.tk_chuong(50) g`)
  ok('#2 T97B rời mục b sau khi xem', !(g2.b.ds || []).some(x => x.ma_don === 'T97B'))
  ok('#2 T97C rời mục c sau khi xem', !(g2.c.ds || []).some(x => x.ma_don === 'T97C'))
  ok('#2 luc_tk_xem đã set', (await q(`select luc_tk_xem from kho.ban_thiet_ke where id=$1`, [banB]))[0].luc_tk_xem != null)

  console.log('\n── 3 · cổng vai + KHÔNG giá vốn ──')
  ok('#3 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.tk_chuong(50)`)).e !== null)
  ok('#3 sale → CHẶN', (await asK(U.sale, `select kho.tk_chuong(50)`)).e !== null)
  ok('#3 xuong → CHẶN', (await asK(U.xuong, `select kho.tk_chuong(50)`)).e !== null)
  const keys = Object.keys(((g.b.ds || [])[0]) || {})
  ok('#3 KHÔNG trường giá vốn', !keys.some(k => /gia_von|gia_chot|doanh_thu|^tien$|von/.test(k)), JSON.stringify(keys))

  console.log('\n── 4 · vai NULL chặn tk_danh_dau_xem ──')
  ok('#4 tk_danh_dau_xem vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.tk_danh_dau_xem('T97B')`)).e !== null)

  await c.query('rollback')
  console.log('   (đã ROLLBACK T97*)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_097: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
