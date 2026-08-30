// TEST — WP-70 L-08 RPC cac_theo_luong_loai (db/182). Owner tx, rollback dọn sạch (không đụng dữ liệu thật).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const asVai = async (vai, uid) => { await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })]) }
const call = async (ky) => (await one(`select kho.cac_theo_luong_loai($1) j`, [ky])).j

await c.query('begin')

// ═══ 1 · vai sale → TỪ CHỐI ═══
{ await c.query('savepoint s1'); let err = null
  try { await asVai('sale', CEO)
        const SALE = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='sale' and auth_uid is not null limit 1`)).a
        await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: SALE, role: 'authenticated' })])
        await call('2026-08') }
  catch (e) { err = e.message }
  await c.query('rollback to savepoint s1')
  ok('1. vai sale gọi RPC → từ chối', !!err && /chỉ ceo\/ke_toan/.test(err || ''), err) }

await asVai('ceo', CEO)

// ═══ 2 · ceo → được · Σ4 mức = cohort_tong ═══
const j8 = await call('2026-08')
{ const cl = j8.chat_luong; const sum4 = cl.xac_dinh + cl.suy_ref + cl.doi_chieu_lo + cl.khong_biet
  ok('2. ceo gọi được · Σ4 mức = cohort_tong = chat_luong.tong', j8.cohort_tong === sum4 && cl.tong === sum4, JSON.stringify({ cohort: j8.cohort_tong, sum4, tong: cl.tong })) }

// ═══ 3 · dòng "chưa gán" LUÔN đầu bảng LOẠI ═══
{ const lo = j8.loai || []
  ok('3. loai[0] là "chưa gán" (chua_gan=true) khi có lead', lo.length === 0 || lo[0].chua_gan === true, JSON.stringify(lo.map(x => x.chua_gan))) }

// ═══ 4 · luồng đủ 3 dòng cố định ═══
{ const lu = (j8.luong || []).map(x => x.luong)
  ok('4. luồng đủ 3 dòng qua_web·mess_truc_tiep·khong_biet', lu.length === 3 && lu.includes('qua_web') && lu.includes('mess_truc_tiep') && lu.includes('khong_biet'), JSON.stringify(lu)) }

// ═══ 5 · chi_ads kỳ = 0 → luồng chi/CAC NULL; bảng LOẠI chi/CAC LUÔN NULL (kể cả khi có chi) ═══
{ const luNull = (j8.luong || []).every(r => r.chi_ads === null && r.cac === null)
  const loNull = (j8.loai || []).every(r => r.chi_ads === null && r.cac === null)
  ok('5. chi_ads kỳ NULL → luồng & loại chi/cac = NULL (không phải 0)', j8.chi_ads_that_ky === null && luNull && loNull, JSON.stringify({ chi: j8.chi_ads_that_ky })) }

// ═══ 6 · chi ads phân bổ theo xac_dinh Ở BẢNG LUỒNG (không ăn mức suy); bảng LOẠI thì LUÔN NULL (cần WP-78) ═══
{ await c.query('savepoint s6')
  await c.query('reset role')
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  const mk = (id, muc, ad) => ({ nguon: 'pancake', page_id: 'TESTP', hoi_thoai_id: id, thoi_diem_hoi_thoai: '2099-09-05T00:00:00Z', luong: 'khong_biet', muc_chac_chan: muc, ad_id: ad, loai: 'inbox' })
  await c.query(`select kho.lead_ghi($1)`, [JSON.stringify(mk('T-XD', 'xac_dinh', 'ADX'))])
  await c.query(`select kho.lead_ghi($1)`, [JSON.stringify(mk('T-SR', 'suy_ref', null))])
  const brand = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
  await c.query(`insert into kho.tham_so_tai_chinh(ma_ky, vat) values('2099-09', 10) on conflict (ma_ky) do update set vat=10`)
  await c.query(`insert into kho.chi_ads(ma_ky, thuong_hieu, kenh, so_tien_nhap) values('2099-09',$1,'quang_cao', 11000000)`, [brand])
  await asVai('ceo', CEO)
  const j99 = await call('2099-09')
  const luKB = (j99.luong || []).find(r => r.luong === 'khong_biet')   // 2 lead đều luong=khong_biet; chi chia cho 1 xac_dinh
  const loNull = (j99.loai || []).every(r => r.chi_ads === null && r.cac === null)
  // chi TỔNG = 11tr/1.1 = 10tr; luồng khong_biet có 1 xac_dinh / 1 tổng xac_dinh → chi=10tr (KHÔNG ×2 gồm suy)
  ok('6. LUỒNG: chi chia theo xac_dinh =10tr (không ăn suy) · LOẠI: chi/cac NULL luôn',
     Math.round(j99.chi_ads_that_ky) === 10000000 && luKB && Math.round(luKB.chi_ads) === 10000000 && loNull,
     JSON.stringify({ chiTong: j99.chi_ads_that_ky, luKB: luKB && luKB.chi_ads, loNull }))
  await c.query('rollback to savepoint s6') }

// ═══ 7 · kỳ KHÔNG có lead → rỗng CÓ CẤU TRÚC: cohort 0, luồng 3 dòng 0, loai [] ═══
{ const j0 = await call('2000-01')
  const luZero = (j0.luong || []).length === 3 && (j0.luong || []).every(r => r.hoi_thoai === 0)
  ok('7. kỳ rỗng → cohort 0 · luồng 3 dòng 0 · loai rỗng · không lỗi', j0.cohort_tong === 0 && luZero && (j0.loai || []).length === 0, JSON.stringify({ cohort: j0.cohort_tong, loai: (j0.loai || []).length })) }

// ═══ 8 · p_ky sai định dạng → lỗi rõ ═══
{ await c.query('savepoint s8'); let err = null
  try { await call('2026/08') } catch (e) { err = e.message }
  await c.query('rollback to savepoint s8')
  ok('8. p_ky sai định dạng → raise', !!err && /YYYY-MM/.test(err || ''), err) }

// ═══ 9 · [L-08 VIỆC 3] SUY LOẠI cho lead đã chốt đơn — đơn 2 món khác loại → lấy loại món ĐẮT NHẤT ═══
{ await c.query('savepoint s9')
  await c.query('reset role')
  await c.query("select set_config('request.jwt.claims','',true)")   // xoá jwt sót → current_vai_tro NULL → insert don_hang bỏ qua gác nguồn khách
  await c.query("select set_config('kho.lead_he_thong','1',true)")
  // lead có kỳ 2099-10
  const leadId = (await one(`select kho.lead_ghi($1)->>'id' id`, [JSON.stringify({ nguon: 'pancake', page_id: 'TP9', hoi_thoai_id: 'H9', thoi_diem_hoi_thoai: '2099-10-05T00:00:00Z', luong: 'khong_biet', muc_chac_chan: 'khong_biet', loai: 'inbox' })])).id
  // đơn chốt (moi_len_don, không bao_gia) gắn lead — insert OWNER (trigger gác bỏ qua vì current_vai_tro null)
  const donId = (await one(`insert into kho.don_hang(ma_don, ten_khach, dong, trang_thai, lead_id, ngay_chot) values('T9-LOAI','K','le','moi_len_don',$1,'2099-10-10') returning id`, [leadId])).id
  // 2 món: TA (rẻ 5tr → tu) + BA (đắt 10tr → ban_an) → suy = ban_an (món đắt nhất)
  await c.query(`insert into kho.don_hang_mon(don_id, sp_id, ten, gia, so_luong) values($1,'CAN-A-TUAO-MASTER-BT','Tủ',5000000,1)`, [donId])
  await c.query(`insert into kho.don_hang_mon(don_id, sp_id, ten, gia, so_luong) values($1,'BA-001-01','Bàn ăn',10000000,1)`, [donId])
  await asVai('ceo', CEO)
  const j = await call('2099-10')
  const loaiRows = (j.loai || []).filter(r => !r.chua_gan)
  ok('9. đơn 2 món (Tủ 5tr + Bàn ăn 10tr) → suy loại = "Bàn ăn & Ghế ăn" (món đắt nhất), KHÔNG "chưa gán"',
     loaiRows.length === 1 && loaiRows[0].loai_ma === 'ban_an' && loaiRows[0].ten === 'Bàn ăn & Ghế ăn',
     JSON.stringify((j.loai || []).map(r => ({ ma: r.loai_ma, ten: r.ten, ht: r.hoi_thoai }))))
  await c.query('rollback to savepoint s9') }

// ═══ 10 · lead CHƯA chốt đơn → "chưa gán" (loai_ma NULL) ═══
{ const j = await call('2026-08')   // kỳ 08: 921 lead, 0 đơn chốt → toàn "chưa gán"
  const only = (j.loai || [])
  ok('10. lead chưa chốt → chỉ dòng "chưa gán" (không suy được loại)', only.length === 1 && only[0].chua_gan === true, JSON.stringify(only.map(r => r.loai_ma))) }

await c.query('rollback')
console.log(`\n═══ test_cac_luong: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
