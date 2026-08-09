// TEST — (1) FAIL ĐÓNG khi thiếu he_so_m  (2) vai trò truong_nhom_sale. Áp 031 trong tx rồi ROLLBACK.
// Chạy (từ web/): DATABASE_URL='...' node ops/test_031.mjs
import { readFileSync } from 'fs'
import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql031 = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/031_failclose_hesom_role_truong.sql', 'utf8'))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, e = '') => { console.log((cond ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); cond ? PASS++ : FAIL++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asRole(uid, fn) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { return await fn() } finally { await c.query('rollback to savepoint s'); await c.query('reset role') }
}
// đặt giá cho đơn TEST-031, trả null nếu OK hoặc message nếu bị chặn
async function datGia(gct, gchot, giam, ns, lydo) {
  await c.query('savepoint t')
  try {
    await c.query(`update kho.don_hang set gia_cong_thuc=$1, gia_chot=$2, chiet_khau=$3, ma_ns_duyet_giam=$4, ly_do_giam=$5 where ma_don='TEST-031'`,
      [gct, gchot, giam, ns, lydo]); return null
  } catch (e) { return e.message } finally { await c.query('rollback to savepoint t') }
}

try {
  await c.query('begin')
  console.log('— áp 031 trong tx —')
  await c.query(sql031)
  const sku = (await q(`select ma from kho.san_pham_mau_gia_von where gia_von is not null order by ma limit 1`))[0].ma
  const ceo = (await q(`select id from kho.nguoi_dung where vai_tro='ceo' limit 1`))[0].id
  await c.query(`insert into kho.don_hang(ma_don,dong,ngay_chot) values('TEST-031','le',current_date)`)
  await c.query(`insert into kho.don_hang_mon(don_id,sp_id,gia) values((select id from kho.don_hang where ma_don='TEST-031'),$1,5000000)`, [sku])
  const floor = Number((await q(`select kho.gia_san_don_i($1::jsonb,'le') g`, [JSON.stringify([{ sku }])]))[0].g)

  // ══════ VIỆC 1 — thiếu he_so_m ══════
  console.log('\n── VIỆC 1: FAIL ĐÓNG khi he_so_m NULL (đơn giá 5.000.000 < sàn ' + floor + ') ──')
  await c.query(`update kho.tham_so_tai_chinh set he_so_m=null where ma_ky='2026-07'`)
  // BẢN MỚI (mặc định): phải CHẶN
  const mNew = await datGia(5000000, 5000000, 0, null, '')
  console.log('   BẢN MỚI:', mNew || '(lưu được)')
  ok('1  BẢN MỚI: thiếu he_so_m → CHẶN (ĐỎ như phải)', mNew !== null && /he_so_m/.test(mNew))
  // BẢN CŨ (chan.hesom_old=1 = bỏ qua): phải LỌT (khe hở)
  await c.query('savepoint old'); await c.query(`select set_config('chan.hesom_old','1',true)`)
  const mOld = await datGia(5000000, 5000000, 0, null, '')
  await c.query(`select set_config('chan.hesom_old','',true)`); await c.query('rollback to savepoint old')
  console.log('   BẢN CŨ :', mOld === null ? 'LƯU ĐƯỢC (lọt — đơn dưới sàn vẫn qua)' : mOld)
  ok('1  BẢN CŨ: bỏ qua he_so_m → LỌT (chứng minh khe hở có thật)', mOld === null)

  // ══════ VIỆC 2 — vai trò truong_nhom_sale ══════
  console.log('\n── VIỆC 2: vai trò truong_nhom_sale ──')
  await c.query(`update kho.tham_so_tai_chinh set he_so_m=1.25 where ma_ky='2026-07'`)  // bật lại floor cho ca duyệt
  const tr = (await q(`insert into kho.nguoi_dung(ho_ten,vai_tro,dang_hoat_dong,auth_uid)
     values('TEST Trưởng nhóm Sale','truong_nhom_sale',true,gen_random_uuid()) returning id, auth_uid`))[0]
  await c.query(`insert into kho.quyen_duyet_giam(ns_id,cap) values($1,'truong_nhom')`, [tr.id])
  ok('2  role truong_nhom_sale hợp lệ (CHECK cho phép)', true)

  // RLS: truong đọc giá vốn + tham số -> CHẶN
  const gv = (await asRole(tr.auth_uid, () => q(`select count(*)::int n from kho.san_pham_mau_gia_von`)))[0].n
  ok('2  truong_nhom_sale đọc giá vốn → CHẶN', gv === 0, `thấy ${gv} dòng`)
  const ts = (await asRole(tr.auth_uid, () => q(`select count(*)::int n from kho.tham_so_tai_chinh`)))[0].n
  ok('2  truong_nhom_sale đọc tham_so_tai_chinh → CHẶN', ts === 0, `thấy ${ts} dòng`)

  // Duyệt giảm 6% (5-8%) → được ; 9% → ĐỎ (cần CEO)
  const m6 = await datGia(10000000, 9400000, 600000, tr.id, 'trưởng nhóm duyệt')
  ok('2  truong_nhom_sale duyệt giảm 6% → LƯU được', m6 === null, m6 || '')
  const m9 = await datGia(10000000, 9100000, 900000, tr.id, 'thử 9%')
  ok('2  truong_nhom_sale duyệt giảm 9% → CHẶN (cần CEO)', m9 !== null && /CEO/.test(m9), m9 || '')

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch (e) { console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL ? 1 : 0) }
