// TEST CẮN — 088 · cờ dung_xong trong buoc_thiet_ke. Tx rollback.
//   cd web && node ops/test_088.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', NULLVAI:'00000000-0000-0000-0000-000000000000',
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const buoc = async ma => (await q(`select buoc_thiet_ke b from kho.don_hang where ma_don=$1`, [ma]))[0].b
const ANH = JSON.stringify([{ duong_dan_nho: 'n.webp', duong_dan_to: 't.webp', byte_nho: 1, byte_to: 2 }])

try {
  await c.query('begin')
  const NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.thiet_ke]))[0].id
  async function don(ma, b) {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,buoc_thiet_ke,ma_ns_thiet_ke,la_demo)
             values($1,'bao_gia','le',$2,$3,$4,false)`, [ma, 'KH ' + ma, b, NS])
  }

  // ═══ 5 · MIỀN có dung_xong (migration đã áp, chạy 2 lần OK) ═══
  console.log('\n── 5 · miền CHECK có dung_xong ──')
  const def = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname='don_hang_buoc_thiet_ke_check'`))[0].d
  ok('#5 CHECK gồm dung_xong', /dung_xong/.test(def), def)

  // ═══ 6 · giá trị CŨ + NULL vẫn nhận, rác bị chặn ═══
  console.log('\n── 6 · dữ liệu cũ không vỡ ──')
  let cu = true
  for (const b of ['cho_nhan', 'dang_dung', 'cho_duyet', 'sua_gop_y', 'xong_file', null]) {
    const r = await asK(U.ceo, `insert into kho.don_hang(ma_don,trang_thai,buoc_thiet_ke) values($1,'bao_gia',$2)`, ['T88-OLD-' + (b || 'null'), b])
    // asK dùng vai ceo nhưng insert thẳng cần grant; nếu chặn grant vẫn không phải lỗi CHECK — bỏ qua e về grant
    if (r.e && /check constraint|buoc_thiet_ke_check/.test(r.e)) cu = false
  }
  const racR = await q(`savepoint r`).then(async () => {
    try { await c.query(`insert into kho.don_hang(ma_don,trang_thai,buoc_thiet_ke) values('T88-RAC','bao_gia','rac_xyz')`); await c.query('release savepoint r'); return null }
    catch (e) { await c.query('rollback to savepoint r'); return e.message }
  })
  ok('#6 giá trị cũ + NULL đều nhận · rác bị CHECK chặn', cu && racR && /check|buoc_thiet_ke_check/.test(racR), racR || '(rác lọt!)')

  // ═══ 4 · CỔNG VAI danh_dau_dung_xong ═══
  console.log('\n── 4 · cổng vai ──')
  await don('T88-V', 'dang_dung')
  const rNull = await asK(U.NULLVAI, `select kho.danh_dau_dung_xong('T88-V') g`)
  ok('#4 vai NULL → CHẶN', rNull.e && /chỉ thiet_ke\/tk_ban_hang/.test(rNull.e), rNull.e || '(lọt!)')
  for (const v of ['sale', 'xuong']) {
    const r = await asK(U[v], `select kho.danh_dau_dung_xong('T88-V') g`)
    ok(`#4 ${v} → CHẶN`, r.e !== null, r.e || '(lọt!)')
  }
  for (const v of ['thiet_ke', 'tk_ban_hang', 'ceo']) {
    await q(`update kho.don_hang set buoc_thiet_ke='dang_dung' where ma_don='T88-V'`)  // reset để test từng vai
    const r = await gK(U[v], `select kho.danh_dau_dung_xong('T88-V') g`)
    ok(`#4 ${v} → ĐƯỢC`, r.ok === true && r.buoc_thiet_ke === 'dung_xong', JSON.stringify(r))
  }
  // gọi khi KHÔNG ở dang_dung → chặn
  await q(`update kho.don_hang set buoc_thiet_ke='cho_duyet' where ma_don='T88-V'`)
  const rSai = await asK(U.thiet_ke, `select kho.danh_dau_dung_xong('T88-V') g`)
  ok('#4b gọi khi bước ≠ dang_dung → CHẶN', rSai.e && /chỉ đánh dấu DỰNG XONG khi đang dựng/.test(rSai.e), rSai.e || '(lọt!)')

  // ═══ 2 · dang_dung → cho_duyet THẲNG (gửi luôn) ═══
  console.log('\n── 2 · gửi thẳng dang_dung → cho_duyet ──')
  await don('T88-2', 'dang_dung')
  const g2 = await gK(U.thiet_ke, `select kho.gui_ban_thiet_ke('T88-2','',$1::jsonb) g`, [ANH])
  ok('#2 gui_ban_thiet_ke từ dang_dung → cho_duyet (không qua dung_xong)', g2.ok === true && (await buoc('T88-2')) === 'cho_duyet')

  // ═══ 3 · dang_dung → dung_xong → cho_duyet ═══
  console.log('\n── 3 · dang_dung → dung_xong → cho_duyet ──')
  await don('T88-3', 'dang_dung')
  await gK(U.thiet_ke, `select kho.danh_dau_dung_xong('T88-3') g`)
  const b3a = await buoc('T88-3')
  const g3 = await gK(U.thiet_ke, `select kho.gui_ban_thiet_ke('T88-3','',$1::jsonb) g`, [ANH])
  ok('#3 dang_dung → dung_xong → (gửi) cho_duyet', b3a === 'dung_xong' && g3.ok === true && (await buoc('T88-3')) === 'cho_duyet')

  // ═══ 1 · CHUÔNG sale KHÔNG đếm đơn ở dung_xong ═══
  console.log('\n── 1 · chuông sale không đếm dung_xong ──')
  const truoc = (await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)).tong
  await don('T88-1', 'dung_xong')   // dung_xong, KHÔNG có bản thiết kế
  const sau = await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)
  ok('#1 đơn dung_xong KHÔNG lọt chuông (badge không nhảy)', sau.tong === truoc && !sau.ds.some(x => x.ma_don === 'T88-1'),
    `truoc=${truoc} sau=${sau.tong}`)

  // ═══ 7 · đơn dung_xong HIỆN trong Bảng công việc, cot='dung_xong' ═══
  console.log('\n── 7 · kanban: đơn dung_xong hiện đúng cột ──')
  await don('T88-7', 'dung_xong')
  const bang = (await asK(U.ceo, `select ma_don, cot from kho.tk_bang_cong_viec()`)).r || []
  const row7 = bang.find(x => x.ma_don === 'T88-7')
  ok('#7 tk_bang_cong_viec: T88-7 hiện với cot="dung_xong"', row7 && row7.cot === 'dung_xong', JSON.stringify(row7 || '(không thấy)'))

  await c.query('rollback')
  console.log('   (đã ROLLBACK mọi đơn T88-*)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_088: ${P} pass / ${F} fail`)
} catch (e) {
  console.error('💥', e.message); F++
  try { await c.query('rollback') } catch (_) {}
} finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
