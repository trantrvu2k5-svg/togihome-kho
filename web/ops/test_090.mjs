// TEST CẮN — 090 · vá huỷ đơn. Tx rollback.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const CEO='205a887e-ae8b-42de-86ff-4eb8afa140a6'
const c=new pg.Client(await docConfig()); await c.connect()
let P=0,F=0; const ok=(n,v,e='')=>{console.log((v?'✅':'❌')+' '+n+(!v&&e?' — '+e:''));v?P++:F++}
const q=async(s,a=[])=>(await c.query(s,a)).rows
async function asK(uid,s,a=[]){await c.query('savepoint k');await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})]);
  let r=null,e=null; try{r=(await c.query(s,a)).rows;await c.query('release savepoint k')}catch(x){e=x.message;try{await c.query('rollback to savepoint k')}catch(_){}}
  await c.query('reset role');await c.query("select set_config('request.jwt.claims','',true)");return{r,e}}
try{
  await c.query('begin')
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ten_khach) values('T90-A','bao_gia','le','KH A'),('T90-B','bao_gia','le','KH B'),('T90-C','bao_gia','le','KH C')`)
  // 1. huỷ CÓ lý do → CHẠY
  const r1=await asK(CEO,`update kho.don_hang set trang_thai='huy', ly_do_huy='khách đổi ý' where ma_don='T90-A'`)
  const tt1=(await q(`select trang_thai t from kho.don_hang where ma_don='T90-A'`))[0].t
  const nk1=(await q(`select ly_do from kho.don_hang_nhat_ky nk join kho.don_hang d on d.id=nk.don_id where d.ma_don='T90-A' and nk.den='huy'`))[0]
  ok('#1 huỷ CÓ lý do → CHẠY + nhật ký chép đúng lý do', r1.e===null && tt1==='huy' && nk1 && nk1.ly_do==='khách đổi ý', r1.e||JSON.stringify(nk1))
  // 2. huỷ KHÔNG lý do → CHẶN (tầng don_hang check)
  const r2=await asK(CEO,`update kho.don_hang set trang_thai='huy' where ma_don='T90-B'`)
  ok('#2 huỷ KHÔNG lý do → CHẶN', r2.e!==null, r2.e||'(lọt!)')
  // 3. tam_ngung CÓ lý do → CHẠY (cùng bệnh, cùng vá)
  const r3=await asK(CEO,`update kho.don_hang set trang_thai='tam_ngung', ly_do_huy='chờ khách xác nhận' where ma_don='T90-C'`)
  const nk3=(await q(`select ly_do from kho.don_hang_nhat_ky nk join kho.don_hang d on d.id=nk.don_id where d.ma_don='T90-C' and nk.den='tam_ngung'`))[0]
  ok('#3 tạm ngưng CÓ lý do → CHẠY + nhật ký có lý do', r3.e===null && nk3 && nk3.ly_do==='chờ khách xác nhận', r3.e||JSON.stringify(nk3))
  await c.query('rollback')
  console.log(`\n${F===0?'🟢':'🔴'} test_090: ${P} pass / ${F} fail`)
}catch(e){console.error('💥',e.message);F++;try{await c.query('rollback')}catch(_){}}finally{await c.end()}
process.exit(F===0?0:1)
