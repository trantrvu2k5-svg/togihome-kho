// TEST CẮN — 055 chia việc thiết kế. Tx rollback. (053/054 đã ở prod; chỉ nạp 055.)
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/055_chia_viec_thiet_ke.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450' }
const TN_UID = '00000000-0000-4000-8000-0000000c0c0c', B_UID = '00000000-0000-4000-8000-0000000d0d0d'
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
const q1 = async (s,a=[]) => (await c.query(s,a)).rows[0]
try{
  await c.query('begin'); await c.query('drop function if exists kho.tk_don_cho_nhan() cascade; drop function if exists kho.tk_bang_cong_viec() cascade').catch(()=>{}); await c.query(sql); await c.query("set local role postgres").catch(()=>{})
  const A = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke])).id
  await c.query(`insert into kho.nguoi_dung(auth_uid,ho_ten,vai_tro,dang_hoat_dong) values($1,'Trưởng nhóm TK','truong_nhom_thiet_ke',true),($2,'Thợ TK B','thiet_ke',true)`,[TN_UID,B_UID])
  const TN=(await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[TN_UID])).id
  const B=(await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[B_UID])).id
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke) values
    ('G-A','du_an','le_rieng','moi_len_don','K055','thiet_ke_rieng'),
    ('G-B','du_an','le_rieng','dang_thiet_ke','K055','co_file_san')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,ma_mau,vl,kt,dung_moi) select id,'Tủ áo panel',1,9000000,'N01','MDF17','1000x600x2000',true from kho.don_hang where ma_don='G-A'`)
  await c.query(`update kho.don_hang set ma_ns_thiet_ke=$1, buoc_thiet_ke='dang_dung' where ma_don='G-B'`,[A])   // B-đơn do A cầm

  // ═══ ① ceo KHÔNG nhận việc ═══
  ok('ceo nhận việc → CHẶN "CEO không nhận việc"', /CEO không nhận việc/.test((await as(U.ceo,`select kho.nhan_viec_thiet_ke('G-A')`)).e||''))
  ok('thiet_ke nhận việc (tu_nhan) → ĐƯỢC', (await as(U.thiet_ke,`select kho.nhan_viec_thiet_ke('G-A')`)).e===null)
  // chế độ giao_viec → tự nhận CHẶN
  const maxky=(await q1(`select ma_ky from kho.tham_so_tai_chinh order by ma_ky desc limit 1`)).ma_ky
  await c.query(`update kho.tham_so_tai_chinh set che_do_chia_viec='giao_viec' where ma_ky=$1`,[maxky])
  ok('che_do=giao_viec → thiet_ke tự nhận CHẶN', /chế độ GIAO VIỆC/.test((await as(U.thiet_ke,`select kho.nhan_viec_thiet_ke('G-A')`)).e||''))
  ok('tk_che_do() = giao_viec', (await q1(`select kho.tk_che_do() m`)).m==='giao_viec')
  await c.query(`update kho.tham_so_tai_chinh set che_do_chia_viec='tu_nhan' where ma_ky=$1`,[maxky])

  // ═══ ④ GIAO VIỆC ═══
  ok('sale gọi giao_viec → CHẶN', /chỉ ceo/.test((await as(U.sale,`select kho.giao_viec_thiet_ke('G-A',$1,'x')`,[B])).e||''))
  const giao = await asK(TN_UID,`select kho.giao_viec_thiet_ke('G-A',$1,'giao cho B') d`,[B])
  ok('trưởng nhóm giao G-A cho B → ĐƯỢC, không vượt trần', giao.e===null && giao.r[0].d.vuot_tran===false, giao.e||JSON.stringify(giao.r?.[0]?.d))
  ok('G-A giờ do B cầm + nhật ký ghi "giao"',
     (await q1(`select ma_ns_thiet_ke from kho.don_hang where ma_don='G-A'`)).ma_ns_thiet_ke===B &&
     (await q1(`select hanh_dong from kho.nhat_ky_giao_viec where ma_don='G-A' order by luc desc limit 1`)).hanh_dong==='giao')
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung) values('G-CEO','du_an','le_rieng','moi_len_don','K055')`)
  const ceoId=(await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.ceo])).id
  ok('giao cho ceo (không phải thiết kế) → CHẶN', /chỉ giao cho thiết kế/.test((await as(TN_UID,`select kho.giao_viec_thiet_ke('G-CEO',$1,'x')`,[ceoId])).e||''))
  ok('giao đơn ĐÃ có người cầm → CHẶN (dùng chuyển)', /dùng CHUYỂN VIỆC/.test((await as(TN_UID,`select kho.giao_viec_thiet_ke('G-B',$1,'x')`,[B])).e||''))
  // vượt trần: cho B cầm thêm 4 (tổng 5, gồm G-A) rồi giao đơn mới
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,ma_ns_thiet_ke,buoc_thiet_ke) select 'G-X'||g,'du_an','le_rieng','nhan_thiet_ke','K055',$1,'dang_dung' from generate_series(1,4) g`,[B])
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke) values('G-VT','du_an','le_rieng','moi_len_don','K055','co_file_san')`)
  const vt = await asK(TN_UID,`select kho.giao_viec_thiet_ke('G-VT',$1,'gấp') d`,[B])
  ok('giao cho người đã cầm 5 → CẢNH BÁO, VẪN giao, ghi vượt trần',
     vt.e===null && vt.r[0].d.vuot_tran===true && /vượt trần/.test(vt.r[0].d.canh_bao||'') &&
     (await q1(`select vuot_tran from kho.nhat_ky_giao_viec where ma_don='G-VT'`)).vuot_tran===true, vt.e||JSON.stringify(vt.r?.[0]?.d))

  // ═══ ④ CHUYỂN VIỆC ═══
  ok('chuyển KHÔNG lý do → CHẶN', /BẮT BUỘC ghi lý do/.test((await as(TN_UID,`select kho.chuyen_viec('G-A',$1,'')`,[A])).e||''))
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung) values('G-NONE','du_an','le_rieng','bao_gia','K055')`)
  ok('chuyển đơn CHƯA ai cầm → CHẶN', /chưa ai cầm/.test((await as(TN_UID,`select kho.chuyen_viec('G-NONE',$1,'x')`,[A])).e||''))
  const ch = await asK(TN_UID,`select kho.chuyen_viec('G-A',$1,'B nghỉ phép') d`,[A])
  ok('chuyển G-A từ B sang A (có lý do) → ĐƯỢC + nhật ký từ→đến', ch.e===null &&
     (await q1(`select ma_ns_tu,ma_ns_den,ly_do from kho.nhat_ky_giao_viec where ma_don='G-A' and hanh_dong='chuyen' order by luc desc limit 1`)).ma_ns_tu===B, ch.e||'')

  // BỎ CHỐT ly_do → đỏ (in cả hai)
  await c.query('savepoint nolydo')
  await c.query(`create or replace function kho.chuyen_viec(p_ma_don text,p_ma_ns_moi uuid,p_ly_do text) returns jsonb language plpgsql security definer set search_path=kho as $f$
    begin update kho.don_hang set ma_ns_thiet_ke=p_ma_ns_moi where ma_don=p_ma_don; return jsonb_build_object('ok',true); end $f$`)
  ok('[bản CHƯA VÁ] chuyển KHÔNG lý do → LỌT (ĐỎ, chính là chốt đã thêm)', (await as(TN_UID,`select kho.chuyen_viec('G-A',$1,'')`,[B])).e===null)
  await c.query('rollback to savepoint nolydo')

  // ═══ ② CHI TIẾT ĐƠN (panel) — KHÔNG giá/khách ═══
  const ct = (await asK(U.thiet_ke,`select kho.tk_chi_tiet_don('G-A') d`)).r[0].d
  ok('tk_chi_tiet_don: có món (tên/kt/vl/màu) + lịch sử', Array.isArray(ct.mon) && ct.mon.length>0 && ct.mon[0].ten==='Tủ áo panel' && ct.mon[0].kt==='1000x600x2000' && ct.mon[0].vl==='MDF17', JSON.stringify(ct.mon&&ct.mon[0]))
  ok('[TƯỜNG LỬA] panel KHÔNG lộ giá/khách/sđt', !/9000000|"gia|ten_khach|sdt/.test(JSON.stringify(ct)))
  ok('lịch sử có mốc "Nhận việc"', JSON.stringify(ct.lich_su).includes('Nhận việc'))

  // ═══ XEM CẢ ĐỘI: trưởng nhóm thấy số toàn đội ═══
  // cho A một đơn xong_file non-demo trong K055 để tt_xuong có dòng
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke) values('G-XONG','du_an','le_rieng','cho_cat','K055','thiet_ke_rieng',$1,'xong_file')`,[A])
  const tnX = (await asK(TN_UID,`select ma_ns from kho.tt_thiet_ke_xuong('K055')`)).r
  ok('trưởng nhóm thấy bảng thành tích SX cả đội (có dòng A)', tnX.some(x=>x.ma_ns===A), JSON.stringify(tnX.map(x=>x.ma_ns)))
  ok('trưởng nhóm gọi tk_nguoi_nhan → danh sách thiết kế + tải', (await asK(TN_UID,`select id,dang_cam from kho.tk_nguoi_nhan()`)).r.some(x=>x.id===A))
  ok('thiet_ke (không phải trưởng) gọi tk_nguoi_nhan → CHẶN', /chỉ ceo/.test((await as(U.thiet_ke,`select kho.tk_nguoi_nhan()`)).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
