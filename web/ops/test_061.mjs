// TEST CẮN — 061 xương quy trình sản xuất. In ĐỦ HAI VẾ mỗi test. Tất cả trong 1 giao dịch, rollback.
//   Chạy: cd web && node ops/test_061.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e'
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
// gọi trong vai uid (uid=null → chưa đăng nhập), rollback savepoint
async function as(uid, s, a = []) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint sp') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint sp')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
// dựng 6 bước tủ áo có NHÁNH cho 1 lõi (chạy như postgres, bỏ RLS lúc setup)
async function dungGraph(loi) {
  await c.query(`delete from kho.quy_trinh_buoc where ma_loi=$1`, [loi])
  const rows = [
    [100, '{}', 'chung', 'cat', 'Cắt'], [200, '{100}', 'thùng', 'dan', 'Dán cạnh'],
    [300, '{200}', 'thùng', 'cam', 'Khoan'], [210, '{100}', 'cánh', 'lot', 'Chà lót'],
    [310, '{210}', 'cánh', 'pu', 'Sơn PU'], [400, '{300,310}', 'chung', 'thung', 'Lắp ráp']
  ]
  for (const [tt, bt, nh, hd, gc] of rows)
    await c.query(`insert into kho.quy_trinh_buoc(ma_loi,thu_tu,buoc_truoc,nhanh,hoat_dong,to_phu_trach,ghi_chu) values($1,$2,$3,$4,$5,$6,$6)`,
      [loi, tt, bt, nh, hd, gc])
}
// runnable theo ĐÚNG (đọc buoc_truoc): buoc_truoc ⊆ done
const runDung = (loi, s, done) => q1(`select (buoc_truoc <@ $3::int[]) ok from kho.quy_trinh_buoc where ma_loi=$1 and thu_tu=$2`, [loi, s, done]).then(r => r.ok)
// runnable theo SAI (suy bước trước = thu_tu liền trước theo thứ tự): pred null hoặc pred ∈ done
const runSai = async (loi, s, done) => {
  const pred = (await q1(`select max(thu_tu) p from kho.quy_trinh_buoc where ma_loi=$1 and thu_tu<$2`, [loi, s])).p
  return pred == null || done.includes(Number(pred))
}

