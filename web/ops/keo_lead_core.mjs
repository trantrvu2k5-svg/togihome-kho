// WP-70 · LÕI bộ kéo Pancake → kho.lead (THUẦN runtime — chỉ fetch + client.query; KHÔNG import node/pg).
//   Dùng CHUNG cho: CLI local (keo_lead_pancake.mjs) + Cloudflare Worker cron (worker-keo-lead).
//   ⚠ CẤM gọi endpoint tin nhắn (/conversations/:id/messages). WP-70: KHÔNG lưu nội dung tin.
//   Cửa ghi DUY NHẤT = lead_ghi (GUC kho.lead_he_thong). client = {query(text, params)->{rows}} kiểu pg.
export const BASE = 'https://pages.fm/api/public_api/v2'
export const TRAN_TRANG = 20            // 20 trang × 60 = 1200 hội thoại/lượt — chạm trần thì DỪNG lượt (không lặp)
export const MỘT_TRANG = 60
export const LUOT_LUI_TRAN = 10         // --lui: tối đa 10 lượt/trang — chạm trần lượt mà chưa tới đích → DỪNG
export const NGUONG_KY = Date.parse('2026-08-01T00:00:00Z')   // đích kéo lùi: phủ hết kỳ 2026-08
export const SAN_LUI  = Date.parse('2026-01-01T00:00:00Z')    // SÀN: không kéo lùi quá 01/01/2026

export const sleep = ms => new Promise(r => setTimeout(r, ms))
// ── Đặt/tắt cờ hệ thống kho.lead_he_thong (mức PHIÊN, is_local=false). Tắt = chuỗi rỗng. ──
export async function guc(client, on) { await client.query("select set_config('kho.lead_he_thong',$1,false)", [on ? '1' : '']) }

// ── URL dựng: CHỈ endpoint conversations. Không bao giờ chứa 'messages'. ──
export function dungURL(page_id, token, last_conversation_id) {
  const u = new URL(`${BASE}/pages/${encodeURIComponent(page_id)}/conversations`)
  u.searchParams.set('page_access_token', token)
  if (last_conversation_id) u.searchParams.set('last_conversation_id', last_conversation_id)
  return u.toString()
}

// ── Ánh xạ MỘT hội thoại Pancake → tham số lead_ghi (thuần, không mạng). Trả {lead, canhbao?}. ──
export function hoiThoaiToLead(h, page_id) {
  const adFromAds = Array.isArray(h.ads) ? h.ads.map(a => a && a.ad_id).filter(Boolean) : []
  const adList = adFromAds.length ? adFromAds : (Array.isArray(h.ad_ids) ? h.ad_ids : [])
  const ad_id = adList.length ? adList[0] : null
  const canhbao = adList.length > 1 ? `hội thoại ${h.id} có ${adList.length} ad_id — lấy phần tử đầu` : null
  const phones = (Array.isArray(h.recent_phone_numbers) && h.recent_phone_numbers.length) ? h.recent_phone_numbers
    : (Array.isArray(h.phone_numbers) ? h.phone_numbers : [])
  const ten_khach = (Array.isArray(h.customers) && h.customers[0] && h.customers[0].name) ? String(h.customers[0].name)
    : (h.from && h.from.name ? String(h.from.name) : null)
  return {
    canhbao,
    lead: {
      nguon: 'pancake', page_id: String(page_id), hoi_thoai_id: String(h.id),
      khach_pancake_id: h.customer_id != null ? String(h.customer_id) : null,
      ten_khach, thoi_diem_hoi_thoai: h.inserted_at,
      loai: h.type ? String(h.type).toLowerCase() : null,
      sdt: phones.length ? String(phones[0]) : null, ad_id,
      muc_chac_chan: ad_id ? 'xac_dinh' : 'khong_biet',
      luong: 'khong_biet', loai_ma: null, ref_web: null
    }
  }
}

