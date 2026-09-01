// TEST — WP-76 mục 3 (L-76c) · cac_toi_da_ky hai cột ngắn/dài hạn. Tx rollback, kỳ+đơn giả 2099 (không đụng dữ liệu thật).
//   Chèn đơn/gia_von bằng OWNER (không jwt) để trigger chốt bỏ qua; gọi RPC bằng vai ceo (jwt claims).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 220) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const call = async (ky, gom = false) => {
  await c.query('savepoint sp'); await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  const j = (await one(`select kho.cac_toi_da_ky($1,$2) j`, [ky, gom])).j
  await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`); await c.query('release savepoint sp')
  return j
}
const dai = (j, i) => j.dai[i]   // 0:<3tr 1:3-7 2:7-15 3:15-40 4:>40

await c.query('begin')
// tham số 3 kỳ giả. KY_A trống+bien · KY_B kín+bien · KY_C trống+bien NULL
const tstc = (ky, bien, cpnl, cao) => c.query(
  `insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke,n_cac,bien_muc_tieu,chi_phi_nang_luc,nguong_lap_day_cao)
   values($1,'ban_hang',10,0.03,0.01,0.01,1500000,$2,$3,$4)`, [ky, bien, cpnl, cao])
await tstc('2099-01', 0.15, null, 0.8)   // trống (cpnl null → mau suy 0 → ty_le null)
await tstc('2099-02', 0.15, 100000, 0.8) // kín (khoi_2 200k / cpnl 100k = 2.0 ≥ 0.8)
await tstc('2099-03', null, null, 0.8)   // bien NULL

const don = async (ma, ky, gc, k1, k2, k3, demo = false) => {
  await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai,gia_chot,ngay_giao,ship_thuc_tra,lap_thuc_tra,la_demo)
    values($1,'le','da_giao',$2,$3,0,0,$4)`, [ma, gc, ky + '-15', demo])
  await c.query(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao)
    values($1,$2,$3,$4,$5)`, [ma, k1, k2, k3, k1 + k2 + (k3 || 0)])
}
await don('T76C_A1', '2099-01', 2100000, 300000, 200000, 1050000)         // ca1 dải <3tr
await don('T76C_A3', '2099-01', 24000000, 5000000, 3000000, 2100000)      // ca3 dải 15-40tr
await don('T76C_A6', '2099-01', 5000000, 800000, 500000, 400000, true)    // ca6 demo, dải 3-7tr
await don('T76C_B1', '2099-02', 2100000, 300000, 200000, 1050000)         // ca2 kín
await don('T76C_C1', '2099-03', 24000000, 5000000, 3000000, 2100000)      // ca4 bien NULL

const jA = await call('2099-01')
const b0 = dai(jA, 0), b3 = dai(jA, 3), b4 = dai(jA, 4)

// ca1 — dải <3tr, trống → ngắn hạn DƯƠNG, dài hạn ÂM (hai cột KHÁC nhau)
ok('1. đơn 2,1tr k3 1,05tr TRỐNG → cac_ngan_han DƯƠNG · cac_dai_han ÂM (hai cột không trùng)',
   b0.cac_ngan_han > 0 && b0.cac_dai_han < 0, JSON.stringify({ngan:b0.cac_ngan_han, dai:b0.cac_dai_han, hoa_von:b0.cac_hoa_von, cot:jA.cot_dang_sang}))

// ca3 — dải 15-40tr, trống → cả hai dương, dài < ngắn
ok('3. đơn 24tr k3 2,1tr → cả hai cột DƯƠNG · cac_dai_han < cac_ngan_han',
   b3.cac_ngan_han > 0 && b3.cac_dai_han > 0 && b3.cac_dai_han < b3.cac_ngan_han, JSON.stringify({ngan:b3.cac_ngan_han, dai:b3.cac_dai_han}))

// ca5 — dải >40tr rỗng → chua_co_don=true, số NULL (không 0)
ok('5. dải >40tr rỗng → chua_co_don=true · cac_hoa_von NULL (không 0)',
   b4.chua_co_don === true && b4.cac_hoa_von === null && b4.so_don === 0, JSON.stringify(b4))

// ca6 — demo bị loại khi gom=false; đếm được khi gom=true (dải 3-7tr)
const jA_demo = await call('2099-01', true)
ok('6. demo loại khi p_gom_demo=false (dải 3-7tr=0) · đếm khi =true (=1)',
   dai(jA,1).so_don === 0 && dai(jA_demo,1).so_don === 1, JSON.stringify({khong:dai(jA,1).so_don, gom:dai(jA_demo,1).so_don}))

// ca2 — cùng đơn, KÍN → cac_ngan_han giảm/NULL + thieu_chi_phi_co_hoi
const jB = await call('2099-02'); const b0B = dai(jB, 0)
ok('2. cùng đơn KÍN → thieu_chi_phi_co_hoi=true · cac_ngan_han NULL · cot_dang_sang=ngan_han',
   b0B.thieu_chi_phi_co_hoi === true && b0B.cac_ngan_han === null && jB.cot_dang_sang === 'ngan_han' && jB.nang_luc_kin === true, JSON.stringify({ngan:b0B.cac_ngan_han, kin:jB.nang_luc_kin, tyle:jB.ty_le_lap_day, cot:jB.cot_dang_sang}))

// ca4 — bien NULL → cac_dai_han NULL + thieu_bien, cac_hoa_von vẫn có số
const jC = await call('2099-03'); const b3C = dai(jC, 3)
ok('4. bien_muc_tieu NULL → cac_dai_han NULL + thieu_bien=true · cac_hoa_von VẪN có số',
   b3C.cac_dai_han === null && b3C.thieu_bien === true && b3C.cac_hoa_von !== null && b3C.cac_hoa_von > 0, JSON.stringify(b3C))

await c.query('rollback')
const con = await one(`select count(*)::int n from kho.don_hang where ma_don like 'T76C_%'`)
const kcon = await one(`select count(*)::int n from kho.tham_so_tai_chinh where ma_ky like '2099-%'`)
console.log(`\nrollback xong · đơn test còn: ${con.n} · kỳ test còn: ${kcon.n} (phải 0/0)`)
console.log(`═══ test_wp76c: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
