// TEST CẮN — 061 xương quy trình (SỬA theo khoá QUY TRÌNH của db/062). In ĐỦ HAI VẾ. Tx rollback.
//   Chạy: cd web && node ops/test_061.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e'
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q1 = async (s, a = []) => (await c.query(s, a)).rows[0]
async function as(uid, s, a = []) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint sp') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint sp')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const QT = 'QT-TEST-061'
async function dungGraph(qt) {
  await c.query(`delete from kho.quy_trinh_buoc where ma_quy_trinh=$1`, [qt])
  const rows = [
    [100, '{}', 'chung', 'cat'], [200, '{100}', 'thùng', 'dan'], [300, '{200}', 'thùng', 'cam'],
    [210, '{100}', 'cánh', 'lot'], [310, '{210}', 'cánh', 'pu'], [400, '{300,310}', 'chung', 'thung']
  ]
  for (const [tt, bt, nh, hd] of rows)
    await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong) values($1,$2,$3,$4,$5)`, [qt, tt, bt, nh, hd])
}
const runDung = (qt, s, done) => q1(`select (buoc_truoc <@ $3::int[]) ok from kho.quy_trinh_buoc where ma_quy_trinh=$1 and thu_tu=$2`, [qt, s, done]).then(r => r.ok)
const runSai = async (qt, s, done) => { const pred = (await q1(`select max(thu_tu) p from kho.quy_trinh_buoc where ma_quy_trinh=$1 and thu_tu<$2`, [qt, s])).p; return pred == null || done.includes(Number(pred)) }

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values($1,'test 061') on conflict do nothing`, [QT])
  const LOI_TRONG = (await q1(`select ma_loi from kho.san_pham_loi where ma_quy_trinh is null limit 1`)).ma_loi

  // ═══ 1 · KHÔNG đẻ danh mục thứ hai ═══
  console.log('\n── 1 · không đẻ danh mục hoạt động thứ hai ──')
  const fk = await q1(`select confrelid::regclass::text tro from pg_constraint where conrelid='kho.quy_trinh_buoc'::regclass and contype='f' and conkey=(select array_agg(attnum) from pg_attribute where attrelid='kho.quy_trinh_buoc'::regclass and attname='hoat_dong')`)
  ok('quy_trinh_buoc.hoat_dong FK → don_gia_baseline', fk && /don_gia_baseline/.test(fk.tro), fk?.tro)
  const bangKhac = await c.query(`select table_name from information_schema.tables where table_schema='kho' and (table_name ~ 'cong_doan|operation' or table_name='hoat_dong')`)
  ok('KHÔNG có bảng công đoạn/hoạt động khác', bangKhac.rows.length === 0, bangKhac.rows.map(r => r.table_name).join(','))
  let racLot = false
  try { await c.query('savepoint r'); await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,hoat_dong) values($1,9999,'RAC')`, [QT]); racLot = true; await c.query('rollback to savepoint r') } catch (e) { await c.query('rollback to savepoint r') }
  console.log(racLot ? '   🟥 (không FK → rác lọt)' : '   ⬜ vế chưa vá: không FK thì rác lọt')
  ok('vế ĐÃ VÁ: hoat_dong rác → BỊ TỪ CHỐI (FK)', !racLot)

  // ═══ 2 · ĐỒ THỊ CÓ NHÁNH (khoá quy trình) ═══
  console.log('\n── 2 · đồ thị có nhánh (trên cấu trúc mới) ──')
  await dungGraph(QT)
  const done_A = [100, 210]
  ok('🟥 vế SAI (thu_tu-1): 310 bị chặn oan (chờ 300)', (await runSai(QT, 310, done_A)) === false)
  ok('✅ vế ĐÚNG (buoc_truoc): 310 đi được khi 210 xong', (await runDung(QT, 310, done_A)) === true)
  ok('✅ 400 CHƯA đi khi thiếu 300', (await runDung(QT, 400, [100, 200, 210, 310])) === false)
  ok('✅ 400 ĐI khi CẢ 300 VÀ 310 xong', (await runDung(QT, 400, [100, 200, 300, 210, 310])) === true)
  const kiem2 = (await as(U.ceo, `select kho.kiem_quy_trinh($1) k`, [QT])).r[0].k
  ok('✅ kiem_quy_trinh đồ thị đúng → KHÔNG lỗi', Array.isArray(kiem2) && kiem2.length === 0, JSON.stringify(kiem2))

  // ═══ 3 · hàng rào bắt rác ═══
  console.log('\n── 3 · kiem_quy_trinh bắt rác ──')
  const caTest = async (ten, rows, loaiCho) => {
    await c.query('savepoint c3'); await c.query(`delete from kho.quy_trinh_buoc where ma_quy_trinh=$1`, [QT])
    for (const [tt, bt, hd] of rows) await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,hoat_dong) values($1,$2,$3,$4)`, [QT, tt, bt, hd])
    const kiem = (await as(U.ceo, `select kho.kiem_quy_trinh($1) k`, [QT])).r[0].k
    console.log(`   ${ten}: 🟥 naive="ổn" ⬝ ✅ kiem=${JSON.stringify(kiem.map(e => e.loai))}`)
    ok(`   ${ten} → bắt '${loaiCho}'`, kiem.some(e => e.loai === loaiCho))
    await c.query('rollback to savepoint c3')
  }
  await caTest('(a) buoc_truoc trỏ thu_tu không tồn tại', [[100, '{}', 'cat'], [200, '{999}', 'dan']], 'buoc_truoc_khong_ton_tai')
  await caTest('(b) chu trình A↔B', [[100, '{200}', 'cat'], [200, '{100}', 'dan']], 'chu_trinh')
  await caTest('(c) không có bước khởi đầu', [[100, '{200}', 'cat'], [200, '{300}', 'dan'], [300, '{100}', 'cam']], 'khong_co_buoc_khoi_dau')
  await c.query(`delete from kho.quy_trinh_buoc where ma_quy_trinh=$1`, [QT])

  // ═══ 4 · lõi CHƯA gán quy trình ═══
  console.log('\n── 4 · lõi chưa gán quy trình → có cờ ──')
  const r4 = (await as(U.ceo, `select kho.quy_trinh_cua_loi($1) k`, [LOI_TRONG])).r[0].k
  ok('✅ chua_co_quy_trinh=true (không rỗng im lặng)', r4.chua_co_quy_trinh === true && r4.buoc.length === 0, JSON.stringify(r4))

  // ═══ 5 · trạm trùng mã ═══
  console.log('\n── 5 · trạm trùng ma_tram ──')
  let tramLot = false
  try { await c.query('savepoint t5'); await c.query(`insert into kho.tram(ma_tram,ten,hoat_dong) values('TRAM-CAT-01','trùng','cat')`); tramLot = true; await c.query('rollback to savepoint t5') } catch (e) { await c.query('rollback to savepoint t5') }
  ok('✅ 2 trạm cùng ma_tram → BỊ TỪ CHỐI (PK)', !tramLot)

  // ═══ 6 · cổng vai ghi quy_trinh_buoc + bẫy NULL ═══
  console.log('\n── 6 · cổng vai ghi + bẫy NULL ──')
  const insMoi = (uid) => as(uid, `insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,hoat_dong) values($1,700,'{}','cat')`, [QT])
  ok('✅ thiet_ke GHI → ĐƯỢC', (await insMoi(U.thiet_ke)).e === null)
  ok('✅ tho GHI → CHẶN', (await insMoi(U.tho)).e != null)
  ok('✅ sale GHI → CHẶN', (await insMoi(U.sale)).e != null)
  ok('✅ vai NULL → CHẶN (bẫy NULL)', (await insMoi(null)).e != null)

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 061: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
