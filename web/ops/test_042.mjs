// TEST CẮN — 042 ghi vết thời gian. Áp 042 trong tx rồi ROLLBACK. DB_HOST=… DB_PASS=… node ops/test_042.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql = strip(readFileSync(new URL('../../db/042_ghi_vet_thoi_gian.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P=0,F=0; const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[],keep=false){
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null
  try{ r=(await c.query(q,a)).rows; if(keep) await c.query('release savepoint s') }
  catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){} }
  if(!keep&&!e) await c.query('rollback to savepoint s')
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return {r,e}
}
const val=r=>(r.r&&r.r[0])?Object.values(r.r[0])[0]:null
const uidNguoi = async a => (await c.query(`select id from kho.nguoi_dung where auth_uid=$1`,[a])).rows[0].id

try{
  await c.query('begin'); await c.query(sql)
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=any($1)`,[[U.ke_toan,U.xuong,U.tho]])
  const don = (await c.query(`select id,ma_don from kho.don_hang limit 1`)).rows[0]
  const xuongNguoi = await uidNguoi(U.xuong)
  // seed: 3 món — mA,mB (mới), mC (5 ngày trước, để test dung_yen)
  await c.query(`delete from kho.don_hang_mon where don_id=$1`,[don.id])
  const mk = async(ten,cho,ngayTruoc=0)=> (await c.query(`insert into kho.don_hang_mon(don_id,ten,trang_thai,tao_luc) values($1,$2,$3, now() - ($4||' days')::interval) returning id`,[don.id,ten,cho,ngayTruoc])).rows[0].id
  const mA=await mk('Tủ áo 4 cánh','cho_cat',0), mB=await mk('Bàn học','cho_cat',0), mC=await mk('Kệ tivi','cho_cat',0)
  const mD=await mk('Giường cũ','cho_cat',5)   // món đứng yên 5 ngày, KHÔNG đụng — cho mon_dung_yen

  console.log('── 1. Nhật ký MÓN (tự động, 1 dòng, đúng người) ──')
  const t1=await as(U.xuong, `select kho.tien_mon($1,'da_cat')`, [mA], true)
  ok('xuong bấm xong bước mA → OK', t1.e===null, t1.e||'')
  const nk=(await c.query(`select tu,den,nguoi_id,luc from kho.don_hang_mon_nhat_ky where mon_id=$1`,[mA])).rows
  ok('mon_nhat_ky có ĐÚNG 1 dòng', nk.length===1, JSON.stringify(nk))
  ok('dòng: tu=cho_cat den=da_cat, nguoi_id=xuong, có luc', nk[0]&&nk[0].tu==='cho_cat'&&nk[0].den==='da_cat'&&nk[0].nguoi_id===xuongNguoi&&nk[0].luc, JSON.stringify(nk[0]))

  console.log('\n── 1c. VÀO CHUYỀN: món ĐẦU da_cat → ngay_vao_chuyen tự ghi, món 2 KHÔNG đè + chặn gõ tay ──')
  const vcBefore=(await c.query(`select ngay_vao_chuyen from kho.don_hang where id=$1`,[don.id])).rows[0].ngay_vao_chuyen
  ok('món đầu (mA) da_cat → ngay_vao_chuyen = hôm nay', String(vcBefore).slice(0,10)!==null && (await c.query(`select (ngay_vao_chuyen=current_date) b from kho.don_hang where id=$1`,[don.id])).rows[0].b===true)
  // gõ tay ngay_vao_chuyen → CHẶN (savepoint để không vỡ tx)
  await c.query('savepoint vc'); let e_vc=null
  try{ await c.query(`update kho.don_hang set ngay_vao_chuyen='2000-01-01' where id=$1`,[don.id]) }catch(x){e_vc=x.message}
  await c.query('rollback to savepoint vc')
  ok('gõ tay ngay_vao_chuyen → CHẶN', /THỰC TẾ.*KHÔNG gõ tay/.test(e_vc||''), e_vc||'')
  await as(U.xuong,`select kho.tien_mon($1,'da_cat')`,[mB],true)   // món THỨ HAI da_cat
  const vc2=(await c.query(`select ngay_vao_chuyen from kho.don_hang where id=$1`,[don.id])).rows[0].ngay_vao_chuyen
  ok('món thứ 2 (mB) da_cat → ngay_vao_chuyen KHÔNG đổi (giữ mốc đầu)', String(vc2)===String(vcBefore))

  console.log('\n── 1b. [CẮN] BỎ trigger món → KHÔNG có dòng (ĐỎ) ──')
  await c.query('savepoint no_mon'); await c.query('drop trigger trg_ghi_nk_mon on kho.don_hang_mon')
  await as(U.xuong, `select kho.tien_mon($1,'dang_lam')`, [mA], true)
  const nk2=(await c.query(`select count(*)::int n from kho.don_hang_mon_nhat_ky where mon_id=$1 and den='dang_lam'`,[mA])).rows[0].n
  ok('[CẮN] không trigger → 0 dòng den=dang_lam (ĐỎ)', nk2===0, 'dòng='+nk2)
  await c.query('rollback to savepoint no_mon')   // khôi phục trigger

  console.log('\n── 2. Nhật ký ĐƠN qua trigger + CHỐNG TRÙNG (ca dễ sai nhất) ──')
  // cô lập: tắt các trigger gác KHÁC để đổi trang_thai tự do; giữ trg_ghi_nk_don + chống trùng.
  await c.query(`alter table kho.don_hang disable trigger trg_chan_chuyen_vai`)
  await c.query(`alter table kho.don_hang disable trigger trg_kiem_chuyen_trang_thai`)
  await c.query(`alter table kho.don_hang disable trigger trg_moc_bao_gia`)
  const cnt1min = async()=> (await c.query(`select count(*)::int n from kho.don_hang_nhat_ky where don_id=$1 and den='dang_thiet_ke' and luc > now()-interval '1 min'`,[don.id])).rows[0].n
  await c.query(`update kho.don_hang set trang_thai='dang_thiet_ke' where id=$1`,[don.id])   // trigger tự ghi
  ok('trigger tự ghi 1 dòng cho lần đổi', (await cnt1min())===1)
  // đường ghi TAY (sale.js) chèn lại đúng lần đổi -> phải BỎ (dedup)
  await c.query('savepoint man'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.sale,role:'authenticated'})])
  await c.query(`insert into kho.don_hang_nhat_ky(don_id,tu,den,luc,nguoi_id) values($1,'xong_file','dang_thiet_ke',now(),$2)`,[don.id, await uidNguoi(U.sale)])
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); await c.query('release savepoint man')
  ok('★ ghi tay TRÙNG → vẫn 1 dòng (chống trùng)', (await cnt1min())===1)

  console.log('── 2b. [CẮN] BỎ chống trùng → 2 dòng (ĐỎ) ──')
  await c.query('savepoint no_dedup'); await c.query('drop trigger trg_chong_trung_nk_don on kho.don_hang_nhat_ky')
  await c.query(`insert into kho.don_hang_nhat_ky(don_id,tu,den,luc) values($1,'xong_file','dang_thiet_ke',now())`,[don.id])
  ok('[CẮN] không chống trùng → 2 dòng (ĐỎ)', (await cnt1min())===2, 'dòng='+(await cnt1min()))
  await c.query('rollback to savepoint no_dedup')
  await c.query(`alter table kho.don_hang enable trigger trg_chan_chuyen_vai`)
  await c.query(`alter table kho.don_hang enable trigger trg_kiem_chuyen_trang_thai`)
  await c.query(`alter table kho.don_hang enable trigger trg_moc_bao_gia`)

  console.log('\n── 5+6. mon_dung_yen + lead_time (LÀM TRƯỚC khi cho món xong) ──')
  const dy=await as(U.ceo,`select mon_id,ten,so_ngay_dung from kho.mon_dung_yen(3)`)
  ok('mon_dung_yen(3): mD (5 ngày, chưa đụng) HIỆN', (dy.r||[]).some(x=>x.mon_id===mD && Number(x.so_ngay_dung)>=5), JSON.stringify(dy.r))
  ok('mon_dung_yen(3): mA/mB/mC (mới) KHÔNG hiện', !(dy.r||[]).some(x=>[mA,mB,mC].includes(x.mon_id)))
  ok('sale gọi mon_dung_yen → CHẶN', /chỉ ceo\/ke_toan\/xuong/.test((await as(U.sale,`select * from kho.mon_dung_yen(3)`)).e||''))

  console.log('\n── 3. ngay_xong THỰC TẾ (món cuối) + chặn gõ tay ──')
  await c.query(`update kho.don_hang set ngay_xong=null where id=$1`,[don.id])
  const e1=await as(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[mA],true)
  await as(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[mB],true)
  await as(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[mD],true)
  ok('chưa xong hết (mC còn) → ngay_xong VẪN null', (await c.query(`select ngay_xong from kho.don_hang where id=$1`,[don.id])).rows[0].ngay_xong===null, 'e1='+(e1.e||''))
  const eC=await as(U.xuong,`select kho.tien_mon($1,'xong_sx')`,[mC],true)   // món CUỐI
  const xongOK=(await c.query(`select (ngay_xong = current_date) b from kho.don_hang where id=$1`,[don.id])).rows[0].b
  ok('món cuối xong_sx → ngay_xong = hôm nay (tự ghi)', xongOK===true, 'eC='+(eC.e||''))
  const goTay=await as(U.ceo,`update kho.don_hang set ngay_xong='2020-01-01' where id=$1`,[don.id])
  ok('gõ tay ngay_xong → CHẶN', /THỰC TẾ.*KHÔNG gõ tay/.test(goTay.e||''), goTay.e||'')

  const lt=(await as(U.ceo,`select * from kho.lead_time(null,null,20)`)).r?.[0]||{}
  ok('lead_time trả 2 khúc: chờ + làm = tổng', Number(lt.cho_tb)+Number(lt.lam_tb)===Number(lt.tong_tb), JSON.stringify(lt))
  ok('lead_time < 5 đơn → cảnh báo "chưa đủ đơn"', /chưa đủ đơn/.test(lt.canh_bao||''), lt.canh_bao||'')

  console.log('\n── 4. ngay_hen_khach_ban_dau: bắt lần đầu, CHẶN sửa (+[CẮN]) ──')
  await c.query(`update kho.don_hang set ngay_hen_khach='2026-08-15' where id=$1`,[don.id])   // lần đầu -> tự bắt ban_dau
  ok('hứa đầu 15/08 → ngay_hen_khach_ban_dau tự bắt = 15/08', (await c.query(`select (ngay_hen_khach_ban_dau='2026-08-15') b from kho.don_hang where id=$1`,[don.id])).rows[0].b===true)
  await c.query(`update kho.don_hang set ngay_hen_khach='2026-08-20' where id=$1`,[don.id])   // khách đổi ý -> ngay_hen_khach sửa được
  ok('sửa ngay_hen_khach → 20/08 (được), ban_dau vẫn 15/08 (giữ hứa đầu)', (await c.query(`select (ngay_hen_khach='2026-08-20' and ngay_hen_khach_ban_dau='2026-08-15') b from kho.don_hang where id=$1`,[don.id])).rows[0].b===true)
  await c.query('savepoint bd'); let e_bd=null
  try{ await c.query(`update kho.don_hang set ngay_hen_khach_ban_dau='2026-08-25' where id=$1`,[don.id]) }catch(x){e_bd=x.message}
  await c.query('rollback to savepoint bd')
  ok('★ sửa ngay_hen_khach_ban_dau lần 2 → CHẶN', /ghi MỘT LẦN/.test(e_bd||''), e_bd||'(lọt!)')
  // [CẮN] bỏ trigger giữ-hứa-đầu → sửa ban_dau LỌT (ĐỎ)
  await c.query('savepoint no_bd'); await c.query('drop trigger trg_giu_hen_ban_dau on kho.don_hang')
  let e_bd2=null; try{ await c.query(`update kho.don_hang set ngay_hen_khach_ban_dau='2026-08-25' where id=$1`,[don.id]) }catch(x){e_bd2=x.message}
  ok('[CẮN] bỏ trigger → sửa ban_dau LỌT (ĐỎ)', e_bd2===null, e_bd2||'')
  await c.query('rollback to savepoint no_bd')

  console.log('\n── 8. RLS: sale đọc nhật ký được · đọc tiền vẫn CHẶN ──')
  ok('sale ĐỌC don_hang_mon_nhat_ky → được', ((await as(U.sale,`select 1 from kho.don_hang_mon_nhat_ky limit 1`)).r||[]).length>=0 && (await as(U.sale,`select count(*)::int n from kho.don_hang_mon_nhat_ky`)).r[0].n>=1)
  ok('sale ĐỌC don_hang_nhat_ky → được', (await as(U.sale,`select count(*)::int n from kho.don_hang_nhat_ky`)).r[0].n>=1)
  // bảng TIỀN NỘI BỘ (giá vốn driver): sale KHÔNG đọc; ceo/xuong đọc. (gia_chot là giá bán của sale — hợp lệ.)
  await c.query(`insert into kho.san_luong_don(ma_don,cat) values($1,5) on conflict (ma_don) do update set cat=5`,[don.ma_don])
  const slSale=Number((await as(U.sale,`select count(*)::int n from kho.san_luong_don`)).r?.[0]?.n)
  const slCeo=Number((await as(U.ceo,`select count(*)::int n from kho.san_luong_don`)).r?.[0]?.n)
  ok('sale KHÔNG đọc bảng tiền nội bộ (san_luong_don); ceo đọc', slSale===0 && slCeo>=1, 'sale='+slSale+' ceo='+slCeo)

  console.log(`\n==================================\nKẾT 042: ${P} pass / ${F} fail\n==================================`)
  await c.query('rollback')
}catch(e){console.error('LỖI:',e.message);F++;try{await c.query('rollback')}catch(_){}}
finally{ await c.end(); process.exit(F?1:0) }
