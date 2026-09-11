// TEST WP-113 lô 2G — dsTaiKhoanHopNhat: /me/adaccounts ∪ chi_ads_ngay; thiếu API vẫn đủ; rỗng → NÉM.
//   Owner tx, ROLLBACK. Cô lập bằng cách XOÁ chi_ads_ngay trong tx rồi bơm act_id giả.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { dsTaiKhoanHopNhat } from './keo_chi_ads_meta.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 160) : '')); v ? P++ : F++ }
// mock /me/adaccounts trả 1 TK '111' (KHÔNG có '999' dù '999' nằm trong sổ)
const mock = async (u) => u.split('?')[0].endsWith('/me/adaccounts')
  ? { ok: true, json: async () => ({ data: [{ name: 'A1', account_id: '111', currency: 'VND' }] }) }
  : { ok: true, json: async () => ({ data: [] }) }
try {
  await c.query('begin')
  await c.query(`delete from kho.chi_ads_ngay`)
  // sổ có act_id '999' (API không trả) → union phải CÓ
  await c.query(`select set_config('kho.meta_he_thong','1',true)`)
  await c.query(`insert into kho.chi_ads_ngay(act_id,ad_id,ngay,chi_tieu,hien_thi,luot_bam,tien_te)
    values('999','AD9','2026-09-01',1000,10,1,'VND')`)
  const ds = await dsTaiKhoanHopNhat(c, mock, 'X')
  const ids = ds.map(x => x.act_id).sort()
  ok('1. hợp nhất API(111) ∪ sổ(999) = [111,999]', JSON.stringify(ids) === JSON.stringify(['111', '999']), JSON.stringify(ids))
  ok('2. TK sổ-thiếu-API (999) vẫn có act=act_999', ds.find(x => x.act_id === '999')?.act === 'act_999', JSON.stringify(ds.find(x => x.act_id === '999')))

  // rỗng: API rỗng + sổ rỗng → NÉM
  await c.query('savepoint s3'); await c.query(`delete from kho.chi_ads_ngay`)
  const mockRong = async () => ({ ok: true, json: async () => ({ data: [] }) })
  let err = null
  try { await dsTaiKhoanHopNhat(c, mockRong, 'X') } catch (e) { err = e.message }
  ok('3. danh sách RỖNG → NÉM (KÊU, không chạy im)', !!err && /RONG|rỗng|RỖNG/.test(err), err || '(không ném)')
  await c.query('rollback to savepoint s3')

  await c.query('rollback')
} catch (e) { ok('LỖI chạy', false, e.message); await c.query('rollback').catch(() => {}) }
console.log(`\n═══ test_wp113_ds_tk: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