try {
  await c.query('begin')
  const LOI = (await q1(`select ma_loi from kho.san_pham_loi limit 1`)).ma_loi
  const LOI_TRONG = (await q1(`select ma_loi from kho.san_pham_loi where ma_loi not in (select distinct ma_loi from kho.quy_trinh_buoc) limit 1`)).ma_loi

  // ═══ TEST 1 · KHÔNG đẻ danh mục thứ hai ═══
  console.log('\n── 1 · không đẻ danh mục hoạt động thứ hai ──')
  const fk = await q1(`select confrelid::regclass::text tro from pg_constraint where conrelid='kho.quy_trinh_buoc'::regclass and contype='f' and conkey=(select array_agg(attnum) from pg_attribute where attrelid='kho.quy_trinh_buoc'::regclass and attname='hoat_dong')`)
  ok('quy_trinh_buoc.hoat_dong FK → don_gia_baseline (12 hoạt động)', fk && /don_gia_baseline/.test(fk.tro), fk?.tro)
  const bangKhac = await c.query(`select table_name from information_schema.tables where table_schema='kho' and (table_name ~ 'cong_doan|operation' or table_name='hoat_dong')`)
  ok('KHÔNG có bảng công đoạn/hoạt động nào khác', bangKhac.rows.length === 0, bangKhac.rows.map(r => r.table_name).join(','))
  //  vế CHƯA VÁ (không FK) sẽ cho rác lọt; vế ĐÃ VÁ (có FK) từ chối:
  let racLot = false
  try { await c.query('savepoint r'); await c.query(`insert into kho.quy_trinh_buoc(ma_loi,thu_tu,hoat_dong) values($1,9999,'RAC-KO-CO')`, [LOI]); racLot = true; await c.query('rollback to savepoint r') }
  catch (e) { await c.query('rollback to savepoint r') }
  console.log(racLot ? '   🟥 (vế chưa vá: không FK → rác LỌT)' : '   ⬜ vế chưa vá mô phỏng: nếu không FK thì rác sẽ lọt')
  ok('vế ĐÃ VÁ: insert hoat_dong rác → BỊ TỪ CHỐI (FK)', !racLot)

  // ═══ TEST 2 · ĐỒ THỊ CÓ NHÁNH (quan trọng nhất) ═══
  console.log('\n── 2 · đồ thị có nhánh chạy song song rồi gộp ──')
  await dungGraph(LOI)
  const done_A = [100, 210]   // đã Cắt + Chà lót (nhánh cánh tiến), nhánh thùng CHƯA qua Dán
  const s310_dung = await runDung(LOI, 310, done_A), s310_sai = await runSai(LOI, 310, done_A)
  console.log(`   done={100,210}: 310 Sơn PU  → ĐÚNG(buoc_truoc)=${s310_dung}  · SAI(thu_tu-1)=${s310_sai}`)
  ok('🟥 vế SAI (thu_tu-1): 310 bị coi phải chờ 300 Khoan → CHẶN SAI', s310_sai === false)
  ok('✅ vế ĐÚNG (buoc_truoc): 310 ĐI ĐƯỢC khi 210 xong, KHÔNG cần nhánh thùng', s310_dung === true)
  //  400 gộp hai nhánh: chỉ đi khi CẢ 300 VÀ 310 xong
  const g400_thieu = await runDung(LOI, 400, [100, 200, 210, 310])     // thiếu 300
  const g400_du = await runDung(LOI, 400, [100, 200, 300, 210, 310])   // đủ 300 & 310
  ok('✅ 400 Lắp ráp CHƯA đi khi thiếu 300 (chỉ có 310)', g400_thieu === false)
  ok('✅ 400 Lắp ráp ĐI khi CẢ 300 VÀ 310 xong', g400_du === true)
  const kiem2 = (await as(U.ceo, `select kho.kiem_quy_trinh($1) k`, [LOI])).r[0].k
  ok('✅ kiem_quy_trinh trên đồ thị đúng → KHÔNG lỗi', Array.isArray(kiem2) && kiem2.length === 0, JSON.stringify(kiem2))

  // ═══ TEST 3 · kiem_quy_trinh bắt rác (3 ca) ═══
  console.log('\n── 3 · hàng rào đồ thị bắt được rác ──')
  const caTest = async (ten, rows, loaiCho) => {
    await c.query('savepoint c3'); await c.query(`delete from kho.quy_trinh_buoc where ma_loi=$1`, [LOI])
    for (const [tt, bt, hd] of rows) await c.query(`insert into kho.quy_trinh_buoc(ma_loi,thu_tu,buoc_truoc,hoat_dong) values($1,$2,$3,$4)`, [LOI, tt, bt, hd])
    const naive = (await q1(`select count(*) n from kho.quy_trinh_buoc where ma_loi=$1`, [LOI])).n   // "vế chưa vá": chỉ đếm dòng
    const kiem = (await as(U.ceo, `select kho.kiem_quy_trinh($1) k`, [LOI])).r[0].k
    const batDuoc = kiem.some(e => e.loai === loaiCho)
    console.log(`   ${ten}: 🟥 naive(đếm dòng)=${naive}→"ổn" ⬝ ✅ kiem_quy_trinh=${JSON.stringify(kiem.map(e => e.loai))}`)
    ok(`   ${ten} → kiem bắt '${loaiCho}'`, batDuoc)
    await c.query('rollback to savepoint c3')
  }
  await caTest('(a) buoc_truoc trỏ thu_tu không tồn tại', [[100, '{}', 'cat'], [200, '{999}', 'dan']], 'buoc_truoc_khong_ton_tai')
  await caTest('(b) chu trình A↔B', [[100, '{200}', 'cat'], [200, '{100}', 'dan']], 'chu_trinh')
  await caTest('(c) không có bước khởi đầu', [[100, '{200}', 'cat'], [200, '{300}', 'dan'], [300, '{100}', 'cam']], 'khong_co_buoc_khoi_dau')
  await c.query(`delete from kho.quy_trinh_buoc where ma_loi=$1`, [LOI])   // dọn graph test

  // ═══ TEST 4 · lõi CHƯA khai quy trình ═══
  console.log('\n── 4 · lõi chưa khai quy trình → có cờ, không rỗng im lặng ──')
  const r4 = (await as(U.ceo, `select kho.quy_trinh_cua_loi($1) k`, [LOI_TRONG])).r[0].k
  console.log(`   🟥 vế chưa vá: nếu chỉ trả buoc=[] thì không phân biệt "khai 0 bước" vs "chưa khai"`)
  ok('✅ vế đã vá: chua_co_quy_trinh=true (kèm cờ)', r4.chua_co_quy_trinh === true && Array.isArray(r4.buoc) && r4.buoc.length === 0, JSON.stringify(r4))

  // ═══ TEST 5 · trạm trùng mã ═══
  console.log('\n── 5 · trạm trùng ma_tram bị từ chối ──')
  let tramLot = false
  try { await c.query('savepoint t5'); await c.query(`insert into kho.tram(ma_tram,ten,hoat_dong) values('TRAM-CAT-01','trùng','cat')`); tramLot = true; await c.query('rollback to savepoint t5') }
  catch (e) { await c.query('rollback to savepoint t5') }
  console.log(tramLot ? '   🟥 trùng LỌT' : '   ⬜ vế chưa vá: nếu ma_tram không unique thì trùng sẽ lọt')
  ok('✅ vế đã vá: chèn 2 trạm cùng ma_tram → BỊ TỪ CHỐI (PK)', !tramLot)

  // ═══ TEST 6 · cổng vai ghi quy_trinh_buoc (bẫy NULL) ═══
  console.log('\n── 6 · cổng vai ghi + bẫy NULL ──')
  const insMoi = (uid) => as(uid, `insert into kho.quy_trinh_buoc(ma_loi,thu_tu,buoc_truoc,hoat_dong) values($1,700,'{}','cat')`, [LOI])
  ok('✅ thiet_ke GHI quy_trinh_buoc → ĐƯỢC', (await insMoi(U.thiet_ke)).e === null)
  ok('✅ tho GHI → CHẶN', (await insMoi(U.tho)).e != null, 'lọt!')
  ok('✅ sale GHI → CHẶN', (await insMoi(U.sale)).e != null, 'lọt!')
  ok('✅ vai NULL (chưa đăng nhập) GHI → CHẶN (bẫy NULL)', (await insMoi(null)).e != null, 'lọt!')

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 061: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
