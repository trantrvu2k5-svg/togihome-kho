// TEST PHẢI CẮN — đường giá (SPEC 4 tham số + 4 SỬA). Áp 027+028 trong 1 transaction rồi ROLLBACK.
// Chạy (từ web/):  DB_PASS='...' node ops/test_duong_gia.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const DB = '/Users/vuquanghai/Documents/togihome-kho/db'
const stripTx = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql027 = stripTx(readFileSync(`${DB}/027_tach_gia_von_san_pham.sql`, 'utf8'))
const sql028 = stripTx(readFileSync(`${DB}/028_duong_gia.sql`, 'utf8'))

// Kết nối: nếu có DATABASE_URL thì để pg TỰ PARSE nguyên chuỗi (đúng cho pooler URL); host db.<ref> đã bị bỏ -> tự dò pooler region.
async function connect() {
  if (!process.env.DATABASE_URL) { const c = new pg.Client(await docConfig()); await c.connect(); return c }
  const dbUrl = process.env.DATABASE_URL
  const sslOpt = { rejectUnauthorized: false }
  // 1) nguyên chuỗi
  try { const c = new pg.Client({ connectionString: dbUrl, ssl: sslOpt, connectionTimeoutMillis: 8000 }); await c.connect(); await c.query('select 1'); return c }
  catch (first) {
    // 2) host db.<ref> không phân giải -> dò pooler aws-{0,1}-<region>
    const m = dbUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/); const ref = m && m[1]
    const pass = (dbUrl.match(/\/\/[^:]+:([^@]+)@/) || [])[1]
    if (!ref || !pass) throw first
    const REGIONS = ['ap-southeast-1', 'ap-southeast-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2',
      'us-east-1', 'us-east-2', 'us-west-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'sa-east-1', 'ca-central-1']
    for (const pfx of ['aws-0', 'aws-1']) for (const r of REGIONS) {
      const host = `${pfx}-${r}.pooler.supabase.com`
      const c = new pg.Client({ host, port: 5432, database: 'postgres', user: `postgres.${ref}`, password: decodeURIComponent(pass), ssl: sslOpt, connectionTimeoutMillis: 8000 })
      try { await c.connect(); await c.query('select 1'); console.error(`  (dò ra: ${host})`); return c } catch { try { await c.end() } catch {} }
    }
    throw first
  }
}
const c = await connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + n + (extra ? '  — ' + extra : '')); cond ? PASS++ : FAIL++ }
const q = async (sql, args = []) => (await c.query(sql, args)).rows
async function asRole(authUid, fn) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authUid, role: 'authenticated' })])
  try { return await fn() } finally { await c.query('rollback to savepoint s'); await c.query('reset role') }
}
const R = x => Math.round(Number(x))

