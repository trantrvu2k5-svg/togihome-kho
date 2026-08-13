// TEST CẮN — 056 phân biệt việc hai vai + bàn giao. Tx rollback.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/056_viec_hai_vai.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', tk_ban_hang:'0f0535bd-01af-4f3d-b1c7-ce248d1a4450' }
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
  await c.query('begin'); await c.query(sql); await c.query("set local role postgres").catch(()=>{})
  const A = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke])).id
  const TKB = (await q1(`select id from kho.nguoi_dung where auth_uid=$1`,[U.tk_ban_hang])).id
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung,cap_thiet_ke) values
    ('W-BG','le','le_rieng','bao_gia','K056','co_mon_dung_moi'),
    ('W-SX','le','le_rieng','dang_thiet_ke','K056','thiet_ke_rieng')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,so_luong,gia,dung_moi) select id,'Tủ bếp',1,5000000,true from kho.don_hang where ma_don='W-BG'`)

  // ═══ B. LỌC THEO VAI (RPC) ═══
  const choTK = (await asK(U.thiet_ke,`select ma_don,viec from kho.tk_don_cho_nhan()`)).r
  ok('thiet_ke: KHÔNG thấy đơn bao_gia', !choTK.some(x=>x.ma_don==='W-BG'), JSON.stringify(choTK.map(x=>x.ma_don)))
  ok('thiet_ke: thấy đơn đã-chốt (W-SX, viec=thiet_ke)', choTK.some(x=>x.ma_don==='W-SX' && x.viec==='thiet_ke'))
  const choBH = (await asK(U.tk_ban_hang,`select ma_don,viec from kho.tk_don_cho_nhan()`)).r
  ok('tk_ban_hang: CHỈ thấy đơn bao_gia (W-BG, viec=tk_ban_hang)', choBH.some(x=>x.ma_don==='W-BG' && x.viec==='tk_ban_hang') && !choBH.some(x=>x.ma_don==='W-SX'), JSON.stringify(choBH.map(x=>x.ma_don)))
  const choCEO = (await asK(U.ceo,`select ma_don from kho.tk_don_cho_nhan()`)).r
  ok('ceo: thấy CẢ HAI (W-BG + W-SX)', choCEO.some(x=>x.ma_don==='W-BG') && choCEO.some(x=>x.ma_don==='W-SX'))

  // ═══ B. NHẬN SAI VIỆC → CHẶN ═══
  ok('thiet_ke nhận đơn bao_gia → CHẶN', /việc của thiết kế bán hàng/.test((await as(U.thiet_ke,`select kho.nhan_viec_thiet_ke('W-BG')`)).e||''))
  ok('tk_ban_hang nhận đơn đã-chốt → CHẶN', /việc của thiết kế sản xuất/.test((await as(U.tk_ban_hang,`select kho.nhan_viec_thiet_ke('W-SX')`)).e||''))
  ok('tk_ban_hang nhận đơn bao_gia → ĐƯỢC', (await as(U.tk_ban_hang,`select kho.nhan_viec_thiet_ke('W-BG')`)).e===null)
  ok('thiet_ke nhận đơn đã-chốt → ĐƯỢC', (await as(U.thiet_ke,`select kho.nhan_viec_thiet_ke('W-SX')`)).e===null)

  // ═══ C. BÀN GIAO: bao_gia (TKB cầm, có bản khách duyệt) → moi_len_don ═══
  await asK(U.tk_ban_hang,`select kho.nhan_viec_thiet_ke('W-BG')`)   // TKB cầm W-BG (KEEP)
  await c.query(`insert into kho.ban_thiet_ke(ma_don,phien_ban,ma_ns_gui,trang_thai,luc_phan_hoi) values('W-BG',1,$1,'khach_duyet', now())`,[TKB])
  // chuyển thành đơn hàng: bao_gia -> moi_len_don (trigger bàn giao)
  const trans = await asK(U.ceo, `update kho.don_hang set trang_thai='moi_len_don' where ma_don='W-BG'`)
  const after = await q1(`select ma_ns_thiet_ke, ma_ns_tk_ban_hang, buoc_thiet_ke, trang_thai from kho.don_hang where ma_don='W-BG'`)
  ok('bàn giao: XOÁ người cầm + GIỮ vết ma_ns_tk_ban_hang',
     trans.e===null && after.ma_ns_thiet_ke===null && after.ma_ns_tk_ban_hang===TKB && after.buoc_thiet_ke===null,
     trans.e||JSON.stringify(after))
  // giờ W-BG (moi_len_don) HIỆN với thiet_ke, KHÔNG với tk_ban_hang
  ok('sau bàn giao: W-BG hiện với thiet_ke (chờ nhận)', (await asK(U.thiet_ke,`select ma_don from kho.tk_don_cho_nhan()`)).r.some(x=>x.ma_don==='W-BG'))
  ok('sau bàn giao: W-BG KHÔNG hiện với tk_ban_hang', !(await asK(U.tk_ban_hang,`select ma_don from kho.tk_don_cho_nhan()`)).r.some(x=>x.ma_don==='W-BG'))
  // thiet_ke nhận W-BG → panel hiện bản khách đã duyệt
  await asK(U.thiet_ke,`select kho.nhan_viec_thiet_ke('W-BG')`)
  const ct = (await asK(U.thiet_ke,`select kho.tk_chi_tiet_don('W-BG') d`)).r[0].d
  ok('panel sản xuất: hiện "bản khách đã duyệt" (phiên + người bán hàng)',
     ct.ban_khach_duyet && ct.ban_khach_duyet.phien_ban===1 && !!ct.ban_khach_duyet.nguoi_ban_hang, JSON.stringify(ct.ban_khach_duyet))
  ok('[TƯỜNG LỬA] panel vẫn KHÔNG lộ giá/khách', !/"gia|ten_khach|sdt/.test(JSON.stringify(ct)))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
