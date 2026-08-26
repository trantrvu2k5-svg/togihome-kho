// TEST CẮN — 101 · chủ đơn sale_phu_trach: tự gán + đổi chủ + siết theo chủ. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tnsale:'85f5a6bf-dd52-487b-b7b1-6ddea4508333', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
try {
  await c.query('begin')
  const SALE_NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.sale]))[0].id
  const CEO_NS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.ceo]))[0].id

  console.log('── 1 · TỰ GÁN khi tạo đơn = người đăng nhập (trigger BEFORE INSERT) ──')
  // WP-07: tạo qua tao_don (server ép bao_gia); trigger gan_sale_phu_trach vẫn TỰ gán theo người đăng nhập.
  await asK(U.sale, `select * from kho.tao_don(jsonb_build_object('ma_don','L101X','dong','le','ten_khach','KX'), false)`)
  ok('#1 đơn sale tạo → sale_phu_trach = sale', (await q(`select sale_phu_trach from kho.don_hang where ma_don='L101X'`))[0].sale_phu_trach === SALE_NS)
  await asK(U.ceo, `select * from kho.tao_don(jsonb_build_object('ma_don','L101Y','dong','le','ten_khach','KY'), false)`)
  ok('#1 đơn ceo tạo → sale_phu_trach = ceo', (await q(`select sale_phu_trach from kho.don_hang where ma_don='L101Y'`))[0].sale_phu_trach === CEO_NS)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo) values('L101SEED','bao_gia','le','KS',true)`)
  ok('#1 seed KHÔNG JWT → NULL (demo không réo chuông)', (await q(`select sale_phu_trach from kho.don_hang where ma_don='L101SEED'`))[0].sale_phu_trach === null)

  console.log('\n── 2 · SIẾT sale_bao_gia_ds theo chủ ──')
  const bgSale = await gK(U.sale, `select kho.sale_bao_gia_ds(200) g`)
  const maSale = new Set((bgSale.ds || []).map(x => x.ma_don))
  ok('#2 sale THẤY đơn mình (L101X)', maSale.has('L101X'))
  ok('#2 sale KHÔNG thấy đơn ceo (L101Y)', !maSale.has('L101Y'))
  const bgCeo = await gK(U.ceo, `select kho.sale_bao_gia_ds(200) g`)
  const maCeo = new Set((bgCeo.ds || []).map(x => x.ma_don))
  ok('#2 ceo thấy CẢ HAI (L101X + L101Y)', maCeo.has('L101X') && maCeo.has('L101Y'))
  const bgTn = await gK(U.tnsale, `select kho.sale_bao_gia_ds(200) g`)
  ok('#2 truong_nhom_sale thấy cả nhóm (L101X + L101Y)', new Set((bgTn.ds||[]).map(x=>x.ma_don)).has('L101X') && new Set((bgTn.ds||[]).map(x=>x.ma_don)).has('L101Y'))
  ok('#2 bg trả sale_ten (hiện tên chủ)', (bgCeo.ds||[]).find(x=>x.ma_don==='L101X')?.sale_ten != null)

  console.log('\n── 3 · SIẾT chuông sale_ban_cho_gui theo chủ (badge sale = đơn mình) ──')
  // dựng 1 bản cho_duyet chưa link cho L101X (sale) và L101Y (ceo)
  for (const [ma,uid] of [['L101X',SALE_NS],['L101Y',CEO_NS]])
    await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) values($1,1,$2,'cho_duyet',now())`, [ma, uid])
  const cgSale = await gK(U.sale, `select kho.sale_ban_cho_gui(50) g`)
  const cgMa = new Set((cgSale.ds||[]).map(x=>x.ma_don))
  ok('#3 chuông sale: có L101X, KHÔNG L101Y', cgMa.has('L101X') && !cgMa.has('L101Y'))
  const cgCeo = await gK(U.ceo, `select kho.sale_ban_cho_gui(50) g`)
  ok('#3 chuông ceo: có cả L101X + L101Y', new Set((cgCeo.ds||[]).map(x=>x.ma_don)).has('L101X') && new Set((cgCeo.ds||[]).map(x=>x.ma_don)).has('L101Y'))

  console.log('\n── 4 · ĐỔI CHỦ chỉ truong_nhom_sale/ceo ──')
  ok('#4 sale thường → CHẶN', (await asK(U.sale, `select kho.doi_sale_phu_trach('L101X',$1,'thử')`, [CEO_NS])).e !== null)
  ok('#4 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.doi_sale_phu_trach('L101X',$1,'thử')`, [CEO_NS])).e !== null)
  const doi = await asK(U.ceo, `select kho.doi_sale_phu_trach('L101X',$1,'giao lại') g`, [CEO_NS])
  ok('#4 ceo đổi được', doi.e === null && doi.r[0].g.ok === true, doi.e)
  ok('#4 chủ đã đổi sang ceo', (await q(`select sale_phu_trach from kho.don_hang where ma_don='L101X'`))[0].sale_phu_trach === CEO_NS)
  const nk = await q(`select ly_do from kho.don_hang_nhat_ky nk join kho.don_hang d on d.id=nk.don_id where d.ma_don='L101X' order by nk.luc desc limit 1`)
  ok('#4 ghi nhật ký "Đổi sale phụ trách"', /Đổi sale phụ trách/.test(nk[0]?.ly_do || ''), nk[0]?.ly_do)
  ok('#4 người mới không hợp lệ → CHẶN', (await asK(U.ceo, `select kho.doi_sale_phu_trach('L101X',$1,'x')`, [U.NULLVAI])).e !== null)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_101: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
