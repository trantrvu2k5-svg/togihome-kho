// TEST — WP-90 · bản đồ act→brand + gộp chi_ads_ngay→chi_ads. Tx rollback, fixture cô lập (xoá chi_ads/chi_ads_ngay trong tx).
//   Bản đồ 6 TK→sconcept đã commit (db/201). Test seed chi_ads_ngay quanh mốc + nhập tay để soi 4 luật gộp.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
async function asU(U, s, a = []) {
  await c.query('savepoint sp'); try {
    await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    const r = await c.query(s, a); await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`); return { ok: true, rows: r.rows }
  } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}
const gop = async () => { await c.query(`select set_config('kho.meta_he_thong','1',true)`); return (await one(`select kho.chi_ads_gop_meta() j`)).j }

await c.query('begin')
// fixture cô lập trong tx (rollback sau)
await c.query(`delete from kho.chi_ads`); await c.query(`delete from kho.chi_ads_ngay`)
// mapped act (sconcept) 08 → sẽ ra 1 dòng meta ; mapped act 09 → sẽ BỊ nhập tay chặn ; unmapped LA_X → treo
await c.query(`insert into kho.chi_ads_ngay(act_id,ad_id,ngay,chi_tieu) values
  ('1316832279835473','A1',date '2026-08-25',100000),
  ('1316832279835473','A2',date '2026-09-10',200000),
  ('LA_X','A3',date '2026-08-25',55000)`)
// nhập tay: 2026-07 (trước mốc, phải giữ) · 2026-09 sconcept/quang_cao (>= mốc, phải CHẶN gộp, không đè)
await c.query(`insert into kho.chi_ads(ma_ky,thuong_hieu,kenh,so_tien_nhap,nguon,nhan_vat) values
  ('2026-07','sconcept','quang_cao',999,'nhap_tay','gom_vat'),
  ('2026-09','sconcept','quang_cao',888,'nhap_tay','gom_vat')`)

const g1 = await gop()
ok('mốc = 2026-08 (ngày sớm nhất chi_ads_ngay)', g1.moc_ky === '2026-08', JSON.stringify(g1))

// D1. gộp 2 lần → KHÔNG cộng chồng (số dòng meta + tổng giữ nguyên)
const m1 = await one(`select count(*)::int n, coalesce(sum(so_tien_nhap),0)::bigint s from kho.chi_ads where nguon='meta_tu_dong'`)
const g2 = await gop()
const m2 = await one(`select count(*)::int n, coalesce(sum(so_tien_nhap),0)::bigint s from kho.chi_ads where nguon='meta_tu_dong'`)
ok('D1. gộp 2 lần idempotent — không cộng chồng (1 dòng meta=100.000 cả 2 lần)',
  m1.n === 1 && m1.s === '100000' && m2.n === m1.n && m2.s === m1.s, JSON.stringify([m1, m2]))

// D2. kỳ TRƯỚC mốc (2026-07) giữ nguyên số tay
const t07 = await one(`select so_tien_nhap::bigint s, nguon from kho.chi_ads where ma_ky='2026-07' and thuong_hieu='sconcept' and kenh='quang_cao'`)
ok('D2. kỳ trước mốc (2026-07) GIỮ số tay 999, nguon=nhap_tay (không đè)', t07 && t07.s === '999' && t07.nguon === 'nhap_tay', JSON.stringify(t07))

// D3. tài khoản lạ → chi treo ĐẾM ĐƯỢC (55.000, 1 TK), KHÔNG thành dòng brand
ok('D3. TK lạ LA_X → chi_treo_chua_gan=55.000 · so_tk_chua_gan=1 (đếm được, không nuốt)',
  Number(g2.chi_treo_chua_gan) === 55000 && g2.so_tk_chua_gan === 1, JSON.stringify(g2))

// D4. nhãn VAT đúng theo nguồn: meta_tu_dong = chua_ro_vat
const lbl = await one(`select nhan_vat, nguon from kho.chi_ads where nguon='meta_tu_dong' limit 1`)
ok('D4. dòng meta_tu_dong mang nhãn chua_ro_vat', lbl && lbl.nhan_vat === 'chua_ro_vat', JSON.stringify(lbl))

// D5. RPC độ phủ trả X/9 (brand đang bán = view thuong_hieu_ban)
const dp = await asU(CEO, `select kho.ads_do_phu_brand() j`)
const j = dp.ok && dp.rows[0].j
ok('D5. ads_do_phu_brand → brand_dang_ban=9 · do_phu = "<phủ>/9" · treo=55.000',
  j && j.brand_dang_ban === 9 && j.do_phu === (j.brand_co_ban_do + '/9') && Number(j.chi_treo_chua_gan) === 55000, JSON.stringify(j))

// ── ÂM ──
// Â6. KHÔNG dòng meta_tu_dong nào mang gom_vat
const bad = await one(`select count(*)::int n from kho.chi_ads where nguon='meta_tu_dong' and nhan_vat='gom_vat'`)
ok('Â6. không dòng meta_tu_dong nào mang nhãn gom_vat', bad.n === 0, 'n=' + bad.n)

// Â7. gộp KHÔNG đè nhập tay kỳ >= mốc: 2026-09 nhập tay 888 còn nguyên, KHÔNG có dòng meta cho (2026-09,sconcept), bo_qua đếm được
const t09 = await one(`select so_tien_nhap::bigint s, nguon from kho.chi_ads where ma_ky='2026-09' and thuong_hieu='sconcept' and kenh='quang_cao'`)
const meta09 = await one(`select count(*)::int n from kho.chi_ads where ma_ky='2026-09' and nguon='meta_tu_dong'`)
ok('Â7. nhập tay 2026-09 (>=mốc) KHÔNG bị đè (888/nhap_tay) · 0 dòng meta cho 09 · bo_qua_vi_nhap_tay>=1',
  t09 && t09.s === '888' && t09.nguon === 'nhap_tay' && meta09.n === 0 && Number(g2.bo_qua_vi_nhap_tay) >= 1, JSON.stringify([t09, meta09, g2.bo_qua_vi_nhap_tay]))

// Â8. tài khoản lạ KHÔNG tự gán brand (không đẻ dòng bản đồ)
const laMap = await one(`select count(*)::int n from kho.ads_tai_khoan_brand where act_id='LA_X'`)
ok('Â8. TK lạ LA_X KHÔNG tự vào bản đồ (0 dòng — không đoán brand)', laMap.n === 0, 'n=' + laMap.n)

await c.query('rollback')
console.log(`\n═══ test_wp90: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
