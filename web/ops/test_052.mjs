// TEST CẮN — 052 quản lý tài khoản (chỉ ceo). Áp trong tx rồi ROLLBACK.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/052_quan_ly_tai_khoan.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[]){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e)await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
async function asK(uid,q,a=[]){ await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message}
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
try{
  await c.query('begin'); await c.query(sql)

  // guard: sale/thiet_ke → CHẶN; ceo → OK
  ok('sale gọi ds → CHẶN', /chỉ CEO/.test((await as(U.sale,`select * from kho.qly_ds_nguoi_dung()`)).e||''))
  ok('thiet_ke gọi ds → CHẶN', /chỉ CEO/.test((await as(U.thiet_ke,`select * from kho.qly_ds_nguoi_dung()`)).e||''))
  const ds = await as(U.ceo,`select count(*)::int n from kho.qly_ds_nguoi_dung()`)
  ok('ceo gọi ds OK (có email)', ds.e===null && ds.r[0].n>=1, ds.e||'')

  // THÊM người (KEEP)
  const em = 'test_qly_'+Math.floor(Math.random()*99999)+'@togihome.local'
  const add = await asK(U.ceo,`select kho.qly_them_nguoi($1,'Người Test','sale','matkhau123') d`,[em])
  ok('ceo thêm người OK', add.e===null && add.r?.[0]?.d?.ok, add.e||'')
  const auth = add.r?.[0]?.d?.auth_uid
  // [CẮN] mật khẩu băm ĐÚNG: crypt(pw, hash) = hash → GoTrue đăng nhập được
  const pw = await c.query(`select (encrypted_password = extensions.crypt('matkhau123', encrypted_password)) khop, email_confirmed_at is not null xn from auth.users where id=$1`,[auth])
  ok('[CẮN] mật khẩu băm khớp + email đã xác nhận (login được)', pw.rows[0].khop===true && pw.rows[0].xn===true)
  const idn = await c.query(`select count(*)::int n from auth.identities where user_id=$1 and provider='email'`,[auth])
  ok('có auth.identities email (GoTrue cần để login)', idn.rows[0].n===1)
  const nd = await c.query(`select vai_tro, dang_hoat_dong from kho.nguoi_dung where auth_uid=$1`,[auth])
  ok('nguoi_dung tạo với vai sale, đang hoạt động', nd.rows[0].vai_tro==='sale' && nd.rows[0].dang_hoat_dong===true)
  const nsId = (await c.query(`select id from kho.nguoi_dung where auth_uid=$1`,[auth])).rows[0].id

  // email trùng → CHẶN; vai lạ → CHẶN; mật khẩu ngắn → CHẶN
  ok('email trùng → CHẶN', /đã tồn tại/.test((await as(U.ceo,`select kho.qly_them_nguoi($1,'x','sale','matkhau123')`,[em])).e||''))
  ok('vai lạ → CHẶN', /không hợp lệ/.test((await as(U.ceo,`select kho.qly_them_nguoi('a@b.co','x','giam_doc','matkhau123')`)).e||''))
  ok('mật khẩu ngắn → CHẶN', /tối thiểu 6/.test((await as(U.ceo,`select kho.qly_them_nguoi('a@b.co','x','sale','123')`)).e||''))

  // ĐỔI vai + BẬT/TẮT + ĐẶT lại mật khẩu (KEEP)
  await asK(U.ceo,`select kho.qly_doi_vai($1,'thiet_ke')`,[nsId])
  ok('đổi vai → thiet_ke', (await c.query(`select vai_tro from kho.nguoi_dung where id=$1`,[nsId])).rows[0].vai_tro==='thiet_ke')
  await asK(U.ceo,`select kho.qly_bat_tat($1,false)`,[nsId])
  ok('tắt hoạt động (không xoá — row còn)', (await c.query(`select dang_hoat_dong from kho.nguoi_dung where id=$1`,[nsId])).rows[0].dang_hoat_dong===false)
  await asK(U.ceo,`select kho.qly_dat_mat_khau($1,'matkhaumoi9')`,[nsId])
  const pw2 = await c.query(`select (encrypted_password = extensions.crypt('matkhaumoi9', encrypted_password)) khop from auth.users where id=$1`,[auth])
  ok('[CẮN] đặt lại mật khẩu → hash mới khớp', pw2.rows[0].khop===true)

  // sale không đổi vai được
  ok('sale đổi vai → CHẶN', /chỉ CEO/.test((await as(U.sale,`select kho.qly_doi_vai($1,'ceo')`,[nsId])).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message);F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
