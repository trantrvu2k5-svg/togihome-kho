// TEST CẮN — 103 · tk_nhom (khối Nhóm app Thiết kế) + whitelist +truong_nhom_thiet_ke. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tk:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', NULLVAI:'00000000-0000-0000-0000-000000000000' }
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
  const TNTK = (await q(`select u.id from auth.users u where u.email='test_tntk_kiem@togihome.local'`))[0].id
  // 2 "designer" bất kỳ (FK nguoi_dung) + 1 orphan
  const dsg = (await q(`select id from kho.nguoi_dung where vai_tro in ('thiet_ke','tk_ban_hang') limit 2`))
  const DA = dsg[0].id, DB = dsg[1] ? dsg[1].id : dsg[0].id

  console.log('── 1 · GUARD truong_nhom_thiet_ke/ceo ──')
  for (const [nm, u] of [['tntk', TNTK], ['ceo', U.ceo]]) ok(`#1 ${nm} GỌI ĐƯỢC`, (await asK(u, `select kho.tk_nhom(30,50)`)).e === null)
  for (const [nm, u] of [['tk_ban_hang', U.tk], ['sale', U.sale], ['NULL', U.NULLVAI]]) ok(`#1 ${nm} → CHẶN`, (await asK(u, `select kho.tk_nhom(30,50)`)).e !== null)

  console.log('\n── 2 · cấu trúc + KHÔNG giá vốn ──')
  const g0 = await gK(U.ceo, `select kho.tk_nhom(30,50) g`)
  ok('#2 đủ viec/gio/chat + nguong_tam=30', ['viec','gio','chat'].every(k => k in g0) && g0.nguong_tam === 30 && g0.so_ngay === 30)
  ok('#2 KHÔNG rò giá vốn / doanh thu', !/khoi_[123]|gia_von|gia_chuyen|doanh_thu|\btien\b/.test(JSON.stringify(g0)))

  console.log('\n── 3 · KHỐI 1 phân hoạch (2 người + orphan), TỔNG hàng == TỔNG việc ──')
  const baseTong = g0.viec.tong
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ma_ns_thiet_ke,luc_nhan_thiet_ke) values('T103A','dang_thiet_ke','le','K',false,$1,now()-interval '2 day')`, [DA])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ma_ns_thiet_ke,luc_nhan_thiet_ke) values('T103B','nhan_thiet_ke','le','K',false,$1,now()-interval '1 day')`, [DA])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ma_ns_thiet_ke,luc_nhan_thiet_ke) values('T103C','dang_thiet_ke','le','K',false,$1,now())`, [DB])
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,ngay_chot) values('T103ORPHAN','moi_len_don','le','K',false,current_date-4)`)  // chưa ai nhận
  const g1 = await gK(U.ceo, `select kho.tk_nhom(30,50) g`)
  ok('#3 viec.tong +4', g1.viec.tong - baseTong === 4, `${baseTong}→${g1.viec.tong}`)
  const sumHang = g1.viec.ds.reduce((s, x) => s + x.dang_cam, 0)
  ok('#3 TỔNG hàng == TỔNG việc (tầng RPC)', sumHang === g1.viec.tong, `sum=${sumHang} tong=${g1.viec.tong}`)
  const tongThat = (await q(`select count(*)::int c from kho.don_hang where coalesce(la_demo,false)=false and trang_thai in ('moi_len_don','nhan_thiet_ke','dang_thiet_ke','xong_file')`))[0].c
  ok('#3 TỔNG việc == đếm SQL trực tiếp (tầng 2)', g1.viec.tong === tongThat, `${g1.viec.tong} vs ${tongThat}`)
  const orphan = g1.viec.ds.find(x => x.la_orphan)
  ok('#3 có hàng "chưa ai nhận" (orphan) giữ đơn mồ côi', orphan && orphan.dang_cam >= 1, JSON.stringify(orphan))
  const rowA = g1.viec.ds.find(x => !x.la_orphan && x.dang_cam === 2)
  ok('#3 người A cầm 2 việc', !!rowA)

  console.log('\n── 4 · KHỐI 3 chất lượng bản (ban gửi + tỉ lệ duyệt) ──')
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) values('T103A',1,$1,'khach_duyet',now()-interval '1 day')`, [DA])
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) values('T103B',1,$1,'cho_duyet',now())`, [DA])
  const g2 = await gK(U.ceo, `select kho.tk_nhom(30,50) g`)
  const chatA = g2.chat.find(x => x.ban_gui >= 2)
  ok('#4 người A: 2 bản gửi, tỉ lệ duyệt 0.5', chatA && chatA.ban_gui >= 2 && Number(chatA.ti_le_duyet) >= 0.5, JSON.stringify(chatA))

  console.log('\n── 5 · KHỐI 2 giờ ước vs thực + LIMIT ──')
  await q(`update kho.don_hang set gio_thiet_ke=5 where ma_don in ('T103A','T103B')`)
  await q(`insert into kho.gio_thiet_ke_thuc(ma_don,ma_ns,loai_gio,gio_thuc,ghi_luc) values('T103A',$1,'ban_hang',8,now())`, [DA])
  const g3 = await gK(U.ceo, `select kho.tk_nhom(30,50) g`)
  const gioA = g3.gio.find(x => Number(x.uoc) >= 10)
  ok('#5 người A: ước=10 (2×5), thực=8', gioA && Number(gioA.uoc) === 10 && Number(gioA.thuc) === 8, JSON.stringify(gioA))
  const gl = await gK(U.ceo, `select kho.tk_nhom(30,1) g`)
  ok('#5 p_gioi_han=1 → mỗi khối ≤ 1 dòng', gl.viec.ds.length <= 1 && gl.gio.length <= 1 && gl.chat.length <= 1)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_103: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