// ── Ghi MỘT lô hội thoại qua lead_ghi. GUC mức PHIÊN → RESET đầu lô + LUÔN tắt cuối lô (finally). ──
export async function ghiLoLead(client, page_id, hoiThoais) {
  await guc(client, false)
  await guc(client, true)
  const R = { ghi: 0, khong_doi: 0, co_ad: 0, co_sdt: 0, canhbao: [], max_cap_nhat: null, min_cap_nhat: null, last_conversation_id: null }
  try {
    for (const h of hoiThoais) {
      const { lead, canhbao } = hoiThoaiToLead(h, page_id)
      if (canhbao) { R.canhbao.push(canhbao); console.warn('  ⚠ ' + canhbao) }
      // Truyền OBJECT (không JSON.stringify): pg tự stringify → jsonb; shim Worker bọc sql.json() → jsonb.
      const r = (await client.query('select kho.lead_ghi($1) j', [lead])).rows[0].j
      if (r.ket === 'da_ghi') R.ghi++; else R.khong_doi++
      if (lead.ad_id) R.co_ad++
      if (lead.sdt) R.co_sdt++
      const cn = h.updated_at || h.inserted_at
      if (cn && (!R.max_cap_nhat || new Date(cn) > new Date(R.max_cap_nhat))) R.max_cap_nhat = cn
      if (cn && (!R.min_cap_nhat || new Date(cn) < new Date(R.min_cap_nhat))) R.min_cap_nhat = cn
      R.last_conversation_id = String(h.id)
    }
  } finally { await guc(client, false) }
  return R
}

// ── Lấy MỘT trang Pancake (mạng), retry 429/5xx lùi dần. Trả {ds, next}. ──
export async function layTrang(page_id, token, cursor) {
  let last
  for (let i = 0; i < 4; i++) {
    const res = await fetch(dungURL(page_id, token, cursor))
    if (res.ok) { const j = await res.json(); const ds = j.conversations || j.data || []; return { ds, next: ds.length ? String(ds[ds.length - 1].id) : null } }
    last = res.status
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * Math.pow(2, i)); continue }
    throw new Error(`Pancake ${res.status} trang ${cursor || 'đầu'}`)
  }
  throw new Error(`Pancake ${last} (hết retry) trang ${cursor || 'đầu'}`)
}

// ── Kéo XUÔI (--moi) một page. LUÔN đập nhịp tim mỗi lượt (kể cả 0 lead mới). ──
export async function keoMotPage(client, page_id, token) {
  const moc = (await client.query(`select moc_cap_nhat from kho.lead_moc_keo where page_id=$1`, [page_id])).rows[0]?.moc_cap_nhat
  const mocMs = moc ? new Date(moc).getTime() : 0
  const T = { trang: 0, hoi_thoai: 0, ghi: 0, khong_doi: 0, co_ad: 0, co_sdt: 0, canhbao: [], cham_tran: false, max_cap_nhat: null, last_conversation_id: null }
  let cursor = null, dung = false
  while (!dung) {
    if (T.trang >= TRAN_TRANG) { T.cham_tran = true; console.warn(`  ⚠ page ${page_id}: CHẠM TRẦN ${TRAN_TRANG} trang — còn tồn, DỪNG (chạy --lui để phủ phần cũ)`); break }
    const { ds, next } = await layTrang(page_id, token, cursor)
    T.trang++
    if (!ds.length) break
    const moi = []
    for (const h of ds) {
      const cn = new Date(h.updated_at || h.inserted_at).getTime()
      if (cn <= mocMs) { dung = true; break }
      moi.push(h)
    }
    if (moi.length) {
      const r = await ghiLoLead(client, page_id, moi)
      T.hoi_thoai += moi.length; T.ghi += r.ghi; T.khong_doi += r.khong_doi; T.co_ad += r.co_ad; T.co_sdt += r.co_sdt
      T.canhbao.push(...r.canhbao)
      if (r.max_cap_nhat && (!T.max_cap_nhat || new Date(r.max_cap_nhat) > new Date(T.max_cap_nhat))) T.max_cap_nhat = r.max_cap_nhat
      T.last_conversation_id = r.last_conversation_id
    }
    if (dung || !next || ds.length < MỘT_TRANG) break
    cursor = next
  }
  // NHỊP TIM: max_cap_nhat null → lead_moc_ghi GIỮ mốc cũ, chỉ cập nhật lan_keo_luc. lan_co_lead chỉ đổi khi hoi_thoai>0.
  await guc(client, true)
  try { await client.query(`select kho.lead_moc_ghi($1,$2::timestamptz,$3,$4)`, [page_id, T.max_cap_nhat, T.last_conversation_id, T.hoi_thoai]) }
  finally { await guc(client, false) }
  return T
}

