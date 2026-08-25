// TEST PHẢI CẮN — WP-06 tầng 2a (db/149, QD-65): doi_trang_thai_don nhận da_giao qua cổng.
//   da_giao: vai sale/ke_toan/ceo, CHỈ từ cho_giao; dấu vết tự ghi don_hang_nhat_ky (trg_ghi_nk_don).
//   as(uid) = Bearer JWT client. Setup replica (tắt trigger). Tx rollback → 0 rác. KHÔNG chạm T8-001.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const tt = async id => (await one('select trang_thai from kho.don_hang where id=$1', [id])).trang_thai
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}

await c.query('begin')
const before = (await one('select count(*)::int n from kho.don_hang')).n
const uid = async v => (await one('select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1', [v]))?.a
const U = { sale: await uid('sale'), ke_toan: await uid('ke_toan'), xuong: await uid('xuong'), tho: await uid('tho') }
const TH = (await one('select ma from kho.thuong_hieu limit 1')).ma

await c.query("set session_replication_role='replica'")
let seq = 0
async function mkDon(trang_thai) {
  seq++
  return (await one("insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach,thuong_hieu) values($1,'DEMO wp06c',true,'le',$2,'gioi_thieu',$3) returning id",
    ['DEMO-WP06C-' + seq, trang_thai, TH])).id
}
const CG = await mkDon('cho_giao')     // sale → da_giao
const CG2 = await mkDon('cho_giao')    // ke_toan → da_giao
const BG = await mkDon('bao_gia')      // bao_gia → da_giao CHẶN
const CC = await mkDon('cho_cat')      // cho_cat → da_giao CHẶN
const DG = await mkDon('da_giao')      // đã da_giao gọi lại CHẶN
const CGx = await mkDon('cho_giao')    // cho ca cho_cat CHẶN (đích cho_cat)
await c.query("set session_replication_role='origin'")

// ═══ ĐẠT ═══
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2) j', [CG, 'da_giao'], true)
  const nk = await one("select nguoi_id, den from kho.don_hang_nhat_ky where don_id=$1 and den='da_giao' order by luc desc limit 1", [CG])
  const saleNd = (await one('select id from kho.nguoi_dung where auth_uid=$1', [U.sale])).id
  ok('1 · sale: cho_giao → da_giao + dấu vết ĐÚNG người (don_hang_nhat_ky)',
    !r.e && (await tt(CG)) === 'da_giao' && nk && nk.nguoi_id === saleNd, r.e || JSON.stringify(nk)) }
{ const r = U.ke_toan ? await as(U.ke_toan, 'select kho.doi_trang_thai_don($1,$2) j', [CG2, 'da_giao'], true) : { e: 'NO_KETOAN' }
  ok('2 · ke_toan: cho_giao → da_giao', U.ke_toan ? (!r.e && (await tt(CG2)) === 'da_giao') : false, r.e || (U.ke_toan ? '' : 'không có tài khoản ke_toan')) }

// ═══ CHẶN ═══
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2) j', [BG, 'da_giao'])
  ok('3 · bao_gia → da_giao → CHẶN (chưa ở bước chờ giao, cấm nhảy tắt)', !!r.e && /chờ giao|nhảy tắt|đang "bao_gia"/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2) j', [CC, 'da_giao'])
  ok('4 · cho_cat → da_giao → CHẶN (chưa ở cho_giao)', !!r.e && /chờ giao|cho_cat/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.xuong, 'select kho.doi_trang_thai_don($1,$2) j', [CG2, 'da_giao'])
  ok('5 · vai xuong gọi da_giao → CHẶN (chỉ sale/ke_toan/ceo)', !!r.e && /sale\/ke_toan\/ceo|xuong/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = U.tho ? await as(U.tho, 'select kho.doi_trang_thai_don($1,$2) j', [CG2, 'da_giao']) : { e: 'tho: (không có tk) — coi như chặn' }
  ok('6 · vai tho gọi da_giao → CHẶN', !U.tho || (!!r.e && /sale\/ke_toan\/ceo|tho/.test(r.e || '')), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2) j', [DG, 'da_giao'])
  ok('7 · đơn ĐÃ da_giao gọi lại → CHẶN', !!r.e && /đã giao/i.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [CGx, 'cho_cat', null])
  ok('8 · doi_trang_thai_don(cho_cat) VẪN CHẶN (db/149 không nới nhầm)', !!r.e && /sản xuất|cho_cat|bàn giao/.test(r.e || ''), r.e || 'KHÔNG chặn') }

await c.query('rollback')
const after = (await one('select count(*)::int n from kho.don_hang')).n
ok('DỌN · 0 rác (rollback tx, T8-001 KHÔNG chạm)', before === after, `${before} vs ${after}`)
console.log(`\nKẾT QUẢ test_149: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
