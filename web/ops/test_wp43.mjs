// TEST CẮN — WP-43 (db/156): bàn giao TỰ XẾP + không bao giờ chặn + cờ chua_xep_duoc + sổ nút thắt.
//   Đơn demo clone từ T8-001 (KHÔNG đụng T8-001). Tx rollback → 0 dấu vết.
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
const U = { ceo: await uid('ceo'), thiet_ke: await uid('thiet_ke'), tho: await uid('tho') }
const TK_NS = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [U.thiet_ke])).id
const T8 = (await one(`select id from kho.don_hang where ma_don='T8-001'`)).id
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: 'wp43/cat.dxf', ten_goc: 'cat.dxf', co_byte: 100 }])

// clone đơn demo scheduleable từ T8-001 (số về 'chuan' chưa chốt, BOM 'du_kien')
async function mkDon(sfx, hen) {
  const ma = 'DEMO-WP43-' + sfx
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,trang_thai,thuong_hieu,nguon_khach,ma_ns_thiet_ke,ngay_hen_khach)
    values($1,'DEMO wp43 ${sfx}',true,'le','moi_len_don',$2,'gioi_thieu',$3,$4) returning id`, [ma, TH, TK_NS, hen])).id
  // clone 2 món + số (moc chuan, chưa chốt) + BOM (du_kien)
  const mons = await q(`select id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh from kho.don_hang_mon where don_id=$1`, [T8])
  for (const m of mons) {
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
async function trangThai(ma) { return (await one(`select trang_thai,chua_xep_duoc,ly_do_chua_xep from kho.don_hang where ma_don=$1`, [ma])) }
async function bomChuan(did) { return (await one(`select count(*)::int n from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id where m.don_id=$1 and b.moc='chuan'`, [did])).n }
async function giuCho(did) { return (await one(`select count(*)::int n from kho.giu_cho where don_hang_id=$1`, [did])).n }
async function xepDong(ma) { return (await one(`select count(*)::int n from kho.xep_lich where ma_don=$1`, [ma])).n }

await c.query('begin')
const before = (await one(`select count(*)::int n from kho.don_hang`)).n
const homNay = (await one(`select current_date d`)).d

// ═══ 6.1 · bàn giao đơn hẹn XA → 5 việc + xep_lich + da_xep=true ═══
{ const D = await mkDon('A', new Date(homNay.getTime() + 56 * 864e5).toISOString().slice(0, 10))  // hẹn +8 tuần
  const r = await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const j = r.r && r.r[0].j; const tt = await trangThai(D.ma)
  const xl = await xepDong(D.ma)
  console.log(`   6.1 return: da_xep=${j?.da_xep} so_dong=${j?.so_dong_xep_lich} · xep_lich=${xl} · tt=${tt?.trang_thai}`)
  ok('6.1 bàn giao hẹn xa: trang_thai=cho_cat + BOM chốt + giữ chỗ + xep_lich>0 + da_xep=true + chua_xep=false',
    !r.e && tt.trang_thai === 'cho_cat' && (await bomChuan(D.did)) > 0 && (await giuCho(D.did)) > 0 && xl > 0 && j.da_xep === true && tt.chua_xep_duoc === false, r.e || JSON.stringify({ j, tt })) }

// ═══ 6.2 · ⚠ hẹn RƠI ĐÓNG BĂNG → bàn giao VẪN THÀNH CÔNG, xep_lich=0, da_xep=false, chua_xep=true ═══
{ const D = await mkDon('B', homNay.toISOString().slice(0, 10))  // hẹn = tuần này (đóng băng)
  const r = await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const j = r.r && r.r[0].j; const tt = await trangThai(D.ma)
  console.log(`   6.2 tt=${tt?.trang_thai} · BOM=${await bomChuan(D.did)} · giữ chỗ=${await giuCho(D.did)} · xep_lich=${await xepDong(D.ma)} · da_xep=${j?.da_xep} · ly_do=${tt?.ly_do_chua_xep?.slice(0,50)}`)
  ok('6.2 ĐÓNG BĂNG: bàn giao THÀNH CÔNG (cho_cat + BOM + giữ chỗ)', !r.e && tt.trang_thai === 'cho_cat' && (await bomChuan(D.did)) > 0 && (await giuCho(D.did)) > 0, r.e || '')
  ok('6.2 xep_lich=0 · da_xep=false · chua_xep_duoc=true · lý do nói ĐÓNG BĂNG',
    (await xepDong(D.ma)) === 0 && j.da_xep === false && tt.chua_xep_duoc === true && /đóng băng|ĐÓNG BĂNG/i.test(tt.ly_do_chua_xep || ''), JSON.stringify({ j, tt })) }

// ═══ 7.1 (thay 6.3) · [db/157] moc_lich 2/2 · đơn KHÔNG hẹn → xếp được NGAY (KHÔNG mẹo bỏ đóng băng) ═══
{ const D = await mkDon('C', null)   // KHÔNG đụng moc_lich (giữ 2/2)
  const r = await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const j = r.r && r.r[0].j; const xl = await xepDong(D.ma); const tt = await trangThai(D.ma)
  const buocDau = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D.ma]))?.w
  const nguong = (await one(`select (kho.tuan_cua(current_date)+14) w`)).w  // hiện tại + 2 tuần
  console.log(`   7.1 da_xep=${j?.da_xep} xep_lich=${xl} · bước đầu=${buocDau?.toISOString?.().slice(0,10)} · ngưỡng(hiện+2t)=${nguong?.toISOString?.().slice(0,10)}`)
  ok('7.1 KHÔNG hẹn (đóng băng 2/2) → xếp được NGAY lần đầu: xep_lich>0 · da_xep=true · chua_xep=false', !r.e && j.da_xep === true && xl > 0 && tt.chua_xep_duoc === false, r.e || JSON.stringify(j))
  ok('7.1 bước đầu rơi tuần ≥ hiện tại + 2 tuần (ngoài đóng băng)', buocDau && new Date(buocDau) >= new Date(nguong), `bước đầu ${buocDau} < ${nguong}`) }

// ═══ 7.2 · dong_bang=3 (trong tx) → đơn không hẹn: bước đầu LÙI thêm 1 tuần so 7.1 ═══
{ const D1 = await mkDon('H', null)
  await as(U.ceo, `select kho.ban_giao_xuong('${D1.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const w1 = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D1.ma])).w
  await c.query('savepoint p72'); await c.query(`update kho.moc_lich set so_tuan=3 where ma='dong_bang'`)
  const D2 = await mkDon('I', null)
  await as(U.ceo, `select kho.ban_giao_xuong('${D2.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const w2 = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D2.ma])).w
  await c.query('rollback to savepoint p72')  // trả moc_lich=2 + bỏ I
  console.log(`   7.2 dong_bang=2 bước đầu=${w1?.toISOString?.().slice(0,10)} · dong_bang=3 bước đầu=${w2?.toISOString?.().slice(0,10)}`)
  ok('7.2 dong_bang 2→3: bước đầu LÙI đúng 1 tuần (neo đọc động moc_lich)', w1 && w2 && (new Date(w2) - new Date(w1)) === 7 * 864e5, `${w1} vs ${w2}`) }

// ═══ 7.3 · đơn CÓ hẹn rơi đóng băng → vẫn da_xep=false + chua_xep=true (KHÔNG xếp bừa ngoài rào) ═══
{ const D = await mkDon('J', homNay.toISOString().slice(0, 10))  // hẹn tuần này (đóng băng)
  const r = await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const j = r.r && r.r[0].j; const tt = await trangThai(D.ma)
  ok('7.3 hẹn rơi đóng băng → da_xep=false · chua_xep=true · xep_lich=0 (vế cắn ngược, nguoc GIỮ NGUYÊN)',
    !r.e && j.da_xep === false && tt.chua_xep_duoc === true && (await xepDong(D.ma)) === 0, JSON.stringify({ j, tt })) }

// ═══ 6.4 · xếp lại (luu_xep_lich) 2 lần cùng đơn A → KHÔNG đẻ trùng (xoá-rồi-ghi) ═══
{ const n1 = await xepDong('DEMO-WP43-A')
  const r1 = await as(U.ceo, `select kho.luu_xep_lich('DEMO-WP43-A','nguoc',false,'xếp lại kiểm trùng') j`, [], true)
  const n2 = await xepDong('DEMO-WP43-A')
  const r2 = await as(U.ceo, `select kho.luu_xep_lich('DEMO-WP43-A','nguoc',false,'xếp lại kiểm trùng') j`, [], true)
  const n3 = await xepDong('DEMO-WP43-A')
  ok('6.4 luu_xep_lich 2 lần → xep_lich KHÔNG đẻ trùng (giữ nguyên số dòng)', !r1.e && !r2.e && n2 === n3 && n2 === n1, `${n1}→${n2}→${n3} ${r1.e || r2.e || ''}`) }

// ═══ 6.5 · đơn B (chua_xep=true) → luu_xep_lich ngoại lệ CEO có lý do → cờ tự về false ═══
{ const truoc = (await trangThai('DEMO-WP43-B')).chua_xep_duoc
  const r = await as(U.ceo, `select kho.luu_xep_lich('DEMO-WP43-B','nguoc',true,'ceo xếp ngoại lệ đóng băng') j`, [], true)
  const sau = (await trangThai('DEMO-WP43-B')).chua_xep_duoc
  console.log(`   6.5 chua_xep_duoc: ${truoc} → ${sau}`)
  ok('6.5 luu_xep_lich (ngoại lệ CEO) thành công → chua_xep_duoc về false', !r.e && truoc === true && sau === false, r.e || `${truoc}→${sau}`) }

// ═══ 6.6 · tai_theo_to_tuan đổi khi bàn giao (so trước/sau bằng đơn mới E, tổ dan_canh) ═══
{ const TU = homNay.toISOString().slice(0, 10), DEN = new Date(homNay.getTime() + 56 * 864e5).toISOString().slice(0, 10)
  const taiDanCanh = async () => { const g = await as(U.ceo, `select kho.tai_theo_to_tuan('${TU}','${DEN}') j`, [], false); const j = g.r[0].j; return (j.o || []).filter(x => x.ma_to === 'dan_canh').reduce((s, x) => s + (Number(x.tong_tai) || 0), 0) }
  const truoc = await taiDanCanh()
  const D = await mkDon('E', new Date(homNay.getTime() + 42 * 864e5).toISOString().slice(0, 10))
  await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`, [], true)
  const sau = await taiDanCanh()
  console.log(`   6.6 tai dan_canh TRƯỚC=${truoc} · SAU bàn giao E=${sau}`)
  ok('6.6 tai_theo_to_tuan ĐỔI sau bàn giao (không ai bấm)', sau !== truoc, `${truoc} vs ${sau}`) }

