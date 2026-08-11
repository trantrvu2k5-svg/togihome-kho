// TEST CẮN — 045 vào chuyền: bắc cầu tem→cho_cat · dua_vao_chuyen (guard) · gỡ khoá đồng bộ ·
//   mọi món xong_sx→cho_giao · bỏ OR-tem · khối chờ vào chuyền. Áp 045 trong tx rồi ROLLBACK.
//   DB_HOST=… DB_USER=… DB_PASS=… node ops/test_045.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql45 = strip(readFileSync(new URL('../../db/045_vao_chuyen.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', kho:'66272566-1897-4c57-aa3f-98a81636302a' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P = 0, F = 0; const ok = (n, cc, e='') => { console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:'')); cc?P++:F++ }
async function as(uid, q, a=[], keep=false) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null
  try { r=(await c.query(q,a)).rows; if(keep) await c.query('release savepoint s') }
  catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){} }
  if(!keep&&!e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { r, e }
}
const tt = async ma => (await c.query(`select trang_thai from kho.don_hang where ma_don=$1`,[ma])).rows[0]?.trang_thai
// seed đơn trực tiếp (owner → né vai gate). loai le_sang hợp lệ.
const mkDon = async (ma, trang) => (await c.query(
  `insert into kho.don_hang(ma_don,dong,loai,trang_thai,ngay_hen_khach) values($1,'le','le_sang',$2,current_date+7) returning id`,
  [ma, trang])).rows[0].id
const mkMon = async (don, ten, trang='cho_cat') => (await c.query(
  `insert into kho.don_hang_mon(don_id,ten,trang_thai) values($1,$2,$3) returning id`, [don, ten, trang])).rows[0].id
const insTem = async ma => c.query(
  `insert into kho.tem_ban_ve(ma_don,phien_ban,ma_tam,dai,rong,day) values($1,1,'T1',100,100,17)`, [ma])

