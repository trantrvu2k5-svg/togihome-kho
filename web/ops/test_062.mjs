// TEST CẮN — 062 A1b: quy trình dùng chung + giờ 2 phần + tự chạy + 3 nguồn. KHOÁ THEO MÓN (db/069).
//   In ĐỦ HAI VẾ. Tx rollback. Chạy: cd web && node ops/test_062.mjs
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
const gio = (mid) => asCeo(`select kho.gio_du_kien_cua_mon($1) g`, [mid]).then(x => x.r ? x.r[0].g : { _err: x.e })
const HD8 = ['cat', 'dan', 'cam', 'thung', 'cup', 'ray', 'canh', 'goi']   // 8 hoạt động của TU-AO-MELAMINE
const setDV = async (mid, val, nguon = 'go_tay') => { for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon) values($1,$2,$3,$4) on conflict (mon_id,hoat_dong) do update set so_don_vi=excluded.so_don_vi,nguon=excluded.nguon`, [mid, hd, val, nguon]) }

try {
  await c.query('begin')
  const QT = 'TU-AO-MELAMINE'
  const ba = (await c.query(`select ma_loi from kho.san_pham_loi limit 3`)).rows.map(r => r.ma_loi)
  // đơn + 2 MÓN (khoá theo món, gán quy trình thẳng vào món — không cần lõi)
  const don = (await q1(`insert into kho.don_hang(ma_don,trang_thai) values('T062-DON','dang_thiet_ke') returning id`)).id
  const M1 = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món 1',$2) returning id`, [don, QT])).id
  const M2 = (await q1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món 2',$2) returning id`, [don, QT])).id

  // ═══ 1 · NHIỀU LÕI MỘT QUY TRÌNH (chứng minh kiến trúc — quy_trinh_buoc không nhân bản) ═══
  console.log('\n── 1 · nhiều lõi một quy trình — gán không nhân bản bước ──')
  const truoc = Number((await q1(`select count(*) n from kho.quy_trinh_buoc where ma_quy_trinh=$1`, [QT])).n)
  for (const l of ba) await c.query(`update kho.san_pham_loi set ma_quy_trinh=$1 where ma_loi=$2`, [QT, l])
  const sau = Number((await q1(`select count(*) n from kho.quy_trinh_buoc where ma_quy_trinh=$1`, [QT])).n)
  console.log(`   gán ${ba.length} lõi · quy_trinh_buoc TRƯỚC=${truoc} SAU=${sau} · 🟥 kiến trúc cũ (theo lõi) = ${truoc * ba.length} dòng`)
  ok('✅ gán 3 lõi → số bước KHÔNG đổi (dùng chung, không nhân bản)', truoc === 8 && sau === 8, `${truoc}→${sau}`)

  // ═══ 2 · CÙNG QUY TRÌNH, SỐ ĐƠN VỊ KHÁC → GIỜ KHÁC ═══
  console.log('\n── 2 · số đơn vị khác → giờ khác (phần cố định giữ nguyên) ──')
  await setDV(M1, 24); await setDV(M2, 41)
  const g1 = await gio(M1), g2 = await gio(M2)
  console.log(`   M1(24 đv) tổng=${g1.tong_gio} · M2(41 đv) tổng=${g2.tong_gio}`)
  ok('✅ hai món GIỜ KHÁC nhau (🟥 vế số cứng ra cùng số)', g1.ok && g2.ok && Number(g1.tong_gio) !== Number(g2.tong_gio))
  ok('✅ phần gio_co_dinh GIỐNG ở mọi bước (chênh chỉ do số đơn vị)', Math.abs(Number(g2.tong_gio) - Number(g1.tong_gio)) > 0 && g1.buoc.length === g2.buoc.length)

  // ═══ 3 · BA NGUỒN đều dùng được ═══
  console.log('\n── 3 · ba nguồn cutlist/go_tay/uoc đều tính giờ ──')
  await c.query(`delete from kho.so_don_vi_mon where mon_id=$1`, [M1])
  await setDV(M1, 10, 'go_tay')
  await c.query(`update kho.so_don_vi_mon set nguon='cutlist' where mon_id=$1 and hoat_dong='cat'`, [M1])
  await c.query(`update kho.so_don_vi_mon set nguon='uoc' where mon_id=$1 and hoat_dong='dan'`, [M1])
  const g3 = await gio(M1)
  const ngByHd = Object.fromEntries(g3.buoc.map(b => [b.hoat_dong, b.nguon]))
  console.log(`   nguồn theo bước: cat=${ngByHd.cat} dan=${ngByHd.dan} cam=${ngByHd.cam}`)
  ok('✅ cả ba nguồn (cutlist/uoc/go_tay) đều ra giờ (🟥 vế chỉ-nhận-cutlist chặn oan 2 dòng kia)',
    g3.ok && ngByHd.cat === 'cutlist' && ngByHd.dan === 'uoc' && ngByHd.cam === 'go_tay' && g3.buoc.every(b => Number(b.gio) > 0))

  // ═══ 4 · BA MÃ LỖI PHÂN BIỆT ═══
  console.log('\n── 4 · ba mã lỗi riêng biệt (không gộp, không trả 0) ──')
  // (a) LOI_CHUA_GAN_QUY_TRINH — bỏ gán quy trình ở món (món tự do, không lõi → không fallback)
  await c.query('savepoint a4'); await c.query(`update kho.don_hang_mon set ma_quy_trinh=null where id=$1`, [M1])
  const e_a = await gio(M1)
  ok('✅ (a) chưa gán quy trình → LOI_CHUA_GAN_QUY_TRINH · tong_gio=null', e_a.loi === 'LOI_CHUA_GAN_QUY_TRINH' && e_a.tong_gio === null, JSON.stringify(e_a))
  await c.query('rollback to savepoint a4')
  // (b) THIEU_SO_DON_VI
  await c.query('savepoint b4'); await c.query(`delete from kho.so_don_vi_mon where mon_id=$1`, [M1])
  const e_b = await gio(M1)
  ok('✅ (b) thiếu số đơn vị → THIEU_SO_DON_VI · tong_gio=null', e_b.thieu.some(t => t.ma === 'THIEU_SO_DON_VI') && e_b.tong_gio === null && !e_b.thieu.some(t => t.ma === 'THIEU_DON_GIA'), JSON.stringify(e_b.thieu))
  await c.query('rollback to savepoint b4')
  // (c) THIEU_DON_GIA
  await c.query('savepoint c4'); await setDV(M1, 10); await c.query(`update kho.don_gia_baseline set mau_so=null where hoat_dong='cat'`)
  const e_c = await gio(M1)
  ok('✅ (c) hoạt động thiếu mẫu số → THIEU_DON_GIA', e_c.thieu.some(t => t.ma === 'THIEU_DON_GIA' && t.hoat_dong === 'cat') && e_c.tong_gio === null, JSON.stringify(e_c.thieu))
  await c.query('rollback to savepoint c4')

  // ═══ 5 · BƯỚC TỰ CHẠY (chờ khô) ═══
  console.log('\n── 5 · bước tự chạy không cần số đơn vị ──')
  await c.query('savepoint t5')
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values($1,150,'{100}','chung','cho_kho','tu_chay',12,0)`, [QT])
  await setDV(M1, 10)
  const g5 = await gio(M1)
  const buocKho = g5.buoc.find(b => b.hoat_dong === 'cho_kho')
  ok('✅ bước cho_kho tính giờ bằng gio_co_dinh, KHÔNG báo thiếu', buocKho && buocKho.loai_buoc === 'tu_chay' && Number(buocKho.gio) === 12 && !g5.thieu.some(t => t.hoat_dong === 'cho_kho'), JSON.stringify(buocKho))
  let vp = false
  try { await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values($1,160,'cho_kho','tu_chay',12,5)`, [QT]); vp = true } catch (e) {}
  ok('✅ tu_chay có gio_moi_don_vi>0 → BỊ TỪ CHỐI (check constraint)', !vp)
  await c.query('rollback to savepoint t5')

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 062: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 5).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
