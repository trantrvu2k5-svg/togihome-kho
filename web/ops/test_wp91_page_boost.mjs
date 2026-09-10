// TEST WP-91 N-13 — vá page_id cho quảng cáo boost bài. IN-MEMORY (stub client + fetchFn), KHÔNG chạm DB.
// Ca A: có oss.page_id → giữ nguyên (chống hồi quy). Ca B: boost bài (oss null, story "<page>_<post>") → page trước "_".
// Ca C: chuỗi lạ → null + PHẢI kêu lên (canhBaoPage). Chứng minh đỏ: logic CŨ (chỉ oss) làm Ca B ra null.
import { pageTuCreative, keoMauAdsMeta } from './keo_mau_ads_meta.mjs'
const R=[]; const ok=(n,d)=>R.push(['✅',n,d]); const bad=(n,d)=>R.push(['❌',n,d])

// ── creative giả cho 3 ca ──
const CR = {
  A: { id:'crA', object_story_spec:{ page_id:'111000111' }, object_type:'SHARE' },                                  // QC thường
  B: { id:'crB', object_story_spec:{}, effective_object_story_id:'222000222_98765', object_type:'STATUS' },          // boost bài
  C: { id:'crC', object_story_spec:{}, effective_object_story_id:'chuoi-la-khong-gach', object_type:'STATUS' },      // lạ
}

// ── vế thuần: pageTuCreative ──
{ const p=pageTuCreative(CR.A); p==='111000111'?ok('Ca A pure (giữ oss.page_id)',p):bad('Ca A pure',`ra ${p}`) }
{ const p=pageTuCreative(CR.B); p==='222000222'?ok('Ca B pure (tách từ story_id)',p):bad('Ca B pure',`ra ${p}`) }
{ const p=pageTuCreative(CR.C); p===null?ok('Ca C pure (chuỗi lạ → null)','null'):bad('Ca C pure',`ra ${p}`) }

// ── CHỨNG MINH ĐỎ: logic CŨ (chỉ oss.page_id) → Ca B ra null (bệnh cũ) ──
{ const cu = cr => (cr.object_story_spec||{}).page_id || null
  const pCu=cu(CR.B), pMoi=pageTuCreative(CR.B)
  if (pCu===null && pMoi==='222000222') ok('CHỨNG MINH ĐỎ', `logic CŨ Ca B = null (ĐỎ) · logic MỚI = 222000222 — bẻ vá ra là test bắt được`)
  else bad('CHỨNG MINH ĐỎ', `cũ=${pCu} mới=${pMoi} — không chứng minh được`) }

// ── vế tích hợp: chạy keoMauAdsMeta với stub → assert canhBaoPage KÊU LÊN ở Ca C ──
const fakeAds=[{ad_id:'A',act_id:'act1'},{ad_id:'B',act_id:'act1'},{ad_id:'C',act_id:'act1'}]
let ghiPayload=null
const client={ query: async(sql,params)=>{
  if(/ads_moc_keo_ghi/.test(sql)) return { rows:[{g:{id:1}}] }
  if(/select distinct ad_id/.test(sql)) return { rows: fakeAds }
  if(/ads_mau_ghi/.test(sql)){ ghiPayload=JSON.parse(params[0]); return { rows:[{n: ghiPayload.length}] } }
  return { rows:[] }   // begin/commit/set_config/khác
}}
const fetchFn=async(url)=>{
  const m=url.match(/v21\.0\/([ABC])\?/); if(m) return { json: async()=>({ creative: CR[m[1]] }) }
  return { json: async()=>({ data: [] }) }   // /adimages, /me/accounts
}
let warned=null; const origWarn=console.warn; console.warn=(...a)=>{ warned=a.join(' ') }
let res
try { res = await keoMauAdsMeta(client, { token:'x', fetchFn }) } finally { console.warn=origWarn }

const byCid = Object.fromEntries((ghiPayload||[]).map(m=>[m.creative_id,m]))
byCid.crA?.page_id==='111000111' ? ok('Ca A tích hợp (ghi đúng oss)', 'crA→111000111') : bad('Ca A tích hợp', JSON.stringify(byCid.crA?.page_id))
byCid.crB?.page_id==='222000222' ? ok('Ca B tích hợp (boost → page tách)', 'crB→222000222') : bad('Ca B tích hợp', JSON.stringify(byCid.crB?.page_id))
byCid.crC?.page_id==null ? ok('Ca C tích hợp (null)', 'crC→null') : bad('Ca C tích hợp', JSON.stringify(byCid.crC?.page_id))
const keu = (res.canhBaoPage||[]).some(x=>x.ad_id==='C')
keu ? ok('Ca C KÊU LÊN', `canhBaoPage có ad C: ${JSON.stringify(res.canhBaoPage)}`) : bad('Ca C KÊU LÊN', 'không có cảnh báo cho ad C')
warned && /KHÔNG tách được page_id/.test(warned) ? ok('Ca C dòng cảnh báo IN RA', warned.slice(0,90)) : bad('Ca C dòng cảnh báo', `console.warn: ${warned}`)

console.log('\n╔══ TEST WP-91 N-13 — page_id boost bài (in-memory, không chạm DB) ══╗')
for(const [s,n,d] of R) console.log(`  ${s} ${n}${d?'  —  '+d:''}`)
const fail=R.filter(r=>r[0]==='❌').length
console.log(`╚══ ${R.filter(r=>r[0]==='✅').length} PASS · ${fail} FAIL ══╝`)
process.exit(fail?1:0)
