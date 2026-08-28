// TEST CẮN — WP-45 (db/160): hai hàng rào (demand + planning) · bỏ dời lẻ · neo thứ 4.
//   Đơn demo clone từ T8-001 (KHÔNG đụng T8-001). Tx rollback → 0 dấu vết.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 180) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const uid = async v => (await one(`select auth_uid a from kho.nguoi_dung where vai_tro=$1 and auth_uid is not null order by ho_ten limit 1`, [v]))?.a
const U = { ceo: await uid('ceo'), thiet_ke: await uid('thiet_ke'), tho: await uid('tho') }
const TK_NS = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [U.thiet_ke])).id
const T8 = (await one(`select id from kho.don_hang where ma_don='T8-001'`)).id
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: 'wp45/cat.dxf', ten_goc: 'cat.dxf', co_byte: 100 }])

async function mkDon(sfx, hen, tt = 'moi_len_don') {
  const ma = 'DEMO-WP45-' + sfx
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach,ma_ns_thiet_ke,ngay_hen_khach)
    values($1,'DEMO wp45 ${sfx}',true,'le',$2,$3,'gioi_thieu',$4,$5) returning id`, [ma, tt, TH, TK_NS, hen])).id
  for (const m of await q(`select id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh from kho.don_hang_mon where don_id=$1`, [T8])) {
    const nm = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh)
      values($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [did, m.ten, m.sp_id, m.ma_quy_trinh, m.vl, m.kt, m.so_luong, m.gia, m.ma_mau, m.chi_tiet, m.khong_gian, m.anh])).id
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,moc)
      select $1,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,'chuan' from kho.so_don_vi_mon where mon_id=$2 and moc='chuan'`, [nm, m.id])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung)
      select $1,vat_tu_id,so_luong,don_vi,nguon,'du_kien',hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung from kho.don_hang_mon_bom where mon_id=$2 and moc='chuan'`, [nm, m.id])
  }
  await c.query(`set local session_replication_role='origin'`)
  return { ma, did }
}
const snap = async ma => await q(`select id, buoc_thu_tu, mon_id, to_char(tuan_bat_dau,'YYYY-MM-DD') tuan, ma_to, gio from kho.xep_lich where ma_don=$1 order by id`, [ma])
const eqSnap = (a, b) => a.length === b.length && a.every((r, i) => r.id === b[i].id && r.tuan === b[i].tuan)
const maxTuan = async ma => (await one(`select to_char(max(tuan_bat_dau),'YYYY-MM-DD') w from kho.xep_lich where ma_don=$1`, [ma])).w

await c.query('begin')
const before = (await one(`select count(*)::int n from kho.don_hang`)).n
const homNay = (await one(`select current_date d`)).d
const henXa = new Date(homNay.getTime() + 56 * 864e5).toISOString().slice(0, 10)

// ═══ 10.1 · đơn ĐÃ bàn giao (đã khoá) → luu_xep_lich(p_tu_dong=true) BỎ QUA, xep_lich giữ nguyên ═══
{ const D = await mkDon('A', henXa)
  await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null) j`, [], true)
  const khoa = (await one(`select khoa_lich_luc is not null k from kho.don_hang where ma_don=$1`, [D.ma])).k
  const s0 = await snap(D.ma)
  const r = await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','nguoc',false,null,true) j`, [], true)
  const j = r.r && r.r[0].j
  const s1 = await snap(D.ma)
  console.log(`   10.1 khoá=${khoa} · trả=${JSON.stringify(j)} · dòng trước=${s0.length} sau=${s1.length}`)
  ok('10.1 demand fence: máy gọi đơn đã khoá → ok=false DA_KHOA_LICH, KHÔNG raise', !r.e && j?.ok === false && j?.ly_do === 'DA_KHOA_LICH', r.e || JSON.stringify(j))
  ok('10.1 xep_lich giữ NGUYÊN từng dòng (id + tuần)', s0.length > 0 && eqSnap(s0, s1), `trước ${s0.length} sau ${s1.length}`) }

// ═══ 10.2 · cùng đơn: nut_that_ghi() → xep_lich KHÔNG đổi dòng nào ═══
{ const s0 = await snap('DEMO-WP45-A')
  const r = await as(U.ceo, `select kho.nut_that_ghi() j`, [], true)
  const s1 = await snap('DEMO-WP45-A')
  console.log(`   10.2 nut_that_ghi=${JSON.stringify(r.r && r.r[0].j)} · dòng trước=${s0.length} sau=${s1.length} · giữ nguyên=${eqSnap(s0, s1)}`)
  ok('10.2 nut_that_ghi KHÔNG ghi lại xep_lich (đọc để tính nút thắt)', !r.e && eqSnap(s0, s1) && s0.length > 0, r.e || 'đổi dòng') }

