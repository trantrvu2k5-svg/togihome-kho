// TEST — WP-79 L-09 · khop_click_lead cửa-sổ-1:1 + /chat ghi sổ 2 nhánh (VIỆC 2+5). Tất cả trong tx → ROLLBACK.
//   Dữ liệu test đặt ở TƯƠNG LAI (now()+100..113 ngày) để CÁCH LY khỏi lead/click thật (thật đều <= now).
//   Cửa sổ khớp mỗi test bọc HẸP quanh ngày của nó → không đụng lead test khác.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 170) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]

// chạy 1 câu, bắt lỗi mà KHÔNG vỡ tx (savepoint)
async function thu(sql, a = []) {
  await c.query('savepoint sp')
  try { const r = await c.query(sql, a); return { ok: true, rows: r.rows } }
  catch (e) { await c.query('rollback to savepoint sp'); return { ok: false, err: e.message } }
}

await c.query('begin')
await c.query(`select set_config('kho.lead_he_thong','1',true)`)   // cổng tiến trình hệ thống (khuôn lead_ghi QD-76)

// helper: chèn lead THẲNG (owner) với cham_cuoi theo biểu thức SQL; trả id
async function mkLead(sfx, page, chamExpr, muc = 'khong_biet', ad = null) {
  return (await one(`insert into kho.lead(page_id,hoi_thoai_id,thoi_diem_hoi_thoai,cham_cuoi_luc,luong,muc_chac_chan,ad_id,dau_van)
    values($1,$2, ${chamExpr}, ${chamExpr}, 'qua_web',$3,$4, md5($2)) returning id`, [page, 'ht_' + sfx, muc, ad])).id
}
async function mkClick(kenh, ghiExpr, ma = null, loai = null) {
  return (await one(`insert into kho.click_chat(kenh,ref_web,dich,ghi_nhan_luc,ma_click,loai_ma_click,ref_hop_le)
    values($1,'w-test-'||$4,'d', ${ghiExpr}, $2,$3,false) returning id`, [kenh, ma, loai, kenh + Math.floor(1e6 * (ma ? 1 : 2))])).id
}
const khop = async (tuExpr, denExpr, dry = false) =>
  (await c.query(`select * from kho.khop_click_lead(${tuExpr}, ${denExpr}, $1)`, [dry])).rows
const D = n => `now()+interval '${n} days'`

// ═══ DƯƠNG ═══
// D1. 1 click × 1 lead → gán suy_ref + mang ma_click + khoa_khop
const L1 = await mkLead('d1', 'pzl_d1', D(100))
const C1 = await mkClick('zalo', `${D(100)} - interval '10 minutes'`, 'ZT_D1', 'fbclid')
const r1 = (await khop(D(99), D(101))).find(x => x.kq_lead === L1)
const l1 = await one(`select muc_chac_chan,ma_click,loai_ma_click,khoa_khop,khop_luc from kho.lead where id=$1`, [L1])
ok('D1. 1×1 → gán suy_ref · ma_click nguyên văn · khoa_khop=cua_so_1_1 · lệch ~10′',
  r1?.kq_ket === 'gan' && Number(r1.kq_lech_phut) === 10 && l1.muc_chac_chan === 'suy_ref' && l1.ma_click === 'ZT_D1' && l1.loai_ma_click === 'fbclid' && l1.khoa_khop === 'cua_so_1_1' && l1.khop_luc !== null,
  JSON.stringify({ ket: r1?.kq_ket, lech: r1?.kq_lech_phut, l1 }))

// D2. chạy LẦN 2 → không đổi (idempotent: lead đã khoa_khop bị bỏ qua, không có dòng 'gan' cho L1)
const khopLucTruoc = l1.khop_luc
const rows2 = await khop(D(99), D(101))
const l1b = await one(`select muc_chac_chan,khop_luc from kho.lead where id=$1`, [L1])
ok('D2. chạy lần 2 KHÔNG đổi (idempotent) — L1 vắng khỏi output, khop_luc giữ nguyên',
  rows2.find(x => x.kq_lead === L1) === undefined && String(l1b.khop_luc) === String(khopLucTruoc) && l1b.muc_chac_chan === 'suy_ref',
  JSON.stringify({ conL1: !!rows2.find(x => x.kq_lead === L1), l1b }))

