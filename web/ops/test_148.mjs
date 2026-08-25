// TEST PHẢI CẮN — WP-06 tầng 1 (db/148, QD-64): 2 cửa RPC ghi trạng thái đơn.
//   as(uid) = set role authenticated + jwt sub=uid → GIỐNG HỆT Bearer JWT client gọi. KHÔNG GUC/service-key.
//   Setup dựng dữ liệu bằng session_replication_role='replica' (tắt trigger) — RPC test chạy khi trigger BẬT.
//   Tx KHÔNG commit → rollback → 0 dấu vết. KHÔNG chạm T8-001.
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
const uid = async v => (await one('select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1', [v])).a
const U = { sale: await uid('sale'), xuong: await uid('xuong') }
const TH = (await one('select ma from kho.thuong_hieu limit 1')).ma

await c.query("set session_replication_role='replica'")   // setup: tắt trigger
async function mkDon(sfx, trang_thai, dong, monGia) {
  const don = (await one("insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach,thuong_hieu) values($1,'DEMO wp06',true,$2,$3,'gioi_thieu',$4) returning id",
    ['DEMO-WP06-' + sfx, dong, trang_thai, TH])).id
  for (const g of monGia) await c.query("insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi,gia) values($1,1,$2,'KE-HO-MELAMINE',false,$3)", [don, 'món ' + sfx, g])
  return { don }
}
const A = await mkDon('A', 'bao_gia', 'le', [1000000, 2000000])   // chốt được
const B = await mkDon('B', 'bao_gia', 'le', [0, 3000000])          // món giá 0 → chốt chặn
const C = await mkDon('C', 'cho_cat', 'le', [1000000])            // đơn SX → chốt chặn
const D = await mkDon('D', 'bao_gia_treo', 'le', [1500000])       // treo → chốt được
const M = await mkDon('M', 'moi_len_don', 'le', [1000000])        // đã lên đơn
await c.query("set session_replication_role='origin'")   // RPC test: trigger BẬT

// ═══ ĐẠT ═══
{ const r = await as(U.sale, 'select kho.chot_don($1,$2,$3) j', [A.don, 'gioi_thieu', TH], true)
  ok('1 · sale chot_don đơn bao_gia (le, món giá>0) → moi_len_don', !r.e && (await tt(A.don)) === 'moi_len_don', r.e) }
{ const r = await as(U.sale, 'select kho.chot_don($1,$2,$3) j', [D.don, 'gioi_thieu', TH], true)
  ok('2 · sale chot_don đơn bao_gia_treo → moi_len_don', !r.e && (await tt(D.don)) === 'moi_len_don', r.e) }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [A.don, 'tam_ngung', 'khách hoãn'], true)
  ok('3 · sale doi_trang_thai_don tam_ngung (có lý do) → tam_ngung', !r.e && (await tt(A.don)) === 'tam_ngung', r.e) }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [D.don, 'huy', 'khách huỷ'], true)
  ok('4 · sale doi_trang_thai_don huy (có lý do) → huy', !r.e && (await tt(D.don)) === 'huy', r.e) }

// ═══ CHẶN ═══
{ const r = await as(U.xuong, 'select kho.chot_don($1,$2,$3) j', [B.don, 'gioi_thieu', TH])
  ok('5 · vai xuong gọi chot_don → CHẶN (chỉ ceo/kho/sale/tk_ban_hang)', !!r.e && /chỉ ceo|xuong/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.chot_don($1,$2,$3) j', [C.don, 'gioi_thieu', TH])
  ok('6 · chot_don đơn cho_cat → CHẶN (không phải báo giá)', !!r.e && /báo giá|cho_cat/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.chot_don($1,$2,$3) j', [B.don, 'gioi_thieu', TH])
  ok('7 · chot_don khi món còn giá=0 → CHẶN (kiem_chuyen bắt, lỗi nguyên văn)', !!r.e && /thiếu giá|món/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [M.don, 'cho_cat', null])
  ok('8 · doi_trang_thai_don(cho_cat) → CHẶN (SX chỉ qua bàn giao)', !!r.e && /sản xuất|cho_cat|bàn giao/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [M.don, 'cho_giao', 'x'])
  ok('9 · doi_trang_thai_don(cho_giao — SX) → CHẶN', !!r.e && /sản xuất|cho_giao/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [M.don, 'huy', null])
  ok('10 · huy KHÔNG lý do → CHẶN', !!r.e && /lý do/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.chot_don($1,$2,$3) j', [M.don, 'gioi_thieu', TH])
  ok('11 · đơn đã moi_len_don chốt lại → CHẶN', !!r.e && /đã lên đơn|moi_len_don/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [M.don, 'xyz_khong_ton_tai', null])
  ok('12 · giá trị ngoài CHECK 15/whitelist → CHẶN', !!r.e && /không cho phép|đích/.test(r.e || ''), r.e || 'KHÔNG chặn') }
{ const r = await as(U.sale, 'select kho.doi_trang_thai_don($1,$2,$3) j', [M.don, 'moi_len_don', 'x'])
  ok('13 · doi_trang_thai_don(moi_len_don) → CHẶN (dùng chot_don)', !!r.e && /chot_don/.test(r.e || ''), r.e || 'KHÔNG chặn') }

await c.query('rollback')
const after = (await one('select count(*)::int n from kho.don_hang')).n
ok('DỌN · 0 rác (rollback tx, T8-001 KHÔNG chạm)', before === after, `${before} vs ${after}`)
console.log(`\nKẾT QUẢ test_148: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
