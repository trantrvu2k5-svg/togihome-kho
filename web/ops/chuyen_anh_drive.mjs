// Chuyển ảnh 34 mã Drive-only về bucket kho-images. TUẦN TỰ, nghỉ ≥2s (Drive đang throttle).
//   - Chỉ xử lý mã CÓ anh_ma NHƯNG chưa anh_file (chạy lại -> chỉ làm mã còn thiếu -> idempotent, không nhân file).
//   - Kiểm dữ liệu tải về đúng là ẢNH (magic bytes JPEG/PNG) và ≥2KB; không thì THẤT BẠI, bỏ qua, KHÔNG ghi anh_file.
//   - Tải lên tên MỚI kho/<MÃ>_<ts>.jpg (upsert:false -> không đè). Xong mới cập nhật anh_file. KHÔNG đụng anh_ma.
// Quyền ghi bucket + cột: đăng nhập CEO (RLS ceo/kho). Đọc anon key từ web/.env; CEO_EMAIL/CEO_PASS từ môi trường.
// Chạy: cd web && CEO_EMAIL=... CEO_PASS=... node ops/chuyen_anh_drive.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { db: { schema: 'kho' }, auth: { persistSession: false } })

const wait = ms => new Promise(r => setTimeout(r, ms))
const laAnh = b => b.length >= 2048 &&
  ((b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47))

const { error: eAuth } = await sb.auth.signInWithPassword({ email: process.env.CEO_EMAIL, password: process.env.CEO_PASS })
if (eAuth) { console.error('❌ Đăng nhập CEO lỗi:', eAuth.message); process.exit(2) }

const { data: ds, error: eSel } = await sb.from('vat_tu').select('ma,anh_ma')
  .not('anh_ma', 'is', null).is('anh_file', null).order('ma')
if (eSel) { console.error('❌ Đọc danh sách lỗi:', eSel.message); process.exit(2) }
console.log(`Cần chuyển: ${ds.length} mã (có anh_ma, chưa anh_file)\n`)

const ok = [], hong = []
for (let i = 0; i < ds.length; i++) {
  const { ma, anh_ma } = ds[i]
  if (i > 0) await wait(2500)                       // nghỉ ≥2s giữa các lần
  process.stdout.write(`  [${i + 1}/${ds.length}] ${ma} … `)
  try {
    const r = await fetch(`https://drive.google.com/thumbnail?id=${anh_ma}&sz=w400`, { redirect: 'follow' })
    const buf = Buffer.from(await r.arrayBuffer())
    if (r.status !== 200 || !laAnh(buf)) {
      hong.push({ ma, ly: `tải Drive: HTTP ${r.status}, ${buf.length}B, ${laAnh(buf) ? 'ảnh' : 'KHÔNG phải ảnh (có thể trang lỗi Google)'}` })
      console.log(`THẤT BẠI (HTTP ${r.status}, ${buf.length}B)`); continue
    }
    const path = `kho/${ma}_${Date.now()}.jpg`
    const up = await sb.storage.from('kho-images').upload(path, buf, { contentType: 'image/jpeg', upsert: false })
    if (up.error) { hong.push({ ma, ly: 'upload bucket: ' + up.error.message }); console.log('THẤT BẠI upload'); continue }
    const upd = await sb.from('vat_tu').update({ anh_file: path }).eq('ma', ma)
    if (upd.error) { hong.push({ ma, ly: `ĐÃ tải "${path}" nhưng update anh_file LỖI: ${upd.error.message}` }); console.log('NGUY: tải xong update lỗi'); continue }
    ok.push(ma); console.log(`OK (${buf.length}B → ${path})`)
  } catch (e) { hong.push({ ma, ly: e.message }); console.log('THẤT BẠI: ' + e.message) }
}

console.log(`\n═══ TỔNG KẾT: ${ok.length} thành công · ${hong.length} thất bại ═══`)
if (hong.length) hong.forEach(h => console.log(`  ✗ ${h.ma}: ${h.ly}`))
process.exit(0)
