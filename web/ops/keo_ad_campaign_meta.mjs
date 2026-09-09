// keo_ad_campaign_meta — WP-108 nhịp 1: kéo ad_id → campaign_id (+ name) từ Meta vào kho.ads_ad_campaign.
//   Nguồn ad: mọi ad_id trong chi_ads_ngay. GHI qua GUC kho.meta_he_thong + ads_ad_campaign_ghi (client ghi 0).
//   Token ROOT .env (META_CAPI_TOKEN) — CẤM in token. Standalone: node ops/keo_ad_campaign_meta.mjs
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { docConfig } from './conn.mjs'
const B = 'https://graph.facebook.com/v21.0'
const j = x => JSON.stringify(x)

function docToken() {
  const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  const m = env.split('\n').find(l => l.startsWith('META_CAPI_TOKEN='))
  const t = m ? m.slice('META_CAPI_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : ''
  if (!t) { console.error('THIẾU META_CAPI_TOKEN ở ROOT .env'); process.exit(2) }
  return t
}

export async function keoAdCampaignMeta(client, opts = {}) {
  const token = opts.token || docToken()
  const fetchFn = opts.fetchFn || fetch
  const ads = (await client.query(`select distinct ad_id, act_id from kho.chi_ads_ngay where ad_id is not null`)).rows
  const rows = [], loi = []
  for (const { ad_id, act_id } of ads) {
    try {
      const r = await fetchFn(`${B}/${ad_id}?fields=campaign{id,name}&access_token=${encodeURIComponent(token)}`)
      const jr = await r.json()
      if (jr.error) { loi.push({ ad_id, loi: (jr.error.message || '').slice(0, 100) }); continue }
      const cid = jr.campaign && jr.campaign.id
      if (!cid) { loi.push({ ad_id, loi: 'không có campaign' }); continue }
      rows.push({ ad_id, campaign_id: cid, campaign_name: (jr.campaign && jr.campaign.name) || null, tai_khoan_id: act_id || null })
    } catch (e) { loi.push({ ad_id, loi: String(e.message).slice(0, 100) }) }
  }
  let n = 0
  if (rows.length) {
    await client.query('begin')
    try {
      await client.query(`select set_config('kho.meta_he_thong','1',true)`)
      n = (await client.query('select kho.ads_ad_campaign_ghi($1::jsonb) n', [j(rows)])).rows[0].n
      await client.query('commit')
    } catch (e) { await client.query('rollback').catch(() => {}); throw e }
  }
  console.log(`ad→campaign XONG · ${ads.length} ad · ghi ${n} · lỗi ${loi.length}`)
  return { tongAd: ads.length, ghi: n, loi }
}

if (process.argv[1] && process.argv[1].endsWith('keo_ad_campaign_meta.mjs')) {
  const c = new pg.Client(await docConfig()); await c.connect()
  try { const r = await keoAdCampaignMeta(c, {}); if (r.loi.length) console.log('LỖI:', JSON.stringify(r.loi.slice(0, 5))) }
  catch (e) { console.error('LỖI:', e.message); process.exitCode = 1 }
  finally { await c.end() }
}
