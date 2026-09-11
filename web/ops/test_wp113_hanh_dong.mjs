// TEST WP-113 lô 2C — bocHanhDong (đọc 5 số hành động) + dry-run Meta (KHÔNG ghi DB).
import { readFileSync } from 'node:fs'
import { bocHanhDong } from './keo_chi_ads_meta.mjs'
const R=[]; const ok=(n,d)=>R.push(['✅',n,d]); const bad=(n,d)=>R.push(['❌',n,d]); const J=x=>JSON.stringify(x)
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b)

// ── [3a] UNIT — fixture theo hình response THẬT (đã bỏ token) ──
// Ca 1: có action + outbound → lấy đúng
{ const r={ inline_link_clicks:100, actions:[{action_type:'landing_page_view',value:'30'},
  {action_type:'onsite_conversion.messaging_conversation_started_7d',value:'5'},
  {action_type:'offsite_conversion.fb_pixel_lead',value:'8'},
  {action_type:'offsite_conversion.fb_pixel_purchase',value:'2'}], outbound_clicks:[{action_type:'outbound_click',value:'40'}] }
  const g=bocHanhDong(r)
  eq(g,{luot_vao_trang:30,bam_ra_web:40,cuoc_tro_chuyen:5,lien_he_pixel:8,mua_pixel:2,kiem_dang:'du'})?ok('Ca1 có đủ',J(g)):bad('Ca1',J(g)) }
// Ca 2: mảng có nhưng THIẾU action_type → 0
{ const g=bocHanhDong({inline_link_clicks:10, actions:[{action_type:'post_reaction',value:'9'}], outbound_clicks:[]});
  (g.luot_vao_trang===0&&g.bam_ra_web===0&&g.cuoc_tro_chuyen===0&&g.kiem_dang==='du')?ok('Ca2 thiếu type→0',J(g)):bad('Ca2',J(g)) }
// Ca 3: THIẾU HẲN khoá actions + inline=0 → tất cả 0
{ const g=bocHanhDong({inline_link_clicks:0})
  eq(g,{luot_vao_trang:0,bam_ra_web:0,cuoc_tro_chuyen:0,lien_he_pixel:0,mua_pixel:0,kiem_dang:'du'})?ok('Ca3 thiếu khoá+0click→0',J(g)):bad('Ca3',J(g)) }
// Ca 4: THIẾU HẲN khoá actions + inline>0 → LẠ (NULL, kiem_dang='la')
{ const g=bocHanhDong({inline_link_clicks:50});
  (g.luot_vao_trang===null&&g.mua_pixel===null&&g.kiem_dang==='la')?ok('Ca4 thiếu khoá+click→LẠ',J(g)):bad('Ca4',J(g)) }
// Ca 5: KHÔNG cộng lead lồng nhau — nhiều loại lead, chỉ lấy fb_pixel_lead
{ const r={inline_link_clicks:5, actions:[{action_type:'offsite_conversion.fb_pixel_lead',value:'8'},
  {action_type:'onsite_web_lead',value:'8'},{action_type:'lead',value:'8'},{action_type:'onsite_conversion.lead',value:'8'}]}
  const g=bocHanhDong(r)
  g.lien_he_pixel===8?ok('Ca5 KHÔNG cộng lead lồng (=8, không 32)',J(g.lien_he_pixel)):bad('Ca5',J(g)) }

console.log('╔══ [3a] UNIT bocHanhDong ══╗')
for(const[s,n,d]of R)console.log(`  ${s} ${n}${d?' — '+d:''}`)
console.log(`╚══ ${R.filter(r=>r[0]==='✅').length} PASS · ${R.filter(r=>r[0]==='❌').length} FAIL ══╝`)

