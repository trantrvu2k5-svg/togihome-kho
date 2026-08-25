// TEST PHẢI CẮN — WP-37 tầng 1 (db/146, QD-63): mở cửa báo giá cho plugin + vai tk_ban_hang + gác chuan-ở-bao_gia.
//   Tx KHÔNG commit → rollback ở c.end() → 0 dấu vết. Dữ liệu DEMO- (la_demo).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}

await c.query('begin')
// ── đếm số dòng TRƯỚC (chứng minh 0 rác cuối) ──
const before = {
  dh: (await one('select count(*) n from kho.don_hang')).n,
  bom: (await one('select count(*) n from kho.don_hang_mon_bom')).n,
  gv: (await one('select count(*) n from kho.don_hang_gia_von')).n,
}

// ── tài khoản theo vai ──
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1`, [v])).a
const U = { tkbh: await uid('tk_ban_hang'), sale: await uid('sale'), ceo: await uid('ceo'), tk: await uid('thiet_ke') }

// ── DỰNG đơn DEMO bao_gia + món + BOM (setup qua postgres, persist trong tx) ──
async function mkDon(sfx, tt) {
  const lyDo = tt === 'bao_gia_thua' ? 'khac' : null
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach,ly_do_thua) values($1,'DEMO wp37',true,'le',$2,'khac',$3) returning id`, ['DEMO-WP37-' + sfx, tt, lyDo])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,$2,'KE-HO-MELAMINE',false) returning id`, [don, 'món ' + sfx])).id
  return { don, mon, ma_don: 'DEMO-WP37-' + sfx }
}
const VT = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and ngung_dung=false order by ma limit 1`)).id
const dongBom = (vt, sl) => JSON.stringify([{ vat_tu_id: vt, so_luong: sl, don_vi: 'tam', hoat_dong: null }])

const A = await mkDon('A', 'bao_gia')   // đơn báo giá chính

// 1 · tk_ban_hang THẤY đơn bao_gia trong don_cho_thiet_ke
{ const r = await as(U.tkbh, `select ma_don, trang_thai from kho.don_cho_thiet_ke() where ma_don=$1`, [A.ma_don])
  ok('1 · tk_ban_hang thấy đơn bao_gia (don_cho_thiet_ke, có cột trang_thai)', !r.e && r.r.length === 1 && r.r[0].trang_thai === 'bao_gia', r.e || JSON.stringify(r.r)) }

// 2 · tk_ban_hang ĐẨY BOM đơn bao_gia → ghi, moc='du_kien'
{ const r = await as(U.tkbh, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [A.mon, dongBom(VT, 5)], true)
  const rows = await q(`select moc, so_luong from kho.don_hang_mon_bom where mon_id=$1`, [A.mon])
  ok('2 · tk_ban_hang đẩy BOM bao_gia → ghi moc=du_kien', !r.e && rows.length === 1 && rows[0].moc === 'du_kien', r.e || JSON.stringify(rows)) }

// 3 · tk_ban_hang ĐẨY GIÁ VỐN đơn bao_gia → ghi
{ const r = await as(U.tkbh, `select kho.ghi_gia_von_don($1,100,200,300,600) d`, [A.ma_don], true)
  const g = await one(`select ma_don, khoi_1 from kho.don_hang_gia_von where ma_don=$1`, [A.ma_don])
  ok('3 · tk_ban_hang đẩy giá vốn bao_gia → ghi', !r.e && g && Number(g.khoi_1) === 100, r.e || JSON.stringify(g)) }