// ═══ 6.7 · nut_that_ghi 2 lần cùng tuần → 1 dòng; nut_that_ds(4) đúng dạng ═══
{ await as(U.ceo, `select kho.nut_that_ghi() j`, [], true)
  const n1 = (await one(`select count(*)::int n from kho.nut_that_tuan where tuan=kho.tuan_cua(current_date)`)).n
  await as(U.ceo, `select kho.nut_that_ghi() j`, [], true)
  const n2 = (await one(`select count(*)::int n from kho.nut_that_tuan where tuan=kho.tuan_cua(current_date)`)).n
  const ds = await as(U.ceo, `select kho.nut_that_ds(4) j`, [], false)
  const arr = ds.r[0].j
  ok('6.7 nut_that_ghi 2 lần → 1 dòng/tuần (UPSERT)', n1 === 1 && n2 === 1, `${n1},${n2}`)
  ok('6.7 nut_that_ds(4) trả mảng đúng dạng', Array.isArray(arr) && (arr.length === 0 || 'tuan' in arr[0]), JSON.stringify(arr).slice(0, 80)) }

// ═══ 6.8 · vai: thiet_ke bàn giao được · tho → từ chối ═══
{ const D = await mkDon('F', new Date(homNay.getTime() + 56 * 864e5).toISOString().slice(0, 10))
  const rtk = await as(U.thiet_ke, `select kho.ban_giao_xuong('${D.ma}', '${FILE}'::jsonb, null) j`)
  ok('6.8 thiet_ke bàn giao → ĐƯỢC', !rtk.e, rtk.e || '')
  const D2 = await mkDon('G', new Date(homNay.getTime() + 56 * 864e5).toISOString().slice(0, 10))
  const rtho = await as(U.tho, `select kho.ban_giao_xuong('${D2.ma}', '${FILE}'::jsonb, null) j`)
  ok('6.8 tho gọi ban_giao_xuong → TỪ CHỐI', !!rtho.e && /ceo\/thiet_ke|chỉ/.test(rtho.e), rtho.e || 'KHÔNG chặn') }

