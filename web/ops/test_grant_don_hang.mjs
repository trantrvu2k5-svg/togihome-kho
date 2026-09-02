// TEST CANH — WP-11b · so grant UPDATE(don_hang) của authenticated với DANH SÁCH TRẮNG khai trong repo.
//   Bắt cột nghiệp vụ mới tự hở ra tầng API (bệnh db/150) HOẶC revoke nhầm cột client đang ghi.
//   ⚠ Cột nghiệp vụ mới thì VIẾT RPC (SECURITY DEFINER), ĐỪNG thêm vào whitelist cho xanh test.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'
const WL = fileURLToPath(new URL('../../db/grant_don_hang_whitelist.txt', import.meta.url))
const cfg = await docConfig(); cfg.statement_timeout = 15000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }

const whitelist = new Set(readFileSync(WL, 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
const actual = new Set((await c.query(
  `select column_name from information_schema.column_privileges
   where table_schema='kho' and table_name='don_hang' and privilege_type='UPDATE' and grantee='authenticated'`
)).rows.map(r => r.column_name))

const hoRa = [...actual].filter(x => !whitelist.has(x)).sort()   // grant mà không trong whitelist
const revokeNham = [...whitelist].filter(x => !actual.has(x)).sort()   // whitelist mà mất grant

ok('CANH: 0 CỘT MỚI BỊ HỞ (grant ngoài whitelist)', hoRa.length === 0,
  'CỘT MỚI BỊ HỞ: ' + hoRa.join(', ') + ' → cột nghiệp vụ mới thì VIẾT RPC, ĐỪNG thêm vào whitelist cho xanh test')
ok('CANH: 0 REVOKE NHẦM (whitelist mà mất grant)', revokeNham.length === 0,
  'REVOKE NHẦM: ' + revokeNham.join(', ') + ' → cột client đang ghi bị siết, màn sẽ 403')
ok('CANH: whitelist khớp đúng grant thực tế (' + whitelist.size + ' cột)', hoRa.length === 0 && revokeNham.length === 0,
  'whitelist=' + whitelist.size + ' · thực tế=' + actual.size)

console.log(`\n═══ test_grant_don_hang: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
