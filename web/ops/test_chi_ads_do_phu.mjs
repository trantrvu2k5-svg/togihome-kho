// TEST WP-90 mở lại L-23 · độ phủ + idempotent nạp (db/230). tx-rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { keoChiAdsMetaNhip } from './keo_chi_ads_meta.mjs'   // (dùng gomKhoangNgay gián tiếp qua nhịp — test riêng dưới)
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
const dp = async (tu, den) => (await c.query('select kho.chi_ads_kiem_do_phu($1,$2) j', [tu, den])).rows[0].j

try {
  await c.query('begin')

  // ── vế 1: do_phu phát hiện ĐÚNG ngày trống (lỗ giả trong tx) — theo mốc khoang ──
  await c.query('savepoint v1')
  await c.query('delete from kho.ads_moc_keo')
  // một lượt meta_chi_ad xong, khoang CHỈ 01→20/08 → 21..31 phải là chưa_keo
  await c.query(`insert into kho.ads_moc_keo(nguon,bat_dau_luc,ket_thuc_luc,trang_thai,khoang_tu,khoang_den) values('meta_chi_ad',now(),now(),'xong','2026-08-01','2026-08-20')`)
  const j1 = (await dp('2026-08-01', '2026-08-31')).find(r => r.thang === '2026-08')
  ok('1 do_phu phát hiện đúng ngày trống: Aug 20/31 · chưa_keo 11 ngày (21→31)',
    j1 && j1.so_ngay_da_keo === 20 && j1.so_ngay_thuc === 31 && (j1.ngay_chua_keo || []).length === 11 && j1.ngay_chua_keo[0] === '2026-08-21', JSON.stringify(j1 && { co: j1.so_ngay_da_keo, thuc: j1.so_ngay_thuc, trong: (j1.ngay_chua_keo || []).length }))
  await c.query('rollback to savepoint v1')

  // ── vế 2: ngày không-tiêu-tiền (không row) nhưng ĐÃ KÉO → KHÔNG tính trống ──
  await c.query('savepoint v2')
  await c.query('delete from kho.ads_moc_keo')
  await c.query(`insert into kho.ads_moc_keo(nguon,bat_dau_luc,ket_thuc_luc,trang_thai,khoang_tu,khoang_den) values('meta_chi_ad',now(),now(),'xong','2026-08-01','2026-08-31')`)
  const j2 = (await dp('2026-08-01', '2026-08-31')).find(r => r.thang === '2026-08')
  ok('2 đã kéo cả tháng (dù ngày không tiêu không có row) → ĐỦ 31/31, 0 trống',
    j2 && j2.du === true && j2.so_ngay_da_keo === 31, JSON.stringify(j2 && { co: j2.so_ngay_da_keo, du: j2.du }))
  await c.query('rollback to savepoint v2')

  // ── vế 3: nạp 2 LẦN không nhân đôi (chi_ads_ngay_ghi upsert theo khoá act_id,ad_id,ngay) ──
  await c.query('savepoint v3')
  await c.query(`select set_config('kho.meta_he_thong','1',true)`)
  const row = JSON.stringify([{ act_id: 'TEST-ACT', ad_id: 'TEST-AD', ngay: '2026-08-15', chi_tieu: 12345, hien_thi: 100, luot_bam: 5, luot_bam_link: 2, tien_te: 'VND' }])
  const n1 = (await c.query('select kho.chi_ads_ngay_ghi($1::jsonb) n', [row])).rows[0].n
  const c1 = +(await c.query("select count(*) n from kho.chi_ads_ngay where act_id='TEST-ACT'")).rows[0].n
  const n2 = (await c.query('select kho.chi_ads_ngay_ghi($1::jsonb) n', [row])).rows[0].n   // ghi ĐÈ lần 2
  const c2 = +(await c.query("select count(*) n, sum(chi_tieu) s from kho.chi_ads_ngay where act_id='TEST-ACT'")).rows[0].n
  const s2 = +(await c.query("select coalesce(sum(chi_tieu),0) s from kho.chi_ads_ngay where act_id='TEST-ACT'")).rows[0].s
  ok('3 nạp 2 lần → KHÔNG nhân đôi (1 dòng, chi_tieu vẫn 12345)', c1 === 1 && c2 === 1 && s2 === 12345, `c1=${c1} c2=${c2} sum=${s2}`)
  await c.query('rollback to savepoint v3')

} finally { await c.query('rollback') }
await c.end()
console.log(`\n═══ test_chi_ads_do_phu: ${P} pass / ${F} fail ═══`)
process.exit(F ? 1 : 0)
