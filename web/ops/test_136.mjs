// TEST PHẢI CẮN — 136 · WP-25 lô nhập về đơn vị cơ sở (QD-53). Tx rollback. auth_uid test_*.
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { execFileSync } from 'node:child_process'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps
let U = {}, NCC, KHO, NHOM, LOAI
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function mkVT(ma, dvt, base, hao = 0, m2 = null) {
  const id = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,hao_hut_pct) values($1,$1,$2,$3,$4,false,$5,$6) returning id`, [ma, LOAI, base, dvt, NHOM, hao])).id
  if (m2) await c.query(`insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values($1,'m2',$2)`, [id, m2])
  return id
}
async function mkDonNhan(vt, sl, dg, nhan) {   // dm_tao→da_gui→xac_nhan→dm_nhan_hang(nhan)
  const r = await as(U.ceo, `select kho.dm_tao($1,$2,null,'wp25',$3::jsonb,false) g`, [NCC, KHO, JSON.stringify([{ vat_tu_id: vt, so_luong: sl, don_gia: dg }])], true)
  if (r.e) throw new Error('dm_tao: ' + r.e)
  const don = r.r[0].g.id, dong = (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [don])).id
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_gui')`, [don], true)
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'xac_nhan')`, [don], true)
  const rn = await as(U.ceo, `select kho.dm_nhan_hang($1,$2::jsonb) g`, [don, JSON.stringify([{ dong_id: dong, so_luong: nhan }])], true)
  return { don, dong, err: rn.e, res: rn.r?.[0]?.g }
}
const loLive = vt => q(`select id, con_lai, gia_von_lo, he_so_ap_dung, don_vi_nguon, so_luong_nguon from kho.lo_nhap where vat_tu_id=$1 and lo_da_huy=false order by tao_luc, id`, [vt])
const tonOf = async vt => Number((await one(`select coalesce(so_luong,0) s from kho.ton where vat_tu_id=$1`, [vt]) || { s: 0 }).s)

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  NCC = (await one(`select id from kho.nha_cung_cap order by ten limit 1`)).id
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  NHOM = (await one(`select id from kho.nhom limit 1`)).id
  LOAI = (await one(`select loai from kho.vat_tu where loai is not null limit 1`)).loai

  console.log('── a · nhận 10 m² (he_so 0,336) → lô cơ sở 3,36 tấm · giá/tấm 297.619 · ton 3,36 ──')
  const A = await mkVT('WP25-A', 'mét vuông', 'tam', 0, 0.336)
  const da = await mkDonNhan(A, 10, 100000, 10)
  { ok('a dm_nhan_hang OK', !da.err, da.err)
    const l = (await loLive(A))[0]
    ok('a con_lai = 3,36 (cơ sở, KHÔNG làm tròn)', l && near(l.con_lai, 3.36, 0.001), JSON.stringify(l))
    ok('a gia_von_lo ≈ 297.619,05 (=100.000/0,336)', l && near(l.gia_von_lo, 297619.05, 0.02), l && l.gia_von_lo)
    ok('a snapshot: he_so 0,336 · nguồn m2 · so_luong_nguon 10', l && near(l.he_so_ap_dung, 0.336, 1e-6) && l.don_vi_nguon === 'm2' && Number(l.so_luong_nguon) === 10, JSON.stringify(l))
    ok('a ton = 3,36', near(await tonOf(A), 3.36, 0.001), await tonOf(A)) }

  console.log('\n── b · khớp HĐ chưa VAT 90.000/m² → gia_von_lo = 267.857,14 (÷ hệ số lúc nhận) ──')
  { const r = await as(U.ceo, `select kho.hd_ncc_ghi($1,'HD-A','hoa_don_vat',current_date,current_date+30,10,'x',$2::jsonb) g`,
      [da.don, JSON.stringify([{ don_mua_dong_id: da.dong, so_luong: 10, don_gia_hd: 90000 }])], true)
    ok('b hd_ncc_ghi OK', !r.e, r.e)
    const l = (await loLive(A))[0]
    ok('b gia_von_lo ≈ 267.857,14 (=90.000/0,336)', near(l.gia_von_lo, 267857.14, 0.02), l && l.gia_von_lo) }

  console.log('\n── c · back-flush/xuất FIFO theo CƠ SỞ (ghi_so_phieu xuat_sx) — trừ đúng, đa-lô hết lô cũ trước ──')
  { await as(U.ceo, `select kho.ghi_so_phieu('xuat_sx',null,'BF 2 tấm',null,$1::jsonb,null)`, [JSON.stringify([{ vat_tu_id: A, so_luong: 2 }])], true)
    const l1 = (await loLive(A))[0]
    ok('c xuất 2 tấm → lô còn 1,36', near(l1.con_lai, 1.36, 0.001), l1 && l1.con_lai)
    // tx test dùng chung now() → 2 lô cùng tao_luc, FIFO tiebreak theo id (uuid) → nhấp nháy. Prod: 2 lần nhận khác tx → tao_luc khác.
    // Lùi tao_luc lô1 cho GIÀ hơn → FIFO xác định (lô cũ trước), khớp hành vi prod.
    await c.query(`update kho.lo_nhap set tao_luc = tao_luc - interval '1 day' where id=$1`, [l1.id])
    await mkDonNhan(A, 10, 100000, 10)   // lô 2 (thêm 3,36), tao_luc mới hơn
    await as(U.ceo, `select kho.ghi_so_phieu('xuat_sx',null,'BF 2 tấm nữa',null,$1::jsonb,null)`, [JSON.stringify([{ vat_tu_id: A, so_luong: 2 }])], true)
    const ls = await loLive(A)
    ok('c FIFO: lô cũ về 0 trước, lô sau còn 2,72', near(ls[0].con_lai, 0, 0.001) && near(ls[1].con_lai, 2.72, 0.001), JSON.stringify(ls.map(x => x.con_lai))) }

  console.log('\n── d · huỷ phiếu nhận → lô đảo 0, ton 0 (cơ sở) ──')
  { const D = await mkVT('WP25-D', 'mét vuông', 'tam', 0, 0.336)
    const dd = await mkDonNhan(D, 10, 100000, 4)   // nhận MỘT PHẦN → đơn xac_nhan → phiếu huỷ được
    ok('d nhận 4 m² → lô 1,344 · ton 1,344', near((await loLive(D))[0].con_lai, 1.344, 0.001) && near(await tonOf(D), 1.344, 0.001))
    const rh = await as(U.ceo, `select kho.huy_phieu($1,'test WP-25') g`, [dd.res.so_phieu], true)
    ok('d huy_phieu OK', !rh.e, rh.e)
    ok('d sau huỷ: lô sống 0 · ton 0', (await loLive(D)).length === 0 && near(await tonOf(D), 0, 0.001), 'ton=' + await tonOf(D)) }

  console.log('\n── e · vật tư base = đơn vị đơn mua (hệ số 1) → không đổi ──')
  { const E = await mkVT('WP25-E', 'thanh', 'thanh', 0)
    const de = await mkDonNhan(E, 5, 20000, 5)
    const l = (await loLive(E))[0]
    ok('e con_lai = 5 · gia = 20.000 · he_so 1', near(l.con_lai, 5, 1e-6) && near(l.gia_von_lo, 20000, 1e-6) && near(l.he_so_ap_dung, 1, 1e-6), JSON.stringify(l)) }

  console.log('\n── f · đơn vị lạ → RAISE NGAY ở dm_tao (db/137 trigger dvt, phát sinh L-80), không tạo đơn/lô ──')
  { const Ff = await mkVT('WP25-F', 'donvila', 'tam', 0)   // dvt lạ, không có trong don_vi/vat_tu_don_vi
    const r = await as(U.ceo, `select kho.dm_tao($1,$2,null,'wp25f',$3::jsonb,false) g`, [NCC, KHO, JSON.stringify([{ vat_tu_id: Ff, so_luong: 3, don_gia: 1000 }])])
    ok('f dm_tao RAISE (đơn vị lạ) — chặn từ khâu tạo PO', /đơn vị|không hợp lệ|QD-53/.test(r.e || ''), r.e)
    ok('f không tạo lô', (await loLive(Ff)).length === 0) }

  console.log('\n── g · VẾ SAI: nếu lô còn theo m² (10) là SAI — phải KHÁC 10 (đã về cơ sở) ──')
  { const l = (await loLive(A))
    ok('g con_lai KHÔNG phải 10 m² (đã quy cơ sở)', l.every(x => Number(x.con_lai) !== 10), JSON.stringify(l.map(x => x.con_lai))) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_136: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally { try { await c.query('rollback') } catch (_) {} await c.end() }

// ── REGRESSION (ngoài tx, đọc prod thật) ──
console.log('\n── HỒI QUY ──')
const run = (f, re = /🟢|pass|khớp|OK|\d+\/\d+/) => {
  try {
    const out = execFileSync('node', ['ops/' + f], { cwd: process.cwd(), stdio: 'pipe', timeout: 240000 }).toString()
    const m = out.match(/(\d+) pass \/ (\d+) fail/) || out.match(/(\d+)\/(\d+)/)
    console.log(`✅ ${f}: ` + (m ? m[0] : (re.test(out) ? 'OK' : '?')))
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString(); const m = out.match(/(\d+) pass \/ (\d+) fail/)
    console.log(`❌ ${f}: ` + (m ? m[0] : 'LỖI ' + out.split('\n').slice(-4).join(' ').slice(0, 140)))
  }
}
try { const o = execFileSync('node', ['ops/run_sql.mjs', 'ops/so_ba_nguon.sql'], { cwd: process.cwd(), stdio: 'pipe' }).toString(); console.log('✅ so_ba_nguon: ' + (/CHẠY XONG/.test(o) ? 'KHỚP' : 'LỆCH')) } catch (e) { console.log('❌ so_ba_nguon: LỆCH ' + ((e.stdout || e.stderr || '') + '').slice(-120)) }
for (const f of ['test_119_ton_tu_so.mjs', 'test_huy_phieu.mjs', 'test_127.mjs', 'test_132.mjs', 'test_hd_ncc.mjs']) run(f)
process.exit(F ? 1 : 0)
