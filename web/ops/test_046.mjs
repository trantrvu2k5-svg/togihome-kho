// TEST CẮN — 046 sale "bao giờ giao": sale_mon_cua_don · sale_lead_time · lead_time refactor (guard giữ).
//   Áp 046 trong tx rồi ROLLBACK. node ops/test_046.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig as dc } from './conn.mjs'
const strip = s => s.split('\n').filter(l => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql46 = strip(readFileSync(new URL('../../db/046_sale_bao_gio_giao.sql', import.meta.url), 'utf8'))
const U = { ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6', sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',
  xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb', tho:'73bbdefd-10af-4f44-9ab8-d92e029299a2' }
const c = new pg.Client({ ...(await dc()) }); await c.connect()
let P = 0, F = 0; const ok = (n, cc, e='') => { console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:'')); cc?P++:F++ }
async function as(uid, q, a=[]) {
  await c.query('savepoint s'); await c.query('set local role authenticated')
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid?{sub:uid,role:'authenticated'}:{role:'authenticated'})])
  let r=null,e=null; try{ r=(await c.query(q,a)).rows }catch(x){ e=x.message; try{await c.query('rollback to savepoint s')}catch(_){}}
  if(!e) await c.query('rollback to savepoint s'); await c.query('reset role'); await c.query("select set_config('request.jwt.claims','',true)")
  return { r, e }
}
try {
  await c.query('begin')
  await c.query(`delete from kho.don_hang where ma_don like 'SA-%'`)
  await c.query(sql46)

  // seed 3 đơn 'le' đã xong để lead_time có căn cứ (chốt→vào chuyền→xong)
  for (const [ma,ch,vc,xo] of [['SA-lt1',20,17,7],['SA-lt2',18,15,5],['SA-lt3',25,20,9]])
    await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ngay_chot,ngay_vao_chuyen,ngay_xong)
      values($1,'le','le_sang','da_giao',current_date-($2::int),current_date-($3::int),current_date-($4::int))`,[ma,ch,vc,xo])
  // đơn đang chạy + 3 món cho sale_mon_cua_don
  const D = (await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai) values('SA-mon','le','le_sang','cho_cat') returning id`)).rows[0].id
  const mTac = (await c.query(`insert into kho.don_hang_mon(don_id,ten,vl,ma_mau,kt,so_luong,chi_tiet,trang_thai,gia,tho,tao_luc)
      values($1,'Tủ tắc','MDF17','N01','1200x600',2,'ghi chú xưởng','dang_lam',5000000,'thợ A', now()-interval '4 days') returning id`,[D])).rows[0].id
  await c.query(`insert into kho.don_hang_mon(don_id,ten,vl,so_luong,trang_thai,gia,tho) values($1,'Kệ xong','MDF17',1,'xong_sx',2000000,'thợ B')`,[D])
  const mJk = (await c.query(`insert into kho.don_hang_mon(don_id,ten,vl,so_luong,trang_thai,tao_luc) values($1,'Bàn nhật ký','MDF17',1,'da_cat', now()-interval '20 days') returning id`,[D])).rows[0].id
  await c.query(`insert into kho.don_hang_mon_nhat_ky(mon_id,don_id,tu,den,luc,nguoi_id) values($1,$2,'cho_cat','da_cat', now()-interval '5 days', null)`,[mJk,D])

  console.log('── 1. lead_time refactor: guard GIỮ, output khớp lõi ──')
  const lt = await as(U.ceo, `select tong_tb,so_don from kho.lead_time('le',null,20)`)
  const core = (await c.query(`select tong_tb,so_don from kho._lead_time_core('le',null,20)`)).rows[0]
  ok('ceo gọi lead_time OK, khớp _lead_time_core', lt.e===null && String(lt.r[0].tong_tb)===String(core.tong_tb) && lt.r[0].so_don===core.so_don, JSON.stringify(lt.r?.[0]))
  ok('sale gọi lead_time (gốc) → CHẶN', /chỉ ceo\/ke_toan\/xuong/.test((await as(U.sale,`select * from kho.lead_time()`)).e||''))

  console.log('\n── 2. sale_lead_time: chỉ 4 cột ngày, guard sale ──')
  const slt = await as(U.sale, `select trung_binh,nhanh_nhat,cham_nhat,so_don_can_cu from kho.sale_lead_time('le',null)`)
  ok('sale gọi sale_lead_time OK', slt.e===null, JSON.stringify(slt.r?.[0]))
  ok('so_don_can_cu ≥ 3 (3 đơn seed + đơn thật prod)', slt.r?.[0]?.so_don_can_cu>=3, String(slt.r?.[0]?.so_don_can_cu))
  ok('KHÔNG có cột tiền (chỉ 4 cột ngày)', slt.r&&Object.keys(slt.r[0]).join(',')==='trung_binh,nhanh_nhat,cham_nhat,so_don_can_cu', slt.r&&Object.keys(slt.r[0]).join(','))
  ok('ceo gọi sale_lead_time OK', (await as(U.ceo,`select * from kho.sale_lead_time('le',null)`)).e===null)
  ok('xuong gọi sale_lead_time → CHẶN (ngoài guard sale)', /chỉ ceo\/sale/.test((await as(U.xuong,`select * from kho.sale_lead_time()`)).e||''))
  ok('vai NULL → CHẶN', /chỉ ceo\/sale/.test((await as(null,`select * from kho.sale_lead_time()`)).e||''))

  console.log('\n── 3. sale_mon_cua_don: trạng thái + số ngày tắc, KHÔNG gia/tho ──')
  const smc = await as(U.sale, `select * from kho.sale_mon_cua_don('SA-mon')`)
  ok('sale gọi OK, 3 món', smc.e===null && smc.r.length===3, smc.e||smc.r.length)
  const cols = smc.r ? Object.keys(smc.r[0]).join(',') : ''
  ok('KHÔNG có cột gia/tho', !/gia|tho/.test(cols), cols)
  const tac = (smc.r||[]).find(m=>m.ten==='Tủ tắc'), xong=(smc.r||[]).find(m=>m.ten==='Kệ xong'), jk=(smc.r||[]).find(m=>m.ten==='Bàn nhật ký')
  ok('món tắc (tao_luc -4d, dang_lam) → so_ngay_tac = 4', tac?.so_ngay_tac===4, String(tac?.so_ngay_tac))
  ok('món xong_sx → so_ngay_tac = 0', xong?.so_ngay_tac===0, String(xong?.so_ngay_tac))
  ok('món có nhật ký -5d → so_ngay_tac = 5 (dùng max luc)', jk?.so_ngay_tac===5, String(jk?.so_ngay_tac))
  ok('có trang_thai + ghi_chu + vat_lieu', tac?.trang_thai==='dang_lam' && tac?.ghi_chu==='ghi chú xưởng' && tac?.vat_lieu==='MDF17')
  ok('xuong gọi sale_mon_cua_don → CHẶN', /chỉ ceo\/sale/.test((await as(U.xuong,`select * from kho.sale_mon_cua_don('SA-mon')`)).e||''))
  ok('tho gọi → CHẶN', /chỉ ceo\/sale/.test((await as(U.tho,`select * from kho.sale_mon_cua_don('SA-mon')`)).e||''))

  console.log(`\n═══ ${P} PASS · ${F} FAIL ═══`)
} catch (e) { console.error('LỖI TEST:', e.message); F++ }
finally { await c.query('rollback').catch(()=>{}); await c.end(); process.exit(F?1:0) }
