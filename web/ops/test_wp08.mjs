// TEST CẮN — WP-08 (db/169): phiên bản mẫu + neo theo món. Outer BEGIN…ROLLBACK → 0 dấu vết. KHÔNG đo 100k.
//   a bàn giao DEMO → neo=1 · b chưa bàn giao → NULL, buoc_cua_mon vẫn đủ · c unique (ma,pb,thu_tu)
//   d một hien_hanh/mẫu · e buoc_cua_mon món neo v1 đúng số bước v1 · f quy_trinh_cua_mon suy qua san_pham
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 170) : '')); v ? P++ : F++ }
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
const CEO = await uid('ceo'); const TK = await uid('thiet_ke'); const TK_NS = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [TK])).id
const T8 = (await one(`select id from kho.don_hang where ma_don='T8-001'`)).id
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: 'wp08/cat.dxf', ten_goc: 'cat.dxf', co_byte: 100 }])
async function mkDon(sfx) {
  const ma = 'DEMO-WP08-' + sfx
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach,ma_ns_thiet_ke)
    values($1,'DEMO wp08 ${sfx}',true,'le','moi_len_don',$2,'gioi_thieu',$3) returning id`, [ma, TH, TK_NS])).id
  for (const m of await q(`select id,ten,sp_id,ma_quy_trinh,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh from kho.don_hang_mon where don_id=$1`, [T8])) {
    const nm = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh)
      values($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [did, m.ten, m.sp_id, m.ma_quy_trinh, m.vl, m.kt, m.so_luong, m.gia, m.ma_mau, m.chi_tiet, m.khong_gian, m.anh])).id
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,moc) select $1,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,'chuan' from kho.so_don_vi_mon where mon_id=$2 and moc='chuan'`, [nm, m.id])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung) select $1,vat_tu_id,so_luong,don_vi,nguon,'du_kien',hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung from kho.don_hang_mon_bom where mon_id=$2 and moc='chuan'`, [nm, m.id])
  }
  await c.query(`set local session_replication_role='origin'`)
  return { ma, did }
}
const buocCount = async monId => (await one(`select count(*)::int n from kho.buoc_cua_mon($1)`, [monId])).n
const qtbCount = async (ma, pb) => (await one(`select count(*)::int n from kho.quy_trinh_buoc where ma_quy_trinh=$1 and phien_ban=$2`, [ma, pb])).n

await c.query('begin')

// ═══ a · bàn giao DEMO (đúng đường RPC) → món có quy_trinh_phien_ban=1 ═══
{ const D = await mkDon('A')
  const r = await as(CEO, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const mons = await q(`select ten, ma_quy_trinh, quy_trinh_phien_ban pb from kho.don_hang_mon where don_id=$1`, [D.did])
  console.log('   a bàn giao ok? ' + (r.r ? (r.r[0].j.ok) : r.e) + ' · món: ' + JSON.stringify(mons.map(m => ({ [m.ten]: m.pb }))))
  ok('a. bàn giao qua RPC → mọi món neo quy_trinh_phien_ban = 1', !r.e && mons.length > 0 && mons.every(m => m.pb === 1), r.e || JSON.stringify(mons))
}

// ═══ b · món CHƯA bàn giao → NULL, buoc_cua_mon vẫn trả đủ bước theo hien_hanh ═══
{ const D = await mkDon('B')
  const m = await one(`select id, ma_quy_trinh, quy_trinh_phien_ban pb from kho.don_hang_mon where don_id=$1 limit 1`, [D.did])
  const bcount = await buocCount(m.id); const expect = await qtbCount(m.ma_quy_trinh, 1)
  console.log(`   b món chưa bàn giao pb=${m.pb} · buoc_cua_mon=${bcount} · quy_trinh_buoc v1=${expect}`)
  ok('b. món chưa bàn giao → pb NULL; buoc_cua_mon đủ bước theo bản hien_hanh', m.pb === null && bcount === expect && bcount > 0, JSON.stringify(m))
}

// ═══ c · unique(ma,pb,thu_tu): v2 cùng thu_tu → PASS; trùng (ma,pb,thu_tu) → chặn ═══
{ await c.query('savepoint sc')
  let e1 = null, e2 = null
  try { await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,phien_ban,thu_tu,hoat_dong,nhanh) values('KE-HO-MELAMINE',2,100,'cat','chung')`) } catch (x) { e1 = x.message }
  try { await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,phien_ban,thu_tu,hoat_dong,nhanh) values('KE-HO-MELAMINE',2,100,'dan','chung')`) } catch (x) { e2 = x.message }
  console.log(`   c v2/thu_tu100 chèn: ${e1 ? 'LỖI ' + e1.slice(0, 40) : 'OK'} · trùng (ma,2,100): ${e2 ? 'CHẶN' : 'LỌT ⚠'}`)
  ok('c. v2 cùng (ma,thu_tu) → PASS; trùng (ma,pb,thu_tu) → chặn', !e1 && !!e2 && /duplicate|unique/i.test(e2), (e1 || '') + ' | ' + (e2 || 'không chặn'))
  await c.query('rollback to savepoint sc')
}

// ═══ d · hai dòng hien_hanh cùng ma_quy_trinh → chặn ═══
{ await c.query('savepoint sd')
  let e = null
  try { await c.query(`insert into kho.quy_trinh_phien_ban(ma_quy_trinh,phien_ban,trang_thai,ly_do) values('KE-HO-MELAMINE',2,'hien_hanh','test')`) } catch (x) { e = x.message }
  console.log(`   d thêm hien_hanh thứ 2: ${e ? 'CHẶN' : 'LỌT ⚠'}`)
  ok('d. hai dòng hien_hanh cùng mẫu → chặn (partial unique)', !!e && /duplicate|unique|uq_qtpb/i.test(e), e || 'không chặn')
  await c.query('rollback to savepoint sd')
}

// ═══ e · buoc_cua_mon của món ĐÃ NEO v1 → đúng số bước quy_trinh_buoc v1 ═══
{ const m = await one(`select m.id, m.ma_quy_trinh from kho.don_hang_mon m where m.quy_trinh_phien_ban = 1 limit 1`)
  const bcount = await buocCount(m.id); const expect = await qtbCount(m.ma_quy_trinh, 1)
  console.log(`   e món neo v1 · buoc_cua_mon=${bcount} · v1=${expect}`)
  ok('e. buoc_cua_mon món neo v1 = số bước quy_trinh_buoc v1', bcount === expect && bcount > 0, `${bcount} vs ${expect}`)
}

// ═══ f · quy_trinh_cua_mon với món TRỐNG ma_quy_trinh → suy qua san_pham_mau→san_pham_loi ═══
{ const sp = await one(`select sp.ma sp_ma, l.ma_quy_trinh from kho.san_pham_mau sp join kho.san_pham_loi l on l.ma_loi=sp.ma_loi where l.ma_quy_trinh is not null limit 1`)
  if (!sp) { ok('f. quy_trinh_cua_mon suy qua san_pham', false, 'KHÔNG có san_pham_mau→loi nào có ma_quy_trinh để thử — báo, không đoán'); }
  else { await c.query('savepoint sf'); await c.query(`set local session_replication_role='replica'`)
    const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('DEMO-WP08-F','x',true,'le','moi_len_don',$1,'gioi_thieu') returning id`, [TH])).id
    const mid = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,ma_quy_trinh,dung_moi,so_luong) values($1,'m',$2,null,false,1) returning id`, [did, sp.sp_ma])).id
    await c.query(`set local session_replication_role='origin'`)
    const got = await one(`select ma_quy_trinh, phien_ban from kho.quy_trinh_cua_mon($1)`, [mid])
    const hh = (await one(`select phien_ban from kho.quy_trinh_phien_ban where ma_quy_trinh=$1 and trang_thai='hien_hanh'`, [sp.ma_quy_trinh]))?.phien_ban
    console.log(`   f món trống ma_quy_trinh (sp=${sp.sp_ma}) → suy ma=${got?.ma_quy_trinh} pb=${got?.phien_ban} (mong ${sp.ma_quy_trinh}/${hh ?? 'null'})`)
    ok('f. quy_trinh_cua_mon món trống ma_quy_trinh → suy đúng mẫu qua san_pham_mau→san_pham_loi', got?.ma_quy_trinh === sp.ma_quy_trinh && got?.phien_ban === (hh ?? null), JSON.stringify(got))
    await c.query('rollback to savepoint sf')
  }
}

// ══════════ L-03: ĐỌC THEO PHIÊN BẢN ĐÃ NEO ══════════
const TU = 'TU-AO-MELAMINE'
const tramOf = async (qt, tt) => (await one(`select tr.ma_tram m from kho.quy_trinh_buoc b join kho.tram tr on tr.hoat_dong=b.hoat_dong where b.ma_quy_trinh=$1 and b.phien_ban=1 and b.thu_tu=$2`, [qt, tt]))?.m
const NS = (await one(`select id from kho.nguoi_dung where auth_uid is not null order by id limit 1`)).id
const tdt = async (tem) => { const r = await as(CEO, `select kho.tien_do_tam($1,null) j`, [tem]); return r.r ? r.r[0].j : { _e: r.e } }
async function raTo(tem, qt, buocs) {   // chèn thẳng 'ra' tới các bước (bypass sq_ghi/phien)
  await c.query(`set local session_replication_role='replica'`)
  for (const b of buocs) { const t = await tramOf(qt, b); await c.query(`insert into kho.su_kien_quet(tem_ma,ma_tram,nguoi_id,loai,ket_qua,luc) values($1,$2,$3,'vao','nhan',now()-interval '9 min'),($1,$2,$3,'ra','nhan',now()-interval '8 min')`, [tem, t, NS]) }
  await c.query(`set local session_replication_role='origin'`)
}
async function tuMon(tem, neoV1) {   // đơn+món TU-AO+tem; neoV1=true → quy_trinh_phien_ban=1
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('DEMO-WP08-'||$2,'x',true,'le','cho_cat',$1,'gioi_thieu') returning id`, [TH, tem])).id
  const mid = (await one(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,dung_moi,so_luong) values($1,'tu',$2,false,1) returning id`, [did, TU])).id
  if (neoV1) await c.query(`update kho.don_hang_mon set quy_trinh_phien_ban=1 where id=$1`, [mid])
  await c.query(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro,mon_id) values('DEMO-WP08-'||$1,1,$1,'carcass',$2)`, [tem, mid])
  await c.query(`set local session_replication_role='origin'`); return { did, mid }
}

