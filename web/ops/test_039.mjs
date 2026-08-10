// TEST PHẢI CẮN — 039 read-RPC app xưởng: tho ĐỌC-được-qua-RPC (KHÔNG qua bảng) + tien_mon.
//   db/038 đã ở prod -> tx này chỉ áp 039, seed trực tiếp (postgres bypass RLS), test, ROLLBACK.
//   Chạy: DB_HOST=… DB_USER=… DB_PASS=… node ops/test_039.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/039_app_xuong_doc.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2' }
const DON = 'T8-001'

const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P = 0, F = 0
const ok = (n, cc, e = '') => { console.log((cc ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cc ? P++ : F++ }
async function as(uid, q, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(q, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { r, e }
}

try {
  await c.query('begin'); await c.query(sql)
  const donId = (await c.query(`select id from kho.don_hang where ma_don=$1`, [DON])).rows[0].id

  // ── SEED (postgres, bypass RLS) ──
  // Prod hiện KHÔNG có tho ĐANG HOẠT ĐỘNG (cả 2 tho dang_hoat_dong=false) -> bật tạm 1 tho để test (rollback).
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=$1`, [U.tho])
  await c.query(`select set_config('chan.off_vai','1',false)`)
  await c.query(`update kho.don_hang set trang_thai='cho_cat' where ma_don=$1`, [DON])
  await c.query(`select set_config('chan.off_vai','',false)`)
  await c.query(`delete from kho.don_hang_mon where don_id=$1`, [donId])
  const monId = (await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong) values($1,'Tủ áo 2 cánh',2) returning id`, [donId])).rows[0].id
  // tem pb1 (2 tấm) trực tiếp
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,dai,rong,day,kien,duong_dan_svg) values
    ($1,1,$1||'|SKU|M1|hong|001','hong',2003,592,17.5,1,$1||'/1/x.svg'),
    ($1,1,$1||'|SKU|M1|canh_cua|002','canh_cua',892,430,17.5,1,$1||'/1/y.svg')`, [DON])
  await c.query(`insert into kho.lan_in_tem(ma_don,phien_ban,lan_thu,so_tem) values($1,1,1,2)`, [DON])

  console.log('── read-RPC: guard + tho đọc-được-qua-RPC ──')
  ok('sale gọi xuong_don_san_xuat → CHẶN', /chỉ ceo\/kho\/xuong\/tho/.test((await as(U.sale, `select * from kho.xuong_don_san_xuat()`)).e || ''))
  const donsTho = await as(U.tho, `select * from kho.xuong_don_san_xuat()`)
  ok('tho xuong_don_san_xuat → thấy đơn (dù KHÔNG đọc được bảng don_hang)', (donsTho.r || []).some(r => r.ma_don === DON), JSON.stringify(donsTho.e || (donsTho.r || []).length))
  ok('tho ĐỌC THẲNG bảng don_hang → 0 dòng (RLS chặn, chỉ RPC mới thấy)', ((await as(U.tho, `select 1 from kho.don_hang where ma_don=$1`, [DON])).r || []).length === 0)
  const donRow = (donsTho.r || []).find(r => r.ma_don === DON) || {}
  ok('xuong_don_san_xuat KHÔNG lộ field nhạy cảm (chỉ ma_don/trang_thai/so_mon/co_tem)',
    JSON.stringify(Object.keys(donRow).sort()) === JSON.stringify(['co_tem','ma_don','so_mon','trang_thai']), JSON.stringify(Object.keys(donRow)))
  ok('so_mon=1, co_tem=true', Number(donRow.so_mon) === 1 && donRow.co_tem === true)

  const monTho = await as(U.tho, `select * from kho.xuong_mon_cua_don($1)`, [DON])
  ok('tho xuong_mon_cua_don → 1 món', (monTho.r || []).length === 1, JSON.stringify(monTho.e))
  ok('món KHÔNG có cột gia (chỉ id/ten/so_luong/trang_thai)',
    JSON.stringify(Object.keys(monTho.r[0]).sort()) === JSON.stringify(['id','so_luong','ten','trang_thai']), JSON.stringify(Object.keys(monTho.r[0] || {})))

  const temTho = await as(U.tho, `select * from kho.xuong_tem_cua_don($1)`, [DON])
  ok('tho xuong_tem_cua_don → 2 tấm, phien_ban=1, lan_da_in=1', (temTho.r || []).length === 2 && Number(temTho.r[0].phien_ban) === 1 && Number(temTho.r[0].lan_da_in) === 1, JSON.stringify(temTho.e || temTho.r))

  console.log('\n── tien_mon (tho đẩy bước dù dhm RLS không cho ghi) ──')
  ok('sale gọi tien_mon → CHẶN', /chỉ ceo\/kho\/xuong\/tho/.test((await as(U.sale, `select kho.tien_mon($1,'dang_lam')`, [monId])).e || ''))
  ok('tien_mon trạng thái sai → CHẶN', /không hợp lệ/.test((await as(U.tho, `select kho.tien_mon($1,'da_giao')`, [monId])).e || ''))
  ok('tho ghi THẲNG món → CHẶN (dhm RLS không có tho)', /policy|permission|denied|row-level|violates/i.test((await as(U.tho, `update kho.don_hang_mon set trang_thai='dang_lam' where id=$1`, [monId])).e || '') || (await as(U.tho, `update kho.don_hang_mon set trang_thai='dang_lam' where id=$1`, [monId])).r?.length === 0)
  const tm = await as(U.tho, `select kho.tien_mon($1,'dang_lam') d`, [monId], true)
  ok('tho tien_mon(dang_lam) → OK (qua RPC)', (tm.r && tm.r[0] && tm.r[0].d && tm.r[0].d.ok) === true, JSON.stringify(tm.r || tm.e))
  ok('món ĐÃ = dang_lam', (await c.query(`select trang_thai from kho.don_hang_mon where id=$1`, [monId])).rows[0].trang_thai === 'dang_lam')
  ok('đơn ĐỒNG BỘ = dang_lam (dong_bo qua tien_mon)', (await c.query(`select trang_thai from kho.don_hang where id=$1`, [donId])).rows[0].trang_thai === 'dang_lam')

  console.log(`\n==================================\nKẾT QUẢ 039: ${P} pass / ${F} fail\n==================================`)
  await c.query('rollback')
} catch (e) {
  console.error('LỖI TEST:', e.message); F++
  try { await c.query('rollback') } catch (_) {}
} finally { await c.end(); process.exit(F ? 1 : 0) }
