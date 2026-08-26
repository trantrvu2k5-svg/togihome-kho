// TEST CẮN — WP-47 (db/154): lịch nguồn/suy. Hai vế: RPC nguồn có rào vai · xep_lich client cấm ghi.
//   as(uid) = set role authenticated + jwt → RLS/grant y hệt PostgREST. 4.5 dùng PostgREST HTTP thật.
//   Tx rollback → 0 dấu vết. KHÔNG đo 100k (bảng danh mục).
import pg from 'pg'; import { readFileSync } from 'fs'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1`, [v]))?.a
const U = { ceo: await uid('ceo'), xuong: await uid('xuong'), tho: await uid('tho') }
console.log('vai test có auth_uid:', JSON.stringify({ ceo: !!U.ceo, xuong: !!U.xuong, tho: !!U.tho }))

await c.query('begin')

// ═══ 4.1 · nl_ghi Sơn PU 4→6 từ NGÀY MAI (bọc savepoint c41, rollback sau khi soi) ═══
await c.query('savepoint c41')
{ const r = await as(U.xuong, `select kho.nl_ghi('son_pu',6,8,7,0.88,current_date+1,'thêm 2 người ca 2') j`, [], true)
  const mo = await one(`select so_nguoi,xac_nhan,tu_ngay from kho.nang_luc_to where ma_to='son_pu' and den_ngay is null`)
  const cu = await one(`select 1 from kho.nang_luc_to where ma_to='son_pu' and den_ngay = current_date`)
  ok('4.1 nl_ghi son_pu 4→6 từ mai: khoảng mới mở 6 người, xac_nhan=true', !r.e && mo && Number(mo.so_nguoi) === 6 && mo.xac_nhan === true, r.e || JSON.stringify(mo))
  ok('4.1 khoảng cũ ĐÓNG đúng hôm nay (den_ngay=today) · EXCLUDE không nổ', !r.e && !!cu, r.e || 'khoảng cũ chưa đóng') }
await c.query('rollback to savepoint c41')

// ═══ 4.2 · p_tu_ngay HÔM QUA → từ chối ═══
{ const r = await as(U.ceo, `select kho.nl_ghi('son_pu',6,8,7,0.88,current_date-1,'x') j`)
  ok('4.2 nl_ghi p_tu_ngay=hôm qua → TỪ CHỐI (cấm sửa ngược quá khứ)', !!r.e && /quá khứ|ngược|hôm nay/.test(r.e), r.e || 'KHÔNG chặn') }

// ═══ 4.3 · vai: tho từ chối · xuong được · ceo được ═══
{ const t = await as(U.tho, `select kho.nl_ghi('son_pu',5,8,7,0.88,current_date+2,'x') j`)
  ok('4.3 tho gọi nl_ghi → TỪ CHỐI', !!t.e && /quản đốc|xuong|vai/.test(t.e), t.e || 'KHÔNG chặn')
  const x = await as(U.xuong, `select kho.nl_ghi('son_pu',5,8,7,0.88,current_date+3,'x') j`)
  ok('4.3 quản đốc(xuong) gọi nl_ghi → ĐƯỢC', !x.e, x.e || '')
  const e = await as(U.ceo, `select kho.nl_ghi('cha_lot',11,8,7,0.88,current_date+3,'x') j`)
  ok('4.3 ceo gọi nl_ghi → ĐƯỢC', !e.e, e.e || '') }

// ═══ 4.4 · moc_lich_ghi: xuong từ chối · ceo được ═══
{ const x = await as(U.xuong, `select kho.moc_lich_ghi(2,2) j`)
  ok('4.4 quản đốc(xuong) gọi moc_lich_ghi → TỪ CHỐI (ceo-only)', !!x.e && /ceo/.test(x.e), x.e || 'KHÔNG chặn')
  const e = await as(U.ceo, `select kho.moc_lich_ghi(3,2) j`)
  ok('4.4 ceo gọi moc_lich_ghi → ĐƯỢC', !e.e, e.e || '') }

// ═══ 4.6 · HỒI QUY: hàm đọc RA SỐ NHƯ TRƯỚC khi bật RLS (so RLS on vs off, gọi bằng vai ceo) ═══
{ const SQL = `select
    kho.tai_theo_to_tuan(kho.tuan_cua(current_date), kho.tuan_cua(current_date)+28) tai,
    kho.vung_cua_tuan(kho.tuan_cua(current_date)) vung,
    (select gio_nen from kho.nang_luc_to_tuan('son_pu', kho.tuan_cua(current_date), kho.tuan_cua(current_date)+7) limit 1) nl,
    kho.atp('T8-001') atp`
  const goi = async () => { const r = await as(U.ceo, SQL); return r.e ? { err: r.e } : r.r[0] }
  const onRLS = await goi()
  await c.query('savepoint r6')
  await c.query(`alter table kho.nang_luc_to disable row level security`)
  await c.query(`alter table kho.moc_lich disable row level security`)
  await c.query(`alter table kho.xep_lich disable row level security`)
  const offRLS = await goi()
  await c.query('rollback to savepoint r6')   // bật RLS lại
  const same = JSON.stringify(onRLS) === JSON.stringify(offRLS)
  console.log('   RLS ON  vung=' + onRLS.vung + ' nl=' + onRLS.nl + ' atp.ok=' + (onRLS.atp && onRLS.atp.ok))
  console.log('   RLS OFF vung=' + offRLS.vung + ' nl=' + offRLS.nl + ' atp.ok=' + (offRLS.atp && offRLS.atp.ok))
  ok('4.6 tai_theo_to_tuan · vung_cua_tuan · nang_luc_to_tuan · atp — số GIỐNG trước/sau bật RLS', same, JSON.stringify({ on: onRLS.err, off: offRLS.err })) }

// ═══ 4.7 · BẪY: DEFINER(owner) vẫn GHI xep_lich sau khi bật RLS; nếu FORCE thì chết ═══
{ let eGhi = null
  await c.query('savepoint w7')
  try { await c.query(`insert into kho.xep_lich(ma_don,buoc_thu_tu,tuan_bat_dau,gio,kieu_xep) values('T8-001',1,kho.tuan_cua(current_date),3,'xuoi')`) }
  catch (x) { eGhi = x.message }
  const co = await one(`select count(*)::int n from kho.xep_lich where ma_don='T8-001'`)
  await c.query('rollback to savepoint w7')
  ok('4.7 DEFINER(owner) GHI xep_lich khi RLS bật (KHÔNG force) → ĐƯỢC', eGhi === null && co.n >= 1, eGhi || `n=${co?.n}`)
  // Bẫy đầu bài (FORCE giết DEFINER) KHÔNG xảy ra ở DB này: owner xep_lich là postgres có BYPASSRLS
  //   → bỏ qua RLS kể cả FORCE. Ta vẫn chọn KHÔNG force (belt-and-suspenders, không phụ thuộc bypassrls).
  const by = await one(`select r.rolbypassrls b, r.rolname from pg_class cl join pg_roles r on r.oid=cl.relowner
    join pg_namespace n on n.oid=cl.relnamespace where n.nspname='kho' and cl.relname='xep_lich'`)
  const frc = await one(`select relforcerowsecurity f from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='kho' and cl.relname='xep_lich'`)
  console.log(`   owner xep_lich = ${by.rolname} · BYPASSRLS=${by.b} · force=${frc.f}`)
  ok('4.7 lý do sống: owner có BYPASSRLS (DEFINER ghi được) + ta chọn KHÔNG force', by.b === true && frc.f === false, `bypassrls=${by?.b} force=${frc?.f}`) }

// ═══ 4.8 · khoảng ngay_moi_tuan=0 đúng 1 tuần → nang_luc_to_tuan tuần đó IN SỐ THẬT ═══
{ await c.query('savepoint w8')
  const ws = (await one(`select kho.tuan_cua(current_date+14) w`)).w   // tuần +2 (ngoài đóng băng)
  await c.query(`update kho.nang_luc_to set den_ngay=$1::date-1 where ma_to='son_pu' and den_ngay is null`, [ws])
  await c.query(`insert into kho.nang_luc_to(ma_to,tu_ngay,den_ngay,so_nguoi,gio_moi_ngay,ngay_moi_tuan,he_so_huu_ich,xac_nhan)
    values('son_pu',$1,$1::date+6,4,8,0,0.88,true)`, [ws])
  const gn = await one(`select gio_nen, thieu_nang_luc from kho.nang_luc_to_tuan('son_pu',$1,$1::date+7) limit 1`, [ws])
  await c.query('rollback to savepoint w8')
  console.log(`   nang_luc_to_tuan('son_pu', tuần ngay_moi_tuan=0) = gio_nen=${gn?.gio_nen} · thieu_nang_luc=${gn?.thieu_nang_luc}`)
  ok('4.8 khoảng ngay_moi_tuan=0 → ĐỌC RA SỐ THẬT (0 = _sched hiểu nghỉ; ≠0 = ghi nợ, KHÔNG sửa _sched lô này)',
    gn !== undefined && gn !== null, 'không đọc được số') }

// ═══ 4.9 · pg_proc: đúng 1 overload atp() ═══
{ const atp = await q(`select pg_get_function_arguments(p.oid) args, pg_get_function_result(p.oid) ret
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kho' and p.proname='atp'`)
  console.log('   atp overload:', atp.map(a => `atp(${a.args}) → ${a.ret}`).join(' | '))
  ok('4.9 CHỈ 1 overload atp()', atp.length === 1) }

