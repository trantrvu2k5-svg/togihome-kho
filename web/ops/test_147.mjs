// TEST PHẢI CẮN — WP-37 tầng 1b (db/147, QD-63): ghi_san_luong_don +tk_ban_hang · day_tem_ban_ve chặn bao_gia*.
//   as(uid) = set role authenticated + jwt claims sub=uid → GIỐNG HỆT Bearer JWT plugin gọi (0c). KHÔNG GUC/service-key.
//   Tx KHÔNG commit → rollback → 0 dấu vết. DEMO- (la_demo).
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
const before = {
  dh: (await one('select count(*) n from kho.don_hang')).n,
  bom: (await one('select count(*) n from kho.don_hang_mon_bom')).n,
  sl: (await one('select count(*) n from kho.san_luong_don')).n,
}
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1`, [v])).a
const U = { tkbh: await uid('tk_ban_hang'), sale: await uid('sale'), ceo: await uid('ceo') }
const VT = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and ngung_dung=false order by ma limit 1`)).id
const dongBom = (vt, sl) => JSON.stringify([{ vat_tu_id: vt, so_luong: sl, don_vi: 'tam', hoat_dong: null }])
const drv = JSON.stringify({ cat: 5, dan: 2, cam: 1, lot: 0, pu: 0, cup: 4, thung: 6, ray: 0, canh: 4, goi: 1, son_canh: 0, giuong_lap: 0 })
async function mkDon(sfx) {
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO wp37b',true,'le','bao_gia','khac') returning id`, ['DEMO-WP37B-' + sfx])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,$2,'KE-HO-MELAMINE',false) returning id`, [don, 'món ' + sfx])).id
  return { don, mon, ma_don: 'DEMO-WP37B-' + sfx }
}
const A = await mkDon('A')

// 1 · tk_ban_hang ghi_san_luong_don trên đơn bao_gia → ghi được
{ const r = await as(U.tkbh, `select kho.ghi_san_luong_don($1,$2::jsonb) d`, [A.ma_don, drv], true)
  const sl = await one(`select cat, thung from kho.san_luong_don where ma_don=$1`, [A.ma_don])
  ok('1 · tk_ban_hang ghi_san_luong_don (bao_gia) → ghi', !r.e && sl && Number(sl.cat) === 5, r.e || JSON.stringify(sl)) }

// 2 · tk_ban_hang bom_ma_kho_ds → đọc được
{ const r = await as(U.tkbh, `select count(*) n from kho.bom_ma_kho_ds()`)
  ok('2 · tk_ban_hang bom_ma_kho_ds → đọc được', !r.e, r.e) }

// 3 · tk_ban_hang day_tem_ban_ve trên đơn bao_gia → CHẶN (BÁO GIÁ / thiết-kế-bán-hàng)
{ const r = await as(U.tkbh, `select kho.day_tem_ban_ve($1,'[]'::jsonb)`, [A.ma_don])
  ok('3 · tk_ban_hang day_tem_ban_ve (bao_gia) → chặn', /BÁO GIÁ|thiết kế bán hàng|báo giá/.test(r.e || ''), r.e || 'KHÔNG chặn') }

// 4 · NULL/anon gọi 3 hàm GHI → chặn
{ const r1 = await as(null, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb)`, [A.mon, dongBom(VT, 1)])
  const r2 = await as(null, `select kho.ghi_gia_von_don($1,1,1,1,3)`, [A.ma_don])
  const r3 = await as(null, `select kho.ghi_san_luong_don($1,$2::jsonb)`, [A.ma_don, drv])
  ok('4 · vai NULL gọi 3 hàm GHI → chặn', !!r1.e && !!r2.e && !!r3.e, `${r1.e}|${r2.e}|${r3.e}`) }

// 5 · sale gọi 3 hàm GHI → chặn
{ const r1 = await as(U.sale, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb)`, [A.mon, dongBom(VT, 1)])
  const r2 = await as(U.sale, `select kho.ghi_gia_von_don($1,1,1,1,3)`, [A.ma_don])
  const r3 = await as(U.sale, `select kho.ghi_san_luong_don($1,$2::jsonb)`, [A.ma_don, drv])
  ok('5 · vai sale gọi 3 hàm GHI → chặn', !!r1.e && !!r2.e && !!r3.e, `${r1.e}|${r2.e}|${r3.e}`) }

