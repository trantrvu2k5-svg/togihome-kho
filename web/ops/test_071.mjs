// TEST CẮN — 071 · ĐÓNG BĂNG PHÚT + ĐƠN GIÁ tại bàn giao. In ĐỦ HAI VẾ bằng số thật. Tx rollback.
//   Chạy: cd web && node ops/test_071.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e' }
const NS_TK = '38c5252b-6e59-4651-8edb-d1c38afed0b6'
const HD8 = ['cat', 'dan', 'cam', 'thung', 'cup', 'ray', 'canh', 'goi']
const FILE = `'[{"loai_file":"dxf","duong_dan":"x","ten_goc":"a","co_byte":1}]'::jsonb`
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const row1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gioDon = async (ma, moc = 'chuan') => (await asK(U.ceo, `select kho.gio_du_kien_cua_don($1,$2) g`, [ma, moc])).r[0].g
async function dungDon(ma, h=true) {   // đơn + 1 món TU-AO-MELAMINE + 8 số chuan + (khách duyệt)
  const don = (await row1(`insert into kho.don_hang(ma_don,trang_thai,ma_ns_thiet_ke) values($1,'dang_thiet_ke',$2) returning id`, [ma, NS_TK])).id
  const mon = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'M','TU-AO-MELAMINE') returning id`, [don])).id
  for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',10,'go_tay')`, [mon, hd])
  if (h) await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values($1,1,$2,'khach_duyet')`, [ma, NS_TK])
  return { don, mon }
}

try {
  await c.query('begin')

  // ═══ 1 & 2 · sửa PHÚT — đơn đã bàn giao GIỮ NGUYÊN, đơn chưa bàn giao ĐỔI (hai vế cùng cơ chế) ═══
  console.log('\n── 1&2 · sửa phút quy trình: đã bàn giao giữ · chưa bàn giao đổi ──')
  const A = await dungDon('T71-BG')      // sẽ bàn giao
  const B = await dungDon('T71-LIVE')    // để nguyên (chưa bàn giao)
  const bg = await asK(U.thiet_ke, `select kho.ban_giao_xuong('T71-BG', ${FILE}, null)`)
  const gA0 = (await gioDon('T71-BG')).tong_gio_don, gB0 = (await gioDon('T71-LIVE')).tong_gio_don
  const nguonA = (await gioDon('T71-BG')).nguon_gio
  // SỬA PHÚT bước cat: 0,10 → 0,50 giờ/đv
  await c.query(`update kho.quy_trinh_buoc set gio_moi_don_vi=0.50 where ma_quy_trinh='TU-AO-MELAMINE' and hoat_dong='cat'`)
  const gA1 = (await gioDon('T71-BG')).tong_gio_don, gB1 = (await gioDon('T71-LIVE')).tong_gio_don
  console.log(`   ĐÃ bàn giao (nguon_gio=${nguonA}): TRƯỚC=${gA0} → SAU=${gA1}`)
  console.log(`   CHƯA bàn giao:                    TRƯỚC=${gB0} → SAU=${gB1}`)
  ok('#1 sửa phút → đơn ĐÃ bàn giao GIỮ NGUYÊN giờ (🟥 đổi = ĐỎ)', bg.e === null && Number(gA0) === Number(gA1) && nguonA === 'da_chot')
  ok('#2 sửa phút → đơn CHƯA bàn giao ĐỔI giờ (🟥 không đổi = ĐỎ)', Number(gB1) > Number(gB0))

  // ═══ 3 · sửa ĐƠN GIÁ — tiền công đơn đã bàn giao KHÔNG đổi ═══
  console.log('\n── 3 · sửa đơn giá: tiền công đã bàn giao giữ · chưa bàn giao đổi ──')
  const tienCat = async (ma) => { const ss = (await asK(U.ceo, `select kho.so_sanh_moc($1) g`, [ma])).r[0].g; return ss.mon[0].hoat_dong.find(x => x.hoat_dong === 'cat').tien_chuan }
  const tA0 = await tienCat('T71-BG'), tB0 = await tienCat('T71-LIVE')
  await c.query(`update kho.don_gia_baseline set don_gia=9999 where hoat_dong='cat'`)
  const tA1 = await tienCat('T71-BG'), tB1 = await tienCat('T71-LIVE')
  console.log(`   ĐÃ bàn giao tien_cat: ${tA0} → ${tA1} · CHƯA bàn giao: ${tB0} → ${tB1}`)
  ok('#3 sửa đơn giá → tiền công đơn ĐÃ bàn giao KHÔNG đổi (dùng don_gia_chot)', Number(tA0) === Number(tA1))
  ok('#3 sửa đơn giá → tiền công đơn CHƯA bàn giao ĐỔI (dùng đơn giá live)', Number(tB1) !== Number(tB0))

  // ═══ 4 · chốt thiếu → chặn bàn giao, không chốt một phần ═══
  console.log('\n── 4 · chốt thiếu đơn giá → chặn cả bàn giao ──')
  await c.query('savepoint s4')
  const D = await dungDon('T71-THIEU')
  await c.query(`update kho.don_gia_baseline set don_gia=null where hoat_dong='cat'`)   // 1 hoạt động thiếu đơn giá
  const bg4 = await asK(U.thiet_ke, `select kho.ban_giao_xuong('T71-THIEU', ${FILE}, null)`)
  const chot4 = Number((await row1(`select count(*) n from kho.so_don_vi_mon where mon_id=$1 and chot_luc is not null`, [D.mon])).n)
  const tt4 = (await row1(`select trang_thai from kho.don_hang where ma_don='T71-THIEU'`)).trang_thai
  console.log(`   bàn giao: ${bg4.e ? bg4.e.slice(0, 60) : 'ok'} · dòng đã chốt=${chot4} · trạng thái=${tt4}`)
  ok('#4 chốt thiếu đơn giá → CHOT_THIEU_SO, KHÔNG chốt dòng nào (🟥 chốt một phần = ĐỎ)', /CHOT_THIEU_SO/.test(bg4.e || '') && chot4 === 0 && tt4 === 'dang_thiet_ke')
  await c.query('rollback to savepoint s4')

  // ═══ 5 · cấm sửa số chốt ═══
  console.log('\n── 5 · cấm sửa phút chốt ──')
  let e5 = false; try { await c.query('savepoint s5'); await c.query(`update kho.so_don_vi_mon set gio_moi_don_vi_chot=0.99 where mon_id=$1 and hoat_dong='cat' and moc='chuan'`, [A.mon]); e5 = true; await c.query('rollback to savepoint s5') } catch (e) { await c.query('rollback to savepoint s5') }
  ok('#5 update gio_moi_don_vi_chot dòng đã chốt → BỊ CHẶN', !e5)

  // ═══ 6 · đơn cũ thiếu số chốt → cờ thieu_so_chot, không im lặng ═══
  console.log('\n── 6 · đơn cũ bàn giao trước lô — thiếu số chốt ──')
  const E = await dungDon('T71-CU', false)
  // giả lập đơn cũ: chuan đã chốt (chot_luc) nhưng CHƯA có phút chốt (insert lại — trigger chỉ chặn UPDATE)
  await c.query(`update kho.so_don_vi_mon set chot_luc=now(), chot_boi=$1 where mon_id=$2 and moc='chuan'`, [NS_TK, E.mon])
  const g6 = await gioDon('T71-CU')
  console.log(`   nguon_gio=${g6.nguon_gio} · tong=${g6.tong_gio_don}`)
  ok('#6 chốt nhưng thiếu phút chốt → nguon_gio=thieu_so_chot (KHÔNG im lặng trả live như đã chốt)', g6.nguon_gio === 'thieu_so_chot' && g6.tong_gio_don != null)

  // ═══ 7 · mốc du_kien luôn LIVE ═══
  console.log('\n── 7 · mốc du_kien vẫn theo phút mới nhất ──')
  const G = (await row1(`insert into kho.don_hang(ma_don,trang_thai) values('T71-DK','dang_thiet_ke') returning id`)).id
  const monG = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'M','TU-AO-MELAMINE') returning id`, [G])).id
  for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'du_kien',10,'uoc')`, [monG, hd])
  const dk0 = (await gioDon('T71-DK', 'du_kien')).tong_gio_don
  await c.query(`update kho.quy_trinh_buoc set gio_moi_don_vi=0.90 where ma_quy_trinh='TU-AO-MELAMINE' and hoat_dong='dan'`)
  const dk1 = (await gioDon('T71-DK', 'du_kien')).tong_gio_don
  console.log(`   du_kien TRƯỚC=${dk0} → SAU=${dk1}`)
  ok('#7 mốc du_kien ĐỔI theo phút mới (không phải cam kết, luôn live)', Number(dk1) > Number(dk0))

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 071: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
