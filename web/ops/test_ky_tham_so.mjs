// WP-11d · TEST ràng buộc kỳ tham_so_tai_chinh (db/218). BEGIN/ROLLBACK — không để rác.
//   Chặn TRÙNG ngay_ap_dung (tstc_ngay_ap_dung_duy_nhat) + tháng khớp ma_ky (tstc_ngay_khop_ma_ky).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 15000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
async function thu(sql, params = []) {
  await c.query('savepoint s')
  try { await c.query(sql, params); await c.query('release savepoint s'); return { ok: true } }
  catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0], con: e.constraint } }
}
const INS = 'insert into kho.tham_so_tai_chinh(ma_ky, ngay_ap_dung) values($1,$2)'
try {
  await c.query('begin')
  const CONS = ['tstc_ngay_ap_dung_duy_nhat', 'tstc_ngay_khop_ma_ky']
  // 5a · INSERT trùng ngay_ap_dung → CHẶN. (CHECK bắt trước: 2026-08-01 tháng 08 ≠ ma_ky '2026-08b';
  //      trùng-ngày HỢP LỆ đòi cùng tháng = cùng ma_ky = đụng PK → bất khả. UNIQUE là dự phòng.)
  const a = await thu(INS, ['2026-08b', '2026-08-01'])
  ok('5a INSERT trùng ngay_ap_dung → CHẶN (' + (a.con || '') + ')', !a.ok && CONS.includes(a.con), a.ok ? 'LỌT!' : a.msg)
  // 5b · UPDATE kỳ 08 về ngày kỳ 07 (2026-07-01) → CHẶN (CHECK: tháng 07 ≠ ma_ky 2026-08)
  const b = await thu("update kho.tham_so_tai_chinh set ngay_ap_dung='2026-07-01' where ma_ky='2026-08'")
  ok('5b UPDATE kỳ 08 về ngày kỳ 07 → CHẶN (' + (b.con || '') + ')', !b.ok && CONS.includes(b.con), b.ok ? 'LỌT!' : b.msg)
  // 5c · INSERT kỳ 2026-09 ngày 2026-09-01 → THÀNH CÔNG (không chặn nhầm kỳ mới)
  const cc = await thu(INS, ['2026-09', '2026-09-01'])
  ok('5c INSERT kỳ 2026-09 (2026-09-01) → THÀNH CÔNG (không chặn nhầm)', cc.ok, cc.msg)
  // 5d · INSERT ma_ky 2026-09 kèm ngày SAI THÁNG (2026-08-15, tháng 08 ≠ 09) → chặn CHECK
  const d = await thu(INS, ['2026-09c', '2026-08-15'])
  ok('5d INSERT ma_ky 2026-09 + ngày tháng 08 → CHẶN CHECK (' + (d.con || '') + ')', !d.ok && d.con === 'tstc_ngay_khop_ma_ky', d.ok ? 'LỌT!' : d.msg)
  await c.query('rollback')
  const cnt = (await c.query('select count(*) n from kho.tham_so_tai_chinh')).rows[0].n
  ok('ROLLBACK sạch — count vẫn ' + cnt, cnt === '2')
} catch (e) { console.log('LỖI:', e.message); try { await c.query('rollback') } catch {}; F++ }
console.log(`\n═══ test_ky_tham_so: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
