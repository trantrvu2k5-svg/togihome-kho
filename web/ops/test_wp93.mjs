// TEST — WP-93/WP-92 L-01 · ads_bang_ky/ads_tong_so_sanh/ads_viec_phai_lam + đèn 5 trạng thái + ngưỡng bảng.
//   Tx rollback. RPC là stable (đọc) — seed/đổi ngưỡng trong savepoint, KHÔNG để lại vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const cfg = await docConfig(); cfg.statement_timeout = 20000
const c = new pg.Client(cfg); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 200) : '')); v ? P++ : F++ }
const one = async (s, a = []) => (await c.query(s, a)).rows[0]
const CEO = (await one(`select auth_uid a from kho.nguoi_dung where vai_tro='ceo' and auth_uid is not null limit 1`)).a
const R = 'TU=>$1::date, DEN=>$2::date'
async function asCeo(sql, a = []) { await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })]); const r = await c.query(sql, a); return r.rows[0] }
const TU = '2026-08-24', DEN = '2026-08-31'

await c.query('begin')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
const bk = (await one(`select kho.ads_bang_ky($1,$2) j`, [TU, DEN])).j
const vl = (await one(`select kho.ads_viec_phai_lam($1,$2) j`, [TU, DEN])).j
const ss = (await one(`select kho.ads_tong_so_sanh($1,$2) j`, [TU, DEN])).j

// ── T1. KHÔNG RPC nào lộ CON SỐ TRẦN (khoá key + return type) ──
const keys = (o, acc = new Set()) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { acc.add(k); keys(o[k], acc) } return acc }
const allKeys = new Set([...keys(bk), ...keys(vl), ...keys(ss)])
const bad = [...allKeys].filter(k => /tran|bien_muc_tieu|cac_toi_da|nguong_cac|ceiling/i.test(k))
// 'sat_tran'/'vuot_tran' là GIÁ TRỊ (state) của key 'den', KHÔNG phải key → không tính
const rets = (await c.query(`select pg_get_function_result(oid) r from pg_proc where proname in ('ads_bang_ky','ads_tong_so_sanh','ads_viec_phai_lam') and pronamespace='kho'::regnamespace`)).rows
const retBad = rets.some(x => /tran|bien_muc_tieu|cac_toi_da/i.test(x.r) && !/jsonb/i.test(x.r))
ok('T1. KHÔNG RPC ads_* lộ con số trần (0 key trần trong payload + return chỉ jsonb)', bad.length === 0 && !retBad, 'key trần: ' + JSON.stringify(bad))

// ── T2. Data THẬT (0 đơn): mọi dòng khong_do_duoc/chua_du_so; KHÔNG con_du/sat_tran/vuot_tran. + seed 1 tin nhắn → chua_du_so ──
const states = new Set(bk.dong.map(d => d.den))
const t2a = bk.dong.every(d => d.den === 'khong_do_duoc' || d.den === 'chua_du_so')
await c.query('savepoint s2'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam)
  values('1316832279835473','TNMSG01','Chiến dịch TIN NHẮN test','OUTCOME_ENGAGEMENT','2026-08-26',120000,5000,200)`)
const bk2 = (await asCeo(`select kho.ads_bang_ky($1,$2) j`, [TU, DEN])).j
const msg = bk2.dong.find(d => d.campaign_id === 'TNMSG01')
await c.query('rollback to savepoint s2')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T2. data thật đều khong_do_duoc/chua_du_so (không con_du/sat_tran/vuot_tran) · chiến dịch tin nhắn → chua_du_so',
  t2a && !['con_du', 'sat_tran', 'vuot_tran'].some(s => states.has(s)) && msg && msg.den === 'chua_du_so', JSON.stringify({ states: [...states], msg: msg && msg.den }))

// ── T3. CPM/CPC/CTR khớp tay trên 3 chiến dịch có chi thật ──
const ba3 = bk.dong.filter(d => d.chi > 0 && d.luot_hien_thi > 0 && d.luot_bam > 0).slice(0, 3)
const khop = ba3.every(d => {
  const cpm = Math.round(d.chi * 1000 / d.luot_hien_thi), cpc = Math.round(d.chi / d.luot_bam)
  const ctr = Math.round(d.luot_bam * 100 / d.luot_hien_thi * 100) / 100
  return Number(d.cpm) === cpm && Number(d.cpc) === cpc && Math.abs(Number(d.ctr) - ctr) < 0.01
})
ok('T3. CPM/CPC/CTR khớp phép tính tay trên ' + ba3.length + ' chiến dịch có chi thật', ba3.length === 3 && khop,
  JSON.stringify(ba3.map(d => ({ cpm: d.cpm, cpc: d.cpc, ctr: d.ctr }))))

// ── T4. Bẻ ngưỡng trong ads_nguong (savepoint) → ads_viec_phai_lam đổi (chứng minh đọc từ bảng). Seed 1 CD tin nhắn (A1 bỏ web). ──
await c.query('savepoint s4'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam)
  values('1316832279835473','TNMSG4','CD tin nhắn T4','OUTCOME_ENGAGEMENT','2026-08-26',900000,4000,150)`)
