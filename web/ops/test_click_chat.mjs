// TEST — WP-79 L-79b (db/183): sổ click_chat + RPC ghi_click_chat. Owner tx → ROLLBACK (sổ thật còn 0 dòng).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 180) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const ghi = (ref, kenh = 'zalo', ua = null) => c.query(`select kho.ghi_click_chat($1,$2,$3,$4,$5) id`, [ref, kenh, 'https://m.me/x', 'https://togihome.vn/sp', ua])
const rowOf = id => one(`select kenh, ref_web, loai_ma, ma_ny, ref_hop_le, la_bot, stt from kho.click_chat where id=$1`, [id])

await c.query('begin')

// 1 · ref ĐÚNG → hợp lệ, tách loai/ma_ny đúng
{ const id = (await ghi('web-tu-MUL-TU--26-001')).rows[0].id
  const r = await rowOf(id)
  ok('1. ref web-tu-MUL-TU--26-001 → hợp lệ · loai_ma=tu · ma_ny=MUL-TU--26-001', r.ref_hop_le === true && r.loai_ma === 'tu' && r.ma_ny === 'MUL-TU--26-001', JSON.stringify(r)) }

// 2 · ref RÁC "abc" → VẪN ghi, cờ false, loai_ma NULL
{ const id = (await ghi('abc')).rows[0].id
  const r = await rowOf(id)
  ok('2. ref rác "abc" → VẪN ghi · ref_hop_le=false · loai_ma NULL', !!id && r.ref_hop_le === false && r.loai_ma === null && r.ref_web === 'abc', JSON.stringify(r)) }

// 3 · loại LẠ (không có trong loai_thuong_mai) → ghi, cờ false
{ const id = (await ghi('web-xyz-ABC')).rows[0].id
  const r = await rowOf(id)
  ok('3. web-xyz-ABC (loại lạ) → ghi · ref_hop_le=false · loai_ma NULL', !!id && r.ref_hop_le === false && r.loai_ma === null, JSON.stringify(r)) }

// 4 · UPDATE sổ (đường owner) → TỪ CHỐI (trigger)
{ const id = (await ghi('web-sofa-SF-01')).rows[0].id
  await c.query('savepoint s4'); let err = null
  try { await c.query(`update kho.click_chat set dich='x' where id=$1`, [id]) } catch (e) { err = e.message }
  await c.query('rollback to savepoint s4')
  ok('4. UPDATE sổ (owner) → TỪ CHỐI', !!err && /APPEND-ONLY|CẤM/.test(err), err) }

// 5 · DELETE → TỪ CHỐI
{ const id = (await ghi('web-sofa-SF-02')).rows[0].id
  await c.query('savepoint s5'); let err = null
  try { await c.query(`delete from kho.click_chat where id=$1`, [id]) } catch (e) { err = e.message }
  await c.query('rollback to savepoint s5')
  ok('5. DELETE sổ → TỪ CHỐI', !!err && /APPEND-ONLY|CẤM/.test(err), err) }

// 6 · hai dòng CÙNG transaction → phân biệt dòng cuối bằng STT (không now() — bị đóng băng trong tx)
{ const id1 = (await ghi('web-tu-A')).rows[0].id
  const id2 = (await ghi('web-tu-B')).rows[0].id
  const a = await rowOf(id1), b = await rowOf(id2)
  const gio = await one(`select (select ghi_nhan_luc from kho.click_chat where id=$1) = (select ghi_nhan_luc from kho.click_chat where id=$2) bang`, [id1, id2])
  ok('6. hai dòng cùng tx → stt KHÁC nhau (dòng cuối = stt lớn hơn) · ghi_nhan_luc BẰNG nhau (now đóng băng)', Number(b.stt) > Number(a.stt) && gio.bang === true, JSON.stringify({ stt1: a.stt, stt2: b.stt, gioBang: gio.bang })) }