await c.query('savepoint l03')   // cô lập L-03 (dựng TU-AO v2) để L-04 bắt đầu với TU-AO sạch (chỉ v1)
// L3a · dựng TU-AO v2 = v1 + thêm 1 bước mới (hoat_dong riêng) + đổi to_phu_trach + đổi giờ; v2 hien_hanh, v1 cu
{ const hMoi = await one(`select d.hoat_dong h, (select ma_tram from kho.tram t where t.hoat_dong=d.hoat_dong limit 1) tram from kho.don_gia_baseline d
    where d.hoat_dong not in (select hoat_dong from kho.quy_trinh_buoc where ma_quy_trinh=$1 and phien_ban=1)
      and exists(select 1 from kho.tram t where t.hoat_dong=d.hoat_dong) limit 1`, [TU])
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,phien_ban,thu_tu,hoat_dong,buoc_truoc,nhanh,loai_buoc,gio_co_dinh,gio_moi_don_vi,la_tam,to_phu_trach,ghi_chu)
    select ma_quy_trinh,2,thu_tu,hoat_dong,buoc_truoc,nhanh,loai_buoc,gio_co_dinh,gio_moi_don_vi,la_tam,to_phu_trach,ghi_chu from kho.quy_trinh_buoc where ma_quy_trinh=$1 and phien_ban=1`, [TU])
  await c.query(`insert into kho.quy_trinh_buoc(ma_quy_trinh,phien_ban,thu_tu,hoat_dong,buoc_truoc,nhanh,loai_buoc,gio_moi_don_vi) values($1,2,350,$2,'{250}','chung','nguoi',0.1)`, [TU, hMoi.h])
  await c.query(`update kho.quy_trinh_buoc set to_phu_trach='TO-DOI-V2' where ma_quy_trinh=$1 and phien_ban=2 and thu_tu=100`, [TU])
  await c.query(`update kho.quy_trinh_buoc set gio_moi_don_vi=9.99 where ma_quy_trinh=$1 and phien_ban=2 and thu_tu=100`, [TU])
  await c.query(`update kho.quy_trinh_phien_ban set trang_thai='cu' where ma_quy_trinh=$1 and phien_ban=1`, [TU])
  await c.query(`insert into kho.quy_trinh_phien_ban(ma_quy_trinh,phien_ban,trang_thai,ly_do) values($1,2,'hien_hanh','test L-03')`, [TU])
  await c.query(`set local session_replication_role='origin'`)
  console.log(`   L3a v2 dựng: +bước 350 (${hMoi.h}) · đổi to_phu_trach/giờ bước 100 · v2 hien_hanh`)
  ok('L3a. TU-AO v2 = hien_hanh (v1→cu); v1 còn nguyên', (await one(`select trang_thai from kho.quy_trinh_phien_ban where ma_quy_trinh=$1 and phien_ban=2`, [TU])).trang_thai === 'hien_hanh' && (await one(`select trang_thai from kho.quy_trinh_phien_ban where ma_quy_trinh=$1 and phien_ban=1`, [TU])).trang_thai === 'cu') }

// L3b · món ĐÃ NEO v1: tien_do_tam trả bước ĐÚNG NHƯ v1 — KHÔNG thấy bước 350 của v2
{ const M = await tuMon('L3B', true); await raTo('L3B', TU, [100, 200, 250])
  const td = await tdt('L3B'); const ds = (td.buoc_ke_ds || []).map(x => x.thu_tu)
  console.log(`   L3b món neo v1 · buoc_ke_ds=${JSON.stringify(ds)} · tong_buoc=${td.tong_buoc}`)
  ok('L3b. món neo v1 → tien_do_tam theo v1 ({300,310}, KHÔNG có 350), tong_buoc=8', JSON.stringify(ds) === JSON.stringify([300, 310]) && td.tong_buoc === 8, JSON.stringify(td.buoc_ke_ds)) }

// L3c · món CHƯA bàn giao (NULL): tien_do_tam theo v2 (bản hien_hanh) — CÓ bước 350 (ERP 6.5.5)
{ const M = await tuMon('L3C', false); await raTo('L3C', TU, [100, 200, 250])
  const td = await tdt('L3C'); const ds = (td.buoc_ke_ds || []).map(x => x.thu_tu)
  console.log(`   L3c món chưa neo · buoc_ke_ds=${JSON.stringify(ds)} · tong_buoc=${td.tong_buoc}`)
  ok('L3c. món chưa bàn giao → tien_do_tam theo v2 (có 350), tong_buoc=9', ds.includes(350) && td.tong_buoc === 9, JSON.stringify(td.buoc_ke_ds)) }

// L3d · gio_du_kien_cua_mon của món neo v1 KHÔNG đổi khi v2 sửa giờ bước 100
{ // cần số chuẩn cho bước TU-AO → chèn so_don_vi cho cả 2 món
  const addSo = async mid => { await c.query(`set local session_replication_role='replica'`)
    for (const b of await q(`select distinct hoat_dong from kho.quy_trinh_buoc where ma_quy_trinh=$1 and phien_ban=1`, [TU]))
      await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,moc,nguon,nguoi_nhap) values($1,$2,1,'chuan','go_tay',$3) on conflict do nothing`, [mid, b.hoat_dong, NS])
    await c.query(`set local session_replication_role='origin'`) }
  const V1 = await tuMon('L3D1', true); const V2 = await tuMon('L3D2', false)
  await addSo(V1.mid); await addSo(V2.mid)
  const g1 = (await as(CEO, `select kho.gio_du_kien_cua_mon($1,'chuan') j`, [V1.mid])).r[0].j
  const g2 = (await as(CEO, `select kho.gio_du_kien_cua_mon($1,'chuan') j`, [V2.mid])).r[0].j
  const gio100 = j => (j.buoc || []).find(x => x.thu_tu === 100)?.gio
  console.log(`   L3d giờ bước100: neo-v1=${gio100(g1)} · v2=${gio100(g2)} (v2 đổi gmdv→9.99)`)
  ok('L3d. gio_du_kien món neo v1 KHÔNG đổi khi v2 sửa giờ (bước100 v1 ≠ v2)', gio100(g1) !== gio100(g2) && Number(gio100(g2)) >= 9.99, `${gio100(g1)} vs ${gio100(g2)}`) }

