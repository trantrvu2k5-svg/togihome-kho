// TEST WP-17b (2) L-15 · mo_phien HỘ nhiều trạm + nguoi_mo (db/226). tx-rollback.
//   Quét/giờ-công gán theo phien_tram.nguoi_id (người LÀM); nguoi_mo = người bấm (quản đốc).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const XUONG = '2239d30f-cfd7-46e7-aa4f-1b3f3818d42a', THO = '73bbdefd-10af-4f44-9ab8-d92e029299a2', CEO_AUTH = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const A = '600286f2-2482-4dff-b0a4-a3183740be56'   // ns thợ (người LÀM)
const B = 'ba768336-c856-44c2-9f56-45f2990bf648'   // ns ceo (người khác, cho vế 3)
const XUONG_NS = '5386377f-1d61-4db2-bd8e-8860d94b18f3'
const T1 = 'TRAM-CAM-01', T2 = 'TRAM-CANH-01', T3 = 'TRAM-CAT-01'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
const openPhien = async (nguoi, tram) => (await c.query("select count(*) n from kho.phien_tram where nguoi_id=$1 and ma_tram=$2 and ket_thuc is null", [nguoi, tram])).rows[0].n
const nguoiMo = async (nguoi, tram) => (await c.query("select nguoi_mo::text m from kho.phien_tram where nguoi_id=$1 and ma_tram=$2 and ket_thuc is null order by bat_dau desc limit 1", [nguoi, tram])).rows[0]?.m

try {
  await c.query('begin')
  // dọn phiên đang mở ở 3 trạm (nền test)
  await c.query("update kho.phien_tram set ket_thuc=now() where ma_tram=any($1) and ket_thuc is null", [[T1, T2, T3]])

  // ── vế 1: thợ A TỰ mở CAM → nguoi_mo NULL ──
  await vai(THO)
  await attempt(() => c.query("select kho.mo_phien($1,$2)", [A, T1]))
  ok('1 thợ tự mở CAM → nguoi_mo NULL', +(await openPhien(A, T1)) === 1 && (await nguoiMo(A, T1)) === null, 'nguoi_mo=' + await nguoiMo(A, T1))

  // ── vế 2: quản đốc (xuong) mở HỘ A ở CANH + CAT → A 2 phiên, nguoi_mo=xuong ──
  await vai(XUONG)
  const r2a = await attempt(() => c.query("select kho.mo_phien($1,$2)", [A, T2]))
  const r2b = await attempt(() => c.query("select kho.mo_phien($1,$2)", [A, T3]))
  const moT2 = await nguoiMo(A, T2), moT3 = await nguoiMo(A, T3)
  const soTramA = +(await c.query("select count(*) n from kho.phien_tram where nguoi_id=$1 and ket_thuc is null", [A])).rows[0].n
  ok('2 xuong mở hộ A ở CANH+CAT → A giữ ≥2 trạm (không đóng nhau)', r2a.ok && r2b.ok && soTramA >= 2, 'A open=' + soTramA)
  ok('2b nguoi_mo CANH=CAT=xuong (' + XUONG_NS.slice(0, 8) + ')', moT2 === XUONG_NS && moT3 === XUONG_NS, 'T2=' + moT2 + ' T3=' + moT3)

  // ── vế 3: thợ mở hộ người khác → từ chối ──
  await vai(THO)
  const r3 = await attempt(() => c.query("select kho.mo_phien($1,$2)", [B, T1]))
  ok('3 thợ mở HỘ người khác → từ chối', !r3.ok && /chỉ quản đốc/.test(r3.msg || ''), r3.msg)

  // ── vế 4: mở hộ TRÙNG (xuong, A, CANH đang mở) → da_mo=true, không đẻ phiên 2 ──
  await vai(XUONG)
  const r4 = await attempt(() => c.query("select kho.mo_phien($1,$2) g", [A, T2]))
  ok('4 mở hộ trùng (A@CANH) → da_mo=true, không đẻ phiên 2', r4.ok && r4.r.rows[0].g.da_mo === true && +(await openPhien(A, T2)) === 1, JSON.stringify(r4.r?.rows[0]?.g))

  // ── vế 5: QUÉT gán theo phien_nguoi = A (người LÀM), KHÔNG xuong ──
  const pnT2 = (await c.query("select kho.phien_nguoi($1) n", [T2])).rows[0].n
  const pnT3 = (await c.query("select kho.phien_nguoi($1) n", [T3])).rows[0].n
  ok('5 phien_nguoi(CANH)=phien_nguoi(CAT)=A (người LÀM, KHÔNG quản đốc)', pnT2 === A && pnT3 === A, 'CANH=' + pnT2 + ' CAT=' + pnT3 + ' (A=' + A.slice(0, 8) + ' xuong=' + XUONG_NS.slice(0, 8) + ')')

  // ── vế 6: authenticated KHÔNG UPDATE nguoi_mo → PATCH 403 ──
  const upd = (await c.query("select has_column_privilege('authenticated','kho.phien_tram','nguoi_mo','UPDATE') u, has_column_privilege('authenticated','kho.phien_tram','nguoi_mo','SELECT') s")).rows[0]
  ok('6 authenticated KHÔNG UPDATE nguoi_mo (PATCH 403) · CÓ SELECT (UI đọc)', upd.u === false && upd.s === true, JSON.stringify(upd))

} finally { await c.query('rollback') }
await c.end()
console.log(`\n═══ test_mo_phien_ho: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
