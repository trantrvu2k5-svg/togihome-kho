// TEST CẮN — 041 trang_thai_tham_so: toggle guard ceo/ke_toan + persist + ghi người/ngày khi chốt.
//   Áp 041 trong tx rồi ROLLBACK. Chạy: DB_HOST=… DB_PASS=… node ops/test_041.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/041_trang_thai_tham_so.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,args=[],keep=false){
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null
  try{ r=(await c.query(q,args)).rows; if(keep) await c.query('release savepoint s') }
  catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){} }
  if(!keep&&!e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return {r,e}
}
const val=r=>(r.r&&r.r[0])?Object.values(r.r[0])[0]:null
try{
  await c.query('begin'); await c.query(sql)
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=$1`,[U.ke_toan])
  const KY='2099-12'

  ok('sale toggle → CHẶN', /chỉ ceo\/ke_toan/.test((await as(U.sale,`select kho.dat_trang_thai_tham_so($1,'dt_muc_tieu','da_chot')`,[KY])).e||''))
  ok('trạng thái sai → CHẶN', /tam \| da_chot/.test((await as(U.ke_toan,`select kho.dat_trang_thai_tham_so($1,'dt_muc_tieu','xyz')`,[KY])).e||''))
  const g=await as(U.ke_toan,`select kho.dat_trang_thai_tham_so($1,'dt_muc_tieu','da_chot') d`,[KY],true)
  ok('ke_toan chốt dt_muc_tieu → OK', (val(g)||{}).ok===true, JSON.stringify(g.r||g.e))
  const row=(await c.query(`select trang_thai, nguoi_chot, ngay_chot from kho.trang_thai_tham_so where ma_ky=$1 and ten_tham_so='dt_muc_tieu'`,[KY])).rows[0]||{}
  ok('persist: da_chot + có nguoi_chot + ngay_chot', row.trang_thai==='da_chot' && row.nguoi_chot && row.ngay_chot, JSON.stringify(row))
  // chuyển lại tam -> xoá dấu chốt
  await as(U.ke_toan,`select kho.dat_trang_thai_tham_so($1,'dt_muc_tieu','tam')`,[KY],true)
  const row2=(await c.query(`select trang_thai, nguoi_chot, ngay_chot from kho.trang_thai_tham_so where ma_ky=$1 and ten_tham_so='dt_muc_tieu'`,[KY])).rows[0]||{}
  ok('chuyển lại TẠM → xoá nguoi_chot/ngay_chot', row2.trang_thai==='tam' && !row2.nguoi_chot && !row2.ngay_chot, JSON.stringify(row2))
  ok('ke_toan ĐỌC trang_thai_tham_so → được', ((await as(U.ke_toan,`select 1 from kho.trang_thai_tham_so where ma_ky=$1`,[KY])).r||[]).length===1)
  ok('sale ĐỌC → 0 dòng (RLS)', ((await as(U.sale,`select 1 from kho.trang_thai_tham_so where ma_ky=$1`,[KY])).r||[]).length===0)

  console.log(`\n== KẾT 041: ${P} pass / ${F} fail ==`)
  await c.query('rollback')
}catch(e){console.error('LỖI:',e.message);F++;try{await c.query('rollback')}catch(_){}}
finally{ await c.end(); process.exit(F?1:0) }
