// TEST — vá bẫy NULL guard (tinh_he_so_m, dat_ship_du_toan). Áp 032 trong tx rồi ROLLBACK.
// Mỗi hàm: vai trò hợp lệ (ceo) -> ra kết quả · NULL-vt -> CHẶN · vai trò ngoài whitelist (sale) -> CHẶN.
// Bản CŨ (guard chưa vá): NULL -> LỌT (ĐỎ). In cả hai bản, từng hàm.
import { readFileSync } from 'fs'
import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql032 = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/032_va_bay_null_guard.sql', 'utf8'))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, e = '') => { console.log((cond ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cond ? PASS++ : FAIL++ }
const q = async (s, a = []) => (await c.query(s, a)).rows

// gọi sql với 1 auth_uid (hoặc null); trả 'blocked' nếu raise guard, null nếu chạy qua
async function callAs(authUid, sql) {
  await c.query('savepoint p'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: authUid, role: 'authenticated' })])
  let err = null
  try { await c.query(sql) } catch (e) { err = e.message }
  finally { await c.query('rollback to savepoint p'); await c.query('reset role') }
  return err
}
const guarded = e => e !== null && /chỉ ceo\/ke_toan/.test(e)   // bị chặn bởi guard vai trò?

// GUARD CŨ (bẫy NULL) — để chạy đối chứng
const OLD = {
  tinh: `create or replace function kho.tinh_he_so_m(p_ma_ky text) returns numeric language plpgsql stable security definer set search_path=kho as $$
    begin if kho.current_vai_tro() not in ('ceo','ke_toan') then raise exception 'tinh_he_so_m: chỉ ceo/ke_toan'; end if; return null; end $$`,
  dat: `create or replace function kho.dat_ship_du_toan(p_ma_ky text,p_dong text,p_val numeric) returns void language plpgsql security definer set search_path=kho as $$
    begin if kho.current_vai_tro() not in ('ceo','ke_toan') then raise exception 'dat_ship_du_toan: chỉ ceo/ke_toan'; end if; end $$`,
}
const CALL = { tinh: `select kho.tinh_he_so_m('2026-07')`, dat: `select kho.dat_ship_du_toan('2026-07','le',0)` }

try {
  await c.query('begin')
  const ceo = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`))[0].auth_uid
  const sale = (await q(`select auth_uid from kho.nguoi_dung where vai_tro='sale' and auth_uid is not null limit 1`))[0].auth_uid
  const NULLUID = '00000000-0000-0000-0000-0000000000ff'   // không có trong nguoi_dung -> current_vai_tro()=NULL

  for (const [fn, label] of [['tinh', 'tinh_he_so_m'], ['dat', 'dat_ship_du_toan']]) {
    console.log(`\n════ ${label} ════`)
    // ── BẢN MỚI (áp 032) ──
    await c.query('savepoint neu'); await c.query(sql032)
    ok(`${label} · MỚI · ceo (hợp lệ) → ra kết quả`, !guarded(await callAs(ceo, CALL[fn])))
    ok(`${label} · MỚI · NULL vai_tro → CHẶN`, guarded(await callAs(NULLUID, CALL[fn])))
    ok(`${label} · MỚI · role ngoài whitelist (sale) → CHẶN`, guarded(await callAs(sale, CALL[fn])))
    await c.query('rollback to savepoint neu')
    // ── BẢN CŨ (guard bẫy NULL) ──
    await c.query('savepoint cu'); await c.query(OLD[fn])
    const cuNull = await callAs(NULLUID, CALL[fn])
    const cuSale = await callAs(sale, CALL[fn])
    console.log(`   CŨ · NULL → ${guarded(cuNull) ? 'CHẶN' : 'LỌT (ĐỎ)'} · sale → ${guarded(cuSale) ? 'CHẶN' : 'LỌT'}`)
    ok(`${label} · CŨ · NULL vai_tro → LỌT (chứng minh bẫy)`, !guarded(cuNull))
    ok(`${label} · CŨ · role ngoài whitelist (sale) vẫn CHẶN (bẫy CHỈ ở NULL)`, guarded(cuSale))
    await c.query('rollback to savepoint cu')
  }
  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL ? 1 : 0) }
