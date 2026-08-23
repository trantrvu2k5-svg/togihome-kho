// TEST PHẢI CẮN — gia_ncc + goi_y_gia + hạn TT theo NCC + trigger dvt (WP-23/db/137). Tx rollback. auth_uid test_*.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const q = async (s, a = []) => (await c.query(s, a)).rows
let U = {}, NHOM_VAN, NHOM_PK, KHO, LOAI
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function mkVT(ma, dvt, base, o = {}) {
  const id = (await one(`insert into kho.vat_tu(ma,ten,loai,don_vi_co_so,dvt,ngung_dung,nhom_id,gia_tham_khao) values($1,$1,$2,$3,$4,false,$5,$6) returning id`,
    [ma, LOAI, base, dvt, o.van ? NHOM_VAN : NHOM_PK, o.gia_tk ?? null])).id
  if (o.m2) await c.query(`insert into kho.vat_tu_don_vi(vat_tu_id,don_vi,he_so) values($1,'m2',$2)`, [id, o.m2])
  return id
}
const mkNCC = async (ten, han) => (await one(`insert into kho.nha_cung_cap(ten,han_thanh_toan_ngay) values($1,$2) returning id`, [ten, han])).id
async function mkDonNhan(ncc, vt, sl, dg) {
  const r = await as(U.ceo, `select kho.dm_tao($1,$2,null,'wp23',$3::jsonb,false) g`, [ncc, KHO, JSON.stringify([{ vat_tu_id: vt, so_luong: sl, don_gia: dg }])], true)
  if (r.e) throw new Error('dm_tao: ' + r.e)
  const don = r.r[0].g.id, dong = (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [don])).id
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_gui')`, [don], true)
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'xac_nhan')`, [don], true)
  await as(U.ceo, `select kho.dm_nhan_hang($1,$2::jsonb)`, [don, JSON.stringify([{ dong_id: dong, so_luong: sl }])], true)
  return { don, dong }
}
try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  NHOM_VAN = (await one(`select nhom_id from kho.vat_tu where kho.la_nhom_van(nhom_id) limit 1`)).nhom_id
  NHOM_PK = (await one(`select nhom_id from kho.vat_tu where not kho.la_nhom_van(nhom_id) limit 1`)).nhom_id
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  LOAI = (await one(`select loai from kho.vat_tu where loai is not null limit 1`)).loai
  const A = await mkNCC('WP23 NCC-A (hạn 45)', 45), B = await mkNCC('WP23 NCC-B (mặc định)', 30)
  const X = await mkVT('WP23-X', 'tấm', 'tam', { van: true, m2: 0.336 })

  console.log('── a · giá NCC A cho ván X → goi_y đúng giá+lead, nguon=bang_gia_ncc ──')
  { const r = await as(U.kho, `select kho.gia_ncc_ghi($1,$2,'m2',500000,7,'giá đợt 1') g`, [A, X], true)
    ok('a gia_ncc_ghi OK', !r.e, r.e)
    const g = (await as(U.kho, `select kho.goi_y_gia_dong_mua($1,$2) g`, [A, X])).r[0].g
    ok('a goi_y: 500.000 · m2 · lead 7 · bang_gia_ncc', g.co && Number(g.don_gia) === 500000 && g.don_vi === 'm2' && Number(g.lead_time_ngay) === 7 && g.nguon === 'bang_gia_ncc', JSON.stringify(g)) }

  console.log('\n── b · vật tư chưa có bảng giá → fallback tham_khao ──')
  { const Y = await mkVT('WP23-Y', 'tấm', 'tam', { van: true, gia_tk: 123456 })
    const g = (await as(U.kho, `select kho.goi_y_gia_dong_mua($1,$2) g`, [A, Y])).r[0].g
    ok('b fallback: 123.456 · tam · nguon tham_khao · lead null', g.co && Number(g.don_gia) === 123456 && g.don_vi === 'tam' && g.nguon === 'tham_khao' && g.lead_time_ngay === null, JSON.stringify(g)) }

  console.log('\n── c · gia_ncc don_vi lạ → RAISE ──')
  { const r = await as(U.kho, `select kho.gia_ncc_ghi($1,$2,'donvila',100,null,null)`, [A, X])
    ok('c don_vi lạ → RAISE (QD-53)', /không hợp lệ|QD-53|đơn vị/.test(r.e || ''), r.e) }

  console.log('\n── d · don_mua_dong dvt lạ → RAISE; dvt trong vat_tu_don_vi → qua ──')
  { const don = (await one(`insert into kho.don_mua(so_don,ncc_id,kho_id,ngay_can,trang_thai) values('WP23-DM-D',$1,$2,current_date,'moi') returning id`, [A, KHO])).id
    const eLa = await (async () => { await c.query('savepoint d'); try { await c.query(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt) values($1,1,$2,5,'donvila')`, [don, X]); await c.query('release savepoint d'); return null } catch (e) { await c.query('rollback to savepoint d'); return e.message } })()
    ok('d dvt lạ "donvila" → RAISE', /không hợp lệ|QD-53|đơn vị/.test(eLa || ''), eLa)
    const eOk = await (async () => { await c.query('savepoint d2'); try { await c.query(`insert into kho.don_mua_dong(don_mua_id,stt,vat_tu_id,so_luong,dvt) values($1,2,$2,5,'m2')`, [don, X]); await c.query('release savepoint d2'); return null } catch (e) { await c.query('rollback to savepoint d2'); return e.message } })()
    ok('d dvt "m2" (∈ vat_tu_don_vi) → qua', eOk === null, eOk) }

  console.log('\n── e · HĐ NCC: hạn TT = ngày HĐ + hạn của NCC (A=45, B=30) ──')
  { const dA = await mkDonNhan(A, X, 5, 100000)
    const rA = await as(U.ceo, `select kho.hd_ncc_ghi($1,'HD-WP23-A','hoa_don_vat',current_date,null,10,'x',$2::jsonb) g`, [dA.don, JSON.stringify([{ don_mua_dong_id: dA.dong, so_luong: 5, don_gia_hd: 100000 }])], true)
    const hA = await one(`select ngay_hd, han_thanh_toan, han_thanh_toan - ngay_hd songay from kho.hoa_don_ncc where don_mua_id=$1`, [dA.don])
    ok('e NCC A (hạn 45) → han_thanh_toan = ngày HĐ + 45', !rA.e && Number(hA.songay) === 45, JSON.stringify(hA) + (rA.e ? ' ERR ' + rA.e : ''))
    const dB = await mkDonNhan(B, X, 5, 100000)
    await as(U.ceo, `select kho.hd_ncc_ghi($1,'HD-WP23-B','hoa_don_vat',current_date,null,10,'x',$2::jsonb)`, [dB.don, JSON.stringify([{ don_mua_dong_id: dB.dong, so_luong: 5, don_gia_hd: 100000 }])], true)
    const hB = await one(`select han_thanh_toan - ngay_hd songay from kho.hoa_don_ncc where don_mua_id=$1`, [dB.don])
    ok('e NCC B (mặc định) → + 30', Number(hB.songay) === 30, JSON.stringify(hB)) }

  console.log('\n── f · vat_tu_thieu_lead_time: ván chưa lead xuất hiện; thêm lead → biến mất ──')
  { const Z = await mkVT('WP23-Z', 'tấm', 'tam', { van: true })
    const ds1 = (await as(U.kho, `select kho.vat_tu_thieu_lead_time() g`)).r[0].g
    ok('f trước: ván Z trong danh sách thiếu lead', ds1.some(x => x.vat_tu_id === Z), 'n=' + ds1.length)
    await as(U.kho, `select kho.gia_ncc_ghi($1,$2,'tam',10000,5,null)`, [A, Z], true)
    const ds2 = (await as(U.kho, `select kho.vat_tu_thieu_lead_time() g`)).r[0].g
    ok('f sau khi thêm lead 5: Z biến mất', !ds2.some(x => x.vat_tu_id === Z), 'n=' + ds2.length) }

  console.log('\n── g · dm_tao / dm_sua_dong nhận don_vi per dòng (nới L-81) ──')
  { // g-a: dm_tao dòng don_vi='m2' (∈ vat_tu_don_vi X) → ghi đúng 'm2'
    const r = await as(U.ceo, `select kho.dm_tao($1,$2,null,'g',$3::jsonb,false) g`, [A, KHO, JSON.stringify([{ vat_tu_id: X, so_luong: 5, don_gia: 100, don_vi: 'm2' }])], true)
    const dv = r.e ? null : (await one(`select dvt from kho.don_mua_dong where don_mua_id=$1`, [r.r[0].g.id])).dvt
    ok('g-a dm_tao don_vi=m2 → dòng ghi "m2"', !r.e && dv === 'm2', r.e || dv)
    // g-b: dm_tao dòng don_vi lạ → RAISE
    const rb = await as(U.ceo, `select kho.dm_tao($1,$2,null,'gb',$3::jsonb,false)`, [A, KHO, JSON.stringify([{ vat_tu_id: X, so_luong: 5, don_gia: 100, don_vi: 'xyzla' }])])
    ok('g-b dm_tao don_vi lạ → RAISE (đơn vị)', /đơn vị|không hợp lệ/.test(rb.e || ''), rb.e)
    // g-c: không truyền don_vi → mặc định vat_tu.dvt ('tấm')
    const rc = await as(U.ceo, `select kho.dm_tao($1,$2,null,'gc',$3::jsonb,false) g`, [A, KHO, JSON.stringify([{ vat_tu_id: X, so_luong: 5, don_gia: 100 }])], true)
    const dvc = rc.e ? null : (await one(`select dvt from kho.don_mua_dong where don_mua_id=$1`, [rc.r[0].g.id])).dvt
    ok('g-c không don_vi → mặc định vat_tu.dvt ("tấm")', !rc.e && dvc === 'tấm', rc.e || dvc)
    // g-d: dm_sua_dong đổi don_vi hợp lệ → ghi; lạ → RAISE (dùng đơn g-c)
    const don = rc.r[0].g.id
    const rd1 = await as(U.ceo, `select kho.dm_sua_dong($1,$2::jsonb)`, [don, JSON.stringify([{ vat_tu_id: X, so_luong: 5, don_gia: 100, don_vi: 'tam' }])], true)
    const dvd = (await one(`select dvt from kho.don_mua_dong where don_mua_id=$1`, [don])).dvt
    ok('g-d dm_sua_dong don_vi=tam (hợp lệ) → ghi "tam"', !rd1.e && dvd === 'tam', rd1.e || dvd)
    const rd2 = await as(U.ceo, `select kho.dm_sua_dong($1,$2::jsonb)`, [don, JSON.stringify([{ vat_tu_id: X, so_luong: 5, don_gia: 100, don_vi: 'xyzla' }])])
    ok('g-d dm_sua_dong don_vi lạ → RAISE', /đơn vị|không hợp lệ/.test(rd2.e || ''), rd2.e) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_gia_ncc: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message, (e.stack || '').split('\n')[1] || ''); F++ }
finally { try { await c.query('rollback') } catch (_) {} await c.end(); process.exit(F ? 1 : 0) }
