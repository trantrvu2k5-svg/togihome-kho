// TEST CẮN — 076 · TẤM TỰ BIẾT NHÁNH (L-18). Tx rollback. Chạy: cd web && node ops/test_076.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const AU = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6' }
const NS = ['600286f2-2482-4dff-b0a4-a3183740be56', 'fc206d9e-5051-4e9a-a84b-0729f86ef70c', '5006d61d-8237-4ad7-9df6-32df821bb21b',
  '6f30244c-b9e4-4985-925c-0dd7ac0f7b9a', '75097117-3dac-4e5d-94f6-29caa4e32c74', 'c50e8f8b-cd41-46c3-83d5-56969934fd9a']
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const quet = (tram, tem) => asK(AU.ceo, `select kho.quet_tem($1,$2) g`, [tem, tram]).then(x => x.r ? x.r[0].g : { ok: null, e: x.e })
const chan = async (tem, tram) => Number((await q1(`select count(*) n from kho.su_kien_quet where tem_ma=$1 and ma_tram=$2 and ket_qua='chan'`, [tem, tram])).n)

const TR = { cat: 'TRAM-CAT-01', thung: 'TRAM-THUNG-01', cup: 'TRAM-CUP-01', canh: 'TRAM-CANH-01', goi: 'TRAM-GOI-01' }

