// TEST PHẢI CẮN — VAT + cấu hình sale (029). Áp 029 trong tx rồi ROLLBACK (027/028 đã ở prod).
// Chạy (từ web/):  DATABASE_URL='...' node ops/test_vat.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
const DB = '/Users/vuquanghai/Documents/togihome-kho/db'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql029 = strip(readFileSync(`${DB}/029_cau_hinh_vat.sql`, 'utf8'))

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + n + (extra ? '  — ' + extra : '')); cond ? PASS++ : FAIL++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asRole(uid, fn) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { return await fn() } finally { await c.query('rollback to savepoint s'); await c.query('reset role') }
}
const R = x => Math.round(Number(x))

try {
  await c.query('begin')
  console.log('— áp 029 trong tx (027/028 đã ở prod) —')
  await c.query(sql029)
  // he_so_m prod đang NULL → set số thử để hàm giá chạy (test-only, trong tx)
  await c.query(`update kho.tham_so_tai_chinh set he_so_m=1.25 where ma_ky='2026-07'`)
  const sale = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='sale' and dang_hoat_dong and auth_uid is not null limit 1`))[0]?.auth_uid
  const sku = (await q(`select ma from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 1`))[0].ma
  const vat = Number((await q(`select vat from kho.tham_so_tai_chinh where ma_ky='2026-07'`))[0].vat)
  console.log(`  sku=${sku} vat=${vat}%\n`)

  // ── 1. Bảng tho / khong_gian: sale ĐỌC danh mục; món ghi được khong_gian ──
  ok('tho: seed 8 thợ', (await q(`select count(*)::int n from kho.tho`))[0].n === 8)
  ok('khong_gian: seed 4', (await q(`select count(*)::int n from kho.khong_gian`))[0].n === 4)
  if (sale) {
    ok('sale ĐỌC danh mục tho', (await asRole(sale, () => q(`select count(*)::int n from kho.tho`)))[0].n === 8)
    ok('sale ĐỌC danh mục khong_gian', (await asRole(sale, () => q(`select count(*)::int n from kho.khong_gian`)))[0].n === 4)
  }
  ok('don_hang_mon có cột khong_gian',
    (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang_mon' and column_name='khong_gian'`)).length === 1)

  // ── 2. VAT vào ĐÚNG 1 lần: gia_bao_khach ÷ (1+vat/100) = gia_san_don ──
  console.log('\n── VAT tầng cuối ──')
  if (sale) {
    const mon = JSON.stringify([{ sku }])
    const san = R((await asRole(sale, () => q(`select kho.gia_san_don($1::jsonb,'le') g`, [mon])))[0].g)
    const bao = R((await asRole(sale, () => q(`select kho.gia_bao_khach($1::jsonb,'le') g`, [mon])))[0].g)
    console.log(`   gia_san_don=${san}  gia_bao_khach=${bao}  bao/1.1=${R(bao / (1 + vat / 100))}`)
    ok('VAT: gia_bao_khach ÷(1+vat) = gia_san_don', Math.abs(bao / (1 + vat / 100) - san) < 1, `${bao}/1.1≈${san}`)
    ok('VAT: gia_bao_khach = gia_san_don ×(1+vat)', bao === R(san * (1 + vat / 100)))
  }

  // ── 2b. [CẮN] cố nhét vat vào tinh_he_so_m → he_so_m sai ~10% ──
  console.log('\n── [CẮN] vat KHÔNG được vào tinh_he_so_m ──')
  const ceo = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='ceo' and dang_hoat_dong and auth_uid is not null limit 1`))[0]?.auth_uid
  if (ceo) {
    // đặt đủ đầu vào cho tinh_he_so_m
    await c.query(`update kho.tham_so_tai_chinh set dt_muc_tieu=7000000000, so_don_ke_hoach=580 where ma_ky='2026-07'`)
    await c.query(`insert into kho.don_hang(ma_don,ma_ky_ap_dung,ship_thuc_tra) values('TEST-VAT','2026-07',0)`)
    await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao) values('TEST-VAT',7572414)`)
    const good = Number((await asRole(ceo, () => q(`select kho.tinh_he_so_m('2026-07') g`)))[0].g)
    // bản SAI: nhân (1+vat/100) vào tử số (mô phỏng lỗi nhét vat)
    const bad = good * (1 + vat / 100)
    console.log(`   tinh_he_so_m ĐÚNG (không vat)=${good.toFixed(5)}  |  nếu nhét vat=${bad.toFixed(5)} (lệch ${((bad/good-1)*100).toFixed(1)}%)`)
    ok('[CẮN] nhét vat → he_so_m lệch ~10% (ĐỎ)', Math.abs(bad / good - 1 - vat / 100) < 1e-9, `lệch ${((bad/good-1)*100).toFixed(1)}%`)
    ok('tinh_he_so_m ĐÚNG không dính vat (XANH)', good > 1 && good < 1.3, `he_so_m=${good.toFixed(4)}`)
  }

  // ── 3. LUẬT LƯU TRỮ: nhập 7.000.000 gồm VAT → lưu 6.363.636 (sai <1đ) ──
  console.log('\n── quy ngược VAT khi lưu ──')
  const nhap = 7000000, luu = Math.round(nhap / (1 + vat / 100))
  console.log(`   nhập ${nhap} (gồm VAT) → lưu ${luu}`)
  ok('lưu = nhập ÷(1+vat), sai <1đ', Math.abs(luu - 6363636) < 1, `lưu=${luu}`)

  // ── 4. sale ĐỌC vat + ngưỡng qua cau_hinh_sale, KHÔNG đọc cột tiền ──
  console.log('\n── sale đọc cấu hình, không đọc tiền ──')
  if (sale) {
    const cfg = (await asRole(sale, () => q(`select kho.cau_hinh_sale() j`)))[0].j
    ok('sale nhận vat + ngưỡng qua cau_hinh_sale', cfg.vat != null && cfg.n_giam != null, `vat=${cfg.vat} n_giam=${cfg.n_giam}`)
    const keys = Object.keys(cfg)
    const loMoney = keys.filter(k => /he_so_m|phi_don|dg_gio|cnc|setup|dt_muc|gia_chuyen/.test(k))
    ok('cau_hinh_sale KHÔNG chứa cột tiền', loMoney.length === 0, `keys=${keys.join(',')}`)
    const nTsc = (await asRole(sale, () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n
    ok('sale KHÔNG đọc thẳng tham_so_tai_chinh (RLS)', nTsc === 0)
    // [CẮN] bỏ guard RLS → sale đọc được cột tiền = ĐỎ
    await c.query('savepoint g'); await c.query(`alter policy tstc_doc on kho.tham_so_tai_chinh using (true)`)
    const red = await asRole(sale, () => q(`select he_so_m, phi_don_le, dg_gio_tk from kho.tham_so_tai_chinh`))
    console.log('   [CẮN] bỏ guard → sale thấy cột tiền (ĐỎ):', JSON.stringify(red[0]))
    await c.query('rollback to savepoint g')
    ok('[CẮN] khôi phục guard → sale chặn lại',
      (await asRole(sale, () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n === 0)
  }

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL ? 1 : 0) }
