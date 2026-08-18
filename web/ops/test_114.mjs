// TEST CẮN — 114 · gộp thương hiệu: 0 bản ghi trỏ brand tắt · view danh mục chung · brand tắt KHÔNG xoá (đơn cũ mở được). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
const BT = ['togihome-kr','togihome-bcc','togihome-gaming','togihome-hd','togihome-office','togihome-bh','togihome-vp']

try {
  await c.query('begin')

  console.log('── 1 · sau gộp: 0 bản ghi trỏ 7 biến thể (đã tắt) ──')
  const r1 = (await q(`select
    (select count(*) from kho.don_hang where thuong_hieu = any($1)) dh,
    (select count(*) from kho.niem_yet where ma_thuong_hieu = any($1)) ny,
    (select count(*) from kho.bo_san_pham where ma_thuong_hieu = any($1)) bo`, [BT]))[0]
  ok('#1 don_hang/niem_yet/bo trỏ biến thể = 0', +r1.dh === 0 && +r1.ny === 0 && +r1.bo === 0, JSON.stringify(r1))

  console.log('\n── 2 · 7 biến thể TẮT nhưng KHÔNG xoá (giữ lịch sử) ──')
  const bt = await q(`select ma,ngung from kho.thuong_hieu where ma = any($1) order by ma`, [BT])
  ok('#2 7 dòng biến thể VẪN tồn tại', bt.length === 7)
  ok('#2 tất cả ngung=true', bt.every(r => r.ngung === true))
  ok('#2 togihome gốc còn bật', (await q(`select ngung from kho.thuong_hieu where ma='togihome'`))[0].ngung === false)

  console.log('\n── 3 · VIEW thuong_hieu_ban = danh mục CHUNG (9 brand thật, KHÔNG biến thể, KHÔNG showroom) ──')
  const view = (await q(`select ma from kho.thuong_hieu_ban order by ma`)).map(r => r.ma)
  ok('#3 view KHÔNG chứa biến thể nào', !view.some(m => BT.includes(m)))
  ok('#3 view KHÔNG chứa showroom (kenh_ban)', !view.includes('showroom'))
  ok('#3 view CÓ togihome gốc + 8 brand thật (9 dòng)', view.length === 9 && view.includes('togihome') && view.includes('vufurni') && view.includes('haigo'), view.join(','))

  console.log('\n── 4 · dropdown 2 app CÙNG danh sách (đọc cùng view; asK sale & ceo thấy giống) ──')
  const vSale = (await asK(U.sale, `select ma from kho.thuong_hieu_ban order by ma`)).r
  const vCeo = (await asK(U.ceo, `select ma from kho.thuong_hieu_ban order by ma`)).r
  ok('#4 sale đọc view được + = ceo (cùng danh sách)', vSale && vCeo && JSON.stringify(vSale) === JSON.stringify(vCeo) && vSale.length === 9, `sale=${vSale && vSale.length} ceo=${vCeo && vCeo.length}`)

  console.log('\n── 5 · đơn cũ trỏ brand TẮT vẫn MỞ bình thường (FK còn nguyên) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,thuong_hieu) values('T114','bao_gia','le','togihome-bcc')`)  // FK tới biến thể tắt — HỢP LỆ vì dòng còn
  const don = await q(`select ma_don,thuong_hieu from kho.don_hang where ma_don='T114'`)
  ok('#5 chèn + đọc đơn brand tắt OK (FK còn, không mồ côi)', don.length === 1 && don[0].thuong_hieu === 'togihome-bcc')
  const ten = await q(`select ten from kho.thuong_hieu where ma='togihome-bcc'`)
  ok('#5 vẫn tra được TÊN brand tắt (để hiển thị đơn cũ)', ten.length === 1 && ten[0].ten === 'Togihome bàn cao cấp')

  await c.query('rollback')
  ok('rollback sạch', (await q(`select count(*)::int n from kho.don_hang where ma_don='T114'`))[0].n === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_114: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
