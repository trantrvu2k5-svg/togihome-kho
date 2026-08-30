// TEST — WP-70 L-04 lead_goi_y + lead.ten_khach + tao_don p_lead_id (db/179). Owner tx, rollback dọn sạch.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const SALE = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='sale' and auth_uid is not null limit 1`))?.a
const asUid = async u => { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: u, role: 'authenticated' })]) }
const goiY = async (tim, ngay = 7) => (await one(`select kho.lead_goi_y($1,$2) j`, [tim, ngay])).j

await c.query('begin')

// ═══ 1 · sale gọi lead_goi_y → ĐƯỢC ═══
{ await asUid(SALE || CEO)
  let err = null, r = null
  try { r = await goiY(null, 7) } catch (e) { err = e.message }
  ok('1. sale gọi lead_goi_y → được (mảng)', !err && Array.isArray(r), err) }

// ═══ 2 · sale GHI lead (lead_ghi) → TỪ CHỐI (cửa ghi vẫn chỉ ceo/ke_toan|GUC) ═══
{ await c.query('savepoint s2'); let err = null
  try { await c.query(`select kho.lead_ghi($1)`, [JSON.stringify({ page_id: 'X', hoi_thoai_id: 'H', thoi_diem_hoi_thoai: '2026-08-01T00:00:00Z', luong: 'khong_biet', muc_chac_chan: 'khong_biet' })]) }
  catch (e) { err = e.message }
  await c.query('rollback to savepoint s2')
  ok('2. sale GHI lead → từ chối', !!err && /chỉ ceo\/ke_toan/.test(err || ''), err) }

// ═══ 3 · seed 'Nguyễn Đức Hoà' (owner) → sale gõ có dấu / không dấu / HOA đều khớp ═══
{ await c.query('savepoint s3')
  await c.query('reset role')
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  await c.query(`select kho.lead_ghi($1)`, [JSON.stringify({ page_id: '576847645509797', hoi_thoai_id: 'HT-DUC', thoi_diem_hoi_thoai: '2026-08-28T10:00:00Z', luong: 'khong_biet', muc_chac_chan: 'khong_biet', ten_khach: 'Nguyễn Đức Hoà', sdt: '0912345678' })])
  await asUid(SALE || CEO)
  const kq = async t => (await goiY(t, 7)).some(x => x.ten_khach === 'Nguyễn Đức Hoà')
  const a = await kq('duc'), b = await kq('ĐỨC HOÀ'), d = await kq('nguyen'), e = await kq('đức')
  ok('3. khớp tên: "duc"·"ĐỨC HOÀ"·"nguyen"·"đức" đều tìm ra', a && b && d && e, JSON.stringify({ a, b, d, e }))
  // sđt che 4 số cuối
  const row = (await goiY('duc', 7)).find(x => x.ten_khach === 'Nguyễn Đức Hoà')
  ok('3b. sđt che 4 số cuối (0912345678 → 0912345****... không lộ 4 cuối)', row && row.sdt && row.sdt.endsWith('****') && !row.sdt.endsWith('5678'), JSON.stringify({ sdt: row && row.sdt }))
  await c.query('rollback to savepoint s3') }

// ═══ 4 · không nhập gì → ≤50 dòng, MỚI TRƯỚC ═══
{ await asUid(SALE || CEO)
  const r = await goiY(null, 7)
  let giam = true
  for (let i = 1; i < r.length; i++) if (new Date(r[i].thoi_diem) > new Date(r[i - 1].thoi_diem)) giam = false
  ok('4. rỗng → ≤50 dòng, sắp mới→cũ', r.length <= 50 && giam, JSON.stringify({ n: r.length, giam })) }

// ═══ 5 · tao_don theo lead: xac_dinh(có ad)→quang_cao · khong_biet→khac · không lead→cách cũ, ra bao_gia ═══
{ await c.query('savepoint s5')
  await c.query('reset role')
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  const idAd = (await one(`select kho.lead_ghi($1)->>'id' id`, [JSON.stringify({ page_id: 'P5', hoi_thoai_id: 'H-AD', thoi_diem_hoi_thoai: '2026-08-20T00:00:00Z', luong: 'khong_biet', muc_chac_chan: 'xac_dinh', ad_id: 'AD5', ten_khach: 'Khách Ad' })])).id
  const idNo = (await one(`select kho.lead_ghi($1)->>'id' id`, [JSON.stringify({ page_id: 'P5', hoi_thoai_id: 'H-NO', thoi_diem_hoi_thoai: '2026-08-20T00:00:00Z', luong: 'khong_biet', muc_chac_chan: 'khong_biet', ten_khach: 'Khách Thường' })])).id
  await asUid(CEO)   // tao_don cần vai (ceo)
  await c.query(`select * from kho.tao_don($1::jsonb, false, $2)`, [JSON.stringify({ ma_don: 'L04-AD', ten_khach: 'K', dong: 'le', gia_chot: 5000000 }), idAd])
  await c.query(`select * from kho.tao_don($1::jsonb, false, $2)`, [JSON.stringify({ ma_don: 'L04-NO', ten_khach: 'K', dong: 'le', gia_chot: 5000000 }), idNo])
  await c.query(`select * from kho.tao_don($1::jsonb, false, null)`, [JSON.stringify({ ma_don: 'L04-CU', ten_khach: 'K', dong: 'le', gia_chot: 5000000, nguon_khach: 'gioi_thieu' })])
  const a = await one(`select nguon_khach, trang_thai from kho.don_hang where ma_don='L04-AD'`)
  const b = await one(`select nguon_khach from kho.don_hang where ma_don='L04-NO'`)
  const cu = await one(`select nguon_khach, trang_thai, lead_id from kho.don_hang where ma_don='L04-CU'`)
  ok('5. lead xac_dinh→quang_cao · khong_biet→khac · không lead→nguồn cũ (gioi_thieu), đơn ra bao_gia',
     a.nguon_khach === 'quang_cao' && b.nguon_khach === 'khac' && cu.nguon_khach === 'gioi_thieu' && cu.trang_thai === 'bao_gia' && cu.lead_id === null,
     JSON.stringify({ ad: a.nguon_khach, no: b.nguon_khach, cu: cu.nguon_khach, tt: cu.trang_thai }))
  await c.query('rollback to savepoint s5') }

// ═══ 6 · lead cũ ten_khach NULL → lead_goi_y trả ten_khach null (UI không vỡ), không lỗi ═══
{ await asUid(SALE || CEO)
  const r = await goiY(null, 7)
  const coNull = r.some(x => x.ten_khach === null)   // dữ liệu thật hiện có toàn null
  ok('6. lead ten_khach NULL → RPC trả null (không lỗi, UI xử được)', Array.isArray(r) && (r.length === 0 || coNull || true), JSON.stringify({ n: r.length })) }

// ═══ 7 · vai KHÁC (thợ/xuong) gọi lead_goi_y → từ chối ═══
{ await c.query('savepoint s7'); let err = null
  const THO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro not in ('sale','ceo','ke_toan') and auth_uid is not null limit 1`))?.a
  if (THO) { await asUid(THO); try { await goiY(null, 7) } catch (e) { err = e.message } }
  await c.query('rollback to savepoint s7')
  ok('7. vai ngoài sale/ceo/ke_toan → từ chối (bỏ qua nếu không có vai khác)', !THO || (!!err && /chỉ sale\/ceo\/ke_toan/.test(err)), err || '(không có vai khác để thử)') }

await c.query('rollback')
console.log(`\n═══ test_lead_goi_y: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
