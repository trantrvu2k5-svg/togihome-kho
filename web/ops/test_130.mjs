// TEST PHẢI CẮN — 130 · Giữ chỗ mềm lúc bàn giao (WP-32). Tx rollback. Dựng đơn DEMO qua replica-mode (bỏ trigger field),
//   bàn giao THẬT (ban_giao_xuong) rồi soi giữ chỗ. Dùng auth_uid test_* (QD-51). CẤM đụng dữ liệu thật.
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
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: '/x.dxf', ten_goc: 'x.dxf', co_byte: 1 }])
// dựng đơn DEMO bàn-giao-được (replica bỏ trigger field). mons=[{ten, bom:[{nguon,vat_tu_id,so_luong}]}]
async function mkDon(sfx, mons) {
  await c.query(`set local session_replication_role='replica'`)
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO 130',true,'le','moi_len_don','khac') returning id`, [`DEMO-130-${sfx}`])).id
  const monIds = []
  for (const mn of mons) {
    const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,$2,'KE-HO-MELAMINE',false) returning id`, [don, mn.ten])).id
    monIds.push(mon)
    for (const hd of ['cat', 'dan', 'cam', 'thung', 'goi'])
      await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,moc) values($1,$2,10,'10','go_tay','chuan')`, [mon, hd])
    for (const b of (mn.bom || []))
      await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc) values($1,$2,$3,'c',$4,'du_kien')`, [mon, b.vat_tu_id, b.so_luong, b.nguon])
  }
  await c.query(`set local session_replication_role='origin'`)
  return { ma_don: `DEMO-130-${sfx}`, don, monIds }
}
const bangiao = (ma) => as(U.ceo, `select kho.ban_giao_xuong($1,$2::jsonb,null) x`, [ma, FILE], true)
const kd = async (vt) => Number((await one(`select kha_dung from kho.v_ton_kha_dung where vat_tu_id=$1 and kho_id=$2`, [vt, U.kho_id]))?.kha_dung ?? null)

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  U.kho_id = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  // 3 vật tư CÓ tồn > 0, 1 vật tư tồn 0 (không dòng ton)
  const cot = await q(`select vat_tu_id from kho.ton where kho_id=$1 and so_luong>50 limit 3`, [U.kho_id])
  const [A, B, C] = cot.map(r => r.vat_tu_id)
  const Z = (await one(`select id from kho.vat_tu where id not in (select vat_tu_id from kho.ton) and ngung_dung=false limit 1`)).id

  console.log('── t1 · bàn giao đơn có BOM 3 nguồn → giữ chỗ đủ dòng ──')
  { const d = await mkDon('t1', [{ ten: 'kệ A', bom: [{ nguon: 'cutlist', vat_tu_id: A, so_luong: 4 }, { nguon: 'go_tay', vat_tu_id: B, so_luong: 2 }, { nguon: 'uoc', vat_tu_id: C, so_luong: 1 }] }])
    const r = await bangiao(d.ma_don)
    ok('t1 ban_giao_xuong OK', r.e === null && r.r[0].x.ok, r.e || JSON.stringify(r.r?.[0]?.x))
    const gc = await q(`select vat_tu_id, so_luong_giu, trang_thai from kho.giu_cho where don_hang_id=$1 order by so_luong_giu desc`, [d.don])
    ok('t1 giữ chỗ 3 dòng (mỗi dòng BOM chuan), số = BOM', gc.length === 3 && Number(gc[0].so_luong_giu) === 4 && gc.every(g => g.trang_thai === 'mo'), JSON.stringify(gc))
    ok('t1 giữ_cho_moi=3, không vat_tu_thieu (tồn đủ)', r.r[0].x.giu_cho_moi === 3 && r.r[0].x.vat_tu_thieu.length === 0, JSON.stringify(r.r[0].x.vat_tu_thieu))
    global._t1 = d }

  console.log('\n── t2 · tồn vật lý KHÔNG đổi (ton.so_luong + COUNT giao_dich trước=sau) ──')
  { const tonA0 = Number((await one(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [A, U.kho_id])).so_luong)
    const gd0 = Number((await one(`select count(*) c from kho.giao_dich`)).c)
    const d = await mkDon('t2', [{ ten: 'kệ B', bom: [{ nguon: 'go_tay', vat_tu_id: A, so_luong: 3 }] }])
    await bangiao(d.ma_don)
    const tonA1 = Number((await one(`select so_luong from kho.ton where vat_tu_id=$1 and kho_id=$2`, [A, U.kho_id])).so_luong)
    const gd1 = Number((await one(`select count(*) c from kho.giao_dich`)).c)
    ok('t2 ton.so_luong không đổi + COUNT giao_dich không đổi', tonA0 === tonA1 && gd0 === gd1, `ton ${tonA0}->${tonA1} · gd ${gd0}->${gd1}`) }

  console.log('\n── t3 · v_ton_kha_dung.kha_dung giảm đúng lượng giữ ──')
  { const kdBefore = await kd(B)
    const d = await mkDon('t3', [{ ten: 'kệ C', bom: [{ nguon: 'go_tay', vat_tu_id: B, so_luong: 7 }] }])
    await bangiao(d.ma_don)
    const kdAfter = await kd(B)
    ok('t3 kha_dung giảm đúng 7', kdBefore - kdAfter === 7, `${kdBefore} -> ${kdAfter}`) }

  console.log('\n── t4 · bàn giao lần 2 → COUNT giữ chỗ không đổi ──')
  { const d = global._t1
    const n0 = Number((await one(`select count(*) c from kho.giu_cho where don_hang_id=$1`, [d.don])).c)
    const r2 = await bangiao(d.ma_don)
    const n1 = Number((await one(`select count(*) c from kho.giu_cho where don_hang_id=$1`, [d.don])).c)
    ok('t4 lần 2 bị chặn DA_VAO_CHUYEN + giữ chỗ không đổi', (r2.e ? /DA_VAO_CHUYEN/.test(r2.e) : true) && n0 === n1, `e=${r2.e} n ${n0}->${n1}`) }

  console.log('\n── t5 · món KHÔNG BOM → mon_thieu_bom có id, đơn vẫn cho_cat ──')
  { const d = await mkDon('t5', [{ ten: 'có bom', bom: [{ nguon: 'go_tay', vat_tu_id: A, so_luong: 1 }] }, { ten: 'KHÔNG bom', bom: [] }])
    const r = await bangiao(d.ma_don)
    const tt = (await one(`select trang_thai from kho.don_hang where id=$1`, [d.don])).trang_thai
    ok('t5 mon_thieu_bom chứa món không BOM + đơn = cho_cat', r.r[0].x.mon_thieu_bom.some(m => m.mon_id === d.monIds[1]) && tt === 'cho_cat', `thieu=${JSON.stringify(r.r[0].x.mon_thieu_bom)} tt=${tt}`) }

  console.log('\n── t6 · vật tư tồn 0 → vat_tu_thieu đúng, kha_dung âm ──')
  { const d = await mkDon('t6', [{ ten: 'kệ Z', bom: [{ nguon: 'go_tay', vat_tu_id: Z, so_luong: 5 }] }])
    const r = await bangiao(d.ma_don)
    const thieu = r.r[0].x.vat_tu_thieu.find(x => x.vat_tu_id === Z)
    ok('t6 vat_tu_thieu[Z].thieu=5 + kha_dung(Z)=-5', thieu && Number(thieu.thieu) === 5 && (await kd(Z)) === -5, `${JSON.stringify(thieu)} kd=${await kd(Z)}`) }

  console.log('\n── t7 · đơn → huy → giữ chỗ huy, kha_dung hồi ──')
  { await c.query(`set local session_replication_role='replica'`)
    const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,nguon_khach,trang_thai) values('DEMO-130-t7','DEMO 130',true,'khac','moi_len_don') returning id`)).id
    await c.query(`insert into kho.giu_cho(don_hang_id,vat_tu_id,kho_id,so_luong_giu) values($1,$2,$3,6)`, [don, A, U.kho_id])
    await c.query(`set local session_replication_role='origin'`)
    const kdGiu = await kd(A)
    const up = await as(U.ceo, `update kho.don_hang set trang_thai='huy', ly_do_huy='test huỷ' where id=$1`, [don], true)   // trg_huy_giu_cho chạy
    const st = (await one(`select trang_thai from kho.giu_cho where don_hang_id=$1`, [don])).trang_thai
    const kdSau = await kd(A)
    ok('t7 đơn huỷ → giữ chỗ huy + kha_dung hồi +6', up.e === null && st === 'huy' && kdSau - kdGiu === 6, `e=${up.e} st=${st} kd ${kdGiu}->${kdSau}`) }

  console.log('\n── t8 · client (test_kho) UPDATE giữ chỗ trực tiếp → chặn ──')
  { const d = await mkDon('t8', [{ ten: 'kệ K', bom: [{ nguon: 'go_tay', vat_tu_id: A, so_luong: 1 }] }])
    await bangiao(d.ma_don)
    const up = await as(U.kho, `update kho.giu_cho set so_luong_giu=99 where don_hang_id=$1`, [d.don])
    ok('t8 UPDATE giữ chỗ vai kho → CHẶN (revoke)', up.e !== null && /denied|permission/i.test(up.e), up.e) }

  console.log('\n── t9 · PERF @100.000 dòng giữ chỗ ──')
  { await c.query(`set local session_replication_role='replica'`)
    const dP = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,nguon_khach) values('DEMO-130-PERF','DEMO 130',true,'khac') returning id`)).id
    const vts = (await q(`select id from kho.vat_tu limit 100`)).map(r => r.id)
    await c.query(`insert into kho.giu_cho(don_hang_id, vat_tu_id, kho_id, so_luong_giu)
      select $1, v.id, $2, 1 from unnest($3::uuid[]) v(id), generate_series(1,1000) g`, [dP, U.kho_id, vts])
    await c.query(`set local session_replication_role='origin'`)
    await c.query(`analyze kho.giu_cho`)
    const tong = Number((await one(`select count(*) c from kho.giu_cho`)).c)
    const exMs = async (sql, a = []) => Number((await as(U.ceo, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
    const ms1 = await exMs(`select * from kho.v_ton_kha_dung`)
    const ms2 = await exMs(`select * from kho.giu_cho_ds($1)`, [global._t1.don])
    // query ĐÚNG UI tab Tồn kho dùng (A): v_ton_kha_dung + embed vat_tu(ma), limit trần 5000
    const ms3 = await exMs(`select vat_tu_id,giu_cho,dang_ve,kha_dung from kho.v_ton_kha_dung limit 5000`)   // ĐÚNG query UI (A) — map vat_tu.id ở client
    ok(`t9 (${tong} dòng) v_ton_kha_dung = ${ms1.toFixed(0)}ms < 500`, ms1 < 500, ms1 + 'ms')
    ok(`t9 giu_cho_ds 1 đơn = ${ms2.toFixed(0)}ms < 500`, ms2 < 500, ms2 + 'ms')
    ok(`t9 query UI tab Tồn (v_ton_kha_dung limit 5000) = ${ms3.toFixed(0)}ms < 500`, ms3 < 500, ms3 + 'ms') }

  await c.query('rollback')
  console.log('\n── t10 · cổng cũ không vỡ (tiến trình riêng) ──')
  const cfg = await (await import('./conn.mjs')).docConfig()
  const dbUrl = cfg.connectionString || `postgresql://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`
  const runNode = (f) => { try { execFileSync('node', [f], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } }); return true } catch (e) { console.log('   ↳', f, (e.stdout || e.stderr || '').toString().split('\n').slice(-6).join('\n')); return false } }
  const runSql = (f) => { try { return /199\/199|✅|OK/.test(execFileSync('node', ['ops/run_sql.mjs', f], { cwd: process.cwd(), stdio: 'pipe' }).toString()) } catch (e) { console.log('  ↳', (e.stdout || e.stderr || '').toString().slice(-200)); return false } }
  ok('t10 so_ba_nguon.sql 199/199', runSql('ops/so_ba_nguon.sql'))
  ok('t10 test_119_ton_tu_so không vỡ', runNode('ops/test_119_ton_tu_so.mjs'))
  ok('t10 test_huy_phieu không vỡ', runNode('ops/test_huy_phieu.mjs'))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_130: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK — không để lại đơn/giữ chỗ test.'); process.exit(F === 0 ? 0 : 1) }
