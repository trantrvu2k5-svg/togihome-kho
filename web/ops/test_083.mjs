// TEST CẮN — 083 · gio_don_da_tinh (materialize) + trigger đồng bộ + phân trang. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { const x = await c.query(s, a); r = x.rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gio = async (md, to = null) => q(`select ma_to, round(gio,2) gio from kho.gio_don_da_tinh where ma_don=$1 and moc='chuan'${to ? ` and ma_to='${to}'` : ''} order by ma_to`, [md])

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QX','q')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values('QX',100,'{}','chung','cat','nguoi',0,0.5)`)
  const mk = async (ma, chot = false) => {
    const don = (await q(`insert into kho.don_hang(ma_don,trang_thai) values($1,'dang_lam') returning id`, [ma]))[0].id
    const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'m','QX') returning id`, [don]))[0].id
    await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon,chot_luc,gio_moi_don_vi_chot,gio_co_dinh_chot)
       values($1,'cat','chuan',10,'go_tay',${chot ? `now(),0.5,0` : `null,null,null`})`, [mon])
    return { don, mon }
  }

  // ═══ 3 · SỬA SỐ ĐƠN VỊ → GIỜ ĐỔI NGAY (trigger, không gọi tay) ═══
  console.log('\n── 3 · đổi so_don_vi → gio_don_da_tinh đổi ngay (chống sai im lặng) ──')
  const A = await mk('X83-A')
  const g3a = (await gio('X83-A', 'cnc'))[0]   // trigger đã tính lúc insert so_don_vi
  await c.query(`update kho.so_don_vi_mon set so_don_vi=20 where mon_id=$1 and hoat_dong='cat' and moc='chuan'`, [A.mon])
  const g3b = (await gio('X83-A', 'cnc'))[0]   // KHÔNG gọi dung_lai tay
  console.log(`   so_don_vi 10→20 · gio cnc: ${g3a?.gio} → ${g3b?.gio}`)
  ok('#3 sửa số → giờ ĐỔI ngay không gọi tay (🟥 không đổi = sai im lặng = ĐỎ)', Number(g3a.gio) === 5 && Number(g3b.gio) === 10)

  // ═══ 4 · SỬA PHÚT QUY TRÌNH → chưa bàn giao ĐỔI, đã bàn giao GIỮ NGUYÊN (QD-16) ═══
  console.log('\n── 4 · sửa phút quy trình: đơn chưa bàn giao đổi · đơn đã bàn giao giữ nguyên ──')
  const B = await mk('X83-B', false)  // chưa bàn giao
  const D = await mk('X83-D', true)   // đã bàn giao (chốt)
  const b0 = (await gio('X83-B', 'cnc'))[0].gio, d0 = (await gio('X83-D', 'cnc'))[0].gio
  await c.query(`update kho.quy_trinh_buoc set gio_moi_don_vi=1.0 where ma_quy_trinh='QX' and thu_tu=100`)  // phút ×2
  const b1 = (await gio('X83-B', 'cnc'))[0].gio, d1 = (await gio('X83-D', 'cnc'))[0].gio
  console.log(`   chưa bàn giao B: ${b0}→${b1} · đã bàn giao D: ${d0}→${d1}`)
  ok('#4 sửa phút: B ĐỔI (5→10) · D GIỮ NGUYÊN (5→5) (🟥 D đổi = đụng đơn chốt = ĐỎ)',
    Number(b0) === 5 && Number(b1) === 10 && Number(d0) === 5 && Number(d1) === 5)

  // ═══ 2 · DỰNG LẠI từ nguồn = y hệt ═══
  console.log('\n── 2 · xoá sạch gio_don_da_tinh → dung_lai_gio_tat_ca() → y hệt ──')
  const truoc = await q(`select ma_don, ma_to, moc, round(gio,4) gio from kho.gio_don_da_tinh order by ma_don, ma_to, moc`)
  const rb = await asK(CEO, `select kho.dung_lai_gio_tat_ca() g`)
  const sau = await q(`select ma_don, ma_to, moc, round(gio,4) gio from kho.gio_don_da_tinh order by ma_don, ma_to, moc`)
  console.log(`   dung_lai ghi ${rb.r[0].g} đơn · trước ${truoc.length} dòng / sau ${sau.length} · GIỐNG HỆT: ${JSON.stringify(truoc) === JSON.stringify(sau)}`)
  ok('#2 dựng lại từ nguồn = y hệt (🟥 lệch 1 dòng = ĐỎ)', JSON.stringify(truoc) === JSON.stringify(sau) && truoc.length > 0)

  // ═══ 5 · PHÂN TRANG ═══
  console.log('\n── 5 · kanban_xuong(gioi_han=50, bo_qua=100) → 50 dòng + tong_so đúng ──')
  for (let i = 0; i < 160; i++) await c.query(`insert into kho.don_hang(ma_don,trang_thai) values($1,'dang_lam')`, ['PG-' + i])
  const tongThat = Number((await q(`select count(*) n from kho.don_hang where trang_thai in ('cho_cat','da_cat','dang_lam','xong_sx','cho_giao')`))[0].n)
  const kb = await asK(CEO, `select * from kho.kanban_xuong(50, 100)`)
  const tongTraVe = kb.r.length ? Number(kb.r[0].tong_so) : null
  console.log(`   trả ${kb.r.length} dòng · tong_so=${tongTraVe} · tổng thật=${tongThat}`)
  ok('#5 phân trang: đúng 50 dòng + tong_so = tổng thật (🟥 sai = ĐỎ)', kb.r.length === 50 && tongTraVe === tongThat)

  console.log(`\n══ KẾT QUẢ 083: ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
