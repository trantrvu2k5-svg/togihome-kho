// WP-70 · LÕI bộ kéo Pancake → kho.lead (THUẦN runtime — chỉ fetch + client.query; KHÔNG import node/pg).
//   Dùng CHUNG cho: CLI local (keo_lead_pancake.mjs) + Cloudflare Worker cron (worker-keo-lead).
//   ⚠ CẤM gọi endpoint tin nhắn (/conversations/:id/messages). WP-70: KHÔNG lưu nội dung tin.
//   Cửa ghi DUY NHẤT = lead_ghi (GUC kho.lead_he_thong). client = {query(text, params)->{rows}} kiểu pg.
export const BASE = 'https://pages.fm/api/public_api/v2'
export const TRAN_TRANG = 10            // [TẠM L-70r9] 10 trang×60=600 hội thoại/lượt (từ 3). Gộp lô (db/188) +
//   Paid 30s CPU cho phép nới. KHÔNG lên 20: gộp lô mới chạy 2 ngày, chốt lại sau số tải thật (r9 mục C).
//   Vẫn CHẶN hai bẫy đốt CPU (cursor không tiến / hội thoại thiếu ngày) ở 10 vòng thay vì vô hạn.
export const MỘT_TRANG = 60
export const LUOT_LUI_TRAN = 10         // --lui: tối đa 10 lượt/trang — chạm trần lượt mà chưa tới đích → DỪNG
export const NGUONG_KY = Date.parse('2026-08-01T00:00:00Z')   // đích kéo lùi: phủ hết kỳ 2026-08
export const SAN_LUI  = Date.parse('2026-01-01T00:00:00Z')    // SÀN: không kéo lùi quá 01/01/2026

export const sleep = ms => new Promise(r => setTimeout(r, ms))
// [L-70r7 ĐO] đồng hồ trôi-qua (KHÔNG phải CPU) để KHOANH VÙNG khúc ngốn: pancake fetch + parse json.
export const MET = { pancakeMs: 0, parseMs: 0, pancakeN: 0 }
export function metReset() { MET.pancakeMs = 0; MET.parseMs = 0; MET.pancakeN = 0 }
// ── Đặt/tắt cờ hệ thống kho.lead_he_thong (mức PHIÊN, is_local=false). Tắt = chuỗi rỗng. ──
export async function guc(client, on) { await client.query("select set_config('kho.lead_he_thong',$1,false)", [on ? '1' : '']) }

// ── URL dựng: CHỈ endpoint conversations. Không bao giờ chứa 'messages'. ──
export function dungURL(page_id, token, last_conversation_id) {
  const u = new URL(`${BASE}/pages/${encodeURIComponent(page_id)}/conversations`)
  u.searchParams.set('page_access_token', token)
  if (last_conversation_id) u.searchParams.set('last_conversation_id', last_conversation_id)
  return u.toString()
}

// ── Lấy SĐT từ recent_phone_numbers. Dạng THẬT (L-70r3, cả 3 kênh): MẢNG OBJECT {phone_number, captured, …}.
//   Chịu được: mảng object · mảng chuỗi (cũ) · chuỗi · null/rỗng. Nhiều số → lấy phần tử ĐẦU
//   ([TẠM] Pancake xếp mới-nhất-trước). Chuẩn hoá: bỏ trắng/chấm/gạch/ngoặc; +84|84 đầu → 0;
//   không đủ 9–11 chữ số → NULL (thà rỗng còn hơn '[object Object]' hay chuỗi rác).
export function laySdt(recent) {
  if (!Array.isArray(recent) || !recent.length) return null
  const it = recent[0]
  let s = (it && typeof it === 'object') ? String(it.phone_number ?? it.captured ?? '') : String(it ?? '')
  s = s.replace(/[\s.\-()]/g, '')
  if (s.startsWith('+84')) s = '0' + s.slice(3)
  else if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2)
  s = s.replace(/\D/g, '')
  return /^\d{9,11}$/.test(s) ? s : null
}