// ═══ 8.1 [L-14 db/158] đơn KHÔNG hẹn → luu_xep_lich('xuoi') xếp được KHÔNG cần ngoại lệ (ca B2 lật xanh) ═══
{ const D = await mkDon('K', null)
  const r = await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','xuoi',false,'xếp lại (WP-45 planning fence)') j`, [], true)
  const j = r.r && r.r[0].j
  const w = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D.ma]))?.w
  const nguong = (await one(`select (kho.tuan_cua(current_date)+14) w`)).w
  console.log(`   8.1 luu_xep(xuoi): ok=${j?.ok} so_dong=${j?.so_dong} · bước đầu=${w?.toISOString?.().slice(0, 10)} · ngưỡng(hiện+2t)=${nguong?.toISOString?.().slice(0, 10)}`)
  ok('8.1 KHÔNG hẹn: luu_xep_lich(xuoi) xếp được KHÔNG cần ngoại lệ (B2 hết kẹt)', !r.e && j?.ok === true && j.so_dong > 0, r.e || JSON.stringify(j))
  ok('8.1 bước đầu ≥ hiện tại + 2 tuần (ngoài đóng băng)', w && new Date(w) >= new Date(nguong), `${w} < ${nguong}`) }

// ═══ 8.2 [L-14] CÙNG đơn không hẹn: ban_giao_xuong vs luu_xep_lich(nút) → GIỐNG (hết lệch hai đường) ═══
{ const D = await mkDon('L', null)
  await as(U.ceo, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null) j`, [], true)
  const a = await one(`select count(*)::int n, min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D.ma])
  await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','xuoi',false,'xếp lại (WP-45 planning fence)') j`, [], true)
  const b = await one(`select count(*)::int n, min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [D.ma])
  console.log(`   8.2 ban_giao=${a.n} dòng·bước đầu ${a.w?.toISOString?.().slice(0, 10)} ‖ luu_xep=${b.n} dòng·bước đầu ${b.w?.toISOString?.().slice(0, 10)}`)
  ok('8.2 hai đường GIỐNG NHAU: số dòng + tuần bước đầu khớp', a.n === b.n && a.w && b.w && +new Date(a.w) === +new Date(b.w), `${a.n}/${a.w} vs ${b.n}/${b.w}`) }

// ═══ 8.3 [L-14] hẹn gấp đóng băng: luu_xep_lich('nguoc') vẫn RAISE, KHÔNG tụt sang xuoi (client single-call) ═══
{ const D = await mkDon('M', homNay.toISOString().slice(0, 10))
  const r = await as(U.ceo, `select kho.luu_xep_lich('${D.ma}','nguoc',false,null) j`)
  console.log(`   8.3 nguoc: ${r.e ? 'RAISE → ' + r.e.replace(/^.*luu_xep_lich:\s*/, '').slice(0, 60) : 'ok (KHÔNG raise!)'}`)
  ok('8.3 hẹn gấp: luu_xep_lich(nguoc) RAISE đóng băng (tin thật không bị nuốt)', !!r.e && /ĐÓNG BĂNG|đóng băng/.test(r.e), r.e || 'KHÔNG raise') }

// ═══ 8.4 [L-14] vẫn đơn 8.3 (M): ceo + ngoại lệ + lý do → ép xếp được, ly_do lưu vào xep_lich ═══
{ const LY = 'ceo ép ngoại lệ đóng băng'
  const r = await as(U.ceo, `select kho.luu_xep_lich('DEMO-WP43-M','nguoc',true,'${LY}') j`, [], true)
  const row = await one(`select count(*)::int n, max(ly_do) ly from kho.xep_lich where ma_don='DEMO-WP43-M'`)
  console.log(`   8.4 ép: ok=${r.r && r.r[0].j?.ok} · xep_lich=${row.n} · ly_do=${JSON.stringify(row.ly)}`)
  ok('8.4 ceo ngoại lệ + lý do → ép xếp được + ly_do lưu vào xep_lich', !r.e && row.n > 0 && row.ly === LY, r.e || `n=${row.n} ly=${row.ly}`) }

// ═══ 8.5 [L-14] dong_bang 2→3: CẢ HAI đường (ban_giao + luu_xep) cùng lùi thêm 1 tuần ═══
{ const Da = await mkDon('N', null); await as(U.ceo, `select kho.ban_giao_xuong('${Da.ma}','${FILE}'::jsonb,null) j`, [], true)
  const bgA = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [Da.ma])).w
  const Db = await mkDon('O', null); await as(U.ceo, `select kho.luu_xep_lich('${Db.ma}','xuoi',false,null) j`, [], true)
  const nutA = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [Db.ma])).w
  await c.query('savepoint p85'); await c.query(`update kho.moc_lich set so_tuan=3 where ma='dong_bang'`)
  const Da3 = await mkDon('P', null); await as(U.ceo, `select kho.ban_giao_xuong('${Da3.ma}','${FILE}'::jsonb,null) j`, [], true)
  const bgB = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [Da3.ma])).w
  const Db3 = await mkDon('Q', null); await as(U.ceo, `select kho.luu_xep_lich('${Db3.ma}','xuoi',false,null) j`, [], true)
  const nutB = (await one(`select min(tuan_bat_dau) w from kho.xep_lich where ma_don=$1`, [Db3.ma])).w
  await c.query('rollback to savepoint p85')
  console.log(`   8.5 ban_giao ${bgA?.toISOString?.().slice(0, 10)}→${bgB?.toISOString?.().slice(0, 10)} · luu_xep ${nutA?.toISOString?.().slice(0, 10)}→${nutB?.toISOString?.().slice(0, 10)}`)
  ok('8.5 dong_bang 2→3: ban_giao lùi đúng 1 tuần', bgA && bgB && (+new Date(bgB) - +new Date(bgA)) === 7 * 864e5, `${bgA} vs ${bgB}`)
  ok('8.5 dong_bang 2→3: luu_xep(nút) lùi đúng 1 tuần (neo đồng bộ)', nutA && nutB && (+new Date(nutB) - +new Date(nutA)) === 7 * 864e5, `${nutA} vs ${nutB}`) }

// ══ 9.x [L-15 db/159] neo gom về kho.neo_xuoi() — BA đường phải cùng tuần ══
// bước đầu dạng 'YYYY-MM-DD' (text, tránh lệch múi giờ khi so pg Date với chuỗi JSON)
const wtext = async ma => (await one(`select to_char(min(tuan_bat_dau),'YYYY-MM-DD') w from kho.xep_lich where ma_don=$1`, [ma])).w
const wPreview = async ma => { const pv = await as(U.ceo, `select kho.tl_xep_thu('${ma}',null,'xuoi',false) j`, [], false); return ((pv.r?.[0]?.j?.lich) || []).map(x => x.tuan_moi).sort()[0] }
async function baDuong(ma) {
  await as(U.ceo, `select kho.ban_giao_xuong('${ma}','${FILE}'::jsonb,null) j`, [], true); const bg = await wtext(ma)
  await as(U.ceo, `select kho.luu_xep_lich('${ma}','xuoi',false,'kiểm ba đường') j`, [], true); const lx = await wtext(ma)
  const tx = await wPreview(ma)
  return { bg, lx, tx, eq: !!bg && bg === lx && lx === tx }
}
const d14 = (a, b) => a && b && (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) === 14 * 864e5

// 9.1 · ba đường cùng đơn không hẹn → cùng tuần bước đầu
{ const D = await mkDon('R', null); const w = await baDuong(D.ma)
  console.log(`   9.1 ban_giao=${w.bg} · luu_xep=${w.lx} · tl_xep_thu=${w.tx}`)
  ok('9.1 BA đường (ban_giao·luu_xep·tl_xep_thu) CÙNG tuần bước đầu', w.eq, `${w.bg}/${w.lx}/${w.tx}`) }

// 9.2 · dong_bang 2→4 → cả ba cùng lùi 2 tuần, vẫn bằng nhau
{ const D2 = await mkDon('U', null); const a = await baDuong(D2.ma)
  await c.query('savepoint p92'); await c.query(`update kho.moc_lich set so_tuan=4 where ma='dong_bang'`)
  const D4 = await mkDon('V', null); const b = await baDuong(D4.ma)
  await c.query('rollback to savepoint p92')
  console.log(`   9.2 db=2: ${a.bg}/${a.lx}/${a.tx} → db=4: ${b.bg}/${b.lx}/${b.tx}`)
  ok('9.2 dong_bang 2→4: cả BA cùng lùi đúng 2 tuần', d14(a.bg, b.bg) && d14(a.lx, b.lx) && d14(a.tx, b.tx), `${a.bg}→${b.bg} ${a.lx}→${b.lx} ${a.tx}→${b.tx}`)
  ok('9.2 ở CẢ HAI mốc dong_bang, BA đường vẫn bằng nhau', a.eq && b.eq, `eq2=${a.eq} eq4=${b.eq}`) }

await c.query('rollback')
const after = (await one(`select count(*)::int n from kho.don_hang`)).n
ok('DỌN · rollback sạch, không đơn demo đọng (T8-001 KHÔNG chạm)', before === after, `${before} vs ${after}`)
ok('DỌN · xep_lich prod = 0', (await one(`select count(*)::int n from kho.xep_lich`)).n === 0)
console.log(`\nKẾT QUẢ test_wp43: ${P} pass / ${F} fail`)
await c.end(); process.exit(F ? 1 : 0)