// 6 · CHUỖI THẬT (đúng thứ tự + đúng auth JWT plugin): don_cho_thiet_ke → ghi_bom_mon → ghi_gia_von_don → ghi_san_luong_don → bom_ma_kho_ds
async function chuoi(tag) {
  const steps = {}
  let r
  r = await as(U.tkbh, `select ma_don, trang_thai from kho.don_cho_thiet_ke() where ma_don=$1`, [A.ma_don], true); steps.don_cho_thiet_ke = r.e || (r.r.length === 1 ? 'OK(' + r.r[0].trang_thai + ')' : 'RỖNG')
  r = await as(U.tkbh, `select kho.ghi_bom_mon($1,'cutlist',$2::jsonb) n`, [A.mon, dongBom(VT, 5)], true); steps.ghi_bom_mon = r.e || 'OK'
  r = await as(U.tkbh, `select kho.ghi_gia_von_don($1,100,200,300,600) d`, [A.ma_don], true); steps.ghi_gia_von_don = r.e || 'OK'
  r = await as(U.tkbh, `select kho.ghi_san_luong_don($1,$2::jsonb) d`, [A.ma_don, drv], true); steps.ghi_san_luong_don = r.e || 'OK'
  r = await as(U.tkbh, `select count(*) n from kho.bom_ma_kho_ds()`); steps.bom_ma_kho_ds = r.e || 'OK(' + (r.r ? r.r[0].n : '?') + ' dòng)'
  return steps
}
{ const s = await chuoi('lần 1')
  console.log('   ↳ chuỗi:', Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' · '))
  ok('6 · CHUỖI THẬT (5 bước, auth JWT tk_ban_hang) chạy trọn', Object.values(s).every(v => /OK/.test(String(v)))) }

// 7 · sau chuỗi: giữ chỗ 0 · trang_thai bao_gia · tem 0 · BOM du_kien
{ const giu = (await one(`select count(*) n from kho.giu_cho g join kho.don_hang_mon m on m.id=g.don_hang_mon_id where m.don_id=$1`, [A.don])).n
  const tt = (await one(`select trang_thai from kho.don_hang where id=$1`, [A.don])).trang_thai
  const tem = (await one(`select count(*) n from kho.tem_ban_ve where ma_don=$1`, [A.ma_don])).n
  const bomMoc = (await q(`select distinct moc from kho.don_hang_mon_bom where mon_id=$1`, [A.mon])).map(x => x.moc)
  ok('7 · sau chuỗi: giữ chỗ=0 · tt=bao_gia · tem=0 · BOM=du_kien', Number(giu) === 0 && tt === 'bao_gia' && Number(tem) === 0 && bomMoc.length === 1 && bomMoc[0] === 'du_kien', `giu=${giu} tt=${tt} tem=${tem} moc=${bomMoc}`) }

// 8 · chạy lại chuỗi lần 2 → ghi đè, không nhân đôi
{ const bomTruoc = (await one(`select count(*) n from kho.don_hang_mon_bom where mon_id=$1`, [A.mon])).n
  const slTruoc = (await one(`select count(*) n from kho.san_luong_don where ma_don=$1`, [A.ma_don])).n
  await chuoi('lần 2')
  const bomSau = (await one(`select count(*) n from kho.don_hang_mon_bom where mon_id=$1`, [A.mon])).n
  const slSau = (await one(`select count(*) n from kho.san_luong_don where ma_don=$1`, [A.ma_don])).n
  ok('8 · chạy lại chuỗi → ghi đè (BOM ' + bomTruoc + '→' + bomSau + ', san_luong ' + slTruoc + '→' + slSau + '), không nhân đôi',
    bomTruoc === bomSau && slTruoc === slSau && Number(slSau) === 1) }

await c.query('rollback')
const after = {
  dh: (await one('select count(*) n from kho.don_hang')).n,
  bom: (await one('select count(*) n from kho.don_hang_mon_bom')).n,
  sl: (await one('select count(*) n from kho.san_luong_don')).n,
}
console.log(`\n── DỌN: trước {dh:${before.dh},bom:${before.bom},sl:${before.sl}} vs sau {dh:${after.dh},bom:${after.bom},sl:${after.sl}}`)
ok('DỌN · 0 dòng rác (rollback tx)', before.dh === after.dh && before.bom === after.bom && before.sl === after.sl)
console.log(`\nKẾT QUẢ test_147: ${P} pass / ${F} fail`)
await c.end()
process.exit(F ? 1 : 0)
