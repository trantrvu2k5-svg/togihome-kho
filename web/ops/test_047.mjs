// TEST CẮN — 047 chặn hạ đơn sản xuất. Áp 047 trong tx rồi ROLLBACK. node ops/test_047.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql47 = strip(readFileSync(new URL('../../db/047_chan_lui_san_xuat.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8', xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb' }
const c = new pg.Client({ ...(await docConfig()) }); await c.connect()
let P = 0, F = 0; const ok = (n, cc, e='') => { console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:'')); cc?P++:F++ }
async function as(uid, q, a=[]) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{ r=(await c.query(q,a)).rows }catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e) await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { r, e }
}
const tt = async ma => (await c.query(`select trang_thai from kho.don_hang where ma_don=$1`,[ma])).rows[0]?.trang_thai
try {
  await c.query('begin')
  await c.query(`delete from kho.don_hang where ma_don like 'CL-%'`)
  await c.query(sql47)
  const mk = async (ma,st)=> c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai) values($1,'le','le_sang',$2)`,[ma,st])
  await mk('CL-cho_cat','cho_cat'); await mk('CL-cho_giao','cho_giao'); await mk('CL-moi','moi_len_don'); await mk('CL-fwd','moi_len_don')

  console.log('── Hạ đơn SX -> moi_len_don ──')
  ok('sale hạ cho_cat->moi_len_don → CHẶN', /chỉ ceo\/xuong|đang sản xuất/i.test((await as(U.sale,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='CL-cho_cat'`)).e||''))
  ok('ceo hạ KHÔNG lý do → CHẶN (phải có lý do)', /CÓ LÝ DO/i.test((await as(U.ceo,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='CL-cho_cat'`)).e||''))
  const r=await as(U.ceo,`select set_config('moc.ly_do_lui','khách đổi ý',true); update kho.don_hang set trang_thai='moi_len_don' where ma_don='CL-cho_cat'`)
  ok('ceo hạ CÓ lý do (moc.ly_do_lui) → OK', r.e===null, r.e||'')
  ok('sale hạ cho_giao->moi_len_don → CHẶN', /chỉ ceo\/xuong|đang sản xuất/i.test((await as(U.sale,`update kho.don_hang set trang_thai='moi_len_don' where ma_don='CL-cho_giao'`)).e||''))

  console.log('\n── KHÔNG chặn nhầm ──')
  ok('moi_len_don->cho_cat (đi TỚI) KHÔNG chặn', (await as(U.ceo,`update kho.don_hang set trang_thai='cho_cat' where ma_don='CL-fwd'`)).e===null)
  // trong SX: cho_giao->dang_lam (món lùi) — mô phỏng bằng chan.tu_mon (món tự đẩy)
  await c.query('savepoint sx'); await c.query(`select set_config('chan.tu_mon','1',true)`)
  let e_sx=null; try{ await c.query(`update kho.don_hang set trang_thai='dang_lam' where ma_don='CL-cho_giao'`) }catch(x){e_sx=x.message}
  await c.query(`select set_config('chan.tu_mon','',true)`); await c.query('rollback to savepoint sx')
  ok('cho_giao->dang_lam (chan.tu_mon, trong SX) KHÔNG chặn', e_sx===null, e_sx||'')
  const eHuy=(await as(U.ceo,`update kho.don_hang set trang_thai='huy', ly_do_huy='khách huỷ' where ma_don='CL-cho_cat'`)).e||''
  ok('cho_cat->huy KHÔNG bị trg chan_lui chặn (huy ngoài nhóm lui)', !/đang sản xuất|chỉ ceo\/xuong|CÓ LÝ DO/i.test(eHuy), eHuy?('lỗi khác (không phải chan_lui): '+eHuy.slice(0,50)):'')

  console.log('\n── [CẮN] tắt trg (off_lui) -> sale hạ LỌT (ĐỎ) ──')
  await c.query('savepoint off'); await c.query(`select set_config('chan.off_lui','1',false)`); await c.query(`select set_config('chan.off_vai','1',false)`)
  let e_off=null; try{ await c.query(`update kho.don_hang set trang_thai='moi_len_don' where ma_don='CL-cho_cat'`) }catch(x){e_off=x.message}
  await c.query(`select set_config('chan.off_lui','',false)`); await c.query(`select set_config('chan.off_vai','',false)`); await c.query('rollback to savepoint off')
  ok('[CẮN] off_lui=1 → hạ SX->moi_len_don LỌT (ĐỎ khi có bug)', e_off===null)

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
} catch (e) { console.error('LỖI TEST:', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F?1:0) }
