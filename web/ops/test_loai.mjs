// TEST — WP-70 L-08 (db/182): loai_thuong_mai (danh mục đóng 10) + cầu dong_loai (11/11). Owner tx, rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows

// tên Y HỆT danh sách CEO (WP-09 khớp từng ký tự)
const TEN = ['Sofa & Sofa bed', 'Giường & Phòng ngủ', 'Bàn ăn & Ghế ăn', 'Tủ & Lưu trữ', 'Bàn làm việc & Bàn học',
  'Nội thất bếp', 'Bàn trà & Bàn phụ', 'Thảm', 'Chăn ga gối nệm', 'Đèn & Phụ kiện']
const MAP11 = { TA: 'tu', TG: 'tu', KE: 'tu', HK: 'tu', GN: 'giuong', TD: 'giuong', BLV: 'ban_lv', HB: 'ban_lv', BA: 'ban_an', TB: 'bep', BT: 'ban_tra' }

await c.query('begin')

// ═══ 1 · loai_thuong_mai đúng 10 dòng, tên khớp TỪNG KÝ TỰ theo thu_tu ═══
{ const r = await q(`select ma, ten, thu_tu from kho.loai_thuong_mai order by thu_tu`)
  const tenOk = r.length === 10 && r.every((x, i) => x.ten === TEN[i])
  ok('1. loai_thuong_mai 10 dòng, tên khớp từng ký tự (theo thu_tu)', tenOk, JSON.stringify(r.map(x => x.ten)))
}

// ═══ 2 · UPDATE đè TEN → bị chặn (danh mục đóng) ═══
{ await c.query('savepoint s2'); let e1 = null
  try { await c.query(`update kho.loai_thuong_mai set ten='Đổi bậy' where ma='tu'`) } catch (e) { e1 = e.message }
  await c.query('rollback to savepoint s2')
  ok('2. UPDATE đè ten → bị chặn (danh mục đóng)', !!e1 && /CẤM sửa đè|đóng/.test(e1), e1) }

// ═══ 3 · UPDATE đè MA → bị chặn ═══
{ await c.query('savepoint s3'); let e2 = null
  try { await c.query(`update kho.loai_thuong_mai set ma='tu2' where ma='tu'`) } catch (e) { e2 = e.message }
  await c.query('rollback to savepoint s3')
  ok('3. UPDATE đè ma → bị chặn', !!e2 && /CẤM sửa đè|đóng/.test(e2), e2) }

// ═══ 4 · UPDATE cột KHÁC (dang_bat) → CHO PHÉP (không phải ma/ten) ═══
{ await c.query('savepoint s4'); let e3 = null
  try { await c.query(`update kho.loai_thuong_mai set dang_bat=false where ma='den'`) } catch (e) { e3 = e.message }
  await c.query('rollback to savepoint s4')
  ok('4. UPDATE cột khác (dang_bat) → cho phép', !e3, e3 || 'ok') }

// ═══ 5 · dong_loai 11/11, đúng map, mỗi dòng 1 loại (PK), loại tồn tại ═══
{ const r = await q(`select dong_ma, loai_ma from kho.dong_loai order by dong_ma`)
  const dungMap = r.length === 11 && r.every(x => MAP11[x.dong_ma] === x.loai_ma)
  const loaiOk = (await q(`select count(*)::int n from kho.dong_loai d where not exists(select 1 from kho.loai_thuong_mai t where t.ma=d.loai_ma)`))[0].n === 0
  ok('5. dong_loai 11/11 đúng map · mỗi dòng 1 loại (PK) · loại tồn tại', dungMap && loaiOk && r.length === 11, JSON.stringify(r.map(x => x.dong_ma + '→' + x.loai_ma))) }

// ═══ 6 · 4 loại hàng-săn (sofa·tham·chan_ga·den) KHÔNG có dòng nào trỏ tới — đúng mô hình ═══
{ const khongDong = await q(`select ma from kho.loai_thuong_mai t where not exists(select 1 from kho.dong_loai d where d.loai_ma=t.ma) order by ma`)
  const set = khongDong.map(x => x.ma).sort().join(',')
  ok('6. loại hàng-săn không có dòng: chan_ga·den·sofa·tham (đúng)', set === 'chan_ga,den,sofa,tham', set) }

// ═══ 7 · dòng LẠ (chưa có trong dong_loai) → không có loại (NULL), không vỡ ═══
{ await c.query('savepoint s7')
  // thêm 1 dong tạm chưa map
  await c.query(`insert into kho.dong_san_pham(ma_dong, ten, thu_tu) values('ZZ','Dòng lạ test',99) on conflict do nothing`)
  const co = (await q(`select loai_ma from kho.dong_loai where dong_ma='ZZ'`))
  ok('7. dòng lạ ZZ chưa map → 0 dòng trong dong_loai (suy loại = NULL, không auto-gán)', co.length === 0, JSON.stringify(co))
  await c.query('rollback to savepoint s7') }

await c.query('rollback')
console.log(`\n═══ test_loai: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
