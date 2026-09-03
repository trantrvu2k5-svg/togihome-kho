// TEST CANH — WP-14b · Múi giờ DB = Asia/Ho_Chi_Minh; ngày nghiệp vụ không đi qua UTC.
//   ⚠ node nối qua POOLER Supavisor (ghim timezone=UTC) — KHÔNG phải đường PostgREST. Nên canh 3 tầng:
//   (1) catalog đã ghi VN cho 6 scope (gồm authenticator=PostgREST) · (2) đường app THẬT (PostgREST REST)
//   trả timestamptz offset +07 · (3) logic ngày dưới VN đúng, dưới UTC SAI (prove-red).
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { readFileSync } from 'fs'
const cfg = await docConfig(); cfg.statement_timeout = 12000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }

// (1) catalog: 6 scope có TimeZone VN
const cat = (await c.query(`select count(*) n from pg_db_role_setting s where array_to_string(s.setconfig,',') ilike '%timezone=%ho_chi_minh%'`)).rows[0].n
ok('1· catalog: ' + cat + ' scope có TimeZone=Asia/Ho_Chi_Minh (≥6 = 1 db + 5 role gồm authenticator)', Number(cat) >= 6, 'mới ' + cat)

// (2) đường app THẬT (PostgREST): timestamptz trả về offset +07
const renv = p => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const env = renv(new URL('./.env.robot', import.meta.url)), app = renv(new URL('../.env', import.meta.url))
const U = app.VITE_SUPABASE_URL, ANON = app.VITE_SUPABASE_ANON_KEY
const tok = (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.TEST_CEO_EMAIL, password: env.TEST_CEO_PASS }) }).then(r => r.json())).access_token
const rows = await fetch(`${U}/rest/v1/don_hang?select=tao_luc&limit=1`, { headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'Accept-Profile': 'kho' } }).then(r => r.json())
const off = (rows[0]?.tao_luc || '').match(/([+-]\d\d:\d\d)$/)?.[1]
ok('2· đường app PostgREST trả timestamptz offset = +07:00 (session PostgREST đã VN)', off === '+07:00', 'offset=' + off)

// (3) logic ngày dưới VN đúng — mốc VN-midnight '2026-07-01 00:30+07'
async function kiemNgay(tz) {
  await c.query(`set timezone to '${tz}'`)
  // đọc date bằng to_char TEXT — KHÔNG dùng JS toISOString (chính bệnh đang chữa)
  const r = (await c.query(`select to_char((timestamptz '2026-07-01 00:30+07')::date,'YYYY-MM-DD') d, to_char(timestamptz '2026-07-01 00:30+07','YYYY-MM') k`)).rows[0]
  return { d: r.d, k: r.k }
}
const vn = await kiemNgay('Asia/Ho_Chi_Minh')
ok("3· dưới VN: mốc '2026-07-01 00:30+07' → date=2026-07-01 · kỳ=2026-07", vn.d === '2026-07-01' && vn.k === '2026-07', JSON.stringify(vn))

// (3b) PROVE-RED: dưới UTC cùng mốc → SAI ngày (2026-06-30 / kỳ 2026-06)
const utc = await kiemNgay('UTC')
const canhKeu = utc.d === '2026-06-30' && utc.k === '2026-06'
ok('3b· PROVE-RED: dưới UTC cùng mốc → date=2026-06-30 kỳ=2026-06 (canh BIẾT KÊU khi TZ sai)', canhKeu, JSON.stringify(utc))
console.log('   ↳ nguyên văn "đỏ" (UTC): mốc nửa đêm VN 01/07 bị đọc thành ' + utc.d + ' (lùi 1 ngày) — đây là bệnh WP-14b.')
await c.query(`set timezone to 'Asia/Ho_Chi_Minh'`)  // trả lại

console.log(`\n═══ test_tz_vn: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
