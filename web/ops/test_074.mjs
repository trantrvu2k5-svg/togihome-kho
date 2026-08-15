// TEST CẮN — 074 · SỔ QUÉT. In ĐỦ HAI VẾ. Tx rollback. Chạy: cd web && node ops/test_074.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const AU = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2' }
// nguoi_dung.id để mở ca (khác người cho mỗi trạm — uq_ca_nguoi_dang)
const NS = ['600286f2-2482-4dff-b0a4-a3183740be56', 'fc206d9e-5051-4e9a-a84b-0729f86ef70c', '5006d61d-8237-4ad7-9df6-32df821bb21b',
  '6f30244c-b9e4-4985-925c-0dd7ac0f7b9a', '75097117-3dac-4e5d-94f6-29caa4e32c74', 'c50e8f8b-cd41-46c3-83d5-56969934fd9a',
  'a8dfb596-3347-42f9-b19b-70c2893b569e', 'e4c99078-a624-42ef-b7bb-debdd8d9174d', 'ba768336-c856-44c2-9f56-45f2990bf648', '38c5252b-6e59-4651-8edb-d1c38afed0b6']
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
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
const quet = (tram, tem = 'T-QS') => asK(AU.ceo, `select kho.quet_tem($1,$2) g`, [tem, tram]).then(x => x.r ? x.r[0].g : { ok: null, e: x.e })

