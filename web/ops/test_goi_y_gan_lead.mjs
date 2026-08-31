// TEST — WP-78 L-04 · lead_goi_y_theo_sdt + don_gan_lead. Lead THẬT; order tạm nội bộ; tx→rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
// chạy 1 câu dưới danh nghĩa 1 auth_uid
async function asU(U, sql, args = []) {
  await c.query('savepoint sp')
  try {
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    const r = await c.query(sql, args); await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`)
    return { ok: true, rows: r.rows }
  } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}

const L1 = '23001f84-f0f6-469e-b621-a703d013e689'  // HĐ Bàn Đảo Sophia · sdt 0988224999 · ad null
const L2 = '37c4a176-2cc5-404c-b150-1fab07f531b5'  // Phan Dũng · sdt 0988224999 · ad null
const LAMHA = '4df29f4e-dcdf-44b9-98f6-b0d69a067303' // sdt 0984398276 · ad có

await c.query('begin')
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const SALE = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='sale' and auth_uid is not null limit 1`)).a
const ADS = (await one(`insert into kho.nguoi_dung(auth_uid,ho_ten,vai_tro,dang_hoat_dong) values(gen_random_uuid(),'TEST ADS','ads_user',true) returning auth_uid`)).a
// order tạm: sdt_khach khớp 0988224999
const O = (await one(`insert into kho.don_hang(id,ma_don,sdt_khach,trang_thai,nguoi_tao) values(gen_random_uuid(),'TEST-GANLEAD','0988224999','cho_cat',kho.current_ns()) returning id`)).id

// ── DƯƠNG ──
const g1 = await asU(CEO, `select * from kho.lead_goi_y_theo_sdt($1)`, ['0988224999'])
ok('D1. trùng nhiều → 2 dòng, mới nhất trước', g1.ok && g1.rows.length === 2 && g1.rows[0].lead_id === L1, JSON.stringify(g1.rows?.map(r => r.ten_khach)))
const g2 = await asU(CEO, `select * from kho.lead_goi_y_theo_sdt($1)`, ['0984398276'])
ok('D2. trùng 1 (Lam Ha) → 1 dòng, ad có', g2.ok && g2.rows.length === 1 && g2.rows[0].ad_id !== null, JSON.stringify(g2.rows?.length))
const gv = []
for (const s of ['+84988224999', '098 822 4999', '0988.224.999']) { const r = await asU(CEO, `select lead_id from kho.lead_goi_y_theo_sdt($1)`, [s]); gv.push(r.ok && r.rows.length === 2) }
ok('D3. +84 / khoảng trắng / dấu chấm → cùng 2 dòng', gv.every(Boolean), JSON.stringify(gv))
// gắn lần đầu
const a1 = await asU(CEO, `select kho.don_gan_lead($1,$2,$3) j`, [O, L1, null])
const ord1 = await one(`select lead_id, nguon_khach from kho.don_hang where id=$1`, [O])
const nk1 = (await one(`select count(*)::int n from kho.don_hang_lead_nhat_ky where don_id=$1`, [O])).n
ok('D4. gắn lần đầu → order.lead_id set · nguon_khach (L1 ad null → không đổi) · nhat_ky 1 dòng',
  a1.ok && a1.rows[0].j.ket === 'gan_moi' && ord1.lead_id === L1 && nk1 === 1, JSON.stringify({ a1: a1.ok ? a1.rows[0].j : a1.err, ord1, nk1 }))
