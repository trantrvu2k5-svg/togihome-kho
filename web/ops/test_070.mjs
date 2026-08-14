// TEST CẮN — 070 · BA MỐC số đơn vị (du_kien/chuan/thuc_te). In ĐỦ HAI VẾ. Tx rollback.
//   Chạy: cd web && node ops/test_070.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const NS_TK = '38c5252b-6e59-4651-8edb-d1c38afed0b6'   // nguoi_dung.id thiet_ke
const HD8 = ['cat', 'dan', 'cam', 'thung', 'cup', 'ray', 'canh', 'goi']
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

try {
  await c.query('begin')
  const don = (await row1(`insert into kho.don_hang(ma_don,trang_thai,ma_ns_thiet_ke) values('T70','dang_thiet_ke',$1) returning id`, [NS_TK])).id
  const mon = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món A','TU-AO-MELAMINE') returning id`, [don])).id

  // ═══ 3 · MIGRATION: dữ liệu cũ đều 'chuan', không mốc lạ ═══
  console.log('\n── 3 · migration: dữ liệu cũ đều thành chuan ──')
  const mg = await row1(`select count(*) tong, count(*) filter(where moc='chuan') chuan, count(*) filter(where moc not in ('du_kien','chuan','thuc_te')) la from kho.so_don_vi_mon where chot_luc is null`)
  console.log(`   so_don_vi_mon: ${mg.tong} dòng · chuan=${mg.chuan} · mốc lạ=${mg.la}`)
  ok('✅ mọi dòng sẵn có = chuan, 0 mốc lạ (🟥 lệch = migration hỏng)', Number(mg.tong) === Number(mg.chuan) && Number(mg.la) === 0)

  // ═══ 1 · BA MỐC CÙNG SỐNG (quan trọng nhất) ═══
  console.log('\n── 1 · ba mốc cùng món cùng hoạt động — không đè nhau ──')
  await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values ($1,'cat','du_kien',40,'uoc'),($1,'cat','chuan',45,'go_tay'),($1,'cat','thuc_te',52,'cutlist')`, [mon])
  await c.query(`update kho.so_don_vi_mon set so_hong=5 where mon_id=$1 and hoat_dong='cat' and moc='thuc_te'`, [mon])   // cho test 7: 5 hỏng
  const ba = (await c.query(`select moc,so_don_vi from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat' order by moc`, [mon])).rows
  console.log('   ' + ba.map(r => r.moc + '=' + r.so_don_vi).join(' · '))
  ok('✅ ĐỦ 3 dòng, không dòng nào đè (🟥 unique cũ → 1 dòng)', ba.length === 3)

  // ═══ 2 · thiết kế SX không xoá số bán hàng ═══
  console.log('\n── 2 · ghi du_kien rồi ghi chuan — cả hai còn sống ──')
  const mon2 = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món B','TU-AO-MELAMINE') returning id`, [don])).id
  await asK(U.ceo, `select kho.luu_so_don_vi($1,'cat','40','uoc','du_kien')`, [mon2])   // bán hàng ước
  await asK(U.ceo, `select kho.luu_so_don_vi($1,'cat','45','go_tay','chuan')`, [mon2])  // sản xuất đếm
  const hai = (await c.query(`select moc,so_don_vi from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat' order by moc`, [mon2])).rows
  console.log('   ' + hai.map(r => r.moc + '=' + r.so_don_vi).join(' · '))
  ok('✅ du_kien=40 VÀ chuan=45 cùng sống (🟥 ghi chuan xoá du_kien = ĐỎ)',
    hai.length === 2 && hai.find(r => r.moc === 'du_kien').so_don_vi == 40 && hai.find(r => r.moc === 'chuan').so_don_vi == 45)

  // ═══ 4 · hàm giờ theo mốc — THIEU_MOC, không rơi mốc khác ═══
  console.log('\n── 4 · gọi mốc chưa có dữ liệu → THIEU_MOC ──')
  const monC = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món C','TU-AO-MELAMINE') returning id`, [don])).id
  await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) select $1,hoat_dong,'chuan',5,'go_tay' from kho.quy_trinh_buoc where ma_quy_trinh='TU-AO-MELAMINE' and loai_buoc<>'tu_chay'`, [monC])
  const gDk = (await as(U.ceo, `select kho.gio_du_kien_cua_mon($1,'du_kien') g`, [monC])).r[0].g
  const gCh = (await as(U.ceo, `select kho.gio_du_kien_cua_mon($1,'chuan') g`, [monC])).r[0].g
  console.log(`   món chỉ có chuan · gọi du_kien → loi=${gDk.loi} tong=${gDk.tong_gio} · gọi chuan → ok=${gCh.ok} tong=${gCh.tong_gio}`)
  ok('✅ mốc trống → THIEU_MOC, KHÔNG rơi chuan, KHÔNG 0 (🟥 trả số mốc khác = ĐỎ)', gDk.loi === 'THIEU_MOC' && gDk.tong_gio === null)
  ok('✅ mốc chuan có số → tính bình thường', gCh.ok === true && Number(gCh.tong_gio) > 0)

  // ═══ 5 · cột hỏng chỉ cho thuc_te ═══
  console.log('\n── 5 · so_hong chỉ có nghĩa với thuc_te ──')
  let e5a = false; try { await c.query('savepoint h5'); await c.query(`update kho.so_don_vi_mon set so_hong=3 where mon_id=$1 and hoat_dong='cat' and moc='chuan'`, [mon]); e5a = true; await c.query('rollback to savepoint h5') } catch (e) { await c.query('rollback to savepoint h5') }
  ok('✅ so_hong>0 ở moc=chuan → BỊ CHẶN (check)', !e5a)
  let e5b = false; try { await c.query('savepoint h5b'); await c.query(`update kho.so_don_vi_mon set so_hong=5 where mon_id=$1 and hoat_dong='cat' and moc='thuc_te'`, [mon]); e5b = true; await c.query('rollback to savepoint h5b') } catch (e) { await c.query('rollback to savepoint h5b') }
  ok('✅ so_hong>0 ở moc=thuc_te → ĐƯỢC', e5b)

  // ═══ 6 · CHỐT rồi không sửa được (qua ban_giao_xuong thật) ═══
  console.log('\n── 6 · bàn giao chốt chuan → không sửa được ──')
  // đơn riêng đủ điều kiện bàn giao: 1 món đủ 8 số chuan + khách duyệt + file
  const donG = (await row1(`insert into kho.don_hang(ma_don,trang_thai,ma_ns_thiet_ke) values('T70-BG','dang_thiet_ke',$1) returning id`, [NS_TK])).id
  const monG = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'MG','TU-AO-MELAMINE') returning id`, [donG])).id
  for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',5,'go_tay')`, [monG, hd])
  await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,'cat','du_kien',4,'uoc')`, [monG])  // du_kien để thử sửa sau
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('T70-BG',1,$1,'khach_duyet')`, [NS_TK])
  const bg = await asK(U.thiet_ke, `select kho.ban_giao_xuong('T70-BG', '[{"loai_file":"dxf","duong_dan":"x","ten_goc":"a","co_byte":1}]'::jsonb, null)`)
  const daChot = Number((await row1(`select count(*) n from kho.so_don_vi_mon where mon_id=$1 and moc='chuan' and chot_luc is not null`, [monG])).n)
  console.log(`   bàn giao: ${bg.e || 'ok'} · dòng chuan đã chốt = ${daChot}/8`)
  let e6 = false; try { await c.query('savepoint c6'); await c.query(`update kho.so_don_vi_mon set so_don_vi=99 where mon_id=$1 and hoat_dong='cat' and moc='chuan'`, [monG]); e6 = true; await c.query('rollback to savepoint c6') } catch (e) { await c.query('rollback to savepoint c6') }
  ok('✅ sửa dòng chuan ĐÃ CHỐT → BỊ CHẶN (🟥 sửa được = ĐỎ)', !e6 && daChot === 8)
  let e6b = false; try { await c.query('savepoint d6'); await c.query(`update kho.so_don_vi_mon set so_don_vi=9 where mon_id=$1 and hoat_dong='cat' and moc='du_kien'`, [monG]); e6b = true; await c.query('rollback to savepoint d6') } catch (e) { await c.query('rollback to savepoint d6') }
  ok('✅ dòng du_kien CÙNG món vẫn sửa được (chốt chỉ khoá chuan)', e6b)

  // ═══ 7 · so_sanh_moc đúng ═══
  console.log('\n── 7 · so_sanh_moc: tách chênh do hỏng / do đếm ──')
  const ss = (await as(U.ceo, `select kho.so_sanh_moc('T70') g`, [])).r[0].g
  const h = ss.mon.find(m => m.mon_id === mon).hoat_dong.find(x => x.hoat_dong === 'cat')
  console.log(`   cat: dk=${h.du_kien} chuan=${h.chuan} tt=${h.thuc_te} | dk→chuan +${h.chenh_dk_chuan}(${h.pct_dk_chuan}%) | chuan→tt +${h.chenh_chuan_tt}(${h.pct_chuan_tt}%) = hỏng ${h.chenh_do_hong} + đếm ${h.chenh_do_dem}`)
  ok('✅ chênh dk→chuan +5 (12,5%)', h.chenh_dk_chuan == 5 && h.pct_dk_chuan == 12.5)
  ok('✅ chênh chuan→tt +7 (15,6%), tách hỏng 5 + đếm 2', h.chenh_chuan_tt == 7 && h.pct_chuan_tt == 15.6 && h.chenh_do_hong == 5 && h.chenh_do_dem == 2)

  // ═══ 8 · mốc thiếu để trống, không điền 0 ═══
  console.log('\n── 8 · món chỉ có chuan → dk và tt để TRỐNG, không 0 ──')
  const h2 = ss.mon.find(m => m.mon_id === monC).hoat_dong.find(x => x.hoat_dong === 'cat')
  console.log(`   món C cat: du_kien=${h2.du_kien} chuan=${h2.chuan} thuc_te=${h2.thuc_te}`)
  ok('✅ du_kien & thuc_te = null (chưa có), KHÔNG 0 (🟥 điền 0 = ĐỎ)', h2.du_kien === null && h2.thuc_te === null && h2.chuan == 5)

  // ═══ 9 · chép từ món tương tự ═══
  console.log('\n── 9 · chép món tương tự × tỉ lệ (đếm làm tròn lên · đo giữ lẻ) ──')
  const src = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Nguồn','TU-AO-MELAMINE') returning id`, [don])).id
  await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values ($1,'cat','chuan',45,'go_tay'),($1,'dan','chuan',50,'go_tay')`, [src])
  const dst = (await row1(`insert into kho.don_hang_mon(don_id,ten) values($1,'Đích') returning id`, [don])).id
  const cp = await asK(U.ceo, `select kho.chep_so_tu_mon_tuong_tu($1,$2,0.9) g`, [dst, src])
  const cpr = (await c.query(`select hoat_dong,so_don_vi,moc,nguon from kho.so_don_vi_mon where mon_id=$1 and moc='du_kien' order by hoat_dong`, [dst])).rows
  const cat = cpr.find(r => r.hoat_dong === 'cat'), dan = cpr.find(r => r.hoat_dong === 'dan')
  console.log(`   chép ×0,9: cat(đếm) 45→${cat.so_don_vi} (ceil(40,5)=41) · dan(đo) 50→${dan.so_don_vi} (45,0 giữ lẻ) · moc=${cat.moc} nguon=${cat.nguon}`)
  ok('✅ cat làm tròn LÊN 41, ghi moc=du_kien nguon=uoc', Number(cat.so_don_vi) === 41 && cat.moc === 'du_kien' && cat.nguon === 'uoc')
  ok('✅ dan (đo) giữ số lẻ 45,0 (không làm tròn lên)', Number(dan.so_don_vi) === 45)
  const trong = await asK(U.ceo, `select kho.chep_so_tu_mon_tuong_tu($1,$2,1.0) g`, [dst, dst])   // dst hiện có du_kien; dùng món trống thật
  const monTrong = (await row1(`insert into kho.don_hang_mon(don_id,ten) values($1,'Trống') returning id`, [don])).id
  const eT = await as(U.ceo, `select kho.chep_so_tu_mon_tuong_tu($1,$2,1.0)`, [dst, monTrong])
  ok('✅ món nguồn không có số → CHẶN (MON_NGUON_TRONG)', /MON_NGUON_TRONG/.test(eT.e || ''), eT.e || '(lọt!)')

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 070: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
