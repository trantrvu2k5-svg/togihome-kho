// TEST CẮN — WP-75 (db/174): mốc bàn giao + lịch thu theo đợt + cửa cọc. Outer BEGIN…ROLLBACK → 0 dấu vết.
//   Cắn HAI VẾ mỗi ca (không ca nào chỉ kiểm vế xanh). KHÔNG đo 100k ở đây (đo riêng _perf75).
//   a dự án chưa cọc CHẶN / đủ 30% QUA · b ceo+lý do QUA+vết / ceo-ko-lý-do CHẶN / thiet_ke+lý do CHẶN / sale CHẶN
//   c lẻ chưa cọc VẪN bàn giao · d Σ≠100 CHẶN lúc COMMIT · e sửa lịch: cũ còn+đóng khoảng, mới có lý do; thiếu lý do CHẶN
//   f moc: client PATCH từ chối · nhảy cóc CHẶN · sale lùi CHẶN · ceo lùi+lý do QUA · g da_giao → moc tự nhảy
//   h den_han: chưa tới mốc KHÔNG hiện / đã đạt mốc chưa thu đủ CÓ hiện
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
const CEO = await uid('ceo'); const TK = await uid('thiet_ke'); const SALE = await uid('sale')
const TK_NS = (await one(`select id from kho.nguoi_dung where auth_uid=$1`, [TK])).id
const T8 = (await one(`select id from kho.don_hang where ma_don='T8-001'`)).id
const TH = (await one(`select ma from kho.thuong_hieu limit 1`)).ma
const FILE = JSON.stringify([{ loai_file: 'dxf', duong_dan: 'wp75/cat.dxf', ten_goc: 'cat.dxf', co_byte: 100 }])

