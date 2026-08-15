// TEST CẮN — 080 · atp() theo MỐC + so_lech_hua. Tx rollback. cd web && node ops/test_080.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
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
const g1 = async (s, a = []) => { const x = await asK(CEO, s, a); return x.r ? x.r[0].g : { _e: x.e } }
// đơn KHÔNG hạn (→ atp xếp xuôi, ngày = ngày xong) + món 1 bước cnc gmdv=1; số theo mốc
async function donMoc(ma, duKien, chuan) {
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai) values($1,'cho_cat') returning id`, [ma]))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QMOC') returning id`, [don]))[0].id
  if (duKien != null) await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,'cat','du_kien',$2,'uoc')`, [mon, duKien])
  if (chuan != null) await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,'cat','chuan',$2,'go_tay')`, [mon, chuan])
  return { don, mon }
}

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QMOC','moc')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values('QMOC',100,'{}','chung','cat','nguoi',0,1)`)
  // phủ đủ năng lực cnc từ trước (tránh tuần hiện tại bị cắt lẻ) → tuần 0 = 246.4 giờ
  await q(`update kho.nang_luc_to set tu_ngay = current_date - 90 where ma_to='cnc' and den_ngay is null`)
  // lấp cnc tuần 0 = 205 → còn 41.4 giờ: 40 vừa (tuần 0), 45/60 phải sang tuần 1 → ngày hứa khác nhau
  await q(`insert into kho.don_hang(ma_don,trang_thai) values('T80-FILL','cho_cat')`)
  await q(`insert into kho.xep_lich(ma_don,buoc_thu_tu,tuan_bat_dau,ma_to,gio,kieu_xep) values('T80-FILL',1,kho.tuan_cua(current_date),'cnc',205,'xuoi')`)

  // ═══ 1 · atp ĐỌC ĐÚNG MỐC TRUYỀN VÀO ═══
  console.log('\n── 1 · món du_kien=40 & chuan=45 → atp(du_kien) vs atp(chuan) ra HAI ngày ──')
  await donMoc('T80-1', 40, 45)
  const a_dk = await g1(`select kho.atp('T80-1','du_kien') g`)
  const a_ch = await g1(`select kho.atp('T80-1','chuan') g`)
  console.log(`   du_kien → hứa ${a_dk.ngay_hua_duoc} (do_tin ${a_dk.do_tin}) · chuan → hứa ${a_ch.ngay_hua_duoc} (do_tin ${a_ch.do_tin})`)
  ok('#1 hai mốc → HAI ngày khác nhau (🟥 cùng ngày = ĐỎ)', a_dk.ngay_hua_duoc !== a_ch.ngay_hua_duoc && a_dk.ok && a_ch.ok)

  // ═══ 3 · ĐỘ TIN ĐÚNG (dùng luôn kết quả test 1) ═══
  console.log('\n── 3 · độ tin: du_kien→uoc · chuan→cao ──')
  ok('#3 do_tin: du_kien="uoc" · chuan="cao"', a_dk.do_tin === 'uoc' && a_ch.do_tin === 'cao' && a_dk.moc_da_dung === 'du_kien' && a_ch.moc_da_dung === 'chuan')

  // ═══ 2 · ĐỔI MỐC KHÔNG IM LẶNG ═══
  console.log('\n── 2 · món chỉ có chuan → atp(du_kien) tự lùi chuan + CỜ ──')
  await donMoc('T80-2', null, 45)
  const a2 = await g1(`select kho.atp('T80-2','du_kien') g`)
  console.log(`   yêu cầu du_kien → dùng ${a2.moc_da_dung} · da_dung_moc_khac=${a2.da_dung_moc_khac} · do_tin=${a2.do_tin}`)
  ok('#2 thiếu du_kien → DA_DUNG_MOC_KHAC + moc_da_dung="chuan" (🟥 im lặng đổi = ĐỎ)',
    a2.ok === true && a2.da_dung_moc_khac === true && a2.moc_da_dung === 'chuan' && a2.moc_yeu_cau === 'du_kien')

  // ═══ 4 · so_lech_hua BẮT ĐƯỢC LỆCH ═══
  console.log('\n── 4 · món du_kien=40, chuan=60 → hai ngày hứa lệch → cảnh báo có số ngày ──')
  await donMoc('T80-4', 40, 60)
  const l4 = await g1(`select kho.so_lech_hua('T80-4') g`)
  console.log(`   so_sanh_duoc=${l4.so_sanh_duoc} · du_kien ${l4.ngay_hua_du_kien} vs chuan ${l4.ngay_hua_chuan} · lệch ${l4.lech_ngay} ngày · cảnh báo="${(l4.canh_bao || '').slice(0, 45)}…"`)
  ok('#4 so_lech_hua: lệch >3 ngày → CẢNH BÁO có số ngày cụ thể (🟥 không cảnh báo = ĐỎ)',
    l4.so_sanh_duoc === true && Number(l4.lech_ngay) > 3 && /lệch \d+ ngày/.test(l4.canh_bao || ''))

  console.log(`\n══ KẾT QUẢ 080: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
