// L-66 — DỰNG 6 tài khoản robot test_ (idempotent). Mật khẩu ngẫu nhiên ≥20 ký tự → web/ops/.env.robot (gitignore).
//   Tạo qua RPC kho.qly_them_nguoi (ceo-only, xử lý đúng auth.users + identities + token=''). CHỈ tạo nếu chưa có.
//   CẤM đặt lại mật khẩu tài khoản đang có: account đã tồn tại → BỎ QUA (không đụng), báo để CEO biết .env.robot thiếu dòng đó.
//   Chạy: cd web && node ops/dung_tk_robot.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { randomBytes } from 'node:crypto'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'
const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const ENV = fileURLToPath(new URL('./.env.robot', import.meta.url))
const TK = [
  { key: 'CEO',       vai: 'ceo',      ten: 'test_ceo' },
  { key: 'SALE',      vai: 'sale',     ten: 'test_sale' },
  { key: 'THIET_KE',  vai: 'thiet_ke', ten: 'test_thiet_ke' },
  { key: 'QUAN_DOC',  vai: 'xuong',    ten: 'test_quan_doc' },
  { key: 'THO',       vai: 'tho',      ten: 'test_tho' },
  { key: 'KHO',       vai: 'kho',      ten: 'test_kho' },
]
const genPw = () => randomBytes(18).toString('base64url')   // 24 ký tự [A-Za-z0-9_-], không '='/'+'/'/'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s, a = []) => (await c.query(s, a)).rows
await c.query('set role authenticated')
await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])

// giữ dòng .env.robot cũ (account đã có, KHÔNG đặt lại mật khẩu)
const cu = existsSync(ENV) ? Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const lines = ['# L-66 · MẬT KHẨU ROBOT — KHÔNG commit (đã .gitignore). Sinh bởi ops/dung_tk_robot.mjs.']
const bao = []
for (const t of TK) {
  const em = `${t.ten}@togihome.local`
  await c.query('reset role')
  const ton_tai = (await q(`select 1 from kho.nguoi_dung where ho_ten=$1`, [t.ten])).length > 0
  await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: CEO, role: 'authenticated' })])
  if (ton_tai) {
    const pwCu = cu[`TEST_${t.key}_PASS`]
    lines.push(`TEST_${t.key}_EMAIL=${em}`); lines.push(`TEST_${t.key}_PASS=${pwCu || ''}`)
    bao.push(`${t.ten} (${t.vai}) — ĐÃ CÓ, bỏ qua${pwCu ? '' : ' ⚠ .env.robot THIẾU mật khẩu (không đặt lại được)'}`)
    continue
  }
  const pw = genPw()
  const r = await c.query(`select kho.qly_them_nguoi($1,$2,$3,$4)`, [em, t.ten, t.vai, pw])
  lines.push(`TEST_${t.key}_EMAIL=${em}`); lines.push(`TEST_${t.key}_PASS=${pw}`)
  bao.push(`${t.ten} (${t.vai}) — TẠO MỚI`)
}
await c.query('reset role')
writeFileSync(ENV, lines.join('\n') + '\n', { mode: 0o600 })
console.log('== 6 tài khoản robot (KHÔNG in mật khẩu) ==')
bao.forEach(b => console.log('  ·', b))
console.log('→ đã ghi', ENV, '(chmod 600)')
await c.end()
