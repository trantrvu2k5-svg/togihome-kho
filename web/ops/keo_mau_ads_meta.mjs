// keo_mau_ads_meta — WP-103: kéo CREATIVE (mẫu QC) của MỌI ad trong chi_ads_ngay → upsert ads_mau + ads_mau_ad.
//   Khuôn giống keo_chi_ads_meta: moc ads_moc_keo_ghi (đèn trễ) · GHI qua GUC kho.meta_he_thong + ads_mau_ghi.
//   Token ROOT .env (META_CAPI_TOKEN) — CẤM in token. Ảnh/video CHỈ URL Meta (ghi đè mỗi vòng, URL có hạn).
//   Gọi từ runner chay_keo_ads.mjs (--only=E) — KHÔNG đẻ cron thứ hai.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { docConfig } from './conn.mjs'

const CAPI_V = 'v21.0'
const B = 'https://graph.facebook.com/' + CAPI_V
const CR = 'creative{id,name,title,body,call_to_action_type,object_story_spec,effective_object_story_id,instagram_permalink_url,image_url,thumbnail_url,video_id,object_type}'
const j = x => JSON.stringify(x)

// ⚠ HẠN TOKEN META_CAPI_TOKEN: token user 60 ngày, hết hạn là bộ kéo đứng câm. NGÀY HẾT HẠN = MỘT CHỖ DUY NHẤT:
//   kho.tham_so_van_hanh (ma='meta_token_han', epoch giây) — đèn màn "Việc phải làm" đọc qua RPC meta_token_trang_thai (L-108-7).
//   Thay token thì SỬA NGÀY Ở ĐÓ, đừng viết cứng ở đây.
function docToken() {
  const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')   // ROOT togihome-kho/.env
  const m = env.split('\n').find(l => l.startsWith('META_CAPI_TOKEN='))
  const t = m ? m.slice('META_CAPI_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : ''
  if (!t) { console.error('THIẾU META_CAPI_TOKEN ở ROOT .env'); process.exit(2) }
  return t
}

// [WP-91 N-13] page_id của mẫu: ƯU TIÊN object_story_spec.page_id; quảng cáo BOOST BÀI (STATUS/VIDEO) để ô đó NULL,
//   page thật nằm ở effective_object_story_id dạng "<page>_<post>" → lấy phần trước "_". Không tách được → null (gọi kêu lên).
export function pageTuCreative(cr) {
  const oss = cr.object_story_spec || {}
  if (oss.page_id) return oss.page_id
  const eff = cr.effective_object_story_id
  if (eff && String(eff).includes('_')) { const p = String(eff).split('_')[0]; if (p) return p }
  return null
}

// bóc mẫu từ creative Meta (page_id qua pageTuCreative: oss.page_id → fallback effective_object_story_id; video_id top-level rồi video_data)
function bocMau(ad_id, act_id, cr) {
  const oss = cr.object_story_spec || {}
  return {
    mau: {
      creative_id: cr.id || null, ten: cr.name || null, tieu_de: cr.title || null, body: cr.body || null,
      nut: cr.call_to_action_type || null, dinh_dang: cr.object_type || null,
      page_id: pageTuCreative(cr), story_id: cr.effective_object_story_id || null,
      ig_link: cr.instagram_permalink_url || null, anh_url: cr.image_url || null,
      thumbnail_url: cr.thumbnail_url || null,
      video_id: cr.video_id || (oss.video_data && oss.video_data.video_id) || null,
      anh_net_url: null,   // điền ở bước adimages (image_hash → url 1440px); SHARE/không hash → giữ null
      anh_dai_url: [],     // [WP-107 L-1c] mảng url ảnh cho mẫu XOAY VÒNG (thẻ con)
      tho: cr   // NGUYÊN VĂN
    },
    ad: { creative_id: cr.id || null, ad_id, tai_khoan_id: act_id || null },
    hash: (oss.video_data && oss.video_data.image_hash) || (oss.link_data && oss.link_data.image_hash) || null,   // [WP-107] ảnh nét qua /adimages · [L-108-7] +link_data (ảnh đơn)
    childHashes: (((oss.link_data && oss.link_data.child_attachments) || []).map(x => x.image_hash).filter(Boolean))   // [WP-107 L-1c] dải xoay vòng
  }
}

export async function keoMauAdsMeta(client, opts = {}) {
  const token = opts.token || docToken()
  const fetchFn = opts.fetchFn || fetch
  const t0 = Date.now()
  const hom = new Date().toISOString().slice(0, 10)
  const ghi = (hd, nguon = null, id = null, so = null, loi = null) =>
    client.query('select kho.ads_moc_keo_ghi($1,$2,$3,$4,$5::date,$6::date,$7) g', [hd, nguon, id, so, hom, hom, loi])

  // MỞ lượt (khoá chống chồng). Bị chặn → thoát ÊM.
  let idMoc
  try { idMoc = (await ghi('mo', 'meta_mau')).rows[0].g.id }
  catch (e) {
    if (/đang chạy|chặn lượt trùng/.test(e.message)) { console.log('ads-mau: đang có lượt chạy, bỏ qua.'); return { skip: 'khoa' } }
    throw e
  }
  try {
    const ads = (await client.query('select distinct ad_id, act_id from kho.chi_ads_ngay where ad_id is not null')).rows
    const mauMap = new Map(), adRows = [], loi = [], hashMap = new Map(), childMap = new Map(), canhBaoPage = []
    let keoDuoc = 0
    for (const { ad_id, act_id } of ads) {
      try {
        const r = await fetchFn(`${B}/${ad_id}?fields=${encodeURIComponent(CR)}&access_token=${encodeURIComponent(token)}`)
        const jr = await r.json()
        if (jr.error) { loi.push({ ad_id, loi: (jr.error.message || '').slice(0, 120) }); continue }
        const cr = jr.creative
        if (!cr || !cr.id) { loi.push({ ad_id, loi: 'không có creative' }); continue }
        keoDuoc++
        const { mau, ad, hash, childHashes } = bocMau(ad_id, act_id, cr)
        mauMap.set(mau.creative_id, mau)   // dedup theo creative_id (một creative nhiều ad)
        // [WP-91 N-13] KÊU LÊN khi không tách được page_id (cấm ghi NULL im lặng — luật ngưỡng-không-dự-phòng-im-lặng)
        if (!mau.page_id) canhBaoPage.push({ ad_id, creative_id: mau.creative_id, story_id_tho: cr.effective_object_story_id || null, dinh_dang: cr.object_type || null })
        adRows.push(ad)
        if (hash && act_id && !hashMap.has(mau.creative_id)) hashMap.set(mau.creative_id, { hash, act: act_id })
        if (childHashes.length && act_id && !childMap.has(mau.creative_id)) childMap.set(mau.creative_id, { hashes: childHashes, act: act_id })
      } catch (e) { loi.push({ ad_id, loi: String(e.message).slice(0, 120) }) }
    }
    // [WP-107] ẢNH NÉT: object_story_spec.video_data.image_hash → /act_{act}/adimages url 1440px
    //   (thumbnail_url chỉ 64px, phóng lên vỡ). URL fbcdn có hạn → ghi đè mỗi vòng. Lỗi/không hash → giữ null → UI ô xám.
    let anhNet = 0
    for (const [cid, { hash, act }] of hashMap) {
      try {
        const jr = await fetchFn(`${B}/act_${act}/adimages?hashes=${encodeURIComponent(JSON.stringify([hash]))}&fields=url&access_token=${encodeURIComponent(token)}`)
        const jj = await jr.json()
        const url = jj && jj.data && jj.data[0] && jj.data[0].url
        if (url && mauMap.has(cid)) { mauMap.get(cid).anh_net_url = url; anhNet++ }
      } catch (e) { /* giữ null */ }
    }
    // [WP-107 L-1c] ẢNH XOAY VÒNG: kéo CẢ DẢI thẻ con (child image_hash) → mảng url. Ảnh đầu cũng thành anh_net_url.
    let anhDai = 0
    for (const [cid, { hashes, act }] of childMap) {
      try {
        const jr = await fetchFn(`${B}/act_${act}/adimages?hashes=${encodeURIComponent(JSON.stringify(hashes))}&fields=hash,url&access_token=${encodeURIComponent(token)}`)
        const jj = await jr.json()
        const byHash = {}; for (const d of (jj.data || [])) if (d.hash) byHash[d.hash] = d.url
        const urls = hashes.map(h => byHash[h]).filter(Boolean)   // giữ ĐÚNG thứ tự thẻ con
        if (urls.length && mauMap.has(cid)) {
          mauMap.get(cid).anh_dai_url = urls
          if (!mauMap.get(cid).anh_net_url) mauMap.get(cid).anh_net_url = urls[0]   // ảnh đầu làm ảnh nét thẻ
          anhDai++
        }
      } catch (e) { /* giữ [] */ }
    }
    // [WP-107 L-1e] ĐẨY BÀI CÓ SẴN: chưa có ảnh + có page_id + story_id → dẫn PAGE token (ĐÚNG page_id, token quản
    //   nhiều trang) rồi GET /{story_id}?fields=full_picture (1251px). Trang không dẫn được token → giữ null → ô xám.
    //   CẤM lấy ảnh trang khác gán vào (khớp page_id mới dùng).
    let anhBai = 0
    const daybai = [...mauMap.values()].filter(m => !m.anh_net_url && m.page_id && m.story_id)
    if (daybai.length) {
      const pageTok = {}
      try {
        const acc = await (await fetchFn(`${B}/me/accounts?fields=id,access_token&limit=200&access_token=${encodeURIComponent(token)}`)).json()
        for (const p of (acc.data || [])) if (p.id && p.access_token) pageTok[p.id] = p.access_token
      } catch (e) { /* không dẫn được → mọi mẫu giữ null */ }
      for (const m of daybai) {
        const pt = pageTok[m.page_id]   // ĐÚNG page_id của mẫu — không lấy bừa trang đầu
        if (!pt) continue
        try {
          const jj = await (await fetchFn(`${B}/${m.story_id}?fields=full_picture&access_token=${encodeURIComponent(pt)}`)).json()
          if (jj.full_picture) { m.anh_net_url = jj.full_picture; anhBai++ }
        } catch (e) { /* giữ null → ô xám */ }
      }
    }
    const mauRows = [...mauMap.values()]
    // GHI: tx ghim GUC meta_he_thong (set_config rơi ở multiplex — khuôn L-09)
    let soMau = 0
    if (mauRows.length) {
      const w = async cl => {
        await cl.query(`select set_config('kho.meta_he_thong','1',true)`)
        soMau = (await cl.query('select kho.ads_mau_ghi($1::jsonb,$2::jsonb) n', [j(mauRows), j(adRows)])).rows[0].n
      }
      if (opts.tx) await opts.tx(w)
      else { await client.query('begin'); try { await w(client); await client.query('commit') } catch (e) { await client.query('rollback').catch(() => {}); throw e } }
    }
    await ghi('xong', null, idMoc, soMau)
    const s = ((Date.now() - t0) / 1000).toFixed(1)
    const coAnh = mauRows.filter(m => m.anh_net_url).length
    console.log(`ads-mau XONG · ${ads.length} ad · creative ${keoDuoc} · mẫu ${mauRows.length} · CÓ ẢNH ${coAnh}/${mauRows.length} (nét ${anhNet} · xoay vòng ${anhDai} · đẩy bài ${anhBai}) · lỗi ${loi.length} · ${s}s`)
    if (canhBaoPage.length) console.warn(`⚠ ads-mau: ${canhBaoPage.length} ad KHÔNG tách được page_id (ghi NULL, cần soi): ${JSON.stringify(canhBaoPage)}`)
    return { tongAd: ads.length, keoDuoc, soMau: mauRows.length, coAnh, anhNet, anhDai, anhBai, loi, canhBaoPage }
  } catch (e) {
    await ghi('loi', null, idMoc, null, String(e.message).slice(0, 200)).catch(() => {})
    throw e
  }
}

// chạy trực tiếp: node ops/keo_mau_ads_meta.mjs
if (process.argv[1] && process.argv[1].endsWith('keo_mau_ads_meta.mjs')) {
  const c = new pg.Client(await docConfig()); await c.connect()
  try { const r = await keoMauAdsMeta(c, {}); if (r.loi && r.loi.length) console.log('LỖI (nguyên văn Meta):', JSON.stringify(r.loi.slice(0, 5))) }
  catch (e) { console.error('LỖI:', e.message); process.exitCode = 1 }
  finally { await c.end() }
}
