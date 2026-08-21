// TEST PHẢI CẮN — 126 · Đơn mua (WP-20). Tx rollback. Mỗi test cắn HAI vế (có ca đỏ nếu bỏ cổng).
//   Dùng U.ceo/U.kho/NULLVAI có sẵn (LUẬT CẤM tạo tài khoản → không tạo auth.users test_; tx rollback nên không để rác).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', kho: '66272566-1897-4c57-aa3f-98a81636302a', NULLVAI: '00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 80) : '')); v ? P++ : F++ }
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
const g = (r) => r?.r?.[0]?.g
// tạo PO (persist) → trả {id, so_don}
async function mkPO(uid, ncc, dong, keep = true) {
  const r = await as(uid, `select kho.dm_tao($1,null,current_date+7,'t',$2::jsonb,false) g`, [ncc, JSON.stringify(dong)], keep)
  return { e: r.e, ...(g(r) || {}) }
}
try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  const ncc = (await one(`select id from kho.nha_cung_cap limit 1`)).id
  const vts = (await q(`select id from kho.vat_tu limit 2`)).map(r => r.id)
  const D2 = [{ vat_tu_id: vts[0], so_luong: 5, don_gia: 1000 }, { vat_tu_id: vts[1], so_luong: 3, don_gia: 2000 }]

  console.log('── tạo đơn + số/dòng ──')
  const po = await mkPO(U.kho, ncc, D2)
  ok('#1 tạo PO đủ dòng → so_don dạng DM-YYYY-NNNN', /^DM-\d{4}-\d{4}$/.test(po.so_don || ''), po.so_don)
  ok('#1 stt = 1..2 tuần tự', JSON.stringify((await q(`select stt from kho.don_mua_dong where don_mua_id=$1 order by stt`, [po.id])).map(r => r.stt)) === '[1,2]')
  const p0 = await mkPO(U.kho, ncc, [], false)
  ok('#2 tạo PO 0 dòng → LỖI', p0.e !== null && /ÍT NHẤT MỘT dòng/.test(p0.e), p0.e)

  console.log('\n── cổng chuyển trạng thái ──')
  ok('#3 moi→da_gui OK', (await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [po.id], true)).e === null)
  ok('#4 moi→da_nhan → LỖI cổng', /cổng không cho|đơn không|/.test((await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_nhan') g`, [po.id])).e || 'x') && (await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_nhan') g`, [po.id])).e !== null)
  // #5 da_gui→xac_nhan KHÔNG truyền ngày → ngay_ncc_hen = ngay_can
  const canN = (await one(`select ngay_can from kho.don_mua where id=$1`, [po.id])).ngay_can
  await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'xac_nhan') g`, [po.id], true)
  const hen5 = (await one(`select ngay_ncc_hen from kho.don_mua where id=$1`, [po.id])).ngay_ncc_hen
  ok('#5 da_gui→xac_nhan không ngày → ngay_ncc_hen = ngay_can', String(hen5) === String(canN), `${hen5} vs ${canN}`)
  // #6 PO khác: truyền ngày → ghi đè
  const po6 = await mkPO(U.kho, ncc, D2); await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [po6.id], true)
  await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'xac_nhan','2099-01-15') g`, [po6.id], true)
  ok('#6 truyền ngày hẹn → GHI ĐÈ', (await one(`select ngay_ncc_hen::text h from kho.don_mua where id=$1`, [po6.id])).h === '2099-01-15')
  // #7 xac_nhan→da_nhan: vai kho LỖI, ceo OK (po đang xac_nhan)
  ok('#7 xac_nhan→da_nhan vai KHO → LỖI', (await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_nhan') g`, [po.id])).e !== null)
  ok('#7 xac_nhan→da_nhan vai CEO → OK', (await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_nhan') g`, [po.id], true)).e === null)
  ok('#8 da_nhan→huy → LỖI (chỉ huỷ trước nhận)', /chỉ huỷ được TRƯỚC/.test((await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'huy',null,'x') g`, [po.id])).e || ''))
  // #9 huy không lý do (po6 đang xac_nhan)
  ok('#9 huỷ KHÔNG lý do → LỖI', /phải có LÝ DO/.test((await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'huy') g`, [po6.id])).e || ''))
  ok('#9b huỷ CÓ lý do → OK', (await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'huy',null,'hết hàng') g`, [po6.id], true)).e === null)

  console.log('\n── sửa dòng + lịch sử ──')
  const po10 = await mkPO(U.kho, ncc, D2); await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [po10.id], true)
  await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'xac_nhan') g`, [po10.id], true)
  const s10 = await as(U.kho, `select kho.dm_sua_dong($1,$2::jsonb) g`, [po10.id, JSON.stringify([{ vat_tu_id: vts[0], so_luong: 9, don_gia: 500 }])], true)
  ok('#10 sửa dòng ở xac_nhan → OK + có lich_su diff', s10.e === null && Number((await one(`select count(*) n from kho.don_mua_lich_su where don_mua_id=$1 and noi_dung ? 'sua_dong'`, [po10.id])).n) >= 1, s10.e)
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_nhan') g`, [po10.id], true)
  ok('#10b sửa dòng ở da_nhan → LỖI', /chỉ sửa dòng khi/.test((await as(U.kho, `select kho.dm_sua_dong($1,$2::jsonb) g`, [po10.id, JSON.stringify([{ vat_tu_id: vts[0], so_luong: 1 }])])).e || ''))

  console.log('\n── RLS + lùi ──')
  const upd = await as(U.kho, `update kho.don_mua set ghi_chu='hack' where id=$1`, [po.id])
  ok('#11 UPDATE thẳng don_mua vai kho → CHẶN (RLS/revoke)', upd.e !== null && /denied|permission/i.test(upd.e), upd.e)
  const po12 = await mkPO(U.kho, ncc, D2); await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'da_gui') g`, [po12.id], true)
  ok('#12 lùi da_gui→moi → LỖI', /cổng không cho/.test((await as(U.kho, `select kho.dm_chuyen_trang_thai($1,'moi') g`, [po12.id])).e || ''))

  console.log('\n── 13 · TỐC ĐỘ 100k đơn / 300k dòng ──')
  await q(`insert into kho.don_mua(so_don,ncc_id,kho_id,ngay_can,trang_thai)
    select 'DM-P-'||g, $1, (select id from kho.kho where la_mac_dinh limit 1), current_date + (g%30),
      (array['moi','da_gui','xac_nhan','da_nhan'])[1+g%4]
    from generate_series(1,100000) g`, [ncc])
  await q(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt,don_gia)
    select d.id, s, $1, 1+s, 'c', 1000*s from kho.don_mua d, generate_series(1,3) s where d.so_don like 'DM-P-%'`, [vts[0]])
  await q(`analyze kho.don_mua`); await q(`analyze kho.don_mua_dong`)   // stats sau bulk insert (thực tế autovacuum có)
  // Đo SERVER-SIDE (EXPLAIN ANALYZE Execution Time) — client wall-clock qua Supabase REMOTE gồm ~600ms network,
  //   không phải thời gian query. "ms thật" của công việc DB = Execution Time.
  const exMs = async (sql, a = []) => Number((await as(U.ceo, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
  const someId = (await one(`select id from kho.don_mua where so_don='DM-P-500'`)).id
  const ms1 = await exMs(`select kho.dm_danh_sach('da_gui',null,'DM-P-123') g`)
  const ms2 = await exMs(`select kho.dm_chi_tiet($1) g`, [someId])
  ok(`#13 dm_danh_sach @100k = ${ms1.toFixed(0)}ms server-side < 500`, ms1 < 500, ms1 + 'ms')
  ok(`#13 dm_chi_tiet @100k = ${ms2.toFixed(0)}ms server-side < 500`, ms2 < 500, ms2 + 'ms')

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_126: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK — không để lại đơn/dòng/tài khoản test.'); process.exit(F === 0 ? 0 : 1) }
