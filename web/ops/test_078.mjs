// TEST CẮN — 078 · NĂNG LỰC TỔ + TẢI THEO TUẦN. Tx rollback. Chạy: cd web && node ops/test_078.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const near = (a, b, tol = 0.5) => Math.abs(Number(a) - Number(b)) <= tol
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const g1 = async (s, a = []) => { const x = await asK(CEO, s, a); return x.r ? x.r[0].g : { _e: x.e } }
// dựng 1 đơn có món QNL (cat→cnc, dan→dan_canh) + so_don_vi 'chuan' → gio_du_kien ok
async function donQ(ma, tt, han, qt = 'QNL', sodv = 10) {
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai,ngay_hen_khach,ngay_tao_bao_gia) values($1,$2,$3,case when $2 like 'bao_gia%' then now()-interval '5 days' else null end) returning id`, [ma, tt, han]))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'M','${qt}') returning id`, [don]))[0].id
  const steps = qt === 'QPU' ? ['pu'] : ['cat', 'dan']
  for (const hd of steps) await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',$3,'go_tay')`, [mon, hd, sodv])
  return { don, mon }
}
const T = d => `current_date + ${d}`

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QNL','QT tải thử'),('QPU','QT pu thử')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values
    ('QNL',100,'{}','chung','cat','nguoi',0,0.5), ('QNL',200,'{100}','chung','dan','nguoi',0,0.5),
    ('QPU',100,'{}','chung','pu','nguoi',0,1.0)`)

  // ═══ 1 · KHOẢNG HIỆU LỰC CHỒNG NHAU BỊ CHẶN ═══
  console.log('\n── 1 · chèn 2 dòng nang_luc_to cùng tổ, thời gian chồng → BỊ TỪ CHỐI ──')
  // chèn khoảng chồng với dòng seed cnc [today,∞] — bọc savepoint để tx sống tiếp
  let chongErr = null
  await c.query('savepoint sp1')
  try { await c.query(`insert into kho.nang_luc_to(ma_to,tu_ngay,den_ngay,so_nguoi) values('cnc',current_date+5,current_date+10,3)`); await c.query('release savepoint sp1') }
  catch (e) { chongErr = e.message; await c.query('rollback to savepoint sp1') }
  console.log(`   chèn chồng cnc [+5,+10] (đã có [today,∞]) → ${chongErr ? 'TỪ CHỐI: ' + chongErr.split('\n')[0].slice(0, 60) : 'LỌT ❌'}`)
  ok('#1 khoảng chồng nhau → exclusion constraint CHẶN (🟥 lọt = ĐỎ)', !!chongErr && /exclu|overlap|nang_luc_to_khong_chong/i.test(chongErr))

  // ═══ 2 · TUYỂN THÊM GIỮA CHỪNG, KHÔNG SỬA LỊCH SỬ ═══
  console.log('\n── 2 · cnc 5 người tới 31/08, 7 người từ 01/09 → năng lực 2 tuần KHÁC nhau ──')
  await c.query(`update kho.nang_luc_to set den_ngay='2026-08-31' where ma_to='cnc' and den_ngay is null`)
  await c.query(`insert into kho.nang_luc_to(ma_to,tu_ngay,den_ngay,so_nguoi) values('cnc','2026-09-01',null,7)`)
  const wA = (await asK(CEO, `select gio_nen g from kho.nang_luc_to_tuan('cnc','2026-08-24','2026-08-31')`)).r[0].g
  const wB = (await asK(CEO, `select gio_nen g from kho.nang_luc_to_tuan('cnc','2026-09-01','2026-09-08')`)).r[0].g
  console.log(`   tuần cuối T8 (5 người) = ${wA} giờ · tuần đầu T9 (7 người) = ${wB} giờ`)
  ok('#2 hai thời kỳ → hai số khác (5→246.4 · 7→344.96) (🟥 bằng nhau = sửa lịch sử = ĐỎ)',
    near(wA, 246.4) && near(wB, 344.96) && !near(wA, wB))

  // ═══ 3 · TUẦN BẮC CẦU HAI KHOẢNG → TỶ LỆ NGÀY ═══
  console.log('\n── 3 · tuần 29/08–04/09: 3 ngày (5 người) + 4 ngày (7 người) → tỷ lệ ngày ──')
  const wBridge = (await asK(CEO, `select gio_nen g from kho.nang_luc_to_tuan('cnc','2026-08-29','2026-09-05')`)).r[0].g
  const kyVong = 246.4 * 3 / 7 + 344.96 * 4 / 7
  console.log(`   năng lực = ${wBridge} · kỳ vọng 246.4×3/7 + 344.96×4/7 = ${kyVong.toFixed(1)}`)
  ok('#3 bắc cầu tính theo TỶ LỆ NGÀY (🟥 lấy nguyên 1 khoảng = ĐỎ)',
    near(wBridge, kyVong, 0.6) && !near(wBridge, 246.4) && !near(wBridge, 344.96))

  // ═══ 4 · THIẾU NĂNG LỰC → BÁO, KHÔNG COI LÀ 0 ═══
  console.log('\n── 4 · xoá dòng năng lực tổ giường → THIEU_NANG_LUC, KHÔNG trả 0 ──')
  await c.query(`delete from kho.nang_luc_to where ma_to='giuong'`)
  const nlG = (await asK(CEO, `select to_jsonb(t) g from kho.nang_luc_to_tuan('giuong',current_date,current_date+7) t`)).r[0].g
  console.log(`   → ${JSON.stringify(nlG)}`)
  ok('#4 thiếu năng lực → gio_nen=NULL + thieu_nang_luc=true (🟥 trả 0 = ĐỎ)', nlG.gio_nen === null && nlG.thieu_nang_luc === true)

  // ═══ 7 · TỶ LỆ CHỐT CHƯA ĐỦ (chạy trên hệ PRISTINE, trước khi gieo báo giá) ═══
  console.log('\n── 7 · hệ chưa đủ 10 báo giá → TY_LE_CHOT_CHUA_DU, tầng 3 = 0 ──')
  const tl = await g1(`select kho.tai_theo_to_tuan(current_date, current_date+28) g`)
  console.log(`   ty_le_chot=${tl.ty_le_chot} · chua_du=${tl.ty_le_chot_chua_du}`)
  ok('#7 chưa đủ → cờ TY_LE_CHOT_CHUA_DU=true và ty_le=0 (🟥 bịa tỷ lệ = ĐỎ)', tl.ty_le_chot_chua_du === true && Number(tl.ty_le_chot) === 0)

  // ═══ 5 · BA TẦNG TÁCH RIÊNG ═══
  console.log('\n── 5 · 3 đơn ở 3 trạng thái → mỗi đơn vào ĐÚNG tầng ──')
  // gieo 12 đơn đã giao có báo giá (đều chốt) → ty_le>0 để tầng 3 hiện số
  for (let i = 0; i < 12; i++) await q(`insert into kho.don_hang(ma_don,trang_thai,ngay_tao_bao_gia) values($1,'da_giao',now()-interval '10 days')`, ['T78-BG' + i])
  await donQ('T78-T1', 'dang_lam', '2026-01-01'); await c.query(`update kho.don_hang set ngay_hen_khach=current_date+3 where ma_don='T78-T1'`)
  await donQ('T78-T2', 'xong_file', '2026-01-01'); await c.query(`update kho.don_hang set ngay_hen_khach=current_date+3 where ma_don='T78-T2'`)
  await donQ('T78-T3', 'bao_gia', '2026-01-01'); await c.query(`update kho.don_hang set ngay_hen_khach=current_date+3 where ma_don='T78-T3'`)
  const tl5 = await g1(`select kho.tai_theo_to_tuan(current_date, current_date+28) g`)
  const w0 = (tl5.tuan || [])[0]
  const oCnc0 = (tl5.o || []).find(x => x.ma_to === 'cnc' && x.tuan_bat_dau === w0)
  console.log(`   ty_le=${tl5.ty_le_chot} · ô cnc tuần 0: t1=${oCnc0.t1_dang_lam} t2=${oCnc0.t2_da_chot} t3=${oCnc0.t3_bao_gia}`)
  ok('#5 ba tầng TÁCH riêng, mỗi đơn đúng tầng (t1>0·t2>0·t3>0, không gộp) (🟥 gộp = ĐỎ)',
    Number(oCnc0.t1_dang_lam) >= 5 && Number(oCnc0.t2_da_chot) >= 5 && Number(oCnc0.t3_bao_gia) > 0)

  // ═══ 6 · ĐƠN KHÔNG HẠN KHÔNG BỊ BỎ IM LẶNG ═══
  console.log('\n── 6 · đơn ngay_hen_khach NULL → nhóm "chưa có hạn", có đếm ──')
  await donQ('T78-NOHAN', 'dang_lam', null)
  const tl6 = await g1(`select kho.tai_theo_to_tuan(current_date, current_date+28) g`)
  console.log(`   chua_co_han: ${JSON.stringify(tl6.chua_co_han)}`)
  ok('#6 đơn không hạn hiện ở "chưa có hạn" + có đếm (🟥 bỏ im lặng = ĐỎ)', Number(tl6.chua_co_han.t1_don) >= 1 && Number(tl6.chua_co_han.t1_gio) > 0)

  // ═══ 8 · QUÁ TẢI TÍNH ĐÚNG ═══
  console.log('\n── 8 · dựng tải vượt năng lực son_pu (197.1/tuần) → tai_qua_tai đúng ──')
  await donQ('T78-OVL', 'dang_lam', '2026-01-01', 'QPU', 250)  // pu 250 giờ > 197.1
  await c.query(`update kho.don_hang set ngay_hen_khach=current_date+3 where ma_don='T78-OVL'`)
  const qt = await g1(`select kho.tai_qua_tai(current_date, current_date+28) g`)
  const spu = (qt.o || []).find(x => x.ma_to === 'son_pu')
  console.log(`   son_pu quá tải: cần=${spu?.can_gio} có=${spu?.co_gio} thiếu=${spu?.thieu_gio} người-tuần=${spu?.thieu_nguoi_tuan}`)
  const mathOk = spu && near(Number(spu.can_gio) - Number(spu.co_gio), Number(spu.thieu_gio), 0.2)
    && near(Number(spu.thieu_nguoi_tuan), Number(spu.thieu_gio) / (8 * 7 * 0.88), 0.01)
  ok('#8 quá tải: đúng tổ + đúng giờ thiếu + đúng người-tuần (thiếu÷49.28) (🟥 sai = ĐỎ)',
    !!spu && Number(spu.thieu_gio) > 50 && mathOk)

  console.log(`\n══ KẾT QUẢ 078: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
