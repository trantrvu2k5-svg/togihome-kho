// TEST 1 (viết lại, tầng DB) — cấu hình đổi ở DB có "sống qua reload" không.
//   Ghi vat 10→8, nGiam 8→6 bằng quyền ceo (SQL trực tiếp). Mở KẾT NỐI MỚI đọc qua cau_hinh_sale → phải 8/6 (XANH).
//   Bản CŨ đọc hằng KEYLESS trong bundle (VAT_MAC_DINH / NGUONG0.nGiam) → vẫn 10/8, KHÔNG thấy đổi (ĐỎ).
//   Trả cấu hình về cũ sau khi test. Chạy (từ web/): DATABASE_URL='...' node ops/test_reload_cfg.mjs
import pg from 'pg'
import { execSync } from 'child_process'

const cs = () => new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
const TAG = 'v-kho-22-duong-gia'   // bản CŨ (trước lô 029)

// Hằng cấu hình trong BUNDLE CŨ (KEYLESS -> mem default), đọc thẳng từ source đã commit.
function oldConst() {
  const html = execSync(`git show ${TAG}:web/public/togihome_sale.html`, { cwd: '/Users/vuquanghai/Documents/togihome-kho', maxBuffer: 1 << 26 }).toString()
  const vat = Number((html.match(/const VAT_MAC_DINH = (\d+)/) || [])[1])
  const nGiam = Number((html.match(/const NGUONG0 = \{[^}]*nGiam:\s*(\d+)/s) || [])[1])
  return { vat, nGiam }
}

let PASS = 0, FAIL = 0
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); c ? PASS++ : FAIL++ }

const c = cs(); await c.connect()
let old
try {
  // 0. lưu giá trị cũ để trả về
  old = (await c.query(`select vat, n_giam from kho.tham_so_tai_chinh where ma_ky='2026-07'`)).rows[0]
  console.log(`cấu hình hiện tại: vat=${old.vat} nGiam=${old.n_giam}`)

  // 1. GHI bằng quyền ceo (SQL trực tiếp, superuser bypass RLS): vat 10->8, nGiam 8->6
  await c.query(`update kho.tham_so_tai_chinh set vat=8, n_giam=6 where ma_ky='2026-07'`)
  console.log('→ đã ghi vat=8, nGiam=6 vào tham_so_tai_chinh\n')

  // 2. BẢN MỚI: mở KẾT NỐI MỚI, đọc qua cau_hinh_sale -> phải thấy 8/6
  const c2 = cs(); await c2.connect()
  const cfg = (await c2.query(`select kho.cau_hinh_sale() j`)).rows[0].j
  await c2.end()
  console.log(`BẢN MỚI (cau_hinh_sale, kết nối mới): vat=${cfg.vat} nGiam=${cfg.n_giam}`)
  ok('MỚI thấy thay đổi (8 và 6) — XANH', Number(cfg.vat) === 8 && Number(cfg.n_giam) === 6)

  // 3. BẢN CŨ: hằng KEYLESS trong bundle -> vẫn 10/8, KHÔNG thấy đổi
  const oc = oldConst()
  console.log(`BẢN CŨ (hằng bundle ${TAG}): vat=${oc.vat} nGiam=${oc.nGiam}`)
  ok('CŨ KHÔNG thấy thay đổi (vẫn 10 và 8) — ĐỎ', oc.vat === 10 && oc.nGiam === 8,
    'DB đã 8/6 nhưng bundle cũ vẫn phục vụ 10/8')

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally {
  if (old) { await c.query(`update kho.tham_so_tai_chinh set vat=$1, n_giam=$2 where ma_ky='2026-07'`, [old.vat, old.n_giam])
    console.log(`↩ đã trả cấu hình về cũ: vat=${old.vat} nGiam=${old.n_giam}`) }
  await c.end(); process.exit(FAIL ? 1 : 0)
}
