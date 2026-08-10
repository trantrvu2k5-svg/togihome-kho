// TEST CẮN — 043 quản đốc: viec_uu_tien 5 luật · gap guard · mau_moi loại doanh thu · kanban · can_ceo_quyet.
//   Áp 042+043 trong tx rồi ROLLBACK. DB_HOST=… DB_PASS=… node ops/test_043.mjs
import { readFileSync } from 'fs'; import pg from 'pg'; import { docConfig } from './conn.mjs'
const strip=s=>s.split('\n').filter(l=>!/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n')
const sql42=strip(readFileSync(new URL('../../db/042_ghi_vet_thoi_gian.sql',import.meta.url),'utf8'))
const sql43=strip(readFileSync(new URL('../../db/043_quan_doc.sql',import.meta.url),'utf8'))
const U={ceo:'205a887e-ae8b-42de-86ff-4eb8afa140a6',sale:'c5a34ba9-9d25-4bd2-8bb6-909a2211ddf8',xuong:'f9592cfe-4325-4750-87ca-eb7a9b4925bb'}
const c=new pg.Client({...(await docConfig())});await c.connect()
let P=0,F=0;const ok=(n,cc,e='')=>{console.log((cc?'✅':'❌')+' '+n+(e?'  — '+e:''));cc?P++:F++}
async function as(uid,q,a=[],keep=false){await c.query('savepoint s');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})]);let r=null,e=null;try{r=(await c.query(q,a)).rows;if(keep)await c.query('release savepoint s')}catch(x){e=x.message;try{await c.query('rollback to savepoint s')}catch(_){}}if(!keep&&!e)await c.query('rollback to savepoint s');await c.query('reset role');await c.query("select set_config('request.jwt.claims','',true)");return{r,e}}
try{
  await c.query('begin')
  // 042 đã ở prod; áp lại trong tx idempotent (create or replace / if not exists)
  await c.query(sql42); await c.query(sql43)
  await c.query(`update kho.nguoi_dung set dang_hoat_dong=true where auth_uid=$1`,[U.xuong])
  // dọn đơn test cũ
  await c.query(`select set_config('moc.auto_xong','1',true)`)
  await c.query(`delete from kho.don_hang where ma_don like 'QD-%'`)
  // seed 6 đơn (chèn trực tiếp -> không qua vai gate). loai_check nay có mau_moi.
  const mk=async(ma,tt,loai,henOffset,gap)=>{
    const hen = henOffset===null?null:`current_date + ${henOffset}`
    const id=(await c.query(`insert into kho.don_hang(ma_don,dong,loai,trang_thai,ngay_chot,ngay_hen_khach${gap?',danh_dau_gap,ly_do_gap':''}) values($1,'le',$2,$3,current_date-10,${hen}${gap?",true,'khách VIP'":''}) returning id`,[ma,loai,tt])).rows[0].id
    return id
  }
  const monIns=async(don,ten,tt,ngayTruoc=0)=> await c.query(`insert into kho.don_hang_mon(don_id,ten,trang_thai,tao_luc) values($1,$2,$3, now()-($4||' days')::interval)`,[don,ten,tt,ngayTruoc])
  const D1=await mk('QD-1-quahan','cho_cat','le_sang',-2,false);   await monIns(D1,'Tủ quá hạn','cho_cat')
  const D2=await mk('QD-2-gap','da_cat','le_sang',10,true);        await monIns(D2,'Tủ gấp','da_cat')
  const D3=await mk('QD-3-dungyen','dang_lam','le_sang',10,false); await monIns(D3,'Tủ đứng yên','dang_lam',4)
  const D4=await mk('QD-4-thuong-gan','cho_cat','le_sang',2,false);await monIns(D4,'Tủ gần hạn','cho_cat')
  const D5=await mk('QD-5-thuong-xa','cho_cat','le_sang',8,false); await monIns(D5,'Tủ xa hạn','cho_cat')
  const D6=await mk('QD-6-maumoi','cho_cat','mau_moi',null,false); await monIns(D6,'Mẫu mới','cho_cat')

  console.log('── C3. viec_uu_tien xếp đúng 5 luật ──')
  const vt=await as(U.xuong,`select ma_don,rank_uu_tien,ly_do from kho.viec_uu_tien() where ma_don like 'QD-%'`)
  const order=(vt.r||[]).map(x=>x.ma_don)
  ok('thứ tự = D1(quá hạn)·D2(gấp)·D3(đứng yên)·D4(gần)·D5(xa)·D6(mẫu mới)',
     JSON.stringify(order)===JSON.stringify(['QD-1-quahan','QD-2-gap','QD-3-dungyen','QD-4-thuong-gan','QD-5-thuong-xa','QD-6-maumoi']), JSON.stringify(order))
  const rk=Object.fromEntries((vt.r||[]).map(x=>[x.ma_don,x.rank_uu_tien]))
  ok('rank: 1,2,3,4,4,5', rk['QD-1-quahan']===1&&rk['QD-2-gap']===2&&rk['QD-3-dungyen']===3&&rk['QD-4-thuong-gan']===4&&rk['QD-5-thuong-xa']===4&&rk['QD-6-maumoi']===5, JSON.stringify(rk))
  ok('lý do là CHỮ có nghĩa (D1 nói "Quá hạn")', /Quá hạn/.test((vt.r||[]).find(x=>x.ma_don==='QD-1-quahan')?.ly_do||''))
  ok('sale gọi viec_uu_tien → CHẶN', /chỉ ceo\/xuong/.test((await as(U.sale,`select * from kho.viec_uu_tien()`)).e||''))

  console.log('\n── C2. đánh dấu gấp: bắt buộc lý do + vai ──')
  ok('gấp KHÔNG lý do → CHẶN', /BẮT BUỘC có lý do/.test((await as(U.ceo,`update kho.don_hang set danh_dau_gap=true, ly_do_gap='' where id=$1`,[D4])).e||''))
  ok('sale đánh dấu gấp (có lý do) → CHẶN', /chỉ ceo\/xuong/.test((await as(U.sale,`update kho.don_hang set danh_dau_gap=true, ly_do_gap='x' where id=$1`,[D4])).e||''))
  ok('ceo đánh dấu gấp có lý do → OK (bắt ma_ns + luc)', (await as(U.ceo,`update kho.don_hang set danh_dau_gap=true, ly_do_gap='gấp thật' where id=$1`,[D4],true)).e===null && (await c.query(`select ma_ns_danh_dau,gap_luc from kho.don_hang where id=$1`,[D4])).rows[0].ma_ns_danh_dau!==null)
  console.log('── [CẮN] bỏ trigger gấp → gấp không lý do LỌT (ĐỎ) ──')
  await c.query('savepoint ng'); await c.query('drop trigger trg_chan_gap_khong_ly_do on kho.don_hang')
  await c.query(`select set_config('chan.off_vai','1',false)`)
  let e_ng=null;try{await c.query(`update kho.don_hang set danh_dau_gap=true, ly_do_gap='' where id=$1`,[D5])}catch(x){e_ng=x.message}
  await c.query(`select set_config('chan.off_vai','',false)`)
  ok('[CẮN] không trigger → gấp không lý do LỌT (ĐỎ)', e_ng===null)
  await c.query('rollback to savepoint ng')

  console.log('\n── C1. mau_moi loại khỏi doanh thu (avg gcg) ──')
  await c.query(`update kho.don_hang set ma_ky_ap_dung='2099-09' where ma_don in ('QD-1-quahan','QD-6-maumoi')`)
  await c.query(`insert into kho.don_hang_gia_von(ma_don,gia_chuyen_giao) values('QD-1-quahan',1000000),('QD-6-maumoi',9000000) on conflict (ma_don) do update set gia_chuyen_giao=excluded.gia_chuyen_giao`)
  const avgLoc=(await c.query(`select avg(g.gia_chuyen_giao)::int a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='2099-09' and d.loai is distinct from 'mau_moi'`)).rows[0].a
  const avgAll=(await c.query(`select avg(g.gia_chuyen_giao)::int a from kho.don_hang_gia_von g join kho.don_hang d on d.ma_don=g.ma_don where d.ma_ky_ap_dung='2099-09'`)).rows[0].a
  ok('CÓ loại: avg gcg = 1.000.000 (chỉ đơn thật)', Number(avgLoc)===1000000, 'avg='+avgLoc)
  ok('[CẮN] chưa loại: avg = 5.000.000 (mẫu mới kéo lệch — ĐỎ)', Number(avgAll)===5000000, 'avg='+avgAll)

  console.log('\n── Kanban: đơn 6 món (3 da_cat, 3 cho_cat) → cột "Chờ cắt", 3/6 ──')
  const D7=await mk('QD-7-kanban','cho_cat','le_sang',5,false)
  for(let i=0;i<3;i++) await monIns(D7,'món cắt '+i,'da_cat')
  for(let i=0;i<3;i++) await monIns(D7,'món chờ '+i,'cho_cat')
  const tt=(await as(U.ceo,`select kho.trang_thai_don_tu_mon($1) v`,[D7])).r?.[0]?.v
  ok('cột = bước chậm nhất = cho_cat (Chờ cắt)', tt==='cho_cat', String(tt))
  const cnt=(await c.query(`select count(*) filter (where trang_thai<>'cho_cat')::int qua, count(*)::int tong from kho.don_hang_mon where don_id=$1`,[D7])).rows[0]
  ok('"3/6 món" (3 đã qua chờ cắt / 6 tổng)', Number(cnt.qua)===3 && Number(cnt.tong)===6, JSON.stringify(cnt))
  const kb=await as(U.xuong,`select ma_don,cot,so_mon_qua,so_mon_tong,la_tre,la_gap,la_mau_moi from kho.kanban_xuong() where ma_don like 'QD-%'`)
  const k7=(kb.r||[]).find(x=>x.ma_don==='QD-7-kanban')
  ok('kanban_xuong: QD-7 ở cột cho_cat, 3/6, cờ đúng', k7 && k7.cot==='cho_cat' && Number(k7.so_mon_qua)===3 && Number(k7.so_mon_tong)===6, JSON.stringify(k7))
  const k6=(kb.r||[]).find(x=>x.ma_don==='QD-6-maumoi')
  ok('kanban_xuong: QD-6 la_mau_moi=true; QD-1 la_tre=true', k6?.la_mau_moi===true && (kb.r||[]).find(x=>x.ma_don==='QD-1-quahan')?.la_tre===true)
  ok('sale gọi kanban_xuong → CHẶN', /chỉ ceo\/xuong/.test((await as(U.sale,`select * from kho.kanban_xuong()`)).e||''))

  console.log('\n── C4. can_ceo_quyet: 2 đơn quá hạn cùng tổ → khối đỏ ──')
  // D1 quá hạn (tổ CNC). Thêm QD-1b quá hạn cùng tổ.
  const D1b=await mk('QD-1b-quahan','cho_cat','le_sang',-3,false); await monIns(D1b,'Tủ quá hạn 2','cho_cat')
  const cq=await as(U.ceo,`select loai_tinh_huong, mo_ta from kho.can_ceo_quyet()`)
  ok('2 đơn quá hạn cùng tổ → có tình huống "hai_qua_han_mot_to"', (cq.r||[]).some(x=>x.loai_tinh_huong==='hai_qua_han_mot_to'), JSON.stringify(cq.r))
  ok('có tình huống "gap_chen_don_tre" (có gấp + có quá hạn)', (cq.r||[]).some(x=>x.loai_tinh_huong==='gap_chen_don_tre'))
  // bỏ D1b -> chỉ 1 quá hạn -> hết tình huống hai_qua_han
  await c.query(`delete from kho.don_hang where ma_don='QD-1b-quahan'`)
  const cq2=await as(U.ceo,`select loai_tinh_huong from kho.can_ceo_quyet()`)
  ok('1 đơn quá hạn → KHÔNG còn "hai_qua_han_mot_to"', !(cq2.r||[]).some(x=>x.loai_tinh_huong==='hai_qua_han_mot_to'))

  console.log(`\n== KẾT 043: ${P} pass / ${F} fail ==`)
  await c.query('rollback')
}catch(e){console.error('LỖI:',e.message);F++;try{await c.query('rollback')}catch(_){}}
finally{await c.end();process.exit(F?1:0)}
