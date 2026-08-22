// TEST PHẢI CẮN — WP-35 · Quy đổi đơn vị (db/131). Tx rollback. auth_uid test_* (QD-51). CẤM đụng dữ liệu thật.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { execFileSync } from 'node:child_process'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 140) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
let U = {}
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function tryRaw(sql, a = []) { await c.query('savepoint r'); try { await c.query(sql, a); await c.query('release savepoint r'); return null } catch (e) { await c.query('rollback to savepoint r'); return e.message } }
const mkVt = async (ma, cs = 'tam') => (await one(`insert into kho.vat_tu(ma,ten,loai,dvt,don_vi_co_so) values($1,$2,'pk',$3,$4) returning id`, [ma, ma, cs === 'tam' ? 'tấm' : cs, cs])).id
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: '/x.dxf', ten_goc: 'x.dxf', co_byte: 1 }])
const kd = async (vt) => Number((await one(`select kha_dung from kho.v_ton_kha_dung where vat_tu_id=$1 and kho_id=$2`, [vt, U.kho_id]))?.kha_dung ?? null)
// đơn bàn-giao-được có 1 món (BOM đẩy qua ghi_bom_mon để so_luong_co_so tính thật)
async function mkDonBom(sfx, vt, so_luong, don_vi) {
  await c.query(`set local session_replication_role='replica'`)
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO WP35',true,'le','moi_len_don','khac') returning id`, [`DEMO-WP35-${sfx}`])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,'món','KE-HO-MELAMINE',false) returning id`, [don])).id
  for (const hd of ['cat', 'dan', 'cam', 'thung', 'goi']) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,moc) values($1,$2,10,'10','go_tay','chuan')`, [mon, hd])
  await c.query(`set local session_replication_role='origin'`)
  const r = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) g`, [mon, JSON.stringify([{ vat_tu_id: vt, so_luong, don_vi }])], true)
  if (r.e) throw new Error('ghi_bom_mon fixture: ' + r.e)
  return { don, mon, ma_don: `DEMO-WP35-${sfx}` }
}

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  U.tho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_tho'`)).a
  U.kho_id = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id

  console.log('── C1 · ghi_bom_mon 12 m2, cơ sở tam, hệ số 0,336 → so_luong_co_so 4,032 ──')
  const V = await mkVt('TEST-WP35-M2')
  await as(U.kho, `select kho.vat_tu_don_vi_ghi($1,'m2',0.336)`, [V], true)
  { const d = await mkDonBom('c1', V, 12, 'm2')
    const b = await one(`select so_luong, don_vi, so_luong_co_so, he_so_ap_dung from kho.don_hang_mon_bom where mon_id=$1`, [d.mon])
    ok('C1 so_luong=12 don_vi=m2 · so_luong_co_so=4.032 · he_so=0.336',
      Number(b.so_luong) === 12 && b.don_vi === 'm2' && Number(b.so_luong_co_so) === 4.032 && Number(b.he_so_ap_dung) === 0.336, JSON.stringify(b))
    global._c1 = d }

  console.log('\n── C2 · ban_giao → giu_cho = 4,032 tam (không phải 12); kha_dung giảm 4,032 ──')
  { const d = global._c1
    const kd0 = await kd(V)
    const r = await as(U.ceo, `select kho.ban_giao_xuong($1,$2::jsonb,null) x`, [d.ma_don, FILE], true)
    ok('C2 ban_giao OK', r.e === null && r.r[0].x.ok, r.e)
    const g = await one(`select so_luong_giu from kho.giu_cho where don_hang_id=$1`, [d.don])
    ok('C2 giu_cho = 4.032 (cơ sở, không 12)', Number(g.so_luong_giu) === 4.032, JSON.stringify(g))
    const kd1 = await kd(V)
    ok('C2 kha_dung giảm đúng 4.032', kd0 - kd1 === 4.032, `${kd0}→${kd1}`) }

  console.log('\n── C3 · đơn vị cuon chưa quy đổi → lỗi, BOM 0 dòng (atomic) ──')
  { const V3 = await mkVt('TEST-WP35-C3')
    await c.query(`set local session_replication_role='replica'`)
    const d3 = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,nguon_khach) values('DEMO-WP35-c3','x',true,'khac') returning id`)).id
    const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten) values($1,1,'m') returning id`, [d3])).id
    await c.query(`set local session_replication_role='origin'`)
    const r = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) g`, [mon, JSON.stringify([{ vat_tu_id: V3, so_luong: 5, don_vi: 'cuon' }])])
    ok('C3 đơn vị cuon chưa quy đổi → lỗi', r.e !== null && /không có quy đổi/.test(r.e), r.e)
    ok('C3 BOM 0 dòng (atomic)', Number((await one(`select count(*) c from kho.don_hang_mon_bom where mon_id=$1`, [mon])).c) === 0) }

  console.log('\n── C4 · đơn vị M2 / m² → lỗi (không tự chuẩn hoá) ──')
  { const mon = global._c1.mon   // món đã chốt? c1 chưa chốt trước C2… nhưng C2 giữ chỗ chốt BOM. Dùng món mới.
    const V4 = await mkVt('TEST-WP35-C4'); await as(U.kho, `select kho.vat_tu_don_vi_ghi($1,'m2',0.5)`, [V4], true)
    await c.query(`set local session_replication_role='replica'`)
    const dd = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,nguon_khach) values('DEMO-WP35-c4','x',true,'khac') returning id`)).id
    const m4 = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten) values($1,1,'m') returning id`, [dd])).id
    await c.query(`set local session_replication_role='origin'`)
    const rU = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) g`, [m4, JSON.stringify([{ vat_tu_id: V4, so_luong: 1, don_vi: 'M2' }])])
    const rD = await as(U.kho, `select kho.ghi_bom_mon($1,'go_tay',$2::jsonb) g`, [m4, JSON.stringify([{ vat_tu_id: V4, so_luong: 1, don_vi: 'm²' }])])
    ok('C4 M2 → lỗi (không tự lower)', rU.e !== null && /không có quy đổi/.test(rU.e), rU.e)
    ok('C4 m² (có dấu) → lỗi', rD.e !== null && /không có quy đổi/.test(rD.e), rD.e) }

  console.log('\n── C5 · đổi don_vi_co_so: có giữ chỗ → lỗi; vật tư mới → được ──')
  { const rLock = await tryRaw(`update kho.vat_tu set don_vi_co_so='cai' where id=$1`, [V])   // V đã có giu_cho (C2); trigger chặn (superuser bypass grant, trigger vẫn chạy)
    ok('C5 vật tư đã có giữ chỗ → CHẶN đổi cơ sở', rLock !== null && /không đổi được đơn vị cơ sở/.test(rLock), rLock)
    const Vnew = await mkVt('TEST-WP35-C5')
    const rOk = await tryRaw(`update kho.vat_tu set don_vi_co_so='cai' where id=$1`, [Vnew])
    ok('C5 vật tư mới chưa sổ → đổi được', rOk === null, rOk) }

  console.log('\n── C6 · đổi he_so SAU khi BOM chốt → so_luong_co_so BOM chốt KHÔNG đổi ──')
  { const sco = Number((await one(`select so_luong_co_so from kho.don_hang_mon_bom where mon_id=$1`, [global._c1.mon])).so_luong_co_so)   // đã chốt ở C2
    await as(U.kho, `select kho.vat_tu_don_vi_ghi($1,'m2',0.999)`, [V], true)   // đổi hệ số
    const sco2 = Number((await one(`select so_luong_co_so from kho.don_hang_mon_bom where mon_id=$1`, [global._c1.mon])).so_luong_co_so)
    ok('C6 so_luong_co_so BOM chốt giữ 4.032 (snapshot)', sco === 4.032 && sco2 === 4.032, `${sco}→${sco2}`) }

  console.log('\n── C7 · vat_tu_don_vi_ghi vai tho → từ chối; vai kho → được ──')
  { const V7 = await mkVt('TEST-WP35-C7')
    const rt = await as(U.tho, `select kho.vat_tu_don_vi_ghi($1,'m2',0.4)`, [V7])
    ok('C7 vai tho → từ chối', rt.e !== null && /chỉ kho\/ceo/.test(rt.e), rt.e)
    const rk = await as(U.kho, `select kho.vat_tu_don_vi_ghi($1,'m2',0.4)`, [V7], true)
    ok('C7 vai kho → được', rk.e === null, rk.e) }

  console.log('\n── C9 · PERF @100k dòng vat_tu_don_vi ──')
  { await c.query(`set local session_replication_role='replica'`)
    await c.query(`insert into kho.vat_tu(ma,ten,loai,dvt,don_vi_co_so) select 'PVT'||g,'p'||g,'pk','tấm','tam' from generate_series(1,20000) g`)
    await c.query(`insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so)
      select v.id, u.dv, 0.5 from kho.vat_tu v cross join (values('m2'),('m'),('cuon'),('hop'),('tui')) u(dv) where v.ma like 'PVT%'`)
    await c.query(`set local session_replication_role='origin'`); await c.query(`analyze kho.vat_tu_don_vi`)
    const tong = Number((await one(`select count(*) c from kho.vat_tu_don_vi`)).c)
    const pvt = (await q(`select id from kho.vat_tu where ma like 'PVT%' order by ma limit 50`)).map(r => r.id)
    await c.query(`set local session_replication_role='replica'`)
    const dperf = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,nguon_khach) values('DEMO-WP35-perf','x',true,'khac') returning id`)).id
    const mperf = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten) values($1,1,'m') returning id`, [dperf])).id
    await c.query(`set local session_replication_role='origin'`)
    const dong50 = pvt.map(v => ({ vat_tu_id: v, so_luong: 2, don_vi: 'm2' }))
    const exMs = async (sql, a = []) => Number((await as(U.kho, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
    const ms1 = await exMs(`select kho.ghi_bom_mon($1,'go_tay',$2::jsonb)`, [mperf, JSON.stringify(dong50)])
    const ms2 = await exMs(`select kho.quy_ve_co_so($1,'m2',10)`, [pvt[0]])
    ok(`C9 (${tong} dòng) ghi_bom_mon 50 dòng = ${ms1.toFixed(0)}ms < 500`, ms1 < 500, ms1 + 'ms')
    ok(`C9 quy_ve_co_so đơn lẻ = ${ms2.toFixed(1)}ms < 5`, ms2 < 5, ms2 + 'ms') }

  await c.query('rollback')
  console.log('\n── C8 · cổng cũ không vỡ (tiến trình riêng) ──')
  const cfg = await (await import('./conn.mjs')).docConfig()
  const dbUrl = cfg.connectionString || `postgresql://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`
  const runNode = (f) => { try { execFileSync('node', [f], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } }); return true } catch (e) { console.log('   ↳', f, (e.stdout || e.stderr || '').toString().split('\n').slice(-5).join('\n')); return false } }
  const runSql = (f) => { try { return /199\/199|✅|OK/.test(execFileSync('node', ['ops/run_sql.mjs', f], { cwd: process.cwd(), stdio: 'pipe' }).toString()) } catch { return false } }
  ok('C8 so_ba_nguon 199/199', runSql('ops/so_ba_nguon.sql'))
  ok('C8 test_119 không vỡ', runNode('ops/test_119_ton_tu_so.mjs'))
  ok('C8 test_huy_phieu không vỡ', runNode('ops/test_huy_phieu.mjs'))
  ok('C8 test_128 (WP-30) không vỡ', runNode('ops/test_128.mjs'))
  ok('C8 test_130 (WP-32) không vỡ', runNode('ops/test_130.mjs'))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_wp35: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK — không để lại vật tư/đơn/quy đổi test.'); process.exit(F === 0 ? 0 : 1) }
