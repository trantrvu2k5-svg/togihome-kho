// TEST PHẢI CẮN — 134 · WP-36 Đơn vị & hao hụt + thiếu-hệ-số-không-chặn (QD-55). Tx rollback. auth_uid test_*.
//   Cắn cả hai vế: (a) luu_tham_so_vat_tu (khổ→m2, hao, đơn vị tay, lịch sử, guard) ; (b) back-flush CHỜ hệ số → xuất bù.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { execFileSync } from 'node:child_process'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 180) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, eps = 0.01) => Math.abs(Number(a) - Number(b)) <= eps
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
const luu = (uid, vt, dai, rong, hao, dv = []) => as(uid, `select kho.luu_tham_so_vat_tu($1,$2,$3,$4,$5) g`, [vt, dai, rong, hao, JSON.stringify(dv)], true)
// dựng món quét-được + BOM chuẩn (chốt) + tem — bomChuan=[{vat_tu_id, so_luong, don_vi, so_luong_co_so|null}]
async function mkMon(sfx, bomChuan, giuCho = true) {
  await c.query(`set local session_replication_role='replica'`)
  const don = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,nguon_khach) values($1,'DEMO 134',true,'le','cho_cat','khac') returning id`, [`DEMO-134-${sfx}`])).id
  const mon = (await one(`insert into kho.don_hang_mon(don_id,so_luong,ten,ma_quy_trinh,dung_moi) values($1,1,'kệ 134','KE-HO-MELAMINE',false) returning id`, [don])).id
  for (const b of bomChuan) {
    const co = b.so_luong_co_so === undefined ? b.so_luong : b.so_luong_co_so   // undefined = identity; null = CHỜ
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,so_luong_co_so,he_so_ap_dung,don_vi,nguon,moc,chot_luc) values($1,$2,$3,$4,$5,$6,'cutlist','chuan',now())`,
      [mon, b.vat_tu_id, b.so_luong, co, co == null ? null : (co / b.so_luong), b.don_vi])
    if (giuCho && co != null) await c.query(`insert into kho.giu_cho(don_hang_id,don_hang_mon_id,vat_tu_id,kho_id,so_luong_giu) values($1,$2,$3,$4,$5)`, [don, mon, b.vat_tu_id, U.kho_id, co])
  }
  const tem = `T134-${sfx}`
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values($1,1,$2,'than',$3)`, [`DEMO-134-${sfx}`, tem, mon])
  await c.query(`set local session_replication_role='origin'`)
  return { don, mon, ma_don: `DEMO-134-${sfx}`, tem }
}
const moCa = async (tram) => { await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.ca_lam set ket_thuc=now() where nguoi_id=$1 and ket_thuc is null`, [U.tho_ns]); await c.query(`insert into kho.ca_lam(nguoi_id,ma_tram,bat_dau) values($1,$2,now())`, [U.tho_ns, tram]); await c.query(`set local session_replication_role='origin'`) }
const quet = (tem, tram) => as(U.kho, `select kho.quet_tem($1,$2) g`, [tem, tram], true)
async function explainMs(uid, sql, args = []) {   // Execution Time server-side (warm: gọi 1 lần trước)
  await c.query('savepoint p'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let ms = null
  try {
    await c.query(sql, args)   // warm
    const r = await c.query(`explain (analyze, format json, timing off, buffers off) ` + sql, args)
    ms = r.rows[0]['QUERY PLAN'][0]['Execution Time']
  } catch (x) { ms = 'ERR ' + x.message.slice(0, 80) }
  await c.query('rollback to savepoint p'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return ms
}

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  U.tho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_tho'`)).a
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.tho_ns = (await one(`select id from kho.nguoi_dung where ho_ten='test_tho'`)).id
  U.kho_id = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  const VAN = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and don_vi_co_so='tam' and ngung_dung=false order by ma limit 1 offset 0`)).id
  const VAN2 = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and don_vi_co_so='tam' and ngung_dung=false order by ma limit 1 offset 1`)).id
  const HES = 1 / (1220 * 2440 / 1e6)   // ≈ 0.335933 tấm / m²

  console.log('── C1 · khổ 1220×2440 → tự suy hệ số m² ──')
  { const r = await luu(U.kho, VAN, 1220, 2440, 10, [])
    ok('C1 luu OK', r.e === null, r.e)
    const u = await one(`select he_so from kho.vat_tu_don_vi where vat_tu_id=$1 and don_vi='m2'`, [VAN])
    ok('C1 m2 he_so ≈ 0.33593', u && near(u.he_so, HES, 1e-5), JSON.stringify(u) + ' mong ' + HES.toFixed(6))
    const v = await one(`select kho_dai_mm, kho_rong_mm, hao_hut_pct from kho.vat_tu where id=$1`, [VAN])
    ok('C1 lưu khổ + hao 10', Number(v.kho_dai_mm) === 1220 && Number(v.kho_rong_mm) === 2440 && Number(v.hao_hut_pct) === 10, JSON.stringify(v)) }

  console.log('\n── C2 · BOM 12 m² → so_co_so 4,03 · ceil sau 10% = 5 · dư 0,57 ──')
  { const M = await mkMon('c2', [{ vat_tu_id: VAN, so_luong: 12, don_vi: 'm2', so_luong_co_so: null }])
    const r = await as(U.kho, `select kho.thu_quy_doi_bom($1,$2) g`, [VAN, M.don])
    const g = r.r?.[0]?.g
    ok('C2 so_co_so ≈ 4,03', g?.co && near(g.so_co_so, 12 * HES, 0.01), JSON.stringify(g))
    ok('C2 so_xuat_ceil = 5', Number(g?.so_xuat_ceil) === 5, JSON.stringify(g))
    ok('C2 so_du_lam_tron ≈ 0,57', near(g?.so_du_lam_tron, 5 - 12 * HES * 1.1, 0.01), String(g?.so_du_lam_tron))
    ok('C2 thieu_he_so = false (đã có m²)', g?.thieu_he_so === false, JSON.stringify(g?.thieu_he_so)) }

  console.log('\n── C3 · hệ số ≤ 0 → RAISE ──')
  { const a = await luu(U.kho, VAN, null, null, null, [{ don_vi: 'hop', he_so: 0 }])
    const b = await luu(U.kho, VAN, null, null, null, [{ don_vi: 'hop', he_so: -1 }])
    ok('C3 he_so 0 và -1 đều RAISE', /phải > 0/.test(a.e || '') && /phải > 0/.test(b.e || ''), (a.e || '') + ' | ' + (b.e || '')) }

  console.log('\n── C4 · trùng đơn vị cơ sở → RAISE ──')
  { const r = await luu(U.kho, VAN, null, null, null, [{ don_vi: 'tam', he_so: 2 }])
    ok('C4 don_vi cơ sở "tam" RAISE', /đơn vị cơ sở/.test(r.e || ''), r.e) }

  console.log('\n── C5 · hao hụt 150 → RAISE ──')
  { const r = await luu(U.kho, VAN, null, null, 150, [])
    ok('C5 hao 150 RAISE', /\[0,100\]/.test(r.e || ''), r.e) }

  console.log('\n── C6 · lịch sử 1 dòng/trường (đổi thật) + append-only ──')
  { const cur = Number((await one(`select hao_hut_pct h from kho.vat_tu where id=$1`, [VAN])).h)   // VAN đã có khổ (C1) + hao (mặc định ván 10)
    const haoMoi = cur === 7 ? 8 : 7                                                                // đảm bảo KHÁC → sinh dòng lịch sử
    const r = await luu(U.kho, VAN, 1220, 2440, haoMoi, [])
    ok('C6 luu đổi hao OK', r.e === null, r.e)
    const rows = await q(`select truong from kho.vat_tu_tham_so_lich_su where vat_tu_id=$1 group by truong`, [VAN])
    const tru = rows.map(x => x.truong).sort().join(',')
    ok('C6 có lịch sử kho_dai + kho_rong (C1) + hao_hut (C6)', tru === 'hao_hut_pct,kho_dai_mm,kho_rong_mm', tru)
    const hr = await one(`select gia_tri_cu, gia_tri_moi from kho.vat_tu_tham_so_lich_su where vat_tu_id=$1 and truong='hao_hut_pct' order by id desc limit 1`, [VAN])
    ok('C6 dòng hao ghi cũ→mới', Number(hr.gia_tri_cu) === cur && Number(hr.gia_tri_moi) === haoMoi, JSON.stringify(hr) + ` mong ${cur}→${haoMoi}`)
    // append-only: (a) trigger chặn owner/service ; (b) GRANT chặn authenticated (kho/ceo) — phòng thủ hai lớp
    const id = (await one(`select id from kho.vat_tu_tham_so_lich_su where vat_tu_id=$1 limit 1`, [VAN])).id
    const eTrig = await (async () => { await c.query('savepoint t6'); try { await c.query(`update kho.vat_tu_tham_so_lich_su set truong='x' where id=$1`, [id]); await c.query('release savepoint t6'); return null } catch (e) { await c.query('rollback to savepoint t6'); return e.message } })()
    ok('C6 UPDATE (owner) → trigger append-only RAISE', /append-only/.test(eTrig || ''), eTrig)
    const eGrant = await as(U.ceo, `delete from kho.vat_tu_tham_so_lich_su where id=$1`, [id])
    ok('C6 DELETE (vai ceo) → GRANT chặn', /denied|permission|append-only/i.test(eGrant.e || ''), eGrant.e) }

  console.log('\n── C7 · quét CẮT thiếu hệ số → sổ quét CÓ, phiếu KHÔNG, quet_tem trả thieu_he_so ──')
  await moCa('TRAM-CAT-01')
  const M7 = await mkMon('c7', [{ vat_tu_id: VAN2, so_luong: 12, don_vi: 'm2', so_luong_co_so: null }])
  { const r = await quet(M7.tem, 'TRAM-CAT-01')
    const g = r.r?.[0]?.g
    const sk = await one(`select count(*) c from kho.su_kien_quet where tem_ma=$1 and ket_qua='nhan'`, [M7.tem])
    const ph = await one(`select count(*) c from kho.phieu where mon_id=$1 and nhom_back_flush='van' and loai='xuat_sx'`, [M7.mon])
    ok('C7 quét NHẬN (không chặn thợ)', g?.ket_qua === 'nhan', JSON.stringify(g))
    ok('C7 su_kien_quet CÓ (1)', Number(sk.c) === 1, JSON.stringify(sk))
    ok('C7 phiếu ván KHÔNG (0)', Number(ph.c) === 0, JSON.stringify(ph))
    ok('C7 quet_tem trả thieu_he_so (có VAN2)', Array.isArray(g?.thieu_he_so) && g.thieu_he_so.some(x => x.don_vi_bom === 'm2'), JSON.stringify(g?.thieu_he_so))
    ok('C7 back_flush dong rỗng', Array.isArray(g?.back_flush) && g.back_flush.length === 0, JSON.stringify(g?.back_flush)) }

  console.log('\n── C8 · nhập hệ số → chay_lai_back_flush xuất 5 tấm; lần 2 không thêm ──')
  { const r1 = await luu(U.kho, VAN2, 1220, 2440, 10, [])
    ok('C8 luu VAN2 → tem_xuat_bu = 1', r1.r?.[0]?.g?.tem_xuat_bu === 1, JSON.stringify(r1.r?.[0]?.g) + (r1.e ? ' ERR ' + r1.e : ''))
    const ph = await one(`select id, so_phieu from kho.phieu where mon_id=$1 and nhom_back_flush='van' and loai='xuat_sx'`, [M7.mon])
    ok('C8 phiếu ván bù đã tạo', !!ph, JSON.stringify(ph))
    const gd = await one(`select coalesce(sum(so_luong),0) s from kho.giao_dich where phieu_id=$1 and vat_tu_id=$2`, [ph?.id, VAN2])
    ok('C8 Σgiao_dich VAN2 = -5 tấm (ceil 4,03×1,1)', Number(gd?.s) === -5, JSON.stringify(gd))
    const r2 = await luu(U.kho, VAN2, 1220, 2440, 10, [])
    ok('C8 lần 2 tem_xuat_bu = 0 (idempotent)', r2.r?.[0]?.g?.tem_xuat_bu === 0, JSON.stringify(r2.r?.[0]?.g)) }

  console.log('\n── C9 · so ba nguồn tồn = 100% (không lệch sau WP-36) ──')
  { const runSql = (f) => { try { return /199\/199|✅|OK/.test(execFileSync('node', ['ops/run_sql.mjs', f], { cwd: process.cwd(), stdio: 'pipe' }).toString()) } catch (e) { console.log('  ↳', (e.stdout || e.stderr || '').toString().slice(-200)); return false } }
    ok('C9 so_ba_nguon.sql khớp', runSql('ops/so_ba_nguon.sql')) }

  console.log('\n── C10 · vai tho gọi luu_tham_so → RAISE (chỉ kho/ceo) ──')
  { const r = await luu(U.tho, VAN, 1220, 2440, 10, [])
    ok('C10 vai tho RAISE', /chỉ kho\/ceo/.test(r.e || ''), r.e) }

  console.log('\n── C11 · đổi hệ số SAU snapshot → so_luong_co_so cũ KHÔNG đổi ──')
  { const M = await mkMon('c11', [{ vat_tu_id: VAN, so_luong: 12, don_vi: 'm2', so_luong_co_so: 4 }])   // snapshot cứng = 4
    await luu(U.kho, VAN, 1000, 2000, 10, [])   // đổi khổ → hệ số m² khác
    const b = await one(`select so_luong_co_so from kho.don_hang_mon_bom where mon_id=$1 and vat_tu_id=$2`, [M.mon, VAN])
    ok('C11 so_luong_co_so vẫn = 4 (snapshot bất biến)', Number(b.so_luong_co_so) === 4, JSON.stringify(b)) }

  console.log('\n── C12 · view compat quy_doi còn đọc được (kho/ceo) ──')
  { const r = await as(U.kho, `select count(*) c from kho.quy_doi`)
    ok('C12 select quy_doi (view) OK', r.e === null && r.r?.[0] != null, r.e)
    const t = await one(`select to_regclass('kho.plugin_ma_map') a, to_regclass('kho.quy_doi') b`)
    ok('C12 plugin_ma_map + view quy_doi tồn tại', !!t.a && !!t.b, JSON.stringify(t)) }

  console.log('\n── C13 · nhãn thiếu-hệ-số ở tham_so_vat_tu_ds TỰ TẮT sau khi nhập (snapshot vẫn NULL) ──')
  { const VAN3 = (await one(`select id from kho.vat_tu where kho.la_nhom_van(nhom_id) and don_vi_co_so='tam' and ngung_dung=false order by ma limit 1 offset 2`)).id
    await mkMon('c13', [{ vat_tu_id: VAN3, so_luong: 12, don_vi: 'm2', so_luong_co_so: null }])   // pending, VAN3 chưa hệ số
    const ds1 = (await as(U.kho, `select kho.tham_so_vat_tu_ds() g`)).r[0].g
    const t1 = ds1.find(v => v.id === VAN3)
    ok('C13 trước nhập: thieu_he_so = true', t1?.thieu_he_so === true, JSON.stringify(t1?.thieu_he_so))
    await luu(U.kho, VAN3, 1220, 2440, 10, [])
    const ds2 = (await as(U.kho, `select kho.tham_so_vat_tu_ds() g`)).r[0].g
    const t2 = ds2.find(v => v.id === VAN3)
    ok('C13 sau nhập: thieu_he_so = false (nhãn tắt dù BOM snapshot vẫn NULL)', t2?.thieu_he_so === false, JSON.stringify(t2?.thieu_he_so))
    const bomNull = await one(`select so_luong_co_so from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id join kho.don_hang dh on dh.id=m.don_id where dh.ma_don='DEMO-134-c13' and b.vat_tu_id=$1`, [VAN3])
    ok('C13 BOM snapshot VẪN NULL (không đụng)', bomNull.so_luong_co_so === null, JSON.stringify(bomNull)) }

  console.log('\n── PERF ──')
  { // phân bố THỰC: 25k mã ngừng-dùng × 4 đơn vị = 100k dòng trong bảng, mỗi mã ít đơn vị (không phải 500/mã ảo).
    await c.query(`set local session_replication_role='replica'`)
    const loai = (await one(`select loai from kho.vat_tu limit 1`)).loai
    await c.query(`insert into kho.vat_tu(id,ma,ten,loai,don_vi_co_so,ngung_dung) select gen_random_uuid(),'ZZN'||g,'noise',$1,'tam',true from generate_series(1,25000) g`, [loai])
    await c.query(`insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) select v.id,'u'||u.n,1 from kho.vat_tu v cross join generate_series(1,4) u(n) where v.ma like 'ZZN%'`)
    await c.query(`set local session_replication_role='origin'`)
    const n = Number((await one(`select count(*) c from kho.vat_tu_don_vi`)).c)
    const ms = await explainMs(U.kho, `select kho.tham_so_vat_tu_ds()`)
    ok(`PERF tham_so_vat_tu_ds @${n} vat_tu_don_vi = ${typeof ms === 'number' ? ms.toFixed(0) : ms}ms < 500`, typeof ms === 'number' && ms < 500, ms) }

  { await c.query(`set local session_replication_role='replica'`)
    await c.query(`insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua) select 'noise'||g.n, 'TRAM-CAT-01', $1, 'vao','nhan' from generate_series(1,100000) g(n)`, [U.tho_ns])
    await c.query(`set local session_replication_role='origin'`)
    const n = Number((await one(`select count(*) c from kho.su_kien_quet`)).c)
    await moCa('TRAM-CAT-01')
    const Mp = await mkMon('perf', [{ vat_tu_id: VAN, so_luong: 12, don_vi: 'm2', so_luong_co_so: 4 }])
    const ms = await explainMs(U.kho, `select kho.quet_tem($1,'TRAM-CAT-01')`, [Mp.tem])
    ok(`PERF quet_tem @${n} su_kien_quet = ${typeof ms === 'number' ? ms.toFixed(0) : ms}ms < 300`, typeof ms === 'number' && ms < 300, ms) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_134: ${P} pass / ${F} fail`)
  console.log('xác nhận: tx ROLLBACK — không để lại vật tư/đơn/BOM/lịch sử test.')
} catch (e) { console.error('💥', e.message); F++ }
finally { try { await c.query('rollback') } catch (_) {} await c.end(); process.exit(F ? 1 : 0) }
