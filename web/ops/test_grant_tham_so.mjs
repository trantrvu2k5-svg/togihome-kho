// TEST CANH — WP-11d [B] · kho.tham_so_tai_chinh ĐÓNG đường ghi client.
//   Ghi qua 2 RPC luu_tham_so_ban_hang/luu_cau_hinh_van_hanh (DEFINER). authenticated/anon CHỈ SELECT.
//   Bắt: cột ghi hở · cột MỚI có tự mở quyền ghi không (bệnh db/150).
//   ⚠ Cột tham số mới thì cho vào RPC theo màn, ĐỪNG grant INSERT/UPDATE cho authenticated.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 15000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const ghiCols = async () => (await c.query(
  `select grantee, privilege_type, column_name from information_schema.column_privileges
    where table_schema='kho' and table_name='tham_so_tai_chinh'
      and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE') order by column_name`)).rows

const hoRa = await ghiCols()
ok('9a: authenticated/anon có 0 cột INSERT/UPDATE/DELETE trên tham_so_tai_chinh',
  hoRa.length === 0, 'CỘT GHI HỞ: ' + hoRa.map(r => `${r.grantee}.${r.column_name}[${r.privilege_type}]`).join(', ') + ' → ghi qua RPC, đừng grant')
const nSel = (await c.query(
  `select count(*) n from information_schema.column_privileges
    where table_schema='kho' and table_name='tham_so_tai_chinh' and grantee='authenticated' and privilege_type='SELECT'`)).rows[0].n
// WP-13b db/222: +4 cột vết sửa (nguoi_sua/sua_luc/chep_tu_ky/xac_nhan_luc) được cấp SELECT (UI đọc vết) → 45→49. Ghi vẫn 0.
ok('9a′: authenticated còn SELECT đủ 49 cột (45 gốc + 4 vết sửa db/222, không mù 2 màn)', nSel === '49', 'SELECT=' + nSel)

await c.query('begin')
try {
  await c.query('alter table kho.tham_so_tai_chinh add column _canh_gia numeric')
  const leakNew = (await ghiCols()).filter(r => r.column_name === '_canh_gia')
  ok('9b: cột mới `_canh_gia` KHÔNG tự mở quyền ghi cho client',
    leakNew.length === 0, 'CỘT MỚI HỞ: ' + leakNew.map(r => `${r.grantee}[${r.privilege_type}]`).join(', '))
} finally { await c.query('rollback') }
const con = (await c.query("select 1 from information_schema.columns where table_schema='kho' and table_name='tham_so_tai_chinh' and column_name='_canh_gia'")).rows.length
ok('9b′: rollback sạch — không để cột rác `_canh_gia`', con === 0)

console.log(`\n═══ test_grant_tham_so: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
