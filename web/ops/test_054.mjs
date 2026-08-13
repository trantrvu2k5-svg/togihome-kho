// TEST CẮN — 054 RPC đọc app thiết kế. Tx rollback. (db/053 đã ở prod; chỉ nạp 054.)
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/054_doc_app_thiet_ke.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
async function asK(uid,q,a=[]){ await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows; await c.query('release savepoint k')}catch(x){e=x.message;try{await c.query('rollback to savepoint k')}catch(_){}}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
try{
  await c.query('begin'); await c.query('drop function if exists kho.tk_don_cho_nhan() cascade; drop function if exists kho.tk_bang_cong_viec() cascade').catch(()=>{}); await c.query(sql); await c.query("set local role postgres").catch(()=>{})
  const A = (await c.query(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke])).rows[0].id
  // đơn chờ nhận (chưa cầm) + món có tên
  // dang_thiet_ke = việc SẢN XUẤT → thiet_ke nhận được (db/056: thiet_ke KHÔNG nhận bao_gia); dong=le né cổng giá-vốn du_an
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ngay_hen_khach,gia_chot,ten_khach,sdt_khach)
    values('R-A','le','le_rieng','dang_thiet_ke','K054','thiet_ke_rieng','2026-09-01',9990000,'Chị Khách Bí Mật','0900000000')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ áo master',1,5000000,true from kho.don_hang where ma_don='R-A'`)

  // guard
  ok('sale gọi tk_viec_cua_toi → CHẶN', /chỉ ceo/.test((await as(U.sale,`select * from kho.tk_viec_cua_toi()`)).e||''))
  ok('xuong gọi tk_bang_cong_viec → CHẶN', /chỉ ceo/.test((await as(U.xuong,`select * from kho.tk_bang_cong_viec()`)).e||''))

  // chờ nhận thấy R-A, tên = tên MÓN (không lộ khách)
  const cho = (await asK(U.thiet_ke,`select * from kho.tk_don_cho_nhan()`)).r
  const rA = cho.find(x=>x.ma_don==='R-A')
  ok('tk_don_cho_nhan thấy đơn chưa cầm, tên = tên món', rA && rA.ten==='Tủ áo master', JSON.stringify(rA&&rA.ten))
  // TƯỜNG LỬA: không có cột giá / khách
  const cols = rA ? Object.keys(rA).join(',') : ''
  // ngay_hen_khach = hạn giao (an toàn, sale đã báo) — KHÔNG tính là lộ khách. Bắt: giá + danh tính khách.
  ok('[TƯỜNG LỬA] cột trả về KHÔNG có giá/danh-tính-khách', rA && !/gia_|_gia\b|ten_khach|sdt|dia_chi|doanh_thu|thanh_toan/.test(cols), cols)
  const flat = JSON.stringify(cho)
  ok('[TƯỜNG LỬA] payload KHÔNG chứa tên/sđt khách', !/Bí Mật|0900000000|9990000/.test(flat))

  // nhận việc -> rời chờ nhận, vào việc của tôi
  await asK(U.thiet_ke,`select kho.nhan_viec_thiet_ke('R-A')`)
  const cho2 = (await asK(U.thiet_ke,`select * from kho.tk_don_cho_nhan()`)).r
  ok('sau nhận việc → R-A RỜI khối chờ nhận', !cho2.find(x=>x.ma_don==='R-A'))
  const viec = (await asK(U.thiet_ke,`select * from kho.tk_viec_cua_toi()`)).r
  const vA = viec.find(x=>x.ma_don==='R-A')
  ok('R-A vào "việc của tôi", gio_uoc=3 (thiet_ke_rieng)', vA && Number(vA.gio_uoc)===3, JSON.stringify(vA&&{u:vA.gio_uoc,b:vA.buoc_thiet_ke}))
  // ghi giờ -> gio_da_ghi cộng
  await asK(U.thiet_ke,`select kho.ghi_gio_thiet_ke('R-A',2.5)`)
  const viec2 = (await asK(U.thiet_ke,`select * from kho.tk_viec_cua_toi()`)).r.find(x=>x.ma_don==='R-A')
  ok('ghi giờ → gio_da_ghi = 2,5', viec2 && Number(viec2.gio_da_ghi)===2.5, JSON.stringify(viec2&&viec2.gio_da_ghi))

  // bảng công việc: R-A giờ ở cột dang_dung, có ai_cam
  const bang = (await asK(U.thiet_ke,`select * from kho.tk_bang_cong_viec()`)).r.find(x=>x.ma_don==='R-A')
  ok('tk_bang_cong_viec: R-A cột dang_dung + ai_cam có tên', bang && bang.cot==='dang_dung' && !!bang.ai_cam, JSON.stringify(bang&&{cot:bang.cot,ai:bang.ai_cam,vai:bang.vai_cam}))

  // gio_chi_phi RLS: thiet_ke thấy giờ mình; ceo thấy hết. (R-A đang bao_gia -> xô 'mau_cho'? bao_gia không thắng/thua/sửa -> mau_cho)
  const gcp = (await asK(U.thiet_ke,`select kho.tk_gio_chi_phi('K054') d`)).r[0].d
  ok('tk_gio_chi_phi trả o_so/gio_di_dau/uoc_thuc + tổng giờ = 2,5', gcp && Number(gcp.o_so.gio_thang)===2.5, JSON.stringify(gcp&&gcp.o_so))
  ok('sale gọi tk_gio_chi_phi → CHẶN', /chỉ ceo/.test((await as(U.sale,`select kho.tk_gio_chi_phi('K054')`)).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
