// TEST CẮN — 048 giá vốn tay + ty_le 3 nhóm + thông báo du_an 3 cách. Áp 048 trong tx rồi ROLLBACK.
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql48 = strip(readFileSync(new URL('../../db/048_gia_von_tay.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', kho:'66272566-1897-4c57-aa3f-98a81636302a',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[],keep=false){ await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{r=(await c.query(q,a)).rows}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e){ if(keep) await c.query('release savepoint s'); else await c.query('rollback to savepoint s'); }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return{r,e} }
try{
  await c.query('begin')
  await c.query(`delete from kho.don_hang where ma_don like 'GV-%'`)
  await c.query(sql48)
  await c.query(`select set_config('chan.off_von','1',true)`)   // seed đơn du_an có gia_chot mà chưa giá vốn (né gate khi SEED)
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,gia_cong_thuc,gia_chot,ma_ky_ap_dung) values
    ('GV-du_an','du_an','le_rieng','moi_len_don',10000000,8000000,'2099-01'),
    ('GV-plugin','le','le_sang','cho_cat',null,null,'2099-01'),
    ('GV-tay','le','le_sang','cho_cat',null,null,'2099-01')`)
  await c.query(`select set_config('chan.off_von','',true)`)    // bật lại gate cho phần test

  console.log('── 2. ghi_gia_von_tay: guard + lý do ──')
  ok('ceo nhập tay (có lý do) → OK', (await as(U.ceo,`select kho.ghi_gia_von_tay('GV-tay',1000000,500000,200000,'giường gỗ tự nhiên')`,[],true)).e===null)
  const row=(await c.query(`select nguon,ly_do,gia_chuyen_giao,nguoi_day from kho.don_hang_gia_von where ma_don='GV-tay'`)).rows[0]||{}
  ok('  dòng nguon=nhap_tay, ly_do đúng, tổng=1.700.000, có nguoi_day', row.nguon==='nhap_tay'&&/giường gỗ/.test(row.ly_do||'')&&Number(row.gia_chuyen_giao)===1700000&&row.nguoi_day, JSON.stringify(row))
  ok('kho nhập tay → OK', (await as(U.kho,`select kho.ghi_gia_von_tay('GV-tay',1,1,1,'mua ngoài')`)).e===null)
  ok('nhập tay KHÔNG lý do → CHẶN', /phải có lý do/i.test((await as(U.ceo,`select kho.ghi_gia_von_tay('GV-tay',1,1,1,'')`)).e||''))
  ok('sale gọi → CHẶN (chỉ ceo/kho)', /chỉ ceo\/kho/.test((await as(U.sale,`select kho.ghi_gia_von_tay('GV-tay',1,1,1,'x')`)).e||''))
  ok('xuong gọi → CHẶN', /chỉ ceo\/kho/.test((await as(U.xuong,`select kho.ghi_gia_von_tay('GV-tay',1,1,1,'x')`)).e||''))
  ok('ke_toan gọi → CHẶN', /chỉ ceo\/kho/.test((await as(U.ke_toan,`select kho.ghi_gia_von_tay('GV-tay',1,1,1,'x')`)).e||''))
  ok('đơn không tồn tại → CHẶN', /không có đơn/.test((await as(U.ceo,`select kho.ghi_gia_von_tay('GV-none',1,1,1,'x')`)).e||''))

  console.log('\n── 4. du_an nhập giá vốn tay → CHỐT được (trước đó chặn) ──')
  ok('[CẮN] du_an CHƯA giá vốn → chốt CHẶN + thông báo 3 CÁCH', /Ba cách gỡ|NHẬP GIÁ VỐN TAY/i.test((await as(U.ceo,`select kho.kiem_giam_gia(d) from kho.don_hang d where d.ma_don='GV-du_an'`)).e||''))
  await as(U.ceo,`select kho.ghi_gia_von_tay('GV-du_an',5000000,2000000,300000,'đơn tự do')`, [], true)   // persist
  ok('du_an ĐÃ có giá vốn tay → chốt QUA (kiem_giam_gia không raise)', (await as(U.ceo,`select kho.kiem_giam_gia(d) from kho.don_hang d where d.ma_don='GV-du_an'`)).e===null)
  console.log('── kiem_chuyen_trang_thai (lên đơn) cũng 3 cách ──')
  await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ma_ky_ap_dung) values('GV-bg','du_an','le_rieng','bao_gia','2099-01')`)
  await c.query(`insert into kho.don_hang_mon(don_id,ten,gia) select id,'m',100 from kho.don_hang where ma_don='GV-bg'`)
  ok('[CẮN] du_an bao_gia→moi_len_don chưa giá vốn → CHẶN 3 cách', /Ba cách gỡ/i.test((await as(U.ceo,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='GV-bg'`)).e||''))

  console.log('\n── ty_le_truy_duoc: TÁCH nhóm không đo được ──')
  // A plugin có driver; B nhập tay không driver. Mẫu số từ phiếu đếm.
  await c.query(`insert into kho.san_luong_don(ma_don,lot) values('GV-plugin',10) on conflict(ma_don) do update set lot=10`)
  const v_to=(await c.query(`select ma_to from kho.to_san_xuat limit 1`)).rows[0]?.ma_to || 'TO-1'
  await c.query('savepoint pdn'); try{ await c.query(`insert into kho.phieu_dem_ngay(ma_to,hoat_dong,ngay,so_luong) values($1,'lot','2099-01-15',10)`,[v_to]) }catch(e){ await c.query('rollback to savepoint pdn'); console.log('  (phieu_dem skip:',e.message.slice(0,50),')') }
  const r=(await as(U.ceo,`select ty_le,so_don_khong_do,canh_bao from kho.ty_le_truy_duoc('2099-01','lot')`)).r?.[0]||{}
  console.log('   kết quả:', JSON.stringify(r))
  ok('so_don_khong_do = 1 (GV-tay nhập tay)', Number(r.so_don_khong_do)>=1, String(r.so_don_khong_do))
  ok('ty_le KHÔNG bị đơn nhập tay kéo xuống (=1.0, GV-plugin truy đủ)', Number(r.ty_le)===1, String(r.ty_le))
  ok('canh_bao > 20% đơn nhập tay', /chưa đáng tin/.test(r.canh_bao||'') && /%/.test(r.canh_bao||''), r.canh_bao||'(rỗng)')
  ok('ke_toan đọc được ty_le_truy_duoc', (await as(U.ke_toan,`select * from kho.ty_le_truy_duoc('2099-01','lot')`)).e===null)
  ok('sale gọi ty_le_truy_duoc → CHẶN', /chỉ ceo\/ke_toan/.test((await as(U.sale,`select * from kho.ty_le_truy_duoc('2099-01','lot')`)).e||''))

  console.log('\n── gia_von_don_ds (màn) ──')
  const ds=(await as(U.ceo,`select ma_don,co_gia_von,nguon from kho.gia_von_don_ds() where ma_don like 'GV-%'`)).r||[]
  ok('màn liệt kê đơn + trạng thái giá vốn (nhập tay hiện nguon)', ds.some(x=>x.ma_don==='GV-tay'&&x.co_gia_von&&x.nguon==='nhap_tay'), JSON.stringify(ds.slice(0,4)))
  ok('sale gọi gia_von_don_ds → CHẶN', /chỉ ceo\/kho/.test((await as(U.sale,`select * from kho.gia_von_don_ds()`)).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
}catch(e){console.error('LỖI TEST:',e.message);F++}
finally{await c.query('rollback').catch(()=>{});await c.end();process.exit(F?1:0)}
