// TEST CẮN — 059 quản lý thương hiệu (CEO tự phục vụ). Tx rollback.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/059_quan_ly_thuong_hieu.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
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
  const KT_UID = (await q1(`select auth_uid from kho.nguoi_dung where vai_tro='ke_toan' and auth_uid is not null limit 1`))?.auth_uid

  // ═══ SỬA DỮ LIỆU BRAND ═══
  const kha = await q1(`select loai, ma_3chu from kho.thuong_hieu where ma='khanhconcept'`)
  ok('khanhconcept → thương hiệu + mã KHA', kha.loai==='thuong_hieu' && kha.ma_3chu==='KHA', JSON.stringify(kha))
  const tm = await c.query(`select ma, ma_3chu, loai from kho.thuong_hieu where ma in ('thago','mulig') order by ma`)
  ok('Thago·Mulig thêm mới (THA·MUL, thương hiệu)', tm.rows.length===2 && tm.rows.every(r=>r.loai==='thuong_hieu') && tm.rows.find(r=>r.ma==='thago').ma_3chu==='THA' && tm.rows.find(r=>r.ma==='mulig').ma_3chu==='MUL', JSON.stringify(tm.rows))
  const sr = await q1(`select loai from kho.thuong_hieu where ma='showroom'`)
  ok('showroom vẫn kênh bán', sr.loai==='kenh_ban')

  // ═══ THÊM brand ═══
  ok('ceo thêm brand mới (NB1) → ĐƯỢC', (await asK(U.ceo,`select kho.them_thuong_hieu('nb1','Brand Một','NB1','thuong_hieu',null)`)).e===null)
  const trung = await as(U.ceo,`select kho.them_thuong_hieu('nbx','Brand X','TGH','thuong_hieu',null)`)
  ok('thêm ma_3chu TRÙNG (TGH) → CHẶN + gợi ý mã trống', /đã dùng — thử "[A-Z]{3}"/.test(trung.e||''), trung.e||'(lọt!)')
  ok('ke_toan gọi them_thuong_hieu → CHẶN', KT_UID ? /chỉ ceo/.test((await as(KT_UID,`select kho.them_thuong_hieu('z','Z','ZZZ','thuong_hieu',null)`)).e||'') : true, KT_UID?'':'(không có tài khoản ke_toan — bỏ qua)')
  ok('sale gọi them_thuong_hieu → CHẶN', /chỉ ceo/.test((await as(U.sale,`select kho.them_thuong_hieu('z','Z','ZZZ','thuong_hieu',null)`)).e||''))

  // ═══ Brand mới SINH MÃ NIÊM YẾT được ═══
  const loi = (await asK(U.ceo,`select kho.tao_loi('Bàn trà test','Bàn','1200x600','xuong',null,null) d`)).r[0].d
  await c.query(`insert into kho.san_pham_mau(ma,ten,ma_loi) values('BT-T59','Bàn trà sồi',$1),('BT-T59B','Bàn trà óc chó',$1)`,[loi.ma_loi])
  await asK(U.ceo,`select kho.them_thuong_hieu('nb1x','Brand Một',null,null,null)`)  // (đã có nb1; đây khác ma)
  const ny = (await asK(U.ceo,`select kho.tao_niem_yet('BT-T59','nb1','Bàn trà nb1','ban-tra-nb1','x',3000000) d`)).r?.[0]?.d
  ok('brand mới NB1 sinh mã niêm yết NB1-...', ny && ny.ma_ny.startsWith('NB1-'), JSON.stringify(ny))

  // ═══ KHOÁ ma_3chu sau khi có niêm yết ═══
  ok('doi_ma_3chu brand ĐÃ CÓ niêm yết (nb1) → CHẶN', /ĐÃ CÓ niêm yết/.test((await as(U.ceo,`select kho.doi_ma_3chu('nb1','NBZ')`)).e||''))
  await asK(U.ceo,`select kho.them_thuong_hieu('nb3','Brand Ba','NB3','thuong_hieu',null)`)
  ok('doi_ma_3chu brand CHƯA có niêm yết (nb3) → ĐƯỢC', (await as(U.ceo,`select kho.doi_ma_3chu('nb3','NB9')`)).e===null)
  // bản chưa vá: bỏ khoá → đổi nb1 LỌT (in cả hai)
  await c.query('savepoint nokhoa')
  await c.query(`create or replace function kho.doi_ma_3chu(p_ma text,p_ma_3chu_moi text) returns jsonb language plpgsql security definer set search_path=kho as $f$
    begin update kho.thuong_hieu set ma_3chu=upper(p_ma_3chu_moi) where ma=p_ma; return jsonb_build_object('ok',true); end $f$`)
  ok('[bản CHƯA VÁ] đổi ma_3chu brand có niêm yết → LỌT (ĐỎ, chính khoá đã thêm)', (await as(U.ceo,`select kho.doi_ma_3chu('nb1','NBZ')`)).e===null)
  await c.query('rollback to savepoint nokhoa')

  // ═══ TẮT brand — niêm yết cũ tra được, không tạo mới ═══
  await asK(U.ceo,`select kho.tat_thuong_hieu('nb1')`)
  ok('tắt nb1 → niêm yết cũ VẪN tra được', (await asK(U.ceo,`select kho.tra_cuu_san_pham('ban-tra-nb1') d`)).r[0].d.tim_thay===true)
  ok('tắt nb1 → KHÔNG tạo niêm yết mới được', /ĐÃ TẮT/.test((await as(U.ceo,`select kho.tao_niem_yet('BT-T59B','nb1','Bàn trà 2','ban-tra-nb1-moi','x',3000000)`)).e||''))

  // ═══ SỬA brand (không đụng ma_3chu) ═══
  ok('sua_thuong_hieu đổi tên/mô tả → ĐƯỢC', (await asK(U.ceo,`select kho.sua_thuong_hieu('nb3','Brand Ba Sửa','mô tả mới','thuong_hieu')`)).e===null &&
     (await q1(`select ten from kho.thuong_hieu where ma='nb3'`)).ten==='Brand Ba Sửa')

  // ═══ KHÔNG có hàm xoá brand ═══
  ok('KHÔNG tồn tại hàm xoá brand (chỉ tắt)', (await q1(`select count(*)::int n from pg_proc where proname in ('xoa_thuong_hieu','del_thuong_hieu') and pronamespace='kho'::regnamespace`)).n===0)

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message,e.stack?.split('\n').slice(0,4).join('\n'));F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