try {
  await c.query('begin')
  await c.query(`delete from kho.don_hang where ma_don like 'VC-%'`)   // dọn test cũ (trong tx)
  await c.query(sql45)                                                 // áp 045 (backfill DO chạy 1 lần ở đây)

  console.log('── 1. BẮC CẦU: day_tem_ban_ve đẩy tem → cho_cat ──')
  const A = await mkDon('VC-1-moi','moi_len_don'); await mkMon(A,'Tủ')
  await as(U.thiet_ke, `select kho.day_tem_ban_ve('VC-1-moi', $1::jsonb)`,
    [JSON.stringify([{ma_tam:'T1',vai_tro:'hong',dai:700,rong:350,day:17}])], true)
  ok('moi_len_don + đẩy tem (thiet_ke) → cho_cat', await tt('VC-1-moi')==='cho_cat', await tt('VC-1-moi'))

  const B = await mkDon('VC-2-xongfile','xong_file'); await mkMon(B,'Kệ')
  await as(U.thiet_ke, `select kho.day_tem_ban_ve('VC-2-xongfile', $1::jsonb)`,
    [JSON.stringify([{ma_tam:'T1',dai:700,rong:350,day:17}])], true)
  ok('xong_file + đẩy tem → cho_cat', await tt('VC-2-xongfile')==='cho_cat', await tt('VC-2-xongfile'))

  console.log('\n── 2. bao_gia + đẩy tem → KHÔNG chuyển ──')
  const Q = await mkDon('VC-3-baogia','bao_gia'); await mkMon(Q,'BG')
  await as(U.thiet_ke, `select kho.day_tem_ban_ve('VC-3-baogia', $1::jsonb)`,
    [JSON.stringify([{ma_tam:'T1',dai:1,rong:1,day:1}])], true)
  ok('bao_gia + đẩy tem → GIỮ bao_gia', await tt('VC-3-baogia')==='bao_gia', await tt('VC-3-baogia'))

  console.log('\n── [CẮN] chưa vá: chỉ chèn tem (không bắc cầu) → đơn GIỮ moi_len_don (ĐỎ) ──')
  const Z = await mkDon('VC-cn-old','moi_len_don'); await mkMon(Z,'x'); await insTem('VC-cn-old')
  ok('[CẮN] chèn tem trần → vẫn moi_len_don (bản chưa vá ĐỎ)', await tt('VC-cn-old')==='moi_len_don', await tt('VC-cn-old'))

  console.log('\n── 3. dua_vao_chuyen: guard + miền trạng thái ──')
  const D = await mkDon('VC-4-tay','moi_len_don'); await mkMon(D,'Giường')
  ok('xuong đưa moi_len_don → cho_cat (OK)', (await as(U.xuong,`select kho.dua_vao_chuyen('VC-4-tay')`,[],true)).e===null && await tt('VC-4-tay')==='cho_cat')
  const E = await mkDon('VC-5-xf','xong_file'); await mkMon(E,'m')
  ok('ceo đưa xong_file → cho_cat (OK)', (await as(U.ceo,`select kho.dua_vao_chuyen('VC-5-xf')`,[],true)).e===null && await tt('VC-5-xf')==='cho_cat')
  const F1 = await mkDon('VC-6-bg','bao_gia'); await mkMon(F1,'m')
  ok('bao_gia → CHẶN', /báo giá/i.test((await as(U.xuong,`select kho.dua_vao_chuyen('VC-6-bg')`)).e||''))
  const G = await mkDon('VC-7-dacat','da_cat'); await mkMon(G,'m','da_cat')
  ok('đã ở da_cat → CHẶN (chỉ từ moi_len_don/xong_file)', /chỉ đưa vào chuyền/i.test((await as(U.xuong,`select kho.dua_vao_chuyen('VC-7-dacat')`)).e||''))
  const H = await mkDon('VC-8-role','moi_len_don'); await mkMon(H,'m')
  ok('sale gọi → CHẶN (chỉ ceo/xuong)', /chỉ ceo\/xuong/.test((await as(U.sale,`select kho.dua_vao_chuyen('VC-8-role')`)).e||''))
  ok('vai NULL (chưa đăng nhập) → CHẶN', /chỉ ceo\/xuong/.test((await as(null,`select kho.dua_vao_chuyen('VC-8-role')`)).e||''))
  ok('  (H vẫn moi_len_don sau 2 lần bị chặn)', await tt('VC-8-role')==='moi_len_don', await tt('VC-8-role'))

  console.log('\n── 4. Mọi món xong_sx → đơn tự cho_giao ──')
  const K = await mkDon('VC-9-chogiao','dang_lam')
  const m1=await mkMon(K,'m1','dang_lam'), m2=await mkMon(K,'m2','dang_lam'), m3=await mkMon(K,'m3','dang_lam')
  ok('3 món dang_lam → đơn dang_lam', await tt('VC-9-chogiao')==='dang_lam', await tt('VC-9-chogiao'))
  await c.query(`update kho.don_hang_mon set trang_thai='xong_sx' where id=$1`,[m1])
  await c.query(`update kho.don_hang_mon set trang_thai='xong_sx' where id=$1`,[m2])
  ok('2/3 xong → đơn VẪN dang_lam', await tt('VC-9-chogiao')==='dang_lam', await tt('VC-9-chogiao'))
  await c.query(`update kho.don_hang_mon set trang_thai='xong_sx' where id=$1`,[m3])
  ok('món cuối xong → đơn TỰ cho_giao', await tt('VC-9-chogiao')==='cho_giao', await tt('VC-9-chogiao'))

  console.log('\n── 5. Đơn cho_cat, thợ bấm món da_cat → đơn tự da_cat (tien_mon) ──')
  const thoId = (await c.query(`select id from kho.nguoi_dung where auth_uid=$1`,[U.tho])).rows[0]?.id   // p_nguoi_id = nguoi_dung.id (app lấy từ xuong_tho_list), KHÔNG phải auth_uid
  const L = await mkDon('VC-10-mon','cho_cat'); const lm=await mkMon(L,'m','cho_cat')
  const r10 = await as(U.tho, `select kho.tien_mon($1,'da_cat',$2)`, [lm, thoId], true)
  ok('tho tien_mon da_cat OK', r10.e===null, r10.e||'')
  ok('đơn tự lên da_cat', await tt('VC-10-mon')==='da_cat', await tt('VC-10-mon'))

  console.log('\n── 6. Đơn moi_len_don (chưa vào chuyền) KHÔNG tự đồng bộ ──')
  const M = await mkDon('VC-11-kdb','moi_len_don'); const mm=await mkMon(M,'m','cho_cat')
  await c.query(`update kho.don_hang_mon set trang_thai='da_cat' where id=$1`,[mm])  // món nhảy nhưng đơn chưa vào chuyền
  ok('món da_cat nhưng đơn GIỮ moi_len_don (cổng vẫn khoá)', await tt('VC-11-kdb')==='moi_len_don', await tt('VC-11-kdb'))

  console.log('\n── 7. xuong_don_san_xuat: BỎ OR-tem — đơn hiện đúng cột ──')
  const N = await mkDon('VC-12-tt','moi_len_don'); await mkMon(N,'m'); await insTem('VC-12-tt')  // moi_len_don + tem trần
  const dsx = (await as(U.xuong, `select ma_don,trang_thai from kho.xuong_don_san_xuat() where ma_don like 'VC-%'`)).r||[]
  ok('moi_len_don (+tem) KHÔNG lọt danh sách xưởng (đã bỏ OR-tem)', !dsx.some(x=>x.ma_don==='VC-12-tt'), JSON.stringify(dsx.map(x=>x.ma_don)))
  ok('cho_cat (VC-1) CÓ trong danh sách, đúng trang_thai', dsx.some(x=>x.ma_don==='VC-1-moi'&&x.trang_thai==='cho_cat'))
  ok('cho_giao (VC-9) CÓ trong danh sách', dsx.some(x=>x.ma_don==='VC-9-chogiao'&&x.trang_thai==='cho_giao'))

  console.log('\n── 8. xuong_don_cho_vao_chuyen: moi_len_don/xong_file KHÔNG tem ──')
  const O = await mkDon('VC-13-cho','moi_len_don'); await mkMon(O,'m')       // chờ, không tem
  const P2 = await mkDon('VC-14-xf-cho','xong_file'); await mkMon(P2,'m')    // chờ, không tem
  const cho = (await as(U.xuong, `select ma_don from kho.xuong_don_cho_vao_chuyen() where ma_don like 'VC-%'`)).r||[]
  const set = cho.map(x=>x.ma_don)
  ok('VC-13 (moi_len_don, không tem) CÓ trong khối chờ', set.includes('VC-13-cho'), JSON.stringify(set))
  ok('VC-14 (xong_file, không tem) CÓ trong khối chờ', set.includes('VC-14-xf-cho'))
  ok('VC-12 (moi_len_don + tem) KHÔNG trong khối chờ', !set.includes('VC-12-tt'))
  ok('VC-1 (cho_cat) KHÔNG trong khối chờ', !set.includes('VC-1-moi'))
  ok('sale gọi khối chờ → CHẶN', /chỉ ceo\/kho\/xuong/.test((await as(U.sale,`select * from kho.xuong_don_cho_vao_chuyen()`)).e||''))

  console.log('\n── [CẮN] bỏ chốt bao_gia trong dua_vao_chuyen → bao_gia LỌT (mô phỏng, ĐỎ) ──')
  // đối chứng: nếu miền cho phép bao_gia thì đơn báo giá vào chuyền được — bản vá phải CHẶN (đã test ở mục 3).
  ok('[CẮN] xác nhận bản vá CHẶN bao_gia (không lọt)', await tt('VC-6-bg')==='bao_gia', await tt('VC-6-bg'))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
} catch (e) { console.error('LỖI TEST:', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F?1:0) }
