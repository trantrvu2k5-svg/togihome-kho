// Cổng bí mật — quét MỌI file trong 1 thư mục, khớp theo BIỂU THỨC CHÍNH QUY (không chuỗi trần).
//   Dùng: node cong_bi_mat.mjs <thư mục>
//   Khớp bất kỳ mục -> in "CỔNG CẮN: <mã> tại <file>" và THOÁT MÃ LỖI (≠0). Sạch -> "CỔNG SẠCH", thoát 0.
//   KHÔNG try/catch nuốt lỗi: lỗi đọc file -> throw -> Node thoát mã lỗi.
// (a) đổi từ chuỗi trần "sb_secret" sang /sb_secret_[…]{8,}/: mã supabase-js chứa `startsWith("sb_secret_")`
//   (không có GIÁ TRỊ theo sau) -> yêu cầu ≥8 ký tự giá trị loại được báo giả mà vẫn bắt khoá thật.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const dir = process.argv[2]
if (!dir) { console.error('dùng: node cong_bi_mat.mjs <thư mục>'); process.exit(2) }

const PATTERNS = [
  ['a', /sb_secret_[A-Za-z0-9_\-]{8,}/],
  ['b', /eyJ[A-Za-z0-9_\-]{10,}/],
  ['c', /service_role/],
  ['d', /SERVICE_ROLE/],
  ['e', /DB_PASS/],
  ['f', /DB_USER/],
  ['g', /DB_HOST/],
]

function moiFile(d) {
  const out = []
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) out.push(...moiFile(p))
    else out.push(p)
  }
  return out
}

let dinh = false
for (const f of moiFile(dir)) {
  const txt = readFileSync(f, 'utf8')   // lỗi đọc -> ném -> thoát mã lỗi (cố ý không bắt)
  for (const [ma, re] of PATTERNS) {
    if (re.test(txt)) { console.log(`CỔNG CẮN: ${ma} tại ${f}`); dinh = true }
  }
}
if (dinh) process.exit(1)
console.log('CỔNG SẠCH')
process.exit(0)
