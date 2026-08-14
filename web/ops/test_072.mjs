// TEST CẮN — 072 · tab Quy trình (RPC). In ĐỦ HAI VẾ. Tx rollback. Chạy: cd web && node ops/test_072.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const NS_TK = '38c5252b-6e59-4651-8edb-d1c38afed0b6', HD8 = ['cat', 'dan', 'cam', 'thung', 'cup', 'ray', 'canh', 'goi']
const FILE = `'[{"loai_file":"dxf","duong_dan":"x","ten_goc":"a","co_byte":1}]'::jsonb`
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const row1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function as(uid, s, a = []) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint sp') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint sp')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gioDon = async (ma) => (await asK(U.ceo, `select kho.gio_du_kien_cua_don($1,'chuan') g`, [ma])).r[0].g

try {
  await c.query('begin')
  // quy trình thử = chép TU-AO-MELAMINE
  await asK(U.ceo, `select kho.qt_chep('QTEST','QT thử','TU-AO-MELAMINE')`)

  // ═══ 1 · NHẬP PHÚT → LƯU GIỜ (quan trọng nhất) ═══
  console.log('\n── 1 · gõ phút 2,0 → DB lưu 0,0333 giờ, đọc lại 2,0 ──')
  await asK(U.ceo, `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',2.0)`)
  const gio = Number((await row1(`select gio_moi_don_vi from kho.quy_trinh_buoc where ma_quy_trinh='QTEST' and thu_tu=100`)).gio_moi_don_vi)
  const ct = (await asK(U.ceo, `select kho.qt_chi_tiet('QTEST') g`)).r[0].g
  const phut = ct.buoc.find(b => b.thu_tu === 100).phut
  console.log(`   gõ 2,0 phút → DB gio_moi_don_vi=${gio} · đọc lại phút=${phut}`)
  ok('✅ phút 2,0 → DB 0,0333 giờ (🟥 lưu thẳng 2,0 vào cột giờ = ĐỎ)', Math.abs(gio - 0.033333) < 0.0001)
  ok('✅ đọc lại hiện 2,0 phút (không hiện 0,0333)', Number(phut) === 2)

  // ═══ 2 · ĐỒ THỊ HỎNG KHÔNG LƯU ═══
  console.log('\n── 2 · tạo chu trình → không lưu, báo lỗi ──')
  await asK(U.ceo, `select kho.qt_luu_buoc('QTEST',200,'dan','{100}','chung',1.5)`)
  const cyc = await as(U.ceo, `select kho.qt_luu_buoc('QTEST',100,'cat','{200}','chung',2.0)`)   // 100 chờ 200, 200 chờ 100
  const bt100 = (await row1(`select buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh='QTEST' and thu_tu=100`)).buoc_truoc
  console.log(`   ${cyc.e ? '✅ ' + cyc.e.slice(0, 45) : '❌ lọt'} · bước 100 buoc_truoc=${JSON.stringify(bt100)}`)
  ok('✅ chu trình → QT_LOI, KHÔNG lưu (buoc_truoc bước 100 vẫn rỗng)', /QT_LOI/.test(cyc.e || '') && (bt100 || []).length === 0)

  // ═══ 3 · CHỌN NHIỀU BƯỚC TRƯỚC ═══
  console.log('\n── 3 · bước 400 chạy sau CẢ 300 và 310 → buoc_truoc={300,310} ──')
  const b3 = (await asK(U.ceo, `select kho.qt_luu_buoc('QTEST',400,'canh','{300,310}','chung',17.5)`)).r
  const bt400 = (await row1(`select buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh='QTEST' and thu_tu=400`)).buoc_truoc
  console.log(`   buoc_truoc bước 400 = ${JSON.stringify(bt400)}`)
  ok('✅ lưu + đọc lại đúng HAI bước {300,310} (🟥 chỉ lưu một = ĐỎ)', bt400.length === 2 && bt400.includes(300) && bt400.includes(310))

  // ═══ 4 · KHÔNG CHO CHỌN CHÍNH NÓ (server: self-loop → kiem chặn) ═══
  console.log('\n── 4 · bước không chạy sau chính nó ──')
  const self = await as(U.ceo, `select kho.qt_luu_buoc('QTEST',300,'thung','{300}','thùng',7.5)`)
  ok('✅ bước 300 chờ chính 300 → CHẶN (self-loop = chu trình)', /QT_LOI/.test(self.e || ''), self.e || '(lọt!)')

  // ═══ 5 · HAI CON SỐ CẢNH BÁO (đếm thật) ═══
  console.log('\n── 5 · cảnh báo tách chưa/đã bàn giao ──')
  // 3 món chưa bàn giao + 2 món đã bàn giao, đều dùng QTEST
  for (let i = 0; i < 3; i++) { const d = (await row1(`insert into kho.don_hang(ma_don,trang_thai) values($1,'dang_thiet_ke') returning id`, ['T72-C' + i])).id; await c.query(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QTEST')`, [d]) }
  for (let i = 0; i < 2; i++) { const d = (await row1(`insert into kho.don_hang(ma_don,trang_thai) values($1,'cho_cat') returning id`, ['T72-D' + i])).id; await c.query(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QTEST')`, [d]) }
  const ct5 = (await asK(U.ceo, `select kho.qt_chi_tiet('QTEST') g`)).r[0].g
  console.log(`   so_mon_dung=${ct5.so_mon_dung} · chưa bàn giao=${ct5.mon_chua_ban_giao} · đã bàn giao=${ct5.mon_da_ban_giao}`)
  ok('✅ cảnh báo: 3 món sẽ đổi + 2 món giữ nguyên (đếm thật, 🟥 số cứng = ĐỎ)', ct5.mon_chua_ban_giao === 3 && ct5.mon_da_ban_giao === 2)

  // ═══ 6 · SỬA PHÚT → chưa BG đổi · đã BG giữ (nối màn với v-kho-66) ═══
  console.log('\n── 6 · sửa phút: món chưa bàn giao đổi · đã bàn giao giữ ──')
  const mkDon = async (ma, bg) => { const d = (await row1(`insert into kho.don_hang(ma_don,trang_thai,ma_ns_thiet_ke) values($1,'dang_thiet_ke',$2) returning id`, [ma, NS_TK])).id
    const m = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QTEST') returning id`, [d])).id
    for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',10,'go_tay')`, [m, hd])
    if (bg) { await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values($1,1,$2,'khach_duyet')`, [ma, NS_TK]); await asK(U.thiet_ke, `select kho.ban_giao_xuong($1,${FILE},null)`, [ma]) }
    return d }
  await mkDon('T72-BG', true); await mkDon('T72-LIVE', false)
  const a0 = (await gioDon('T72-BG')).tong_gio_don, l0 = (await gioDon('T72-LIVE')).tong_gio_don
  await asK(U.ceo, `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',30.0)`)   // sửa phút cat qua RPC màn
  const a1 = (await gioDon('T72-BG')).tong_gio_don, l1 = (await gioDon('T72-LIVE')).tong_gio_don
  console.log(`   ĐÃ bàn giao: ${a0} → ${a1} · CHƯA bàn giao: ${l0} → ${l1}`)
  ok('✅ #6 đã bàn giao GIỮ NGUYÊN giờ khi sửa phút qua màn', Number(a0) === Number(a1))
  ok('✅ #6 chưa bàn giao ĐỔI giờ khi sửa phút qua màn', Number(l1) !== Number(l0))

  // ═══ 7 · CHÉP QUY TRÌNH ═══
  console.log('\n── 7 · chép TU-AO-MELAMINE → mã mới ──')
  const cp = (await asK(U.ceo, `select kho.qt_chep('QT-COPY','Bản chép','TU-AO-MELAMINE') g`)).r[0].g
  const kiem = (await asK(U.ceo, `select kho.kiem_quy_trinh('QT-COPY') g`)).r[0].g
  const goc = Number((await row1(`select count(*) n from kho.quy_trinh_buoc where ma_quy_trinh='TU-AO-MELAMINE'`)).n)
  const monMoi = Number((await row1(`select count(*) n from kho.don_hang_mon where ma_quy_trinh='QT-COPY'`)).n)
  const bt400c = (await row1(`select buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh='QT-COPY' and thu_tu=400`)).buoc_truoc
  console.log(`   gốc ${goc} bước → chép ${cp.so_buoc} bước · kiem=${JSON.stringify(kiem)} · món gán QT-COPY=${monMoi} · buoc_truoc 400=${JSON.stringify(bt400c)}`)
  ok('✅ chép đủ 8 bước, quan hệ buoc_truoc giữ nguyên', cp.so_buoc === goc && bt400c.length === 2)
  ok('✅ kiem_quy_trinh SẠCH + KHÔNG món nào bị gán quy trình mới', kiem.length === 0 && monMoi === 0)

  // ═══ 8 · MÃ TRÙNG KHI CHÉP ═══
  console.log('\n── 8 · chép mã trùng → chặn ──')
  const trung = await as(U.ceo, `select kho.qt_chep('TU-AO-MELAMINE','x','KE-HO-MELAMINE')`)
  ok('✅ mã trùng → CHẶN (MA_TRUNG) · 🟥 tạo được = ĐỎ', /MA_TRUNG/.test(trung.e || ''), trung.e || '(lọt!)')

  // ═══ 9 · CỔNG VAI ═══
  console.log('\n── 9 · cổng vai (ceo/thiet_ke vào · khác chặn, kể cả ke_toan) ──')
  const chan = e => /chỉ ceo\/thiet_ke/.test(e || '')
  ok('ceo qt_luu_buoc → ĐƯỢC', !chan((await as(U.ceo, `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',2.0)`)).e))
  ok('thiet_ke qt_luu_buoc → ĐƯỢC', !chan((await as(U.thiet_ke, `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',2.0)`)).e))
  for (const v of ['sale', 'xuong', 'tho', 'ke_toan']) ok(`${v} qt_luu_buoc → CHẶN`, chan((await as(U[v], `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',2.0)`)).e), '(lọt!)')
  ok('vai NULL qt_luu_buoc → CHẶN', chan((await as(null, `select kho.qt_luu_buoc('QTEST',100,'cat','{}','chung',2.0)`)).e))
  ok('ke_toan qt_chi_tiet (đọc) → CHẶN', chan((await as(U.ke_toan, `select kho.qt_chi_tiet('QTEST')`)).e))

  // ═══ 11 · BƯỚC TRƯỚC DẠNG CHỮ (dữ liệu đủ để dựng "sau 300 · …, 310 · …") ═══
  console.log('\n── 11 · hàng bước hiện chữ bước-trước (không listbox) ──')
  const ct11 = (await asK(U.ceo, `select kho.qt_chi_tiet('TU-AO-MELAMINE') g`)).r[0].g
  const b400 = ct11.buoc.find(b => b.thu_tu === 400)
  const ten300 = ct11.buoc.find(b => b.thu_tu === 300)?.ten_hoat_dong, ten310 = ct11.buoc.find(b => b.thu_tu === 310)?.ten_hoat_dong
  console.log(`   bước 400 buoc_truoc=${JSON.stringify(b400.buoc_truoc)} · tên 300="${ten300}" 310="${ten310}" → chữ: "sau 300 · ${ten300}, 310 · ${ten310}"`)
  ok('✅ đủ dữ liệu dựng chữ "sau 300 · …, 310 · …" (buoc_truoc + tên bước)', b400.buoc_truoc.length === 2 && !!ten300 && !!ten310)

  // ═══ 12 · CHỌN XONG LƯU ĐÚNG buoc_truoc (trước/sau) ═══
  console.log('\n── 12 · hộp chọn lưu đúng buoc_truoc ──')
  const tr12 = (await row1(`select buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh='QTEST' and thu_tu=400`)).buoc_truoc
  await asK(U.ceo, `select kho.qt_luu_buoc('QTEST',400,'canh','{300}','chung',17.5)`)   // đổi {300,310} → {300}
  const sau12 = (await row1(`select buoc_truoc from kho.quy_trinh_buoc where ma_quy_trinh='QTEST' and thu_tu=400`)).buoc_truoc
  console.log(`   TRƯỚC=${JSON.stringify(tr12)} → SAU=${JSON.stringify(sau12)}`)
  ok('✅ chọn xong lưu đúng buoc_truoc mới', sau12.length === 1 && sau12[0] === 300)

  // ═══ 14 · THÔNG BÁO LỖI NÊU TÊN BƯỚC ═══
  console.log('\n── 14 · lỗi chu trình nêu đúng tên bước ──')
  await asK(U.ceo, `select kho.qt_chep('QT14','t','TU-AO-MELAMINE')`)
  await asK(U.ceo, `select kho.qt_luu_buoc('QT14',300,'thung','{310}','thùng',7.5)`)
  const e14 = await as(U.ceo, `select kho.qt_luu_buoc('QT14',310,'cup','{300}','cánh',4.4)`)
  const msg14 = (e14.e || '').replace(/^.*QT_LOI:\s*/s, '')
  console.log(`   → "${msg14.replace(/\n/g, ' | ')}"`)
  ok('✅ nêu ĐÚNG "300 và 310 chờ vòng lại" (🟥 liệt kê 3 lỗi chung chung = ĐỎ)',
    /300/.test(msg14) && /310/.test(msg14) && /vòng lại/.test(msg14) && !/không đi tới được/.test(msg14))

  // ═══ 15 · CỘT "DÙNG Ở" CÓ SỐ ═══
  console.log('\n── 15 · dùng ở: cat 3 QT · hoạt động chưa vào QT ──')
  const hd15 = (await asK(U.ceo, `select kho.hoat_dong_ds() g`)).r[0].g
  const cat = hd15.find(h => h.hoat_dong === 'cat'), chuavao = hd15.find(h => h.dung_o === 0)
  const catThat = Number((await row1(`select count(distinct ma_quy_trinh) n from kho.quy_trinh_buoc where hoat_dong='cat'`)).n)
  console.log(`   cat dung_o=${cat.dung_o} (đếm thật=${catThat}) · ví dụ chưa vào QT: ${chuavao?.hoat_dong}`)
  ok('✅ cat dùng ở CÓ SỐ, khớp đếm thật (🟥 trống/0 = ĐỎ)', cat.dung_o >= 3 && cat.dung_o === catThat)
  ok('✅ có hoạt động dung_o=0 → client hiện "chưa vào quy trình nào" (không dấu gạch)', !!chuavao)

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 072: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
