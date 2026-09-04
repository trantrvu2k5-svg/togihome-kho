// TEST WP-13b L-2 · mo_ky_moi + xac_nhan_ky + siết luu_cau_hinh_van_hanh (db/222).
// Tests 1-7,9 chạy trong 1 transaction rồi ROLLBACK (không để lại kỳ 2026-10 thật).
// Test 8 (client PATCH 4 cột mới → 403): has_column_privilege (rigorous) + REST thật (live).
import pg from 'pg'
import { docConfig } from './conn.mjs'
import { readFileSync } from 'fs'

const CEO = '205a887e-ae8b-42de-86ff-4eb8afa140a6'
const KT  = '487c6fb3-5075-4e9e-a66d-8ffbe14737c3'
const SALE= '6e8ce1ff-984e-458c-9e19-1df68925a298'
const EXCLUDE = ['ma_ky','ngay_ap_dung','nguoi_sua','sua_luc','chep_tu_ky','xac_nhan_luc']  // 6 cột loại khỏi md5

let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }

const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()

// giả jwt theo vai (current_vai_tro đọc auth.uid() = request.jwt.claims->>'sub')
const vai = async uid => c.query("select set_config('request.jwt.claims', $1, true)",
  [JSON.stringify({ sub: uid, role: 'authenticated' })])
// thử 1 lệnh, nuốt lỗi kỳ vọng bằng savepoint
const attempt = async sql => {
  await c.query('savepoint s')
  try { const r = await c.query(sql); return { ok: true, r } }
  catch (e) { await c.query('rollback to savepoint s'); return { ok: false, msg: e.message } }
}

