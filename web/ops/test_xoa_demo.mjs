// TEST WP-17b (1) L-14 · xoa_demo xoá ĐỦ (su_kien_meta cascade+escape) · KHÔNG đụng đơn THẬT (db/225). tx-rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 25000
const c = new pg.Client(cfg); await c.connect()
const vai = u => c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })])
const attempt = async fn => { await c.query('savepoint s'); try { const r = await fn(); return { ok: true, r } } catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: (e.message || '').split('\n')[0] } } }
const cnt = async (sql, p = []) => +(await c.query(sql, p)).rows[0].n

try {
  await c.query('begin'); await vai(CEO)

  // ── vế 1: XOÁ SẠCH 1 đơn demo có su_kien_meta (tự dựng — prod đã sạch demo sau L-14) ──
  await c.query('savepoint s1')
  const idT = (await c.query("insert into kho.don_hang(ma_don, ten_khach, trang_thai) values('DEMO-XD1','DEMO khach','bao_gia') returning id")).rows[0].id
  await c.query("insert into kho.don_hang_mon(don_id, ten, so_luong, gia) values($1,'Món demo',1,1000000)", [idT])
  await c.query("insert into kho.su_kien_meta(don_id, event_id, loai_su_kien) values($1,'EVT-DEMO','Purchase')", [idT])
  const smTruoc = await cnt("select count(*) n from kho.su_kien_meta where don_id=$1", [idT])
  const x1 = await attempt(() => c.query("select kho.xoa_demo('DEMO-XD1', null)"))
  const conT = await cnt("select count(*) n from kho.don_hang where ma_don='DEMO-XD1'")
  const smSau = await cnt("select count(*) n from kho.su_kien_meta where don_id=$1", [idT])
  const monSau = await cnt("select count(*) n from kho.don_hang_mon where don_id=$1", [idT])
  ok('1 xoa_demo(DEMO-XD1) → đơn+su_kien_meta('+smTruoc+'→'+smSau+')+món=0', x1.ok && conT === 0 && smSau === 0 && monSau === 0, (x1.msg || '') + ` con=${conT} sm=${smSau} mon=${monSau}`)
  await c.query('rollback to savepoint s1')  // khôi phục để vế sau

  // ── vế 2 (QUAN TRỌNG NHẤT): đơn KHÔNG la_demo + con → xoa_demo KHÔNG đụng ──
  await c.query('savepoint s2')
  const idR = (await c.query("insert into kho.don_hang(ma_don, ten_khach, trang_thai) values('REAL-XD1','KHACH THAT','bao_gia') returning id")).rows[0].id
  await c.query("insert into kho.don_hang_mon(don_id, ten, so_luong, gia) values($1,'Tủ thật',1,1000000)", [idR])
  await c.query("insert into kho.su_kien_meta(don_id, event_id, loai_su_kien) values($1,'EVT-THAT','Purchase')", [idR])
  const laDemoR = (await c.query("select la_demo from kho.don_hang where id=$1", [idR])).rows[0].la_demo
  const monRTruoc = await cnt("select count(*) n from kho.don_hang_mon where don_id=$1", [idR])
  const smRTruoc = await cnt("select count(*) n from kho.su_kien_meta where don_id=$1", [idR])
  await attempt(() => c.query("select kho.xoa_demo(null, 'XOA_HET')"))   // xoá TOÀN BỘ demo
  const conR = await cnt("select count(*) n from kho.don_hang where id=$1", [idR])
  const monRSau = await cnt("select count(*) n from kho.don_hang_mon where don_id=$1", [idR])
  const smRSau = await cnt("select count(*) n from kho.su_kien_meta where don_id=$1", [idR])
  const demoConLai = await cnt("select count(*) n from kho.don_hang where la_demo")
  ok('2 xoa_demo TOÀN BỘ → đơn THẬT REAL-XD1 + món('+monRTruoc+'→'+monRSau+')+su_kien_meta('+smRTruoc+'→'+smRSau+') NGUYÊN',
    laDemoR === false && conR === 1 && monRSau === monRTruoc && smRSau === smRTruoc, `laDemo=${laDemoR} con=${conR}`)
  ok('2b xoa_demo TOÀN BỘ → la_demo còn 0 (demo sạch, thật giữ)', demoConLai === 0, 'demo còn=' + demoConLai)

  // ── vế 3: DELETE su_kien_meta trực tiếp (KHÔNG GUC) → chặn ──
  const v3 = await attempt(() => c.query("delete from kho.su_kien_meta where don_id=$1", [idR]))
  ok('3 DELETE su_kien_meta (không GUC) → chặn append-only', !v3.ok && /append-only — CẤM DELETE/.test(v3.msg || ''), v3.msg)

  // ── vế 4: DELETE su_kien_meta đơn THẬT dù CÓ GUC → vẫn chặn (escape đòi la_demo) ──
  const v4 = await attempt(async () => { await c.query("select set_config('kho.xoa_demo','1',true)"); await c.query("delete from kho.su_kien_meta where don_id=$1", [idR]); await c.query("select set_config('kho.xoa_demo','0',true)") })
  await c.query("select set_config('kho.xoa_demo','0',true)")
  ok('4 DELETE su_kien_meta đơn THẬT + GUC=1 → VẪN chặn (escape đòi la_demo)', !v4.ok && /append-only — CẤM DELETE/.test(v4.msg || ''), v4.msg)
  await c.query('rollback to savepoint s2')

  // ── vế 5: giao_dich · su_kien_quet KHÔNG đổi qua xoa_demo ──
  await c.query('savepoint s5')
  const gdT = await cnt('select count(*) n from kho.giao_dich'); const sqT = await cnt('select count(*) n from kho.su_kien_quet')
  await attempt(() => c.query("select kho.xoa_demo(null, 'XOA_HET')"))
  const gdS = await cnt('select count(*) n from kho.giao_dich'); const sqS = await cnt('select count(*) n from kho.su_kien_quet')
  ok('5 giao_dich('+gdT+'→'+gdS+') · su_kien_quet('+sqT+'→'+sqS+') KHÔNG đổi (QD-44/45 giữ)', gdT === gdS && sqT === sqS)
  await c.query('rollback to savepoint s5')

} finally { await c.query('rollback') }
await c.end()
console.log(`\n═══ test_xoa_demo: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