// đổi lead
const a2 = await asU(CEO, `select kho.don_gan_lead($1,$2,$3) j`, [O, L2, 'khách xác nhận đúng người này'])
const ord2 = await one(`select lead_id from kho.don_hang where id=$1`, [O])
const nk2 = await c.query(`select tu, den from kho.don_hang_lead_nhat_ky where don_id=$1`, [O])
const coGanDau = nk2.rows.some(r => r.tu === null && r.den === L1)
const coDoi = nk2.rows.some(r => r.tu === L1 && r.den === L2)
ok('D5. đổi lead → 2 dòng vết: (NULL→L1) gắn đầu + (L1→L2) đổi', a2.ok && a2.rows[0].j.ket === 'doi' && ord2.lead_id === L2 && nk2.rows.length === 2 && coGanDau && coDoi,
  JSON.stringify({ ket: a2.ok ? a2.rows[0].j.ket : a2.err, nk: nk2.rows.length, coGanDau, coDoi }))

// ── ÂM ──
const b1 = await asU(CEO, `select kho.don_gan_lead($1,$2,$3) j`, [O, LAMHA, 'thử'])
ok('ÂM1. gắn lead SĐT lệch (Lam Ha 0984… vs đơn 0988…) → TỪ CHỐI', !b1.ok && /không khớp/i.test(b1.err), b1.ok ? '(gắn được — LỖI)' : b1.err)
const b2 = await asU(CEO, `select kho.don_gan_lead($1,$2,$3) j`, [O, L1, ''])   // hiện là L2, đổi sang L1 KHÔNG lý do
ok('ÂM2. đổi lead THIẾU lý do → TỪ CHỐI', !b2.ok && /bắt buộc có lý do/i.test(b2.err), b2.ok ? '(đổi được — LỖI)' : b2.err)
// UPDATE thẳng (owner, không qua RPC) → trigger chặn
await c.query('savepoint sp3'); let e3 = null
try { await c.query(`update kho.don_hang set lead_id=$1 where id=$2`, [L1, O]) } catch (e) { e3 = e.message }
await c.query('rollback to savepoint sp3')
ok('ÂM3. UPDATE thẳng don_hang.lead_id (không qua RPC) → TỪ CHỐI (trigger)', !!e3 && /chỉ đổi qua RPC/i.test(e3), e3 || '(update được — LỖI)')
// sdt_hong không xuất hiện: 0 lead hỏng tồn tại + RPC chỉ trả sdt hợp lệ
const hong = (await one(`select count(*)::int n from kho.v_lead_hien_hanh where sdt is not null and sdt<>'' and sdt !~ '^[0-9]{9,11}$'`)).n
const g3 = await asU(CEO, `select sdt is not null hop from kho.lead_goi_y_theo_sdt($1) x join kho.v_lead_hien_hanh v on v.id=x.lead_id`, ['0988224999'])
ok(`ÂM4. lead sdt_hong không xuất hiện (0 lead hỏng tồn tại · RPC chỉ trả sdt hợp lệ)`, hong === 0, `hong=${hong}`)
// ads_user gọi lead_goi_y → từ chối
const b5 = await asU(ADS, `select * from kho.lead_goi_y_theo_sdt($1)`, ['0988224999'])
ok('ÂM5. ads_user → lead_goi_y_theo_sdt TỪ CHỐI', !b5.ok && /chỉ sale\/ceo/i.test(b5.err), b5.ok ? '(gọi được — LỖI)' : b5.err)

// mẫu gợi ý thật (in trước rollback)
const mLamHa = (await asU(CEO, `select ten_khach,kenh,ad_id,muc_chac_chan,to_char(khach_nhan_dau at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI') nd,to_char(cham_cuoi at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI') cc from kho.lead_goi_y_theo_sdt($1)`, ['0984398276'])).rows
const m0988 = (await asU(CEO, `select ten_khach,kenh,ad_id,to_char(khach_nhan_dau at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI') nd from kho.lead_goi_y_theo_sdt($1)`, ['0988224999'])).rows

await c.query('rollback')
console.log('\n── 2 mẫu gợi ý THẬT ──')
console.log('  0984398276 →', JSON.stringify(mLamHa))
console.log('  0988224999 →', JSON.stringify(m0988))
console.log(`\n═══ test_goi_y_gan_lead: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