// 7 · UA facebookexternalhit → la_bot=true
{ const id = (await ghi('web-tu-C', 'messenger', 'facebookexternalhit/1.1')).rows[0].id
  const r = await rowOf(id)
  ok('7. UA facebookexternalhit → la_bot=true', r.la_bot === true, JSON.stringify({ la_bot: r.la_bot })) }

// 8 · kenh='tiktok' → RAISE
{ await c.query('savepoint s8'); let err = null
  try { await ghi('web-tu-D', 'tiktok') } catch (e) { err = e.message }
  await c.query('rollback to savepoint s8')
  ok('8. kenh="tiktok" → RAISE', !!err && /kenh không hợp lệ/.test(err), err) }

// ── L-79e (db/184): nới đường dẫn + id_web. ghi6/ghi7 gọi bản 7 tham số; dd/idw = duong_dan/id_web trong sổ. ──
const ghi6 = (ref, dd) => c.query(`select kho.ghi_click_chat($1,'zalo','https://zalo.me/x',null,null,$2) id`, [ref, dd])
const ghi7 = (ref, dd, idw) => c.query(`select kho.ghi_click_chat($1,'zalo','https://zalo.me/x',null,null,$2,$3) id`, [ref, dd, idw])
const ddOf = id => one(`select duong_dan, id_web from kho.click_chat where id=$1`, [id])

// 9 · gọi 5 tham số NHƯ CŨ (Worker đang chạy) → chạy được, duong_dan/id_web NULL
{ const id = (await ghi('web-tu-X')).rows[0].id
  const r = await ddOf(id)
  ok('9. gọi 5 tham số (Worker cũ) → chạy · duong_dan NULL · id_web NULL', !!id && r.duong_dan === null && r.id_web === null, JSON.stringify(r)) }

// 10 · đường dẫn kết thúc .27 → id_web = 27
{ const dd = '/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27'
  const id = (await ghi6('web-tu-Y', dd)).rows[0].id
  const r = await ddOf(id)
  ok('10. đường dẫn …thanh-lich.27 → id_web=27 · duong_dan lưu THÔ', r.id_web === 27 && r.duong_dan === dd, JSON.stringify(r)) }

// 11 · trang chủ "/" → id_web NULL, vẫn ghi
{ const id = (await ghi6('web-tu-Z', '/')).rows[0].id
  const r = await ddOf(id)
  ok('11. đường dẫn "/" → id_web NULL · vẫn ghi', !!id && r.id_web === null && r.duong_dan === '/', JSON.stringify(r)) }

// 12 · số ở GIỮA không ở cuối → KHÔNG bắt nhầm, id_web NULL
{ const dd = '/san-pham/sofa-sb19-phong-cach-toi-gian'
  const id = (await ghi6('web-tu-W', dd)).rows[0].id
  const r = await ddOf(id)
  ok('12. số ở giữa (…sb19…) không ở cuối → id_web NULL', r.id_web === null, JSON.stringify(r)) }

// 13 · p_id_web truyền thẳng 99 + đường dẫn .27 → THAM SỐ THẮNG, id_web=99
{ const id = (await ghi7('web-tu-V', '/san-pham/abc.27', 99)).rows[0].id
  const r = await ddOf(id)
  ok('13. p_id_web=99 + đường dẫn .27 → tham số thắng, id_web=99', r.id_web === 99, JSON.stringify(r)) }

// 14 · catalog chỉ còn 1 hàm ghi_click_chat (không overload — bài học vụ atp)
{ const n = await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='kho' and p.proname='ghi_click_chat'`)
  ok('14. catalog CHỈ 1 hàm ghi_click_chat (không overload)', n.n === 1, JSON.stringify(n)) }

await c.query('rollback')
const con = await one(`select count(*)::int n from kho.click_chat`)
console.log(`\nDọn: click_chat còn = ${con.n} (đã rollback — chỉ còn dòng CÓ SẴN, test KHÔNG sinh thêm)`)
console.log(`═══ test_click_chat: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
