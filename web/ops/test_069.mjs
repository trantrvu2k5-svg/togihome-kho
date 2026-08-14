// TEST CẮN — 069 · VIỆC 1 nút dẫn vào màn Nhập số (logic thuần, nguồn chung nut_nhap_so.js)
//   + VIỆC 2 ĐO hai lỗi cũ: A (app sale lưu 1 đơn có đá trạng thái đơn khác?) · B (đơn kẹt moi_len_don?).
//   KHÔNG sửa code app — chỉ ĐO. In ĐỦ HAI VẾ + TRƯỚC/SAU. Tx rollback. Chạy: cd web && node ops/test_069.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { nutNhapSo } from '../src/nut_nhap_so.js'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  tk_ban_hang: null, truong_nhom_thiet_ke: null }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const tt1 = async (ma) => (await c.query(`select trang_thai from kho.don_hang where ma_don=$1`, [ma])).rows[0]?.trang_thai
async function as(uid, s, a = []) {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint sp') } catch (_) {} }
  if (!e) await c.query('rollback to savepoint sp')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}

try {
  await c.query('begin')

  // ═══════════ VIỆC 1 · NÚT "Nhập số sản xuất" dẫn vào ĐÚNG đơn ═══════════
  console.log('\n══ VIỆC 1 · nút dẫn vào màn Nhập số (nguồn chung nut_nhap_so.js) ══')

  // #1 — nút dẫn ĐÚNG đơn, KHÔNG đơn cố định (thử 2 đơn khác nhau)
  const nA = nutNhapSo('moi_len_don', 'thiet_ke', 'DH-2026-0142')
  const nB = nutNhapSo('moi_len_don', 'thiet_ke', 'DH-2026-0199')
  ok('#1 nút đơn A → /?don=DH-2026-0142', !!nA && nA.href.includes('don=DH-2026-0142'), JSON.stringify(nA))
  ok('#1 nút đơn B → /?don=DH-2026-0199 (KHÁC A — vế "đơn cố định" = ĐỎ)', !!nB && nB.href.includes('don=DH-2026-0199') && nA.href !== nB.href)

  // #2 — đơn CHƯA CHỐT (còn báo giá) KHÔNG có nút; đã chốt thì có
  for (const t of ['bao_gia', 'bao_gia_treo', 'bao_gia_thua'])
    ok(`#2 đơn "${t}" (chưa chốt) → KHÔNG nút`, nutNhapSo(t, 'thiet_ke', 'X') === null)
  ok('đơn "moi_len_don" (đã chốt, chưa gửi) → nút "Gửi file sản xuất cho xưởng"', nutNhapSo('moi_len_don', 'thiet_ke', 'X')?.text === 'Gửi file sản xuất cho xưởng')
  ok('đơn "cho_cat" (đã đẩy) → nút đổi "Xem số đã nhập"', nutNhapSo('cho_cat', 'thiet_ke', 'X')?.text === 'Xem số đã nhập')
  ok('đơn "dang_lam" (đã đẩy) → "Xem số đã nhập"', nutNhapSo('dang_lam', 'thiet_ke', 'X')?.text === 'Xem số đã nhập')

  // #3 — chỉ thiet_ke + ceo thấy nút; vai khác KHÔNG; và gọi thẳng RPC màn vẫn bị chặn như cũ
  ok('#3 ceo THẤY nút', nutNhapSo('moi_len_don', 'ceo', 'X') !== null)
  ok('#3 thiet_ke THẤY nút', nutNhapSo('moi_len_don', 'thiet_ke', 'X') !== null)
  for (const v of ['tk_ban_hang', 'truong_nhom_thiet_ke', 'sale', 'tho', 'ke_toan'])
    ok(`#3 ${v} KHÔNG thấy nút`, nutNhapSo('moi_len_don', v, 'X') === null)
  console.log('   — gọi thẳng URL (RPC màn nhap_so_don_don_hang) vai không phải ceo/thiet_ke → CHẶN như cũ:')
  for (const v of ['sale', 'tho', 'ke_toan'])
    ok(`#3 server: ${v} gọi nhap_so_don_don_hang → CHẶN`, /chỉ ceo\/thiet_ke/.test((await as(U[v], `select kho.nhap_so_don_don_hang('CAN-A-DEMO')`)).e || ''), '(lọt!)')

  // ═══════════ VIỆC 2 · LỖI A — app sale lưu 1 đơn có đá trạng thái đơn KHÁC? ═══════════
  console.log('\n══ VIỆC 2 · LỖI A — lưu 1 đơn có đá trạng thái đơn khác không? ══')
  await c.query(`insert into kho.don_hang(ma_don,trang_thai) values ('T-LOIA-1','moi_len_don'),('T-LOIA-2','cho_cat'),('T-LOIA-3','cho_giao')`)
  console.log(`   TRƯỚC: T-LOIA-1=${await tt1('T-LOIA-1')} · T-LOIA-2=${await tt1('T-LOIA-2')} · T-LOIA-3=${await tt1('T-LOIA-3')}`)
  // Đường app sale lưu HIỆN TẠI: upsert onConflict ma_don CHỈ đơn được sửa (sale.js doiOrMoi) — ở đây T-LOIA-1.
  const luu1 = await asK(U.sale, `insert into kho.don_hang(ma_don,trang_thai) values('T-LOIA-1','moi_len_don')
                                   on conflict(ma_don) do update set trang_thai=excluded.trang_thai`)
  const A2 = await tt1('T-LOIA-2'), A3 = await tt1('T-LOIA-3')
  console.log(`   SAU khi sale lưu T-LOIA-1: T-LOIA-2=${A2} · T-LOIA-3=${A3}  (lưu: ${luu1.e ? '❌ ' + luu1.e : 'ok'})`)
  ok('LỖI A: lưu 1 đơn KHÔNG đổi trạng thái 2 đơn kia (🟥 đổi = lỗi còn)', A2 === 'cho_cat' && A3 === 'cho_giao', `A2=${A2} A3=${A3}`)
  // Lưới cuối (db/047): kể cả app lỡ gửi hạ SX→moi_len_don, DB CHẶN.
  const ha = await as(U.sale, `update kho.don_hang set trang_thai='moi_len_don' where ma_don='T-LOIA-2'`)
  ok('LỖI A (lưới cuối): sale hạ đơn cho_cat → moi_len_don bị TRIGGER chặn', ha.e != null && /đang sản xuất|Không được hạ/.test(ha.e), ha.e || '(LỌT — corruption có thể xảy ra!)')

  // ═══════════ VIỆC 2 · LỖI B — đơn có kẹt ở moi_len_don, không vào xưởng? ═══════════
  console.log('\n══ VIỆC 2 · LỖI B — đơn kẹt moi_len_don, không vào xưởng? ══')
  await c.query(`insert into kho.don_hang(ma_don,trang_thai) values('T-LOIB','bao_gia')`)
  const didB = (await c.query(`select id from kho.don_hang where ma_don='T-LOIB'`)).rows[0].id
  await c.query(`insert into kho.don_hang_mon(don_id,ten,gia,so_luong,trang_thai) values($1,'Món test',1500000,1,'cho_cat')`, [didB])
  console.log(`   TRƯỚC: T-LOIB=${await tt1('T-LOIB')}`)
  // (1) Lên đơn — đường sale dùng: bao_gia → moi_len_don
  const len = await asK(U.sale, `update kho.don_hang set trang_thai='moi_len_don' where ma_don='T-LOIB'`)
  const bTT1 = await tt1('T-LOIB')
  console.log(`   (1) lên đơn (sale): ${len.e ? '❌ ' + len.e : 'ok'} → ${bTT1}`)
  ok('LỖI B(1): sale lên đơn bao_gia → moi_len_don ĐƯỢC', bTT1 === 'moi_len_don', len.e || '')
  // (2) Vào xưởng — cửa hợp lệ: ceo dua_vao_chuyen → cho_cat
  const vao = await asK(U.ceo, `select kho.dua_vao_chuyen('T-LOIB')`)
  const bTT2 = await tt1('T-LOIB')
  console.log(`   (2) vào xưởng (ceo dua_vao_chuyen): ${vao.e ? '❌ ' + vao.e : 'ok'} → ${bTT2}`)
  console.log(`   SAU: T-LOIB=${bTT2}`)
  ok('LỖI B: đơn ĐI được moi_len_don → cho_cat (🟥 đứng ở moi_len_don = kẹt)', bTT2 === 'cho_cat', vao.e || `kẹt ở ${bTT2}`)

  // ═══════════ L-12 · KHOÁ THEO MÓN + BÀN GIAO 3 CHỐT (test 13-17) ═══════════
  const NS_TK = '38c5252b-6e59-4651-8edb-d1c38afed0b6'   // nguoi_dung.id của thiet_ke demo
  const FILE = `'[{"loai_file":"dxf","duong_dan":"x/a.dxf","ten_goc":"a.dxf","co_byte":10}]'::jsonb`
  const HD8 = ['cat', 'dan', 'cam', 'thung', 'cup', 'ray', 'canh', 'goi']
  const row1 = async (s, a = []) => (await c.query(s, a)).rows[0]

  // ═══ 13 · MÓN TỰ DO (sp_id=null) hiện ra + gán quy trình + nhập số được ═══
  console.log('\n══ 13 · món tự do DEMO-13 — hiện 2 món, gán + nhập số ══')
  const d13 = (await as(U.ceo, `select kho.nhap_so_don_don_hang('DEMO-13') d`)).r[0].d
  console.log(`   DEMO-13: so_mon=${d13.so_mon} ten_don="${d13.ten_don}" · món: ${d13.mon.map(m => m.ten + '(' + m.sp_id + ')').join(', ')}`)
  ok('#13 DEMO-13 (2 món tự do sp_id=null) → hiện ĐÚNG 2 món (🟥 vế cũ inner join = 0 món)', d13.so_mon === 2 && d13.mon.length === 2 && d13.mon.every(m => m.sp_id === null))
  ok('#13 tên đơn có nội dung (không rỗng)', typeof d13.ten_don === 'string' && d13.ten_don.length > 0)
  const mid13 = d13.mon[0].mon_id
  await asK(U.ceo, `select kho.gan_quy_trinh_mon($1,'TU-AO-MELAMINE')`, [mid13])
  const ct13 = (await as(U.ceo, `select kho.nhap_so_chi_tiet_mon($1) r`, [mid13])).r[0].r
  for (const b of ct13.buoc) if (b.loai_buoc !== 'tu_chay') await asK(U.ceo, `select kho.luu_so_don_vi($1,$2,'5','go_tay')`, [mid13, b.hoat_dong])
  const g13 = (await as(U.ceo, `select kho.gio_du_kien_cua_mon($1) g`, [mid13])).r[0].g
  ok('#13 món tự do gán quy trình + nhập số → ĐỦ (ok=true, có giờ)', g13.ok === true && Number(g13.tong_gio) > 0, JSON.stringify(g13).slice(0, 80))

  // ═══ 14 · MÓN CÓ LÕI → gợi ý quy trình từ lõi + đổi được ═══
  console.log('\n══ 14 · món có lõi gợi ý quy trình, đổi được ══')
  const midM = (await row1(`select id from kho.don_hang_mon where sp_id='CAN-A-TUAO-MASTER-BT' and don_id=(select id from kho.don_hang where ma_don='CAN-A-DEMO') limit 1`)).id
  const ct14 = (await as(U.ceo, `select kho.nhap_so_chi_tiet_mon($1) r`, [midM])).r[0].r
  ok('#14 món có lõi → gợi ý quy trình lõi (goi_y=TU-AO-MELAMINE, không chua_gan)', ct14.goi_y === 'TU-AO-MELAMINE' && ct14.chua_gan === false, JSON.stringify({ goi_y: ct14.goi_y, chua_gan: ct14.chua_gan }))
  await asK(U.ceo, `select kho.gan_quy_trinh_mon($1,'KE-HO-MELAMINE')`, [midM])
  const ct14b = (await as(U.ceo, `select kho.nhap_so_chi_tiet_mon($1) r`, [midM])).r[0].r
  ok('#14 ĐỔI được sang quy trình khác (ma_quy_trinh=KE-HO-MELAMINE, ghi đè gợi ý)', ct14b.ma_quy_trinh === 'KE-HO-MELAMINE', JSON.stringify({ ma: ct14b.ma_quy_trinh }))

  // ═══ 15 · BA CHỐT bàn giao, mỗi cái MÃ RIÊNG ═══
  console.log('\n══ 15 · ba chốt bàn giao — mỗi cái mã lỗi riêng ══')
  const dz = (await row1(`insert into kho.don_hang(ma_don,trang_thai) values('T-BG','dang_thiet_ke') returning id`)).id
  const mz = (await row1(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh) values($1,'Món BG','TU-AO-MELAMINE') returning id`, [dz])).id
  for (const hd of HD8) await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,nguon) values($1,$2,5,'go_tay')`, [mz, hd])
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values('T-BG',1,$1,'khach_duyet')`, [NS_TK])
  const e15a = await as(U.ceo, `select kho.ban_giao_xuong('T-BG','[]'::jsonb,null)`)   // đủ số+duyệt, KHÔNG file
  ok('#15 (a) thiếu file → THIEU_FILE_CAT', /THIEU_FILE_CAT/.test(e15a.e || ''), e15a.e || '(lọt!)')
  await c.query('savepoint b15'); await c.query(`delete from kho.ban_thiet_ke where ma_don='T-BG'`)
  const e15b = await as(U.ceo, `select kho.ban_giao_xuong('T-BG',${FILE},null)`)   // đủ số+file, CHƯA duyệt
  ok('#15 (b) chưa khách duyệt → CHUA_KHACH_DUYET', /CHUA_KHACH_DUYET/.test(e15b.e || ''), e15b.e || '(lọt!)')
  await c.query('rollback to savepoint b15')
  await c.query('savepoint c15'); await c.query(`delete from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat'`, [mz])
  const e15c = await as(U.ceo, `select kho.ban_giao_xuong('T-BG',${FILE},null)`)   // file+duyệt, THIẾU số
  ok('#15 (c) thiếu số → THIEU_SO_DON_VI', /THIEU_SO_DON_VI/.test(e15c.e || ''), e15c.e || '(lọt!)')
  await c.query('rollback to savepoint c15')
  ok('#15 ba mã lỗi RIÊNG BIỆT (không gộp một câu chung)', /THIEU_FILE_CAT/.test(e15a.e) && /CHUA_KHACH_DUYET/.test(e15b.e) && /THIEU_SO_DON_VI/.test(e15c.e))

  // ═══ 16 · ĐỦ 3 CHỐT → bàn giao thành công (cho_cat + lưu file) ═══
  console.log('\n══ 16 · đủ 3 chốt → bàn giao thành công ══')
  const t16a = (await row1(`select trang_thai from kho.don_hang where ma_don='T-BG'`)).trang_thai
  const f16a = Number((await row1(`select count(*) n from kho.file_san_xuat where ma_don='T-BG'`)).n)
  const bg16 = await asK(U.ceo, `select kho.ban_giao_xuong('T-BG',${FILE},'ok') r`)
  const t16b = (await row1(`select trang_thai from kho.don_hang where ma_don='T-BG'`)).trang_thai
  const f16b = Number((await row1(`select count(*) n from kho.file_san_xuat where ma_don='T-BG'`)).n)
  console.log(`   TRƯỚC=${t16a} file=${f16a} → SAU=${t16b} file=${f16b} · rpc=${bg16.e || JSON.stringify(bg16.r[0])}`)
  ok('#16 đủ 3 chốt → cho_cat + lưu file (🟥 vế thiếu chốt vẫn qua)', bg16.e === null && t16b === 'cho_cat' && t16a !== 'cho_cat' && f16b > f16a)

  // ═══ 17 · KHÔNG hai đường: chỉ ban_giao_xuong đẩy cho_cat từ thiết kế ═══
  console.log('\n══ 17 · một đường bàn giao (day_so_san_xuat đã gỡ) ══')
  const conDay = Number((await row1(`select count(*) n from pg_proc where proname='day_so_san_xuat'`)).n)
  ok('#17 day_so_san_xuat ĐÃ GỠ — chỉ còn ban_giao_xuong đẩy cho_cat từ thiết kế', conDay === 0, conDay + ' còn tồn tại (hai đường!)')

  console.log(`\n══ KẾT QUẢ 069: ${P} pass · ${F} fail ══`)
} catch (e) { console.error('LỖI TEST:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); F++ }
finally { await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0) }
