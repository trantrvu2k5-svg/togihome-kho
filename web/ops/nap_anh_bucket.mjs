// Nạp tên file ảnh bucket kho-images vào cột kho.vat_tu.anh_file.
//   - CHỈ ĐỌC bucket (SELECT storage.objects). KHÔNG tải lên/xoá/đổi tên file nào.
//   - CHỈ ghi cột anh_file. KHÔNG đụng anh_ma hay cột khác.
//   - Idempotent: UPDATE theo mã, chạy lại nhiều lần cho kết quả y hệt, không nhân dữ liệu.
// Tách mã = phần trước dấu gạch dưới CUỐI CÙNG (khuôn kho/<MÃ>_<epoch>.jpg). Mã nhiều ảnh -> chọn epoch LỚN NHẤT.
// Chạy: cd web && DB_HOST=... DB_USER=... DB_PASS=... node ops/nap_anh_bucket.mjs
import pg from 'pg'
import { docConfig } from './conn.mjs'

const c = new pg.Client(await docConfig())
await c.connect()
try {
  // 1) đọc mọi file kho/ trong bucket
  const files = (await c.query(
    `select name from storage.objects where bucket_id='kho-images' and name like 'kho/%'`)).rows.map(r => r.name)

  // 2) tách mã + epoch; gom theo mã, giữ file có epoch LỚN NHẤT
  const chon = new Map()          // ma -> { name, ts }
  const saiKhuon = []
  for (const name of files) {
    const m = name.match(/^kho\/(.*)_(\d+)\.jpg$/i)   // group1 = mã (giữ cả '_' '-'), group2 = epoch
    if (!m) { saiKhuon.push(name); continue }
    const ma = m[1], ts = Number(m[2])
    const cu = chon.get(ma)
    if (!cu || ts > cu.ts) chon.set(ma, { name, ts })
  }

  // 3) tập mã vat_tu
  const vtSet = new Set((await c.query('select ma from kho.vat_tu')).rows.map(r => r.ma))

  // 4) UPDATE cột anh_file cho mã KHỚP (idempotent, chỉ theo mã)
  const khong_khop = []
  let dien = 0
  await c.query('begin')
  for (const [ma, { name }] of [...chon].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!vtSet.has(ma)) { khong_khop.push(ma); continue }
    const r = await c.query('update kho.vat_tu set anh_file=$2 where ma=$1', [ma, name])
    dien += r.rowCount
  }
  await c.query('commit')

  // 5) thống kê
  const vt_khong_bucket = [...vtSet].filter(ma => !chon.has(ma)).length
  console.log(`✅ NẠP XONG (chỉ ghi anh_file, không đụng anh_ma/bucket)`)
  console.log(`  Mã được điền anh_file : ${dien}`)
  console.log(`  Mã trong bucket KHÔNG khớp vat_tu (bỏ qua): ${khong_khop.length}`)
  console.log(`  Mã vat_tu KHÔNG có ảnh bucket (anh_file để NULL): ${vt_khong_bucket}`)
  if (saiKhuon.length) console.log(`  ⚠ file sai khuôn (bỏ qua): ${saiKhuon.length} — ${saiKhuon.join(', ')}`)
  console.log(`  Danh sách mã bucket KHÔNG khớp (${khong_khop.length}): ${khong_khop.sort().join(', ')}`)
} catch (e) {
  try { await c.query('rollback') } catch {}
  console.error('❌ LỖI:', e.message); process.exitCode = 2
} finally { await c.end() }
