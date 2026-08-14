// TEST CẮN — 068 màn nhập số (server). In ĐỦ HAI VẾ. Tx rollback.
//   Chạy: cd web && node ops/test_068.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
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
// gọi RPC ghi dưới vai (GIỮ hiệu lực trong tx để đọc lại) — asK
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}

const midOf = async (sp) => (await q1(`select id from kho.don_hang_mon where sp_id=$1 and don_id=(select id from kho.don_hang where ma_don='CAN-A-DEMO') limit 1`, [sp])).id
try {
  await c.query('begin')
  const MID = await midOf('CAN-A-TUAO-MASTER-BT')   // khoá theo MÓN (db/069)
  const F1 = `'[{"loai_file":"dxf","duong_dan":"x/a.dxf","ten_goc":"a.dxf","co_byte":10}]'::jsonb`   // 1 file cắt giả

  // ═══ 1 · BIỂU THỨC lưu và mở lại ═══
  console.log('\n── 1 · biểu thức lưu nguyên văn, mở lại đúng ──')
  await asK(U.thiet_ke, `select kho.luu_so_don_vi($1,'cat','2+1+1+4+4','go_tay')`, [MID])
  const row = await q1(`select bieu_thuc, so_don_vi from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat'`, [MID])
  console.log(`   lưu "2+1+1+4+4" → DB: bieu_thuc="${row.bieu_thuc}" so_don_vi=${row.so_don_vi}`)
  ok('✅ mở lại thấy ĐÚNG biểu thức "2+1+1+4+4" (🟥 vế chỉ lưu kết quả → "12")', row.bieu_thuc === '2+1+1+4+4' && Number(row.so_don_vi) === 12)
  await asK(U.thiet_ke, `select kho.luu_so_don_vi($1,'cup','4*4','go_tay')`, [MID])
  ok('✅ nhân "4*4" → so_don_vi=16', Number((await q1(`select so_don_vi from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cup'`, [MID])).so_don_vi) === 16)

  // ═══ 2 · BIỂU THỨC RÁC bị chặn (server) ═══
  console.log('\n── 2 · biểu thức rác bị chặn, KHÔNG lưu ──')
  const rac1 = await asK(U.thiet_ke, `select kho.luu_so_don_vi($1,'dan','12; drop table x','go_tay')`, [MID])
  ok('✅ "12; drop table" → RPC báo lỗi, KHÔNG lưu', rac1.e != null && /BIEU_THUC_RAC/.test(rac1.e), rac1.e || '(lọt!)')
  const rac2 = await asK(U.thiet_ke, `select kho.luu_so_don_vi($1,'dan','abc','go_tay')`, [MID])
  ok('✅ "abc" → RPC báo lỗi, KHÔNG lưu', rac2.e != null)
  // CHECK constraint tầng cột (chèn thẳng)
  let chenRac = false
  try { await c.query('savepoint r2'); await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon,bieu_thuc) values($1,'goi',1,'go_tay','x;y')`, [MID]); chenRac = true; await c.query('rollback to savepoint r2') } catch (e) { await c.query('rollback to savepoint r2') }
  ok('✅ CHECK cột chặn bieu_thuc ký tự lạ (chèn thẳng)', !chenRac)

  // ═══ 3 · FAIL-ĐÓNG SERVER · bàn giao khi còn thiếu số ═══
  console.log('\n── 3 · bàn giao xưởng — server chặn khi thiếu số (quan trọng nhất) ──')
  await c.query('savepoint s3'); await c.query(`delete from kho.so_don_vi_mon where mon_id=$1`, [await midOf('CAN-A-BEP-TREN-BT')])  // 1 món thiếu
  const dThieu = await as(U.thiet_ke, `select kho.ban_giao_xuong('CAN-A-DEMO', ${F1}, null)`)
  console.log(`   🟥 vế chưa vá: client tự cho gửi · ✅ server: ${dThieu.e ? dThieu.e.slice(0, 70) : '(lọt!)'}`)
  ok('✅ gọi thẳng API bàn giao khi thiếu số → SERVER CHẶN (THIEU_SO_DON_VI)', dThieu.e != null && /THIEU_SO_DON_VI/.test(dThieu.e), dThieu.e || '(LỌT!)')
  await c.query('rollback to savepoint s3')

  // ═══ 4 · CỔNG VAI (ĐƯỢC = qua cổng vai, dù có thể vướng thiếu file/khách-duyệt) ═══
  console.log('\n── 4 · cổng vai (thiet_ke/ceo vào · khác chặn) ──')
  const quaCong = e => !/chỉ ceo\/thiet_ke/.test(e || '')
  const goi = { nhap_so_don_don_hang: `kho.nhap_so_don_don_hang('CAN-A-DEMO')`, ban_giao_xuong: `kho.ban_giao_xuong('CAN-A-DEMO', ${F1}, null)` }
  for (const rpc of Object.keys(goi)) {
    ok(`thiet_ke ${rpc} → ĐƯỢC (qua cổng vai)`, quaCong((await as(U.thiet_ke, `select ${goi[rpc]}`)).e))
    ok(`ceo ${rpc} → ĐƯỢC (qua cổng vai)`, quaCong((await as(U.ceo, `select ${goi[rpc]}`)).e))
    for (const v of ['sale', 'xuong', 'tho', 'ke_toan']) ok(`${v} ${rpc} → CHẶN`, /chỉ ceo\/thiet_ke/.test((await as(U[v], `select ${goi[rpc]}`)).e || ''), '(lọt!)')
    ok(`vai NULL ${rpc} → CHẶN`, /chỉ ceo\/thiet_ke/.test((await as(null, `select ${goi[rpc]}`)).e || ''))
  }

  // ═══ 5 · ĐƠN 1 MÓN ẨN DẢI TỔNG ═══
  console.log('\n── 5 · đơn 1 món ẩn dải tổng · nhiều món hiện ──')
  const nhieu = (await as(U.ceo, `select kho.nhap_so_don_don_hang('CAN-A-DEMO') d`)).r[0].d
  ok('✅ đơn NHIỀU món (6) → dai_tong CÓ', nhieu.dai_tong != null)
  // tạo đơn 1 món trong tx
  const don1 = (await q1(`insert into kho.don_hang(ma_don,trang_thai,la_demo,ten_khach) values('CAN-A-1MON','dang_thiet_ke',true,'[DEMO] 1 món') returning id`)).id
  await c.query(`insert into kho.don_hang_mon(don_id,sp_id,ten,so_luong,trang_thai) values($1,'CAN-A-TUAO-NHO-BT','1 món',1,'cho_cat')`, [don1])
  const mot = (await as(U.ceo, `select kho.nhap_so_don_don_hang('CAN-A-1MON') d`)).r[0].d
  console.log(`   đơn 1 món: so_mon=${mot.so_mon} dai_tong=${mot.dai_tong}`)
  ok('✅ đơn 1 món → dai_tong = NULL (ẩn dải)', mot.dai_tong === null)

  // ═══ 8 · ma_don lạ / đơn chưa chốt → CHẶN, báo lý do ═══
  console.log('\n── 8 · fail-đóng tải đơn ──')
  const la = await as(U.ceo, `select kho.nhap_so_don_don_hang('KHONG-CO-DON-NAY')`)
  ok('✅ ma_don lạ → DON_KHONG_TON_TAI (🟥 vế chưa vá trả rỗng)', /DON_KHONG_TON_TAI/.test(la.e || ''), la.e || '(lọt!)')
  const bg = (await q1(`insert into kho.don_hang(ma_don,trang_thai,la_demo,ten_khach) values('CAN-A-BAOGIA','bao_gia',true,'[DEMO] báo giá') returning id`)).id
  await c.query(`insert into kho.don_hang_mon(don_id,sp_id,ten,so_luong,trang_thai) values($1,'CAN-A-TUAO-NHO-BT','x',1,'cho_cat')`, [bg])
  const chuaChot = await as(U.ceo, `select kho.nhap_so_don_don_hang('CAN-A-BAOGIA')`)
  ok('✅ đơn chưa chốt (báo giá) → DON_CHUA_CHOT', /DON_CHUA_CHOT/.test(chuaChot.e || ''), chuaChot.e || '(lọt!)')

  // ═══ 9 · BÀN GIAO THÀNH CÔNG (đủ 3 chốt) đổi trạng thái + lưu file ═══
  console.log('\n── 9 · bàn giao thành công → cho_cat + file (trước/sau) ──')
  // CAN-A-DEMO đã đủ số (6 món 'du'); thêm chốt KHÁCH DUYỆT
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('CAN-A-DEMO',1,'38c5252b-6e59-4651-8edb-d1c38afed0b6','khach_duyet')`)
  const tt_truoc = (await q1(`select trang_thai from kho.don_hang where ma_don='CAN-A-DEMO'`)).trang_thai
  const file_truoc = Number((await q1(`select count(*) n from kho.file_san_xuat where ma_don='CAN-A-DEMO'`)).n)
  const bgKq = await asK(U.thiet_ke, `select kho.ban_giao_xuong('CAN-A-DEMO', ${F1}, 'test bàn giao') r`)
  const tt_sau = (await q1(`select trang_thai from kho.don_hang where ma_don='CAN-A-DEMO'`)).trang_thai
  const file_sau = Number((await q1(`select count(*) n from kho.file_san_xuat where ma_don='CAN-A-DEMO'`)).n)
  console.log(`   TRƯỚC=${tt_truoc} file=${file_truoc} → SAU=${tt_sau} file=${file_sau} · rpc=${bgKq.e || JSON.stringify(bgKq.r[0])}`)
  ok('✅ thiet_ke bàn giao (đủ số + file + khách duyệt) → cho_cat + lưu file', bgKq.e === null && tt_sau === 'cho_cat' && tt_truoc !== 'cho_cat' && file_sau > file_truoc)

  // ═══ 10 · BÀN GIAO LẠI đơn đã vào chuyền → CHẶN ═══
  console.log('\n── 10 · bàn giao lại đơn đã vào chuyền ──')
  const dayLai = await as(U.thiet_ke, `select kho.ban_giao_xuong('CAN-A-DEMO', ${F1}, null)`)   // giờ đã cho_cat
  ok('✅ bàn giao lại đơn đã cho_cat → DA_VAO_CHUYEN (🟥 vế chưa vá gửi được lần 2)', /DA_VAO_CHUYEN/.test(dayLai.e || ''), dayLai.e || '(LỌT!)')

  // ═══ 11 · vai khác VẪN chặn (mở quyền thiet_ke không nới vai khác) ═══
  console.log('\n── 11 · vai khác vẫn chặn bàn giao ──')
  for (const v of ['sale', 'tho', 'ke_toan']) ok(`${v} bàn giao → CHẶN`, /chỉ ceo\/thiet_ke/.test((await as(U[v], `select kho.ban_giao_xuong('CAN-A-DEMO', ${F1}, null)`)).e || ''), '(lọt!)')

  await c.query('rollback')
  console.log(`\n══ KẾT QUẢ 068: ${P} pass · ${F} fail ══`)
  process.exitCode = F ? 1 : 0
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); try { await c.query('rollback') } catch (_) {}; process.exitCode = 1 }
finally { await c.end() }
