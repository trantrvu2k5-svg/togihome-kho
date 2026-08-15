// TEST CẮN — L-31 · RPC màn "Tải & lịch" (db/085). Tx rollback. cd web && node ops/test_085.mjs
// A1/A2 · tl_xep_thu (chạy thử = lưu, KHÔNG ghi) · tl_doi_viec (phụ, 3 cổng + lý do) · cổng vai · phân trang · tải · perf.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const AU = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', xuong: 'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  sale: 'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', tho: '73bbdefd-10af-4f44-9ab8-d92e029299a2',
  thiet_ke: '004aadb0-d1fb-40d3-b7ae-ca75c60b410e', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const g1 = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }
const QSTEPS = { QT2: ['cat', 'pu'], QT3: ['cat', 'dan', 'pu'] }
async function donQ(ma, hanExpr, qt) {
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai,ngay_hen_khach,ten_khach) values($1,'cho_cat',${hanExpr},'Khách '||$1) returning id`, [ma]))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,trang_thai) values($1,'m',$2,'cho_cat') returning id`, [don, qt]))[0].id
  for (const hd of QSTEPS[qt]) await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,$2,'chuan',10,'go_tay')`, [mon, hd])
  return { don, mon }
}

try {
  await c.query('begin')
  await c.query(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('QT2','2b'),('QT3','3b')`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi) values
    ('QT2',100,'{}','chung','cat','nguoi',0,0.5), ('QT2',200,'{100}','chung','pu','nguoi',0,0.5),
    ('QT3',100,'{}','chung','cat','nguoi',0,0.5), ('QT3',200,'{100}','chung','dan','nguoi',0,0.5), ('QT3',300,'{200}','chung','pu','nguoi',0,0.5)`)

  // seed đơn có hạn xa → luu_xep_lich (ceo) để có xep_lich
  const D = {}
  for (const [ma, qt] of [['L31-A','QT3'],['L31-B','QT2'],['L31-C','QT3'],['L31-D','QT2'],['L31-E','QT2']]) {
    D[ma] = await donQ(ma, 'current_date+70', qt)
    const rr = await asK(AU.ceo, `select kho.luu_xep_lich($1,'nguoc') g`, [ma])
    if (rr.e) console.log('   seed luu_xep_lich lỗi', ma, rr.e)
  }

  // ═══ NEW A · tl_xep_thu == luu_xep_lich (CÙNG lịch trên cùng tham số — chống hai thuật toán) ═══
  const han = (await q(`select kho.tuan_cua(current_date+70)::text d`))[0].d
  const thu = await g1(AU.ceo, `select kho.tl_xep_thu('L31-A',$1::date,'nguoc') g`, [han])
  const lichThu = (thu.lich || []).map(x => x.thu_tu + ':' + x.tuan_moi).sort().join(',')
  await asK(AU.ceo, `select kho.luu_xep_lich('L31-A','nguoc')`)
  const lichLuu = (await q(`select buoc_thu_tu, tuan_bat_dau::text t from kho.xep_lich where ma_don='L31-A' order by buoc_thu_tu`))
    .map(x => x.buoc_thu_tu + ':' + x.t).sort().join(',')
  ok('#A tl_xep_thu == luu_xep_lich cùng lịch (🟥 lệch = xem 1 đằng lưu 1 nẻo = ĐỎ)', lichThu === lichLuu, `thu=${lichThu} luu=${lichLuu}`)

  // ═══ NEW B · tl_xep_thu KHÔNG ghi gì ═══
  const n0 = Number((await q(`select count(*) n from kho.xep_lich`))[0].n)
  await asK(AU.ceo, `select kho.tl_xep_thu('L31-B',$1::date,'nguoc') g`, [han])
  await asK(AU.ceo, `select kho.tl_xep_thu('L31-B',$1::date,'xuoi') g`, [han])
  const n1 = Number((await q(`select count(*) n from kho.xep_lich`))[0].n)
  ok('#B tl_xep_thu KHÔNG ghi (xep_lich trước=sau)', n0 === n1, `${n0} vs ${n1}`)

  // ═══ 1 · BĂNG ĐẾM = LIST (5 ô) — không lặp lỗi sale ═══
  // dựng đủ 4 loại vấn đề
  await donQ('L31-TRE', 'current_date+7', 'QT2'); await asK(AU.ceo, `select kho.luu_xep_lich('L31-TRE','xuoi')`)  // xong sau hẹn
  const dg = await donQ('L31-THU', 'current_date+70', 'QT3'); await asK(AU.ceo, `select kho.luu_xep_lich('L31-THU','nguoc')`)
  // ép sai thứ tự: đẩy bước 300 (pu) về tuần sớm hơn bước 100
  await q(`update kho.xep_lich set tuan_bat_dau = kho.tuan_cua(current_date) where ma_don='L31-THU' and buoc_thu_tu=300`)
  const dm2 = await donQ('L31-DUNG', 'current_date+40', 'QT2')  // đứng yên: tien_do_tem cũ
  await q(`insert into kho.tem_ban_ve(ma_don,mon_id,ma_tam,phien_ban,vai_tro,dai,rong,day) values('L31-DUNG',$1,'TDUNG1',1,'hong',100,100,18)`, [dm2.mon]).catch(()=>{})
  await q(`insert into kho.tien_do_tem(tem_ma,mon_id,ma_don,trang_thai,cap_nhat_luc) values('TDUNG1',$1,'L31-DUNG','dang_lam', now()-interval '5 days')`, [dm2.mon])
  await donQ('L31-THIEU', 'current_date+40', 'QT2')  // thiếu: production, xoá gio_don_da_tinh chuan
  await q(`delete from kho.gio_don_da_tinh where ma_don='L31-THIEU' and moc='chuan'`)

  const dem = await g1(AU.ceo, `select to_jsonb(t) g from kho.tl_don_co_van_de('tat',null,null,100,0) t limit 1`)
  const cnt = {};
  for (const loai of ['tat','tre','thu_tu','dung','thieu']) {
    const rows = await asK(AU.ceo, `select tong_so from kho.tl_don_co_van_de($1,null,null,500,0) limit 1`, [loai])
    cnt[loai] = rows.r && rows.r.length ? Number(rows.r[0].tong_so) : 0
  }
  console.log('   băng:', JSON.stringify({tat:dem.dem_tat, tre:dem.dem_tre, thu_tu:dem.dem_thu_tu, dung:dem.dem_dung, thieu:dem.dem_thieu}), '| list:', JSON.stringify(cnt))
  ok('#1 băng đếm = list, cả 5 ô (🟥 lệch 1 ô = ĐỎ)',
    Number(dem.dem_tat)===cnt.tat && Number(dem.dem_tre)===cnt.tre && Number(dem.dem_thu_tu)===cnt.thu_tu &&
    Number(dem.dem_dung)===cnt.dung && Number(dem.dem_thieu)===cnt.thieu &&
    cnt.thu_tu>=1 && cnt.dung>=1 && cnt.thieu>=1)

  // ═══ 2 · tl_doi_viec sai thứ tự → CHẶN ═══
  const vA = (await q(`select id, buoc_thu_tu, tuan_bat_dau::text t from kho.xep_lich where ma_don='L31-A' order by buoc_thu_tu`))
  const pu = vA[vA.length-1], cat = vA[0]  // pu (cuối) không được lùi trước cat
  const r2 = await asK(AU.ceo, `select kho.tl_doi_viec($1, kho.tuan_cua(current_date-7), false, 'thử sai thứ tự') g`, [pu.id])
  ok('#2 tl_doi_viec tuần vi phạm buoc_truoc → CHẶN (🟥 cho qua = ĐỎ)', !!r2.e && /thứ tự|đóng băng|thứ Hai/.test(r2.e), r2.e || 'KHÔNG chặn')

  // ═══ 2b · lý do trống → CHẶN ═══
  const goodWeek = (await q(`select kho.tuan_cua(current_date+77)::text d`))[0].d
  const r2b = await asK(AU.ceo, `select kho.tl_doi_viec($1, $2::date, false, '') g`, [pu.id, goodWeek])
  ok('#2b tl_doi_viec lý do TRỐNG → CHẶN', !!r2b.e && /lý do/.test(r2b.e), r2b.e || 'KHÔNG chặn')

  // ═══ 3 · đóng băng: xuong+ngoại lệ CHẶN · ceo+ngoại lệ+lý do OK ═══
  const dbWeek = (await q(`select kho.tuan_cua(current_date)::text d`))[0].d  // tuần này = đóng băng
  // chọn 1 việc cat (đầu chuỗi) để dời vào tuần đóng băng — cat không có bước trước nên thứ tự OK
  const vB = (await q(`select id from kho.xep_lich where ma_don='L31-B' order by buoc_thu_tu limit 1`))[0]
  const r3x = await asK(AU.xuong, `select kho.tl_doi_viec($1, $2::date, true, 'xuong thử ngoại lệ') g`, [vB.id, dbWeek])
  ok('#3 vai XUONG + ngoai_le=true vào đóng băng → CHẶN (chỉ ceo)', !!r3x.e && /CEO|ceo/.test(r3x.e), r3x.e || 'KHÔNG chặn')
  const r3n = await asK(AU.ceo, `select kho.tl_doi_viec($1, $2::date, false, 'ceo không ngoại lệ') g`, [vB.id, dbWeek])
  ok('#3 ceo KHÔNG ngoại lệ vào đóng băng → CHẶN', !!r3n.e && /ngoại lệ|đóng băng/.test(r3n.e), r3n.e || 'KHÔNG chặn')
  const r3c = await g1(AU.ceo, `select kho.tl_doi_viec($1, $2::date, true, 'khách cần gấp — CEO duyệt') g`, [vB.id, dbWeek])
  ok('#3 ceo + ngoại lệ + lý do vào đóng băng → ĐƯỢC', r3c && r3c.ok === true, JSON.stringify(r3c))

  // ═══ 4 · dời việc đổi TẢI THẬT (tổ cũ giảm, tổ mới tăng đúng giờ) ═══
  const vC = (await q(`select id, ma_to, gio, tuan_bat_dau::text t, buoc_thu_tu from kho.xep_lich where ma_don='L31-C' order by buoc_thu_tu desc limit 1`))[0]
  const cuW = vC.t, gio = Number(vC.gio)
  const moiW = (await q(`select ($1::date + 7)::text d`, [cuW]))[0].d  // dời muộn 1 tuần (bước cuối → hợp lệ)
  const g_cu0 = Number((await q(`select coalesce(sum(gio),0) s from kho.xep_lich where ma_to=$1 and tuan_bat_dau=$2`, [vC.ma_to, cuW]))[0].s)
  const g_moi0 = Number((await q(`select coalesce(sum(gio),0) s from kho.xep_lich where ma_to=$1 and tuan_bat_dau=$2`, [vC.ma_to, moiW]))[0].s)
  const r4 = await g1(AU.ceo, `select kho.tl_doi_viec($1, $2::date, false, 'dời thử tải') g`, [vC.id, moiW])
  const g_cu1 = Number((await q(`select coalesce(sum(gio),0) s from kho.xep_lich where ma_to=$1 and tuan_bat_dau=$2`, [vC.ma_to, cuW]))[0].s)
  const g_moi1 = Number((await q(`select coalesce(sum(gio),0) s from kho.xep_lich where ma_to=$1 and tuan_bat_dau=$2`, [vC.ma_to, moiW]))[0].s)
  console.log(`   ${vC.ma_to}: cũ ${g_cu0}→${g_cu1} (giảm ${g_cu0-g_cu1}) · mới ${g_moi0}→${g_moi1} (tăng ${g_moi1-g_moi0}) · gio việc ${gio}`)
  ok('#4 dời việc: tổ cũ giảm đúng giờ · tổ mới tăng đúng giờ', r4.ok && Math.abs((g_cu0-g_cu1)-gio)<0.01 && Math.abs((g_moi1-g_moi0)-gio)<0.01)

  // ═══ 5 · phân trang tl_viec_trong_o (>12 việc/ô → 12 + tong_so) ═══
  const pw = (await q(`select kho.tuan_cua(current_date+140)::text d`))[0].d
  for (let i=0;i<15;i++) await q(`insert into kho.xep_lich(ma_don,mon_id,buoc_thu_tu,hoat_dong,tuan_bat_dau,ma_to,gio,kieu_xep) values('L31-A',$2,100,'cat',$1,'cnc',5,'nguoc')`, [pw, D['L31-A'].mon])
  const pg5 = await asK(AU.ceo, `select viec_id, tong_so from kho.tl_viec_trong_o('cnc',$1::date,12,0)`, [pw])
  ok('#5 phân trang: trả 12 dòng · tong_so>=15', pg5.r.length===12 && Number(pg5.r[0].tong_so)>=15, `${pg5.r.length} dòng · tong_so=${pg5.r[0]?.tong_so}`)

  // ═══ 7 · CỔNG VAI ═══
  const goi = (uid) => asK(uid, `select kho.tl_don_co_van_de('tat',null,null,5,0)`)
  const vao = async uid => { const x = await goi(uid); return !x.e }
  ok('#7 ceo VÀO', await vao(AU.ceo)); ok('#7 xuong VÀO', await vao(AU.xuong))
  ok('#7 tho CHẶN', !(await vao(AU.tho))); ok('#7 sale CHẶN', !(await vao(AU.sale)))
  ok('#7 thiet_ke CHẶN', !(await vao(AU.thiet_ke))); ok('#7 ke_toan CHẶN', !(await vao(AU.ke_toan)))
  const rNull = await asK('00000000-0000-0000-0000-000000000000', `select kho.tl_don_co_van_de('tat')`)  // uid vô danh → không vai
  ok('#7 vô danh (không vai) CHẶN', !!rNull.e, rNull.e || 'KHÔNG chặn')

  console.log(`\n══ KẾT QUẢ 085 (đúng đắn): ${P} pass · ${F} fail ══`)
} catch (e) {
  console.error('LỖI TEST:', e.message, '\n', e.stack); F++
} finally {
  await c.query('rollback'); await c.end(); process.exit(F ? 1 : 0)
}