// ═══ 10.3 · đơn CHƯA cho_cat (chưa khoá) → hạ năng lực một tổ → xếp lại tự động → lịch DẠT ═══
{ const D = await mkDon('B', null, 'moi_len_don')   // chưa bàn giao → chưa khoá
  await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','xuoi',false,null,true) j`, [], true)   // xếp lần đầu (máy)
  const w0 = await maxTuan(D.ma)
  // ô bận nhất (tổ,tuần) → hạ năng lực tổ đó xuống 0,6× tải đỉnh để 1 bước tràn
  const cell = await one(`select ma_to, sum(gio) g, count(*)::int n from kho.xep_lich where ma_don=$1 group by ma_to, tuan_bat_dau order by sum(gio) desc limit 1`, [D.ma])
  const nl = await one(`select so_nguoi, ngay_moi_tuan, he_so_huu_ich from kho.nang_luc_to where ma_to=$1 and den_ngay is null limit 1`, [cell.ma_to])
  const capMoi = Number(cell.g) * 0.6
  const gmnMoi = capMoi / (Number(nl.so_nguoi) * Number(nl.ngay_moi_tuan) * Number(nl.he_so_huu_ich))
  await c.query(`update kho.nang_luc_to set gio_moi_ngay=$1 where ma_to=$2 and den_ngay is null`, [gmnMoi, cell.ma_to])
  await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','xuoi',false,null,true) j`, [], true)   // xếp lại (máy)
  const w1 = await maxTuan(D.ma)
  console.log(`   10.3 tổ hạ=${cell.ma_to} (tải đỉnh ${Number(cell.g).toFixed(2)}, ${cell.n} bước) · tuần cuối ${w0} → ${w1}`)
  ok('10.3 planning fence (chưa cho_cat): hạ năng lực → lịch DẠT trễ hơn', w0 && w1 && new Date(w1 + 'T00:00:00Z') > new Date(w0 + 'T00:00:00Z'), `${w0} vs ${w1} (tổ ${cell.n} bước)`) }

// ═══ 10.4 · đơn TỪ cho_cat: người bấm KHÔNG lý do → RAISE; có lý do đúng vai → được + ly_do lưu ═══
{ const D = await mkDon('C', henXa)
  await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null) j`, [], true)  // → cho_cat + khoá
  const rNo = await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','nguoc',false,null,false) j`)   // người, KHÔNG lý do
  const LY = 'khách đổi ngày giao'
  const rYes = await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','nguoc',false,'${LY}',false) j`, [], true)
  const lyLuu = (await one(`select max(ly_do) ly from kho.xep_lich where ma_don=$1`, [D.ma])).ly
  console.log(`   10.4 không lý do → ${rNo.e ? 'RAISE: ' + rNo.e.replace(/^.*luu_xep_lich:\s*/, '').slice(0, 55) : 'KHÔNG raise!'} · có lý do → ok=${rYes.r && rYes.r[0].j?.ok} · ly_do lưu=${JSON.stringify(lyLuu)}`)
  ok('10.4 planning fence (cho_cat): người bấm KHÔNG lý do → RAISE', !!rNo.e && /BẮT BUỘC có lý do|sản xuất/.test(rNo.e), rNo.e || 'không raise')
  ok('10.4 có lý do + đúng vai → xếp được, ly_do lưu vào xep_lich', !rYes.e && rYes.r[0].j?.ok === true && lyLuu === LY, rYes.e || `ly=${lyLuu}`) }

// ═══ 10.5 · vai tho xếp lại đơn đã cho_cat → từ chối ═══
{ const rtho = await as(U.tho, `select kho.luu_xep_lich('DEMO-WP45-C','nguoc',false,'thử',false) j`)
  ok('10.5 vai tho gọi luu_xep_lich → TỪ CHỐI', !!rtho.e && /ceo\/xuong|chỉ/.test(rtho.e), rtho.e || 'KHÔNG chặn') }

// ═══ 10.6 · xếp lại cả đơn → THỨ TỰ CHUỖI: tuần bước n ≤ tuần bước n+1 mọi bước/món ═══
{ const D = await mkDon('D', henXa)
  await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null) j`, [], true)
  await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','nguoc',false,'kiểm chuỗi',false) j`, [], true)
  const bad = await q(`select a.mon_id, a.buoc_thu_tu ta, b.buoc_thu_tu tb, a.tuan_bat_dau wa, b.tuan_bat_dau wb
    from kho.xep_lich a join kho.xep_lich b on a.mon_id=b.mon_id and a.buoc_thu_tu < b.buoc_thu_tu
    where a.ma_don=$1 and b.ma_don=$1 and a.tuan_bat_dau > b.tuan_bat_dau`, [D.ma])
  console.log(`   10.6 cặp bước NGƯỢC thứ tự (tuần trước > tuần sau): ${bad.length}`)
  ok('10.6 xếp cả đơn giữ THỨ TỰ CHUỖI (tuần bước n ≤ n+1 mọi món)', bad.length === 0, JSON.stringify(bad.slice(0, 2))) }

// ═══ 10.7 · tl_doi_viec biến mất khỏi pg_proc ═══
{ const con = (await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='kho' and p.proname='tl_doi_viec'`)).n
  ok('10.7 tl_doi_viec ĐÃ DROP khỏi pg_proc', con === 0, `còn ${con}`) }

await c.query('rollback')
const after = (await one(`select count(*)::int n from kho.don_hang`)).n
ok('DỌN · rollback sạch, T8-001 KHÔNG chạm', before === after, `${before} vs ${after}`)
ok('DỌN · xep_lich prod = 0', (await one(`select count(*)::int n from kho.xep_lich`)).n === 0)
console.log(`\nKẾT QUẢ test_wp45: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
