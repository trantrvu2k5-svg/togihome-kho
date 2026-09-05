// TEST WP-18b(3) L-21 · dong_phien — nửa còn thiếu của cặp mo_phien/dong_phien (db/228, QD-108). tx-rollback.
//   thợ đóng của mình ✓ · thợ đóng người khác ✗ · xuong/ceo đóng hộ ✓ · đóng phiên đã đóng → không lỗi lặp.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const XUONG = '2239d30f-cfd7-46e7-aa4f-1b3f3818d42a', THO = '73bbdefd-10af-4f44-9ab8-d92e029299a2'
const A = '600286f2-2482-4dff-b0a4-a3183740be56'   // ns thợ A (người làm)
const B = 'ba768336-c856-44c2-9f56-45f2990bf648'   // ns người KHÁC (cho vế "đóng người khác")
const T1 = 'TRAM-CAM-01', T2 = 'TRAM-CANH-01'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
const moOpen = async (tram) => +(await c.query("select count(*) n from kho.phien_tram where ma_tram=$1 and ket_thuc is null", [tram])).rows[0].n

try {
  await c.query('begin')
  await c.query("update kho.phien_tram set ket_thuc=now() where ma_tram=any($1) and ket_thuc is null", [[T1, T2]])

  // ── vế 1: thợ A tự mở CAM rồi TỰ đóng → da_dong=true, phiên đóng ──
  await vai(THO)
  await attempt(() => c.query("select kho.mo_phien($1,$2)", [A, T1]))
  const r1 = await attempt(() => c.query("select kho.dong_phien($1) g", [T1]))
  ok('1 thợ TỰ đóng phiên của mình → da_dong=true · phiên đóng',
    r1.ok && r1.r.rows[0].g.da_dong === true && (await moOpen(T1)) === 0, JSON.stringify(r1.r?.rows[0]?.g) || r1.msg)

  // ── vế 2: phiên của NGƯỜI KHÁC (B, xuong mở hộ); thợ A đóng → TỪ CHỐI (A là tho, không phải quản đốc) ──
  await vai(XUONG); await attempt(() => c.query("select kho.mo_phien($1,$2)", [B, T2]))   // xuong mở hộ B
  await vai(THO)   // = thợ A
  const r2 = await attempt(() => c.query("select kho.dong_phien($1) g", [T2]))
  ok('2 thợ đóng phiên NGƯỜI KHÁC → TỪ CHỐI (chỉ quản đốc đóng hộ)',
    !r2.ok && /chỉ quản đốc/.test(r2.msg || '') && (await moOpen(T2)) === 1, r2.msg)

  // ── vế 3: xuong đóng HỘ phiên của B (còn mở ở CANH) → da_dong=true ──
  await vai(XUONG)
  const r3 = await attempt(() => c.query("select kho.dong_phien($1) g", [T2]))
  ok('3 xuong đóng HỘ phiên người khác → da_dong=true · gán đúng người làm',
    r3.ok && r3.r.rows[0].g.da_dong === true && r3.r.rows[0].g.nguoi_id === B && (await moOpen(T2)) === 0, JSON.stringify(r3.r?.rows[0]?.g) || r3.msg)

  // ── vế 4: đóng phiên ĐÃ ĐÓNG (không còn mở) → da_dong=false, KHÔNG raise (không lỗi lặp) ──
  const r4 = await attempt(() => c.query("select kho.dong_phien($1) g", [T2]))
  ok('4 đóng phiên đã đóng → da_dong=false, KHÔNG lỗi lặp',
    r4.ok && r4.r.rows[0].g.da_dong === false && /không có phiên/.test(r4.r.rows[0].g.ly_do || ''), JSON.stringify(r4.r?.rows[0]?.g) || r4.msg)

  // ── vế 5: client KHÔNG ghi thẳng phien_tram (ket_thuc) ──
  const priv = (await c.query("select has_column_privilege('authenticated','kho.phien_tram','ket_thuc','UPDATE') u")).rows[0]
  ok('5 authenticated KHÔNG UPDATE phien_tram.ket_thuc (chỉ qua RPC)', priv.u === false, JSON.stringify(priv))

} finally { await c.query('rollback') }
await c.end()
console.log(`\n═══ test_dong_phien: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
