// TEST CẮN — 109 · ép nguon_khach cổng chốt + dedupe khách + khach_moi + không hồi tố. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const q = async (s, a = []) => (await c.query(s, a)).rows

try {
  await c.query('begin')

  console.log('── 1 · vai NULL chốt đơn (bao_gia→moi_len_don) → CHẶN (cổng vai/RLS) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach,sdt_khach,ten_khach) values('T109-1','bao_gia','le','gioi_thieu','0900111','A')`)
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia) select id,'Món',1,1000000 from kho.don_hang where ma_don='T109-1'`)
  await asK(U.NULLVAI, `select kho.chot_don((select id from kho.don_hang where ma_don='T109-1'), null, null)`)
  ok('#1 NULLVAI KHÔNG chuyển được (đơn vẫn bao_gia)', (await q(`select trang_thai from kho.don_hang where ma_don='T109-1'`))[0].trang_thai === 'bao_gia')

  console.log('\n── 2 · chốt đơn THIẾU nguon_khach → CHẶN đúng thông báo; điền rồi → QUA ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach,sdt_khach,ten_khach) values('T109-2','bao_gia','le',null,'0900222','B')`)
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia) select id,'Món',1,1000000 from kho.don_hang where ma_don='T109-2'`)
  const r2 = await asK(U.ceo, `select kho.chot_don((select id from kho.don_hang where ma_don='T109-2'), null, null)`)
  ok('#2 thiếu nguon_khach → CHẶN "Chưa chọn nguồn khách"', r2.e !== null && /Chưa chọn nguồn khách/.test(r2.e), r2.e)
  await q(`update kho.don_hang set nguon_khach='quang_cao' where ma_don='T109-2'`)
  const r2b = await asK(U.ceo, `select kho.chot_don((select id from kho.don_hang where ma_don='T109-2'), null, null)`)
  ok('#2b điền nguon_khach rồi → QUA', r2b.e === null, r2b.e)

  console.log('\n── 3 · hai đơn cùng sdt: đơn1 da_giao → mới=true + set ngay_mua_dau; đơn2 → mới=false ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,sdt_khach,ten_khach,ngay_giao) values('T109-3a','da_giao','le','0900333','C','2099-05-15')`)
  const a3 = (await q(`select khach_moi from kho.don_hang where ma_don='T109-3a'`))[0]
  const k3 = (await q(`select ngay_mua_dau::text nmd from kho.khach where sdt='0900333'`))[0]
  ok('#3 đơn1 khach_moi=true', a3.khach_moi === true)
  ok('#3 khach.ngay_mua_dau = ngay_giao (2099-05-15)', k3 && k3.nmd === '2099-05-15', JSON.stringify(k3))
  ok('#3 khach dedupe tự tạo từ sdt (ten nối)', (await q(`select ten from kho.khach where sdt='0900333'`))[0].ten === 'C')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,sdt_khach,ten_khach,ngay_giao) values('T109-3b','da_giao','le','0900333','C','2099-06-20')`)
  ok('#3 đơn2 cùng sdt khach_moi=false', (await q(`select khach_moi from kho.don_hang where ma_don='T109-3b'`))[0].khach_moi === false)
  ok('#3 ngay_mua_dau KHÔNG đổi (vẫn 2099-05-15)', (await q(`select ngay_mua_dau::text nmd from kho.khach where sdt='0900333'`))[0].nmd === '2099-05-15')

  console.log('\n── 4 · khach.ngay_mua_dau CÓ SẴN → KHÔNG ghi đè ──')
  await q(`insert into kho.khach(sdt,ten,ngay_mua_dau,ngung) values('0900444','D','2000-01-01',false)`)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,sdt_khach,ten_khach,ngay_giao) values('T109-4','da_giao','le','0900444','D','2099-05-15')`)
  ok('#4 ngay_mua_dau giữ 2000-01-01 (không đè)', (await q(`select ngay_mua_dau::text nmd from kho.khach where sdt='0900444'`))[0].nmd === '2000-01-01')
  ok('#4 đơn khách CŨ → khach_moi=false', (await q(`select khach_moi from kho.don_hang where ma_don='T109-4'`))[0].khach_moi === false)

  console.log('\n── 7 · đơn cũ (nguon_khach NULL, ĐÃ ở moi_len_don) tiến tiếp KHÔNG bị vỡ (không hồi tố) ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach) values('T109-7','moi_len_don','le',null)`)   // INSERT thẳng, nguon NULL
  let r7 = { e: null }; try { await c.query(`select set_config('chan.off_vai','1',true)`); await q(`update kho.don_hang set trang_thai='dang_thiet_ke' where ma_don='T109-7'`) } catch (x) { r7 = { e: x.message } } finally { await c.query(`select set_config('chan.off_vai','',true)`) }  // [WP-06] forward moi→dang_thiet_ke: client hết quyền UPDATE trang_thai → owner+off_vai (giữ kiem_chuyen)
  ok('#7 moi_len_don→dang_thiet_ke KHÔNG dính gác nguon_khach (không hồi tố)', r7.e === null, r7.e)

  console.log('\n── 5+6 · phần DROP cột ──')
  ok('#5 kgs VẪN CÒN (đúng chủ ý: array không-gian, không drop)', (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='kgs'`)).length === 1)
  ok('#6 khach_sdt ĐÃ DROP (L-51/db-118: cột FK không đường ghi; reader dùng sdt_khach)', (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='khach_sdt'`)).length === 0)

  await c.query('rollback')
  const clean = (await q(`select count(*)::int n from kho.don_hang where ma_don like 'T109-%'`))[0].n
  ok('rollback sạch (0 đơn T109)', clean === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_109: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
