// TEST PHẢI CẮN — WP-07 (db/151, QD-67): RPC kho.tao_don — đơn LUÔN khởi tạo bao_gia; +Lên đơn = tao_don+chot_don.
//   as(uid) = set role authenticated + jwt sub=uid → GIỐNG Bearer JWT client. KHÔNG GUC/service-key.
//   Tx KHÔNG commit → rollback → 0 dấu vết. KHÔNG chạm T8-001. don_hang = chứng từ → KHÔNG đo 100k.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const TAO = 'select * from kho.tao_don($1::jsonb, $2)'

await c.query('begin')
const before = (await one('select count(*)::int n from kho.don_hang')).n
const uid = async v => (await one('select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1', [v])).a
const U = { sale: await uid('sale'), xuong: await uid('xuong') }
const TH = (await one('select ma from kho.thuong_hieu limit 1')).ma
const P0 = (ma, extra = {}) => JSON.stringify({ ma_don: ma, dong: 'le', loai: 'le_sang', ten_khach: 'DEMO wp07', sdt_khach: '0900000007', ...extra })

// ═══ a) tao_don sale, p_chot=false → đơn tồn tại, bao_gia ═══
{ const r = await as(U.sale, TAO, [P0('ZZ-WP07-A'), false], true)
  const row = r.r && r.r[0]
  const exists = row && (await one('select trang_thai from kho.don_hang where id=$1', [row.id]))
  ok('a · sale tao_don(p_chot=false) → đơn tồn tại, trang_thai=bao_gia',
     !r.e && row && row.trang_thai === 'bao_gia' && exists && exists.trang_thai === 'bao_gia', r.e || JSON.stringify(row)) }

// ═══ b) tao_don sale, p_chot=true (đủ nguồn+thương hiệu) → moi_len_don + nhật ký người chốt ═══
{ const r = await as(U.sale, TAO, [P0('ZZ-WP07-B', { nguon_khach: 'gioi_thieu', thuong_hieu: TH }), true], true)
  const row = r.r && r.r[0]
  let nk = null, nguoiTao = null
  if (row) {
    nk = await one("select tu, den, nguoi_id from kho.don_hang_nhat_ky where don_id=$1 and den='moi_len_don' order by luc desc limit 1", [row.id])
    nguoiTao = await one('select nguoi_tao from kho.don_hang where id=$1', [row.id])
  }
  ok('b · sale tao_don(p_chot=true) → moi_len_don + nhật ký den=moi_len_don có người + nguoi_tao gán server',
     !r.e && row && row.trang_thai === 'moi_len_don' && nk && nk.den === 'moi_len_don' && nk.nguoi_id && nguoiTao && nguoiTao.nguoi_tao, r.e || JSON.stringify({ row, nk, nguoiTao })) }

// ═══ c) tao_don p_chot=true THIẾU nguồn khách → RAISE + rollback sạch (0 đơn rác) ═══
{ const r = await as(U.sale, TAO, [P0('ZZ-WP07-C', { thuong_hieu: TH }), true])   // KHÔNG nguon_khach
  const rac = await one("select count(*)::int n from kho.don_hang where ma_don='ZZ-WP07-C'")
  ok('c · tao_don(p_chot=true) thiếu nguồn khách → RAISE (nguyên văn kiem_chuyen)', !!r.e && /nguồn khách/.test(r.e || ''), r.e || 'KHÔNG raise')
  ok('c2 · rollback sạch — 0 đơn cụt ZZ-WP07-C còn lại', rac.n === 0, `còn ${rac.n} đơn`) }

// ═══ d) vai không sale/ceo → từ chối ═══
{ const r = await as(U.xuong, TAO, [P0('ZZ-WP07-D'), false])
  ok('d · vai xuong gọi tao_don → CHẶN (chỉ sale/ceo)', !!r.e && /chỉ sale\/ceo|vai/.test(r.e || ''), r.e || 'KHÔNG chặn') }

await c.query('rollback')
const after = (await one('select count(*)::int n from kho.don_hang')).n
ok('DỌN · 0 rác (rollback tx, T8-001 KHÔNG chạm)', before === after, `${before} vs ${after}`)
console.log(`\nKẾT QUẢ test_wp07: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
