// TEST L-91.2-4 N-04 — BẤT BIẾN: brand chi ads MỘT NGUỒN = FANPAGE (ads_brand_cua_ad, QD-112).
//   Khoá để không ai lén thêm lại "brand theo tài khoản". Owner tx đọc + 1 ca rollback (ad trang chưa map).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const CEO = (await c.query(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).rows[0].a
const asCeo = async () => { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })]) }
const owner = async () => { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`) }
const TU = '2026-09-01', DEN = '2026-09-30'
try {
  await c.query('begin')
  // C1: brand mỗi dòng ads_bang_ky == ads_brand_cua_ad cho cùng chiến dịch (KHÔNG fallback tài khoản)
  await asCeo()
  const bk = (await c.query(`select kho.ads_bang_ky($1,$2) j`, [TU, DEN])).rows[0].j
  await owner()
  let khop = 0, lech = []
  for (const d of (bk.dong || [])) {
    const fp = (await c.query(`select coalesce((select kho.ads_brand_cua_ad(ac.ad_id) from kho.ads_ad_campaign ac
      where ac.campaign_id=$1 and kho.ads_brand_cua_ad(ac.ad_id)<>'chưa rõ' limit 1),'chưa rõ') b`, [d.campaign_id])).rows[0].b
    if (d.brand === fp) khop++; else lech.push(`${d.campaign_id}:${d.brand}≠${fp}`)
  }
  ok('C1. ads_bang_ky.brand == ads_brand_cua_ad (fanpage) MỌI dòng, 0 fallback tài khoản', lech.length === 0, lech.slice(0, 3).join(' | '))

  // C3: tổng chi theo brand của ads_bang_ky == ads_tong_so_sanh (cùng nguồn fanpage) cho brand thật
  await asCeo()
  const g = {}; for (const d of (bk.dong || [])) { const b = d.brand || 'chưa rõ'; g[b] = (g[b] || 0) + Number(d.chi || 0) }
  for (const b of ['sconcept', 'openliving']) {
    const ss = (await c.query(`select kho.ads_tong_so_sanh($1,$2,$3) j`, [TU, DEN, b])).rows[0].j
    ok(`C3. Σchi brand ${b}: ads_bang_ky == ads_tong_so_sanh`, Math.round(g[b] || 0) === Math.round(Number(ss.ky_nay?.chi || 0)), JSON.stringify({ bk: g[b], ss: ss.ky_nay?.chi }))
  }

  // C2: ad KHÔNG map được trang→brand → ads_brand_cua_ad = 'chưa rõ' (coalesce default, KHÔNG rơi brand nào)
  await owner()
  const br = (await c.query(`select kho.ads_brand_cua_ad('AD-KHONG-MAP-912') b`)).rows[0].b
  ok('C2. ad chưa map trang→brand → "chưa rõ" (không rơi vào brand mặc định/tài khoản)', br === 'chưa rõ', br)

  // C4: bảng ads_tai_khoan_brand CÒN (không drop — 2 RPC đọc cho TÊN); brand_id vestigial
  const reg = (await c.query(`select to_regclass('kho.ads_tai_khoan_brand') r`)).rows[0].r
  const nm = (await c.query(`select count(*) n, count(brand_id) b from kho.ads_tai_khoan_brand`)).rows[0]
  ok('C4. ads_tai_khoan_brand GIỮ (dùng cho TÊN); brand_id vestigial (< tổng)', reg != null && Number(nm.b) < Number(nm.n), JSON.stringify(nm))

  await c.query('rollback')
} catch (e) { ok('LỖI', false, e.message); await c.query('rollback').catch(() => {}) }
console.log(`\n═══ test_ads_brand_fanpage: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