// L3e · sched_buoc/lịch của món neo v1 → đọc theo v1 (không bước 350)
{ const M = await tuMon('L3E', true)
  const rows = await q(`select thu_tu from kho.sched_buoc((select ma_don from kho.don_hang where id=$1),'chuan') order by thu_tu`, [M.did]).catch(async () => (await as(CEO, `select thu_tu from kho.sched_buoc((select ma_don from kho.don_hang where id=${M.did}),'chuan')`)).r || [])
  const tts = rows.map(r => r.thu_tu)
  console.log(`   L3e sched_buoc món neo v1 · thu_tu=${JSON.stringify(tts)}`)
  ok('L3e. sched_buoc món neo v1 → theo v1 (KHÔNG có 350)', !tts.includes(350) && tts.includes(300) && tts.includes(310), JSON.stringify(tts)) }

// L3f · grep: hàm nhóm THEO MÓN KHÔNG còn tự SELECT quy_trinh_buoc (trừ buoc_cua_mon/quy_trinh_cua_mon)
{ const theoMon = ['tien_do_tam', 'capnhat_tien_do_tem', 'sq_ghi', 'do_gio_that', 'gio_du_kien_cua_mon', 'nhap_so_chi_tiet_mon', 'viec_dang_giu', 'sched_buoc', 'dung_lai_gio_don_moc', 'tl_don_co_van_de', 'tl_tuan_doi_duoc']
  const conbad = []
  for (const fn of theoMon) { const s = (await one(`select prosrc s from pg_proc where proname=$1 and pronamespace='kho'::regnamespace`, [fn])).s; if (/quy_trinh_buoc/.test(s)) conbad.push(fn) }
  console.log(`   L3f hàm theo-món còn SELECT quy_trinh_buoc: ${conbad.length ? JSON.stringify(conbad) : 'KHÔNG'}`)
  ok('L3f. 0 hàm theo-món còn tự SELECT quy_trinh_buoc (đều qua buoc_cua_mon)', conbad.length === 0, JSON.stringify(conbad)) }

