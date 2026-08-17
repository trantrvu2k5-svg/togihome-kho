// Xoá 200 ảnh MỒ CÔI của 100 SP web (L-77) khỏi bucket san-pham.
//   DB đã xoá (v-kho-93); ảnh còn lại chỉ tốn chỗ. Cần service_role vì bucket không có DELETE policy cho authenticated.
//   CHẠY:  cd web && SB_URL=<https://xxx.supabase.co> SB_SERVICE=<service_role_key> node ops/xoa_anh_web_L77.mjs
//   (danh sách file lấy từ backup ~/Downloads/web_sp_bucket_names_L77.json — chỉ file thuộc 100 id_web WEB)
import fs from 'fs'
const SB_URL = process.env.SB_URL || ''
const SERVICE = process.env.SB_SERVICE || ''
if (!SB_URL || !SERVICE) { console.error('Thiếu SB_URL / SB_SERVICE. Xem đầu file.'); process.exit(2) }
const names = JSON.parse(fs.readFileSync(process.env.HOME + '/Downloads/web_sp_bucket_names_L77.json', 'utf8')).map(x => x.name)
console.log('Sẽ xoá', names.length, 'file khỏi bucket san-pham…')
// Storage API xoá hàng loạt: DELETE /storage/v1/object/san-pham  body {prefixes:[...]}
let da = 0
for (let i = 0; i < names.length; i += 100) {
  const lo = names.slice(i, i + 100)
  const r = await fetch(`${SB_URL}/storage/v1/object/san-pham`, {
    method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: lo })
  })
  if (!r.ok) { console.error('Lỗi lô', i, r.status, (await r.text()).slice(0, 200)); process.exit(1) }
  da += lo.length; console.log('  đã xoá', da, '/', names.length)
}
console.log('XONG: xoá', da, 'file. Kiểm lại trên dashboard Storage → san-pham.')
