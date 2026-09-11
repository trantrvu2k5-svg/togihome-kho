// TEST WP-113 lô 2F — HẾT NUỐT LỖI: 1 TK ném lỗi → mốc ads='loi' + ok/tổng + danh sách; 0 lỗi → 'xong'.
//   Owner tx, ROLLBACK sạch. Cô lập: xoá chi_ads_ngay trong tx để union TK chỉ lấy /me/adaccounts của mock.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { keoChiAdsMetaCoSo } from './keo_chi_ads_meta.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 180) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const tx = async (fn) => fn(c)   // chạy trong CÙNG tx ngoài (tránh begin/commit lồng của gộp_ky)
const mocMoi = async (nguon) => one(`select trang_thai, so_dong_ghi, left(coalesce(loi_van_ban,''),200) loi
  from kho.ads_moc_keo where nguon=$1 order by bat_dau_luc desc limit 1`, [nguon])
// mock: OK1(111) kéo được 1 campaign; LOI(ERR) insights NÉM lỗi
const mkMock = (loiERR) => async (u) => {
  const path = u.split('?')[0]
  if (path.endsWith('/me/adaccounts')) return { ok: true, json: async () => ({ data: [
    { name: 'OK1', account_id: '111', currency: 'VND' }, { name: 'LOI', account_id: 'ERR', currency: 'VND' }] }) }
  if (loiERR && path.includes('/act_ERR/insights')) return { ok: false, status: 400, json: async () => ({ error: { message: 'giả lập lỗi TK ERR', code: 100 } }) }
  if (path.includes('/act_111/insights') && path.includes('level=campaign'))
    return { ok: true, json: async () => ({ data: [{ campaign_id: 'C1', campaign_name: 'Demo', objective: 'OUTCOME_SALES',
      spend: '1000', impressions: '10', clicks: '2', inline_link_clicks: '1', date_start: '2026-09-10',
      actions: [{ action_type: 'landing_page_view', value: '3' }], outbound_clicks: [{ action_type: 'outbound_click', value: '2' }] }] }) }
  return { ok: true, json: async () => ({ data: [] }) }   // các lời gọi khác: rỗng
}
try {
  await c.query('begin')
  await c.query(`select set_config('kho.meta_he_thong','1',true)`)
  await c.query(`delete from kho.chi_ads_ngay`)   // cô lập union → chỉ TK của mock
  const range = { since: '2026-09-08', until: '2026-09-10' }
  const clearMoc = () => c.query(`delete from kho.ads_moc_keo where nguon in ('meta_chi_ad','meta_chi_chien_dich','gop_ky')`)

  // ── 1) CÓ 1 TK lỗi → mốc 'loi', ok 1/2, lỗi có mặt ──
  await clearMoc()
  const kq = await keoChiAdsMetaCoSo(c, { token: 'X', fetch: mkMock(true), tx, range })
  ok('1. keoChiAdsMetaCoSo trả loiTK=1 · okTK=1 · tongTK=2', kq.loiTK && kq.loiTK.length === 1 && kq.okTK === 1 && kq.tongTK === 2, JSON.stringify({ l: kq.loiTK && kq.loiTK.length, ok: kq.okTK, tong: kq.tongTK }))
  const mAd = await mocMoi('meta_chi_ad'), mCd = await mocMoi('meta_chi_chien_dich')
  ok('2. mốc meta_chi_ad = "loi" · ghi có "ok 1/2" · có tên lỗi', mAd.trang_thai === 'loi' && /ok 1\/2/.test(mAd.loi) && /ERR/.test(mAd.loi), JSON.stringify(mAd))
  ok('3. mốc meta_chi_chien_dich = "loi"', mCd.trang_thai === 'loi', JSON.stringify(mCd))
  ok('4. loi_van_ban KHÔNG chứa access_token', !/access_token=[^<]/.test(mAd.loi), mAd.loi)

  // ── 2) 0 TK lỗi → mốc 'xong' ──
  await c.query('savepoint s2')
  await clearMoc()
  const kq2 = await keoChiAdsMetaCoSo(c, { token: 'X', fetch: mkMock(false), tx, range })
  const mAd2 = await mocMoi('meta_chi_ad')
  ok('5. 0 lỗi → loiTK rỗng · mốc "xong"', (!kq2.loiTK || kq2.loiTK.length === 0) && mAd2.trang_thai === 'xong', JSON.stringify({ l: kq2.loiTK && kq2.loiTK.length, tt: mAd2.trang_thai }))
  await c.query('rollback to savepoint s2')

  await c.query('rollback')
} catch (e) { ok('LỖI chạy', false, e.message); await c.query('rollback').catch(() => {}) }
console.log(`\n═══ test_wp113_moc_loi: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