await c.query('rollback to savepoint l03')   // TU-AO về sạch (chỉ v1) cho L-04

// ══════════ L-04: COPY-ON-WRITE + MỘT CỔNG GHI ══════════
const dsThuTu = td => (td.buoc_ke_ds || []).map(x => x.thu_tu)
await c.query('savepoint l04')   // cô lập L-04 để L-05 bắt đầu với mẫu sạch
// L4a · THEN CHỐT: TU-AO có món neo v1 → qt_luu_buoc đổi+thêm bước → sinh v2, món VẪN v1, tien_do_tam GIỐNG HỆT
{ const M = await tuMon('L4A', true); await raTo('L4A', TU, [100, 200, 250])
  const truoc = await tdt('L4A')
  const hMoi = (await one(`select d.hoat_dong h from kho.don_gia_baseline d where d.hoat_dong not in (select hoat_dong from kho.quy_trinh_buoc where ma_quy_trinh=$1 and phien_ban=1) and exists(select 1 from kho.tram t where t.hoat_dong=d.hoat_dong) limit 1`, [TU])).h
  const r1 = await as(CEO, `select kho.qt_luu_buoc('${TU}',100,'cat','{}','chung',12,'đổi giờ cắt') j`, [], true)   // đổi bước 100 → copy-on-write
  const r2 = await as(CEO, `select kho.qt_luu_buoc('${TU}',360,'${hMoi}','{250}','chung',6,null) j`, [], true)     // thêm bước 360 (v2 sửa tại chỗ)
  const sau = await tdt('L4A')
  const pb = await q(`select phien_ban, trang_thai from kho.quy_trinh_phien_ban where ma_quy_trinh='${TU}' order by phien_ban`)
  const monPb = (await one(`select quy_trinh_phien_ban pb from kho.don_hang_mon m join kho.tem_ban_ve t on t.mon_id=m.id where t.ma_tam='L4A'`)).pb
  console.log(`   L4a r1.che_do=${r1.r?.[0].j.che_do} pb_moi=${r1.r?.[0].j.phien_ban_moi} · r2.che_do=${r2.r?.[0].j.che_do} · phiên bản=${JSON.stringify(pb.map(x => 'v' + x.phien_ban + '/' + x.trang_thai))} · món neo=v${monPb}`)
  console.log(`      tien_do_tam TRƯỚC=${JSON.stringify(dsThuTu(truoc))}(${truoc.tong_buoc}) · SAU=${JSON.stringify(dsThuTu(sau))}(${sau.tong_buoc})`)
  ok('L4a. sửa mẫu có món neo → v2 hien_hanh, v1 cu, món VẪN neo v1, tien_do_tam GIỐNG HỆT',
    r1.r?.[0].j.che_do === 'da_phat_hanh_phien_ban' && pb.find(x => x.phien_ban === 2)?.trang_thai === 'hien_hanh' && pb.find(x => x.phien_ban === 1)?.trang_thai === 'cu'
    && monPb === 1 && JSON.stringify(dsThuTu(truoc)) === JSON.stringify(dsThuTu(sau)) && truoc.tong_buoc === sau.tong_buoc, r1.e || r2.e) }

