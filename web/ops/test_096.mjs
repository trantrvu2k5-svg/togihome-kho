// TEST CẮN — 096 · sale_dong_doi_don (dòng đời đơn). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', NULLVAI:'00000000-0000-0000-0000-000000000000' }
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
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T96','bao_gia','le','KH96')`)
  const donId = (await q(`select id from kho.don_hang where ma_don='T96'`))[0].id
  // 4 nguồn: nhật ký (bao_gia + sua_gop_y giả bằng den) · bản gửi v1 · khách chê · link
  await q(`insert into kho.don_hang_nhat_ky(don_id,tu,den,nguoi_id,luc,ly_do) values
    ($1,null,'bao_gia',$2, now()-interval '5 days', null),
    ($1,'bao_gia','dang_thiet_ke',$2, now()-interval '4 days', null)`, [donId, NS])
  const banId = (await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui,ma_ns_phan_hoi,luc_phan_hoi,ghi_chu_phan_hoi)
    values('T96',1,$1,'chua_dung_yeu_cau', now()-interval '3 days', $1, now()-interval '2 days','cánh tủ màu quá tối') returning id`, [NS]))[0].id
  await q(`insert into kho.link_ban_khach(token,ban_id,het_han,noi_dung,tao_boi,tao_luc) values('tk96',$1,now()+interval '7 days','{}'::jsonb,$2, now()-interval '2 days 12 hours')`, [banId, NS])

  console.log('── 1 · gộp 4 nguồn, mới nhất trên cùng ──')
  const g = await gK(U.sale, `select kho.sale_dong_doi_don('T96',60) g`)
  const kinds = (g || []).map(e => e.kind)
  ok('#1 đủ 4 loại nguồn (tt·ban_gui·phan_hoi·link)', ['tt', 'ban_gui', 'phan_hoi', 'link'].every(k => kinds.includes(k)), JSON.stringify(kinds))
  ok('#1 ít nhất 5 sự kiện (2 tt + gửi + chê + link)', (g || []).length >= 5, String((g || []).length))
  // sắp xếp mới→cũ
  const lucs = (g || []).map(e => new Date(e.luc).getTime())
  ok('#1 sắp MỚI NHẤT TRÊN CÙNG (luc giảm dần)', lucs.every((v, i) => i === 0 || lucs[i - 1] >= v))
  const phanHoi = (g || []).find(e => e.kind === 'phan_hoi')
  ok('#1 phản hồi mang code + ghi (khách chê + lý do)', phanHoi && phanHoi.code === 'chua_dung_yeu_cau' && phanHoi.ghi === 'cánh tủ màu quá tối', JSON.stringify(phanHoi))
  ok('#1 sự kiện có ai_ten + ai_vai (dịch được)', (g || []).some(e => e.ai_ten && e.ai_vai))

  console.log('\n── 3 · cổng vai + KHÔNG giá vốn ──')
  ok('#3 vai NULL → CHẶN', (await asK(U.NULLVAI, `select kho.sale_dong_doi_don('T96',60)`)).e !== null)
  ok('#3 tho → CHẶN', (await asK(U.tho, `select kho.sale_dong_doi_don('T96',60)`)).e !== null)
  ok('#3 ceo xem được', Array.isArray(await gK(U.ceo, `select kho.sale_dong_doi_don('T96',60) g`)))
  const keys = Object.keys((g || [])[0] || {})
  ok('#3 KHÔNG trường giá vốn', !keys.some(k => /gia_von|gia_chot|doanh_thu|^tien$|von|chuyen_giao/.test(k)), JSON.stringify(keys))

  console.log('\n── 4 · limit ──')
  const g2 = await gK(U.sale, `select kho.sale_dong_doi_don('T96',2) g`)
  ok('#4 p_gioi_han=2 → tối đa 2 sự kiện (mới nhất)', Array.isArray(g2) && g2.length === 2)

  await c.query('rollback')
  console.log('   (đã ROLLBACK T96)')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_096: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