try {
  await c.query('begin')

  // nguồn: kỳ mới nhất + số dòng chi_phi_ky/luong_to của nó
  const src = (await c.query("select ma_ky from kho.tham_so_tai_chinh order by ngay_ap_dung desc nulls last, ma_ky desc limit 1")).rows[0].ma_ky
  const srcCP = +(await c.query('select count(*) n from kho.chi_phi_ky where ma_ky=$1', [src])).rows[0].n
  const srcLT = +(await c.query('select count(*) n from kho.luong_to where ma_ky=$1', [src])).rows[0].n
  console.log(`  nguồn = ${src} · chi_phi_ky=${srcCP} dòng · luong_to=${srcLT} dòng\n`)

  // cột giá/tham số (loại 6) để md5
  const cols = (await c.query(
    "select string_agg(quote_ident(column_name), ',' order by ordinal_position) c from information_schema.columns where table_schema='kho' and table_name='tham_so_tai_chinh' and column_name <> all($1)",
    [EXCLUDE])).rows[0].c

  // ── T1: mo_ky_moi('2026-10') as ceo → ok + 45 cột (loại 6) md5 khớp kỳ nguồn
  await vai(CEO)
  const t1 = await attempt("select kho.mo_ky_moi('2026-10')")
  ok('T1 mo_ky_moi(2026-10) [ceo] chạy được', t1.ok, t1.msg)
  if (t1.ok) {
    const md5 = async k => (await c.query(`select md5(x::text) h from (select ${cols} from kho.tham_so_tai_chinh where ma_ky=$1) x`, [k])).rows[0].h
    const [hNew, hSrc] = [await md5('2026-10'), await md5(src)]
    ok('T1 md5 các cột giá/tham số khớp kỳ nguồn từng ký tự', hNew === hSrc, `new=${hNew} src=${hSrc}`)
    const row = (await c.query("select chep_tu_ky, xac_nhan_luc, nguoi_sua from kho.tham_so_tai_chinh where ma_ky='2026-10'")).rows[0]
    ok('T1 vết: chep_tu_ky=nguồn · xac_nhan_luc=NULL (chưa soát) · nguoi_sua=ceo',
      row.chep_tu_ky === src && row.xac_nhan_luc === null && row.nguoi_sua === CEO, JSON.stringify(row))
  }

  // ── T2: gọi lại → "đã tồn tại"
  const t2 = await attempt("select kho.mo_ky_moi('2026-10')")
  ok('T2 mở lại 2026-10 → chặn "đã tồn tại"', !t2.ok && /đã tồn tại/.test(t2.msg || ''), t2.msg)

  // ── T3: nhảy cóc (latest giờ=2026-10, liền sau=2026-11) → 2026-12 chặn
  const t3 = await attempt("select kho.mo_ky_moi('2026-12')")
  ok('T3 mở 2026-12 (nhảy cóc) → chặn', !t3.ok && /nhảy cóc/.test(t3.msg || ''), t3.msg)

  // ── T4: quá khứ. 2026-08 tồn tại → chặn (guard "đã tồn tại"); thêm 2026-06 (quá khứ KHÔNG tồn tại) → chặn "quá khứ"
  const t4a = await attempt("select kho.mo_ky_moi('2026-08')")
  ok('T4a mở 2026-08 (quá khứ, đã tồn tại) → chặn', !t4a.ok, t4a.msg)
  const t4b = await attempt("select kho.mo_ky_moi('2026-06')")
  ok('T4b mở 2026-06 (quá khứ, chưa tồn tại) → chặn "quá khứ" (chứng minh nhánh)', !t4b.ok && /quá khứ/.test(t4b.msg || ''), t4b.msg)

  // ── T5: sale gọi → từ chối (vai)
  await vai(SALE)
  const t5 = await attempt("select kho.mo_ky_moi('2026-11')")
  ok('T5 sale gọi mo_ky_moi → từ chối', !t5.ok && /vai|ceo\/ke_toan/.test(t5.msg || ''), t5.msg)
  await vai(CEO)

  // ── T6: tắt/bật 2 cờ chép. (2026-10 đã tạo ở T1) → xoá sạch 2026-10 rồi thử lại từng cờ.
  await c.query("delete from kho.chi_phi_ky where ma_ky='2026-10'")
  await c.query("delete from kho.luong_to where ma_ky='2026-10'")
  await c.query("delete from kho.phan_bo_hoat_dong where ma_ky='2026-10'")
  await c.query("delete from kho.tham_so_tai_chinh where ma_ky='2026-10'")
  const t6off = await attempt("select kho.mo_ky_moi('2026-10', null, false, false)")
  const j6off = t6off.ok && t6off.r.rows[0].mo_ky_moi
  ok('T6 tắt 2 cờ → chi_phi_ky=0 & luong_to=0 dòng',
    !!j6off && j6off.so_dong_chi_phi_ky === 0 && j6off.so_dong_luong_to === 0, JSON.stringify(j6off))
  // dọn rồi bật cả 2
  await c.query("delete from kho.chi_phi_ky where ma_ky='2026-10'")
  await c.query("delete from kho.luong_to where ma_ky='2026-10'")
  await c.query("delete from kho.phan_bo_hoat_dong where ma_ky='2026-10'")
  await c.query("delete from kho.tham_so_tai_chinh where ma_ky='2026-10'")
  const t6on = await attempt("select kho.mo_ky_moi('2026-10', null, true, true)")
  const j6on = t6on.ok && t6on.r.rows[0].mo_ky_moi
  ok('T6 bật 2 cờ → số dòng khớp kỳ nguồn',
    !!j6on && j6on.so_dong_chi_phi_ky === srcCP && j6on.so_dong_luong_to === srcLT,
    `got cp=${j6on && j6on.so_dong_chi_phi_ky}/${srcCP} lt=${j6on && j6on.so_dong_luong_to}/${srcLT}`)

  // ── T7: xac_nhan_ky → xac_nhan_luc có giá trị; gọi lại → "đã xác nhận"
  const t7 = await attempt("select kho.xac_nhan_ky('2026-10')")
  const xn = (await c.query("select xac_nhan_luc from kho.tham_so_tai_chinh where ma_ky='2026-10'")).rows[0]
  ok('T7 xac_nhan_ky → xac_nhan_luc có giá trị', t7.ok && xn.xac_nhan_luc !== null, JSON.stringify(xn))
  const t7b = await attempt("select kho.xac_nhan_ky('2026-10')")
  ok('T7 gọi lại → "đã xác nhận"', !t7b.ok && /đã xác nhận/.test(t7b.msg || ''), t7b.msg)

  // ── T8 (SQL rigorous): authenticated KHÔNG có UPDATE trên 4 cột mới + không có UPDATE bảng
  const priv = (await c.query(
    "select bool_or(has_column_privilege('authenticated','kho.tham_so_tai_chinh',u,'UPDATE')) any_col, has_table_privilege('authenticated','kho.tham_so_tai_chinh','UPDATE') tbl, bool_and(has_column_privilege('authenticated','kho.tham_so_tai_chinh',u,'SELECT')) sel4 from unnest(array['nguoi_sua','sua_luc','chep_tu_ky','xac_nhan_luc']) u"
  )).rows[0]
  ok('T8 authenticated KHÔNG UPDATE 4 cột mới & KHÔNG UPDATE bảng → PATCH sẽ 403',
    priv.any_col === false && priv.tbl === false, JSON.stringify(priv))
  ok('T8 authenticated CÓ SELECT 4 cột mới (UI đọc được vết sửa)', priv.sel4 === true, JSON.stringify(priv))

  // ── T9: ke_toan gọi luu_cau_hinh_van_hanh → từ chối; ceo → 7 số đổi + vết sửa = ceo
  await vai(KT)
  const t9kt = await attempt("select kho.luu_cau_hinh_van_hanh('2026-10', 11, '[\"02:00\",\"14:00\"]'::jsonb, 9, 33, 2000000, 20, 200000000, 12)")
  ok('T9 ke_toan gọi luu_cau_hinh_van_hanh → từ chối (chỉ CEO)', !t9kt.ok && /CEO/.test(t9kt.msg || ''), t9kt.msg)
  await vai(CEO)
  const t9ceo = await attempt("select kho.luu_cau_hinh_van_hanh('2026-10', 11, '[\"02:00\",\"14:00\"]'::jsonb, 9, 33, 2000000, 20, 200000000, 12)")
  const after = (await c.query("select vat,ghi_de,n_ads,n_giam,nguoi_sua,sua_luc from kho.tham_so_tai_chinh where ma_ky='2026-10'")).rows[0]
  ok('T9 ceo gọi → 7 số đổi (vat=11,n_ads=33,n_giam=12) + vết sửa nguoi_sua=ceo',
    t9ceo.ok && +after.vat === 11 && +after.n_ads === 33 && +after.n_giam === 12 && after.nguoi_sua === CEO && after.sua_luc !== null,
    JSON.stringify(after))

} finally {
  await c.query('rollback')   // KHÔNG để lại kỳ 2026-10 / thay đổi nào trong DB thật
}

// ── T8 (REST live): client PATCH thẳng cột mới → không ghi được (403/40x)
let url = '', anon = ''
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  if (l.startsWith('VITE_SUPABASE_URL=')) url = l.split('=')[1].trim()
  if (l.startsWith('VITE_SUPABASE_ANON_KEY=')) anon = l.split('=')[1].trim()
}
try {
  const res = await fetch(`${url}/rest/v1/tham_so_tai_chinh?ma_ky=eq.2026-09`, {
    method: 'PATCH',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json',
               'Content-Profile': 'kho', 'Accept-Profile': 'kho', Prefer: 'return=representation' },
    body: JSON.stringify({ nguoi_sua: 'HACK', xac_nhan_luc: '2020-01-01' })
  })
  const body = await res.text()
  ok(`T8 REST PATCH cột mới (client) → chặn (HTTP ${res.status})`, res.status >= 400,
    `status=${res.status} body=${body.slice(0, 160)}`)
  console.log('     ↳ nguyên văn: ' + body.slice(0, 200))
} catch (e) { ok('T8 REST PATCH → chặn', false, 'fetch lỗi: ' + e.message) }

await c.end()
console.log(`\n═══ test_mo_ky_moi: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
