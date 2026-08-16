// TEST CẮN — 087 · sale_ban_cho_gui (chuông bản chờ gửi). Tx rollback.
//   cd web && node ops/test_087.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  truong_nhom_sale:'85f5a6bf-dd52-487b-b7b1-6ddea4508333',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  NULLVAI:'00000000-0000-0000-0000-000000000000',
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }

try {
  await c.query('begin')
  const NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.ceo]))[0].id
  // helper: đơn + bản thiết kế (trang_thai) + phiên bản + tuỳ chọn link + số ngày chờ
  async function don(ma, tt, pb, ngayCho, coLink = false) {
    await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values($1,'bao_gia','le',$2)`, [ma, 'KH ' + ma])
    const ban = (await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui)
                          values($1,$2,$3,$4, now() - ($5||' days')::interval) returning id`, [ma, pb, NS, tt, ngayCho]))[0].id
    if (coLink) await q(`insert into kho.link_ban_khach(token,ban_id,het_han,noi_dung)
                         values($1,$2, now()+interval '7 days','{}'::jsonb)`, ['tok-' + ma, ban])
    return ban
  }

  // ═══ 1 · vai NULL → CHẶN ═══
  console.log('\n── 1 · cổng vai ──')
  const rNull = await asK(U.NULLVAI, `select kho.sale_ban_cho_gui(50) g`)
  ok('#1 vai NULL → CHẶN', rNull.e !== null && /chỉ sale\/truong_nhom_sale\/ceo/.test(rNull.e || ''), rNull.e || '(lọt!)')
  // ═══ 2 · xuong/tho → CHẶN · sale/truong_nhom_sale/ceo → ĐƯỢC ═══
  for (const v of ['xuong', 'tho']) {
    const r = await asK(U[v], `select kho.sale_ban_cho_gui(50) g`)
    ok(`#2 ${v} → CHẶN`, r.e !== null, r.e || '(lọt!)')
  }
  for (const v of ['sale', 'truong_nhom_sale', 'ceo']) {
    const r = await asK(U[v], `select kho.sale_ban_cho_gui(50) g`)
    ok(`#2 ${v} → ĐƯỢC`, r.e === null, r.e || '')
  }

  // ═══ 3 · badge (tong) == số dòng danh sách (ds) ═══
  console.log('\n── 3 · badge == danh sách ──')
  await don('T87-A', 'cho_duyet', 1, 5)   // chờ 5 ngày
  await don('T87-B', 'cho_duyet', 1, 2)   // chờ 2 ngày
  await don('T87-C', 'cho_duyet', 1, 8)   // chờ 8 ngày (lên đầu)
  const g3 = await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)
  ok('#3 tong == ds.length (badge khớp danh sách)', g3.tong === g3.ds.length, `tong=${g3.tong} ds=${g3.ds.length}`)
  console.log(`   badge=${g3.tong} · danh sách=${g3.ds.length} · thứ tự chờ giảm dần: ${g3.ds.map(x => x.ma_don + '(' + x.so_ngay_cho + ')').join(' ')}`)
  ok('#3b chờ lâu nhất lên trên (C=8 đầu)', g3.ds[0].ma_don === 'T87-C' && g3.ds[0].so_ngay_cho === 8)

  // ═══ 4 · chê → gửi bản MỚI → QUAY LẠI ═══
  console.log('\n── 4 · khách chê → bản phiên bản mới → quay lại ──')
  const banD = await don('T87-D', 'cho_duyet', 1, 3)
  const inDs = async () => (await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)).ds.some(x => x.ma_don === 'T87-D')
  const co1 = await inDs()
  await q(`update kho.ban_thiet_ke set trang_thai='khach_doi_y' where id=$1`, [banD])  // khách chê
  const co2 = await inDs()
  await don('T87-D2dummy', 'cho_duyet', 9, 1)  // (noise)
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) values('T87-D',2,$1,'cho_duyet',now())`, [NS]) // gửi bản v2
  const co3 = await inDs()
  ok('#4 v1 cho_duyet: CÓ → chê: MẤT → gửi v2 cho_duyet: QUAY LẠI', co1 === true && co2 === false && co3 === true,
    `co1=${co1} co2=${co2} co3=${co3}`)

  // ═══ 5 · đã gửi link → BIẾN MẤT ═══
  console.log('\n── 5 · đã gửi link → biến mất ──')
  await don('T87-E', 'cho_duyet', 1, 4, false)
  const eco1 = (await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)).ds.some(x => x.ma_don === 'T87-E')
  // gửi link cho bản mới nhất của E
  const banE = (await q(`select id from kho.ban_thiet_ke where ma_don='T87-E' order by phien_ban desc limit 1`))[0].id
  await q(`insert into kho.link_ban_khach(token,ban_id,het_han,noi_dung) values('tok-E',$1,now()+interval '7 days','{}'::jsonb)`, [banE])
  const eco2 = (await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)).ds.some(x => x.ma_don === 'T87-E')
  ok('#5 chưa link: CÓ → gửi link: MẤT', eco1 === true && eco2 === false, `truoc=${eco1} sau=${eco2}`)

  // ═══ 6 · HIỆU NĂNG 3.000 đơn ═══
  console.log('\n── 6 · hiệu năng 3.000 đơn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach)
           select 'P87-'||g,'bao_gia','le','KH '||g from generate_series(1,3000) g`)
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui)
           select 'P87-'||g,1,$1,'cho_duyet', now()-((g%20)||' days')::interval from generate_series(1,3000) g`, [NS])
  await c.query('analyze kho.ban_thiet_ke'); await c.query('analyze kho.link_ban_khach'); await c.query('analyze kho.don_hang')
  const t0 = Date.now()
  const g6 = await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)
  const ms = Date.now() - t0
  ok(`#6 sale_ban_cho_gui ở 3.000+ đơn = ${ms}ms (< 500ms) · tong=${g6.tong} ds=${g6.ds.length}(≤50)`,
    ms < 500 && g6.ds.length <= 50, `${ms}ms`)

  await c.query('rollback')
  console.log('   (đã ROLLBACK toàn bộ đơn test T87-*/P87-*)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_087: ${P} pass / ${F} fail`)
} catch (e) {
  console.error('💥', e.message); F++
  try { await c.query('rollback') } catch (_) {}
} finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
