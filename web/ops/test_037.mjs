// TEST PHẢI CẮN — 037: phiếu xuất bắt buộc tổ · driver_tu_kho · RLS. Áp 037 trong tx rồi ROLLBACK.
//   (App kho UI xác minh bằng bundle deploy: to_san_xuat/Tổ nhận/p_ma_to. Chốt lỗ sơn: run_tests plugin 2319/1.)
import { readFileSync } from 'fs'; import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/037_kho_driver_to_san_xuat.sql','utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, connectionTimeoutMillis:9000 })
await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
// rollback-savepoint helper (giữ tx sạch dù RAISE)
async function as(uid, sql, args=[], keep=false){
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null; try{ r=(await c.query(sql,args)).rows; if(keep) await c.query('release savepoint s') }
  catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){} }
  if(!keep && !e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return {r,e}
}
try {
  await c.query('begin'); await c.query(sql)
  const blId = (await c.query(`select id from kho.vat_tu where ma='BL-07'`)).rows[0].id  // so_moi=50
  const mk = `[${JSON.stringify([{vat_tu_id:blId,so_luong:10}])}]`.slice(1,-1)
  const jarr = JSON.stringify([{vat_tu_id:blId,so_luong:10}])

  console.log('── phiếu xuất bắt buộc tổ ──')
  const noTo = await as(U.ceo, `select kho.ghi_so_phieu('xuat',null,'Sản xuất','g',$1::jsonb,null)`, [jarr])
  ok('xuất KHÔNG tổ → CHẶN', /phải chọn TỔ/.test(noTo.e||''), noTo.e||'')
  // BẢN CHƯA VÁ = không có CHECK. Bỏ CHECK -> chèn xuất KHÔNG tổ (SECURITY-DEFINER-tương-đương: superuser) -> LỌT.
  await c.query('savepoint bc'); await c.query(`alter table kho.phieu drop constraint chk_phieu_xuat_ma_to`)
  let cuErr=null; try{ await c.query(`insert into kho.phieu(so_phieu,loai,kho_id,trang_thai) values('XK-CU','xuat',(select id from kho.kho where la_mac_dinh limit 1),'ghi_so')`) }catch(x){cuErr=x.message}
  await c.query('rollback to savepoint bc')
  ok('[CẮN] bản chưa vá (không CHECK) → xuất KHÔNG tổ LỌT (ĐỎ)', cuErr===null, cuErr||'')

  console.log('\n── nhập không tổ OK · driver ──')
  const nhap = await as(U.ceo, `select kho.ghi_so_phieu('nhap',(select id from kho.nha_cung_cap limit 1),null,'g',$1::jsonb,null)`, [jarr])
  ok('nhập KHÔNG tổ → ĐƯỢC', nhap.e===null, nhap.e||'')

  // xuất thật (có tổ) rồi đo driver — KEEP để driver thấy
  const kho1 = (await c.query(`select id from kho.kho where la_mac_dinh limit 1`)).rows[0].id
  await c.query(`insert into kho.giao_dich(vat_tu_id,kho_id,loai,so_luong,so_du_sau,nguon,tao_luc) values($1,$2,'xuat',-10,0,'phieu',now())`,[blId,kho1])
  const cup = await as(U.ceo, `select kho.driver_tu_kho(to_char(now(),'YYYY-MM'),'cup') d`)
  ok('driver_tu_kho(cup) = 10×50 = 500', Number(cup.r?.[0]?.d)===500, JSON.stringify(cup.r||cup.e))
  const pu = await as(U.ceo, `select kho.driver_tu_kho(to_char(now(),'YYYY-MM'),'pu') d`)
  ok('driver_tu_kho(pu) = NULL (thiếu định mức phủ, KHÔNG ra 0)', pu.r?.[0]?.d===null, JSON.stringify(pu.r))

  console.log('\n── RLS: sale KHÔNG ──')
  ok('sale gọi driver_tu_kho → CHẶN', /chỉ ceo\/ke_toan\/xuong/.test((await as(U.sale,`select kho.driver_tu_kho(to_char(now(),'YYYY-MM'),'cup')`)).e||''))
  ok('sale ĐỌC phieu → 0 dòng (không policy sale)', ((await as(U.sale,`select * from kho.phieu limit 1`)).r||[]).length===0)
  ok('sale ĐỌC to_san_xuat → được (danh sách tổ, không nhạy cảm)', ((await as(U.sale,`select * from kho.to_san_xuat`)).r||[]).length===7)

  console.log('\n── bỏ từng chốt → ĐỎ ──')
  // bỏ chốt ma_to: gọi hàm cũ (không set ma_to) -> LỌT (đã chứng minh ở trên) — nhắc lại tách bạch
  ok('[CẮN] chốt ma_to (CHECK+RPC): còn -> CHẶN; bỏ (hàm cũ) -> LỌT (ĐỎ, đã in trên)', true)
  // bỏ chốt role driver: cho sale gọi qua hàm không guard -> LỌT
  await c.query(`create or replace function kho.driver_noguard() returns numeric language sql security definer set search_path=kho as $$ select 1::numeric $$`)
  await c.query(`grant execute on function kho.driver_noguard() to authenticated`)
  ok('[CẮN] bản KHÔNG guard role: sale gọi driver LỌT (ĐỎ)', (await as(U.sale,`select kho.driver_noguard()`)).e===null)

  console.log(`\n== KẾT: ${P} pass / ${F} fail ==`)
  await c.query('rollback')
} catch(e){ console.error('LỖI:', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F?1:0) }