// L4b · món mới (chưa neo) → đọc v2 hien_hanh, tien_do_tam THẤY bước mới (360)
{ const M = await tuMon('L4B', false); await raTo('L4B', TU, [100, 200, 250])
  const td = await tdt('L4B')
  console.log(`   L4b món chưa neo → buoc_ke_ds=${JSON.stringify(dsThuTu(td))} tong=${td.tong_buoc}`)
  ok('L4b. món mới → neo/đọc v2, tien_do_tam thấy bước mới 360', dsThuTu(td).includes(360) && td.tong_buoc === 9, JSON.stringify(td.buoc_ke_ds)) }

// L4c · mẫu CHƯA món nào neo → qt_luu_buoc SỬA TẠI CHỖ, phiên bản KHÔNG tăng
{ await as(CEO, `select kho.qt_chep('TMP-L4C','tạm l4c','${TU}') j`, [], true)
  const r = await as(CEO, `select kho.qt_luu_buoc('TMP-L4C',100,'cat','{}','chung',15,null) j`, [], true)
  const npb = (await one(`select count(*)::int n from kho.quy_trinh_phien_ban where ma_quy_trinh='TMP-L4C'`)).n
  console.log(`   L4c che_do=${r.r?.[0].j.che_do} · số dòng phiên bản TMP-L4C=${npb}`)
  ok('L4c. mẫu chưa món neo → sua_tai_cho, phiên bản KHÔNG tăng (1 dòng v1)', r.r?.[0].j.che_do === 'sua_tai_cho' && npb === 1, r.e) }