// ── Ánh xạ MỘT hội thoại Pancake → tham số lead_ghi (thuần, không mạng). Trả {lead, canhbao?}. ──
export function hoiThoaiToLead(h, page_id) {
  const adFromAds = Array.isArray(h.ads) ? h.ads.map(a => a && a.ad_id).filter(Boolean) : []
  const adList = adFromAds.length ? adFromAds : (Array.isArray(h.ad_ids) ? h.ad_ids : [])
  const ad_id = adList.length ? adList[0] : null
  const canhbao = adList.length > 1 ? `hội thoại ${h.id} có ${adList.length} ad_id — lấy phần tử đầu` : null
  const sdt = laySdt((Array.isArray(h.recent_phone_numbers) && h.recent_phone_numbers.length) ? h.recent_phone_numbers
    : (Array.isArray(h.phone_numbers) ? h.phone_numbers : []))
  const ten_khach = (Array.isArray(h.customers) && h.customers[0] && h.customers[0].name) ? String(h.customers[0].name)
    : (h.from && h.from.name ? String(h.from.name) : null)
  // [L-70r4] cham_cuoi_luc = updated_at (chạm cuối, gồm cả mình trả lời). moc_dang_ngo: thiếu updated_at → true;
  //   |updated - inserted| > 24h (contact cũ nhắn lại) → true; còn lại false. Số suy đeo nhãn (QD-10/15).
  const cham_cuoi_luc = h.updated_at || null
  const moc_dang_ngo = !cham_cuoi_luc ? true
    : (h.inserted_at ? Math.abs(new Date(cham_cuoi_luc).getTime() - new Date(h.inserted_at).getTime()) > 86400000 : false)
  return {
    canhbao,
    lead: {
      nguon: 'pancake', page_id: String(page_id), hoi_thoai_id: String(h.id),
      khach_pancake_id: h.customer_id != null ? String(h.customer_id) : null,
      ten_khach, thoi_diem_hoi_thoai: h.inserted_at, cham_cuoi_luc, moc_dang_ngo,
      loai: h.type ? String(h.type).toLowerCase() : null,
      sdt, ad_id,
      muc_chac_chan: ad_id ? 'xac_dinh' : 'khong_biet',
      luong: 'khong_biet', loai_ma: null, ref_web: null
    }
  }
}

// ── Ghi MỘT lô hội thoại qua lead_ghi. GUC mức PHIÊN → RESET đầu lô + LUÔN tắt cuối lô (finally). ──
export async function ghiLoLead(client, page_id, hoiThoais) {
  // [L-70r8] GỘP LÔ: ánh xạ trong JS (rẻ), ghi CẢ LÔ bằng MỘT câu lead_ghi_lo (thay 60 câu lead_ghi).
  //   set_config chỉ 2 lần (bật/tắt) thay 3 — cùng transaction với INSERT (Hyperdrive rơi GUC giữa câu rời, L-09).
  const R = { ghi: 0, khong_doi: 0, co_ad: 0, co_sdt: 0, canhbao: [], max_cap_nhat: null, min_cap_nhat: null, last_conversation_id: null }
  const leads = []
  for (const h of hoiThoais) {
    const { lead, canhbao } = hoiThoaiToLead(h, page_id)
    if (canhbao) { R.canhbao.push(canhbao); console.warn('  ⚠ ' + canhbao) }
    leads.push(lead)
    if (lead.ad_id) R.co_ad++
    if (lead.sdt) R.co_sdt++
    const cn = h.updated_at || h.inserted_at
    if (cn && (!R.max_cap_nhat || new Date(cn) > new Date(R.max_cap_nhat))) R.max_cap_nhat = cn
    if (cn && (!R.min_cap_nhat || new Date(cn) < new Date(R.min_cap_nhat))) R.min_cap_nhat = cn
    R.last_conversation_id = String(h.id)
  }
  if (!leads.length) return R
  await guc(client, true)
  try {
    // [L-70r8 vá] lead_ghi_lo nhận TEXT (db/188). Truyền JSON.stringify (chuỗi) + $1 KHÔNG cast:
    //   postgres.js mã hoá KÉP chuỗi gửi tới tham số JSONB (→ scalar); tham số TEXT thì gửi thẳng. Chạy cả pg lẫn Worker.
    const r = (await client.query('select kho.lead_ghi_lo($1) j', [JSON.stringify(leads)])).rows[0].j
    R.ghi = r.ghi; R.khong_doi = r.khong_doi
  } finally { await guc(client, false) }
  return R
}

