// TEST CẮN — 118 · Dọn nợ: phân trang 6 RPC nợ L-29 (limit/offset, chữ ký cũ vẫn gọi được) + drop khach_sdt + dieu_hanh dùng sdt_khach.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', ke_toan:'487c6fb3-5075-4e9e-a66d-8ffbe14737c3', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8' }
const c = new pg.Client(await docConfig()); await c.connect()
let P = 0, F = 0
const ok = (n, v, e = '') => { console.log((v ? '✅' : '❌') + ' ' + n + (!v && e ? ' — ' + e : '')); v ? P++ : F++ }
async function asK(uid, s, a = []) { await c.query('savepoint k'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
  let r = null, e = null; try { r = (await c.query(s, a)).rows; await c.query('release savepoint k') } catch (x) { e = x.message; try { await c.query('rollback to savepoint k') } catch (_) {} }
  await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)"); return { r, e } }
const q = async (s, a = []) => (await c.query(s, a)).rows

try {
  await c.query('begin'); await c.query('set local statement_timeout=0')
  for (const g of ['off_nguon','off_thuonghieu','off_nhay','off_mon_gia','off_von','off_von_chuyen']) await c.query(`set local chan.${g}='1'`)

  console.log('── 1 · DROP khach_sdt ──')
  ok('#1 cột khach_sdt ĐÃ biến mất', (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='khach_sdt'`)).length === 0)
  ok('#1 FK fk_dh_khach ĐÃ gỡ', (await q(`select 1 from pg_constraint where conname='fk_dh_khach'`)).length === 0)
  ok('#1 sdt_khach + index idx_don_hang_sdt GIỮ NGUYÊN', (await q(`select 1 from information_schema.columns where table_schema='kho' and table_name='don_hang' and column_name='sdt_khach'`)).length === 1 && (await q(`select 1 from pg_indexes where schemaname='kho' and indexname='idx_don_hang_sdt'`)).length === 1)

  console.log('\n── 2 · dieu_hanh_cong_no_khach dùng sdt_khach (không gãy sau drop) ──')
  await q(`update kho.don_hang set la_demo=true where trang_thai='da_giao'`)
  await q(`insert into kho.don_hang(ma_don,trang_thai,dong,gia_chot,ngay_giao,ten_khach,sdt_khach,la_demo) values('DH1','da_giao','le',50000000, current_date-interval '10 days','Khách X','0900000001',false)`)
  const ch = await asK(U.ceo, `select kho.dieu_hanh_cong_no_khach(100) g`)
  ok('#2 chạy KHÔNG lỗi (đã đổi max(sdt_khach))', ch.e === null, ch.e)
  const kx = (ch.r[0].g || []).find(x => x.khach === 'Khách X')
  ok('#2 trả sdt lấy từ sdt_khach', kx && kx.sdt === '0900000001', JSON.stringify(kx))

  console.log('\n── 3 · LIMIT trần + GIỮ CHỮ KÝ (zero-arg vẫn zero-arg, KHÔNG sinh overload) ──')
  // seed 10 đơn moi_len_don, chưa có tem → lọt danh sách; hàm chạy đúng
  for (let i = 1; i <= 10; i++) await q(`insert into kho.don_hang(ma_don,trang_thai,dong,ngay_hen_khach,la_demo) values('VC${String(i).padStart(2,'0')}','moi_len_don','le','2099-01-${String(i).padStart(2,'0')}',false)`)
  const gAll = await asK(U.ceo, `select count(*)::int n from kho.xuong_don_cho_vao_chuyen()`)
  ok('#3 gọi ARG-CŨ (zero-arg) chạy & thấy ≥10 đơn', gAll.e === null && gAll.r[0].n >= 10, gAll.e)
  ok('#3 ĐÚNG 1 overload (không nhập nhằng — bài học ambiguous)', (await q(`select count(*)::int n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace where nn.nspname='kho' and p.proname='xuong_don_cho_vao_chuyen'`))[0].n === 1)
  ok('#3 hàm CÓ LIMIT trong định nghĩa', /limit\s+1000/i.test((await q(`select pg_get_functiondef('kho.xuong_don_cho_vao_chuyen()'::regprocedure) d`))[0].d))
  ok('#3 guard giữ: sale → CHẶN', (await asK(U.sale, `select kho.xuong_don_cho_vao_chuyen()`)).e !== null)

  console.log('\n── 4 · các RPC nợ khác: chữ ký GỐC vẫn chạy + đúng 1 overload + có LIMIT ──')
  for (const [f, sig, arg] of [
    ['can_ceo_quyet', 'kho.can_ceo_quyet()', 'kho.can_ceo_quyet()'],
    ['tk_bang_cong_viec', 'kho.tk_bang_cong_viec()', 'kho.tk_bang_cong_viec()'],
    ['tk_viec_cua_toi', 'kho.tk_viec_cua_toi()', 'kho.tk_viec_cua_toi()'],
    ['tk_don_cho_nhan', 'kho.tk_don_cho_nhan()', 'kho.tk_don_cho_nhan()'],
    ['sp_danh_sach', 'kho.sp_danh_sach(text,text,text)', 'kho.sp_danh_sach(null,null,null)']]) {
    ok(`#4 ${f} chạy (chữ ký gốc)`, (await asK(U.ceo, `select ${arg}`)).e === null)
    ok(`#4 ${f} đúng 1 overload`, (await q(`select count(*)::int n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace where nn.nspname='kho' and p.proname='${f}'`))[0].n === 1)
    ok(`#4 ${f} có LIMIT`, /limit\s+\d/i.test((await q(`select pg_get_functiondef('${sig}'::regprocedure) d`))[0].d))
  }

  console.log(`\n${F === 0 ? '🟢' : '🔴'} test_118: ${P} pass / ${F} fail`)
} catch (e) { console.error('💥', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F === 0 ? 0 : 1) }
