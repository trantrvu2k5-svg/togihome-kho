// TEST PHẢI CẮN — 038 app xưởng: tiến độ theo món · tem (đẩy/in/★cắt-lại) · phiếu đếm · đơn giá hoạt động.
//   Áp 038 trong tx rồi ROLLBACK (KHÔNG đụng prod). Kết nối qua ops/conn.mjs (DB_HOST/DB_PASS env).
//   Chạy: DB_HOST=… DB_USER=… DB_PASS=… node ops/test_038.mjs
//   ★ CA QUAN TRỌNG NHẤT: plugin đẩy tem LẦN HAI (bản vẽ sửa) -> phien_ban=2, lan_thu về 1, KHÔNG tính cắt lại.
import { readFileSync } from 'fs'
import pg from 'pg'
import { docConfig } from './conn.mjs'

const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/038_app_xuong.sql', import.meta.url), 'utf8'))

// auth_uid theo vai (không bí mật). current_vai_tro(): nguoi_dung.auth_uid = jwt.sub.
const U = {
  ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  kho:'66272566-1897-4c57-aa3f-98a81636302a', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
}
const DON = 'T8-001'   // đơn có sẵn (rollback nên không hại)

const c = new pg.Client({ ...(await docConfig()) })
await c.connect()
let P = 0, F = 0
const ok = (n, cc, e = '') => { console.log((cc ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cc ? P++ : F++ }

// rollback-savepoint helper (giữ tx sạch dù RAISE). keep=true để dữ liệu ở lại cho bước sau.
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
const val = r => (r.r && r.r[0]) ? Object.values(r.r[0])[0] : null

try {
  await c.query('begin'); await c.query(sql)
  const donId = (await c.query(`select id from kho.don_hang where ma_don=$1`, [DON])).rows[0].id
  const YM = (await c.query(`select to_char(current_date,'YYYY-MM') ym`)).rows[0].ym

  // ═══════ A. TIẾN ĐỘ THEO MÓN ═══════
  console.log('\n── A. Tiến độ theo món ──')
  // đưa đơn vào dây SX (bỏ chốt vai để setup) rồi thả chốt lại
  await c.query(`select set_config('chan.off_vai','1',false)`)
  await c.query(`update kho.don_hang set trang_thai='cho_cat' where ma_don=$1`, [DON])
  await c.query(`select set_config('chan.off_vai','',false)`)
  // Cô lập: xoá món cũ của đơn (ALTER đã set MỌI món cũ = cho_cat) rồi chèn ĐÚNG 2 món -> kiểm "chậm nhất" sạch.
  await c.query(`delete from kho.don_hang_mon where don_id=$1`, [donId])
  const mons = (await c.query(`insert into kho.don_hang_mon(don_id) values($1),($1) returning id`, [donId])).rows.map(r => r.id)
  ok('món default trang_thai = cho_cat', (await c.query(`select bool_and(trang_thai='cho_cat') b from kho.don_hang_mon where don_id=$1`, [donId])).rows[0].b === true)
  ok('đơn suy từ món = cho_cat (mọi món cho_cat)', (await c.query(`select trang_thai from kho.don_hang where id=$1`, [donId])).rows[0].trang_thai === 'cho_cat')
  // món1 -> da_cat ; món2 -> xong_sx  => đơn = bước CHẬM NHẤT = da_cat
  await c.query(`update kho.don_hang_mon set trang_thai='da_cat' where id=$1`, [mons[0]])
  await c.query(`update kho.don_hang_mon set trang_thai='xong_sx' where id=$1`, [mons[1]])
  ok('trang_thai_don_tu_mon = da_cat (chậm nhất, KHÔNG lấy xong_sx)', val(await as(U.ceo, `select kho.trang_thai_don_tu_mon($1)`, [donId])) === 'da_cat')
  ok('đơn ĐỒNG BỘ = da_cat (trigger từ món)', (await c.query(`select trang_thai from kho.don_hang where id=$1`, [donId])).rows[0].trang_thai === 'da_cat')

  console.log('\n── A. Chốt chuyển trạng thái THEO VAI (item 3 vá lỗ) ──')
  ok('★ sale đặt đơn -> da_giao → CHẶN', /không được chuyển|sang trạng thái/.test((await as(U.sale, `update kho.don_hang set trang_thai='da_giao' where id=$1`, [donId])).e || ''))
  ok('thiet_ke -> dang_lam (SX) → CHẶN', /không được chuyển/.test((await as(U.thiet_ke, `update kho.don_hang set trang_thai='dang_lam' where id=$1`, [donId])).e || ''))
  ok('xuong -> dang_lam (SX) → ĐƯỢC', (await as(U.xuong, `update kho.don_hang set trang_thai='dang_lam' where id=$1`, [donId])).e === null)
  ok('thiet_ke -> xong_file (thiết kế) → ĐƯỢC', (await as(U.thiet_ke, `update kho.don_hang set trang_thai='xong_file' where id=$1`, [donId])).e === null)
  // [CẮN] bỏ chốt vai (off_vai=1) -> sale đặt da_giao LỌT (ĐỎ)
  await c.query(`select set_config('chan.off_vai','1',false)`)
  ok('[CẮN] bỏ chốt vai → sale đặt da_giao LỌT (ĐỎ)', (await as(U.sale, `update kho.don_hang set trang_thai='da_giao' where id=$1`, [donId])).e === null)
  await c.query(`select set_config('chan.off_vai','',false)`)

  // ═══════ B. TEM: đẩy · in · ★ cắt lại ═══════
  console.log('\n── B. Tem — đẩy bản vẽ ──')
  const tamJson = JSON.stringify([
    { ma_tam: `${DON}|SKU#1|M1|hong|001`, vai_tro: 'hong', dai: 2003, rong: 592, day: 17.5, kien: 1, canh_dan: [{ vi_tri: 'truoc', dai: 2003 }] },
    { ma_tam: `${DON}|SKU#1|M1|canh_cua|002`, vai_tro: 'canh_cua', dai: 892, rong: 430, day: 17.5, kien: 1, canh_dan: [{ vi_tri: 'truoc', dai: 892 }, { vi_tri: 'tren', dai: 430 }] },
    { ma_tam: `${DON}|SKU#1|M1|day_hop|003`, vai_tro: 'day_hop', dai: 420, rong: 180, day: 17.5, kien: 2, canh_dan: [] },
  ])
  ok('sale đẩy tem → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await as(U.sale, `select kho.day_tem_ban_ve($1,$2::jsonb)`, [DON, tamJson])).e || ''))
  const pb1 = await as(U.thiet_ke, `select kho.day_tem_ban_ve($1,$2::jsonb) d`, [DON, tamJson], true)
  ok('thiet_ke đẩy tem lần 1 → phien_ban=1', (val(pb1) || {}).phien_ban === 1, JSON.stringify(pb1.r || pb1.e))
  // duong_dan_svg server tính deterministic (| và # -> _)
  const svgPath = (await c.query(`select duong_dan_svg from kho.tem_ban_ve where ma_don=$1 and phien_ban=1 and vai_tro='hong'`, [DON])).rows[0].duong_dan_svg
  ok('duong_dan_svg server tính (sanitize |# → _)', svgPath === `${DON}/1/${DON}_SKU_1_M1_hong_001.svg`, svgPath)
  const pb2 = await as(U.thiet_ke, `select kho.day_tem_ban_ve($1,$2::jsonb) d`, [DON, tamJson], true)
  ok('thiet_ke đẩy tem lần 2 (bản vẽ sửa) → phien_ban=2', (val(pb2) || {}).phien_ban === 2, JSON.stringify(pb2.r || pb2.e))

  console.log('\n── B. In tem — lượt in · ★ CẮT LẠI ──')
  const t1 = `${DON}|SKU#1|M1|hong|001`, t2 = `${DON}|SKU#1|M1|canh_cua|002`, t3 = `${DON}|SKU#1|M1|day_hop|003`
  ok('sale in tem → CHẶN', /chỉ ceo\/kho\/xuong\/tho/.test((await as(U.sale, `select kho.ghi_lan_in_tem($1,1,$2)`, [DON, [t1]])).e || ''))
  const in1 = await as(U.xuong, `select kho.ghi_lan_in_tem($1,1,$2) d`, [DON, [t1, t2]], true)
  ok('xuong in pb1 lượt 1 → lan_thu=1, cat_lai=false', (val(in1) || {}).lan_thu === 1 && (val(in1) || {}).cat_lai === false, JSON.stringify(in1.r || in1.e))
  const in2 = await as(U.xuong, `select kho.ghi_lan_in_tem($1,1,$2) d`, [DON, [t1]], true)
  ok('xuong in pb1 lượt 2 (cùng pb) → lan_thu=2, cat_lai=TRUE (CẮT LẠI)', (val(in2) || {}).lan_thu === 2 && (val(in2) || {}).cat_lai === true, JSON.stringify(in2.r || in2.e))
  const inPb2 = await as(U.xuong, `select kho.ghi_lan_in_tem($1,2,$2) d`, [DON, [t1, t2, t3]], true)
  ok('★★★ in pb2 (bản vẽ MỚI) → lan_thu về 1, cat_lai=FALSE (KHÔNG tính cắt lại)', (val(inPb2) || {}).lan_thu === 1 && (val(inPb2) || {}).cat_lai === false, JSON.stringify(inPb2.r || inPb2.e))

  console.log('\n── B. driver_tu_tem + ty_le_cat_lai ──')
  ok('sale gọi driver_tu_tem → CHẶN', /chỉ ceo\/ke_toan\/xuong/.test((await as(U.sale, `select kho.driver_tu_tem($1,'cat')`, [YM])).e || ''))
  // tem_da_in: pb1 lan1 [t1,t2]=2 · pb1 lan2 [t1]=1 · pb2 lan1 [t1,t2,t3]=3  -> cat=6 (mọi lượt kể cả cắt lại)
  ok('driver cat = 6 (đếm MỌI lượt, kể cả cắt lại)', Number(val(await as(U.ceo, `select kho.driver_tu_tem($1,'cat')`, [YM]))) === 6)
  // thung: vai hong = t1 in 3 lần (pb1l1,pb1l2,pb2l1) -> 3
  ok('driver thung = 3 (vai hong=t1 in 3 lượt)', Number(val(await as(U.ceo, `select kho.driver_tu_tem($1,'thung')`, [YM]))) === 3)
  // canh: vai canh_cua = t2 in 2 lần (pb1l1, pb2l1) -> 2
  ok('driver canh = 2 (vai canh_cua=t2 in 2 lượt)', Number(val(await as(U.ceo, `select kho.driver_tu_tem($1,'canh')`, [YM]))) === 2)
  // goi: distinct (ma_don,pb,kien): pb1{kien1}, pb2{kien1,kien2} -> 3
  ok('driver goi = 3 (kiện phân biệt qua các pb)', Number(val(await as(U.ceo, `select kho.driver_tu_tem($1,'goi')`, [YM]))) === 3)
  // dan (m): t1 in 3× (canh 2003) + t2 in 2× (2003? no: 892+430=1322) + t3 0.
  //   Σ = 3×2003 + 2×1322 = 6009 + 2644 = 8653 mm = 8.653 m
  ok('driver dan = 8.653 m (Σ canh_dan.dai mọi lượt / 1000)', Math.abs(Number(val(await as(U.ceo, `select kho.driver_tu_tem($1,'dan')`, [YM]))) - 8.653) < 1e-6)
  // ty_le_cat_lai = tem lượt2+ / tổng = (pb1 lan2: 1 tem) / 6 = 0.1667
  ok('ty_le_cat_lai = 0.1667 (1 tem cắt lại / 6 tem)', Math.abs(Number(val(await as(U.ceo, `select kho.ty_le_cat_lai($1)`, [YM]))) - 0.1667) < 1e-3)

  console.log('\n── B. RLS tem ──')
  ok('sale ĐỌC tem_ban_ve → 0 dòng (không policy sale)', ((await as(U.sale, `select 1 from kho.tem_ban_ve limit 1`)).r || []).length === 0)
  ok('xuong ĐỌC tem_ban_ve → có dòng', ((await as(U.xuong, `select 1 from kho.tem_ban_ve limit 1`)).r || []).length === 1)

  // ═══════ C. PHIẾU ĐẾM + LỖI ═══════
  console.log('\n── C. Phiếu đếm (chỉ pu/lot/giuong_lap) + ghi lỗi ──')
  ok("phieu_dem_ngay hoat_dong='cat' → CHẶN (CHECK)", /check|hoat_dong/i.test((await c.query(`savepoint z`).then(()=>c.query(`insert into kho.phieu_dem_ngay(ma_to,hoat_dong,so_luong) values('son_pu','cat',5)`)).then(()=>{return ''}).catch(e=>e.message).finally(()=>c.query('rollback to savepoint z'))) || ''))
  await c.query(`savepoint z1`)
  let puErr = null; try { await c.query(`insert into kho.phieu_dem_ngay(ma_to,hoat_dong,so_luong) values('son_pu','pu',12.5)`) } catch (e) { puErr = e.message }
  await c.query(`rollback to savepoint z1`)
  ok("phieu_dem_ngay hoat_dong='pu' → ĐƯỢC", puErr === null, puErr || '')
  await c.query(`savepoint z2`)
  let loiErr = null; try { await c.query(`insert into kho.loi_lam_lai(ma_to,ma_don,loai_loi,so_luong) values('son_pu',$1,'sut_canh',2)`, [DON]) } catch (e) { loiErr = e.message }
  await c.query(`rollback to savepoint z2`)
  ok('loi_lam_lai ghi được', loiErr === null, loiErr || '')

  // ═══════ D. PHÂN BỔ 100% + ĐƠN GIÁ HOẠT ĐỘNG ═══════
  console.log('\n── D. phan_bo 100% (deferred) ──')
  await c.query(`savepoint pb`)
  let pbErr = null
  try {
    await c.query(`insert into kho.phan_bo_hoat_dong(ma_ky,ma_to,hoat_dong,phan_tram_thoi_gian) values($1,'son_pu','pu',60)`, [YM])
    await c.query(`set constraints kho.trg_phan_bo_100 immediate`)   // ép kiểm deferred NGAY
  } catch (e) { pbErr = e.message }
  await c.query(`rollback to savepoint pb`)
  ok('phan_bo tổng 60% ≠ 100 → CHẶN (deferred)', /phải = 100/.test(pbErr || ''), pbErr || '')
  await c.query(`savepoint pb2`)
  let pbOk = null
  try {
    await c.query(`insert into kho.phan_bo_hoat_dong(ma_ky,ma_to,hoat_dong,phan_tram_thoi_gian) values($1,'son_pu','pu',40),($1,'son_pu','cat',60)`, [YM])
    await c.query(`set constraints kho.trg_phan_bo_100 immediate`)
    await c.query(`insert into kho.luong_to(ma_ky,ma_to,luong_to,overhead_phan_bo,bao_hiem) values($1,'son_pu',10000000,2000000,1000000)`, [YM])
  } catch (e) { pbOk = e.message }
  ok('phan_bo tổng 100% + luong_to → ĐƯỢC', pbOk === null, pbOk || '')

  console.log('\n── D. don_gia_hoat_dong_thuc + ty_le_truy_duoc ──')
  // driver mẫu số 'cat'=6 (tem). tử = (10tr+2tr+1tr)×60%/... = 13tr×0.6 = 7.8tr. đơn giá = 7.8tr/6 = 1.3tr
  ok('xuong gọi don_gia_hoat_dong_thuc → CHẶN (chỉ ceo/ke_toan)', /chỉ ceo\/ke_toan/.test((await as(U.xuong, `select kho.don_gia_hoat_dong_thuc($1,'cat')`, [YM])).e || ''))
  ok('don_gia cat = 1.300.000 (13tr×60% ÷ driver tem 6)', Number(val(await as(U.ceo, `select kho.don_gia_hoat_dong_thuc($1,'cat')`, [YM]))) === 1300000, JSON.stringify((await as(U.ceo, `select kho.don_gia_hoat_dong_thuc($1,'cat')`, [YM])).r))
  ok('don_gia hoạt động THIẾU mẫu số → NULL (KHÔNG ra 0)', val(await as(U.ceo, `select kho.don_gia_hoat_dong_thuc($1,'giuong_lap')`, [YM])) === null)

  // ty_le_truy_duoc: cần san_luong_don + don_hang.ma_ky_ap_dung = YM
  await c.query(`select set_config('chan.off_vai','1',false)`)
  await c.query(`update kho.don_hang set ma_ky_ap_dung=$1 where ma_don=$2`, [YM, DON])
  await c.query(`select set_config('chan.off_vai','',false)`)
  ok('sale ghi san_luong_don → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await as(U.sale, `select kho.ghi_san_luong_don($1,$2::jsonb)`, [DON, JSON.stringify({ cat: 6 })])).e || ''))
  const gsl = await as(U.thiet_ke, `select kho.ghi_san_luong_don($1,$2::jsonb) d`, [DON, JSON.stringify({ cat: 6, dan: 8.653, goi: 3 })], true)
  ok('thiet_ke ghi san_luong_don → OK', (val(gsl) || {}).ok === true, JSON.stringify(gsl.r || gsl.e))
  const tld = await as(U.ceo, `select * from kho.ty_le_truy_duoc($1,'cat')`, [YM])
  ok('ty_le_truy_duoc cat = 1.0 (truy 6 / tổng tem 6)', Number((tld.r && tld.r[0] || {}).ty_le) === 1, JSON.stringify(tld.r || tld.e))
  ok('ty_le_truy_duoc trả kèm luong_truy + luong_khong_truy', tld.r && tld.r[0] && tld.r[0].luong_truy != null && tld.r[0].luong_khong_truy != null)

  console.log(`\n==================================\nKẾT QUẢ 038: ${P} pass / ${F} fail\n==================================`)
  await c.query('rollback')
} catch (e) {
  console.error('LỖI TEST:', e.message); F++
  try { await c.query('rollback') } catch (_) {}
} finally {
  await c.end(); process.exit(F ? 1 : 0)
}