const vl4a = (await asCeo(`select kho.ads_viec_phai_lam($1,$2) j`, [TU, DEN])).j
const truoc = vl4a.viec.filter(v => v.campaign_id === 'TNMSG4' && v.loai === 'chi_cao_khong_hoi_thoai').length
await c.query('reset role')
await c.query(`update kho.ads_nguong set gia_tri=999999999999 where ma='chi_cao_khong_hoi_thoai' and hieu_luc_den is null`)
const vl4b = (await asCeo(`select kho.ads_viec_phai_lam($1,$2) j`, [TU, DEN])).j
const sau = vl4b.viec.filter(v => v.campaign_id === 'TNMSG4' && v.loai === 'chi_cao_khong_hoi_thoai').length
await c.query('rollback to savepoint s4')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T4. bẻ ngưỡng chi_cao (việc TNMSG4: ' + truoc + '→' + sau + ') → đổi kết quả (ngưỡng ĐỌC TỪ BẢNG, không cắm cứng)', truoc === 1 && sau === 0, `truoc=${truoc} sau=${sau}`)

// ── T5. Khoảng KHÔNG có chi → rỗng có cờ, không lỗi, KHÔNG 0 giả (tỷ lệ = NULL không phải 0) ──
const bkE = (await one(`select kho.ads_bang_ky('2020-01-01','2020-01-07') j`)).j
const vlE = (await one(`select kho.ads_viec_phai_lam('2020-01-01','2020-01-07') j`)).j
ok('T5. khoảng rỗng → dong=[] · tong.so_chien_dich=0 · ctr/cpm/cpc=NULL (không 0 giả) · viec=[] · không lỗi',
  bkE.dong.length === 0 && bkE.tong.so_chien_dich === 0 && bkE.tong.ctr === null && bkE.tong.cpm === null && bkE.tong.cpc === null && vlE.viec.length === 0,
  JSON.stringify(bkE.tong))

// ── T6 (L-02). Real: KHÔNG việc chi-cao-0-hội-thoại (đều web/khong_do_duoc); canh_bao_gop khớp SELECT tay ──
const chiCao = vl.viec.filter(v => v.loai === 'chi_cao_khong_hoi_thoai').length
const gop = vl.canh_bao_gop
await c.query('reset role')   // select thô trên chi_chien_dich_ngay cần OWNER (authenticated không có grant bảng)
const tay = await one(`select coalesce(sum(chi_tieu),0)::bigint s, count(distinct campaign_id)::int n from kho.chi_chien_dich_ngay where ngay>=$1 and ngay<=$2 and kho.ads_obj_web(objective)`, [TU, DEN])
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T6. real: 0 việc "chi cao 0 hội thoại" (web bỏ qua) · canh_bao_gop = ' + (gop && gop.so_chien_dich) + ' cd, tổng chi khớp tay',
  chiCao === 0 && gop && gop.loai === 'khong_do_duoc' && gop.so_chien_dich === tay.n && Number(gop.tong_chi) === Number(tay.s),
  JSON.stringify({ chiCao, gop, tay }))

// ── T7. chiến dịch TIN NHẮN chi cao 0 hội thoại → luật chi-cao VẪN nổ cho nó (không tắt nhầm cả luật) ──
await c.query('savepoint s7'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam)
  values('1316832279835473','TNMSG7','CD tin nhắn chi cao','OUTCOME_ENGAGEMENT','2026-08-26',900000,4000,150)`)
const vl7 = (await asCeo(`select kho.ads_viec_phai_lam($1,$2) j`, [TU, DEN])).j
const fire = vl7.viec.find(v => v.campaign_id === 'TNMSG7' && v.loai === 'chi_cao_khong_hoi_thoai')
await c.query('rollback to savepoint s7')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T7. chiến dịch TIN NHẮN chi 900k 0 hội thoại → luật "chi cao" VẪN nổ cho nó (không tắt nhầm cả luật)', !!fire, JSON.stringify(fire && fire.cau))

// ── T8 (L-04, dựng ĐẢO ngày để không lệ thuộc snapshot data). Cả tài khoản cùng +150%, từng chiến dịch ĐÚNG nhịp → KHÔNG báo động giả ──
await c.query('savepoint s8'); await c.query('reset role')   // đảo 2027-02: prev 01–07, cur 08–14; mỗi CD cur=2.5×prev (+150%), nhịp chung cũng +150%
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam) values
  ('actT8','T8A','A','OUTCOME_SALES','2027-02-03',1000000,1000,50),('actT8','T8A','A','OUTCOME_SALES','2027-02-10',2500000,2500,120),
  ('actT8','T8B','B','OUTCOME_SALES','2027-02-03',2000000,2000,90),('actT8','T8B','B','OUTCOME_SALES','2027-02-10',5000000,5000,220),
  ('actT8','T8C','C','OUTCOME_SALES','2027-02-03',1500000,1500,70),('actT8','T8C','C','OUTCOME_SALES','2027-02-10',3750000,3750,180)`)
