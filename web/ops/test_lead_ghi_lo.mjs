// TEST — WP-70 L-70r8 · lead_ghi_lo (gộp lô) NGANG HÀNG lead_ghi. Mỗi ca tx→rollback (sổ thật không đổi).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
const lo = async (ds) => (await c.query(`select kho.lead_ghi_lo($1) j`, [JSON.stringify(ds)])).rows[0].j
const guc = () => c.query(`select set_config('kho.lead_he_thong','1',false)`)
// lead giả thực tế: page test, ht duy nhất, đủ trường như hoiThoaiToLead sinh
const COLS = ['nguon', 'page_id', 'hoi_thoai_id', 'khach_pancake_id', 'loai', 'thoi_diem_hoi_thoai', 'luong', 'loai_ma', 'muc_chac_chan', 'ad_id', 'ref_web', 'sdt', 'ten_khach', 'cham_cuoi_luc', 'moc_dang_ngo']
const mk = (i, over = {}) => ({ nguon: 'pancake', page_id: 'TESTLO', hoi_thoai_id: 'HT' + i, khach_pancake_id: 'K' + i, loai: 'inbox', thoi_diem_hoi_thoai: '2026-08-01T00:00:00Z', luong: 'khong_biet', loai_ma: null, muc_chac_chan: 'khong_biet', ad_id: null, ref_web: null, sdt: '09' + String(100000000 + i), ten_khach: 'Khách ' + i, cham_cuoi_luc: '2026-08-15T00:00:00Z', moc_dang_ngo: false, ...over })

// 1 · lô 60 mới → ghi 60
{ await c.query('begin'); await guc()
  const r = await lo(Array.from({ length: 60 }, (_, i) => mk(i)))
  ok('1. lô 60 mới → ghi 60 khong_doi 0', r.ghi === 60 && r.khong_doi === 0, JSON.stringify(r))
  await c.query('rollback') }

// 2 · chạy lại y hệt (đã có sẵn) → ghi 0. (ghi 60 trước, KHÔNG rollback giữa; rollback cuối)
{ await c.query('begin'); await guc()
  const ds = Array.from({ length: 60 }, (_, i) => mk(i))
  await lo(ds)
  const r = await lo(ds)
  ok('2. chạy lại → ghi 0 khong_doi 60 (idempotent)', r.ghi === 0 && r.khong_doi === 60, JSON.stringify(r))
  await c.query('rollback') }

// 3 · lô có 1 đổi sdt → ghi 1
{ await c.query('begin'); await guc()
  const ds = Array.from({ length: 60 }, (_, i) => mk(i))
  await lo(ds)
  ds[7] = mk(7, { sdt: '0999999999' })
  const r = await lo(ds)
  ok('3. 1 đổi sdt → ghi 1 khong_doi 59', r.ghi === 1 && r.khong_doi === 59, JSON.stringify(r))
  await c.query('rollback') }

// 4 · lô rỗng → không lỗi
{ await c.query('begin'); await guc()
  let err = null; try { const r = await lo([]); ok('4. lô rỗng → không lỗi (ghi 0)', r.ghi === 0 && r.khong_doi === 0, JSON.stringify(r)) } catch (e) { err = e.message; ok('4. lô rỗng → không lỗi', false, err) }
  await c.query('rollback') }

// 5 · 2 dòng CÙNG hoi_thoai_id → xác định, KHÔNG đẻ 2 bản
{ await c.query('begin'); await guc()
  const r = await lo([mk(1, { sdt: '0900000001' }), mk(1, { sdt: '0900000002' })])
  const cnt = (await c.query(`select count(*)::int n from kho.lead where page_id='TESTLO' and hoi_thoai_id='HT1'`)).rows[0].n
  const sdt = (await c.query(`select sdt from kho.lead where page_id='TESTLO' and hoi_thoai_id='HT1' order by stt desc limit 1`)).rows[0]?.sdt
  ok('5. 2 cùng ht → chỉ 1 bản (giữ dòng CUỐI)', r.ghi === 1 && cnt === 1 && sdt === '0900000002', JSON.stringify({ r, cnt, sdt }))
  await c.query('rollback') }

// 6 · thiếu cham_cuoi (NULL) + moc_dang_ngo=true → lưu đúng
{ await c.query('begin'); await guc()
  await lo([mk(9, { cham_cuoi_luc: null, moc_dang_ngo: true })])
  const row = (await c.query(`select cham_cuoi_luc, moc_dang_ngo from kho.lead where page_id='TESTLO' and hoi_thoai_id='HT9' order by stt desc limit 1`)).rows[0]
  ok('6. cham_cuoi NULL + moc_dang_ngo=true lưu đúng', row.cham_cuoi_luc === null && row.moc_dang_ngo === true, JSON.stringify(row))
  await c.query('rollback') }

// 10 · ĐỐI CHỨNG: lead_ghi từng dòng vs lead_ghi_lo — so từng cột
{ const ds = Array.from({ length: 60 }, (_, i) => mk(1000 + i, { sdt: '098' + String(1000000 + i), cham_cuoi_luc: i % 5 === 0 ? null : '2026-08-1' + (i % 9) + 'T03:00:00Z', moc_dang_ngo: i % 5 === 0 }))
  const grab = async () => (await c.query(`select ${COLS.join(',')}, dau_van from kho.lead where page_id='TESTLO' order by hoi_thoai_id`)).rows
  // A) lead_ghi từng dòng
  await c.query('begin'); await guc()
  for (const d of ds) await c.query(`select kho.lead_ghi($1::jsonb)`, [JSON.stringify(d)])
  const a = await grab(); await c.query('rollback')
  // B) lead_ghi_lo
  await c.query('begin'); await guc()
  await lo(ds)
  const b = await grab(); await c.query('rollback')
  // so từng cột
  let lech = null
  if (a.length !== b.length) lech = `số dòng ${a.length} vs ${b.length}`
  else for (let i = 0; i < a.length && !lech; i++) for (const k of [...COLS, 'dau_van']) {
    const va = a[i][k] instanceof Date ? a[i][k].toISOString() : a[i][k]
    const vb = b[i][k] instanceof Date ? b[i][k].toISOString() : b[i][k]
    if (String(va) !== String(vb)) { lech = `dòng ${i} cột ${k}: ${va} ≠ ${vb}`; break }
  }
  ok('10. ĐỐI CHỨNG 60 dòng: lead_ghi từng dòng == lead_ghi_lo (mọi cột)', lech === null, lech || '')
}

console.log(`\n═══ test_lead_ghi_lo: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
