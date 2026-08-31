// TEST — WP-78 L-02 · ads_ad_ngay + ranh giới vai ads_user. Không dựng số giả (SỔ nguồn ngoài = người thật).
//   Mọi thứ trong 1 transaction, ROLLBACK cuối (tài khoản ads_user tạm không để lại).
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 150) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

await c.query('begin')
// tài khoản ads_user TẠM (nguoi_dung không FK auth.users nên chèn được; rollback cuối)
const U = (await one(`insert into kho.nguoi_dung(auth_uid,ho_ten,vai_tro,dang_hoat_dong) values(gen_random_uuid(),'TEST ADS','ads_user',true) returning auth_uid`)).auth_uid

// chạy MỘT câu dưới danh nghĩa ads_user (set local role + jwt). Trả {ok, rows|err}.
async function asAds(sql, args = []) {
  await c.query('savepoint sp')
  try {
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    const r = await c.query(sql, args)
    await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`)
    return { ok: true, rows: r.rows }
  } catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}

const TU = '2025-01-01', DEN = '2026-12-31'

// ─── DƯƠNG 1: ads_user GỌI ĐƯỢC ads_ad_ngay ───
const g = await asAds(`select * from kho.ads_ad_ngay($1,$2)`, [TU, DEN])
ok('D1. ads_user gọi ads_ad_ngay được', g.ok, g.err)
const rows = g.rows || []

// ─── DƯƠNG 2: đối chiếu không lệch một dòng ───
const tongLead = (await one(`select count(*)::int n from kho.v_lead_hien_hanh where thoi_diem_hoi_thoai >= $1::timestamptz and thoi_diem_hoi_thoai < ($2::date+1)::timestamptz`, [TU, DEN])).n
const sumHT = rows.reduce((s, r) => s + Number(r.so_hoi_thoai), 0)
ok(`D2. Σ so_hoi_thoai (${sumHT}) == tổng lead trong khoảng (${tongLead})`, sumHT === tongLead, `${sumHT} vs ${tongLead}`)

// ─── DƯƠNG 3: 21 ad_id thật ra đủ dòng + có dòng ad NULL (ngoài quy kết) ───
const adTrongLead = (await one(`select count(distinct ad_id)::int n from kho.v_lead_hien_hanh where ad_id is not null and thoi_diem_hoi_thoai >= $1::timestamptz and thoi_diem_hoi_thoai < ($2::date+1)::timestamptz`, [TU, DEN])).n
const adTrongRPC = new Set(rows.filter(r => r.ad_id !== null).map(r => r.ad_id)).size
const coDongNull = rows.some(r => r.ad_id === null)
ok(`D3. ad_id phân biệt RPC (${adTrongRPC}) == trong lead (${adTrongLead}) · có dòng ad NULL: ${coDongNull}`, adTrongRPC === adTrongLead && coDongNull, `${adTrongRPC}/${adTrongLead} null=${coDongNull}`)

// ─── CHI: mọi dòng chi_ad NULL + nguon_chi='chua_co_nguon' + cac_ad NULL ───
const chiSai = rows.filter(r => r.chi_ad !== null || r.nguon_chi !== 'chua_co_nguon' || r.cac_ad !== null)
ok(`CHI. mọi dòng chi_ad NULL & nguon_chi='chua_co_nguon' & cac_ad NULL (dòng sai: ${chiSai.length})`, chiSai.length === 0, JSON.stringify(chiSai[0] || {}).slice(0, 120))

// ─── PHỄU: 6 bậc, 2 đầu NULL+nhãn meta, 4 sau số thật ───
if (rows[0]) {
  const p = rows[0].pheu
  const okPheu = Array.isArray(p) && p.length === 6
    && p[0].gia_tri === null && p[0].nhan === 'cho_nguon_meta'
    && p[1].gia_tri === null && p[1].nhan === 'cho_nguon_meta'
    && p.slice(2).every(x => x.nhan === 'that' && x.gia_tri !== null)
  ok('PHỄU. 6 bậc: hien_thi/bam NULL+cho_nguon_meta · 4 sau số thật', okPheu, JSON.stringify(p))
}

// ─── ÂM (bắt buộc): ads_user gọi 3 RPC tài chính → TỪ CHỐI ───
const a1 = await asAds(`select kho.pl_ky($1,$2)`, ['2026-08', false])
ok('ÂM1. ads_user → pl_ky TỪ CHỐI', !a1.ok && /chỉ ceo\/ke_toan/i.test(a1.err), a1.ok ? '(gọi được — LỖI)' : a1.err)
const a2 = await asAds(`select kho.cm_don_ky($1,$2,$3,$4)`, ['2026-08', 1, 'gt', false])
ok('ÂM2. ads_user → cm_don_ky TỪ CHỐI', !a2.ok && /chỉ ceo\/ke_toan/i.test(a2.err), a2.ok ? '(gọi được — LỖI)' : a2.err)
const a3 = await asAds(`select kho.dong_tien_ky($1,$2)`, ['2026-08', false])
ok('ÂM3. ads_user → dong_tien_ky TỪ CHỐI', !a3.ok && /chỉ ceo\/ke_toan/i.test(a3.err), a3.ok ? '(gọi được — LỖI)' : a3.err)

// ─── ÂM4: ads_user SELECT thẳng bảng giá vốn → phải KHÔNG đọc được (từ chối HOẶC 0 dòng qua RLS) ───
const a4 = await asAds(`select count(*)::int n from kho.don_hang_gia_von`)
const tongVon = (await one(`select count(*)::int n from kho.don_hang_gia_von`)).n
const chan = !a4.ok || (a4.rows && Number(a4.rows[0].n) === 0)
ok(`ÂM4. ads_user đọc don_hang_gia_von bị chặn (owner thấy ${tongVon}; ads_user thấy ${a4.ok ? a4.rows[0].n : 'TỪ CHỐI'})`, chan, a4.ok ? ('leak '+a4.rows[0].n+' dòng') : a4.err)

await c.query('rollback')
console.log(`\n3 dòng mẫu RPC (số THẬT):`)
for (const r of rows.slice(0, 3)) console.log('  ', JSON.stringify({ ad_id: r.ad_id, ngay: r.ngay, ht: r.so_hoi_thoai, co_sdt: r.so_co_sdt, chot: r.don_chot, gt_chot: r.gia_tri_chot, giao: r.don_giao, chi_ad: r.chi_ad, nguon_chi: r.nguon_chi }))
console.log(`\n═══ test_ads_ad_ngay: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