const vl8 = (await asCeo(`select kho.ads_viec_phai_lam('2027-02-08','2027-02-14') j`)).j
const tang8 = (vl8.viec || []).filter(v => v.loai === 'chi_tang_dot_bien')
await c.query('rollback to savepoint s8')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T8. cả tài khoản +150%, từng chiến dịch đúng nhịp → 0 báo động "chi tăng đột biến" (nhịp chung ' + vl8.nhip_chung_pct + '%)',
  tang8.length === 0, JSON.stringify({ tang: tang8.length, viec: (vl8.viec || []).map(v => v.loai) }))

// ── T9. Chiến dịch tăng vượt HẲN nhịp chung (dùng kỳ 7 ngày có kỳ trước THẬT; T9V prev 500k → cur 5M = +900%) → luật VẪN nổ ──
const TU9 = '2026-08-27', DEN9 = '2026-09-02'   // kỳ trước 20–26/08 có data thật → nhịp chung ~199%, không degenerate
await c.query('savepoint s9'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam) values
  ('1316832279835473','T9V','CD vọt','OUTCOME_SALES','2026-08-22',500000,4500,200),
  ('1316832279835473','T9V','CD vọt','OUTCOME_SALES','2026-08-30',5000000,45000,2000)`)
const vl9 = (await asCeo(`select kho.ads_viec_phai_lam($1,$2) j`, [TU9, DEN9])).j
const fire9 = (vl9.viec || []).some(v => v.loai === 'chi_tang_dot_bien' && (v.campaign_id === 'T9V' || v.gop))
await c.query('rollback to savepoint s9')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T9. chiến dịch tăng +900% (nhịp chung ' + vl9.nhip_chung_pct + '%) → luật "chi tăng đột biến" VẪN nổ', fire9, JSON.stringify((vl9.viec || []).map(v => v.loai + (v.campaign_id ? ':' + v.campaign_id : ''))))

// ── T10. ads_tong_so_sanh: ctr/cpm/cpc khớp tay trên tổng kỳ — CTR/CPC theo luot_bam_LINK (không phải clicks tổng) ──
await c.query('reset role')
const tt = await one(`select coalesce(sum(chi_tieu),0)::numeric chi, coalesce(sum(hien_thi),0)::numeric ht,
  coalesce(sum(luot_bam),0)::numeric lb, sum(luot_bam_link)::numeric lbl from kho.chi_chien_dich_ngay where ngay>=$1 and ngay<=$2`, [TU, DEN])
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
const ss10 = (await one(`select kho.ads_tong_so_sanh($1,$2) j`, [TU, DEN])).j
const ctrTay = Math.round(Number(tt.lbl) * 100 / Number(tt.ht) * 100) / 100, cpmTay = Math.round(Number(tt.chi) * 1000 / Number(tt.ht)), cpcTay = Math.round(Number(tt.chi) / Number(tt.lbl))
ok('T10. so_sanh ctr/cpm/cpc khớp tay trên TỔNG kỳ (CTR/CPC theo bấm-vào-link)',
  Math.abs(Number(ss10.ky_nay.ctr) - ctrTay) < 0.01 && Number(ss10.ky_nay.cpm) === cpmTay && Number(ss10.ky_nay.cpc) === cpcTay,
  JSON.stringify({ rpc: [ss10.ky_nay.ctr, ss10.ky_nay.cpm, ss10.ky_nay.cpc], tay: [ctrTay, cpmTay, cpcTay] }))

// ── T11. Kỳ trước KHÔNG có chi → không lỗi chia 0, ra moi_bat (nhip_chung_pct NULL). Đảo 2027-03, prev 01–07 rỗng ──
await c.query('savepoint s11'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam)
  values('actT11','T11A','A','OUTCOME_SALES','2027-03-10',800000,900,40)`)   // chỉ cur; prev 2027-03-01..07 rỗng
