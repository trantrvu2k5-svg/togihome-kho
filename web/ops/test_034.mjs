// TEST PHẢI CẮN — RPC ghi_gia_von_don + chốt fail-đóng khi đơn thiết kế chưa có giá vốn. Áp 034 tx rồi ROLLBACK.
import { readFileSync } from 'fs'; import pg from 'pg'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql034 = strip(readFileSync('/Users/vuquanghai/Documents/togihome-kho/db/034_ghi_gia_von_don.sql', 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3',
  kho:'66272566-1897-4c57-aa3f-98a81636302a', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  thiet_ke:'004aadb0-d1fb-40d3-b7ae-ca75c60b410e', truong_nhom_sale:'85f5a6bf-dd52-487b-b7b1-6ddea4508333', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const NULLU = '00000000-0000-0000-0000-0000000000ff'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await c.connect()
let PASS = 0, FAIL = 0
const ok = (n, cond, e='') => { console.log((cond?'✅':'❌')+' '+n+(e?'  — '+e:'')); cond?PASS++:FAIL++ }
const q = async (s,a=[]) => (await c.query(s,a)).rows
async function asRole(uid, sql, args=[]) {   // trả {err} hoặc {rows}
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})])
  let r=null,err=null; try{ r=(await c.query(sql,args)).rows }catch(e){ err=e.message }
  finally{ await c.query('rollback to savepoint s'); await c.query('reset role') }
  return {rows:r, err}
}
const PUSH = `select kho.ghi_gia_von_don('TEST-VON', 3000000, 2000000, 1500000, 6500000)`
const guard = e => e!=null && /chỉ ceo\/kho\/thiet_ke/.test(e)

try {
  await c.query('begin'); await c.query(sql034)
  await c.query(`insert into kho.don_hang(ma_don,dong,ngay_chot,gia_cong_thuc) values('TEST-VON','du_an',current_date,10000000)`)
  const tkId = (await q(`select id from kho.nguoi_dung where auth_uid=$1`,[U.thiet_ke]))[0].id

  // 1. thiet_ke đẩy -> don_hang_gia_von đúng 3 khối + gcg + vết
  await c.query('savepoint p1'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.thiet_ke,role:'authenticated'})])
  await c.query(PUSH); await c.query('reset role')
  const row = (await q(`select khoi_1,khoi_2,khoi_3,gia_chuyen_giao,nguoi_day from kho.don_hang_gia_von where ma_don='TEST-VON'`))[0]
  ok('1 thiet_ke đẩy → 3 khối + gcg đúng', Number(row.khoi_1)===3000000&&Number(row.khoi_2)===2000000&&Number(row.khoi_3)===1500000&&Number(row.gia_chuyen_giao)===6500000)
  ok('1 vết ai đẩy = thiet_ke', row.nguoi_day===tkId)
  // 2. đẩy lại (số khác) -> CẬP NHẬT, không nhân đôi
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.thiet_ke,role:'authenticated'})])
  await c.query(`select kho.ghi_gia_von_don('TEST-VON', 9,9,9, 27)`); await c.query('reset role')
  const cnt = (await q(`select count(*)::int n, max(gia_chuyen_giao) g from kho.don_hang_gia_von where ma_don='TEST-VON'`))[0]
  ok('2 đẩy lại → CẬP NHẬT không nhân đôi', cnt.n===1 && Number(cnt.g)===27)
  await c.query('rollback to savepoint p1')   // trả về trạng thái sau lần đẩy 1

  // 3. ceo/kho ĐƯỢC ; sale/xuong/ke_toan/truong CHẶN
  for (const vt of ['ceo','kho']) ok(`3 ${vt} đẩy được`, (await asRole(U[vt], PUSH)).err===null)
  for (const vt of ['sale','xuong','ke_toan','truong_nhom_sale']) ok(`3 ${vt} đẩy → CHẶN`, guard((await asRole(U[vt], PUSH)).err))

  // 4. null vai_tro CHẶN ; bản KHÔNG guard LỌT (ĐỎ)
  ok('4 vai_tro NULL → CHẶN', guard((await asRole(NULLU, PUSH)).err))
  await c.query(`create or replace function kho.ghi_gia_von_don_noguard() returns text language sql security definer set search_path=kho as $$
    insert into kho.don_hang_gia_von(ma_don,khoi_1,khoi_2,khoi_3,gia_chuyen_giao) values('TEST-VON',1,1,1,3)
    on conflict(ma_don) do update set khoi_1=1 returning 'lot' $$`)
  await c.query(`grant execute on function kho.ghi_gia_von_don_noguard() to authenticated`)
  const noguard = await asRole(NULLU, `select kho.ghi_gia_von_don_noguard()`)
  ok('4 [CẮN] bản KHÔNG guard: null LỌT (ĐỎ)', noguard.err===null)

  // 5. FAIL-ĐÓNG chốt: đơn thiết kế chưa có giá vốn -> chặn ; đẩy lên -> chốt được
  console.log('\n── Ca chứng minh cả lô ──')
  await c.query(`delete from kho.don_hang_gia_von where ma_don='TEST-VON'`)   // gỡ giá vốn
  const chot = async () => { await c.query('savepoint x'); let e=null; try{ await c.query(`update kho.don_hang set gia_chot=9000000, gia_cong_thuc=10000000, chiet_khau=0 where ma_don='TEST-VON'`) }catch(er){e=er.message} finally{ await c.query('rollback to savepoint x') } return e }
  const truoc = await chot()
  ok('5 chưa có giá vốn → chốt bị CHẶN (fail-đóng)', truoc!=null && /chưa có giá vốn/.test(truoc), truoc||'')
  // bite: bỏ chốt 0 (off_von) -> lọt
  await c.query('savepoint ov'); await c.query(`select set_config('chan.off_von','1',true)`)
  const offVon = await chot(); await c.query(`select set_config('chan.off_von','',true)`); await c.query('rollback to savepoint ov')
  ok('5 [CẮN] bỏ chốt-0 → LỌT (ĐỎ)', offVon===null)
  // đẩy giá vốn (thiet_ke) rồi chốt lại -> được
  await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:U.thiet_ke,role:'authenticated'})])
  await c.query(PUSH); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")   // chốt do người khác (sale) — xoá phiên thiet_ke
  const sau = await chot()
  ok('5 sau khi đẩy giá vốn → chốt ĐƯỢC', sau===null, sau||'')

  console.log(`\n== KẾT: ${PASS} pass / ${FAIL} fail ==`)
} catch(e){ console.error('LỖI:', e.message); FAIL++ }
finally { await c.query('rollback'); await c.end(); process.exit(FAIL?1:0) }
