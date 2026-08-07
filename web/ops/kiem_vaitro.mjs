// Kiểm RLS/grant: 4 chủ thể (anon + ceo/kho/tho) × 6 phép. set role + JWT giả. Rollback mọi thay đổi.
import pg from 'pg'
import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig())
await c.connect()

const nd = await c.query("select vai_tro, auth_uid from kho.nguoi_dung where vai_tro in ('ceo','kho','tho')")
const sub = Object.fromEntries(nd.rows.map(r => [r.vai_tro, r.auth_uid]))
const vt1 = (await c.query("select id from kho.vat_tu where ma='BL-01'")).rows[0].id

async function probe(label, fn) {
  await c.query('savepoint p')
  try { const r = await fn(); await c.query('release savepoint p'); return r }
  catch (e) { await c.query('rollback to savepoint p'); return 'CHẶN(' + e.message.split('\n')[0].slice(0, 42) + ')' }
}
async function chay(ten, dbrole, s) {
  await c.query('begin'); await c.query(`set local role ${dbrole}`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [s ? JSON.stringify({ sub: s }) : ''])
  const out = {}
  out['1 đọc danh mục'] = await probe('dm', async () => (await c.query('select count(*) n from kho.vat_tu')).rows[0].n + ' mã')
  out['2 giá vốn (ton trực tiếp)'] = await probe('gvt', async () => (await c.query('select gia_von_bq from kho.ton limit 1')).rowCount + ' dòng')
  out['3 giá vốn (view)'] = await probe('gvv', async () => (await c.query('select gia_von_bq from kho.v_ton_gia_von limit 1')).rowCount + ' dòng')
  out['4 chèn lấy/trả (RPC)'] = await probe('q', async () => { await c.query("select kho.quet_giao_dich('BL-01','lay',1)"); return 'ĐƯỢC' })
  out['5 ghi sổ phiếu (RPC)'] = await probe('g', async () => { await c.query("select kho.ghi_so_phieu('nhap',null,null,'t', $1::jsonb)", [JSON.stringify([{ vat_tu_id: vt1, so_luong: 1, don_gia: 1000 }])]); return 'ĐƯỢC' })
  out['6 sửa danh mục'] = await probe('s', async () => { const r = await c.query("update kho.vat_tu set ten=ten where ma='BL-01'"); return r.rowCount + ' dòng' })
  await c.query('rollback')
  return out
}

const kq = {}
kq['anon'] = await chay('anon', 'anon', null)
for (const v of ['ceo', 'kho', 'tho']) kq[v] = await chay(v, 'authenticated', sub[v])

const phep = Object.keys(kq.ceo)
console.log('\n╔═══ MA TRẬN VAI TRÒ × PHÉP ═══')
console.log('PHÉP'.padEnd(28) + ['anon', 'ceo', 'kho', 'tho'].map(x => x.padEnd(20)).join(''))
for (const p of phep) console.log(p.padEnd(28) + ['anon', 'ceo', 'kho', 'tho'].map(r => String(kq[r][p]).padEnd(20)).join(''))

// ── Rà quyền SÓT: bảng/cột nào anon|authenticated còn quyền ngoài dự tính ──
console.log('\n╔═══ RÀ QUYỀN CÒN LẠI (information_schema.column_privileges) ═══')
const cp = await c.query(`
  select table_name, grantee, privilege_type, string_agg(column_name, ',' order by column_name) cols
  from information_schema.column_privileges
  where table_schema='kho' and grantee in ('anon','authenticated')
  group by table_name, grantee, privilege_type order by table_name, grantee, privilege_type`)
for (const r of cp.rows) console.log(`  ${r.table_name.padEnd(14)} ${r.grantee.padEnd(14)} ${r.privilege_type.padEnd(8)} [${r.cols}]`)
// cột giá vốn còn sót?
const bad = cp.rows.filter(r => /gia_von_bq|gia_von_lo|don_gia|thanh_tien/.test(r.cols) && r.privilege_type === 'SELECT')
console.log(bad.length ? '  ❌ CÒN SÓT quyền SELECT cột giá: ' + bad.map(r => r.table_name).join(',') : '  ✅ KHÔNG cột giá nào còn quyền SELECT cho anon/authenticated')

await c.end()