// ── Kéo LÙI (--lui) MỘT lượt (≤20 trang) một page, tới SÀN 01/01/2026. ──
export async function keoLuiMotPage(client, page_id, token) {
  const row = (await client.query(`select last_conversation_id, moc_cu, moc_cu_hoi_thoai_id from kho.lead_moc_keo where page_id=$1`, [page_id])).rows[0]
  const startCursor = row?.moc_cu_hoi_thoai_id || row?.last_conversation_id
  const T = { skip: false, trang: 0, hoi_thoai: 0, ghi: 0, khong_doi: 0, co_ad: 0, co_sdt: 0, canhbao: [], cham_tran: false, cham_san: false, het: false, moc_cu: row?.moc_cu || null, moc_cu_hoi_thoai_id: startCursor || null }
  if (!startCursor) { T.skip = true; return T }
  let cursor = startCursor, minCn = null, lastCursor = startCursor
  while (true) {
    if (T.trang >= TRAN_TRANG) { T.cham_tran = true; break }
    const { ds, next } = await layTrang(page_id, token, cursor)
    T.trang++
    if (!ds.length) { T.het = true; break }
    const moi = []
    for (const h of ds) {
      const cn = new Date(h.updated_at || h.inserted_at).getTime()
      if (cn < SAN_LUI) { T.cham_san = true; break }
      moi.push(h)
    }
    if (moi.length) {
      const r = await ghiLoLead(client, page_id, moi)
      T.hoi_thoai += moi.length; T.ghi += r.ghi; T.khong_doi += r.khong_doi; T.co_ad += r.co_ad; T.co_sdt += r.co_sdt
      T.canhbao.push(...r.canhbao)
      if (r.min_cap_nhat && (!minCn || new Date(r.min_cap_nhat) < minCn)) minCn = new Date(r.min_cap_nhat)
      lastCursor = r.last_conversation_id
    }
    if (T.cham_san) break
    if (!next || ds.length < MỘT_TRANG) { T.het = true; break }
    cursor = next
  }
  if (minCn) T.moc_cu = minCn.toISOString()
  T.moc_cu_hoi_thoai_id = lastCursor
  if (T.hoi_thoai > 0 || T.cham_san) {
    await guc(client, true)
    try { await client.query(`select kho.lead_moc_cu_ghi($1,$2::timestamptz,$3,$4)`, [page_id, T.moc_cu, T.moc_cu_hoi_thoai_id, T.hoi_thoai]) }
    finally { await guc(client, false) }
  }
  return T
}

// ── Lặp --lui tới khi moc_cu < NGUONG_KY / chạm sàn / hết dữ liệu, TRẦN CỨNG LUOT_LUI_TRAN lượt. ──
export async function keoLuiTronTrang(client, page_id, token) {
  const G = { luot: 0, hoi_thoai: 0, ghi: 0, moc_cu: null, dat_dich: false, cham_san: false, het: false, cham_tran_luot: false, skip: false }
  while (G.luot < LUOT_LUI_TRAN) {
    const T = await keoLuiMotPage(client, page_id, token)
    if (T.skip) { G.skip = true; break }
    G.luot++; G.hoi_thoai += T.hoi_thoai; G.ghi += T.ghi; G.moc_cu = T.moc_cu
    if (T.moc_cu && Date.parse(T.moc_cu) < NGUONG_KY) { G.dat_dich = true; break }
    if (T.cham_san) { G.cham_san = true; break }
    if (T.het) { G.het = true; break }
  }
  if (!G.dat_dich && !G.cham_san && !G.het && !G.skip) G.cham_tran_luot = true
  return G
}
