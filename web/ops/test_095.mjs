// TEST CẮN — 095 · tk_chi_tiet_don TRẢ "Khách muốn gì" (phong_cach·ngan_sach_trieu·link) cho app Thiết kế. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : null }
try {
  await c.query('begin')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,phong_cach,ngan_sach_trieu,ghi_chu,link)
    values('T95','bao_gia','le','KH95','Tân cổ điển',45,'Cửa lùa, màu óc chó','https://ref/tu')`)
  const donId = (await q(`select id from kho.don_hang where ma_don='T95'`))[0].id
  await q(`insert into kho.don_hang_mon(don_id,ten,trang_thai) values($1,'Tủ áo','cho_cat')`, [donId])

  console.log('── 1 · tk_chi_tiet_don trả 4 trường Khách muốn gì ──')
  const g = await gK(U.ceo, `select kho.tk_chi_tiet_don('T95') g`)
  ok('#1 phong_cach', g && g.phong_cach === 'Tân cổ điển', JSON.stringify(g && g.phong_cach))
  ok('#1 ngan_sach_trieu', g && Number(g.ngan_sach_trieu) === 45)
  ok('#1 ghi_chu (=yêu cầu riêng, đã có sẵn)', g && g.ghi_chu === 'Cửa lùa, màu óc chó')
  ok('#1 link', g && g.link === 'https://ref/tu')

  console.log('\n── 3 · cổng vai (thiết kế xem, tho chặn) ──')
  ok('#3 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.tk_chi_tiet_don('T95')`)).e !== null)
  ok('#3 tho → CHẶN', (await asK(U.tho, `select kho.tk_chi_tiet_don('T95')`)).e !== null)

  await c.query('rollback')
  console.log('   (đã ROLLBACK T95)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_095: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