// L4d · qt_xoa_buoc mẫu có món neo (KE-HO, 2 món cho_cat neo v1) → phiên bản mới, bản CŨ còn nguyên bước bị xoá
{ const kev1 = (await one(`select count(*)::int n from kho.quy_trinh_buoc where ma_quy_trinh='KE-HO-MELAMINE' and phien_ban=1`)).n
  const r = await as(CEO, `select kho.qt_xoa_buoc('KE-HO-MELAMINE',400,'bỏ bước gói thử') j`, [], true)
  const v1sau = (await one(`select count(*)::int n from kho.quy_trinh_buoc where ma_quy_trinh='KE-HO-MELAMINE' and phien_ban=1`)).n
  const v1co400 = (await one(`select count(*)::int n from kho.quy_trinh_buoc where ma_quy_trinh='KE-HO-MELAMINE' and phien_ban=1 and thu_tu=400`)).n
  const vnew = r.r?.[0].j.phien_ban_moi
  const vnewco400 = (await one(`select count(*)::int n from kho.quy_trinh_buoc where ma_quy_trinh='KE-HO-MELAMINE' and phien_ban=$1 and thu_tu=400`, [vnew])).n
  console.log(`   L4d che_do=${r.r?.[0].j.che_do} v_new=${vnew} · v1: ${kev1}→${v1sau} bước, còn 400? ${v1co400} · v_new có 400? ${vnewco400}`)
  ok('L4d. xoá bước mẫu có món neo → phiên bản mới; bản cũ CÒN NGUYÊN bước bị xoá (MES 4.2.5)',
    r.r?.[0].j.che_do === 'da_phat_hanh_phien_ban' && v1sau === kev1 && v1co400 === 1 && vnewco400 === 0, r.e) }

// L4e · authenticated ghi THẲNG quy_trinh_buoc + quy_trinh_phien_ban → CHẶN cả hai
{ const e1 = (await as(CEO, `insert into kho.quy_trinh_buoc(ma_quy_trinh,phien_ban,thu_tu,hoat_dong) values('KE-HO-MELAMINE',9,999,'cat')`)).e
  const e2 = (await as(CEO, `insert into kho.quy_trinh_phien_ban(ma_quy_trinh,phien_ban,trang_thai) values('KE-HO-MELAMINE',9,'cu')`)).e
  console.log(`   L4e quy_trinh_buoc: ${e1 ? 'CHẶN' : 'LỌT'} · quy_trinh_phien_ban: ${e2 ? 'CHẶN' : 'LỌT'}`)
  ok('L4e. authenticated ghi thẳng 2 bảng → CHẶN cả hai (một cổng ghi)', !!e1 && /permission|denied|quyền/i.test(e1) && !!e2 && /permission|denied|quyền/i.test(e2), (e1 || 'lọt') + ' | ' + (e2 || 'lọt')) }