// ── [3b][3c] DRY-RUN Meta (KHÔNG ghi DB — chỉ GET + parse) ──
if(process.argv.includes('--dry')){
  const { createRequire } = await import('module'); const require=createRequire('/Users/vuquanghai/Documents/togihome-kho/web/'); const pg=require('pg')
  const { docConfig } = await import('./conn.mjs')
  const { layTaiKhoan, layInsightsChienDich, CAPI_V } = await import('./keo_chi_ads_meta.mjs')
  const env=readFileSync('/Users/vuquanghai/Documents/togihome-kho/.env','utf8')
  const token=(env.split('\n').find(l=>l.startsWith('META_CAPI_TOKEN='))||'').split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'')
  if(!token){ console.log('\n[3b/3c] BỎ QUA — không thấy META_CAPI_TOKEN trong .env'); process.exit(R.some(r=>r[0]==='❌')?1:0) }
  const B='https://graph.facebook.com/'+CAPI_V, enc=encodeURIComponent
  const NGAY=process.argv[process.argv.indexOf('--dry')+1]||'2026-09-09'
  const range={since:NGAY,until:NGAY}
  // TK = hợp /me/adaccounts ∪ act_id trong chi_ads_ngay (giống keoChiAdsMeta)
  const c=new pg.Client(await docConfig()); await c.connect(); await c.query('set default_transaction_read_only=on')
  const metaAccts=await layTaiKhoan(fetch, token)
  const map=new Map(metaAccts.map(a=>[a.act_id,a]))
  for(const r of (await c.query(`select distinct act_id from kho.chi_ads_ngay where act_id is not null`)).rows)
    if(!map.has(r.act_id)) map.set(r.act_id,{act:'act_'+r.act_id,act_id:r.act_id})
  await c.end()
  const accts=[...map.values()]
  const tot={luot_vao_trang:0,bam_ra_web:0,cuoc_tro_chuyen:0,lien_he_pixel:0,mua_pixel:0}; let la=0; const camps=[]
  for(const a of accts){
    let rows; try{ rows=await layInsightsChienDich(fetch, token, a.act, range) }catch(e){ continue }
    for(const r of rows){ const g=bocHanhDong(r); if(g.kiem_dang==='la')la++
      for(const k of Object.keys(tot)) tot[k]+=(g[k]||0)
      camps.push({act:a.act, ten:r.campaign_name, g}) }
  }
  console.log('\n[3b] DRY '+NGAY+' · '+accts.length+' TK · '+camps.length+' chiến dịch')
  console.log('   Σ 5 cột:',J(tot),'· dòng LẠ:',la)
  for(const cd of camps.filter(x=>x.g.kiem_dang==='du').slice(0,3))
    console.log('   '+(cd.ten||'').slice(0,30)+' → '+J(cd.g))
  // [3c] đối chiếu: cộng CẤP AD (xin actions) vs CẤP CHIẾN DỊCH, theo từng TK có dữ liệu
  console.log('[3c] đối chiếu Σ ad-level vs Σ campaign-level (cột luot_vao_trang):')
  const actsCoData=[...new Set(camps.filter(x=>x.g.kiem_dang==='du').map(x=>x.act))].slice(0,3)
  if(!actsCoData.length) console.log('   (ngày '+NGAY+' không TK nào có dòng chi — bỏ đối chiếu)')
  for(const act of actsCoData){
    const cdSum=camps.filter(x=>x.act===act).reduce((s,x)=>s+(x.g.luot_vao_trang||0),0)
    let url=`${B}/${act}/insights?level=ad&time_range=${enc(JSON.stringify(range))}&fields=ad_id,inline_link_clicks,actions,outbound_clicks&limit=500&access_token=${enc(token)}`
    let adSum=0; try{ for(let p=0;url&&p<40;p++){ const j=await (await fetch(url)).json(); if(j.error)break
        for(const r of (j.data||[])) adSum+=(bocHanhDong(r).luot_vao_trang||0); url=j.paging&&j.paging.next } }catch(e){ adSum='LỖI' }
    const khop = adSum===cdSum
    ;(typeof adSum==='number'? (khop?ok:bad) : bad)('3c '+act+' ad='+adSum+' cd='+cdSum, khop?'khớp':'LỆCH')
    console.log('   '+act+': ad-sum='+adSum+' · campaign-sum='+cdSum+(khop?' ✓ khớp':' ✗ LỆCH'))
  }
  console.log(`\n═══ ${R.filter(r=>r[0]==='✅').length} PASS · ${R.filter(r=>r[0]==='❌').length} FAIL ═══`)
}
process.exit(R.some(r=>r[0]==='❌')?1:0)
