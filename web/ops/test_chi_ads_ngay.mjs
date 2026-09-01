// TEST — WP-77 L-18 · chi_ads_ngay upsert + nối ads_ad_ngay + bộ kéo cô lập lỗi. Tx rollback (join tổng hợp).
//   Meta THẬT đã nghiệm thu ở lệnh (ad Bàn học 25/08 khớp 180.384). Test này bảo đảm LOGIC join + upsert + kéo.
import pg from 'pg'; import { docConfig } from './conn.mjs'
import { keoChiAdsMeta } from './keo_chi_ads_meta.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 170) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
async function asU(U, s, a = []) {
  await c.query('savepoint sp'); try { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    const r = await c.query(s, a); await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`); return { ok: true, rows: r.rows }
  } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}
const D = '2026-08-28'
await c.query('begin')
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
// lead ADX (có chi) + ADY (không chi), cùng ngày D
await c.query(`insert into kho.lead(page_id,hoi_thoai_id,thoi_diem_hoi_thoai,luong,muc_chac_chan,ad_id,sdt,dau_van) values('p','htx',$1::timestamptz,'qua_web','xac_dinh','ADX','0900000001',md5('x')),('p','hty',$1::timestamptz,'qua_web','xac_dinh','ADY','0900000002',md5('y'))`, [D])
// chi_ads_ngay cho ADX ngày D (KHÔNG cho ADY)
await c.query(`insert into kho.chi_ads_ngay(act_id,ad_id,ngay,chi_tieu,hien_thi,luot_bam) values('act1','ADX',$1,100000,5000,200)`, [D])

// ── D1. upsert: ghi 2 lần cùng khoá → 1 dòng, số cập nhật (không đẻ trùng) ──
await c.query(`select set_config('kho.meta_he_thong','1',true)`)
await c.query(`select kho.chi_ads_ngay_ghi($1::jsonb)`, [JSON.stringify([{ act_id: 'act1', ad_id: 'ADZ', ngay: D, chi_tieu: 50, hien_thi: 1, luot_bam: 1, tien_te: 'VND' }])])
await c.query(`select kho.chi_ads_ngay_ghi($1::jsonb)`, [JSON.stringify([{ act_id: 'act1', ad_id: 'ADZ', ngay: D, chi_tieu: 99, hien_thi: 9, luot_bam: 9, tien_te: 'VND' }])])
const dz = await one(`select count(*)::int n, max(chi_tieu) chi from kho.chi_ads_ngay where ad_id='ADZ' and ngay=$1`, [D])
ok('D1. kéo 2 lần cùng ngày → UPSERT (1 dòng, chi=99 cập nhật, không đẻ trùng)', dz.n === 1 && Number(dz.chi) === 99, JSON.stringify(dz))

// ── D3. ads_ad_ngay: ad có chi → chi_ad số, nguon=meta_insights, nhan_vat=chua_ro_vat, phễu hien_thi=that ──
const r = await asU(CEO, `select ad_id, chi_ad, nguon_chi, nhan_vat, cac_ad, pheu->0->>'nhan' hn_nhan, pheu->0->>'gia_tri' hn_gt from kho.ads_ad_ngay($1,$1) where ad_id in ('ADX','ADY')`, [D])
const rx = r.rows.find(x => x.ad_id === 'ADX'), ry = r.rows.find(x => x.ad_id === 'ADY')
ok('D3. ADX có chi → chi_ad=100.000 · nguon=meta_insights · nhan_vat=chua_ro_vat · phễu hiển_thị=that(5000)',
  rx && Number(rx.chi_ad) === 100000 && rx.nguon_chi === 'meta_insights' && rx.nhan_vat === 'chua_ro_vat' && rx.hn_nhan === 'that' && Number(rx.hn_gt) === 5000, JSON.stringify(rx))
// ── D4 + ÂM3. ADY không có chi → chi_ad NULL (KHÔNG 0) + chua_co_nguon ──
ok('D4/ÂM3. ADY không chi → chi_ad NULL (không bịa 0) · nguon=chua_co_nguon', ry && ry.chi_ad === null && ry.nguon_chi === 'chua_co_nguon', JSON.stringify(ry))
// ── ÂM2. 0 đơn chốt → cac_ad NULL (không chia 0) — ADX có chi nhưng lead không có đơn ──
ok('ÂM2. ADX chi có số nhưng 0 đơn chốt → cac_ad NULL (không chia 0)', rx && rx.cac_ad === null, 'cac_ad=' + (rx && rx.cac_ad))

// ── ÂM1 + DISABLED. bộ kéo: 1 tài khoản LỖI insights → tài khoản khác vẫn kéo xong; KHÔNG bỏ tài khoản nào ──
const mock = async (u) => {
  const path = u.split('?')[0]
  if (path.endsWith('/me/adaccounts')) return { ok: true, json: async () => ({ data: [
    { name: 'OK1', account_id: '111', currency: 'VND' }, { name: 'LOI', account_id: 'ERR', currency: 'VND' }, { name: 'Disabled', account_id: '333', currency: 'VND' }] }) }
  if (path.includes('/act_ERR/insights')) return { ok: false, status: 400, json: async () => ({ error: { message: 'giả lập lỗi tài khoản ERR', code: 100 } }) }
  return { ok: true, json: async () => ({ data: [] }) }   // OK1 + Disabled: kéo được, 0 dòng
}
const kq = await keoChiAdsMeta(c, { token: 'X', fetch: mock })
const loi = kq.taiKhoan.filter(t => t.loi), okAcc = kq.taiKhoan.filter(t => !t.loi)
ok('ÂM1. 1 tài khoản lỗi → 2 tài khoản khác VẪN kéo xong (cô lập lỗi, không bỏ tài khoản nào)',
  kq.taiKhoan.length === 3 && loi.length === 1 && loi[0].ten === 'LOI' && okAcc.length === 2 && okAcc.some(t => t.ten === 'Disabled'), JSON.stringify(kq.taiKhoan.map(t => [t.ten, t.loi ? 'LỖI' : 'ok'])))

await c.query('rollback')
console.log(`\n═══ test_chi_ads_ngay: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
