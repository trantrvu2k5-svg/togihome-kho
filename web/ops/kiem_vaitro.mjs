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
  out['6 sửa vật tư (ten/min)'] = await probe('s', async () => (await c.query("update kho.vat_tu set ton_toi_thieu=99 where ma='BL-01'")).rowCount + ' dòng')
  out['7 thêm vật tư'] = await probe('t', async () => (await c.query("insert into kho.vat_tu(ma,ten,loai) values('ZZ-TEST','x','pk')")).rowCount + ' dòng')
  out['8 xoá vật tư'] = await probe('x', async () => (await c.query("delete from kho.vat_tu where ma='BL-01'")).rowCount + ' dòng')
  out['9 sửa giá vốn tay'] = await probe('gvt', async () => (await c.query('update kho.ton set gia_von_bq=1 where vat_tu_id=$1', [vt1])).rowCount + ' dòng')
  out['10 thêm nhà cung cấp'] = await probe('n', async () => (await c.query("insert into kho.nha_cung_cap(ten) values('NCC Test')")).rowCount + ' dòng')
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

// ── DẤU VẾT (VIỆC 3): 1 lần sửa thật của ceo -> nhật ký ghi ai/gì; rồi trả lại ──
console.log('\n╔═══ DẤU VẾT sửa danh mục (trigger -> nhat_ky_danh_muc) ═══')
const cu = (await c.query("select ton_toi_thieu from kho.vat_tu where ma='BL-01'")).rows[0].ton_toi_thieu
await c.query('begin'); await c.query('set local role authenticated')
await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: sub.ceo })])
await c.query("update kho.vat_tu set ton_toi_thieu=777 where ma='BL-01'")
await c.query('reset role')
const nk = (await c.query(`select n.hanh_dong, n.thay_doi, u.ho_ten, u.vai_tro, n.luc
  from kho.nhat_ky_danh_muc n left join kho.nguoi_dung u on u.id=n.nguoi
  where n.bang='vat_tu' order by n.luc desc limit 1`)).rows[0]
console.log('  bản ghi nhật ký mới nhất:', JSON.stringify(nk))
const okvet = nk && nk.hanh_dong === 'update' && nk.vai_tro === 'ceo' && JSON.stringify(nk.thay_doi).includes('ton_toi_thieu')
console.log(okvet ? '  ✅ dấu vết ĐÚNG: ai=ceo · hành động=update · sửa gì=ton_toi_thieu (cu->moi)' : '  ❌ dấu vết SAI/THIẾU')
await c.query('rollback')   // trả lại ton_toi_thieu + xoá dòng nhật ký test
console.log('  (đã rollback — ton_toi_thieu BL-01 giữ nguyên =', cu, ')')

await c.end()
