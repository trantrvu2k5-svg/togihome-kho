// TEST CẮN — 091 · sale_bao_gia_ds (màn báo giá v5). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
try {
  await c.query('begin')
  const NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.ceo]))[0].id
  async function don(ma, tt, buoc, ma_ns, banTT, coLink) {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,buoc_thiet_ke,ma_ns_thiet_ke)
             values($1,$2,'le',$3,$4,$5)`, [ma, tt, 'KH ' + ma, buoc, ma_ns])
    if (banTT) { const b = (await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values($1,1,$2,$3) returning id`, [ma, NS, banTT]))[0].id
      if (coLink) await q(`insert into kho.link_ban_khach(token,ban_id,het_han,noi_dung) values($1,$2,now()+interval '7 days','{}'::jsonb)`, ['tk-' + ma, b]) } }
  // đơn mỗi gd
  await don('B91-cn', 'bao_gia', null, null, null, false)            // chua_nhan
  await don('B91-dd', 'bao_gia', 'dang_dung', NS, null, false)       // dang_dung
  await don('B91-dx', 'bao_gia', 'dung_xong', NS, null, false)       // dung_xong → dang_dung
  await don('B91-bm', 'bao_gia', 'cho_duyet', NS, 'cho_duyet', false)// ban_moi (cho_duyet, chưa link)
  await don('B91-dg', 'bao_gia', 'cho_duyet', NS, 'cho_duyet', true) // da_gui (cho_duyet + link)
  await don('B91-sg', 'bao_gia', 'sua_gop_y', NS, 'khach_doi_y', false) // sua_gop_y
  await don('B91-du', 'bao_gia', 'cho_duyet', NS, 'khach_duyet', false) // du_len_don
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,ly_do_thua) values('B91-th','bao_gia_thua','le','x','gia_cao')`) // thua
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('B91-tr','bao_gia_treo','le','x')`) // treo

  const g = await gK(U.ceo, `select kho.sale_bao_gia_ds(1000) g`)
  const gdOf = ma => (g.ds.find(x => x.ma_don === ma) || {}).gd
  // ═══ 1 · gd đúng cho từng đơn (nền của "ô == danh sách") ═══
  console.log('\n── 1 · gd ánh xạ đúng ──')
  const map = { 'B91-cn': 'chua_nhan', 'B91-dd': 'dang_dung', 'B91-dx': 'dang_dung', 'B91-bm': 'ban_moi',
    'B91-dg': 'da_gui', 'B91-sg': 'sua_gop_y', 'B91-du': 'du_len_don', 'B91-th': 'thua', 'B91-tr': 'treo' }
  let allOk = true; for (const [ma, gd] of Object.entries(map)) { if (gdOf(ma) !== gd) { allOk = false; console.log(`   ✗ ${ma}: ${gdOf(ma)} ≠ ${gd}`) } }
  ok('#1 mọi gd đúng (dung_xong→dang_dung · cho_duyet±link→ban_moi/da_gui · khach_duyet→du_len_don)', allOk)
  // ô "Có bản mới chưa gửi" == đếm gd='ban_moi' trong ds (client sẽ tính đúng cách này)
  const banMoi = g.ds.filter(x => x.gd === 'ban_moi').length
  ok('#1b ô "ban_moi" (client) đếm từ CHÍNH ds → ô == số dòng lọc', banMoi === 1 && gdOf('B91-bm') === 'ban_moi')

  // ═══ 3 · cổng vai + KHÔNG lộ giá vốn ═══
  console.log('\n── 3 · cổng vai + không giá vốn ──')
  ok('#3 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.sale_bao_gia_ds(1000) g`)).e !== null)
  ok('#3 xuong → CHẶN', (await asK(U.xuong, `select kho.sale_bao_gia_ds(1000) g`)).e !== null)
  ok('#3 tho → CHẶN', (await asK(U.tho, `select kho.sale_bao_gia_ds(1000) g`)).e !== null)
  const keys = Object.keys(g.ds[0] || {})
  ok('#3 KHÔNG trường giá vốn (gia_von/khoi_1..3/gia_chuyen_giao)',
    !keys.some(k => /gia_von|khoi_[123]|chuyen_giao/.test(k)) && keys.includes('tien'), JSON.stringify(keys))

  // ═══ 5 · HIỆU NĂNG 3.000 đơn báo giá (server-side) ═══
  console.log('\n── 5 · hiệu năng ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,buoc_thiet_ke,ma_ns_thiet_ke)
           select 'PB91-'||g,'bao_gia','le','K'||g,(array['dang_dung','cho_duyet','sua_gop_y',null])[1+(g%4)],$1
           from generate_series(1,3000) g`, [NS])
  await c.query('analyze kho.don_hang'); await c.query('analyze kho.ban_thiet_ke'); await c.query('analyze kho.link_ban_khach')
  const plan = await asK(U.ceo, `explain (analyze, timing off) select kho.sale_bao_gia_ds(1000)`)
  const line = (plan.r || []).map(x => x['QUERY PLAN']).find(s => /Execution Time/.test(s || ''))
  const ms = line ? Number(line.match(/Execution Time: ([0-9.]+)/)[1]) : 9999
  ok(`#5 sale_bao_gia_ds ở 3.000+ đơn (SERVER exec) = ${ms}ms (< 500ms)`, ms < 500, `${ms}ms`)

  await c.query('rollback')
  console.log('   (đã ROLLBACK B91-*/PB91-*)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_091: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
