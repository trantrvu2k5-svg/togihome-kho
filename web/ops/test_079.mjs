// TEST CẮN — 079 · XẾP LỊCH ngược/xuôi/nút thắt/ATP. Tx rollback. cd web && node ops/test_079.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const AU = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb', sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const g1 = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const QSTEPS = { QS2: ['cat', 'pu'], QDRY: ['cat', 'pu'], QSPAN: ['cat', 'dan', 'pu'] }
async function donQ(ma, tt, hanExpr, qt) {
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai,ngay_hen_khach) values($1,$2,${hanExpr}) returning id`, [ma, tt]))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m',$2) returning id`, [don, qt]))[0].id
  for (const hd of QSTEPS[qt]) await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',10,'go_tay')`, [mon, hd])
  return { don, mon }
}

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QS2','2b'),('QDRY','kho'),('QSPAN','span')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values
    ('QS2',100,'{}','chung','cat','nguoi',0,0.5), ('QS2',200,'{100}','chung','pu','nguoi',0,0.5),
    ('QDRY',100,'{}','chung','cat','nguoi',0,0.5), ('QDRY',150,'{100}','chung','lot','tu_chay',12,0), ('QDRY',200,'{150}','chung','pu','nguoi',0,0.5),
    ('QSPAN',100,'{}','chung','cat','nguoi',0,0.5), ('QSPAN',150,'{100}','chung','lot','tu_chay',12,0), ('QSPAN',200,'{150}','chung','dan','nguoi',0,0.5), ('QSPAN',250,'{200}','chung','lot','tu_chay',12,0), ('QSPAN',300,'{250}','chung','pu','nguoi',0,0.5)`)

  // ═══ 1 · XẾP NGƯỢC LÀ MẶC ĐỊNH ═══
  console.log('\n── 1 · đơn có hạn (đủ xa) → atp dùng xep_nguoc ──')
  await donQ('T79-1', 'cho_cat', 'current_date+56', 'QS2')
  const a1 = await g1(AU.ceo, `select kho.atp('T79-1') g`)
  console.log(`   xep_bang=${a1.xep_bang} · ngay_hua=${a1.ngay_hua_duoc}`)
  ok('#1 xếp NGƯỢC mặc định (🟥 xuôi khi vẫn lùi được = ĐỎ)', a1.xep_bang === 'nguoc' && a1.ngay_hua_duoc === '2026-10-10')

  // ═══ 2 · LÙI VƯỢT QUÁ KHỨ → PHAI_XEP_XUOI, KHÔNG tự chuyển ═══
  console.log('\n── 2 · hạn quá gần (quá khứ) → xep_nguoc báo PHAI_XEP_XUOI ──')
  await donQ('T79-2', 'cho_cat', 'current_date-14', 'QS2')
  const r2 = await g1(AU.ceo, `select kho.xep_nguoc('T79-2', current_date-14) g`)
  console.log(`   phai_xep_xuoi=${r2.phai_xep_xuoi} · so_ngay_thieu=${r2.so_ngay_thieu} · kieu=${r2.kieu}`)
  ok('#2 báo PHAI_XEP_XUOI + số ngày thiếu, KHÔNG tự chuyển (🟥 tự chuyển im lặng = ĐỎ)',
    r2.phai_xep_xuoi === true && Number(r2.so_ngay_thieu) > 0 && r2.kieu === 'nguoc')

  // ═══ 3 · XẾP XUÔI CẢNH BÁO XONG SỚM ═══
  console.log('\n── 3 · hạn rất xa, xếp xuôi → xong sớm hơn hạn >7 ngày → cảnh báo ──')
  await donQ('T79-3', 'cho_cat', 'current_date+70', 'QS2')
  const r3 = await g1(AU.ceo, `select kho.xep_xuoi('T79-3', current_date) g`)
  console.log(`   ngay_xong_som=${r3.ngay_xong_som} · xong_som_ngay=${r3.xong_som_ngay} · canh_bao="${(r3.canh_bao || '').slice(0, 40)}…"`)
  ok('#3 xếp xuôi xong sớm → có CẢNH BÁO (🟥 không cảnh báo = ĐỎ)', Number(r3.xong_som_ngay) > 7 && /nằm kho/.test(r3.canh_bao || ''))

  // ═══ 4 · CHỜ KHÔ chiếm THỜI GIAN, KHÔNG chiếm năng lực tổ ═══
  console.log('\n── 4 · quy trình có bước tu_chay 12 giờ → lịch dài thêm, tải son_pu KHÔNG tăng ──')
  await donQ('T79-4', 'cho_cat', 'current_date+56', 'QDRY')
  const r4 = await g1(AU.ceo, `select kho.xep_nguoc('T79-4', current_date+56) g`)
  const bkho = (r4.lich || []).find(x => x.loai_buoc === 'tu_chay')
  const bpu = (r4.lich || []).find(x => x.ma_to === 'son_pu')
  const bcat = (r4.lich || []).find(x => x.hoat_dong === 'cat')
  console.log(`   bước chờ khô: ma_to=${bkho?.ma_to} gio=${bkho?.gio} · bước pu: gio=${bpu?.gio} · cat tuần ${bcat?.tuan} < pu tuần ${bpu?.tuan}?`)
  ok('#4 chờ khô ma_to=NULL + không cộng vào giờ tổ (son_pu vẫn 5, không 17) (🟥 tải tăng = ĐỎ)',
    bkho && bkho.ma_to === null && Number(bkho.gio) === 12 && Number(bpu.gio) === 5)
  ok('#4 chờ khô làm lịch DÀI THÊM (cat tuần trước pu)', new Date(bcat.tuan) < new Date(bpu.tuan))

  // ═══ 5 · NÚT THẮT nêu đúng tên tổ ═══
  console.log('\n── 5 · đơn cần cnc+son_pu, son_pu đầy tuần giao → atp trả son_pu nút thắt ──')
  const dw = (await q(`select kho.tuan_cua(current_date+56)::text d`))[0].d
  await donQ('T79-5', 'cho_cat', 'current_date+56', 'QS2')
  await q(`insert into kho.don_hang(ma_don,trang_thai) values('T79-FILL','cho_cat')`)
  await q(`insert into kho.xep_lich(ma_don,buoc_thu_tu,tuan_bat_dau,ma_to,gio,kieu_xep) values('T79-FILL',1,$1,'son_pu',195,'nguoc')`, [dw])
  const a5 = await g1(AU.ceo, `select kho.atp('T79-5') g`)
  console.log(`   nút thắt: ${JSON.stringify(a5.nut_that)}`)
  ok('#5 nút thắt = son_pu + số giờ thiếu (🟥 tổ khác/không trả = ĐỎ)',
    a5.nut_that && a5.nut_that.ma_to === 'son_pu' && Number(a5.nut_that.gio_thieu) > 0)

  // ═══ 6 · KHÔNG XẾP ĐƯỢC thì báo, không trả bừa ═══
  console.log('\n── 6 · son_pu kín 13 tuần, đơn không hạn → KHONG_XEP_DUOC_TRONG_12_TUAN ──')
  await donQ('T79-6', 'cho_cat', 'NULL', 'QS2')
  await q(`insert into kho.don_hang(ma_don,trang_thai) values('T79-FILL6','cho_cat')`)
  for (let i = 0; i <= 12; i++) await q(`insert into kho.xep_lich(ma_don,buoc_thu_tu,tuan_bat_dau,ma_to,gio,kieu_xep) values('T79-FILL6',$1,kho.tuan_cua(current_date)+($2::int),'son_pu',200,'xuoi')`, [i, i * 7])
  const a6 = await g1(AU.ceo, `select kho.atp('T79-6') g`)
  console.log(`   loi=${a6.loi} · ma_to=${a6.ma_to} · gio_thieu=${a6.gio_thieu} · ngay_hua=${a6.ngay_hua_duoc}`)
  ok('#6 KHONG_XEP_DUOC_TRONG_12_TUAN + tổ chặn son_pu, KHÔNG trả ngày (🟥 trả ngày = ĐỎ)',
    a6.loi === 'KHONG_XEP_DUOC_TRONG_12_TUAN' && a6.ma_to === 'son_pu' && a6.ngay_hua_duoc == null)

  // dọn tải FILL (đã test xong 5/6) để không kẹt năng lực son_pu cho các test sau
  await q(`delete from kho.xep_lich where ma_don in ('T79-FILL','T79-FILL6')`)

  // ═══ 7 · ĐÓNG BĂNG chặn xếp ═══
  console.log('\n── 7 · xếp vào tuần đóng băng: xuong CHẶN · ceo+ngoại lệ+lý do ĐƯỢC ──')
  await donQ('T79-7', 'cho_cat', 'current_date+3', 'QS2')
  const l7x = await asK(AU.xuong, `select kho.luu_xep_lich('T79-7','nguoc') g`)
  const l7c_noly = await asK(AU.ceo, `select kho.luu_xep_lich('T79-7','nguoc',true,null) g`)
  const l7c = await asK(AU.ceo, `select kho.luu_xep_lich('T79-7','nguoc',true,'đơn gấp CEO duyệt') g`)
  console.log(`   xuong → ${l7x.e ? 'CHẶN: ' + l7x.e.split('\\n')[0].slice(0, 45) : 'LỌT ❌'}`)
  console.log(`   ceo ngoại lệ KHÔNG lý do → ${l7c_noly.e ? 'CHẶN (lý do bắt buộc)' : 'LỌT ❌'}`)
  console.log(`   ceo ngoại lệ + lý do → ${l7c.r ? 'ĐƯỢC (' + l7c.r[0].g.so_dong + ' dòng)' : 'CHẶN ❌ ' + l7c.e}`)
  ok('#7 đóng băng: xuong CHẶN · ceo-không-lý-do CHẶN · ceo+lý-do ĐƯỢC (🟥 lọt = ĐỎ)',
    !!l7x.e && /ĐÓNG BĂNG|đóng băng/.test(l7x.e) && !!l7c_noly.e && !!l7c.r && l7c.r[0].g.ok === true)

  // ═══ 8 · XẾP THEO BƯỚC, KHÔNG dồn cả đơn một tuần ═══
  console.log('\n── 8 · đơn nhiều bước (2 chờ khô) → xep_lich nhiều dòng, rơi nhiều tuần ──')
  await donQ('T79-8', 'cho_cat', 'current_date+56', 'QSPAN')
  const l8 = await g1(AU.ceo, `select kho.luu_xep_lich('T79-8','nguoc') g`)
  const rows8 = await q(`select buoc_thu_tu, tuan_bat_dau, ma_to from kho.xep_lich where ma_don='T79-8' order by buoc_thu_tu`)
  const distinctTuan = new Set(rows8.map(r => String(r.tuan_bat_dau))).size
  console.log(`   ${rows8.length} dòng (5 bước) · ${distinctTuan} tuần khác nhau: ${rows8.map(r => r.buoc_thu_tu + '@' + String(r.tuan_bat_dau).slice(5, 10)).join(' ')}`)
  ok('#8 xếp theo BƯỚC (5 dòng, ≥2 tuần khác nhau) (🟥 dồn cả đơn 1 tuần = ĐỎ)', rows8.length === 5 && distinctTuan >= 2)

  // ═══ 9 · SALE đọc được (atp), KHÔNG xếp được (luu) ═══
  console.log('\n── 9 · sale gọi atp ĐƯỢC · gọi luu_xep_lich CHẶN ──')
  await donQ('T79-9', 'cho_cat', 'current_date+56', 'QS2')
  const a9 = await asK(AU.sale, `select kho.atp('T79-9') g`)
  const l9 = await asK(AU.sale, `select kho.luu_xep_lich('T79-9','nguoc') g`)
  console.log(`   sale atp → ${a9.r ? 'ĐƯỢC (hứa ' + a9.r[0].g.ngay_hua_duoc + ')' : 'CHẶN ❌'} · sale luu → ${l9.e ? 'CHẶN' : 'LỌT ❌'}`)
  ok('#9 sale atp ĐƯỢC + sale luu_xep_lich CHẶN (🟥 sale xếp được = ĐỎ)',
    !!a9.r && a9.r[0].g.ok === true && !!l9.e && /ceo\/xuong/.test(l9.e))

  console.log(`\n══ KẾT QUẢ 079: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
