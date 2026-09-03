// TEST CANH — WP-11d [A] · kho.luong_to ĐÓNG HẲN đường ghi client.
//   Mọi ghi qua RPC ghi_so_tham_so_xuong (SECURITY DEFINER). authenticated/anon CHỈ được SELECT.
//   Bắt: (a) cột ghi hở ra tầng API · (b) cột MỚI thêm có tự mở quyền ghi không (bệnh db/150).
//   ⚠ Cột nghiệp vụ mới thì ghi QUA RPC, ĐỪNG grant INSERT/UPDATE cho authenticated.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 15000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }

const ghiCols = async () => (await c.query(
  `select grantee, privilege_type, column_name
     from information_schema.column_privileges
    where table_schema='kho' and table_name='luong_to'
      and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')
    order by column_name`)).rows

// 3a · 0 cột INSERT/UPDATE/DELETE cho authenticated+anon
const hoRa = await ghiCols()
ok('3a: authenticated/anon có 0 cột INSERT/UPDATE/DELETE trên luong_to',
  hoRa.length === 0, 'CỘT GHI BỊ HỞ: ' + hoRa.map(r => `${r.grantee}.${r.column_name}[${r.privilege_type}]`).join(', ') + ' → ghi qua RPC, đừng grant')

// 3a' · SELECT vẫn còn đủ 7 (taichinh.js:1372 đọc thẳng)
const nSel = (await c.query(
  `select count(*) n from information_schema.column_privileges
    where table_schema='kho' and table_name='luong_to' and grantee='authenticated' and privilege_type='SELECT'`)).rows[0].n
ok('3a′: authenticated còn SELECT đủ 7 cột (không mù màn)', nSel === '7', 'SELECT=' + nSel)

// 3b · cột MỚI có tự mở quyền ghi không — thử TRONG transaction rồi rollback
await c.query('begin')
try {
  await c.query('alter table kho.luong_to add column _canh_gia numeric')
  const leak = await ghiCols()
  const leakNew = leak.filter(r => r.column_name === '_canh_gia')
  ok('3b: cột mới `_canh_gia` KHÔNG tự mở quyền ghi cho client',
    leakNew.length === 0, 'CỘT MỚI HỞ: ' + leakNew.map(r => `${r.grantee}[${r.privilege_type}]`).join(', '))
} finally {
  await c.query('rollback')
}
// xác nhận rollback sạch, không để cột rác
const con = (await c.query("select 1 from information_schema.columns where table_schema='kho' and table_name='luong_to' and column_name='_canh_gia'")).rows.length
ok('3b′: rollback sạch — không để cột rác `_canh_gia`', con === 0)

console.log(`\n═══ test_grant_luong_to: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