// D3. lead có ad_id (xac_dinh) → matcher BỎ QUA, giữ xac_dinh, khoa_khop null (ad_id thắng, QD-73)
const L3 = await mkLead('d3', 'pzl_d3', D(103), 'xac_dinh', 'AD_XYZ_123')
await mkClick('zalo', `${D(103)} - interval '5 minutes'`, 'ZT_D3', 'fbclid')
const r3 = (await khop(D(102), D(104))).find(x => x.kq_lead === L3)
const l3 = await one(`select muc_chac_chan,khoa_khop,ma_click from kho.lead where id=$1`, [L3])
ok('D3. lead xac_dinh (ad_id) → matcher BỎ QUA · giữ xac_dinh · khoa_khop null',
  r3 === undefined && l3.muc_chac_chan === 'xac_dinh' && l3.khoa_khop === null && l3.ma_click === null, JSON.stringify({ r3: !!r3, l3 }))

// D4. lead TRƯỚC epoch → dù nằm trong p_tu/p_den vẫn bị lọc epoch (không xét). Dùng dry để không ghi gì.
const L4 = await mkLead('d4', 'pzl_d4', `timestamptz '2026-08-15 03:07:11.137'`)   // trước mốc 31/08 14:34
await mkClick('zalo', `timestamptz '2026-08-15 03:00:00'`, 'ZT_D4', 'fbclid')
const r4 = (await khop(`timestamptz '2026-08-15 03:07:11'`, `timestamptz '2026-08-15 03:07:12'`, true)).find(x => x.kq_lead === L4)
const l4 = await one(`select muc_chac_chan,khoa_khop from kho.lead where id=$1`, [L4])
ok('D4. lead TRƯỚC epoch → bị lọc (vắng output) · không đụng (khong_biet)',
  r4 === undefined && l4.muc_chac_chan === 'khong_biet' && l4.khoa_khop === null, JSON.stringify({ r4: !!r4, l4 }))

// ═══ VIỆC 2 — /chat ghi sổ 2 NHÁNH (dùng RPC ghi_click_chat như Worker) ═══
const nTruoc = (await one(`select count(*)::int n from kho.click_chat`)).n
await c.query(`select kho.ghi_click_chat('web-ban_le-27','zalo','https://zalo.me/x','src=test','UA',$1,null,'MZ1','fbclid','fb_ig','social','camp8','vid','kw','https://sconcept.vn/sp.27')`, ['/sp.27'])
const rz = await one(`select kenh,ma_click,loai_ma_click,utm_source,utm_campaign,ref_web from kho.click_chat where ma_click='MZ1'`)
ok('VIỆC2a-zalo. /chat kenh=zalo → +1 dòng đủ ref/mc/utm', !!rz && rz.kenh === 'zalo' && rz.ma_click === 'MZ1' && rz.utm_source === 'fb_ig' && rz.utm_campaign === 'camp8', JSON.stringify(rz))
await c.query(`select kho.ghi_click_chat('web-ban_le-27','messenger','https://m.me/x','src=test','UA',$1,null,'MM1','fbclid','fb_ig','social','camp8','vid','kw','https://sconcept.vn/sp.27')`, ['/sp.27'])
const rm = await one(`select kenh,ma_click from kho.click_chat where ma_click='MM1'`)
const nSau = (await one(`select count(*)::int n from kho.click_chat`)).n
ok('VIỆC2a-mess. /chat kenh=messenger → +1 dòng · tổng +2', !!rm && rm.kenh === 'messenger' && nSau === nTruoc + 2, JSON.stringify({ rm, delta: nSau - nTruoc }))

