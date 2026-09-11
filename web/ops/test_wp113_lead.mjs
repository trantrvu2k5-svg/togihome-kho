// TEST WP-113 lô A — nguồn lead (lead_luong + lead_ghi_lo carry-forward). MỘT transaction, ROLLBACK sạch.
//   Không chôn nguồn đã biết · moc_dang_ngo vẫn hạ mức · phân loại luồng · luong worker lạ bị bỏ · idempotent.
import pg from 'pg'; import { docConfig } from './conn.mjs'
const c = new pg.Client(await docConfig()); await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
const R=[]; const ok=(n,d)=>R.push(['✅',n,d]); const bad=(n,d)=>R.push(['❌',n,d]); const J=x=>JSON.stringify(x)
try {
  await c.query('begin')
  await c.query(`select set_config('kho.lead_he_thong','1',true)`)
  const base={page_id:'PT-113',thoi_diem_hoi_thoai:'2026-09-01T10:00:00+07',cham_cuoi_luc:'2026-09-01T10:00:00+07'}
  const gl=async o=>{ await q(`select kho.lead_ghi_lo($1)`,[JSON.stringify([o])]); return (await q(`select luong,muc_chac_chan m from kho.v_lead_hien_hanh where page_id=$1 and hoi_thoai_id=$2`,[o.page_id,o.hoi_thoai_id]))[0] }
  let r
  // lead_luong thuần
  r=(await q(`select kho.lead_luong('9',null,null) a, kho.lead_luong(null,'suy_ref',null) b, kho.lead_luong(null,null,'r') c, kho.lead_luong('9','suy_ref',null) d, kho.lead_luong(null,null,null) e`))[0]
  r.a==='mess_truc_tiep'&&r.b==='qua_web'&&r.c==='qua_web'&&r.d==='khong_biet'&&r.e==='khong_biet' ? ok('lead_luong 5 ca',J(r)) : bad('lead_luong',J(r))
  r=await gl({...base,hoi_thoai_id:'H1',ad_id:'123',muc_chac_chan:'xac_dinh'}); r.luong==='mess_truc_tiep'?ok('ad_id→mess',r.luong):bad('mess',J(r))
  r=await gl({...base,hoi_thoai_id:'H2',muc_chac_chan:'suy_ref'}); r.luong==='qua_web'?ok('suy_ref→qua_web',r.luong):bad('qua_web',J(r))
  r=await gl({...base,hoi_thoai_id:'H3',ad_id:'9',muc_chac_chan:'suy_ref'}); r.luong==='khong_biet'?ok('cả hai→khong_biet',r.luong):bad('conflict',J(r))
  r=await gl({...base,hoi_thoai_id:'H4',ad_id:'5',muc_chac_chan:'xac_dinh',luong:'RÁC'}); ['mess_truc_tiep','qua_web','khong_biet'].includes(r.luong)?ok('luong worker lạ bị bỏ',r.luong):bad('lạ',J(r))
  await q(`select kho.lead_ghi_lo($1)`,[JSON.stringify([{...base,hoi_thoai_id:'H5',ad_id:'7',muc_chac_chan:'xac_dinh'}])])
  r=await gl({...base,hoi_thoai_id:'H5',muc_chac_chan:'khong_biet',cham_cuoi_luc:'2026-09-01T11:00:00+07'}); r.m==='xac_dinh'?ok('khong_biet KHÔNG chôn xac_dinh',r.m):bad('chôn',J(r))
  await q(`select kho.lead_ghi_lo($1)`,[JSON.stringify([{...base,hoi_thoai_id:'H6',ad_id:'7',muc_chac_chan:'xac_dinh'}])])
  r=await gl({...base,hoi_thoai_id:'H6',muc_chac_chan:'khong_biet',moc_dang_ngo:true,cham_cuoi_luc:'2026-09-01T12:00:00+07'}); r.m==='khong_biet'?ok('moc_dang_ngo vẫn hạ mức',r.m):bad('ngờ',J(r))
  const g2=(await q(`select kho.lead_ghi_lo($1) j`,[JSON.stringify([{...base,hoi_thoai_id:'H1',ad_id:'123',muc_chac_chan:'xac_dinh'}])]))[0].j
  g2.ghi===0?ok('ghi lại cùng dữ liệu → không đổi',J(g2)):bad('idem',J(g2))
  // [db/258] máy khớp ghi suy_ref → luong=qua_web NGAY (mốc 2099 để cô lập khỏi lead/click thật)
  await q(`select kho.lead_ghi($1)`,[JSON.stringify({nguon:'pancake',page_id:'PT-KHOP-113',hoi_thoai_id:'HK',loai:'inbox',muc_chac_chan:'khong_biet',thoi_diem_hoi_thoai:'2099-09-05T00:00:00Z',cham_cuoi_luc:'2099-09-05T00:00:00Z'})])
  await q(`insert into kho.click_chat(kenh,dich,ref_web,la_bot,ghi_nhan_luc,ma_click,loai_ma_click) values('messenger','messenger','https://x',false,'2099-09-04T23:55:00Z','MC1','fbclid')`)
  await q(`select kho.khop_click_lead('2099-09-01T00:00:00Z','2099-09-10T00:00:00Z')`)
  r=(await q(`select luong,muc_chac_chan m from kho.v_lead_hien_hanh where page_id='PT-KHOP-113' and hoi_thoai_id='HK'`))[0];
  const khopOk = r && r.m==='suy_ref' && r.luong==='qua_web'
  khopOk ? ok('khop ghi suy_ref→luong=qua_web ngay',J(r)) : bad('khop luong',J(r))
  await c.query('rollback')
} catch(e){ R.push(['❌','LỖI',e.message.split('\n')[0]]); await c.query('rollback').catch(()=>{}) }
finally {
  console.log('╔══ TEST WP-113 lô A — nguồn lead (ROLLBACK) ══╗')
  for(const[s,n,d]of R)console.log(`  ${s} ${n}${d?' — '+d:''}`)
  const f=R.filter(r=>r[0]==='❌').length
  console.log(`╚══ ${R.filter(r=>r[0]==='✅').length} PASS · ${f} FAIL ══╝`)
  await c.end(); process.exit(f?1:0)
}
