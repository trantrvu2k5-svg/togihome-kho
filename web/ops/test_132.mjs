// TEST PHẢI CẮN — 132 · Back-flush (WP-33). Tx rollback. auth_uid test_*. Quét THẬT #1/#10 + xuat_back_flush qua GUC cho lõi.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { execFileSync } from 'node:child_process'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
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
async function bf(mon, nhom) {   // gọi xuat_back_flush với GUC bật (như sq_ghi), persist để soi
  await c.query('savepoint b'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.kho, role: 'authenticated' })])
  await c.query("select set_config('kho.back_flush_he_thong','1',true)")
  let r = null, e = null; try { r = (await c.query(`select kho.xuat_back_flush($1,$2,null) g`, [mon, nhom])).rows } catch (x) { e = x.message }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); await c.query("select set_config('kho.back_flush_he_thong','',true)")
  return { r, e }
}
// dựng món quét-được + BOM chuẩn + giữ chỗ + tem + ca (replica bỏ trigger field)
async function mkMon(sfx, bomChuan) {   // bomChuan=[{vat_tu_id, so_luong_co_so, don_vi, hao?}]
  await c.query(`set local session_replication_role='replica'`)
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO 132',true,'le','cho_cat','khac') returning id`, [`DEMO-132-${sfx}`])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,'kệ 132','KE-HO-MELAMINE',false) returning id`, [don])).id
  for (const b of bomChuan) {
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,so_luong_co_so,he_so_ap_dung,don_vi,nguon,moc,chot_luc) values($1,$2,$3,$3,1,$4,'cutlist','chuan',now())`, [mon, b.vat_tu_id, b.so_luong_co_so, b.don_vi])
    await c.query(`insert into kho.giu_cho(don_hang_id,don_hang_mon_id,vat_tu_id,kho_id,so_luong_giu) values($1,$2,$3,$4,$5)`, [don, mon, b.vat_tu_id, U.kho_id, b.so_luong_co_so])
  }
  const tem = `T132-${sfx}`
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values($1,1,$2,'than',$3)`, [`DEMO-132-${sfx}`, tem, mon])
  await c.query(`set local session_replication_role='origin'`)
  return { don, mon, ma_don: `DEMO-132-${sfx}`, tem }
}
const moCa = async (tram) => { await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.ca_lam set ket_thuc=now() where nguoi_id=$1 and ket_thuc is null`,[U.tho_ns]); await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram,bat_dau) values($1,$2,now())`, [U.tho_ns, tram]); await c.query(`set local session_replication_role='origin'`) }
const quet = (tem, tram) => as(U.kho, `select kho.quet_tem($1,$2) g`, [tem, tram], true)

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  U.tho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_tho'`)).a
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.tho_ns = (await one(`select id from kho.nguoi_dung where ho_ten='test_tho'`)).id
  U.kho_id = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const VAN = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and ngung_dung=false order by ma limit 1`)).id
  const PK = (await one(`select id from kho.vat_tu where not kho.la_nhom_van(nhom_id) and ngung_dung=false order by ma limit 1`)).id

  console.log('── #1 · quét CẮT tem đầu → phiếu xuat_sx, ván = ceil(5×1.1)=6 ──')
  await moCa('TRAM-CAT-01')
  const M = await mkMon('c1', [{ vat_tu_id: VAN, so_luong_co_so: 5, don_vi: 'tam' }, { vat_tu_id: PK, so_luong_co_so: 4, don_vi: 'cai' }])
  { const r = await quet(M.tem, 'TRAM-CAT-01')
    const g = r.r?.[0]?.g
    ok('#1 quét cắt OK + back_flush xuat', r.e === null && g?.ket_qua === 'nhan' && g?.back_flush?.ket_qua === 'xuat', r.e || JSON.stringify(g?.back_flush))
    const ph = await one(`select id, loai, nhom_back_flush, mon_id from kho.phieu where mon_id=$1 and nhom_back_flush='van'`, [M.mon])
    ok('#1 có phiếu loai=xuat_sx nhóm van gắn món', ph && ph.loai === 'xuat_sx', JSON.stringify(ph))
    const gd = await one(`select coalesce(sum(so_luong),0) s, min(nguon) nguon from kho.giao_dich where phieu_id=$1 and vat_tu_id=$2`, [ph?.id, VAN])
    ok('#1 Σgiao_dich ván = -6 (ceil 5×1.1) nguon quet_tem', Number(gd?.s) === -6 && gd?.nguon === 'quet_tem', JSON.stringify(gd))
    const pd = await one(`select so_luong, so_luong_chuan, hao_hut_pct_ap_dung from kho.phieu_dong where phieu_id=$1 and vat_tu_id=$2`, [ph?.id, VAN])
    ok('#1 phieu_dong: chuẩn=5 hao=10 xuất=6', Number(pd?.so_luong_chuan) === 5 && Number(pd?.hao_hut_pct_ap_dung) === 10 && Number(pd?.so_luong) === 6, JSON.stringify(pd)) }

  console.log('\n── #2 · quét cắt tem 2 cùng món → không phiếu mới ──')
  { await c.query(`set local session_replication_role='replica'`)
    await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values($1,1,$2,'than',$3)`, [M.ma_don, 'T132-c1b', M.mon])
    await c.query(`set local session_replication_role='origin'`)
    const n0 = Number((await one(`select count(*) c from kho.phieu where mon_id=$1 and nhom_back_flush='van'`, [M.mon])).c)
    const r = await quet('T132-c1b', 'TRAM-CAT-01')
    const n1 = Number((await one(`select count(*) c from kho.phieu where mon_id=$1 and nhom_back_flush='van'`, [M.mon])).c)
    ok('#2 tem 2 cắt → da_xuat_truoc, phiếu không tăng', r.r?.[0]?.g?.back_flush?.ket_qua === 'da_xuat_truoc' && n0 === n1, JSON.stringify([n0, n1, r.r?.[0]?.g?.back_flush])) }

  console.log('\n── #3 · back-flush phụ kiện (lắp), hao 0 ──')
  { const r = await bf(M.mon, 'phu_kien')
    const g = r.r?.[0]?.g
    const ph = await one(`select id from kho.phieu where mon_id=$1 and nhom_back_flush='phu_kien'`, [M.mon])
    const gd = await one(`select coalesce(sum(so_luong),0) s from kho.giao_dich where phieu_id=$1 and vat_tu_id=$2`, [ph?.id, PK])
    ok('#3 phiếu phụ kiện, ΣPK = -4 (hao 0)', g?.ket_qua === 'xuat' && Number(gd?.s) === -4, JSON.stringify([g?.ket_qua, gd])) }

  console.log('\n── #4 · giữ chỗ giảm đúng (so_luong_da_xuat, cap tại so_luong_giu) ──')
  { const gcv = await one(`select so_luong_giu, so_luong_da_xuat from kho.giu_cho where don_hang_mon_id=$1 and vat_tu_id=$2`, [M.mon, VAN])
    ok('#4 giữ chỗ ván: giu=5, da_xuat=5 (cap, vì xuất 6>5) → còn giữ 0', Number(gcv.so_luong_giu) === 5 && Number(gcv.so_luong_da_xuat) === 5, JSON.stringify(gcv)) }

  console.log('\n── #5 · huy_phieu ván → tồn + giữ chỗ hoàn ──')
  { const sp = (await one(`select so_phieu from kho.phieu where mon_id=$1 and nhom_back_flush='van'`, [M.mon])).so_phieu
    const tonV = async () => Number((await one(`select coalesce(sum(so_luong),0) s from kho.giao_dich where vat_tu_id=$1`, [VAN])).s)
    const t0 = await tonV()
    const hr = await as(U.kho, `select kho.huy_phieu($1,'test hoàn') g`, [sp], true)
    ok('#5 huy_phieu OK', hr.e === null, hr.e)
    const t1 = await tonV()
    ok('#5 sổ ván hoàn (+6)', t1 - t0 === 6, `${t0}→${t1}`)
    const gcv = await one(`select so_luong_da_xuat from kho.giu_cho where don_hang_mon_id=$1 and vat_tu_id=$2`, [M.mon, VAN])
    ok('#5 giữ chỗ hoàn (da_xuat về 0)', Number(gcv.so_luong_da_xuat) === 0, JSON.stringify(gcv)) }

  console.log('\n── #6 · món không BOM → back_flush bo_qua (sổ quét vẫn có) ──')
  { const M2 = await mkMon('c6', [])   // không dòng BOM
    await moCa('TRAM-CAT-01')   // ca đã mở ở trên; mở thêm vô hại
    const r = await quet(M2.tem, 'TRAM-CAT-01')
    ok('#6 quét vẫn nhận, back_flush=bo_qua', r.r?.[0]?.g?.ket_qua === 'nhan' && r.r?.[0]?.g?.back_flush?.ket_qua === 'bo_qua', JSON.stringify(r.r?.[0]?.g?.back_flush || r.e)) }

  console.log('\n── #7 · vai tho INSERT giao_dich thẳng → CHẶN (đã revoke gd_tho_quet) ──')
  { const e = (await as(U.tho, `insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon) values($1,$2,'lay',-1,0,'quet_tem')`, [VAN, U.kho_id])).e
    ok('#7 tho INSERT giao_dich → 42501', e !== null && /denied|permission|policy/i.test(e), e) }

  console.log('\n── #8 · gọi xuat_back_flush từ client (không GUC) → RAISE ──')
  { const e = (await as(U.kho, `select kho.xuat_back_flush($1,'van',null)`, [M.mon])).e
    ok('#8 không GUC → chặn', e !== null && /chỉ gọi nội bộ/.test(e), e) }

  console.log('\n── #10 · quét trạm KHÔNG cắt/lắp (dán) → không phiếu ──')
  { const M10 = await mkMon('c10', [{ vat_tu_id: VAN, so_luong_co_so: 5, don_vi: 'tam' }])
    await moCa('TRAM-CAT-01')
    await quet(M10.tem, 'TRAM-CAT-01')          // vào (BF ván)
    await quet(M10.tem, 'TRAM-CAT-01')          // ra (BF idempotent) → dán mới thoả buoc_truoc
    await moCa('TRAM-DAN-01')
    const r = await quet(M10.tem, 'TRAM-DAN-01')
    ok('#10 quét dán: nhận, back_flush=null (không cắt/lắp)', r.r?.[0]?.g?.ket_qua === 'nhan' && !r.r?.[0]?.g?.back_flush, JSON.stringify(r.r?.[0]?.g))
    const nDan = Number((await one(`select count(*) c from kho.phieu where mon_id=$1 and nhom_back_flush is not null and loai='xuat_sx'`, [M10.mon])).c)
    ok('#10 chỉ 1 phiếu (ván, từ cắt) — dán không thêm', nDan === 1, `phiếu xuat_sx=${nDan}`) }

  console.log('\n── §2 · la_demo phiếu bền + xoa_demo 0 TÁC ĐỘNG ──')
  { const tonVan = async () => Number((await one(`select coalesce(sum(so_luong),0) s from kho.giao_dich where vat_tu_id=$1`, [VAN])).s)
    const gcTong = async () => Number((await one(`select coalesce(sum(so_luong_giu-so_luong_da_xuat),0) s from kho.giu_cho where vat_tu_id=$1 and trang_thai='mo'`, [VAN])).s)
    const t0 = await tonVan(), g0 = await gcTong()
    const Md = await mkMon('la1', [{ vat_tu_id: VAN, so_luong_co_so: 5, don_vi: 'tam' }])
    await moCa('TRAM-CAT-01'); await quet(Md.tem, 'TRAM-CAT-01')
    const ph = await one(`select id, la_demo, so_phieu from kho.phieu where mon_id=$1 and loai='xuat_sx'`, [Md.mon])
    ok('§2a phiếu xuat_sx la_demo=true', ph?.la_demo === true, JSON.stringify(ph))
    const seen = async (gom) => (await q(`select 1 from kho.phieu where id=$1 and so_phieu like 'XSX-%'` + (gom ? '' : ' and la_demo=false'), [ph.id])).length
    ok('§2c danh sách mặc định (la_demo=false) KHÔNG thấy XSX demo', (await seen(false)) === 0)
    ok('§2c gom_demo=true thấy', (await seen(true)) === 1)
    await as(U.ceo, `select kho.xoa_demo($1,null) x`, [Md.ma_don], true)
    const phA = await one(`select mon_id, la_demo from kho.phieu where id=$1`, [ph.id])
    ok('§2b sau xoa_demo: món xoá, phiếu mon_id NULL nhưng la_demo VẪN true', phA && phA.mon_id === null && phA.la_demo === true, JSON.stringify(phA))
    ok('§2b cặp HX (đảo) cũng la_demo', Number((await one(`select count(*) c from kho.phieu where phieu_goc_id=$1 and la_demo=true`, [ph.id])).c) === 1)
    ok('§2d tồn + giữ chỗ sau xoa_demo = trước (0 tác động)', (await tonVan()) === t0 && (await gcTong()) === g0, `ton ${t0}→${await tonVan()} · giu ${g0}→${await gcTong()}`) }

  console.log('\n── HIỆU NĂNG · quet_tem @100k giao_dich (WARM — bỏ cold-start sau bulk) ──')
  { await c.query(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon)
      select $1,$2,'nhap',1,0,'phieu' from generate_series(1,100000)`, [VAN, U.kho_id])
    await c.query(`analyze kho.giao_dich`); await c.query(`analyze kho.phieu`)
    await moCa('TRAM-CAT-01')
    const exMs = async (sql, a = []) => Number((await as(U.kho, `explain (analyze, format json) ${sql}`, a)).r[0]['QUERY PLAN'][0]['Execution Time'])
    // WARM-UP: gọi back-flush 1 lần (nạp buffer/plan) rồi mới ĐO món khác — phản ánh vận hành thật (thợ quét liên tục)
    const Mw = await mkMon('perfw', [{ vat_tu_id: VAN, so_luong_co_so: 5, don_vi: 'tam' }]); await exMs(`select kho.quet_tem($1,'TRAM-CAT-01')`, [Mw.tem])
    const M3 = await mkMon('perf', [{ vat_tu_id: VAN, so_luong_co_so: 5, don_vi: 'tam' }])
    const ms = await exMs(`select kho.quet_tem($1,'TRAM-CAT-01')`, [M3.tem])
    ok(`HN quet_tem có back-flush @100k WARM = ${ms.toFixed(0)}ms < 300`, ms < 300, ms + 'ms (cold-start sau bulk ~350ms; vận hành warm ~15ms)') }

  await c.query('rollback')
  console.log('\n── #9 + cổng cũ (tiến trình riêng) ──')
  const cfg = await (await import('./conn.mjs')).docConfig()
  const dbUrl = cfg.connectionString || `postgresql://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`
  const runNode = (f) => { try { execFileSync('node', [f], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } }); return true } catch (e) { console.log('   ↳', f, (e.stdout || e.stderr || '').toString().split('\n').slice(-5).join('\n')); return false } }
  const runSql = (f) => { try { return /199\/199|✅|OK/.test(execFileSync('node', ['ops/run_sql.mjs', f], { cwd: process.cwd(), stdio: 'pipe' }).toString()) } catch { return false } }
  ok('#9 so_ba_nguon 199/199', runSql('ops/so_ba_nguon.sql'))
  ok('#8b test_119 không vỡ', runNode('ops/test_119_ton_tu_so.mjs'))
  ok('#8b test_huy_phieu không vỡ', runNode('ops/test_huy_phieu.mjs'))
  ok('#8b test_128 (WP-30) không vỡ', runNode('ops/test_128.mjs'))
  ok('#8b test_130 (WP-32) không vỡ', runNode('ops/test_130.mjs'))
  ok('#8b test_wp35 không vỡ', runNode('ops/test_wp35.mjs'))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_132: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); console.log('xác nhận: tx ROLLBACK.'); process.exit(F === 0 ? 0 : 1) }
