// TEST PHẢI CẮN — hoá đơn NCC + khớp 3 chiều + phiếu chi + công nợ phải trả (WP-22/db/135). Tx rollback. auth_uid test_*.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + String(e).slice(0, 180) : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
let U = {}, NCC, KHO, VT
async function as(uid, sql, args = [], keep = false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows; if (keep) await c.query('release savepoint s') }
  catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
async function mkDon(vt, sl, dg, nhan) {   // dm_tao→da_gui→xac_nhan→dm_nhan_hang ; trả {donId, dong}
  const r = await as(U.ceo, `select kho.dm_tao($1,$2,null,'demo wp22',$3::jsonb,false) g`, [NCC, KHO, JSON.stringify([{ vat_tu_id: vt, so_luong: sl, don_gia: dg }])], true)
  if (r.e) throw new Error('dm_tao: ' + r.e)
  const donId = r.r[0].g.id
  const dong = (await one(`select id from kho.don_mua_dong where don_mua_id=$1`, [donId])).id
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'da_gui')`, [donId], true)
  await as(U.ceo, `select kho.dm_chuyen_trang_thai($1,'xac_nhan')`, [donId], true)
  const rn = await as(U.ceo, `select kho.dm_nhan_hang($1,$2::jsonb) g`, [donId, JSON.stringify([{ dong_id: dong, so_luong: nhan }])], true)
  if (rn.e) throw new Error('dm_nhan_hang: ' + rn.e)
  return { donId, dong }
}
const HD = (don, so, loai, vat, dong) => as(U.ceo, `select kho.hd_ncc_ghi($1,$2,$3,current_date,current_date+30,$4,'x',$5::jsonb) g`, [don, so, loai, vat, JSON.stringify(dong)], true)
const tt = async don => (await one(`select trang_thai from kho.don_mua where id=$1`, [don])).trang_thai

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  U.ceo = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_ceo'`)).a
  U.kho = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_kho'`)).a
  U.sale = (await one(`select auth_uid a from kho.nguoi_dung where ho_ten='test_sale'`)).a
  NCC = (await one(`select id from kho.nha_cung_cap order by ten limit 1`)).id
  KHO = (await one(`select id from kho.kho where la_mac_dinh limit 1`)).id
  VT = (await q(`select id from kho.vat_tu where ngung_dung=false and dvt=don_vi_co_so order by ma limit 3`)).map(x => x.id)

  console.log('── a · ghi HĐ đủ → tổng đúng, đơn da_khop_hd, lịch sử 1 dòng ──')
  const A = await mkDon(VT[0], 10, 1000, 10)
  { const r = await HD(A.donId, 'HD-A', 'hoa_don_vat', 10, [{ don_mua_dong_id: A.dong, so_luong: 10, don_gia_hd: 1000 }])
    const g = r.r?.[0]?.g
    ok('a tổng chưa VAT 10.000 · VAT 1.000 · gồm 11.000', g && Number(g.tong_chua_vat) === 10000 && Number(g.tong_vat) === 1000 && Number(g.tong_gom_vat) === 11000, JSON.stringify(g))
    ok('a đơn → da_khop_hd', (await tt(A.donId)) === 'da_khop_hd', await tt(A.donId))
    const ls = await one(`select count(*) c from kho.don_mua_lich_su where don_mua_id=$1 and noi_dung ? 'khop_hd'`, [A.donId])
    ok('a lịch sử khớp HĐ 1 dòng', Number(ls.c) === 1, JSON.stringify(ls)) }

  console.log('\n── b · HĐ SL > đã nhận → RAISE HD_VUOT_NHAN, không ghi gì ──')
  const B = await mkDon(VT[0], 10, 1000, 10)
  { const r = await HD(B.donId, 'HD-B', 'hoa_don_vat', 10, [{ don_mua_dong_id: B.dong, so_luong: 12, don_gia_hd: 1000 }])
    const n = await one(`select count(*) c from kho.hoa_don_ncc where don_mua_id=$1`, [B.donId])
    ok('b RAISE HD_VUOT_NHAN + 0 hoá đơn', /HD_VUOT_NHAN/.test(r.e || '') && Number(n.c) === 0, (r.e || '') + ' | HĐ=' + n.c) }

  console.log('\n── c · HĐ một phần → da_nhan; HĐ 2 phủ nốt → da_khop_hd ──')
  const C = await mkDon(VT[0], 10, 1000, 10)
  { await HD(C.donId, 'HD-C1', 'hoa_don_vat', 10, [{ don_mua_dong_id: C.dong, so_luong: 6, don_gia_hd: 1000 }])
    ok('c sau HĐ#1 (6/10) đơn vẫn da_nhan', (await tt(C.donId)) === 'da_nhan', await tt(C.donId))
    await HD(C.donId, 'HD-C2', 'hoa_don_vat', 10, [{ don_mua_dong_id: C.dong, so_luong: 4, don_gia_hd: 1000 }])
    ok('c sau HĐ#2 (phủ nốt) → da_khop_hd', (await tt(C.donId)) === 'da_khop_hd', await tt(C.donId)) }

  console.log('\n── d · lệch giá +3.000 → gia_von_lo đổi, ton.gia_von_bq đúng công thức ──')
  const D = await mkDon(VT[1], 5, 1000, 5)
  { const bq0 = Number((await one(`select gia_von_bq from kho.ton where vat_tu_id=$1 and kho_id=$2`, [VT[1], KHO])).gia_von_bq)
    await HD(D.donId, 'HD-D', 'hoa_don_vat', 8, [{ don_mua_dong_id: D.dong, so_luong: 5, don_gia_hd: 4000 }])
    const lo = await one(`select l.gia_von_lo from kho.lo_nhap l join kho.phieu_dong pd on pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id where pd.don_mua_dong_id=$1 and l.lo_da_huy=false`, [D.dong])
    ok('d gia_von_lo lô sống = 4000', Number(lo.gia_von_lo) === 4000, JSON.stringify(lo))
    const bq1 = Number((await one(`select gia_von_bq from kho.ton where vat_tu_id=$1 and kho_id=$2`, [VT[1], KHO])).gia_von_bq)
    const ct = Number((await one(`select round(sum(con_lai*gia_von_lo)/nullif(sum(con_lai),0)) g from kho.lo_nhap where vat_tu_id=$1 and kho_id=$2 and lo_da_huy=false and con_lai>0 and gia_von_lo is not null`, [VT[1], KHO])).g)
    ok('d ton.gia_von_bq = đúng công thức lô-sống + đã ĐỔI', bq1 === ct && bq1 !== bq0, `bq0=${bq0} bq1=${bq1} ct=${ct}`) }

  console.log('\n── e · bang_ke → VAT ép 0 ──')
  const E = await mkDon(VT[0], 4, 500, 4)
  { const r = await HD(E.donId, 'HD-E', 'bang_ke', 10, [{ don_mua_dong_id: E.dong, so_luong: 4, don_gia_hd: 500 }])
    const g = r.r?.[0]?.g
    ok('e vat_pct=0 · tong_vat=0 · gồm=chưa', g && Number(g.vat_pct) === 0 && Number(g.tong_vat) === 0 && Number(g.tong_gom_vat) === 2000, JSON.stringify(g)) }

  console.log('\n── f · pc_ghi vượt con_lai → RAISE; pc_ghi không gắn HĐ → con_phai_tra âm ──')
  { const hdId = (await one(`select id from kho.hoa_don_ncc where don_mua_id=$1`, [A.donId])).id   // gồm=11.000
    const r1 = await as(U.ceo, `select kho.pc_ghi(current_date,$1,$2,20000,'ck','x')`, [NCC, hdId], true)
    ok('f chi 20.000 > 11.000 → CHI_VUOT_HD', /CHI_VUOT_HD/.test(r1.e || ''), r1.e)
    // NCC riêng, không HĐ, 1 phiếu chi ứng → con_phai_tra âm
    const ncc2 = (await one(`insert into kho.nha_cung_cap(ten) values('WP22 ứng trước') returning id`)).id
    await as(U.ceo, `select kho.pc_ghi(current_date,$1,null,5000,'ck','ứng')`, [ncc2], true)
    const cpt = (await as(U.ceo, `select kho.con_phai_tra(null,false) g`)).r[0].g
    const row = (cpt.ds || []).find(x => x.ncc_id === ncc2)
    ok('f con_phai_tra NCC ứng = -5000', row && Number(row.con_lai) === -5000, JSON.stringify(row)) }

  console.log('\n── g · pc_xoa hồi con_lai; hd_ncc_xoa có phiếu chi → RAISE; không có → lô đảo + đơn da_nhan ──')
  { const hdA = (await one(`select id, tong_gom_vat from kho.hoa_don_ncc where don_mua_id=$1`, [A.donId])).id
    const pc = (await as(U.ceo, `select kho.pc_ghi(current_date,$1,$2,5000,'ck','trả 1 phần') g`, [NCC, hdA], true)).r[0].g.id
    const con1 = Number((await as(U.ceo, `select (kho.hd_ncc_ds($1)->0->>'con_lai')::numeric v`, [A.donId])).r[0].v)
    const rx = await as(U.ceo, `select kho.hd_ncc_xoa($1)`, [hdA], true)
    ok('g hd_ncc_xoa khi có phiếu chi → HD_CO_PHIEU_CHI', /HD_CO_PHIEU_CHI/.test(rx.e || ''), rx.e)
    await as(U.ceo, `select kho.pc_xoa($1)`, [pc], true)
    const con2 = Number((await as(U.ceo, `select (kho.hd_ncc_ds($1)->0->>'con_lai')::numeric v`, [A.donId])).r[0].v)
    ok('g pc_xoa → con_lai hồi (6000→11000)', con1 === 6000 && con2 === 11000, `con1=${con1} con2=${con2}`)
    const rx2 = await as(U.ceo, `select kho.hd_ncc_xoa($1) g`, [hdA], true)
    ok('g hd_ncc_xoa OK → đơn da_khop_hd → da_nhan', rx2.e === null && (await tt(A.donId)) === 'da_nhan', rx2.e || await tt(A.donId))
    const loA = await one(`select l.gia_von_lo from kho.lo_nhap l join kho.phieu_dong pd on pd.phieu_id=l.phieu_id and pd.vat_tu_id=l.vat_tu_id where pd.don_mua_dong_id=$1 and l.lo_da_huy=false`, [A.dong])
    ok('g lô đảo về don_gia_don (1000)', Number(loA.gia_von_lo) === 1000, JSON.stringify(loA)) }

  console.log('\n── h · dong_tien_ky: tra_ncc = Σ phiếu chi; đẳng thức quỹ đúng trước & sau ──')
  { const ky = '2026-08'
    const d0 = (await as(U.ceo, `select kho.dong_tien_ky($1) g`, [ky])).r[0].g
    const eq0 = Number(d0.quy.cuoi_ky) === Number(d0.quy.dau_ky) + Number(d0.quy.rong_kd) + Number(d0.quy.rong_ngoai)
    const hdE = (await one(`select id from kho.hoa_don_ncc where don_mua_id=$1`, [E.donId])).id
    await as(U.ceo, `select kho.pc_ghi('2026-08-15'::date,$1,$2,700,'tm','trả bảng kê')`, [NCC, hdE], true)
    const d1 = (await as(U.ceo, `select kho.dong_tien_ky($1) g`, [ky])).r[0].g
    const eq1 = Number(d1.quy.cuoi_ky) === Number(d1.quy.dau_ky) + Number(d1.quy.rong_kd) + Number(d1.quy.rong_ngoai)
    ok('h tra_ncc tăng đúng 700', Number(d1.chi.theo_so.tra_ncc) - Number(d0.chi.theo_so.tra_ncc) === 700, `${d0.chi.theo_so.tra_ncc}→${d1.chi.theo_so.tra_ncc}`)
    ok('h đẳng thức quỹ đúng trước & sau', eq0 && eq1, `eq0=${eq0} eq1=${eq1}`)
    ok('h rong_kd giảm đúng 700 (chi tăng)', Number(d0.chi.tong) + 700 === Number(d1.chi.tong), `${d0.chi.tong}→${d1.chi.tong}`) }

  console.log('\n── i · vai sale gọi hd_ncc_ghi / pc_ghi → chặn ──')
  { const I = await mkDon(VT[0], 3, 100, 3)
    const r1 = await as(U.sale, `select kho.hd_ncc_ghi($1,'HD-I','hoa_don_vat',current_date,current_date+30,10,'x',$2::jsonb)`, [I.donId, JSON.stringify([{ don_mua_dong_id: I.dong, so_luong: 3, don_gia_hd: 100 }])])
    const r2 = await as(U.sale, `select kho.pc_ghi(current_date,$1,null,100,'ck','x')`, [NCC])
    ok('i sale hd_ncc_ghi + pc_ghi đều chặn', /chỉ kho\/ke_toan\/ceo/.test(r1.e || '') && /chỉ ceo\/ke_toan/.test(r2.e || ''), (r1.e || '') + ' | ' + (r2.e || '')) }

  // ═══ PERF @100k DIRECT (set role 1 lần, không savepoint) ═══
  console.log('\n── PERF @100k ──')
  const PF = await mkDon(VT[2], 100, 1, 100)   // đơn da_nhan còn nguyên (chưa HĐ) để đo hd_ncc_ghi
  { await c.query(`set session_replication_role='replica'`)
    await c.query(`insert into kho.hoa_don_ncc(so_hd,loai_chung_tu,ncc_id,don_mua_id,ngay_hd,han_thanh_toan,vat_pct,tong_chua_vat,tong_vat,tong_gom_vat)
      select 'PF'||g,'hoa_don_vat',$1,$2,'2026-08-10'::date,'2026-09-10'::date,10,1000,100,1100 from generate_series(1,100000) g`, [NCC, A.donId])
    await c.query(`insert into kho.phieu_chi_ncc(ngay_chi,ncc_id,hoa_don_ncc_id,so_tien,hinh_thuc)
      select '2026-08-12'::date,$1,null,500,'ck' from generate_series(1,100000) g`, [NCC])
    await c.query(`set session_replication_role='origin'`)
    await c.query(`analyze kho.hoa_don_ncc`); await c.query(`analyze kho.phieu_chi_ncc`)
    await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: U.ceo, role: 'authenticated' })])
    const ms = async (sql, a = []) => { await c.query(sql, a); return Number((await c.query(`explain (analyze,format json,timing off,buffers off) ` + sql, a)).rows[0]['QUERY PLAN'][0]['Execution Time']) }   // read-only: warm rồi đo
    const msOnce = async (sql, a = []) => Number((await c.query(`explain (analyze,format json,timing off,buffers off) ` + sql, a)).rows[0]['QUERY PLAN'][0]['Execution Time'])   // ghi: đo 1 lần
    const m_cpt = await ms(`select kho.con_phai_tra('2026-08',false)`)
    const m_dtk = await ms(`select kho.dong_tien_ky('2026-08')`)
    const m_hd = await msOnce(`select kho.hd_ncc_ghi($1,'PFOP','hoa_don_vat',current_date,current_date+30,10,'x',$2::jsonb)`, [PF.donId, JSON.stringify([{ don_mua_dong_id: PF.dong, so_luong: 1, don_gia_hd: 1 }])])
    const m_pc = await msOnce(`select kho.pc_ghi(current_date,$1,null,100,'ck','pf')`, [NCC])
    await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
    global.MS = { cpt: m_cpt, dtk: m_dtk, hd: m_hd, pc: m_pc }
    ok(`PERF con_phai_tra @100k = ${m_cpt.toFixed(0)}ms < 900`, m_cpt < 900, m_cpt)
    ok(`PERF dong_tien_ky @100k = ${m_dtk.toFixed(0)}ms < 900`, m_dtk < 900, m_dtk)
    ok(`PERF hd_ncc_ghi @100k = ${m_hd.toFixed(0)}ms < 500`, m_hd < 500, m_hd)
    ok(`PERF pc_ghi @100k = ${m_pc.toFixed(0)}ms < 500`, m_pc < 500, m_pc) }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_hd_ncc: ${P} pass / ${F} fail`)
  console.log('MS ' + JSON.stringify(global.MS))
} catch (e) { console.error('💥', e.message, e.stack?.split('\n')[1] || ''); F++ }
finally { try { await c.query('rollback') } catch (_) {} await c.end(); process.exit(F ? 1 : 0) }
