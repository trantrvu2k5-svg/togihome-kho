// TEST PHẢI CẮN — 123 · cổng trạng thái (WP-03/L-66). Tx rollback. Mỗi test cắn HAI vế.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!e) await c.query('release savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
try {
  await c.query('begin')
  // đơn le KHÔNG dung_moi (le_mau_san → day_tem bỏ qua cổng khách-duyệt), có người thiết kế cầm
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ten_khach,ma_ns_thiet_ke)
           values('WP3-T01','moi_len_don','le',9000000,0,0,'Khách WP3', $1)`, ['38c5252b-6e59-4651-8edb-d1c38afed0b6'])
  const oid = (await one(`select id from kho.don_hang where ma_don='WP3-T01'`)).id
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) values($1,'Tủ WP3',1,9000000,false)`, [oid])

  console.log('── (a) day_tem_ban_ve KHÔNG đổi trang_thai ──')
  const tt0 = (await one(`select trang_thai from kho.don_hang where ma_don='WP3-T01'`)).trang_thai
  const tam = JSON.stringify([{ ma_tam: 'WP3-T01#1', vai_tro: 'canh', dai: 1900, rong: 590, day: 18 }])
  const dt = await as(U.ceo, `select kho.day_tem_ban_ve('WP3-T01',$1::jsonb) g`, [tam])
  ok('#a day_tem_ban_ve chạy OK (vai ceo, le_mau_san)', dt.e === null, dt.e)
  const tt1 = (await one(`select trang_thai from kho.don_hang where ma_don='WP3-T01'`)).trang_thai
  const nTem = Number((await one(`select count(*) n from kho.tem_ban_ve where ma_don='WP3-T01'`)).n)
  ok('#a tem ĐƯỢC LƯU (>=1)', nTem >= 1, 'nTem=' + nTem)
  ok('#a trạng thái GIỮ NGUYÊN moi_len_don (KHÔNG bắc cầu cho_cat)', tt0 === 'moi_len_don' && tt1 === 'moi_len_don', `tt0=${tt0} tt1=${tt1}`)
  ok('#a vao_chuyen=false trong kết quả', dt.r?.[0]?.g?.vao_chuyen === false, JSON.stringify(dt.r?.[0]?.g))

  console.log('\n── (b) pt_ghi: thu_khi_giao chỉ sau khi giao ──')
  const p = (loai) => JSON.stringify({ ma_don: 'WP3-T01', so_tien: 9000000, loai })
  const g1 = await as(U.ceo, `select kho.pt_ghi($1::jsonb) g`, [p('thu_khi_giao')])
  ok('#b thu_khi_giao ở moi_len_don → RAISE (gợi ý coc)', g1.e !== null && /thu-khi-giao|cho_giao|coc/i.test(g1.e), g1.e)
  const g2 = await as(U.ceo, `select kho.pt_ghi($1::jsonb) g`, [p('coc')])
  ok('#b coc ở moi_len_don → OK', g2.e === null, g2.e)
  // FIXTURE: đặt trang_thai tùy ý (tắt trigger máy trạng thái trong tx rollback) để cắn pt_ghi theo trạng thái
  await q(`alter table kho.don_hang disable trigger user`)
  await q(`update kho.don_hang set trang_thai='da_giao' where ma_don='WP3-T01'`)
  const g3 = await as(U.ceo, `select kho.pt_ghi($1::jsonb) g`, [p('thu_khi_giao')])
  ok('#b thu_khi_giao ở da_giao → OK', g3.e === null, g3.e)
  await q(`update kho.don_hang set trang_thai='cho_cat' where ma_don='WP3-T01'`)
  const g4 = await as(U.ceo, `select kho.pt_ghi($1::jsonb) g`, [p('thu_khi_giao')])
  ok('#b thu_khi_giao ở cho_cat → RAISE', g4.e !== null && /thu-khi-giao|cho_giao/i.test(g4.e), g4.e)
  await q(`alter table kho.don_hang enable trigger user`)

  console.log('\n── (c) ban_giao_xuong VẪN là cổng cho_cat; day_tem KHÔNG còn cho_cat ──')
  const defBG = (await one(`select pg_get_functiondef('kho.ban_giao_xuong(text,jsonb,text)'::regprocedure) d`)).d
  ok('#c ban_giao_xuong còn set cho_cat (cổng duy nhất giữ nguyên)', /trang_thai\s*=\s*'cho_cat'/.test(defBG))
  const defDT = (await one(`select pg_get_functiondef('kho.day_tem_ban_ve(text,jsonb)'::regprocedure) d`)).d
  ok('#c day_tem_ban_ve KHÔNG còn set cho_cat', !/trang_thai\s*=\s*'cho_cat'/.test(defDT))

  console.log('\n── (d) db/124: cho_giao→da_giao theo vai (giao_thu) ──')
  // current_vai_tro() map theo AUTH_UID (không phải nguoi_dung.id) → phải truyền auth_uid, nếu không RLS lọc sạch (no-op giả).
  const uidVai = async (vt) => (await one(`select auth_uid from kho.nguoi_dung where vai_tro=$1 and dang_hoat_dong and auth_uid is not null limit 1`, [vt]))?.auth_uid
  const uSale = await uidVai('sale'), uTk = await uidVai('thiet_ke')
  async function fromChoGiao(uid) {   // reset về cho_giao (tắt trigger) + set dữ liệu giao, rồi thử da_giao theo vai
    await q(`alter table kho.don_hang disable trigger user`)
    await q(`update kho.don_hang set trang_thai='cho_giao', sdt_khach='0900WP3', ngay_giao=current_date where ma_don='WP3-T01'`)
    await q(`alter table kho.don_hang enable trigger user`)
    return as(uid, `update kho.don_hang set trang_thai='da_giao' where ma_don='WP3-T01'`)
  }
  const rSale = await fromChoGiao(uSale)
  ok('#d sale (giao_thu) cho_giao→da_giao → OK', rSale.e === null, rSale.e)
  const rTk = await fromChoGiao(uTk)
  ok('#d thiet_ke (không giao hàng) cho_giao→da_giao → CHẶN', rTk.e !== null && /không được chuyển/i.test(rTk.e), rTk.e)
  const rCeo = await fromChoGiao(U.ceo)
  ok('#d ceo cho_giao→da_giao → OK', rCeo.e === null, rCeo.e)
  await q(`alter table kho.don_hang enable trigger user`).catch(() => {})

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_123: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); process.exit(F === 0 ? 0 : 1) }