const vl11 = (await asCeo(`select kho.ads_viec_phai_lam('2027-03-08','2027-03-14') j`)).j
await c.query('rollback to savepoint s11')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T11. kỳ trước rỗng → không lỗi chia 0 · nhip_chung_pct NULL · có moi_bat',
  vl11.nhip_chung_pct === null && (vl11.viec || []).some(v => v.loai === 'moi_bat'), JSON.stringify({ nhip: vl11.nhip_chung_pct, loai: (vl11.viec || []).map(v => v.loai) }))

// ── T12 (L-05). Bấm-vào-link là TẬP CON của mọi lượt bấm → luot_bam_link ≤ luot_bam_tong ở MỌI chiến dịch thật ──
const bkL = (await one(`select kho.ads_bang_ky($1,$2) j`, [TU, DEN])).j
const coLink = bkL.dong.filter(d => d.luot_bam != null && d.luot_bam_tong != null)
const subset = coLink.every(d => Number(d.luot_bam) <= Number(d.luot_bam_tong))
const nguoc = coLink.filter(d => Number(d.luot_bam) > Number(d.luot_bam_tong)).map(d => d.campaign_name)
ok('T12. luot_bam_link ≤ clicks tổng ở mọi chiến dịch thật (' + coLink.length + ' cd) — bấm-link là tập con',
  coLink.length >= 5 && subset, nguoc.length ? 'NGƯỢC: ' + JSON.stringify(nguoc) : JSON.stringify(coLink.slice(0, 3).map(d => [d.luot_bam, d.luot_bam_tong])))

// ── T13. CTR mới (theo link) KHÁC CTR cũ (theo clicks tổng) — in bảng cũ vs mới cho thấy số đã đổi ──
console.log('   ── T13 · CTR cũ (clicks tổng) vs mới (bấm-vào-link) ──')
const t13 = coLink.filter(d => d.luot_hien_thi > 0 && d.luot_bam_tong > 0).slice(0, 5).map(d => {
  const ctrCu = Math.round(Number(d.luot_bam_tong) * 100 / Number(d.luot_hien_thi) * 100) / 100
  const ctrMoi = Number(d.ctr)   // RPC = link/hien_thi
  console.log('     ' + (d.campaign_name || '').slice(0, 34).padEnd(36) + ('CTR cũ ' + ctrCu + '%').padEnd(16) + '→ mới ' + ctrMoi + '%')
  return { ctrCu, ctrMoi }
})
const t13ok = t13.length >= 5 && t13.every(x => x.ctrMoi != null && x.ctrMoi > 0 && x.ctrMoi < 100 && Math.abs(x.ctrMoi - x.ctrCu) > 0.001 && x.ctrMoi <= x.ctrCu)
ok('T13. CTR mới (link) khác & ≤ CTR cũ (clicks tổng), nằm trong (0,100) — số đã đổi đúng hướng', t13ok, JSON.stringify(t13))

// ── T14. luot_bam_link NULL → ctr/cpc trả NULL + cờ, KHÔNG rơi về clicks tổng ──
await c.query('savepoint s14'); await c.query('reset role')
await c.query(`insert into kho.chi_chien_dich_ngay(act_id,campaign_id,campaign_name,objective,ngay,chi_tieu,hien_thi,luot_bam,luot_bam_link)
  values('1316832279835473','T14NULL','CD thiếu link','OUTCOME_SALES','2026-08-26',600000,10000,500,null)`)
const bk14 = (await asCeo(`select kho.ads_bang_ky($1,$2) j`, [TU, DEN])).j
const r14 = bk14.dong.find(d => d.campaign_id === 'T14NULL')
await c.query('rollback to savepoint s14')
await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: CEO, role: 'authenticated' })])
ok('T14. luot_bam_link NULL → ctr/cpc = NULL + cờ ctr_cpc_thieu_link, KHÔNG rơi về clicks tổng (500)',
  r14 && r14.ctr === null && r14.cpc === null && r14.ctr_cpc_thieu_link === true && r14.luot_bam === null && Number(r14.luot_bam_tong) === 500,
  JSON.stringify(r14 && { ctr: r14.ctr, cpc: r14.cpc, co: r14.ctr_cpc_thieu_link, link: r14.luot_bam, tong: r14.luot_bam_tong }))

await c.query('rollback')
const con = await one(`select (select count(*) from kho.chi_chien_dich_ngay where campaign_id in ('TNMSG01','TNMSG7','T9V','T14NULL')) a, (select count(*) from kho.ads_nguong where gia_tri=999999999999) b`)
console.log(`\nrollback xong · seed TNMSG01 còn: ${con.a} · ngưỡng bẻ còn: ${con.b} (phải 0/0)`)
console.log(`═══ test_wp93: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