// ═══ 4.10 · nghỉ ĐÚNG 2 NGÀY giữa tuần (ngay_moi_tuan=0) → nang_luc_to_tuan tuần đó IN SỐ THẬT (~5/7) ═══
{ await c.query('savepoint w10')
  const ws = (await one(`select kho.tuan_cua(current_date+21) w`)).w
  await c.query(`update kho.nang_luc_to set den_ngay=$1::date-1 where ma_to='son_pu' and den_ngay is null`, [ws])
  // 3 khoảng trong tuần [ws..ws+6]: normal 3 ngày · nghỉ 2 ngày (ngay_moi_tuan=0) · normal từ ws+5
  await c.query(`insert into kho.nang_luc_to(ma_to,tu_ngay,den_ngay,so_nguoi,gio_moi_ngay,ngay_moi_tuan,he_so_huu_ich,xac_nhan) values
    ('son_pu',$1,$1::date+2,4,8,7,0.88,true),
    ('son_pu',$1::date+3,$1::date+4,4,8,0,0.88,true),
    ('son_pu',$1::date+5,null,4,8,7,0.88,true)`, [ws])
  const gn = await one(`select gio_nen from kho.nang_luc_to_tuan('son_pu',$1,$1::date+7) limit 1`, [ws])
  const full = 4 * 8 * 7 * 0.88   // 197.12 = năng lực tuần đủ (7 ngày)
  await c.query('rollback to savepoint w10')
  const g = Number(gn?.gio_nen)
  console.log(`   nang_luc_to_tuan (nghỉ 2/7 ngày giữa tuần) = ${g} · năng lực đủ=${full} · tỉ lệ=${(g / full).toFixed(3)} (mong ~0.714=5/7)`)
  ok('4.10 nghỉ 2 ngày giữa tuần → năng lực ~5/7 (đúng tỉ lệ; ra 0/nguyên = ghi nợ, KHÔNG sửa _sched)',
    g > full * 4 / 7 - 1 && g < full * 6 / 7 + 1, `gio_nen=${g}`) }