// 4 · vai sale gọi 3 hàm → CHẶN
{ const r1 = await as(U.sale, `select * from kho.don_cho_thiet_ke()`)
  const r2 = await as(U.sale, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb)`, [A.mon, dongBom(VT, 1)])
  const r3 = await as(U.sale, `select kho.ghi_gia_von_don($1,1,1,1,3)`, [A.ma_don])
  ok('4 · sale bị chặn cả 3 hàm', /chỉ ceo|tk_ban_hang/.test(r1.e || '') && /chỉ|tk_ban_hang/.test(r2.e || '') && /chỉ|tk_ban_hang/.test(r3.e || ''), `${r1.e}|${r2.e}|${r3.e}`) }

// 5 · vai NULL (chưa đăng nhập) → CHẶN
{ const r = await as(null, `select * from kho.don_cho_thiet_ke()`)
  const r2 = await as(null, `select kho.ghi_gia_von_don($1,1,1,1,3)`, [A.ma_don])
  ok('5 · vai NULL bị chặn', !!r.e && !!r2.e, `${r.e}|${r2.e}`) }

// 6 · ÉP moc='chuan' khi đơn đang bao_gia → RAISE (trigger chan_bom_chuan_bao_gia — cắn mọi role, kể cả owner)
{ let e6 = null; await c.query('savepoint s6')
  try { await c.query(`update kho.don_hang_mon_bom set moc='chuan' where mon_id=$1`, [A.mon]) } catch (x) { e6 = x.message }
  await c.query('rollback to savepoint s6')
  ok('6 · ép moc=chuan ở đơn bao_gia → RAISE', /BOM_BAO_GIA_CHI_DU_KIEN/.test(e6 || ''), e6 || 'KHÔNG raise') }

// 7 · sau đẩy ở bao_gia: giữ chỗ 0 · trạng thái vẫn bao_gia · tem 0
{ const giu = (await one(`select count(*) n from kho.giu_cho g join kho.don_hang_mon m on m.id=g.don_hang_mon_id where m.don_id=$1`, [A.don])).n
  const tt = (await one(`select trang_thai from kho.don_hang where id=$1`, [A.don])).trang_thai
  const tem = (await one(`select count(*) n from kho.tem_ban_ve where ma_don=$1`, [A.ma_don])).n
  ok('7 · sau đẩy: giữ chỗ=0 · trạng thái=bao_gia · tem=0', Number(giu) === 0 && tt === 'bao_gia' && Number(tem) === 0, `giu=${giu} tt=${tt} tem=${tem}`) }

// 8 · đơn bao_gia đã đẩy → gia_von_don_ds KHÔNG chứa (loại bao_gia* tại nguồn)
{ const r = await as(U.ceo, `select kho.gia_von_don_ds(500,0,true) j`)
  const has = !r.e && JSON.stringify(r.r[0].j || {}).includes(A.ma_don)
  ok('8 · gia_von_don_ds KHÔNG chứa đơn bao_gia', !r.e && !has, r.e || 'chứa đơn bao_gia') }

// 9 · đơn bao_gia_thua KHÔNG hiện ở don_cho_thiet_ke
{ const T = await mkDon('THUA', 'bao_gia_thua')
  const r = await as(U.tkbh, `select ma_don from kho.don_cho_thiet_ke() where ma_don=$1`, [T.ma_don])
  ok('9 · bao_gia_thua KHÔNG hiện ở don_cho_thiet_ke', !r.e && r.r.length === 0, r.e || JSON.stringify(r.r)) }

// 10 · ĐƯỜNG DÀI: bao_gia (có BOM du_kien) → moi_len_don → chốt số → ban_giao_xuong → BOM thành chuan (KHÔNG nhân đôi)
{ const bomTruoc = await q(`select id, moc, chot_luc from kho.don_hang_mon_bom where mon_id=$1 order by id`, [A.mon])
  const ceoNs = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [U.ceo])).id
  // SETUP (không phải phần test): đưa đơn tới trạng thái sẵn-bàn-giao qua replica (tắt trigger chuyển-trạng-thái).
  await c.query("set session_replication_role='replica'")
  await c.query(`update kho.don_hang_mon set gia=1000000 where id=$1`, [A.mon])
  await c.query(`update kho.don_hang set nguon_khach='khac', ma_ns_thiet_ke=$2, trang_thai='dang_thiet_ke' where id=$1`, [A.don, ceoNs])
  const buoc = await q(`select distinct hoat_dong from kho.quy_trinh_buoc where ma_quy_trinh='KE-HO-MELAMINE' and loai_buoc<>'tu_chay'`)
  for (const b of buoc) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,moc) values($1,$2,10,'10','go_tay','chuan') on conflict do nothing`, [A.mon, b.hoat_dong])
  await c.query("set session_replication_role='origin'")
  // TEST THẬT: ban_giao_xuong (trigger bật) — phải promote BOM du_kien→chuan
  const fileCat = JSON.stringify([{ loai_file: 'cutlist', duong_dan: 'demo/wp37.dxf', ten_goc: 'wp37.dxf', co_byte: 1 }])
  const rBG = await as(U.ceo, `select kho.ban_giao_xuong($1,$2::jsonb,null)`, [A.ma_don, fileCat], true)
  const bomSau = await q(`select id, moc, chot_luc from kho.don_hang_mon_bom where mon_id=$1 order by id`, [A.mon])
  const chuan = bomSau.filter(x => x.moc === 'chuan' && x.chot_luc)
  ok('10 · đường dài: BOM du_kien→chuan (moc trước=' + bomTruoc.map(x => x.moc).join(',') + ' sau=' + bomSau.map(x => x.moc).join(',') + '), KHÔNG nhân đôi',
    !rBG.e && bomSau.length === bomTruoc.length && chuan.length === bomTruoc.length, rBG.e || `truoc=${bomTruoc.length} sau=${bomSau.length}`)

  // 11 · đẩy lại sau khi đã chuan → BOM_DA_CHOT
  const r11 = await as(U.tkbh, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb)`, [A.mon, dongBom(VT, 9)])
  ok('11 · đẩy lại sau chuan → BOM_DA_CHOT', /BOM_DA_CHOT/.test(r11.e || ''), r11.e || 'KHÔNG raise')
}

// ── ROLLBACK toàn bộ → 0 dấu vết ──
await c.query('rollback')
const after = {
  dh: (await one('select count(*) n from kho.don_hang')).n,
  bom: (await one('select count(*) n from kho.don_hang_mon_bom')).n,
  gv: (await one('select count(*) n from kho.don_hang_gia_von')).n,
}
console.log(`\n── DỌN: trước {dh:${before.dh},bom:${before.bom},gv:${before.gv}} vs sau {dh:${after.dh},bom:${after.bom},gv:${after.gv}}`)
ok('DỌN · 0 dòng rác (rollback tx)', before.dh === after.dh && before.bom === after.bom && before.gv === after.gv)
console.log(`\nKẾT QUẢ test_146: ${P} pass / ${F} fail`)
await c.end()
process.exit(F ? 1 : 0)
