// TEST CẮN — 107 · thư viện bản: nhãn + ẨN khách + cờ ẩn + gui_ban(+3) + dựng-lại + hiệu năng. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tk:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', NULLVAI:'00000000-0000-0000-0000-000000000000' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const q = async (s, a = []) => (await c.query(s, a)).rows
try {
  await c.query('begin')
  const TKNS = (await q(`select id from kho.nguoi_dung where auth_uid=$1`, [U.tk]))[0].id

  console.log('── 1 · GUARD ──')
  for (const v of ['sale','tk','ceo']) ok(`#1 ${v} xem thư viện ĐƯỢC`, (await asK(U[v], `select kho.thu_vien_ban(true)`)).e === null)
  for (const v of ['xuong','NULLVAI']) ok(`#1 ${v} → CHẶN`, (await asK(U[v], `select kho.thu_vien_ban(true)`)).e !== null)

  console.log('\n── 2 · gui_ban_thiet_ke lưu 2 nhãn tay + cờ ẩn ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo,phong_cach) values('T107','moi_len_don','le','KHÁCH BÍ MẬT',false,'Bắc Âu')`)
  const donId = (await q(`select id from kho.don_hang where ma_don='T107'`))[0].id
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong) values($1,'Tủ áo 3 cánh cửa lùa',1)`, [donId])
  const gb = await asK(U.tk, `select kho.gui_ban_thiet_ke('T107','bản 1',$1::jsonb,null,'Trắng sứ','Melamine An Cường',false) g`, [JSON.stringify([{ duong_dan_nho: 'a/nho.webp', duong_dan_to: 'a/to.webp', byte_nho: 100, byte_to: 200, thu_tu: 0 }])])
  ok('#2 gửi bản OK', gb.e === null, gb.e)
  const banId = gb.r[0].g.ban_id
  await q(`update kho.ban_thiet_ke set trang_thai='khach_duyet' where id=$1`, [banId])
  ok('#2 cột mau/vat_lieu lưu', (await q(`select mau_chu_dao,vat_lieu_chinh from kho.ban_thiet_ke where id=$1`, [banId]))[0].mau_chu_dao === 'Trắng sứ')

  console.log('\n── 3 · thư viện trả nhãn suy tự động + ẨN tên khách ──')
  const lib = await gK(U.sale, `select kho.thu_vien_ban(true) g`)
  const row = (lib.ds || []).find(x => x.ma_don === 'T107')
  ok('#3 bản T107 hiện (đã duyệt)', !!row, JSON.stringify(lib.tong))
  ok('#3 nhãn suy: tên món + màu + vật liệu + người dựng + phong cách', row && row.ten_mon === 'Tủ áo 3 cánh cửa lùa' && row.mau_chu_dao === 'Trắng sứ' && row.vat_lieu_chinh === 'Melamine An Cường' && row.nguoi_dung && row.phong_cach === 'Bắc Âu', JSON.stringify(row))
  ok('#3 ảnh đại diện có', row && row.anh === 'a/nho.webp')
  ok('#3 KHÔNG lộ "KHÁCH BÍ MẬT" trong TOÀN response (soi chuỗi)', !/KHÁCH BÍ MẬT/.test(JSON.stringify(lib)))

  console.log('\n── 4 · cờ an_thu_vien=true → biến mất cả hai cửa ──')
  await q(`update kho.ban_thiet_ke set an_thu_vien=true where id=$1`, [banId])
  ok('#4 sale KHÔNG thấy nữa', !((await gK(U.sale, `select kho.thu_vien_ban(true) g`)).ds || []).some(x => x.ma_don === 'T107'))
  ok('#4 thiết kế (mọi bản) cũng KHÔNG thấy', !((await gK(U.tk, `select kho.thu_vien_ban(false) g`)).ds || []).some(x => x.ma_don === 'T107'))
  await q(`update kho.ban_thiet_ke set an_thu_vien=false where id=$1`, [banId])

  console.log('\n── 5 · sale CHỈ bản đã duyệt; thiết kế thấy cả chưa duyệt ──')
  await q(`update kho.ban_thiet_ke set trang_thai='cho_duyet' where id=$1`, [banId])
  ok('#5 sale (chi_duyet) KHÔNG thấy bản cho_duyet', !((await gK(U.sale, `select kho.thu_vien_ban(true) g`)).ds || []).some(x => x.ma_don === 'T107'))
  ok('#5 thiết kế (chi_duyet=false) THẤY bản cho_duyet', ((await gK(U.tk, `select kho.thu_vien_ban(false) g`)).ds || []).some(x => x.ma_don === 'T107'))

  console.log('\n── 6 · ghi_dung_lai_ban → dung_lai_ban + nhật ký ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo) values('T107B','moi_len_don','le','K2',false)`)
  const don2 = (await q(`select id from kho.don_hang where ma_don='T107B'`))[0].id
  await q(`insert into kho.don_hang_mon(don_id,ten,so_luong) values($1,'Tủ áo mới',1)`, [don2])
  const monMoi = (await q(`select id from kho.don_hang_mon where don_id=$1`, [don2]))[0].id
  ok('#6 sale gọi ghi_dung_lai_ban → CHẶN', (await asK(U.sale, `select kho.ghi_dung_lai_ban($1::uuid,'T107B')`, [banId])).e !== null)
  const dl = await asK(U.tk, `select kho.ghi_dung_lai_ban($1::uuid,'T107B','đổi màu') g`, [banId])
  ok('#6 thiết kế ghi được', dl.e === null && dl.r[0].g.ok === true, dl.e)
  ok('#6 dung_lai_ban có dòng', (await q(`select count(*)::int n from kho.dung_lai_ban where mon_id_moi=$1`, [monMoi]))[0].n === 1)
  ok('#6 nhật ký có "Dựng lại từ bản"', /Dựng lại từ bản/.test((await q(`select ly_do from kho.don_hang_nhat_ky where don_id=$1 order by luc desc limit 1`, [don2]))[0]?.ly_do || ''))

  console.log('\n── 7 · HIỆU NĂNG 3.000 bản ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach,la_demo) select 'P107-'||g,'moi_len_don','le','K',false from generate_series(1,3000) g`)
  await q(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_gui) select 'P107-'||g,1,$1,'khach_duyet',now()-((g%30)||' days')::interval from generate_series(1,3000) g`, [TKNS])
  await c.query('analyze kho.ban_thiet_ke'); await c.query('analyze kho.don_hang')
  const t0 = Date.now(); const g7 = await gK(U.sale, `select kho.thu_vien_ban(true,null,null,null,null,null,null,null,'moi',40,0) g`); const ms = Date.now() - t0
  ok(`#7 thu_vien_ban 3.000+ bản = ${ms}ms (<500) · tổng=${g7.tong} ds=${g7.ds.length}(≤40)`, ms < 500 && g7.ds.length <= 40)

  await c.query('rollback')
  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_107: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++; try { await c.query('rollback') } catch (_) {} } finally { await c.end() }
process.exit(F === 0 ? 0 : 1)