// clone T8 (đủ điều kiện bàn giao) → đặt dong/gia; du_an thêm ban_thiet_ke khach_duyet
async function mkDon(sfx, dong, gia, demo = true) {
  const ma = 'DEMO-WP75-' + sfx
  await c.query(`set local session_replication_role='replica'`)
  const did = (await one(`insert into kho.don_hang(ma_don,ten_khach,la_demo,dong,gia_chot,trang_thai,thuong_hieu,nguon_khach,ma_ns_thiet_ke)
    values($1,'DEMO wp75 ${sfx}',$6,$2,$3,'moi_len_don',$4,'gioi_thieu',$5) returning id`, [ma, dong, gia, TH, TK_NS, demo])).id
  for (const m of await q(`select id,ten,sp_id,ma_quy_trinh,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh from kho.don_hang_mon where don_id=$1`, [T8])) {
    const nm = (await one(`insert into kho.don_hang_mon(don_id,ten,sp_id,ma_quy_trinh,dung_moi,vl,kt,so_luong,gia,ma_mau,chi_tiet,khong_gian,anh)
      values($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [did, m.ten, m.sp_id, m.ma_quy_trinh, m.vl, m.kt, m.so_luong, m.gia, m.ma_mau, m.chi_tiet, m.khong_gian, m.anh])).id
    await c.query(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,moc) select $1,hoat_dong,so_don_vi,bieu_thuc,nguon,nguoi_nhap,'chuan' from kho.so_don_vi_mon where mon_id=$2 and moc='chuan'`, [nm, m.id])
    await c.query(`insert into kho.don_hang_mon_bom(mon_id,vat_tu_id,so_luong,don_vi,nguon,moc,hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung) select $1,vat_tu_id,so_luong,don_vi,nguon,'du_kien',hoat_dong,hao_hut_pct,so_luong_co_so,he_so_ap_dung from kho.don_hang_mon_bom where mon_id=$2 and moc='chuan'`, [nm, m.id])
  }
  if (dong !== 'le') {
    await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai) values($1,1,$2,'khach_duyet')`, [ma, TK_NS])
    await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao,nguon) values($1,$2,'nhap_tay')`, [ma, Math.round(gia * 0.6)])   // qua cổng giá vốn du_an (kiem_giam_gia)
  }
  await c.query(`set local session_replication_role='origin'`)
  return { ma, did }
}
const coc = async (ma, tien) => { await c.query(`set local session_replication_role='replica'`)
  await c.query(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values($1,current_date,$2,'coc')`, [ma, tien])
  await c.query(`set local session_replication_role='origin'`) }
const moc = async did => (await one(`select moc_ban_giao,moc_dat_luc,moc_nguoi,vuot_coc_boi,vuot_coc_luc,vuot_coc_ly_do from kho.don_hang where id=$1`, [did]))
const daVao = async did => (await one(`select trang_thai from kho.don_hang where id=$1`, [did])).trang_thai

await c.query('begin')

// ═══ a · dự án CHƯA cọc → CHẶN; thu đủ 30% → QUA ═══
{ await c.query('savepoint a')
  const D = await mkDon('A', 'du_an', 100000000)   // cần cọc 30% = 30,000,000
  const r1 = await as(CEO, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,null) j`)
  const chan = !!r1.e && /THIEU_COC/.test(r1.e)
  await coc(D.ma, 30000000)
  const r2 = await as(CEO, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,null) j`, [], true)
  const qua = !r2.e && r2.r[0].j.ok === true && (await daVao(D.did)) === 'cho_cat'
  console.log(`   a chưa cọc: ${chan ? 'CHẶN' : 'LỌT ⚠'} (${(r1.e||'').slice(0,55)}) · đủ 30%: ${qua ? 'QUA' : 'CHẶN ' + (r2.e||'').slice(0,55)}`)
  ok('a. dự án chưa cọc CHẶN · thu đủ 30% QUA', chan && qua, JSON.stringify({ e1: r1.e, e2: r2.e }))
  await c.query('rollback to savepoint a')
}

// ═══ b · ceo+lý do → QUA + 3 vết · ceo-ko-lý-do → CHẶN · thiet_ke+lý do → CHẶN · sale → CHẶN ═══
{ await c.query('savepoint b')
  const D = await mkDon('B', 'du_an', 100000000)   // 0 cọc → thiếu
  const rCeoNo = await as(CEO, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,null) j`)
  const chanCeoNo = !!rCeoNo.e && /THIEU_COC/.test(rCeoNo.e)
  const rTk = await as(TK, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,'thiet ke ep vuot') j`)
  const chanTk = !!rTk.e && /VUOT_COC_CHI_CEO/.test(rTk.e)
  const rSale = await as(SALE, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,'sale ep vuot') j`)
  const chanSale = !!rSale.e   // sale không được gọi ban_giao_xuong (chỉ ceo/thiet_ke)
  const rCeo = await as(CEO, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,'khách cam kết trả khi giao — CEO duyệt') j`, [], true)
  const quaCeo = !rCeo.e && rCeo.r[0].j.ok === true
  const v = await moc(D.did)
  const vet = v.vuot_coc_boi !== null && v.vuot_coc_luc !== null && (v.vuot_coc_ly_do || '').includes('CEO duyệt')
  console.log(`   b ceo-ko-lý-do:${chanCeoNo?'CHẶN':'LỌT⚠'} · thiet_ke+lý:${chanTk?'CHẶN':'LỌT⚠'} · sale:${chanSale?'CHẶN':'LỌT⚠'} · ceo+lý:${quaCeo?'QUA':'CHẶN'} · vết:${vet}`)
  ok('b. cửa vượt cọc: chỉ CEO+lý do QUA (3 vết) · ceo-ko-lý/thiet_ke+lý/sale đều CHẶN', chanCeoNo && chanTk && chanSale && quaCeo && vet, JSON.stringify({ ceoNo: rCeoNo.e, tk: rTk.e, sale: rSale.e, ceo: rCeo.e, v }))
  await c.query('rollback to savepoint b')
}

// ═══ c · đơn LẺ chưa cọc → VẪN bàn giao ═══
{ await c.query('savepoint c')
  const D = await mkDon('C', 'le', 100000000)   // 0 cọc nhưng dong=le → không gác
  const r = await as(CEO, `select kho.ban_giao_xuong('${D.ma}','${FILE}'::jsonb,null,null) j`, [], true)
  const qua = !r.e && r.r[0].j.ok === true && (await daVao(D.did)) === 'cho_cat'
  console.log(`   c lẻ chưa cọc: ${qua ? 'QUA (không gác cọc)' : 'CHẶN ⚠ ' + (r.e||'').slice(0,60)}`)
  ok('c. đơn lẻ chưa cọc VẪN bàn giao được', qua, r.e)
  await c.query('rollback to savepoint c')
}

// ═══ d · lich_thu Σ≠100 → CHẶN đúng lúc COMMIT (SET CONSTRAINTS IMMEDIATE), không phải INSERT dòng đầu ═══
{ await c.query('savepoint d')
  const D = await mkDon('D', 'du_an', 100000000)
  let eDong = null, eTong = null
  try {
    // chèn 2 đợt tổng 90 — dòng đầu KHÔNG nổ (deferred)
    await c.query(`insert into kho.lich_thu(don_hang_id,so_dot,moc,ty_le) values($1,1,'chot_don',50)`, [D.did])
    await c.query(`insert into kho.lich_thu(don_hang_id,so_dot,moc,ty_le) values($1,2,'da_lap_xong',40)`, [D.did])
  } catch (x) { eDong = x.message }
  try { await c.query('set constraints kho.trg_lt_tong immediate') } catch (x) { eTong = x.message }   // mô phỏng COMMIT
  const noRowErr = !eDong   // 2 dòng chèn KHÔNG nổ
  const tongChan = !!eTong && /LICH_THU_TONG/.test(eTong)
  console.log(`   d chèn 2 đợt (Σ90): ${noRowErr ? 'không nổ lúc INSERT ✓' : 'nổ sớm ⚠ ' + eDong}` + ` · SET CONSTRAINTS IMMEDIATE: ${tongChan ? 'CHẶN (Σ≠100)' : 'LỌT ⚠'}`)
  ok('d. Σ tỷ lệ ≠ 100 → CHẶN lúc COMMIT (không phải lúc INSERT dòng đầu)', noRowErr && tongChan, JSON.stringify({ eDong, eTong }))
  await c.query('rollback to savepoint d')
}

// ═══ e · sửa lịch sau chốt: dòng cũ CÒN + đóng khoảng, dòng mới có lý do; thiếu lý do → CHẶN ═══
{ await c.query('savepoint e')
  const D = await mkDon('E', 'du_an', 100000000)   // mkDon đặt sẵn moi_len_don = đã chốt
  // sinh mặc định 3 đợt (giả lập chot_don gọi)
  await as(CEO, `select kho.lt_sinh_mac_dinh('${D.did}')`, [], true)
  const truoc = await one(`select count(*)::int n from kho.lich_thu where don_hang_id=$1 and hieu_luc_den is null`, [D.did])
  // sửa THIẾU lý do → CHẶN
  const dot = JSON.stringify([{ so_dot: 1, moc: 'chot_don', ty_le: 50 }, { so_dot: 2, moc: 'da_lap_xong', ty_le: 50 }])
  const rNoLy = await as(CEO, `select kho.lt_ghi('${D.did}','${dot}'::jsonb, null) j`)
  const chanNoLy = !!rNoLy.e && /PHẢI có lý do/.test(rNoLy.e)
  // sửa CÓ lý do → QUA
  const rLy = await as(CEO, `select kho.lt_ghi('${D.did}','${dot}'::jsonb,'khách đổi điều khoản') j`, [], true)
  const cu = await one(`select count(*)::int n from kho.lich_thu where don_hang_id=$1 and hieu_luc_den is not null`, [D.did])
  const moiCoLy = await one(`select bool_and(ly_do='khách đổi điều khoản') b, count(*)::int n from kho.lich_thu where don_hang_id=$1 and hieu_luc_den is null`, [D.did])
  const cuConNguyen = cu.n === truoc.n   // 3 dòng cũ CÒN (đóng khoảng, không xoá)
  console.log(`   e đợt cũ trước sửa=${truoc.n} · thiếu lý do:${chanNoLy?'CHẶN':'LỌT⚠'} · sau sửa: cũ-đóng-khoảng=${cu.n} mới=${moiCoLy.n}(lý do ${moiCoLy.b})`)
  ok('e. sửa lịch sau chốt: dòng cũ còn+đóng khoảng, mới có lý do; thiếu lý do CHẶN', chanNoLy && !rLy.e && cuConNguyen && moiCoLy.b === true && moiCoLy.n === 2, JSON.stringify({ eNoLy: rNoLy.e, eLy: rLy.e, truoc: truoc.n, cu: cu.n }))
  await c.query('rollback to savepoint e')
}

// ═══ f · moc: client PATCH từ chối · nhảy cóc CHẶN · sale lùi CHẶN · ceo lùi+lý do QUA ═══
{ await c.query('savepoint f')
  const D = await mkDon('F', 'le', 50000000)
  // client PATCH thẳng cột moc_ban_giao → từ chối (không có grant cột)
  const rPatch = await as(CEO, `update kho.don_hang set moc_ban_giao='da_lap_xong' where id='${D.did}'`)
  const patchChan = !!rPatch.e && /permission denied|denied for/i.test(rPatch.e)
  // nhảy cóc chua_giao → da_lap_xong (bỏ 1 nấc) → CHẶN
  const rNhay = await as(CEO, `select kho.dat_moc_ban_giao('${D.did}','da_lap_xong',null) j`)
  const nhayChan = !!rNhay.e && /nhảy cóc/.test(rNhay.e)
  // tiến 1 nấc hợp lệ (ceo)
  await as(CEO, `select kho.dat_moc_ban_giao('${D.did}','da_giao_chua_lap',null) j`, [], true)
  // sale lùi → CHẶN
  const rSaleLui = await as(SALE, `select kho.dat_moc_ban_giao('${D.did}','chua_giao','thử lùi') j`)
  const saleLuiChan = !!rSaleLui.e && /LÙI mốc chỉ CEO/.test(rSaleLui.e)
  // ceo lùi KHÔNG lý do → CHẶN
  const rCeoLuiNo = await as(CEO, `select kho.dat_moc_ban_giao('${D.did}','chua_giao',null) j`)
  const ceoLuiNoChan = !!rCeoLuiNo.e && /LÙI mốc PHẢI có lý do/.test(rCeoLuiNo.e)
  // ceo lùi + lý do → QUA
  const rCeoLui = await as(CEO, `select kho.dat_moc_ban_giao('${D.did}','chua_giao','CEO sửa nhầm') j`, [], true)
  const luiQua = !rCeoLui.e && (await moc(D.did)).moc_ban_giao === 'chua_giao'
  console.log(`   f PATCH:${patchChan?'từ chối':'LỌT⚠'} · nhảy cóc:${nhayChan?'CHẶN':'LỌT⚠'} · sale lùi:${saleLuiChan?'CHẶN':'LỌT⚠'} · ceo-lùi-ko-lý:${ceoLuiNoChan?'CHẶN':'LỌT⚠'} · ceo lùi+lý:${luiQua?'QUA':'CHẶN'}`)
  ok('f. moc: client PATCH từ chối · nhảy cóc CHẶN · sale lùi CHẶN · ceo lùi+lý do QUA', patchChan && nhayChan && saleLuiChan && ceoLuiNoChan && luiQua, JSON.stringify({ patch: rPatch.e, nhay: rNhay.e, saleLui: rSaleLui.e, ceoLuiNo: rCeoLuiNo.e, ceoLui: rCeoLui.e }))
  await c.query('rollback to savepoint f')
}

// ═══ g · đơn sang da_giao → moc_ban_giao TỰ thành da_giao_chua_lap (không ai bấm) ═══
{ await c.query('savepoint g')
  const D = await mkDon('G', 'le', 50000000)
  await c.query(`set local session_replication_role='replica'`)
  await c.query(`update kho.don_hang set trang_thai='cho_giao' where id=$1`, [D.did])
  await c.query(`set local session_replication_role='origin'`)
  const truoc = (await moc(D.did)).moc_ban_giao
  const r = await as(CEO, `select kho.doi_trang_thai_don('${D.did}','da_giao',null) j`, [], true)
  const sau = await moc(D.did)
  const tuNhay = !r.e && truoc === 'chua_giao' && sau.moc_ban_giao === 'da_giao_chua_lap' && sau.moc_dat_luc !== null
  console.log(`   g trước=${truoc} → sang da_giao → moc=${sau.moc_ban_giao} (tự, moc_dat_luc ${sau.moc_dat_luc?'có':'trống'})`)
  ok('g. đơn sang da_giao → moc tự thành da_giao_chua_lap (không ai bấm)', tuNhay, r.e || JSON.stringify(sau))
  await c.query('rollback to savepoint g')
}

// ═══ h · lich_thu_den_han: chưa tới mốc KHÔNG hiện · đã đạt mốc chưa thu đủ CÓ hiện ═══
{ await c.query('savepoint h')
  const D = await mkDon('H', 'du_an', 100000000, false)   // KHÔNG demo (den_han loại demo như con_phai_thu) · 3 đợt 30/40/30
  await as(CEO, `select kho.lt_sinh_mac_dinh('${D.did}')`, [], true)
  // chưa giao, chưa thu gì: đợt 'chot_don'(30%) ĐÃ đạt mốc (đã chốt) & chưa thu → PHẢI hiện; 'da_giao_chua_lap','da_lap_xong' CHƯA đạt → KHÔNG hiện
  const r1 = await as(CEO, `select kho.lich_thu_den_han(current_date) j`)
  const dot1 = (r1.r[0].j.dot || []).filter(x => x.ma_don === D.ma)
  const hienChot = dot1.some(x => x.moc === 'chot_don')
  const anGiao = !dot1.some(x => x.moc === 'da_giao_chua_lap' || x.moc === 'da_lap_xong')
  // thu đủ 30% (đợt chot_don) → đợt chot_don biến mất; đưa đơn sang da_giao_chua_lap → đợt 2 xuất hiện
  await coc(D.ma, 30000000)
  await c.query(`set local session_replication_role='replica'`); await c.query(`update kho.don_hang set moc_ban_giao='da_giao_chua_lap' where id=$1`, [D.did]); await c.query(`set local session_replication_role='origin'`)
  const r2 = await as(CEO, `select kho.lich_thu_den_han(current_date) j`)
  const dot2 = (r2.r[0].j.dot || []).filter(x => x.ma_don === D.ma)
  const chotXong = !dot2.some(x => x.moc === 'chot_don')        // đã thu đủ 30 → không còn thiếu
  const giaoHien = dot2.some(x => x.moc === 'da_giao_chua_lap') // mốc mới đạt, chưa thu phần 40 → hiện
  console.log(`   h ban đầu: chot_don hiện=${hienChot}, giao/lắp ẩn=${anGiao} · sau thu 30%+giao: chot ẩn=${chotXong}, giao hiện=${giaoHien}`)
  ok('h. den_han: chưa tới mốc KHÔNG hiện · đã đạt mốc chưa thu đủ CÓ hiện', hienChot && anGiao && chotXong && giaoHien, JSON.stringify({ dot1, dot2 }))
  await c.query('rollback to savepoint h')
}

await c.query('rollback')
console.log(`\n═══ WP-75: ${P} pass / ${F} fail ═══`)
await c.end()
process.exit(F ? 1 : 0)