try {
  await c.query('begin')
  console.log('— áp 027 + 028 trong transaction (sẽ rollback) —')
  await c.query(sql027); await c.query(sql028)

  const uids = {}
  for (const vt of ['sale', 'ceo', 'ke_toan']) {
    uids[vt] = (await q(`select auth_uid from kho.nguoi_dung where vai_tro=$1 and dang_hoat_dong and auth_uid is not null limit 1`, [vt]))[0]?.auth_uid || null
    if (!uids[vt]) console.log(`  ⚠ thiếu tài khoản "${vt}" — vài test bỏ qua`)
  }
  const skus = (await q(`select ma, gia_von from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 3`))
  const tp = (await q(`select phi_don_le, hh_sale, hh_quan_ly, hh_thiet_ke from kho.tham_so_tai_chinh where ma_ky='2026-07'`))[0]
  const phi = Number(tp.phi_don_le), hh = Number(tp.hh_sale) + Number(tp.hh_quan_ly) + Number(tp.hh_thiet_ke)
  console.log(`  sku thử: ${skus.map(s => s.ma).join(', ')} · phi_don_le=${phi} · Σhh=${hh}\n`)

  // ── T1: sale đọc tham_so_tai_chinh → CHẶN (+ cắn: mở RLS thành ĐỎ) ──
  if (uids.sale) {
    ok('T1  sale đọc tham_so_tai_chinh bị CHẶN',
      (await asRole(uids.sale, () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n === 0)
    await c.query('savepoint bite1'); await c.query(`alter policy tstc_doc on kho.tham_so_tai_chinh using (true)`)
    const red = await asRole(uids.sale, () => q(`select he_so_m, phi_don_le, hh_sale from kho.tham_so_tai_chinh`))
    console.log('   [CẮN] bỏ guard RLS → sale ĐỌC ĐƯỢC tham số (ĐỎ):', JSON.stringify(red[0]))
    await c.query('rollback to savepoint bite1')
    ok('T1  [CẮN] khôi phục guard → sale lại bị chặn',
      (await asRole(uids.sale, () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n === 0)
  }

  // ── T2: sale KHÔNG đọc giá vốn ──
  if (uids.sale) ok('T2  sale đọc giá vốn bị CHẶN',
    (await asRole(uids.sale, () => q(`select count(*)::int n from kho.san_pham_mau_gia_von`)))[0].n === 0)

  // ══════ T7 — tinh_he_so_m (SỬA 1: sản lượng kế hoạch) ══════
  console.log('\n── T7: tinh_he_so_m (SẢN LƯỢNG KẾ HOẠCH) ──')
  c.on('notice', n => { if (/tinh_he_so_m/.test(n.message)) console.log('   NOTICE:', n.message) })
  if (uids.ceo) {   // 7a. chưa có đơn đóng dấu kỳ -> gcg_TB rỗng -> NULL
    const nul = (await asRole(uids.ceo, () => q(`select kho.tinh_he_so_m('2026-07') g`)))[0].g
    ok('T7a  thiếu đơn (gcg_TB rỗng) → trả NULL', nul === null)
  }
  if (uids.sale) {
    let chan = false
    try { await asRole(uids.sale, () => q(`select kho.tinh_he_so_m('2026-07')`)) } catch { chan = true }
    ok('T7b  sale gọi tinh_he_so_m bị CHẶN', chan)
  }
  // 7c. nạp 1 đơn đóng dấu kỳ (gcg_TB, ship_TB) → so công thức. dt_muc_tieu/so_don_ke_hoach đã seed.
  const GCG_TB = 7572414, SHIP_TB = 0, N = 580, DT = 7000000000
  await c.query(`insert into kho.don_hang(ma_don, ma_ky_ap_dung, ship_thuc_tra) values('TEST-HSM','2026-07',$1)`, [SHIP_TB])
  await c.query(`insert into kho.don_hang_gia_von(ma_don, gia_chuyen_giao) values('TEST-HSM',$1)`, [GCG_TB])
  let m = null
  if (uids.ceo) {
    m = Number((await asRole(uids.ceo, () => q(`select kho.tinh_he_so_m('2026-07') g`)))[0].g)
    const expect = (DT * (1 - hh) - SHIP_TB * N - phi * N) / (GCG_TB * N)
    ok('T7c  đủ đầu vào → khớp (dt(1−Σhh)−Σship_KH−Σphi_KH)/Σgcg_KH', Math.abs(m - expect) < 1e-9, `hàm=${m?.toFixed(5)} ct=${expect.toFixed(5)}`)
  }
  if (m) await c.query(`update kho.tham_so_tai_chinh set he_so_m=$1 where ma_ky='2026-07'`, [m])

  // ── T3: sale gọi tang_1_mon & gia_san_don → ra SỐ, khớp công thức ──
  if (uids.sale && skus[0] && m) {
    const gv0 = Number(skus[0].gia_von)
    const t1 = R((await asRole(uids.sale, () => q(`select kho.tang_1_mon($1) g`, [skus[0].ma])))[0].g)
    ok('T3  tang_1_mon khớp gv×[1+(he_so_m−1)×1]', t1 === R(gv0 * (1 + (m - 1) * 1)), `hàm=${t1}`)
    const don = R((await asRole(uids.sale, () => q(`select kho.gia_san_don($1::jsonb,'le') g`, [JSON.stringify([{ sku: skus[0].ma }])])))[0].g)
    ok('T3  gia_san_don 1 món le = (tang_1 + phi_don_le)/(1−Σhh)', don === R((t1 + phi) / (1 - hh)), `hàm=${don}`)
  }

  // ── T4: hàm rò rỉ (trả gv) = ĐỎ ; hàm thật chỉ trả SỐ = XANH ──
  await c.query(`create or replace function kho.tang_1_leak(p_sku text) returns jsonb
    language sql security definer set search_path=kho stable as $$
    select jsonb_build_object('gia_von',(select gia_von from kho.san_pham_mau_gia_von where ma=p_sku),
      'he_so_m',(select he_so_m from kho.tham_so_tai_chinh limit 1)) $$`)
  await c.query(`grant execute on function kho.tang_1_leak(text) to authenticated`)
  if (uids.sale && skus[0]) {
    const leak = await asRole(uids.sale, () => q(`select kho.tang_1_leak($1) j`, [skus[0].ma]))
    console.log('   [CẮN] hàm KHÔNG guard trả gv/tham số → sale thấy (ĐỎ):', JSON.stringify(leak[0].j))
    const real = await asRole(uids.sale, () => q(`select kho.tang_1_mon($1)::text t`, [skus[0].ma]))
    ok('T4  hàm THẬT chỉ trả 1 SỐ', /^\d+(\.\d+)?$/.test(real[0].t), `trả "${real[0].t}"`)
  }

  // ── T5/T6 ──
  if (uids.sale) { let okr = true; try { await asRole(uids.sale, () => q(`select count(*) from kho.gia_niem_yet`)) } catch { okr = false }
    ok('T5  sale đọc gia_niem_yet KHÔNG lỗi', okr) }
  for (const vt of ['ceo', 'ke_toan']) {
    if (!uids[vt]) continue
    ok(`T6  ${vt} đọc tham_so_tai_chinh ĐỦ`, (await asRole(uids[vt], () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n >= 1)
    ok(`T6  ${vt} đọc giá vốn ĐỦ`, (await asRole(uids[vt], () => q(`select count(*)::int n from kho.san_pham_mau_gia_von`)))[0].n >= 1)
  }

  // ══════ CA CẮN A — he_so_nhom=0,75 một món: giá bán PHẢI > giá vốn ══════
  console.log('\n── CA CẮN A: he_so_nhom = 0,75, một món ──')
  if (uids.sale && skus[0] && m) {
    const gv = Number(skus[0].gia_von), nhom = 0.75
    const old_tang1 = R(gv * m * nhom)
    const new_tang1 = R((await asRole(uids.sale, () => q(`select kho.tang_1_mon($1,0,$2) g`, [skus[0].ma, nhom])))[0].g)
    console.log(`   gv=${gv}  he_so_m=${m.toFixed(4)}  |  V2 cũ = gv×he_so_m×0,75 = ${old_tang1}  |  SPEC mới = gv×[1+(he_so_m−1)×0,75] = ${new_tang1}`)
    ok('A  [CẮN] V2 CŨ tụt DƯỚI giá vốn (ĐỎ)', old_tang1 < gv, `${old_tang1} < ${gv}`)
    ok('A  SPEC MỚI vẫn TRÊN giá vốn (XANH)', new_tang1 > gv, `${new_tang1} > ${gv}`)
  }

  // ══════ CA CẮN B — đơn 3 món: phi_don xuất hiện ĐÚNG 1 lần ══════
  console.log('\n── CA CẮN B: đơn 3 món, đếm số lần phi_don ──')
  if (uids.sale && skus.length === 3 && m) {
    const t1s = []
    for (const s of skus) t1s.push(R((await asRole(uids.sale, () => q(`select kho.tang_1_mon($1) g`, [s.ma])))[0].g))
    const sumT1 = t1s.reduce((a, b) => a + b, 0)
    const new_don = R((await asRole(uids.sale, () => q(`select kho.gia_san_don($1::jsonb,'le') g`, [JSON.stringify(skus.map(s => ({ sku: s.ma })))])))[0].g)
    const old_don = t1s.reduce((a, t) => a + R((t + phi) / (1 - hh)), 0)   // V2 CŨ: phi_don ở tầng MÓN -> 3 lần
    const phi_new = R(new_don * (1 - hh) - sumT1), phi_old = R(old_don * (1 - hh) - sumT1)
    console.log(`   ΣtangA=${sumT1}  |  ĐƠN mới=${new_don} (phi≈${phi_new})  |  V2 cũ (Σ giá lẻ)=${old_don} (phi≈${phi_old})`)
    ok('B  đơn MỚI: phi_don 1 lần (XANH)', Math.abs(phi_new - phi) <= 3, `phi_new≈${phi_new} ≈ ${phi}`)
    ok('B  [CẮN] V2 CŨ: phi_don 3 lần (ĐỎ)', Math.abs(phi_old - 3 * phi) <= 3, `phi_old≈${phi_old} ≈ 3×${phi}`)
  } else console.log('   (cần ≥3 sku — bỏ qua)')

  // ══════ CA CẮN C — scale dt VÀ so_don cùng tỷ lệ → he_so_m ~ KHÔNG ĐỔI ══════
  console.log('\n── CA CẮN C: dt 5,8→7,0 tỷ VÀ so_don cùng tỷ lệ ──')
  if (uids.ceo && m) {
    const N1 = Math.round(N * 5.8 / 7)   // ≈481, giữ dt/đơn gần như cố định
    await c.query(`update kho.tham_so_tai_chinh set dt_muc_tieu=5800000000, so_don_ke_hoach=$1 where ma_ky='2026-07'`, [N1])
    const new1 = Number((await asRole(uids.ceo, () => q(`select kho.tinh_he_so_m('2026-07') g`)))[0].g)
    await c.query(`update kho.tham_so_tai_chinh set dt_muc_tieu=7000000000, so_don_ke_hoach=$1 where ma_ky='2026-07'`, [N])
    const new2 = Number((await asRole(uids.ceo, () => q(`select kho.tinh_he_so_m('2026-07') g`)))[0].g)
    // BẢN CŨ (mẫu số CỐ ĐỊNH ở kế hoạch N1 trong khi dt tăng)
    const old1 = (5.8e9 * (1 - hh) - SHIP_TB * N1 - phi * N1) / (GCG_TB * N1)
    const old2 = (7.0e9 * (1 - hh) - SHIP_TB * N1 - phi * N1) / (GCG_TB * N1)   // denom vẫn N1, dt=7,0
    const dNew = Math.abs(new2 - new1) / new1, dOld = Math.abs(old2 - old1) / old1
    console.log(`   MỚI: ${new1.toFixed(4)} → ${new2.toFixed(4)} (lệch ${(dNew * 100).toFixed(2)}%)  |  CŨ (mẫu số cố định): ${old1.toFixed(4)} → ${old2.toFixed(4)} (nhảy ${(dOld * 100).toFixed(1)}%)`)
    ok('C  SPEC MỚI: he_so_m gần như KHÔNG đổi (<1%) (XANH)', dNew < 0.01, `lệch ${(dNew * 100).toFixed(2)}%`)
    ok('C  [CẮN] BẢN CŨ mẫu số cố định: he_so_m NHẢY (>15%) (ĐỎ)', dOld > 0.15, `nhảy ${(dOld * 100).toFixed(1)}%`)
  } else console.log('   (cần ceo + he_so_m — bỏ qua)')

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL ? 1 : 0) }
