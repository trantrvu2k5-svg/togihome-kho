// TEST CẮN — 064 giờ chuẩn suy từ đơn giá. So giờ CŨ (đã ghi lại) với MỚI (live sau db/064).
//   OLD (trước db/064, đã đo): master=21.75 · nho=12.65 · đơn=75.79.
//   Chạy: cd web && node ops/test_064.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const OLD = { master: 21.75, nho: 12.65, don: 75.79 }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
// khoá theo MÓN (db/069): tra món-id của CAN-A-DEMO theo biến thể rồi tính giờ
async function gio(sp) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  const mid = (await c.query(`select id from kho.don_hang_mon where sp_id=$1 and don_id=(select id from kho.don_hang where ma_don='CAN-A-DEMO') limit 1`, [sp])).rows[0].id
  const r = (await c.query(`select kho.gio_du_kien_cua_mon($1) g`, [mid])).rows[0].g
  await c.query('rollback to savepoint sp'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return r
}
try {
  await c.query('begin')
  const M = await gio('CAN-A-TUAO-MASTER-BT'), N = await gio('CAN-A-TUAO-NHO-BT')

  // 1 · giờ mới NHỎ HƠN giờ cũ trên master
  console.log('\n── 1 · giờ mới < giờ cũ (tủ áo master) ──')
  console.log(`   CŨ = ${OLD.master}h · MỚI = ${Number(M.tong_gio).toFixed(2)}h · giảm ${(OLD.master - M.tong_gio).toFixed(2)}h (${((1 - M.tong_gio / OLD.master) * 100).toFixed(0)}%)`)
  ok('✅ giờ MỚI < giờ CŨ trên master (🟥 bằng/lớn hơn = ĐỎ)', Number(M.tong_gio) < OLD.master)

  // 2 · không dòng nào gio_moi_don_vi âm/0 (người)
  const neg = Number((await c.query(`select count(*) n from kho.quy_trinh_buoc where loai_buoc<>'tu_chay' and gio_moi_don_vi<=0`)).rows[0].n)
  ok('✅ không bước NGƯỜI nào gio_moi_don_vi ≤ 0', neg === 0, neg + ' bước ≤0')
  // và giờ ra của mọi bước > 0
  const badMon = M.buoc.concat(N.buoc).filter(b => !(Number(b.gio) > 0))
  ok('✅ mọi bước ra giờ > 0 (không âm/0)', badMon.length === 0, JSON.stringify(badMon))

  // 3 · thứ tự đúng: master 4C 2m4 > nho 2C 1m2
  console.log(`\n── 3 · thứ tự · master=${Number(M.tong_gio).toFixed(2)} > nho=${Number(N.tong_gio).toFixed(2)} ──`)
  ok('✅ master > nho (không đảo chiều)', Number(M.tong_gio) > Number(N.tong_gio))

  // 4 · cờ [TẠM] còn nguyên trên MỌI dòng
  const lt = (await c.query(`select count(*) tong, count(*) filter(where la_tam) tam from kho.quy_trinh_buoc`)).rows[0]
  ok('✅ mọi quy_trinh_buoc vẫn la_tam=true (chưa ĐO, chưa ai gỡ)', Number(lt.tong) === Number(lt.tam) && Number(lt.tong) > 0, `${lt.tam}/${lt.tong}`)

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 064: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