try {
  await c.query('begin')
  // ══ SETUP: quy trình QSCAN (2 nhánh) + món + tem + ca + trạm chạy ══
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QSCAN','QT quét thử')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_moi_don_vi) values
    ('QSCAN',100,'{}','chung','cat','nguoi',0.1),
    ('QSCAN',200,'{100}','thùng','thung','nguoi',0.1), ('QSCAN',210,'{100}','cánh','lot','nguoi',0.1),
    ('QSCAN',300,'{200}','thùng','ray','nguoi',0.1),   ('QSCAN',310,'{210}','cánh','pu','nguoi',0.1),
    ('QSCAN',400,'{300,310}','chung','goi','nguoi',0.1)`)
  const don = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T74','dang_thiet_ke') returning id`)).id
  const mon = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món quét','QSCAN') returning id`, [don])).id
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,mon_id) values('T74',1,'T-QS',$1)`, [mon])
  // ca: mỗi trạm một người trực
  const TRAM = { cat: 'TRAM-CAT-01', thung: 'TRAM-THUNG-01', lot: 'TRAM-LOT-01', ray: 'TRAM-RAY-01', pu: 'TRAM-PU-01', goi: 'TRAM-GOI-01' }
  let i = 0; for (const t of Object.values(TRAM)) await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram) values($1,$2)`, [NS[i++], t])

  // ═══ 1 · NHẢY BƯỚC ═══
  console.log('\n── 1 · quét nhảy bước (chưa qua bước trước) ──')
  const r1 = await quet(TRAM.pu)   // pu chờ lot; lot chưa làm
  const chan1 = Number((await q1(`select count(*) n from kho.su_kien_quet where tem_ma='T-QS' and ma_tram='TRAM-PU-01' and ket_qua='chan'`)).n)
  console.log(`   quét PU khi chưa qua Chà lót → ok=${r1.ok} loi=${r1.loi} · sổ chan=${chan1}`)
  ok('#1 nhảy bước → CHẶN + GHI SỔ chan (🟥 không guard f cho qua = ĐỎ)', r1.ok === false && r1.loi === 'NHAY_BUOC' && chan1 === 1)

  // ═══ 2 · NHÁNH SONG SONG KHÔNG BỊ CHẶN OAN (quan trọng nhất) ═══
  console.log('\n── 2 · nhánh cánh qua chà lót → quét sơn PU được, dù nhánh thùng còn ở sau ──')
  await quet(TRAM.cat); await quet(TRAM.cat)   // cat vào + ra
  await quet(TRAM.lot); await quet(TRAM.lot)   // lot (cánh) vào + ra — thùng CHƯA làm gì
  const r2 = await quet(TRAM.pu)               // pu chờ lot (đã xong) → PHẢI CHO QUA
  console.log(`   thùng nhánh chưa động · cánh nhánh: cat✓ lot✓ → quét PU: ${r2.e ? '❌ CHẶN OAN ' + r2.e.slice(0, 40) : '✅ nhan (loai=' + r2.loai + ')'}`)
  ok('#2 nhánh song song KHÔNG chặn oan (🟥 suy thu_tu-1 chặn = ĐỎ)', !r2.e && r2.ket_qua === 'nhan')

  // ═══ 3 · SỔ KHÔNG SỬA ĐƯỢC ═══
  console.log('\n── 3 · ceo thử UPDATE/DELETE sổ ──')
  const up = await as(AU.ceo, `update kho.su_kien_quet set so_hong=9 where tem_ma='T-QS'`)
  const del = await as(AU.ceo, `delete from kho.su_kien_quet where tem_ma='T-QS'`)
  ok('#3 ceo UPDATE sổ → BỊ TỪ CHỐI (RLS, không policy)', up.e != null, up.e || '(sửa được!)')
  ok('#3 ceo DELETE sổ → BỊ TỪ CHỐI', del.e != null, del.e || '(xoá được!)')

  // ═══ 4 · QUÉT BỊ CHẶN VẪN GHI SỔ (3 tình huống) ═══
  console.log('\n── 4 · ba tình huống chặn → sổ có 3 dòng chan khác lý do ──')
  await c.query('savepoint s4')
  await quet('TRAM-CAT-01', 'TEM-LA-XXX')       // (a) tem lạ
  await quet('TRAM-SONCANH-01', 'T-QS')          // (b) chưa ai mở ca ở son_canh
  await quet('TRAM-RAY-01', 'T-QS')              // (c) nhảy bước (ray chờ thung, thung chưa làm)
  const lydo = (await c.query(`select distinct ly_do_chan from kho.su_kien_quet where ket_qua='chan' and ly_do_chan is not null`)).rows.map(r => r.ly_do_chan)
  console.log(`   lý do chan phân biệt (${lydo.length}): ${JSON.stringify(lydo.map(l => l.slice(0, 20)))}`)
  ok('#4 mỗi tình huống chặn GHI SỔ, lý do KHÁC nhau (🟥 không ghi = ĐỎ)', lydo.length >= 3)
  await c.query('rollback to savepoint s4')

  // ═══ 5 · CHƯA MỞ CA → CHẶN ═══
  console.log('\n── 5 · trạm không ai trực → chặn ──')
  const r5 = await quet('TRAM-CAM-01')   // cam chưa mở ca
  ok('#5 chưa mở ca → CHẶN (CHUA_CO_CA)', r5.ok === false && r5.loi === 'CHUA_CO_CA', JSON.stringify(r5))

  // ═══ 6 · TRẠM HỎNG → CHẶN · CHẠY LẠI → ĐƯỢC ═══
  console.log('\n── 6 · trạm hỏng chặn, chạy lại được ──')
  await c.query('savepoint s6')
  await c.query(`insert into kho.trang_thai_tram(ma_tram,trang_thai,ly_do,nguoi_id) values('TRAM-GOI-01','hong','Hỏng máy',$1)`, [NS[0]])
  const r6a = await quet(TRAM.goi)
  await c.query(`update kho.trang_thai_tram set ket_thuc=now() where ma_tram='TRAM-GOI-01' and ket_thuc is null`)
  await c.query(`insert into kho.trang_thai_tram(ma_tram,trang_thai) values('TRAM-GOI-01','chay')`)
  // goi chờ {300,310}; chưa xong → sẽ chặn nhảy bước, KHÔNG phải hỏng. Kiểm riêng trạng thái:
  const r6b = await quet(TRAM.goi)
  console.log(`   hỏng → ok=${r6a.ok} loi=${r6a.loi} (${(r6a.ly_do || '').slice(0, 25)}) · chạy lại → loi=${r6b.loi}`)
  ok('#6 trạm hỏng → CHẶN nêu trạng thái (🟥 cho qua = ĐỎ)', r6a.ok === false && r6a.loi === 'TRAM_KHONG_CHAY' && /hong/.test(r6a.ly_do))
  ok('#6 chạy lại → KHÔNG còn chặn vì trạng thái (lỗi khác: vướng bước trước)', r6b.loi !== 'TRAM_KHONG_CHAY')
  await c.query('rollback to savepoint s6')

  // ═══ 7 · GHI BÙ ĐÚNG VAI + KHÔNG PHÁ THỨ TỰ ═══
  console.log('\n── 7 · ghi bù: vai + thứ tự bước ──')
  const gbTho = await as(AU.tho, `select kho.ghi_bu('T-QS','TRAM-CAT-01','ra',now()-interval '1 hour','quên quét')`)
  ok('#7 tho ghi bù → CHẶN (chỉ xuong/ceo)', !!gbTho.e && /chỉ xuong\/ceo/.test(gbTho.e), gbTho.e || '(lọt!)')
  // ghi bù RAY (chờ thung, thung chưa làm) → phải chặn nhảy bước, ghi bù không phá thứ tự
  const gbRay = (await asK(AU.xuong, `select kho.ghi_bu('T-QS','TRAM-RAY-01','ra',now()-interval '30 min','wifi rớt') g`)).r[0].g
  ok('#7 ghi bù nhảy bước (ray khi chưa thung) → CHẶN thứ tự (🟥 phá thứ tự = ĐỎ)', gbRay.ok === false && gbRay.loi === 'NHAY_BUOC')
  // xuong ghi bù ĐÚNG bước (thung, cat đã xong ở test 2) → được
  const gbOk = (await asK(AU.xuong, `select kho.ghi_bu('T-QS','TRAM-THUNG-01','vao',now()-interval '2 hour','wifi rớt') g`)).r[0].g
  ok('#7 xuong ghi bù đúng thứ tự → ĐƯỢC (nguon=tay)', gbOk.ok === true && gbOk.ket_qua === 'nhan', JSON.stringify(gbOk))

  // ═══ 8 · do_gio_that (món TU-AO đủ 8 bước, 3 tem, giờ giả) ═══
  console.log('\n── 8 · do_gio_that: món quét đủ 8 bước → mốc thuc_te ──')
  const HD8 = { cat: 'TRAM-CAT-01', dan: 'TRAM-DAN-01', cam: 'TRAM-CAM-01', thung: 'TRAM-THUNG-01', cup: 'TRAM-CUP-01', ray: 'TRAM-RAY-01', canh: 'TRAM-CANH-01', goi: 'TRAM-GOI-01' }
  const don8 = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T74-TU','dang_thiet_ke') returning id`)).id
  const mon8 = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Tủ áo quét','TU-AO-MELAMINE') returning id`, [don8])).id
  const tems = ['TU-T1', 'TU-T2', 'TU-T3']
  for (const t of tems) await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,mon_id) values('T74-TU',1,$1,$2)`, [t, mon8])
  // chèn thẳng sự kiện (owner-vai ceo) với giờ khống chế: mỗi bước dur 10 phút; hỏng chỉ ở cat
  let mm = 0
  for (const [hd, tram] of Object.entries(HD8)) {
    mm += 20
    for (const t of tems) {
      await asK(AU.ceo, `insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,luc,loai,ket_qua) values($1,$2,$3, now()-interval '${mm} min','vao','nhan')`, [t, tram, NS[0]])
      await asK(AU.ceo, `insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,luc,loai,ket_qua,so_hong) values($1,$2,$3, now()-interval '${mm} min' + interval '10 min','ra','nhan',$4)`, [t, tram, NS[0], hd === 'cat' ? 1 : 0])
    }
  }
  const dg = await asK(AU.ceo, `select kho.do_gio_that($1) g`, [mon8])
  const bang = dg.r[0].g.bang
  const tt = (await c.query(`select hoat_dong,so_don_vi,so_hong from kho.so_don_vi_mon where mon_id=$1 and moc='thuc_te' order by hoat_dong`, [mon8])).rows
  console.log('   BẢNG do_gio_that (giờ chạm tay tính tay = 3 tem × 10 phút = 0,5 giờ/hoạt động):')
  for (const b of bang) console.log(`     ${b.hoat_dong.padEnd(6)} số=${b.so_don_vi} giờ_chạm_tay=${Number(b.gio_cham_tay).toFixed(4)} hỏng=${b.so_hong}`)
  ok('#8 thuc_te ghi đủ 8 hoạt động, số=3 mỗi cái', tt.length === 8 && tt.every(r => Number(r.so_don_vi) === 3))
  ok('#8 giờ chạm tay khớp tính tay (0,5 giờ/hoạt động = 3×10 phút)', bang.every(b => Math.abs(Number(b.gio_cham_tay) - 0.5) < 0.001))
  ok('#8 hỏng dồn đúng ở cat (3 tem × 1 = 3)', Number(tt.find(r => r.hoat_dong === 'cat').so_hong) === 3 && tt.filter(r => r.hoat_dong !== 'cat').every(r => Number(r.so_hong) === 0))

  // ═══ 9 · MÓN CHƯA QUÉT XONG → KHÔNG GHI ═══
  console.log('\n── 9 · quét 5/8 bước → do_gio_that CHẶN, 0 dòng thuc_te ──')
  const don9 = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T74-DO','dang_thiet_ke') returning id`)).id
  const mon9 = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Dở dang','TU-AO-MELAMINE') returning id`, [don9])).id
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,mon_id) values('T74-DO',1,'DO-T1',$1)`, [mon9])
  for (const [hd, tram] of Object.entries(HD8).slice(0, 5)) await asK(AU.ceo, `insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua) values('DO-T1',$1,$2,'ra','nhan')`, [tram, NS[0]])
  const dg9 = await as(AU.ceo, `select kho.do_gio_that($1)`, [mon9])
  const tt9 = Number((await q1(`select count(*) n from kho.so_don_vi_mon where mon_id=$1 and moc='thuc_te'`, [mon9])).n)
  console.log(`   ${dg9.e ? '✅ ' + dg9.e.replace(/^.*CHUA_QUET_XONG:\s*/, '').slice(0, 45) : '(lọt)'} · dòng thuc_te=${tt9}`)
  ok('#9 chưa xong → CHẶN + 0 dòng thuc_te (🟥 ghi dở dang = ĐỎ)', !!dg9.e && /CHUA_QUET_XONG/.test(dg9.e) && tt9 === 0)

  // ═══ 10 · so_sanh_moc với ĐỦ BA MỐC (lần đầu) ═══
  console.log('\n── 10 · so_sanh_moc — ba mốc cùng có dữ liệu ──')
  // thuc_te đã có (test 8); thêm du_kien + chuan cho món8
  for (const [hd] of Object.entries(HD8)) { await asK(AU.ceo, `select kho.luu_so_don_vi($1,$2,'2','uoc','du_kien')`, [mon8, hd]); await asK(AU.ceo, `select kho.luu_so_don_vi($1,$2,'2','go_tay','chuan')`, [mon8, hd]) }
  const ss = (await asK(AU.ceo, `select kho.so_sanh_moc('T74-TU') g`)).r[0].g
  const hcat = ss.mon[0].hoat_dong.find(x => x.hoat_dong === 'cat')
  console.log(`   cat: du_kien=${hcat.du_kien} chuan=${hcat.chuan} thuc_te=${hcat.thuc_te} | dk→chuan=${hcat.chenh_dk_chuan} | chuan→tt=${hcat.chenh_chuan_tt} (hỏng ${hcat.chenh_do_hong} + đếm ${hcat.chenh_do_dem})`)
  ok('#10 ba mốc cùng có số (du_kien=2 chuan=2 thuc_te=3) + tách chênh', hcat.du_kien == 2 && hcat.chuan == 2 && hcat.thuc_te == 3 && hcat.chenh_chuan_tt == 1 && hcat.chenh_do_hong == 3)

  // ═══ 11 · GIỜ CHẠM TAY ≠ THỜI GIAN TRÔI QUA ═══
  console.log('\n── 11 · giờ chạm tay ≠ thời gian trôi qua (có khoảng chờ) ──')
  // tem TU-T1 (test 8): cat vào -160' ra -150' ; goi vào -20' ra -10'  → chạm tay tổng ~1,33h · trôi qua ~2,5h
  const td = (await asK(AU.ceo, `select kho.tien_do_tam('TU-T1') g`)).r[0].g
  console.log(`   giờ chạm tay=${Number(td.gio_cham_tay).toFixed(3)} · thời gian trôi qua=${Number(td.gio_troi_qua).toFixed(3)} · xong ${td.xong}/${td.tong_buoc}`)
  ok('#11 chạm tay ≠ trôi qua (🟥 bằng nhau = gộp = ĐỎ)', Math.abs(Number(td.gio_cham_tay) - Number(td.gio_troi_qua)) > 0.01)

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 074: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 5).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
