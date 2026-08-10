// BƯỚC 4 — CẮN THẬT trên PROD (đơn throwaway ZZ-042-TEST, xoá sạch cuối). Vai thật qua jwt-context.
//   Chạy: DB_HOST=… DB_PASS=… node ops/test_042_prod.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const MA = 'ZZ-042-TEST'
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function asP(uid,q,a=[]){ await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})]); let r=null,e=null; try{ r=(await c.query(q,a)).rows; await c.query('commit') }catch(x){ e=x.message; try{await c.query('rollback')}catch(_){} } return {r,e} }
const val=r=>(r.r&&r.r[0])?Object.values(r.r[0])[0]:null
async function don(){ return (await c.query(`select id from kho.don_hang where ma_don=$1`,[MA])).rows[0]?.id }
async function clean(){
  const id=await don(); if(!id) return
  await c.query('begin'); await c.query(`select set_config('moc.auto_xong','1',true)`)
  await c.query(`delete from kho.don_hang_mon_nhat_ky where don_id=$1`,[id])
  await c.query(`delete from kho.don_hang_nhat_ky where don_id=$1`,[id])
  await c.query(`delete from kho.don_hang_mon where don_id=$1`,[id])
  await c.query(`delete from kho.don_hang where id=$1`,[id]); await c.query('commit')
}
try{
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=$1`,[U.xuong])
  await clean()   // sạch trước
  // đơn throwaway: SX state 'cho_cat', chốt 3 ngày trước, hẹn khách 15/08
  const id=(await c.query(`insert into kho.don_hang(ma_don,dong,trang_thai,ngay_chot,ngay_hen_khach) values($1,'le','cho_cat',current_date-3,'2026-08-15') returning id`,[MA])).rows[0].id
  const mk=async t=>(await c.query(`insert into kho.don_hang_mon(don_id,ten,trang_thai) values($1,$2,'cho_cat') returning id`,[id,t])).rows[0].id
  const m1=await mk('Tủ áo 4C'), m2=await mk('Bàn học')
  const xNg=(await c.query(`select id from kho.nguoi_dung where auth_uid=$1`,[U.xuong])).rows[0].id

  console.log('── 1. Món transition → nhật ký (đúng người) + VÀO CHUYỀN ──')
  await asP(U.xuong,`select kho.tien_mon($1,'da_cat')`,[m1])
  const nk=(await c.query(`select tu,den,nguoi_id from kho.don_hang_mon_nhat_ky where mon_id=$1`,[m1])).rows
  ok('mon_nhat_ky 1 dòng, nguoi_id=xuong', nk.length===1 && nk[0].nguoi_id===xNg, JSON.stringify(nk))
  ok('món ĐẦU da_cat → ngay_vao_chuyen = hôm nay', (await c.query(`select (ngay_vao_chuyen=current_date) b from kho.don_hang where id=$1`,[id])).rows[0].b===true)
  const vc=(await c.query(`select ngay_vao_chuyen from kho.don_hang where id=$1`,[id])).rows[0].ngay_vao_chuyen
  await asP(U.xuong,`select kho.tien_mon($1,'da_cat')`,[m2])   // món 2 → cả 2 da_cat → đơn dong_bo da_cat
  ok('món 2 da_cat → ngay_vao_chuyen KHÔNG đè', String((await c.query(`select ngay_vao_chuyen from kho.don_hang where id=$1`,[id])).rows[0].ngay_vao_chuyen)===String(vc))

  console.log('\n── 2. Đơn nhật ký (SX transition từ món) + chống trùng ──')
  const dnk=(await c.query(`select count(*)::int n from kho.don_hang_nhat_ky where don_id=$1 and den='da_cat'`,[id])).rows[0].n
  ok('đơn tự sang da_cat (dong_bo từ món) → nhật ký ĐƠN có 1 dòng', dnk===1, 'dòng='+dnk)
  await c.query(`insert into kho.don_hang_nhat_ky(don_id,tu,den,luc) values($1,'cho_cat','da_cat',now())`,[id])  // ghi tay trùng
  ok('★ ghi tay trùng → vẫn 1 dòng (chống trùng)', (await c.query(`select count(*)::int n from kho.don_hang_nhat_ky where don_id=$1 and den='da_cat'`,[id])).rows[0].n===1)

  console.log('\n── 3. ngay_xong (món cuối) + chặn gõ tay ──')
  await asP(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[m1])
  ok('1 món xong, 1 chưa → ngay_xong null', (await c.query(`select ngay_xong from kho.don_hang where id=$1`,[id])).rows[0].ngay_xong===null)
  await asP(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[m2])
  ok('món cuối xong → ngay_xong = hôm nay', (await c.query(`select (ngay_xong=current_date) b from kho.don_hang where id=$1`,[id])).rows[0].b===true)
  await c.query('begin'); let eGT=null; try{ await c.query(`update kho.don_hang set ngay_xong='2020-01-01' where id=$1`,[id]) }catch(x){eGT=x.message} await c.query('rollback')
  ok('gõ tay ngay_xong → CHẶN', /THỰC TẾ.*gõ tay/.test(eGT||''), eGT||'')

  console.log('\n── 4. ngay_hen_khach_ban_dau bất biến ──')
  ok('hứa đầu tự bắt = 15/08', (await c.query(`select (ngay_hen_khach_ban_dau='2026-08-15') b from kho.don_hang where id=$1`,[id])).rows[0].b===true)
  await c.query(`update kho.don_hang set ngay_hen_khach='2026-08-20' where id=$1`,[id])  // khách đổi ý
  ok('ngay_hen_khach sửa 20/08 được, ban_dau vẫn 15/08', (await c.query(`select (ngay_hen_khach='2026-08-20' and ngay_hen_khach_ban_dau='2026-08-15') b from kho.don_hang where id=$1`,[id])).rows[0].b===true)
  await c.query('begin'); let eBD=null; try{ await c.query(`update kho.don_hang set ngay_hen_khach_ban_dau='2026-08-25' where id=$1`,[id]) }catch(x){eBD=x.message} await c.query('rollback')
  ok('★ sửa ban_dau lần 2 → CHẶN', /ghi MỘT LẦN/.test(eBD||''), eBD||'')

  console.log('\n── 5. lead_time hai khúc + RLS sale ──')
  const lt=(await asP(U.ceo,`select * from kho.lead_time('le',null,20)`)).r?.[0]||{}
  ok('lead_time: chờ + làm = tổng', Number(lt.cho_tb)+Number(lt.lam_tb)===Number(lt.tong_tb), JSON.stringify(lt))
  ok('sale ĐỌC nhật ký món → được', Number((await asP(U.sale,`select count(*)::int n from kho.don_hang_mon_nhat_ky where don_id=$1`,[id])).r?.[0]?.n)>=1)
  ok('sale ĐỌC bảng tiền nội bộ san_luong_don → 0 (RLS)', Number((await asP(U.sale,`select count(*)::int n from kho.san_luong_don`)).r?.[0]?.n)===0)

  console.log('\n── DỌN ──')
  await clean()
  ok('đã xoá sạch đơn test', (await don())===undefined)
  console.log(`\n== BƯỚC 4 PROD 042: ${P} pass / ${F} fail ==`)
}catch(e){ console.error('LỖI:',e.message); F++; try{await clean()}catch(_){}}
finally{ await c.end(); process.exit(F?1:0) }