// ═══ 5.1 · nl_xac_nhan vai: tho từ chối · xuong được · ceo được (db/155) ═══
{ const t = await as(U.tho, `select kho.nl_xac_nhan('cha_lot') j`)
  ok('5.1 tho gọi nl_xac_nhan → TỪ CHỐI', !!t.e && /quản đốc|xuong|vai/.test(t.e), t.e || 'KHÔNG chặn')
  const x = await as(U.xuong, `select kho.nl_xac_nhan('cha_lot') j`)
  ok('5.1 quản đốc(xuong) → ĐƯỢC', !x.e, x.e || '')
  const e = await as(U.ceo, `select kho.nl_xac_nhan('cnc') j`)
  ok('5.1 ceo → ĐƯỢC', !e.e, e.e || '') }

// ═══ 5.2 · xác nhận KHÔNG tách khoảng: cờ true, số dòng + tu/den/so_nguoi KHÔNG đổi ═══
{ const truoc = await one(`select xac_nhan,tu_ngay,den_ngay,so_nguoi from kho.nang_luc_to where ma_to='cha_lot' and den_ngay is null`)
  const n0 = (await one(`select count(*)::int n from kho.nang_luc_to`)).n
  const r = await as(U.xuong, `select kho.nl_xac_nhan('cha_lot') j`, [], true)
  const sau = await one(`select xac_nhan,tu_ngay,den_ngay,so_nguoi from kho.nang_luc_to where ma_to='cha_lot' and den_ngay is null`)
  const n1 = (await one(`select count(*)::int n from kho.nang_luc_to`)).n
  console.log('   cha_lot TRƯỚC:', JSON.stringify(truoc), '· SAU:', JSON.stringify(sau), `· số dòng ${n0}→${n1}`)
  ok('5.2 xac_nhan false→true', !r.e && truoc.xac_nhan === false && sau.xac_nhan === true, r.e || JSON.stringify(sau))
  ok('5.2 SỐ DÒNG nang_luc_to KHÔNG đổi (không tách khoảng)', n0 === n1, `${n0} vs ${n1}`)
  ok('5.2 tu_ngay/den_ngay/so_nguoi KHÔNG đổi', String(truoc.tu_ngay) === String(sau.tu_ngay) && truoc.den_ngay === sau.den_ngay && truoc.so_nguoi === sau.so_nguoi) }

