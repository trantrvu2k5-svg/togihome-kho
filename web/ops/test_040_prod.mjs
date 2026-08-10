// BƯỚC 4 — TEST CẮN trên PROD (không rollback: ghi thật rồi DỌN). Vai thật qua jwt-context.
//   Kỳ test '2099-12' (tránh kỳ thật) + phiếu đếm ngày 2099-12 — XOÁ hết ở cuối.
//   Mỗi chốt: chứng minh CHẶN, rồi BỎ chốt (tx rollback) cho ĐỎ. In cả hai.
//   Chạy: DB_HOST=… DB_PASS=… node ops/test_040_prod.mjs
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const KY = '2099-12'
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P = 0, F = 0
const ok = (n, cc, e='') => { console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:'')); cc?P++:F++ }
// tx-per-call (prod, autocommit): begin -> set local role/jwt -> query -> commit (deferred trigger cắn lúc commit)
async function asP(uid, sql, args=[]) {
  await c.query('begin'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,e=null
  try { r=(await c.query(sql,args)).rows; await c.query('commit') }
  catch(x){ e=x.message; try{await c.query('rollback')}catch(_){} }
  return {r,e}
}
const val = r => (r.r && r.r[0]) ? Object.values(r.r[0])[0] : null
const LUONG = [
  {ma_to:'cnc',so_nguoi:5,luong_to:30000000,overhead_phan_bo:5000000,bao_hiem:2000000},
  {ma_to:'dan_canh',so_nguoi:5,luong_to:36000000,overhead_phan_bo:6000000,bao_hiem:2400000},
  {ma_to:'cha_lot',so_nguoi:10,luong_to:65000000,overhead_phan_bo:10800000,bao_hiem:4300000},
  {ma_to:'son_pu',so_nguoi:4,luong_to:36000000,overhead_phan_bo:6000000,bao_hiem:2400000},
  {ma_to:'lap_rap',so_nguoi:8,luong_to:73000000,overhead_phan_bo:12100000,bao_hiem:4900000},
  {ma_to:'dong_goi',so_nguoi:9,luong_to:51000000,overhead_phan_bo:8500000,bao_hiem:3400000},
  {ma_to:'giuong',so_nguoi:4,luong_to:33000000,overhead_phan_bo:5500000,bao_hiem:2200000}]
const PB = [['cnc','cat',100],['dan_canh','dan',70],['dan_canh','cam',30],['cha_lot','lot',100],
  ['son_pu','pu',70],['son_pu','son_canh',30],['lap_rap','cup',15],['lap_rap','thung',45],
  ['lap_rap','ray',25],['lap_rap','canh',15],['dong_goi','goi',100],['giuong','giuong_lap',100]]
  .map(([ma_to,hoat_dong,phan_tram_thoi_gian])=>({ma_to,hoat_dong,phan_tram_thoi_gian}))
// Xoá kỳ test. Xoá phan_bo để tổ về 0 dòng -> deferred 100% CHẶN commit; off_100=1 bỏ chốt CHỈ để dọn.
const dọn = async () => {
  await c.query('begin')
  await c.query(`select set_config('chan.off_100','1',true)`)
  await c.query(`delete from kho.phan_bo_hoat_dong where ma_ky=$1`,[KY])
  await c.query(`delete from kho.luong_to where ma_ky=$1`,[KY])
  await c.query(`delete from kho.phieu_dem_ngay where to_char(ngay,'YYYY-MM')=$1`,[KY])
  await c.query('commit')
}

try {
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=$1`, [U.ke_toan])  // ke_toan active (giữ — vai thật)
  await dọn()

  console.log('── 1. ke_toan LƯU 7 tổ + % → reload → CÒN ──')
  const g = await asP(U.ke_toan, `select kho.ghi_so_tham_so_xuong($1,$2::jsonb,$3::jsonb) d`, [KY, JSON.stringify(LUONG), JSON.stringify(PB)])
  ok('ke_toan lưu → OK (7 tổ, 12 phân bổ)', (val(g)||{}).ok===true, JSON.stringify(g.r||g.e))
  ok('reload: luong_to CÒN 7 dòng (đã COMMIT prod)', (await c.query(`select count(*)::int n from kho.luong_to where ma_ky=$1`,[KY])).rows[0].n===7)
  ok('reload: phan_bo CÒN 12 dòng', (await c.query(`select count(*)::int n from kho.phan_bo_hoat_dong where ma_ky=$1`,[KY])).rows[0].n===12)

  console.log('\n── 2. Vai KHÁC không ghi được ──')
  ok('sale lưu → CHẶN', /chỉ ceo\/ke_toan/.test((await asP(U.sale, `select kho.ghi_so_tham_so_xuong($1,$2::jsonb,$3::jsonb)`,[KY,JSON.stringify(LUONG),JSON.stringify(PB)])).e||''))
  ok('xuong lưu → CHẶN', /chỉ ceo\/ke_toan/.test((await asP(U.xuong, `select kho.ghi_so_tham_so_xuong($1,$2::jsonb,$3::jsonb)`,[KY,JSON.stringify(LUONG),JSON.stringify(PB)])).e||''))

  console.log('\n── 3. Tổng % một tổ = 90% → CHẶN (nói rõ tổ) ──')
  const BAD = PB.filter(p=>!(p.ma_to==='lap_rap'&&p.hoat_dong==='canh'))  // lap_rap còn 85
  const b = await asP(U.ke_toan, `select kho.ghi_so_tham_so_xuong($1,$2::jsonb,$3::jsonb)`,[KY,JSON.stringify(LUONG),JSON.stringify(BAD)])
  ok('ghi thiếu % → CHẶN, nói rõ tổ lap_rap', /Phân bổ tổ "lap_rap".*100/.test(b.e||''), b.e||'')
  ok('CHẶN xong dữ liệu tốt VẪN CÒN (bad rolled back)', (await c.query(`select count(*)::int n from kho.phan_bo_hoat_dong where ma_ky=$1`,[KY])).rows[0].n===12)

  console.log('\n── 4. Mẫu số chưa nguồn → THIẾU (KHÔNG ra 0) ──')
  const kq0 = await asP(U.ke_toan, `select * from kho.ket_qua_don_gia($1) where hoat_dong='cat'`,[KY])
  const cat0 = (kq0.r||[])[0]||{}
  ok('cat: don_gia NULL + trạng thái THIẾU mẫu số (KHÔNG 0)', cat0.don_gia===null && /THIẾU.*mẫu số/.test(cat0.trang_thai||''), JSON.stringify(cat0))

  console.log('\n── 4b. [CẮN] có chốt vs BỎ chốt (coalesce ...,0) ──')
  ok('CÓ chốt: cat don_gia = NULL (THIẾU, không 0)', cat0.don_gia===null)
  const noChot = await asP(U.ke_toan, `select coalesce(don_gia,0) v from kho.ket_qua_don_gia($1) where hoat_dong='cat'`,[KY])
  ok('[CẮN] BỎ chốt (hiển thị coalesce(don_gia,0)) → ra 0 (ĐỎ, che mất THIẾU)', Number(val(noChot))===0, 'ra '+val(noChot))

  console.log('\n── 5. Phiếu đếm cho pu → THIẾU chuyển "từ phiếu đếm" ──')
  await c.query(`insert into kho.phieu_dem_ngay(ngay,ma_to,hoat_dong,so_luong) values('2099-12-10','son_pu','pu',150)`)
  const pu1 = await asP(U.ke_toan, `select * from kho.ket_qua_don_gia($1) where hoat_dong='pu'`,[KY])
  const pu = (pu1.r||[])[0]||{}
  ok("pu: nguồn 'từ phiếu đếm', mẫu số 150, don_gia có số", pu.nguon_mau_so==='từ phiếu đếm' && Number(pu.mau_so)===150 && pu.don_gia!==null, JSON.stringify(pu))

  console.log('\n── 6. so_sanh_don_gia ──')
  const ss = await asP(U.ke_toan, `select * from kho.so_sanh_don_gia($1) order by hoat_dong`,[KY])
  ok('so_sanh trả 12 dòng', (ss.r||[]).length===12)
  const puS = (ss.r||[]).find(x=>x.hoat_dong==='pu')||{}
  ok('pu: don_gia_dang_dung=5690 + lech_pct + so_ngay=1', Number(puS.don_gia_dang_dung)===5690 && puS.lech_pct!==null && puS.so_ngay_co_du_lieu===1, JSON.stringify(puS))
  ok('sale gọi so_sanh_don_gia → CHẶN', /chỉ ceo\/ke_toan/.test((await asP(U.sale,`select * from kho.so_sanh_don_gia($1)`,[KY])).e||''))

  console.log('\n── 7. [CẮN] BỎ chốt vai RPC (tx rollback) → sale ghi LỌT (ĐỎ) ──')
  await c.query('begin')
  await c.query(`create or replace function kho.ghi_noguard(p_ma_ky text) returns jsonb language plpgsql security definer set search_path=kho as $$ begin
    insert into kho.luong_to(ma_ky,ma_to,luong_to) values(p_ma_ky,'cnc',1) on conflict do nothing; return jsonb_build_object('ok',true); end $$`)
  await c.query(`grant execute on function kho.ghi_noguard(text) to authenticated`)
  const lot = await asP(U.sale, `select kho.ghi_noguard($1)`,['2099-11'])
  ok('[CẮN] RPC KHÔNG guard → sale ghi LỌT (ĐỎ)', lot.e===null, JSON.stringify(lot.r||lot.e))
  await c.query('rollback')

  console.log('\n── DỌN dữ liệu test ──')
  await dọn()
  const con = (await c.query(`select (select count(*) from kho.luong_to where ma_ky=$1)+(select count(*) from kho.phan_bo_hoat_dong where ma_ky=$1)+(select count(*) from kho.phieu_dem_ngay where to_char(ngay,'YYYY-MM')=$1) n`,[KY])).rows[0].n
  ok('đã dọn sạch dữ liệu test (0 dòng còn)', Number(con)===0, 'còn '+con)

  console.log(`\n==================================\nBƯỚC 4 PROD: ${P} pass / ${F} fail\n==================================`)
} catch(e){ console.error('LỖI:', e.message); F++; try{await dọn()}catch(_){}}
finally { await c.end(); process.exit(F?1:0) }
