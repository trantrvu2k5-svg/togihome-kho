// TEST — WP-72 L-72b · hạn báo giá + nối lý do thua vào cổng. Tx rollback, không để vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 60000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const owner = async () => { await c.query('reset role') }
const asCeo = async () => { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })]) }
// chạy 1 câu; nếu RAISE thì rollback nested savepoint (khôi phục tx đang abort) rồi trả message
const rpcErr = async (s, a = []) => {
  await c.query('savepoint _e')
  try { await c.query(s, a); await c.query('release savepoint _e'); return null }
  catch (e) { await c.query('rollback to savepoint _e'); return e.message }
}

await c.query('begin')

// seed một đơn báo giá (owner), trả id
async function seedBG(ma, dong = 'le', extra = '') {
  await owner()
  const r = await one(`insert into kho.don_hang(ma_don, trang_thai, dong, doanh_thu, la_demo${extra ? ',' + extra.split('=')[0] : ''})
    values($1,'bao_gia',$2, 5000000, true${extra ? ',' + extra.split('=')[1] : ''}) returning id, han_tra_loi, ngay_tao_bao_gia::date td`, [ma, dong])
  return r
}

// ── T1(c). Đơn mới vào bao_gia → han_tra_loi tự có: le=+7, du_an=+21 ──
await c.query('savepoint s1')
const le = await seedBG('WP72-LE-1', 'le')
const da = await seedBG('WP72-DA-1', 'du_an')
const d7 = Math.round((new Date(le.han_tra_loi) - new Date(le.td)) / 86400000)
const d21 = Math.round((new Date(da.han_tra_loi) - new Date(da.td)) / 86400000)
ok('T1(c). đơn mới bao_gia: le → hạn +' + d7 + ' ngày (=7), du_an → +' + d21 + ' ngày (=21)', d7 === 7 && d21 === 21, JSON.stringify({ le: le.han_tra_loi, da: da.han_tra_loi }))
await c.query('rollback to savepoint s1')

// ── T2(d). Sale sửa hạn TAY → trigger KHÔNG ghi đè ──
await c.query('savepoint s2')
const o2 = await seedBG('WP72-TAY-1', 'le')            // auto = +7
await owner()
await c.query(`update kho.don_hang set han_tra_loi = date '2026-12-31' where id=$1`, [o2.id])
const h2 = (await one(`select han_tra_loi::text h from kho.don_hang where id=$1`, [o2.id])).h   // text → không lệch múi giờ
const o2b = await one(`insert into kho.don_hang(ma_don,trang_thai,dong,han_tra_loi,la_demo) values('WP72-TAY-2','bao_gia','le',date '2027-01-15',true) returning han_tra_loi::text h`)
ok('T2(d). sale đặt hạn tay → giữ nguyên (update: ' + h2 + ' · insert: ' + o2b.h + ')',
  h2 === '2026-12-31' && o2b.h === '2027-01-15')
await c.query('rollback to savepoint s2')

// ── T3(a). Đóng THUA thiếu lý do → TỪ CHỐI cả qua RPC lẫn UPDATE thẳng ──
await c.query('savepoint s3')
const o3 = await seedBG('WP72-THUA-0', 'le')
await asCeo()
const eRpc = await rpcErr(`select kho.doi_trang_thai_don($1::uuid,'bao_gia_thua',null,null,null)`, [o3.id])
await owner()
const eUpd = await rpcErr(`update kho.don_hang set trang_thai='bao_gia_thua' where id=$1`, [o3.id])
ok('T3(a). thua thiếu lý do bị chặn — RPC: ' + (eRpc ? 'CHẶN' : 'LỌT') + ' · UPDATE thẳng: ' + (eUpd ? 'CHẶN' : 'LỌT'),
  !!eRpc && /chọn lý do/i.test(eRpc) && !!eUpd && /lý do/i.test(eUpd), JSON.stringify({ eRpc, eUpd }))
await c.query('rollback to savepoint s3')

// ── T3b. Lý do thua NGOÀI 5 giá trị → RPC từ chối ──
await c.query('savepoint s3b')
const o3b = await seedBG('WP72-THUA-X', 'le')
await asCeo()
const eBad = await rpcErr(`select kho.doi_trang_thai_don($1::uuid,'bao_gia_thua',null,'linh_tinh',null)`, [o3b.id])
ok('T3b. lý do thua ngoài 5 giá trị → bị từ chối', !!eBad && /không hợp lệ/i.test(eBad), eBad)
await c.query('rollback to savepoint s3b')

// ── T4(b). Đóng THUA CÓ lý do → SELECT ra dòng mang ly_do_thua + ghi_chu_thua ──
await c.query('savepoint s4')
const o4 = await seedBG('WP72-THUA-1', 'le')
await asCeo()
await c.query(`select kho.doi_trang_thai_don($1::uuid,'bao_gia_thua',null,'gia_cao','khách chê đắt')`, [o4.id])
await owner()
const r4 = await one(`select trang_thai, ly_do_thua, ghi_chu_thua from kho.don_hang where id=$1`, [o4.id])
ok('T4(b). thua có lý do → ly_do_thua=' + r4.ly_do_thua + ' · ghi_chu="' + (r4.ghi_chu_thua || '') + '"',
  r4.trang_thai === 'bao_gia_thua' && r4.ly_do_thua === 'gia_cao' && r4.ghi_chu_thua === 'khách chê đắt')
await c.query('rollback to savepoint s4')

// ── T5. bao_gia_treo KHÔNG bắt lý do (giữ nguyên) ──
await c.query('savepoint s5')
const o5 = await seedBG('WP72-TREO-1', 'le')
await asCeo()
const eTreo = await rpcErr(`select kho.doi_trang_thai_don($1::uuid,'bao_gia_treo',null,null,null)`, [o5.id])
await owner()
const r5 = (await one(`select trang_thai from kho.don_hang where id=$1`, [o5.id])).trang_thai
ok('T5. treo không bắt lý do → chuyển OK (trang_thai=' + r5 + ')', !eTreo && r5 === 'bao_gia_treo', eTreo)
await c.query('rollback to savepoint s5')

// ── T6 (perf, luật 29/08). sale_bao_gia_han_dem @30k đơn bao_gia thật < 500ms ──
await c.query('savepoint s6')
await owner()
await c.query(`insert into kho.don_hang(ma_don,trang_thai,dong,doanh_thu,ngay_tao_bao_gia,han_tra_loi,la_demo)
  select 'PERF72-'||g, 'bao_gia', case when g%3=0 then 'du_an' else 'le' end, (random()*9e6)::numeric,
         now()-(g%40||' days')::interval, (current_date + ((g%10)-4)), false
  from generate_series(1,30000) g`)
await c.query(`analyze kho.don_hang`)
await asCeo()
const t0 = process.hrtime.bigint()
const dem = (await one(`select kho.sale_bao_gia_han_dem() j`)).j
const ms = Number(process.hrtime.bigint() - t0) / 1e6
ok('T6. sale_bao_gia_han_dem @30k = ' + ms.toFixed(0) + 'ms (<500) · qua_han ' + dem.qua_han.so + ' · sắp ' + dem.sap_het_han.so + ' · còn ' + dem.con_han.so, ms < 500, JSON.stringify(dem))
await c.query('rollback to savepoint s6')

await c.query('rollback')
const con = await one(`select count(*) n from kho.don_hang where ma_don like 'WP72-%' or ma_don like 'PERF72-%'`)
console.log(`\nrollback xong · đơn test còn: ${con.n} (phải 0)`)
console.log(`═══ test_wp72: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