// ═══ ÂM ═══
// ÂM1. 2 click × 1 lead → KHÔNG gán (nhieu_click)
const A1 = await mkLead('a1', 'pzl_a1', D(110))
await mkClick('zalo', `${D(110)} - interval '5 minutes'`, 'ZT_A1a', 'fbclid')
await mkClick('zalo', `${D(110)} - interval '15 minutes'`, 'ZT_A1b', 'fbclid')
const ra1 = (await khop(D(109), D(111))).find(x => x.kq_lead === A1)
const la1 = await one(`select muc_chac_chan,khoa_khop from kho.lead where id=$1`, [A1])
ok('ÂM1. 2 click 1 lead → nhieu_click · KHÔNG gán', ra1?.kq_ket === 'nhieu_click' && la1.muc_chac_chan === 'khong_biet' && la1.khoa_khop === null, JSON.stringify({ ket: ra1?.kq_ket, la1 }))

// ÂM2. 1 click × 2 lead → KHÔNG gán (nhieu_lead) cho cả hai
const A2a = await mkLead('a2a', 'pzl_a2a', `${D(111)} - interval '2 minutes'`)
const A2b = await mkLead('a2b', 'pzl_a2b', `${D(111)} - interval '4 minutes'`)
await mkClick('zalo', `${D(111)} - interval '10 minutes'`, 'ZT_A2', 'fbclid')
const ra2 = await khop(`${D(111)} - interval '20 minutes'`, `${D(111)}`)
const g2 = ra2.filter(x => (x.kq_lead === A2a || x.kq_lead === A2b))
const la2a = await one(`select muc_chac_chan from kho.lead where id=$1`, [A2a])
ok('ÂM2. 1 click 2 lead → nhieu_lead · KHÔNG gán cả hai',
  g2.length === 2 && g2.every(x => x.kq_ket === 'nhieu_lead') && la2a.muc_chac_chan === 'khong_biet', JSON.stringify(g2.map(x => x.kq_ket)))

// ÂM3. click KHÁC KÊNH (messenger) với lead zalo → khong_co_click · KHÔNG gán
const A3 = await mkLead('a3', 'pzl_a3', D(112))
await mkClick('messenger', `${D(112)} - interval '8 minutes'`, 'ZT_A3', 'fbclid')
const ra3 = (await khop(D(111), D(113))).find(x => x.kq_lead === A3)
const la3 = await one(`select muc_chac_chan from kho.lead where id=$1`, [A3])
ok('ÂM3. click khác kênh → khong_co_click · KHÔNG gán', ra3?.kq_ket === 'khong_co_click' && la3.muc_chac_chan === 'khong_biet', JSON.stringify({ ket: ra3?.kq_ket }))

// ÂM4. click NGOÀI 30' (45') → khong_co_click · KHÔNG gán
const A4 = await mkLead('a4', 'pzl_a4', D(113))
await mkClick('zalo', `${D(113)} - interval '45 minutes'`, 'ZT_A4', 'fbclid')
const ra4 = (await khop(D(112), D(114))).find(x => x.kq_lead === A4)
const la4 = await one(`select muc_chac_chan from kho.lead where id=$1`, [A4])
ok('ÂM4. click ngoài 30′ (45′) → khong_co_click · KHÔNG gán', ra4?.kq_ket === 'khong_co_click' && la4.muc_chac_chan === 'khong_biet', JSON.stringify({ ket: ra4?.kq_ket }))

// ÂM5. /chat ghi sổ LỖI (kenh lạ) → LỘ RA (raise), KHÔNG nuốt im
const b5 = await thu(`select kho.ghi_click_chat('web-ban_le-27','zzz','d','src','UA')`)
ok('ÂM5. /chat kenh lạ → ghi_click_chat RAISE (lộ ra, không nuốt im)', !b5.ok && /kenh không hợp lệ/i.test(b5.err), b5.ok ? '(ghi được — LỖI)' : b5.err)

await c.query('rollback')
console.log(`\n═══ test_khop_click_lead: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