// ═══ 5.3 · gọi lần hai cùng tổ → vô hại (không nổ, không đẻ dòng) ═══
{ const n0 = (await one(`select count(*)::int n from kho.nang_luc_to`)).n
  const r = await as(U.xuong, `select kho.nl_xac_nhan('cha_lot') j`, [], true)
  const n1 = (await one(`select count(*)::int n from kho.nang_luc_to`)).n
  ok('5.3 bấm lần hai → không nổ, không đẻ dòng', !r.e && n0 === n1, r.e || `${n0} vs ${n1}`) }

// DỌN 5.x: trả cha_lot về xac_nhan=false
await c.query(`update kho.nang_luc_to set xac_nhan=false where ma_to='cha_lot' and den_ngay is null`)
ok('5.x DỌN · cha_lot trả về xac_nhan=false', (await one(`select xac_nhan from kho.nang_luc_to where ma_to='cha_lot' and den_ngay is null`)).xac_nhan === false)

await c.query('rollback')

// ═══ 4.5 · PostgREST HTTP THẬT: authenticated INSERT/UPDATE/DELETE xep_lich → cấm cả 3 ═══
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const robot = Object.fromEntries(readFileSync('ops/.env.robot', 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const TOK = (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: robot.TEST_SALE_EMAIL, password: robot.TEST_SALE_PASS }) })).json()).access_token
const H = { apikey: ANON, Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'Content-Profile': 'kho', 'Accept-Profile': 'kho' }
const cam = s => s === 401 || s === 403
const ins = await fetch(`${URL}/rest/v1/xep_lich`, { method: 'POST', headers: H, body: JSON.stringify({ ma_don: 'T8-001', buoc_thu_tu: 1, tuan_bat_dau: '2026-09-07', kieu_xep: 'xuoi', gio: 0 }) })
ok('4.5 PostgREST INSERT xep_lich (authenticated) → CẤM', cam(ins.status), 'status=' + ins.status)
const upd = await fetch(`${URL}/rest/v1/xep_lich?id=eq.999999`, { method: 'PATCH', headers: H, body: JSON.stringify({ gio: 1 }) })
ok('4.5 PostgREST UPDATE xep_lich → CẤM', cam(upd.status), 'status=' + upd.status)
const del = await fetch(`${URL}/rest/v1/xep_lich?id=eq.999999`, { method: 'DELETE', headers: H })
ok('4.5 PostgREST DELETE xep_lich → CẤM', cam(del.status), 'status=' + del.status)
const sel = await fetch(`${URL}/rest/v1/xep_lich?limit=1`, { headers: H })
ok('4.5 (đối chứng) PostgREST SELECT xep_lich → 200 (client vẫn ĐỌC)', sel.status === 200, 'status=' + sel.status)

// ═══ 5.4 · nl_xac_nhan anon (chưa đăng nhập) → chặn ═══
const anonXN = await fetch(`${URL}/rest/v1/rpc/nl_xac_nhan`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', 'Content-Profile': 'kho' }, body: JSON.stringify({ p_ma_to: 'cha_lot' }) })
ok('5.4 nl_xac_nhan anon → CHẶN', anonXN.status === 400 || anonXN.status === 401 || anonXN.status === 403, 'status=' + anonXN.status)

const after = (await one(`select count(*)::int n from kho.xep_lich`)).n
ok('DỌN · xep_lich vẫn 0 dòng (tx rollback + HTTP cấm)', after === 0, `n=${after}`)
console.log(`\nKẾT QUẢ test_wp47: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