// ── Lấy MỘT trang Pancake (mạng), retry 429/5xx lùi dần. Trả {ds, next}. ──
export async function layTrang(page_id, token, cursor) {
  let last
  for (let i = 0; i < 4; i++) {
    const _t0 = Date.now()
    const res = await fetch(dungURL(page_id, token, cursor))
    MET.pancakeMs += Date.now() - _t0; MET.pancakeN++
    if (res.ok) { const _tp = Date.now(); const j = await res.json(); MET.parseMs += Date.now() - _tp; const ds = j.conversations || j.data || []; return { ds, next: ds.length ? String(ds[ds.length - 1].id) : null } }
    last = res.status
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * Math.pow(2, i)); continue }
    throw new Error(`Pancake ${res.status} trang ${cursor || 'đầu'}`)
  }
  throw new Error(`Pancake ${last} (hết retry) trang ${cursor || 'đầu'}`)
}

// ── Kéo XUÔI (--moi) một page. GHI LEAD THEO TRANG (mỗi trang 1 transaction riêng → bị giết giữa chừng
//    VẪN GIỮ phần đã kéo; lead_ghi idempotent nên lượt sau làm lại rẻ). opts.tx bọc mỗi ghi trong 1 giao
//    dịch: Worker truyền sql.begin (ghim 1 backend cho GUC — bài học L-09); CLI/test bỏ trống → chạy thẳng
//    trên client (pg 1 kết nối, GUC bền, tự commit từng câu).
//    ⚠ MỐC đẩy CUỐI lượt (= max updated_at), KHÔNG per-trang: kéo mới-trước-cũ, đẩy mốc giữa chừng sẽ tạo
//    LỖ HỔNG (trang cũ hơn trong khoảng chưa kéo bị bỏ vĩnh viễn). Durable đạt nhờ commit LEAD per-trang. ──
export async function keoMotPage(client, page_id, token, opts = {}) {
  const tx = opts.tx || (fn => fn(client))
  const moc = (await client.query(`select moc_cap_nhat from kho.lead_moc_keo where page_id=$1`, [page_id])).rows[0]?.moc_cap_nhat
  const mocMs = moc ? new Date(moc).getTime() : 0
  const T = { trang: 0, hoi_thoai: 0, ghi: 0, khong_doi: 0, co_ad: 0, co_sdt: 0, canhbao: [], cham_tran: false, max_cap_nhat: null, last_conversation_id: null }
  let cursor = null, dung = false
  while (!dung) {
    if (T.trang >= TRAN_TRANG) { T.cham_tran = true; console.warn(`  ⚠ page ${page_id}: chạm trần ${TRAN_TRANG} trang/lượt — còn tồn, lượt cron sau kéo tiếp (backlog lớn: chạy --lui)`); break }
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
      const r = await tx(cl => ghiLoLead(cl, page_id, moi))   // ← GHI TRANG này, commit ngay (durable)
      T.hoi_thoai += moi.length; T.ghi += r.ghi; T.khong_doi += r.khong_doi; T.co_ad += r.co_ad; T.co_sdt += r.co_sdt
      T.canhbao.push(...r.canhbao)
      if (r.max_cap_nhat && (!T.max_cap_nhat || new Date(r.max_cap_nhat) > new Date(T.max_cap_nhat))) T.max_cap_nhat = r.max_cap_nhat
      T.last_conversation_id = r.last_conversation_id
    }
    if (dung || !next || ds.length < MỘT_TRANG) break
    cursor = next
  }
  // MỐC + NHỊP TIM (1 transaction riêng): max_cap_nhat null → GIỮ mốc cũ, chỉ cập nhật lan_keo_luc.
  await tx(async cl => {
    await guc(cl, true)
    try { await cl.query(`select kho.lead_moc_ghi($1,$2::timestamptz,$3,$4)`, [page_id, T.max_cap_nhat, T.last_conversation_id, T.hoi_thoai]) }
    finally { await guc(cl, false) }
  })
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
