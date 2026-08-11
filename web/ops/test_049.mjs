// TEST CẮN — 049 la_demo (loại demo khỏi báo cáo) + 050 don_cho_thiet_ke. Áp trong tx rồi ROLLBACK.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql49 = strip(readFileSync(new URL('../../db/049_la_demo.sql', import.meta.url), 'utf8'))
const sql50 = strip(readFileSync(new URL('../../db/050_don_cho_thiet_ke.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
try{
  await c.query('begin')
  await c.query(`delete from kho.don_hang where ma_don like 'DM-%'`)
  await c.query(sql49); await c.query(sql50)

  ok('cột la_demo có ở don_hang + phieu_dem_ngay',
    (await c.query(`select count(*)::int n from information_schema.columns where table_schema='kho' and column_name='la_demo' and table_name in ('don_hang','phieu_dem_ngay')`)).rows[0].n===2)

  // 2 đơn 'le' đã xong: 1 THẬT (lead 10) + 1 DEMO (lead 100) — cùng kỳ
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ngay_chot,ngay_vao_chuyen,ngay_xong,ngay_du_kien,ma_ky_ap_dung,la_demo) values
    ('DM-that','le','le_sang','da_giao',current_date-20,current_date-18,current_date-10,current_date-11,'2099-09',false),
    ('DM-demo','le','le_sang','da_giao',current_date-120,current_date-118,current_date-20,current_date-30,'2099-09',true)`)

  console.log('── lead_time LOẠI demo ──')
  const ltPatch=(await as(U.ceo,`select tong_tb,so_don from kho._lead_time_core('le',null,50)`)).r?.[0]
  const ltNaive=(await c.query(`select round(avg(dh.ngay_xong-dh.ngay_chot),1) tong_tb, count(*)::int so_don from kho.don_hang dh where dh.ngay_chot is not null and dh.ngay_xong is not null and dh.ngay_vao_chuyen is not null and dh.dong='le'`)).rows[0]
  ok('[CẮN] KHÔNG loại (naive): gộp cả demo → so_don gồm DM-demo', Number(ltNaive.so_don)>=2, JSON.stringify(ltNaive))
  ok('ĐÃ loại demo: DM-demo KHÔNG vào lead_time', Number(ltPatch.tong_tb)===10 || (Number(ltNaive.tong_tb)!==Number(ltPatch.tong_tb)), `patch tong_tb=${ltPatch.tong_tb} vs naive=${ltNaive.tong_tb}`)

  console.log('── ty_le_truy_duoc LOẠI demo ──')
  await c.query(`insert into kho.san_luong_don(ma_don,lot) values('DM-that',10),('DM-demo',999) on conflict(ma_don) do nothing`)
  const v_to=(await c.query(`select ma_to from kho.to_san_xuat limit 1`)).rows[0]?.ma_to
  await c.query('savepoint p'); try{ await c.query(`insert into kho.phieu_dem_ngay(ma_to,hoat_dong,ngay,so_luong,la_demo) values($1,'lot','2099-09-15',10,false),($1,'lot','2099-09-16',999,true)`,[v_to]) }catch(e){await c.query('rollback to savepoint p'); console.log('  (phieu skip',e.message.slice(0,40),')')}
  const tt=(await as(U.ceo,`select ty_le from kho.ty_le_truy_duoc('2099-09','lot')`)).r?.[0]
  // v_truy loại DM-demo(999) -> chỉ DM-that(10); mẫu số phiếu đếm loại demo(999) -> chỉ 10 -> ty_le=1.0
  ok('ty_le loại demo (v_truy + mẫu số bỏ 999) → 1.0', Number(tt?.ty_le)===1, JSON.stringify(tt))

  console.log('── 050 don_cho_thiet_ke ──')
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ghi_chu) values('DM-tk','le','le_rieng','moi_len_don','ghi chú đơn')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,sp_id,kt,vl,ma_mau,so_luong,chi_tiet,gia) select id,'Tủ áo',null,'1000x600','MDF','N01',2,'ghi chú món',9999999 from kho.don_hang where ma_don='DM-tk'`)
  const dtk=(await as(U.thiet_ke,`select * from kho.don_cho_thiet_ke() where ma_don='DM-tk'`))
  ok('thiet_ke gọi OK, có đơn + món', dtk.e===null && dtk.r.length>=1, dtk.e||'')
  const colArr=dtk.r&&dtk.r[0]?Object.keys(dtk.r[0]):[]; const cols=colArr.join(',')
  const nhaycam=['gia','gia_ban','sdt','dia_chi','khach','khach_ten','ten_khach','sdt_khach','thanh_toan','tinh_khach']
  ok('KHÔNG cột giá bán/khách/sđt/địa chỉ (ngay_hen_khach là NGÀY, ok)', !colArr.some(c=>nhaycam.includes(c)), cols)
  ok('CÓ món chi tiết (ten/kt/vl/ma_mau/sp_id)', /ten/.test(cols)&&/kich_thuoc/.test(cols)&&/sp_id/.test(cols)&&/ma_mau/.test(cols))
  ok('ceo/kho gọi OK', (await as(U.ceo,`select * from kho.don_cho_thiet_ke()`)).e===null && (await as(U.kho,`select * from kho.don_cho_thiet_ke()`)).e===null)
  ok('sale gọi → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await as(U.sale,`select * from kho.don_cho_thiet_ke()`)).e||''))
  ok('tho... xuong gọi → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await as(U.xuong,`select * from kho.don_cho_thiet_ke()`)).e||''))
  ok('vai NULL → CHẶN', /chỉ ceo\/kho\/thiet_ke/.test((await as(null,`select * from kho.don_cho_thiet_ke()`)).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message);F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
