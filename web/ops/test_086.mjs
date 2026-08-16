// TEST CẮN — 086 · thiết kế bán hàng nhập SỐ ƯỚC (mốc du_kien) khi gửi bản. Tx rollback.
//   cd web && node ops/test_086.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = {
  ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e',
  tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb',
  ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  NULLVAI:'00000000-0000-0000-0000-000000000000',
}
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
async function asK(uid, s, a = []) {
  await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const gK = async (uid, s, a = []) => { const x = await asK(uid, s, a); return x.r ? x.r[0].g : { _e: x.e } }

// đơn báo giá + 1 món routing Q86 (1 bước cat, tổ cnc)
async function donBaoGia(ma, sp = null, kt = '160x60x75') {
  const don = (await q(`insert into kho.don_hang(ma_don,trang_thai,dong) values($1,'bao_gia','le') returning id`, [ma]))[0].id
  const mon = (await q(`insert into kho.don_hang_mon(don_id,ten,kt,sp_id,ma_quy_trinh) values($1,$2,$3,$4,'Q86') returning id`,
    [don, 'Món ' + ma, kt, sp]))[0].id
  return { don, mon }
}

try {
  await c.query('begin')
  // routing dùng chung: 1 bước 'cat' (gmdv=1) → atp cần số 'cat'
  await q(`insert into kho.quy_trinh(ma_quy_trinh,ten) values('Q86','ước-test')`)
  await q(`insert into kho.quy_trinh_buoc(ma_quy_trinh,thu_tu,buoc_truoc,nhanh,hoat_dong,loai_buoc,gio_co_dinh,gio_moi_don_vi)
           values('Q86',100,'{}','chung','cat','nguoi',0,1)`)
  // đủ năng lực cnc từ sớm → atp xếp được ngày
  await q(`update kho.nang_luc_to set tu_ngay = current_date - 120 where ma_to='cnc' and den_ngay is null`)
  // san_pham_mau cho FK sp_id: SP-KE, SP-DUYNHAT-XYZ + SP-0..SP-99 (perf)
  await q(`insert into kho.san_pham_mau(ma,ten) values ('SP-KE','Kệ mẫu'),('SP-DUYNHAT-XYZ','Món độc nhất')`)
  await q(`insert into kho.san_pham_mau(ma,ten) select 'SP-'||g,'SP mẫu '||g from generate_series(0,99) g`)

  // ═══ 1 · tk_ban_hang GHI du_kien → được · GHI chuan (trực tiếp) → CHẶN ═══
  console.log('\n── 1 · tk_ban_hang: du_kien ĐƯỢC · chuan CHẶN ──')
  const A = await donBaoGia('T86-1')
  const wDu = await gK(U.tk_ban_hang, `select kho.tkbh_so_uoc('T86-1',$1,'{"cat":40}'::jsonb) g`, [A.mon])
  ok('#1a tk_ban_hang ghi du_kien → ĐƯỢC (so_ghi=1)', wDu.ok === true && wDu.so_ghi === 1 && wDu.moc === 'du_kien' && wDu.nguon === 'uoc', JSON.stringify(wDu))
  // đường ghi chuẩn = luu_so_don_vi (ceo/thiet_ke). tk_ban_hang gọi nó (mốc chuan) → CHẶN.
  const wCh = await asK(U.tk_ban_hang, `select kho.luu_so_don_vi($1,'cat','45','go_tay','chuan')`, [A.mon])
  ok('#1b tk_ban_hang ghi mốc chuan (luu_so_don_vi) → CHẶN (chỉ ceo/thiet_ke)',
    wCh.e !== null && /chỉ ceo\/thiet_ke/.test(wCh.e || ''), wCh.e || '(lọt!)')

  // ═══ 2 · atp SỐNG LẠI (test quan trọng nhất) ═══
  console.log('\n── 2 · atp: chưa số → THIEU · đủ ước → NGÀY + do_tin=uoc ──')
  const B = await donBaoGia('T86-2')
  const a0 = await gK(U.ceo, `select kho.atp('T86-2','du_kien') g`)
  ok('#2a chưa ước gì → atp(du_kien) = THIEU_SO_DON_VI (ok=false)',
    a0.ok === false && a0.loi === 'THIEU_SO_DON_VI', JSON.stringify(a0))
  const wr = await gK(U.tk_ban_hang, `select kho.tkbh_so_uoc('T86-2',$1,'{"cat":50}'::jsonb) g`, [B.mon])
  const a1 = await gK(U.ceo, `select kho.atp('T86-2','du_kien') g`)
  ok('#2b nhập ước cat=50 → atp(du_kien) RA NGÀY + do_tin=uoc (🟥 vẫn THIEU = mắt xích ĐỨT)',
    wr.ok === true && a1.ok === true && !!a1.ngay_hua_duoc && a1.do_tin === 'uoc' && a1.moc_da_dung === 'du_kien',
    JSON.stringify(a1))
  console.log('   → ngày hứa (du_kien/uoc):', a1.ngay_hua_duoc, '· do_tin:', a1.do_tin)
  const a1tkb = await asK(U.tk_ban_hang, `select kho.atp('T86-2','du_kien') g`)
  ok('#2c tk_ban_hang XEM được atp (thấy ngày mình vừa ước)', a1tkb.e === null && a1tkb.r && a1tkb.r[0].g.ok === true, a1tkb.e || '')

  // ═══ 3 · KHÔNG ĐỤNG mốc chuan ═══
  console.log('\n── 3 · ghi du_kien KHÔNG đổi mốc chuan ──')
  const D = await donBaoGia('T86-3')
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values($1,'cat','chuan',45,'go_tay')`, [D.mon])
  await gK(U.tk_ban_hang, `select kho.tkbh_so_uoc('T86-3',$1,'{"cat":40}'::jsonb) g`, [D.mon])
  const chuanSau = (await q(`select so_don_vi,nguon from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat' and moc='chuan'`, [D.mon]))[0]
  const duSau = (await q(`select so_don_vi,nguon from kho.so_don_vi_mon where mon_id=$1 and hoat_dong='cat' and moc='du_kien'`, [D.mon]))[0]
  ok('#3 chuan GIỮ 45/go_tay · du_kien = 40/uoc (🟥 chuan đổi = ĐỎ)',
    Number(chuanSau.so_don_vi) === 45 && chuanSau.nguon === 'go_tay' && Number(duSau.so_don_vi) === 40 && duSau.nguon === 'uoc',
    JSON.stringify({ chuanSau, duSau }))

  // ═══ 4 · GỢI Ý từ món tương tự ═══
  console.log('\n── 4 · gợi ý: cùng loại có chuan → trả số · không có → rỗng+cờ (KHÔNG 0) ──')
  const srcA = await donBaoGia('T86-4A', 'SP-KE', '160x60x75')
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon) values
           ($1,'cat','chuan',12,'go_tay'),($1,'dan','chuan',8,'go_tay'),($1,'canh','chuan',2,'go_tay')`, [srcA.mon])
  const tgtB = await donBaoGia('T86-4B', 'SP-KE', '158x60x75')   // cùng sp_id, kt gần
  const g4 = await gK(U.tk_ban_hang, `select kho.tkbh_goi_y_so($1) g`, [tgtB.mon])
  const hit = (g4.goi_y || [])[0]
  ok('#4a có món tương tự → co_goi_y=true, trả số của A (cat=12) + độ chênh kt',
    g4.co_goi_y === true && hit && hit.so_lieu && Number(hit.so_lieu.cat) === 12 && hit.chenh_kt !== undefined && hit.ten.includes('T86-4A'),
    JSON.stringify(g4))
  const tgtC = await donBaoGia('T86-4C', 'SP-DUYNHAT-XYZ', '200x50x50')   // không loại nào giống
  const g4b = await gK(U.tk_ban_hang, `select kho.tkbh_goi_y_so($1) g`, [tgtC.mon])
  ok('#4b không món tương tự → co_goi_y=false, goi_y=[] (🟥 trả 0 = ĐỎ)',
    g4b.co_goi_y === false && Array.isArray(g4b.goi_y) && g4b.goi_y.length === 0, JSON.stringify(g4b))

  // ═══ 5 · GỬI BẢN không bị chặn khi thiếu số ═══
  console.log('\n── 5 · gửi bản 3D KHÔNG cần số ước ──')
  const E = await donBaoGia('T86-5')
  const anh = JSON.stringify([{ duong_dan_nho: 'n.webp', duong_dan_to: 't.webp', byte_nho: 10, byte_to: 20 }])
  const gui = await gK(U.tk_ban_hang, `select kho.gui_ban_thiet_ke('T86-5','',$1::jsonb) g`, [anh])
  ok('#5 gửi bản khi CHƯA ước số nào → VẪN gửi được (🟥 bị chặn = ĐỎ)', gui.ok === true && gui.phien_ban === 1, JSON.stringify(gui))

  // ═══ 6 · CỔNG VAI ═══
  console.log('\n── 6 · cổng vai tkbh_so_uoc ──')
  const G = await donBaoGia('T86-6')
  for (const v of ['ceo', 'thiet_ke', 'tk_ban_hang']) {
    const r = await gK(U[v], `select kho.tkbh_so_uoc('T86-6',$1,'{"cat":10}'::jsonb) g`, [G.mon])
    ok(`#6+ ${v} ghi được`, r.ok === true, JSON.stringify(r))
  }
  for (const v of ['sale', 'tho', 'xuong', 'ke_toan', 'NULLVAI']) {
    const r = await asK(U[v], `select kho.tkbh_so_uoc('T86-6',$1,'{"cat":10}'::jsonb) g`, [G.mon])
    ok(`#6- ${v} → CHẶN`, r.e !== null && /chỉ ceo\/thiet_ke\/tk_ban_hang/.test(r.e || ''), r.e || '(lọt!)')
  }

  // ═══ 7 · HIỆU NĂNG gợi ý ở 3.000 đơn ═══
  console.log('\n── 7 · tkbh_goi_y_so ở 3.000 đơn, sau ANALYZE < 500ms ──')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong) select 'PERF86-'||g,'da_giao','le' from generate_series(1,3000) g`)
  await q(`insert into kho.don_hang_mon(don_id,ten,kt,sp_id,ma_quy_trinh)
           select d.id,'MP'||d.ma_don,(140+(g%40))||'x60x75','SP-'||(g%100),'Q86'
           from kho.don_hang d join generate_series(1,3000) g on d.ma_don='PERF86-'||g`)
  await q(`insert into kho.so_don_vi_mon(mon_id,hoat_dong,moc,so_don_vi,nguon)
           select m.id,'cat','chuan',10+(random()*30)::int,'go_tay'
           from kho.don_hang_mon m where m.ten like 'MPPERF86-%'
           on conflict (mon_id,hoat_dong,moc) do nothing`)
  await c.query('analyze kho.don_hang_mon'); await c.query('analyze kho.so_don_vi_mon')
  const tgtP = await donBaoGia('T86-7', 'SP-5', '160x60x75')   // sp_id SP-5 có ~30 ứng viên chuan
  const t0 = Date.now()
  const gp = await gK(U.tk_ban_hang, `select kho.tkbh_goi_y_so($1) g`, [tgtP.mon])
  const ms = Date.now() - t0
  ok(`#7 gợi ý ở 3.000 đơn = ${ms}ms (< 500ms) · có ${(gp.goi_y || []).length} gợi ý`, ms < 500 && gp.co_goi_y === true, `${ms}ms`)

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_086: ${P} pass / ${F} fail`)
} catch (e) {
  console.error('💥', e.message); F++
} finally {
  await c.query('rollback'); await c.end()
}
process.exit(F === 0 ? 0 : 1)