try {
  await c.query('begin')
  // ── quy trình QNH: nhánh thùng + cánh, có bước cánh phụ thuộc thùng, có bước gộp ──
  //   100 cat(chung) → 200 thung(thùng){100} · 210 cup(cánh){100}
  //   220 canh(cánh){200,210}  ← bước CÁNH mà buoc_truoc có bước THÙNG (test 1)
  //   300 goi(chung){200,210}  ← bước GỘP chờ hai nhánh (test 2)
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QNH','QT nhánh thử'),('QNH2','QT khác')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_moi_don_vi) values
    ('QNH',100,'{}','chung','cat','nguoi',0.1),
    ('QNH',200,'{100}','thùng','thung','nguoi',0.1), ('QNH',210,'{100}','cánh','cup','nguoi',0.1),
    ('QNH',220,'{200,210}','cánh','canh','nguoi',0.1),
    ('QNH',300,'{200,210}','chung','goi','nguoi',0.1),
    ('QNH2',100,'{}','chung','dan','nguoi',0.1)`)
  // ca: mỗi trạm một người trực
  let i = 0; for (const t of Object.values(TR)) await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram) values($1,$2)`, [NS[i++], t])
  // đơn + món QNH (mon_id để tách logic nhánh khỏi logic quy trình)
  const don = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T76','dang_thiet_ke') returning id`)).id
  const monQNH = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Tủ nhánh','QNH') returning id`, [don])).id

  // ═══ 1 · TẤM CÁNH KHÔNG BỊ CHẶN BỞI NHÁNH THÙNG (quan trọng nhất) ═══
  console.log('\n── 1 · tấm cánh quét bước cánh (buoc_truoc có bước thùng) khi nhánh thùng CHƯA ai quét ──')
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T76',1,'T76-CANH','canh_cua',$1)`, [monQNH])
  await quet(TR.cat, 'T76-CANH'); await quet(TR.cat, 'T76-CANH')   // 100 vào+ra
  await quet(TR.cup, 'T76-CANH'); await quet(TR.cup, 'T76-CANH')   // 210 cánh vào+ra (thùng 200 CHƯA đụng)
  const r1 = await quet(TR.canh, 'T76-CANH')                        // 220 canh: buoc_truoc {200 thùng, 210 cánh}
  console.log(`   nhánh tấm = ${JSON.stringify((await q1(`select kho.nhanh_cua_tem('T76-CANH') g`)).g)}`)
  console.log(`   quét bước 220 (canh) → ok=${r1.ok} loai=${r1.loai} nhanh=${r1.nhanh} ${r1.loi ? 'loi=' + r1.loi : ''}`)
  ok('#1 tấm cánh NHẬN dù nhánh thùng chưa xong (🟥 chặn = ĐỎ — test quan trọng nhất)', r1.ok === true)

  // ═══ 2 · BƯỚC GỘP VẪN CHỜ ĐỦ HAI NHÁNH ═══
  console.log('\n── 2 · tấm chung ở bước gộp: chỉ đi được khi CẢ hai nhánh xong ──')
  // tem 'chung' = vai_tro lạ → nhánh chung → gác f xét mọi nhánh
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T76',1,'T76-GOP','tam_assembly',$1)`, [monQNH])
  await quet(TR.cat, 'T76-GOP'); await quet(TR.cat, 'T76-GOP')     // 100
  await quet(TR.cup, 'T76-GOP'); await quet(TR.cup, 'T76-GOP')     // 210 cánh xong; thùng 200 CHƯA
  const r2a = await quet(TR.goi, 'T76-GOP')                         // gộp 300: thùng chưa → CHẶN
  await quet(TR.thung, 'T76-GOP'); await quet(TR.thung, 'T76-GOP') // 200 thùng xong
  const r2b = await quet(TR.goi, 'T76-GOP')                         // gộp 300: đủ hai nhánh → NHẬN
  console.log(`   nhánh tấm gộp = ${(await q1(`select kho.nhanh_cua_tem('T76-GOP')->>'nhanh' n`)).n}`)
  console.log(`   gộp khi THIẾU thùng → ok=${r2a.ok} loi=${r2a.loi} · sau khi đủ → ok=${r2b.ok}`)
  ok('#2 bước gộp CHẶN khi thiếu một nhánh (🟥 đi sớm = ĐỎ)', r2a.ok === false && r2a.loi === 'NHAY_BUOC')
  ok('#2 bước gộp NHẬN khi đủ cả hai nhánh', r2b.ok === true)

  // ═══ 3 · QUÉT ĐƯỢC KHI CHƯA GÁN MÓN (mon_id NULL, đơn 1 quy trình) ═══
  console.log('\n── 3 · tem mon_id NULL, đơn dùng đúng 1 quy trình → quét NHẬN ──')
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T76',1,'T76-NOMON','hong',null)`)
  const r3 = await quet(TR.cat, 'T76-NOMON')   // bước 100 cat
  console.log(`   tem mon_id NULL → ok=${r3.ok} loai=${r3.loai} ${r3.loi ? 'loi=' + r3.loi : ''}`)
  ok('#3 quét NHẬN khi CHƯA gán món (🟥 chặn vì thiếu mon_id = ĐỎ)', r3.ok === true)

  // ═══ 4 · ĐƠN NHIỀU QUY TRÌNH → CHẶN + GHI SỔ ═══
  console.log('\n── 4 · đơn 2 món 2 quy trình khác nhau, tem chưa gán món → CHẶN ──')
  const don2 = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T76B','dang_thiet_ke') returning id`)).id
  await c.query(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món A','QNH'),($1,'Món B','QNH2')`, [don2])
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T76B',1,'T76B-X','hong',null)`)
  const r4 = await quet(TR.cat, 'T76B-X')
  const chan4 = await chan('T76B-X', TR.cat)
  console.log(`   đơn nhiều quy trình → ok=${r4.ok} loi=${r4.loi} ly_do="${r4.ly_do}" · sổ chan=${chan4}`)
  ok('#4 đơn nhiều quy trình → CHẶN (NHIEU_QUY_TRINH) + GHI SỔ chan (🟥 im lặng/không ghi = ĐỎ)',
    r4.ok === false && r4.loi === 'NHIEU_QUY_TRINH' && chan4 === 1)

  // ═══ 5 · vai_tro LẠ KHÔNG LÀM VỠ ═══
  console.log('\n── 5 · vai_tro lạ → nhanh_cua_tem trả chung + cờ, quét vẫn chạy ──')
  const LA = 'vai_tro_khong_co_xyz'
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T76',1,'T76-LA',$1,$2)`, [LA, monQNH])
  const nl = (await q1(`select kho.nhanh_cua_tem('T76-LA') g`)).g
  const r5 = await quet(TR.cat, 'T76-LA')   // bước 100 chung
  console.log(`   nhanh_cua_tem(lạ) = ${JSON.stringify(nl)} · quét → ok=${r5.ok} ${r5.e ? 'RAISE=' + r5.e : ''}`)
  ok('#5 vai_tro lạ → nhánh "chung" + khong_tra_duoc=true', nl.nhanh === 'chung' && nl.khong_tra_duoc === true)
  ok('#5 vai_tro lạ vẫn quét NHẬN, KHÔNG raise (🟥 raise/chặn = ĐỎ)', r5.ok === true)

  console.log(`\n══ KẾT QUẢ 076: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