// L4f · qt_doi_phien_ban_mon: có lý do → đổi neo + tien_do_tam đổi + mon_doi +1; thiếu lý do → chặn; da_giao → chặn
{ const M = await tuMon('L4F', true); await raTo('L4F', TU, [100, 200, 250]); const mid = M.mid
  const before = dsThuTu(await tdt('L4F'))
  const rNo = await as(CEO, `select kho.qt_doi_phien_ban_mon('${mid}',2,'') j`)   // thiếu lý do
  const r = await as(CEO, `select kho.qt_doi_phien_ban_mon('${mid}',2,'khách đổi mẫu') j`, [], true)
  const after = dsThuTu(await tdt('L4F'))
  const ndoi = (await one(`select count(*)::int n from kho.mon_doi_phien_ban where mon_id=$1`, [mid])).n
  // món đã da_giao → chặn
  const Mg = await tuMon('L4FG', true); await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.don_hang set trang_thai='da_giao' where ma_don='DEMO-WP08-L4FG'`); await c.query(`set local session_replication_role='origin'`)
  const rGiao = await as(CEO, `select kho.qt_doi_phien_ban_mon('${Mg.mid}',2,'thử') j`)
  console.log(`   L4f thiếu lý do: ${rNo.e ? 'CHẶN' : 'LỌT'} · đổi: tien_do ${JSON.stringify(before)}→${JSON.stringify(after)} · mon_doi=${ndoi} · da_giao: ${rGiao.e ? 'CHẶN' : 'LỌT'}`)
  ok('L4f. qt_doi_phien_ban_mon: có lý do→đổi+tien_do đổi+sổ+1; thiếu lý do→chặn; da_giao→chặn',
    !!rNo.e && /LÝ DO|ly_do/i.test(rNo.e) && !r.e && after.includes(360) && ndoi === 1 && !!rGiao.e && /DA_XONG_SX|đã xong/i.test(rGiao.e),
    (rNo.e || '') + ' | ' + (r.e || '') + ' | ' + (rGiao.e || '')) }

await c.query('rollback to savepoint l04')   // mẫu về sạch cho L-05

// ══════════ L-05: TÊN ĐỌC ĐƯỢC + so_mon_dang_chay + qt_doi_ten ══════════
const KE = 'KE-HO-MELAMINE'
const smdc = async qt => (await one(`select kho.so_mon_dang_chay($1) n`, [qt])).n

// L5a · qt_ds trả đủ 4 mẫu thật, mỗi mẫu ten≠rỗng + phien_ban_hien_hanh=1
{ const ds = (await as(CEO, `select kho.qt_ds() j`)).r[0].j
  const bon = ds.filter(x => ['KE-HO-MELAMINE', 'TU-AO-MELAMINE', 'TU-AO-SON-PU', 'TU-BEP-MELAMINE'].includes(x.ma_quy_trinh))
  console.log(`   L5a qt_ds ${bon.length} mẫu thật: ${JSON.stringify(bon.map(x => x.ma_quy_trinh + '="' + x.ten + '"/v' + x.phien_ban_hien_hanh))}`)
  ok('L5a. qt_ds đủ 4 mẫu, ten≠rỗng + phien_ban_hien_hanh=1', bon.length === 4 && bon.every(x => x.ten && x.ten.trim() && x.phien_ban_hien_hanh === 1), JSON.stringify(bon)) }

// L5b · so_mon_dang_chay: KE-HO=2 thật; mẫu không món=0; đẩy 1 món sang da_giao → giảm 1
{ const s0 = await smdc(KE); const s0no = await smdc('TU-AO-SON-PU')
  // thêm 1 món KE-HO neo v1, đơn cho_cat → so tăng
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach) values('DEMO-WP08-L5B','x',true,'le','cho_cat',$1,'gioi_thieu') returning id`, [TH])).id
  await c.query(`insert into kho.don_hang_mon(don_id,ten,ma_quy_trinh,quy_trinh_phien_ban,dung_moi,so_luong) values($1,'k',$2,1,false,1)`, [did, KE])
  await c.query(`set local session_replication_role='origin'`)
  const s1 = await smdc(KE)
  await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.don_hang set trang_thai='da_giao' where id=$1`, [did]); await c.query(`set local session_replication_role='origin'`)
  const s2 = await smdc(KE)
  // đối chiếu so_mon_dang_chay với đếm tay (đúng bất kể trạng thái test)
  const manual = (await one(`select count(*)::int n from kho.don_hang_mon m join kho.don_hang d on d.id=m.don_id
    where m.quy_trinh_phien_ban=(select phien_ban from kho.quy_trinh_phien_ban where ma_quy_trinh=$1 and trang_thai='hien_hanh')
      and (select ma_quy_trinh from kho.quy_trinh_cua_mon(m.id))=$1 and d.trang_thai in ('cho_cat','da_cat','dang_lam')`, [KE])).n
  console.log(`   L5b KE-HO đang chạy: gốc=${s0}(đếm tay ${manual}) +1món=${s1} sau-da_giao=${s2} · mẫu-không-món(SON-PU)=${s0no}`)
  ok('L5b. so_mon_dang_chay = đếm tay; +món→+1, da_giao→−1, mẫu không món=0', s0 === manual && s0 > 0 && s1 === s0 + 1 && s2 === s0 && s0no === 0, `${s0}(tay${manual})/${s1}/${s2}/${s0no}`) }

// L5c · qt_doi_ten đổi được tên; tên rỗng bị chặn
{ const r = await as(CEO, `select kho.qt_doi_ten('${KE}','Kệ hở melamine (đổi thử)') j`, [], true)
  const ten2 = (await one(`select ten from kho.quy_trinh where ma_quy_trinh=$1`, [KE])).ten
  const rRong = await as(CEO, `select kho.qt_doi_ten('${KE}','   ') j`)
  console.log(`   L5c đổi tên→"${ten2}" · tên rỗng: ${rRong.e ? 'CHẶN' : 'LỌT'}`)
  ok('L5c. qt_doi_ten đổi tên; tên rỗng → chặn', ten2 === 'Kệ hở melamine (đổi thử)' && !!rRong.e && /rỗng/.test(rRong.e), (r.e || '') + ' | ' + (rRong.e || 'lọt')) }

// L5d · chữ ký cũ: qt_ds / qt_chi_tiet gọi như web → chạy, trường CŨ nguyên vẹn
{ const ds = (await as(CEO, `select kho.qt_ds() j`)).r[0].j
  const ct = (await as(CEO, `select kho.qt_chi_tiet('${TU}') j`)).r[0].j
  const dsCu = ds[0] && ('ma_quy_trinh' in ds[0] && 'ten' in ds[0] && 'so_buoc' in ds[0] && 'so_mon_dung' in ds[0])
  const ctCu = ct && ['ma_quy_trinh', 'ten', 'so_buoc', 'so_mon_dung', 'mon_chua_ban_giao', 'mon_da_ban_giao', 'buoc'].every(k => k in ct)
  console.log(`   L5d qt_ds trường cũ đủ? ${dsCu} · qt_chi_tiet trường cũ đủ? ${ctCu} (+so_mon_dang_chay=${ct.so_mon_dang_chay}, phien_ban=${ct.phien_ban_hien_hanh})`)
  ok('L5d. chữ ký cũ qt_ds/qt_chi_tiet không vỡ, trường cũ nguyên vẹn', dsCu && ctCu, JSON.stringify(Object.keys(ct || {}))) }

// ══════════ L-06: SIẾT LÝ DO khi mẫu có món đang chạy ══════════
// L6a · mẫu có món neo (KE-HO, so_mon_dang_chay>0) + lý do RỖNG → RAISE
{ const sc = await smdc(KE)
  const rNull = await as(CEO, `select kho.qt_luu_buoc('${KE}',100,'cat','{}','chung',13,null) j`)
  const rRong = await as(CEO, `select kho.qt_luu_buoc('${KE}',100,'cat','{}','chung',13,'  ') j`)
  console.log(`   L6a KE-HO đang chạy=${sc} · lý do NULL: ${rNull.e ? 'CHẶN' : 'LỌT'} · lý do rỗng: ${rRong.e ? 'CHẶN' : 'LỌT'}`)
  ok('L6a. mẫu có món chạy + lý do rỗng/NULL → RAISE "nhập lý do sửa"',
    sc > 0 && !!rNull.e && /nhập lý do sửa/.test(rNull.e) && !!rRong.e && /nhập lý do sửa/.test(rRong.e), (rNull.e || 'lọt') + ' | ' + (rRong.e || 'lọt')) }

// L6b · có lý do → phát hành bản mới (copy-on-write)
{ await c.query('savepoint l6b')
  const r = await as(CEO, `select kho.qt_luu_buoc('${KE}',100,'cat','{}','chung',13,'khách đổi kích thước') j`, [], true)
  const pb = await q(`select phien_ban, trang_thai from kho.quy_trinh_phien_ban where ma_quy_trinh='${KE}' order by phien_ban`)
  console.log(`   L6b che_do=${r.r?.[0].j.che_do} pb_moi=${r.r?.[0].j.phien_ban_moi} · phiên bản=${JSON.stringify(pb.map(x => 'v' + x.phien_ban + '/' + x.trang_thai))}`)
  ok('L6b. có lý do → phát hành bản mới (v_cu→cu, v_moi→hien_hanh)',
    r.r?.[0].j.che_do === 'da_phat_hanh_phien_ban' && pb.find(x => x.trang_thai === 'hien_hanh')?.phien_ban === r.r[0].j.phien_ban_moi && pb.find(x => x.phien_ban === 1)?.trang_thai === 'cu', r.e)
  await c.query('rollback to savepoint l6b') }

await c.query('rollback')   // dọn sạch mọi demo/test
const rest = await one(`select (select count(*)::int from kho.don_hang where ma_don like 'DEMO-WP08-%') d, (select count(*)::int from kho.quy_trinh_buoc where phien_ban<>1) v`)
console.log(`\n── dọn: đơn DEMO-WP08 còn ${rest.d} · bước phien_ban≠1 còn ${rest.v} (phải 0/0) ──`)
console.log(`\n═══ KẾT QUẢ test_wp08: ${P} pass / ${F} fail ═══`)
await c.end(); process.exit(F ? 1 : 0)
