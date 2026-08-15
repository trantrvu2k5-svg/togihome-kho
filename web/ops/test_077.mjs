// TEST CẮN — 077 · MÀN TRẠM (server). Tx rollback. Chạy: cd web && node ops/test_077.mjs
//   Test client (con trỏ #1, mất mạng #6) kiểm bằng trình duyệt — ở đây kiểm phần SERVER.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const AU = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const NS = ['600286f2-2482-4dff-b0a4-a3183740be56', 'fc206d9e-5051-4e9a-a84b-0729f86ef70c']
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const g1 = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const TR = { cat: 'TRAM-CAT-01', dan: 'TRAM-DAN-01' }

try {
  await c.query('begin')
  // ── quy trình QCHO: 100 cat(chung) → 200 dan(chung){100} ──
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QCHO','QT chờ thử')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_moi_don_vi) values
    ('QCHO',100,'{}','chung','cat','nguoi',0.1), ('QCHO',200,'{100}','chung','dan','nguoi',0.1)`)
  const don = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T77','da_cat') returning id`)).id
  const mon = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Tủ chờ','QCHO') returning id`, [don])).id
  // 3 tấm, mỗi tấm đã 'ra' ở CAT (bước trước), CHƯA vào DAN
  for (const t of ['T77-A', 'T77-B', 'T77-C']) {
    await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T77',1,$1,'hong',$2)`, [t, mon])
    await c.query(`insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,luc) values($1,'TRAM-CAT-01',$2,'vao','nhan',now()-interval '30 min')`, [t, NS[0]])
    await c.query(`insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,luc) values($1,'TRAM-CAT-01',$2,'ra','nhan',now()-interval '20 min')`, [t, NS[0]])
  }
  // ca ở DAN để quét được
  await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram) values($1,'TRAM-DAN-01')`, [NS[1]])

  // ═══ 3 · DANH SÁCH CHỜ đúng (in trước/sau) ═══
  console.log('\n── 3 · đang chờ ở DAN: 3 tấm đã ra CAT, chưa vào DAN ──')
  const cho1 = await g1(AU.ceo, `select kho.tram_dang_cho('TRAM-DAN-01') g`)
  console.log(`   TRƯỚC: chờ = ${cho1.so} · ds tem = ${JSON.stringify((cho1.ds || []).map(x => x.tem))}`)
  const r3a = await g1(AU.ceo, `select kho.tram_quet('T77-A','TRAM-DAN-01') g`)   // quét 1 tấm VÀO
  const cho2 = await g1(AU.ceo, `select kho.tram_dang_cho('TRAM-DAN-01') g`)
  console.log(`   quét T77-A vào DAN → ok=${r3a.ok} · SAU: chờ = ${cho2.so}`)
  ok('#3 danh sách chờ 3 → quét 1 vào → còn 2 (🟥 sai số = ĐỎ)', cho1.so === 3 && r3a.ok === true && cho2.so === 2)

  // ═══ 2 · CHẶN hiện lý do VÀ đường thoát ═══
  console.log('\n── 2 · quét nhảy bước → lý do từ server + câu đường thoát ──')
  // T77-B chưa 'ra' ở DAN; quét THẲNG bước sau (cần 1 tem chưa qua cat). Dựng tem mới chưa qua cat:
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T77',1,'T77-NHAY','hong',$1)`, [mon])
  const r2 = await g1(AU.ceo, `select kho.tram_quet('T77-NHAY','TRAM-DAN-01') g`)   // chưa qua cat → NHAY_BUOC
  console.log(`   ok=${r2.ok} loi=${r2.loi}\n   lý do   = "${r2.ly_do}"\n   đường thoát = "${r2.duong_thoat}"`)
  ok('#2 chặn hiện LÝ DO (server) + ĐƯỜNG THOÁT có câu ghi bù (🟥 thiếu đường thoát = ĐỎ)',
    r2.ok === false && r2.loi === 'NHAY_BUOC' && !!r2.ly_do && /ghi bù/.test(r2.duong_thoat || ''))

  // ═══ 4 · tram_quet ghi HỎNG khi truyền so_hong, KHÔNG ghi khi không truyền ═══
  console.log('\n── 4 · so_hong: truyền 1 → ghi hỏng; không truyền → không hỏng ──')
  const rH = await g1(AU.ceo, `select kho.tram_quet('T77-B','TRAM-DAN-01',1,0) g`)   // vào DAN, hỏng
  const hongB = Number((await q1(`select coalesce(sum(so_hong),0) s from kho.su_kien_quet where tem_ma='T77-B' and ma_tram='TRAM-DAN-01'`)).s)
  const rN = await g1(AU.ceo, `select kho.tram_quet('T77-C','TRAM-DAN-01') g`)       // vào DAN, không hỏng
  const hongC = Number((await q1(`select coalesce(sum(so_hong),0) s from kho.su_kien_quet where tem_ma='T77-C' and ma_tram='TRAM-DAN-01'`)).s)
  console.log(`   T77-B so_hong=${hongB} · T77-C so_hong=${hongC}`)
  ok('#4 so_hong=1 ghi hỏng cho tấm đó, tấm sau KHÔNG hỏng (🟥 ghi cả hai = ĐỎ)', hongB === 1 && hongC === 0)

  // ═══ 5 · chưa mở ca → không quét được (server chặn) ═══
  console.log('\n── 5 · trạm CAM chưa ai trực → tram_quet chặn CHUA_CO_CA ──')
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('T77',1,'T77-NOCA','hong',$1)`, [mon])
  const r5 = await g1(AU.ceo, `select kho.tram_quet('T77-NOCA','TRAM-CAM-01') g`)
  console.log(`   ok=${r5.ok} loi=${r5.loi}`)
  ok('#5 chưa mở ca → CHẶN (CHUA_CO_CA)', r5.ok === false && r5.loi === 'CHUA_CO_CA')

  // ═══ 7 · CỔNG VAI ═══
  console.log('\n── 7 · cổng vai: tho/xuong/ceo VÀO · sale/thiet_ke/ke_toan/NULL CHẶN ──')
  const vao = []; for (const v of ['tho', 'xuong', 'ceo']) { const x = await asK(AU[v], `select kho.tram_man('TRAM-DAN-01') g`); vao.push([v, !x.e]) }
  const chan = []; for (const v of ['sale', 'thiet_ke', 'ke_toan']) { const x = await asK(AU[v], `select kho.tram_man('TRAM-DAN-01') g`); chan.push([v, !!x.e]) }
  const xnull = await asK(null, `select kho.tram_man('TRAM-DAN-01') g`)
  console.log(`   VÀO: ${JSON.stringify(vao)} · CHẶN: ${JSON.stringify(chan)} · NULL chặn=${!!xnull.e}`)
  ok('#7 tho/xuong/ceo VÀO', vao.every(([, v]) => v))
  ok('#7 sale/thiet_ke/ke_toan CHẶN + NULL CHẶN', chan.every(([, v]) => v) && !!xnull.e)
  // ghi bù: tho KHÔNG được (server), xuong được — nút ẩn ở client, server cũng gác
  const gbTho = await asK(AU.tho, `select kho.ghi_bu('T77-C','TRAM-DAN-01','ra',now(),'thử') g`)
  ok('#7 ghi_bu: tho bị CHẶN ở server (nút cũng ẩn ở client)', !!gbTho.e && /xuong\/ceo/.test(gbTho.e))

  console.log(`\n══ KẾT QUẢ 077: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
