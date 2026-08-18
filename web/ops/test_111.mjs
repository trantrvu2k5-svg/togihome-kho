// TEST CẮN — 111 · vá lỗ "+ Lên đơn": gác nguon_khach MỌI đường vào moi_len_don (người dùng thật). Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', NULLVAI:'00000000-0000-0000-0000-000000000000' }
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

  console.log('── 1 · INSERT THẲNG moi_len_don (người dùng thật) THIẾU nguồn → CHẶN ──')
  const r1 = await asK(U.ceo, `insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach) values('T111-1','moi_len_don','le',null)`)
  ok('#1 ceo INSERT moi_len_don thiếu nguồn → CHẶN "Chưa chọn nguồn khách"', r1.e !== null && /Chưa chọn nguồn khách/.test(r1.e), r1.e)

  console.log('\n── 2 · INSERT THẲNG moi_len_don CÓ nguồn → QUA ──')
  const r2 = await asK(U.ceo, `insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach) values('T111-2','moi_len_don','le','quang_cao')`)
  ok('#2 ceo INSERT moi_len_don có nguồn → QUA', r2.e === null, r2.e)

  console.log('\n── 3 · đường bao_gia→moi_len_don vẫn chặn như cũ ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach) values('T111-3','bao_gia','le',null)`)  // raw seed bao_gia (không vai → không gác lúc insert)
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia) select id,'Món',1,1000000 from kho.don_hang where ma_don='T111-3'`)
  const r3 = await asK(U.ceo, `update kho.don_hang set trang_thai='moi_len_don' where ma_don='T111-3'`)
  ok('#3 bao_gia→moi_len_don thiếu nguồn → CHẶN', r3.e !== null && /Chưa chọn nguồn khách/.test(r3.e), r3.e)
  await q(`update kho.don_hang set nguon_khach='gioi_thieu' where ma_don='T111-3'`)
  ok('#3b điền nguồn rồi → QUA', (await asK(U.ceo, `update kho.don_hang set trang_thai='moi_len_don' where ma_don='T111-3'`)).e === null)

  console.log('\n── 4 · đơn cũ (legacy moi_len_don, nguồn NULL) tiến tiếp KHÔNG hồi tố ──')
  // legacy: raw q() INSERT (không vai → không gác) — mô phỏng đơn có sẵn trước lô
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach) values('T111-4','moi_len_don','le',null)`)
  ok('#4 raw INSERT moi_len_don nguồn NULL (service/seed) → QUA (không gác — bảo toàn ~15 test cũ)',
     (await q(`select trang_thai from kho.don_hang where ma_don='T111-4'`))[0].trang_thai === 'moi_len_don')
  const r4 = await asK(U.ceo, `update kho.don_hang set trang_thai='dang_thiet_ke' where ma_don='T111-4'`)
  ok('#4 moi_len_don→dang_thiet_ke (đơn cũ, nguồn NULL) → KHÔNG bị chặn (không hồi tố)', r4.e === null, r4.e)

  console.log('\n── 5 · sửa đơn moi_len_don giữ nguyên trạng thái (không re-entry) → KHÔNG chặn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,nguon_khach,ten_khach) values('T111-5','moi_len_don','le',null,'K')`)
  const r5 = await asK(U.ceo, `update kho.don_hang set ten_khach='K2' where ma_don='T111-5'`)   // vẫn moi_len_don, nguồn NULL
  ok('#5 sửa đơn moi_len_don (old=new=moi_len_don) → KHÔNG dính gác (không phải VÀO)', r5.e === null, r5.e)

  await c.query('rollback')
  ok('rollback sạch', (await q(`select count(*)::int n from kho.don_hang where ma_don like 'T111-%'`))[0].n === 0)
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_111: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, e.stack); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
