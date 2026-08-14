// TEST CẮN — 063 đơn full căn giả. In ĐỦ HAI VẾ. Tx rollback (trừ phần đọc baseline).
//   Chạy: cd web && node ops/test_063.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asCeo(s, a = []) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows } catch (x) { e = x.message }
  await c.query('rollback to savepoint sp'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gioMon = (ma) => asCeo(`select kho.gio_du_kien_cua_mon($1) g`, [ma]).then(x => x.r[0].g)
const gioDon = (ma) => asCeo(`select kho.gio_du_kien_cua_don($1) g`, [ma]).then(x => x.r[0].g)

try {
  await c.query('begin')

  // ═══ 1 · MỘT QUY TRÌNH PHỦ NHIỀU MÓN ═══
  console.log('\n── 1 · một quy trình phủ nhiều món (không nhân bản bước) ──')
  const truoc = Number((await q1(`select count(*) n from kho.quy_trinh_buoc where ma_quy_trinh='TU-AO-MELAMINE'`)).n)
  const soLoi = Number((await q1(`select count(*) n from kho.san_pham_loi where ma_quy_trinh='TU-AO-MELAMINE'`)).n)
  // gán THÊM 1 lõi nữa vào cùng quy trình (savepoint → hoàn lại, không rớt sang test sau)
  await c.query('savepoint s1')
  await c.query(`update kho.san_pham_loi set ma_quy_trinh='TU-AO-MELAMINE' where ma_loi='CAN-A-TU-GIAY'`)
  const sau = Number((await q1(`select count(*) n from kho.quy_trinh_buoc where ma_quy_trinh='TU-AO-MELAMINE'`)).n)
  await c.query('rollback to savepoint s1')
  console.log(`   ${soLoi} lõi đang dùng TU-AO-MELAMINE · quy_trinh_buoc TRƯỚC=${truoc} SAU(gán thêm lõi)=${sau} · 🟥 kiến trúc cũ (theo lõi) = ${truoc}×(số lõi) dòng`)
  ok('✅ gán thêm lõi → số bước KHÔNG tăng (8→8)', truoc === 8 && sau === 8, `${truoc}→${sau}`)

  // ═══ 2 · GIỜ KHÁC NHAU THEO MÓN (4 cánh 2m4 > 2 cánh 1m2) ═══
  console.log('\n── 2 · món to nhiều giờ hơn món nhỏ (cùng quy trình) ──')
  const gM = await gioMon('CAN-A-TUAO-MASTER-BT'), gN = await gioMon('CAN-A-TUAO-NHO-BT')
  console.log(`   Tủ áo MASTER 4C 2m4 = ${gM.tong_gio}h · Tủ áo NHỎ 2C 1m2 = ${gN.tong_gio}h`)
  ok('✅ Master 4C 2m4 NHIỀU GIỜ HƠN Nhỏ 2C 1m2 (🟥 bằng/ngược = số cứng)', gM.ok && gN.ok && Number(gM.tong_gio) > Number(gN.tong_gio))

  // ═══ 3 · FAIL-ĐÓNG CẤP ĐƠN (xoá số 1 món → báo món đó, KHÔNG cộng 5 món kia) ═══
  console.log('\n── 3 · fail-đóng cấp đơn ──')
  const donDu = await gioDon('CAN-A-DEMO')
  console.log(`   ĐỦ số: ok=${donDu.ok} tong_gio_don=${donDu.tong_gio_don}h`)
  await c.query('savepoint s3'); await c.query(`delete from kho.so_don_vi_mon where ma_bien_the='CAN-A-BEP-TREN-BT'`)
  const donThieu = await gioDon('CAN-A-DEMO')
  console.log(`   🟥 vế chưa vá: cộng 5 món còn lại rồi trả tổng như đủ`)
  console.log(`   ✅ vế đã vá: ok=${donThieu.ok} tong_gio_don=${donThieu.tong_gio_don} · thiếu: ${JSON.stringify((donThieu.thieu_mon || []).map(m => m.ten))}`)
  ok('✅ 1 món thiếu số → ok=false · tong_gio_don=NULL (không cộng phần còn lại)', donThieu.ok === false && donThieu.tong_gio_don === null)
  ok('✅ báo RÕ đúng món thiếu (BEP-TREN) + mã lỗi THIEU_SO_DON_VI', (donThieu.thieu_mon || []).some(m => m.sp_id === 'CAN-A-BEP-TREN-BT' && JSON.stringify(m.thieu).includes('THIEU_SO_DON_VI')), JSON.stringify(donThieu.thieu_mon))
  await c.query('rollback to savepoint s3')

  await c.query('rollback')

  // ═══ 4 · KHÔNG ĐỤNG DỮ LIỆU WEB (đọc prod, ngoài tx) ═══
  console.log('\n── 4 · không đụng 100 lõi web ──')
  const w = await q1(`select (select count(*) from kho.san_pham_loi where ma_loi like 'WEB-%') loi,(select count(*) from kho.san_pham_mau where ma like 'W%-%') bt,(select count(*) from kho.niem_yet where nguon_host is not null) ny`)
  ok('✅ web LÕI=100 · biến thể=272 · niêm yết=272 (y hệt)', Number(w.loi) === 100 && Number(w.bt) === 272 && Number(w.ny) === 272, JSON.stringify(w))
  const webCoQt = Number((await q1(`select count(*) n from kho.san_pham_loi where ma_loi like 'WEB-%' and ma_quy_trinh is not null`)).n)
  ok('✅ KHÔNG lõi web nào bị gán quy trình', webCoQt === 0, webCoQt + ' lõi web bị gán')

  console.log(`\n══ KẾT QUẢ 063: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 5).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
