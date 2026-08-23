// TEST PHẢI CẮN — 139 · WP-41 (QD-60) planning method + mức tồn min/max. Không RPC → chỉ DDL/DML, tx rollback.
// CEO 23/08: ton_toi_thieu (cột db/001) TÁI DÙNG — giữ 148 giá trị dương, 54 số 0→NULL, bỏ default 0.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
try {
  // ── cột tồn tại ──
  const vc = (await q("select column_name from information_schema.columns where table_schema='kho' and table_name='vat_tu' and column_name in ('pp_ke_hoach','ton_toi_thieu','muc_dat_len_toi')")).map(r => r.column_name)
  ok('vat_tu có đủ 3 cột', vc.length === 3, JSON.stringify(vc))
  const nc = (await q("select column_name from information_schema.columns where table_schema='kho' and table_name='niem_yet' and column_name='pp_ke_hoach'")).length
  ok('niem_yet có pp_ke_hoach', nc === 1)

  // ── default 0 đã bỏ (mã mới = NULL) ──
  const def = (await one("select column_default from information_schema.columns where table_schema='kho' and table_name='vat_tu' and column_name='ton_toi_thieu'")).column_default
  ok('ton_toi_thieu đã BỎ default 0 (mã mới → NULL)', def === null, 'default=' + def)

  // ── đếm backfill pp ──
  const vg = await q("select pp_ke_hoach, count(*)::int n from kho.vat_tu group by pp_ke_hoach order by pp_ke_hoach")
  const ng = await q("select pp_ke_hoach, count(*)::int n from kho.niem_yet group by pp_ke_hoach order by pp_ke_hoach")
  console.log('  vat_tu pp_ke_hoach:', JSON.stringify(vg), '· niem_yet:', JSON.stringify(ng))
  ok('vat_tu backfill 100% ton_toi_thieu (0 NULL)', vg.length === 1 && vg[0].pp_ke_hoach === 'ton_toi_thieu')
  ok('niem_yet backfill 100% theo_nhu_cau (0 NULL)', ng.length === 1 && ng[0].pp_ke_hoach === 'theo_nhu_cau')

  // ── ton_toi_thieu: giữ dương, 0→NULL ──
  const m = await one("select count(*) filter (where ton_toi_thieu=0)::int la0, count(*) filter (where ton_toi_thieu>0)::int duong, count(*) filter (where ton_toi_thieu is null)::int la_null from kho.vat_tu")
  console.log('  ton_toi_thieu: =0 →', m.la0, '· >0 (giữ) →', m.duong, '· NULL →', m.la_null)
  ok('54 số 0 đã → NULL (không còn dòng =0)', m.la0 === 0)
  ok('GIỮ 148 giá trị dương (min-stock thật)', m.duong === 148, 'duong=' + m.duong)
  ok('muc_dat_len_toi NULL toàn bộ (kho nhập tay)', (await one("select count(*)::int n from kho.vat_tu where muc_dat_len_toi is not null")).n === 0)

  const vt0 = await one("select id, ma from kho.vat_tu where ton_toi_thieu is null order by ma limit 1")

  // ── RAISE: pp_ke_hoach lạ ──
  await c.query('begin'); let e1 = null
  try { await c.query("update kho.vat_tu set pp_ke_hoach='bay_ba' where id=$1", [vt0.id]) } catch (x) { e1 = x.message }
  await c.query('rollback')
  ok('pp_ke_hoach=\'bay_ba\' → RAISE (CHECK)', /check|constraint|violat/i.test(e1 || ''), e1)

  // ── RAISE: ton_toi_thieu < 0 (CHECK mới db/139) ──
  await c.query('begin'); let e0 = null
  try { await c.query("update kho.vat_tu set ton_toi_thieu=-5 where id=$1", [vt0.id]) } catch (x) { e0 = x.message }
  await c.query('rollback')
  ok('ton_toi_thieu=-5 → RAISE (CHECK >= 0)', /check|constraint|violat/i.test(e0 || ''), e0)

  // ── RAISE: max < min ──
  await c.query('begin'); let e2 = null
  try { await c.query("update kho.vat_tu set ton_toi_thieu=30, muc_dat_len_toi=10 where id=$1", [vt0.id]) } catch (x) { e2 = x.message }
  await c.query('rollback')
  ok('muc_dat_len_toi(10) < ton_toi_thieu(30) → RAISE', /check|constraint|violat/i.test(e2 || ''), e2)

  // ── đặt mức min=10/max=30 rồi ROLLBACK (không để dấu vết) ──
  await c.query('begin')
  await c.query("update kho.vat_tu set ton_toi_thieu=10, muc_dat_len_toi=30 where id=$1", [vt0.id])
  const trong = await one("select ton_toi_thieu, muc_dat_len_toi from kho.vat_tu where id=$1", [vt0.id])
  await c.query('rollback')
  const sau = await one("select ton_toi_thieu, muc_dat_len_toi from kho.vat_tu where id=$1", [vt0.id])
  ok(`trong tx thấy mức 10/30 (mã ${vt0.ma})`, Number(trong.ton_toi_thieu) === 10 && Number(trong.muc_dat_len_toi) === 30, JSON.stringify(trong))
  ok('SAU ROLLBACK về NULL/NULL — 0 dấu vết', sau.ton_toi_thieu === null && sau.muc_dat_len_toi === null, JSON.stringify(sau))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_139: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally { try { await c.query('rollback') } catch (_) {} await c.end(); process.exit(F ? 1 : 0) }
