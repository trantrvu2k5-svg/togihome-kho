// TEST PHẢI CẮN — 120 · nền demo (WP-02a/L-57). Tx rollback, KHÔNG để lại dữ liệu. Mỗi test cắn HAI vế.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo: '205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan: '487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? '  — ' + e : '')); v ? P++ : F++ }
const q = async (s, a = []) => (await c.query(s, a)).rows
const one = async (s, a = []) => (await q(s, a))[0]
async function as(uid, sql, args = []) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null
  try { r = (await c.query(sql, args)).rows } catch (x) { e = x.message; try { await c.query('rollback to savepoint s') } catch (_) {} }
  if (!e) await c.query('release savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e }
}
const KY = '2099-12'

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  for (const g of ['off_nguon','off_thuonghieu','off_nhay','off_mon_gia','off_von','off_von_chuyen','off_khachmoi']) await c.query(`set local chan.${g}='1'`)
  // cô lập: các đơn da_giao thật khác đánh demo? Không — chỉ kiểm mã DEMO-T01 xuất hiện/không.
  await q(`insert into kho.tham_so_tai_chinh(ma_ky,ky_tinh,vat,hh_sale,hh_quan_ly,hh_thiet_ke,chi_phi_nang_luc) values($1,'ban_hang',10,0.03,0.01,0.01,500000000)`, [KY])
  await q(`insert into kho.luong_to(ma_ky,ma_to,luong_to,bao_hiem) select $1,ma_to,10000000,1000000 from kho.to_san_xuat limit 1`, [KY])

  console.log('── 1 · cờ la_demo TỰ ĐỘNG ──')
  await q(`insert into kho.khach(sdt,ten) values('0900DEMO','DEMO test')`)
  ok('#1 khach ten DEMO* → la_demo=true tự động', (await one(`select la_demo from kho.khach where sdt='0900DEMO'`)).la_demo === true)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,sdt_khach,thuong_hieu,nguon_khach)
           values('DEMO-T01','da_giao','le',11000000,200000,100000,$1,'DEMO test','0900DEMO','togihome','quang_cao')`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values('DEMO-T01',3000000,1000000,500000,4500000,'plugin')`)
  ok('#1 don_hang DEMO-* → la_demo=true tự động', (await one(`select la_demo from kho.don_hang where ma_don='DEMO-T01'`)).la_demo === true)
  // đơn thật cùng kỳ (không demo) để so
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,thuong_hieu,nguon_khach)
           values('THAT-T01','da_giao','le',22000000,200000,100000,$1,'Khách thật','togihome','quang_cao')`, [KY + '-10'])
  await q(`insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguon) values('THAT-T01',3000000,1000000,500000,4500000,'plugin')`)
  ok('#1 đơn THAT-* → la_demo=false', (await one(`select la_demo from kho.don_hang where ma_don='THAT-T01'`)).la_demo === false)
  // L-60: cờ demo THEO KHÁCH — đơn mã DH-… (Sale sinh) của khách demo vẫn phải bắt được
  await q(`insert into kho.khach(sdt,ten) values('0900DEMO2','DEMO khách phòng họp')`)   // khach.la_demo=true (trigger khách)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,sdt_khach,thuong_hieu,nguon_khach)
           values('DH-DEMOK01','da_giao','le',5000000,200000,100000,$1,'Phòng họp cty','0900DEMO2','togihome','quang_cao')`, [KY + '-10'])
  ok('#1 đơn DH-… (mã KHÔNG DEMO-*) của khách demo → la_demo=true (nối sdt_khach→khach.la_demo)', (await one(`select la_demo from kho.don_hang where ma_don='DH-DEMOK01'`)).la_demo === true)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,sdt_khach,thuong_hieu,nguon_khach)
           values('DH-THAT02','da_giao','le',5000000,200000,100000,$1,'Khách thường','0912340002','togihome','quang_cao')`, [KY + '-10'])
  ok('#1 đơn DH-… khách THƯỜNG → la_demo=false', (await one(`select la_demo from kho.don_hang where ma_don='DH-THAT02'`)).la_demo === false)
  // L-63: mô phỏng ĐÚNG đường Sale — upsert ON CONFLICT (ma_don), cùng thứ tự cột app dùng
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ship_thuc_tra,lap_thuc_tra,ngay_giao,ten_khach,sdt_khach,thuong_hieu,nguon_khach)
           values('DH-SALE01','moi_len_don','le',9000000,0,0,$1,'DEMO Phòng họp','0900SALE','togihome','quang_cao')
           on conflict (ma_don) do update set ten_khach=excluded.ten_khach, gia_chot=excluded.gia_chot`, [KY + '-10'])
  ok('#1 Sale-upsert đơn DH-… ten_khach DEMO* → la_demo=true', (await one(`select la_demo from kho.don_hang where ma_don='DH-SALE01'`)).la_demo === true)

  console.log('\n── 2 · 6 RPC: demo VẮNG mặc định, HIỆN khi p_gom_demo=true ──')
  const hasDon = (g, ma) => JSON.stringify(g).includes(ma)
  const cm0 = await as(U.ceo, `select kho.cm_don_ky($1) g`, [KY]); const cm1 = await as(U.ceo, `select kho.cm_don_ky($1,0,'cm_pct.asc',true) g`, [KY])
  ok('#2 cm_don_ky mặc định KHÔNG có DEMO-T01, CÓ THAT-T01', !hasDon(cm0.r[0].g.ds, 'DEMO-T01') && hasDon(cm0.r[0].g.ds, 'THAT-T01'))
  ok('#2 cm_don_ky p_gom_demo=true → CÓ DEMO-T01', hasDon(cm1.r[0].g.ds, 'DEMO-T01'))
  const pl0 = await as(U.ceo, `select kho.pl_ky($1) g`, [KY]); const pl1 = await as(U.ceo, `select kho.pl_ky($1,true) g`, [KY])
  const dt0 = Number(pl0.r[0].g.dong.doanh_thu_thuan.toan_cty), dt1 = Number(pl1.r[0].g.dong.doanh_thu_thuan.toan_cty)
  ok('#2 pl_ky demo KHÔNG vào DT (gom_demo=true DT lớn hơn)', dt1 > dt0 && dt0 > 0)
  const gv0 = await as(U.ceo, `select kho.gia_von_don_ds(200,0) g`); const gv1 = await as(U.ceo, `select kho.gia_von_don_ds(200,0,true) g`)
  ok('#2 gia_von_don_ds mặc định KHÔNG có DEMO-T01', !hasDon(gv0.r[0].g.ds, 'DEMO-T01') && hasDon(gv1.r[0].g.ds, 'DEMO-T01'))
  const kc0 = await as(U.ceo, `select kho.kenh_cac_ky($1) g`, [KY]); const kc1 = await as(U.ceo, `select kho.kenh_cac_ky($1,null,true) g`, [KY])
  ok('#2 kenh_cac_ky demo không vào CM (gom_demo lớn hơn)', Number(kc1.r[0].g.tong.cm_kenh) > Number(kc0.r[0].g.tong.cm_kenh))
  const ld0 = await as(U.ceo, `select kho.lap_day_ky($1) g`, [KY]); const ld1 = await as(U.ceo, `select kho.lap_day_ky($1,true) g`, [KY])
  ok('#2 lap_day_ky demo không vào khối 2 (gom_demo k2 lớn hơn)', Number(ld1.r[0].g.tong_khoi_2) > Number(ld0.r[0].g.tong_khoi_2))
  ok('#2 các RPC gọi ĐÚNG 1 chữ ký (không overload)', (await q(`select proname,count(*) n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace where nn.nspname='kho' and proname in ('cm_don_ky','pl_ky','kenh_cac_ky','lap_day_ky','cm_don_raw','gia_von_don_ds') group by proname having count(*)>1`)).length === 0)

  console.log('\n── 3 · xoa_demo ──')
  // quét tem giả cho DEMO-T01 để có su_kien_quet? cần tem — chèn tối thiểu tem_ban_ve + tien_do_tem + su_kien_quet
  await q(`insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,vai_tro) values('DEMO-T01',1,'DEMO-T01#1','than')`)
  await q(`insert into kho.tien_do_tem(tem_ma,ma_don,trang_thai) values('DEMO-T01#1','DEMO-T01','dang_lam')`)
  await q(`insert into kho.su_kien_quet(tem_ma,ma_tram,loai,ket_qua,nguon) values('DEMO-T01#1',(select ma_tram from kho.tram limit 1),'vao','nhan','quet')`)
  await q(`insert into kho.phieu_thu(ma_don,ngay,so_tien,loai) values('DEMO-T01',$1,5000000,'coc')`, [KY + '-11'])
  const xd = await as(U.ceo, `select kho.xoa_demo('DEMO-T01') g`)
  ok('#3 xoa_demo chạy OK', xd.e === null, xd.e)
  console.log('   jsonb xoa_demo:', JSON.stringify(xd.r?.[0]?.g))
  const con = await one(`select
    (select count(*) from kho.don_hang where ma_don='DEMO-T01') d,
    (select count(*) from kho.don_hang_gia_von where ma_don='DEMO-T01') gv,
    (select count(*) from kho.tem_ban_ve where ma_don='DEMO-T01') t,
    (select count(*) from kho.tien_do_tem where ma_don='DEMO-T01') td,
    (select count(*) from kho.su_kien_quet where tem_ma='DEMO-T01#1') sq,
    (select count(*) from kho.phieu_thu where ma_don='DEMO-T01') pt`)
  ok('#3 mọi bảng con của DEMO-T01 = 0 (don/gv/tem/tien_do/quet/phieu_thu)', Object.values(con).every(v => Number(v) === 0), JSON.stringify(con))
  ok('#3 THAT-T01 KHÔNG bị xoá (chỉ demo)', Number((await one(`select count(*) n from kho.don_hang where ma_don='THAT-T01'`)).n) === 1)

  console.log('\n── 4 · guard xoa_demo ──')
  const g1 = await as(U.ceo, `select kho.xoa_demo() g`)
  ok('#4 xoa_demo() không p_xac_nhan → RAISE', g1.e !== null && /XOA_HET/.test(g1.e), g1.e)
  const g2 = await as(U.ke_toan, `select kho.xoa_demo('DEMO-T01') g`)
  ok('#4 vai ke_toan (không ceo) → CHẶN', g2.e !== null && /chỉ CEO/i.test(g2.e), g2.e)
  const g3 = await as(U.ceo, `select kho.xoa_demo('THAT-T01') g`)
  ok('#4 xoa_demo đơn KHÔNG-demo → RAISE', g3.e !== null && /KHÔNG phải demo/i.test(g3.e), g3.e)

  console.log('\n── 5 · so_ba_nguon 199/199 (không chạm sổ kho) ──')
  const sbn = readFileSync('/Users/vuquanghai/Documents/togihome-kho/web/ops/so_ba_nguon.sql', 'utf8')
  const tong = (await q(sbn)).find(x => x.ma === 'TỔNG')
  ok('#5 so_ba_nguon vẫn khớp (giao_dich/ton không đụng)', tong.khop === true, JSON.stringify(tong))

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_120: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(() => {}); await c.end(); process.exit(F === 0 ? 0 : 1) }
