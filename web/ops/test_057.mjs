// TEST CẮN — 057 hai vai / file sản xuất / file nguồn / người kiêm. Tx rollback.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/057_hai_vai_file_xuong.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const K_UID = '00000000-0000-4000-8000-0000000e0e0e'   // người KIÊM hai vai
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
const F1 = `[{"loai_file":"dxf","duong_dan":"F/a.dxf","ten_goc":"a.dxf","co_byte":100}]`
try{
  await c.query('begin'); await c.query(sql); await c.query("set local role postgres").catch(()=>{})
  const A = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke])).id
  const TKB = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.tk_ban_hang])).id
  await c.query(`insert into kho.nguoi_dung(auth_uid,ho_ten,vai_tro,dang_hoat_dong) values($1,'Người Kiêm','thiet_ke',true)`,[K_UID])
  const K=(await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[K_UID])).id
  await c.query(`insert into kho.vai_phu(ma_ns,vai_them) values($1,'tk_ban_hang')`,[K])   // K kiêm thêm bán hàng

  // đơn đã-chốt do A cầm + có bản khách duyệt (đủ điều kiện gửi file)
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke,la_demo)
    values('F-SX','le','le_rieng','dang_thiet_ke','K057','thiet_ke_rieng',$1,'dang_dung',false)`,[A])
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ',1,0,true from kho.don_hang where ma_don='F-SX'`)
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_phan_hoi) values('F-SX',1,$1,'khach_duyet',now())`,[TKB])

  // ═══ ② GỬI FILE SẢN XUẤT ═══
  ok('sale gọi gui_file_san_xuat → CHẶN', /chỉ ceo\/kho\/thiết kế/.test((await as(U.sale,`select kho.gui_file_san_xuat('F-SX',$1::jsonb,'x')`,[F1])).e||''))
  ok('gửi 0 file → RAISE', /ít nhất 1 file/.test((await as(U.thiet_ke,`select kho.gui_file_san_xuat('F-SX','[]'::jsonb,'x')`)).e||''))
  const gf = await asK(U.thiet_ke,`select kho.gui_file_san_xuat('F-SX',$1::jsonb,'kèm cutlist') d`,[F1])
  ok('thiet_ke (người cầm) gửi file → ĐƯỢC, buoc→xong_file', gf.e===null &&
     (await q1(`select buoc_thiet_ke from kho.don_hang where ma_don='F-SX'`)).buoc_thiet_ke==='xong_file', gf.e||'')
  ok('file vào bảng file_san_xuat', (await q1(`select count(*)::int n from kho.file_san_xuat where ma_don='F-SX'`)).n===1)
  // xưởng đọc được, sale KHÔNG
  ok('xuong đọc file_san_xuat (RPC) → ĐƯỢC', (await asK(U.xuong,`select * from kho.xuong_file_cua_don('F-SX')`)).r.length===1)
  ok('sale đọc file_san_xuat (RPC) → CHẶN', /chỉ xưởng/.test((await as(U.sale,`select kho.xuong_file_cua_don('F-SX')`)).e||''))
  ok('sale SELECT thẳng file_san_xuat → RLS chặn (0 dòng)', (await as(U.sale,`select * from kho.file_san_xuat where ma_don='F-SX'`)).r?.length===0)

  // đơn CHƯA khách duyệt → CHẶN (+ bản chưa vá lọt)
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,ma_ns_thiet_ke,buoc_thiet_ke) values('F-NO','le','le_rieng','dang_thiet_ke','K057',$1,'dang_dung')`,[A])
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ',1,0,true from kho.don_hang where ma_don='F-NO'`)
  ok('đơn chưa khách duyệt → gửi file CHẶN', /chưa có bản thiết kế nào KHÁCH DUYỆT/.test((await as(U.thiet_ke,`select kho.gui_file_san_xuat('F-NO',$1::jsonb,'x')`,[F1])).e||''))
  await c.query('savepoint chuava')
  await c.query(`create or replace function kho.gui_file_san_xuat(p_ma_don text,p_danh_sach jsonb,p_ghi_chu text) returns jsonb language plpgsql security definer set search_path=kho as $f$
    begin insert into kho.file_san_xuat(ma_don,loai_file,duong_dan,ma_ns_gui) values(p_ma_don,'dxf','x',kho.current_ns()); return jsonb_build_object('ok',true); end $f$`)
  ok('[bản CHƯA VÁ] gửi file đơn chưa duyệt → LỌT (ĐỎ, chính cổng đã thêm)', (await as(U.thiet_ke,`select kho.gui_file_san_xuat('F-NO',$1::jsonb,'x')`,[F1])).e===null)
  await c.query('rollback to savepoint chuava')

  // ═══ ③ FILE NGUỒN kèm bản 3D ═══
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke) values('N-BG','le','le_rieng','bao_gia','K057','co_mon_dung_moi',$1,'dang_dung')`,[TKB])
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ',1,0,true from kho.don_hang where ma_don='N-BG'`)
  const anh = `[{"duong_dan_nho":"n/1_nho.webp","duong_dan_to":"n/1_to.webp","byte_nho":1,"byte_to":2,"thu_tu":0}]`
  const gb = await asK(U.tk_ban_hang,`select kho.gui_ban_thiet_ke('N-BG','pa1',$1::jsonb,$2::jsonb) d`,[anh, '{"duong_dan":"n/nguon.skp","byte":50000}'])
  ok('gửi bản 3D KÈM file nguồn → co_file_nguon=true', gb.e===null && gb.r[0].d.co_file_nguon===true, gb.e||JSON.stringify(gb.r?.[0]?.d))
  // duyệt bản → tk_chi_tiet_don thấy file_nguon
  await asK(U.sale,`select kho.phan_hoi_ban((select id from kho.ban_thiet_ke where ma_don='N-BG' order by phien_ban desc limit 1),'khach_duyet','ok')`)
  const ct = (await asK(U.thiet_ke,`select kho.tk_chi_tiet_don('N-BG') d`)).r[0].d
  ok('panel bàn giao: có file_nguon để tải', ct.ban_khach_duyet && ct.ban_khach_duyet.file_nguon && ct.ban_khach_duyet.file_nguon.duong_dan==='n/nguon.skp', JSON.stringify(ct.ban_khach_duyet&&ct.ban_khach_duyet.file_nguon))
  const tl = (await asK(U.ceo,`select kho.ty_le_dung_lai_ban_3d('K057') d`)).r[0].d
  ok('ty_le_dung_lai_ban_3d trả số (đơn bàn giao có file nguồn)', tl && typeof tl.ty_le !== 'undefined', JSON.stringify(tl))

  // ═══ ④ NGƯỜI KIÊM HAI VAI ═══
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke) values
    ('K-BG','le','le_rieng','bao_gia','K057','co_mon_dung_moi'),('K-SX','le','le_rieng','dang_thiet_ke','K057','thiet_ke_rieng')`)
  const choK = (await asK(K_UID,`select ma_don from kho.tk_don_cho_nhan()`)).r.map(x=>x.ma_don)
  ok('người KIÊM: Chờ nhận thấy CẢ báo giá LẪN đã-chốt', choK.includes('K-BG') && choK.includes('K-SX'), JSON.stringify(choK))
  ok('người KIÊM nhận đơn báo giá → ĐƯỢC', (await as(K_UID,`select kho.nhan_viec_thiet_ke('K-BG')`)).e===null)
  ok('người KIÊM nhận đơn đã-chốt → ĐƯỢC', (await as(K_UID,`select kho.nhan_viec_thiet_ke('K-SX')`)).e===null)
  // giờ theo ĐƠN không theo vai
  await asK(K_UID,`select kho.nhan_viec_thiet_ke('K-BG')`)
  ok('KIÊM ghi giờ đơn BÁO GIÁ → loai_gio=ban_hang', (await asK(K_UID,`select kho.ghi_gio_thiet_ke('K-BG',1) d`)).r[0].d.loai_gio==='ban_hang')
  await asK(K_UID,`select kho.nhan_viec_thiet_ke('K-SX')`)
  ok('KIÊM ghi giờ đơn ĐÃ CHỐT → loai_gio=xuong', (await asK(K_UID,`select kho.ghi_gio_thiet_ke('K-SX',1) d`)).r[0].d.loai_gio==='xuong')
  // pure thiet_ke vẫn bị chặn báo giá
  ok('pure thiet_ke nhận báo giá → vẫn CHẶN', /việc của thiết kế bán hàng/.test((await as(U.thiet_ke,`select kho.nhan_viec_thiet_ke('K-BG')`)).e||''))

  // KHÔNG bàn giao khi người kiêm cầm: K cầm K-BG (đã nhận ở trên qua asK), duyệt bản rồi chuyển đơn hàng
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_phan_hoi) values('K-BG',1,$1,'khach_duyet',now())`,[K])
  await asK(U.ceo,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='K-BG'`)
  const kaf = await q1(`select ma_ns_thiet_ke,ma_ns_tk_ban_hang from kho.don_hang where ma_don='K-BG'`)
  ok('KIÊM cầm báo giá + khách duyệt → GIỮ người cầm (không bàn giao)', kaf.ma_ns_thiet_ke===K && kaf.ma_ns_tk_ban_hang===K, JSON.stringify(kaf))
  // pure tk_ban_hang cầm → bàn giao (đối chứng)
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke,ma_ns_thiet_ke,buoc_thiet_ke) values('P-BG','le','le_rieng','bao_gia','K057','co_mon_dung_moi',$1,'dang_dung')`,[TKB])
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ',1,5000000,true from kho.don_hang where ma_don='P-BG'`)
  await asK(U.ceo,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='P-BG'`)
  const paf = await q1(`select ma_ns_thiet_ke,ma_ns_tk_ban_hang from kho.don_hang where ma_don='P-BG'`)
  ok('pure tk_ban_hang cầm + khách duyệt → BÀN GIAO (holder null, giữ vết)', paf.ma_ns_thiet_ke===null && paf.ma_ns_tk_ban_hang===TKB, JSON.stringify(paf))

  // thành tích: K xuất hiện ở CẢ HAI bảng
  await c.query(`update kho.don_hang set buoc_thiet_ke='xong_file' where ma_don='K-SX'`)  // K có việc SX xong
  const xInK = (await asK(U.ceo,`select ma_ns from kho.tt_thiet_ke_xuong('K057')`)).r.some(x=>x.ma_ns===K)
  const bInK = (await asK(U.ceo,`select ma_ns from kho.tt_thiet_ke_ban_hang('K057')`)).r.some(x=>x.ma_ns===K)
  ok('người KIÊM hiện ở CẢ HAI bảng thành tích (không gộp)', xInK && bInK, `xuong=${xInK} banhang=${bInK}`)

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
