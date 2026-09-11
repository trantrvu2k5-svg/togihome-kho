// WP-77 vế (b) · Bộ kéo chi phí Meta mức ad × ngày → chi_ads_ngay. Khuôn worker-keo-lead.
//   /me/adaccounts động (KHÔNG chôn 6 mã) · insights cấp ad time_increment=1 last_7d · upsert theo khoá (Meta chốt muộn).
//   Lỗi MỘT tài khoản KHÔNG làm chết cả vòng (ghi lỗi, đi tiếp). Thử lại ≤3 lần rồi bỏ vòng đó. Nhịp 1 lần/giờ là đủ.
//   token lấy từ ENV (bí mật). fetch tiêm được (test không chạm mạng). CHỈ ghi chi_ads_ngay — không đụng vế (a).
export const CAPI_V = 'v21.0'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function goi(fetchFn, url, thuMax = 3) {
  let last
  for (let i = 1; i <= thuMax; i++) {
    try {
      const r = await fetchFn(url)
      const j = await r.json()
      // Retry MỌI lỗi (429/5xx + lỗi transient "Cannot parse access token" mã 190 gặp ở prod) ≤ thuMax lần rồi mới bỏ.
      if (j.error) { last = j.error.message; await sleep(500 * i); continue }
      return j
    } catch (e) { last = String(e && e.message || e); await sleep(500 * i) }
  }
  throw new Error(last || 'hết retry')
}

// Danh sách tài khoản (động). Trả [{name, act, act_id, currency}]. act='act_<id>' cho insights.
export async function layTaiKhoan(fetchFn, token) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/me/adaccounts?fields=name,account_id,currency&limit=100&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 5 && url; i++) {
    const j = await goi(fetchFn, url)
    for (const a of (j.data || [])) out.push({ name: a.name, act: 'act_' + a.account_id, act_id: a.account_id, currency: a.currency })
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

// [WP-113 lô 2G] DANH SÁCH TÀI KHOẢN HỢP NHẤT — MỘT nguồn duy nhất cho MỌI mục B/C/D/E.
//   /me/adaccounts ∪ mọi act_id từng có trong chi_ads_ngay (TK vào muộn / rớt khỏi /me vẫn được kéo).
//   RỖNG → NÉM (kéo câm = che lỗi token/quyền — khuôn 'hết nuốt lỗi' 2F).
export async function dsTaiKhoanHopNhat(client, fetchFn, token) {
  const metaAccts = await layTaiKhoan(fetchFn, token)
  const map = new Map(metaAccts.map(a => [a.act_id, a]))
  for (const r of (await client.query(`select act_id, max(tien_te) tien_te from kho.chi_ads_ngay where act_id is not null group by act_id`)).rows)
    if (!map.has(r.act_id)) map.set(r.act_id, { name: null, act: 'act_' + r.act_id, act_id: r.act_id, currency: r.tien_te || 'VND' })
  const ds = [...map.values()]
  if (!ds.length) throw new Error('DS_TAI_KHOAN_RONG: /me/adaccounts + chi_ads_ngay đều trống — KHÔNG kéo (tránh chạy câm)')
  return ds
}

// Bộ chọn thời gian: range={since,until} → time_range (kéo lại khoảng lịch sử); không có → last_7d (nhịp thường).
function chonThoiGian(range) {
  return range && range.since && range.until
    ? '&time_range=' + encodeURIComponent(JSON.stringify({ since: range.since, until: range.until }))
    : '&date_preset=last_7d'
}

// Bóc trường action-list Meta ([{action_type,value},…]) thành TỔNG số. VẮNG (mẫu ảnh) → NULL; MẢNG RỖNG → NULL (KHÔNG 0).
//   L-100.1 lỗi #100: video_3_sec ĐÃ BỎ — không dùng. NULL = "không đo được", 0 sẽ kéo nền video xuống.
export const bocAction = a => {
  if (a == null) return null
  if (Array.isArray(a)) return a.length ? a.reduce((s, x) => s + Number(x.value || 0), 0) : null
  return Number(a)
}

// [WP-113 lô 2C] Đọc 5 SỐ HÀNH ĐỘNG từ actions/outbound_clicks (KHÔNG cộng lead lồng nhau — chỉ 5 action_type đích).
//   - action_type có → lấy · mảng có nhưng thiếu type → 0 (Meta bỏ = 0).
//   - THIẾU HẲN khoá actions + inline_link_clicks=0 → tất cả = 0 (dạng 'du').
//   - THIẾU HẲN khoá actions + inline_link_clicks>0 → dạng LẠ: cột = NULL, kiem_dang='la' (CẤM ghi 0).
const layAct = (arr, t) => { if (!Array.isArray(arr)) return 0; const f = arr.find(a => a.action_type === t); return f ? Number(f.value) : 0 }
export function bocHanhDong(r) {
  const acts = r.actions
  const ilc = r.inline_link_clicks != null ? Number(r.inline_link_clicks) : 0
  if (!Array.isArray(acts)) {
    if (ilc > 0) return { luot_vao_trang: null, bam_ra_web: null, cuoc_tro_chuyen: null, lien_he_pixel: null, mua_pixel: null, kiem_dang: 'la' }
    return { luot_vao_trang: 0, bam_ra_web: 0, cuoc_tro_chuyen: 0, lien_he_pixel: 0, mua_pixel: 0, kiem_dang: 'du' }
  }
  return {
    luot_vao_trang:  layAct(acts, 'landing_page_view'),
    bam_ra_web:      layAct(r.outbound_clicks, 'outbound_click'),
    cuoc_tro_chuyen: layAct(acts, 'onsite_conversion.messaging_conversation_started_7d'),
    lien_he_pixel:   layAct(acts, 'offsite_conversion.fb_pixel_lead'),
    mua_pixel:       layAct(acts, 'offsite_conversion.fb_pixel_purchase'),
    kiem_dang: 'du'
  }
}

// [WP-113 lô 2C] Kéo NHÓM QUẢNG CÁO (adset) → ads_nhom_quang_cao. Cho kiểm loại chiến dịch + luật "sửa nhiều tầng".
//   Ghi qua kết nối OWNER của worker (RLS chỉ gác app). Attribution không liên quan. Gọi ở lượt cron THẬT (lệnh sau).
export async function keoNhomQuangCao(client, opts = {}) {
  const token = opts.token; const fetchFn = opts.fetchFn || fetch
  if (!token) return { skip: 'thieu_token', so_nhom: 0 }
  const B = 'https://graph.facebook.com/' + CAPI_V
  const accts = await dsTaiKhoanHopNhat(client, fetchFn, token)   // [2G] danh sách chung
  const rows = []
  for (const a of accts) {
    let url = B + '/' + a.act + '/adsets?fields=id,campaign_id,optimization_goal,promoted_object&limit=500&access_token=' + encodeURIComponent(token)
    for (let guard = 0; url && guard < 20; guard++) {
      const jr = await (await fetchFn(url)).json()
      if (jr.error) break
      for (const s of (jr.data || [])) rows.push({
        adset_id: s.id, campaign_id: s.campaign_id || null, tai_khoan_id: a.act_id,
        optimization_goal: s.optimization_goal || null,
        custom_event_type: (s.promoted_object && s.promoted_object.custom_event_type) || null
      })
      url = jr.paging && jr.paging.next
    }
  }
  let ghi = 0
  for (const r of rows) {
    await client.query(`insert into kho.ads_nhom_quang_cao(adset_id,campaign_id,tai_khoan_id,optimization_goal,custom_event_type,cap_nhat_luc)
      values($1,$2,$3,$4,$5,now()) on conflict (adset_id) do update set
      campaign_id=excluded.campaign_id, tai_khoan_id=excluded.tai_khoan_id,
      optimization_goal=excluded.optimization_goal, custom_event_type=excluded.custom_event_type, cap_nhat_luc=now()`,
      [r.adset_id, r.campaign_id, r.tai_khoan_id, r.optimization_goal, r.custom_event_type])
    ghi++
  }
  return { so_nhom: ghi }
}

// Insights cấp ad × ngày của MỘT tài khoản. inline_link_clicks = bấm-vào-link (cho CTR/CPC); clicks = mọi lượt bấm.
//   [WP-100 L-100.3] +10 thước mẫu. ⚠ impressions liệt kê MỘT lần (lỗi "specified more than once" nếu lặp).
//   ⚠ KHÔNG xin video_3_sec (Meta đã bỏ). Xếp hạng trả CHUỖI (giữ nguyên, kể cả "UNKNOWN"/"chưa đủ dữ liệu").
export async function layInsights(fetchFn, token, act, range) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/insights?level=ad&time_increment=1' + chonThoiGian(range) +
    '&fields=ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,date_start,frequency,' +
    'video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,' +
    'video_p75_watched_actions,video_p100_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking' +
    '&limit=500&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 20 && url; i++) {
    const j = await goi(fetchFn, url)
    out.push(...(j.data || []))
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

// Insights cấp CHIẾN DỊCH × ngày (trục chính). objective NGUYÊN TRẠNG. Số Meta cấp campaign = nguồn gốc (không suy từ ad).
export async function layInsightsChienDich(fetchFn, token, act, range) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/insights?level=campaign&time_increment=1' + chonThoiGian(range) +
    '&fields=campaign_id,campaign_name,objective,spend,impressions,clicks,inline_link_clicks,date_start,actions,outbound_clicks&limit=500&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 20 && url; i++) {
    const j = await goi(fetchFn, url)
    out.push(...(j.data || []))
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

// Kéo trọn 1 vòng: mọi tài khoản → upsert chi_ads_ngay. Trả {taiKhoan:[{ten,act,dong,loi}], upsert, tongDong}.
export async function keoChiAdsMeta(client, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch
  const token = opts.token
  if (!token) return { skip: 'thieu_token', taiKhoan: [], upsert: 0, tongDong: 0 }
  // [WP-113 lô 2G] TÀI KHOẢN = hàm HỢP NHẤT dùng chung (B/C/D/E cùng một danh sách).
  const accts = await dsTaiKhoanHopNhat(client, fetchFn, token)
  const ketQua = []
  const rows = []      // cấp ad → chi_ads_ngay (giữ nguyên, cho ad tin nhắn)
  const cdRows = []    // cấp CHIẾN DỊCH → chi_chien_dich_ngay (trục chính)
  const range = opts.range   // {since,until} → kéo lại khoảng lịch sử; không có → last_7d
  for (const a of accts) {
    try {
      const [ins, insCd] = [await layInsights(fetchFn, token, a.act, range), await layInsightsChienDich(fetchFn, token, a.act, range)]
      for (const r of ins) rows.push({
        act_id: a.act_id, ad_id: r.ad_id, ad_name: r.ad_name || null, ngay: r.date_start,
        chi_tieu: Number(r.spend),              // NGUYÊN TRẠNG (không +VAT, không quy đổi)
        hien_thi: r.impressions != null ? Number(r.impressions) : null,
        luot_bam: r.clicks != null ? Number(r.clicks) : null,
        luot_bam_link: r.inline_link_clicks != null ? Number(r.inline_link_clicks) : null,   // bấm-vào-link (CTR/CPC)
        tien_te: a.currency || 'VND',
        // [WP-100 L-100.3] 10 thước mẫu. Video: bocAction (vắng/rỗng → NULL, không 0). Xếp hạng: CHUỖI nguyên trạng.
        tan_suat: r.frequency != null ? Number(r.frequency) : null,
        luot_phat: bocAction(r.video_play_actions),
        thruplay: bocAction(r.video_thruplay_watched_actions),
        xem_p25: bocAction(r.video_p25_watched_actions),
        xem_p50: bocAction(r.video_p50_watched_actions),
        xem_p75: bocAction(r.video_p75_watched_actions),
        xem_p100: bocAction(r.video_p100_watched_actions),
        xep_hang_chat_luong: r.quality_ranking != null ? String(r.quality_ranking) : null,
        xep_hang_tuong_tac: r.engagement_rate_ranking != null ? String(r.engagement_rate_ranking) : null,
        xep_hang_chuyen_doi: r.conversion_rate_ranking != null ? String(r.conversion_rate_ranking) : null
      })
      for (const r of insCd) cdRows.push({
        act_id: a.act_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name || null,
        objective: r.objective || null,         // NGUYÊN TRẠNG (không dịch, không phân loại lại)
        ngay: r.date_start, chi_tieu: Number(r.spend),
        hien_thi: r.impressions != null ? Number(r.impressions) : null,
        luot_bam: r.clicks != null ? Number(r.clicks) : null,
        luot_bam_link: r.inline_link_clicks != null ? Number(r.inline_link_clicks) : null,   // bấm-vào-link (CTR/CPC)
        tien_te: a.currency || 'VND',
        ...bocHanhDong(r)   // [WP-113] 5 số hành động + kiem_dang (NULL=chưa kéo, 'la'=dạng lạ)
      })
      ketQua.push({ ten: a.name, act: a.act, dong: ins.length, dong_cd: insCd.length, loi: null })
    } catch (e) {
      ketQua.push({ ten: a.name, act: a.act, dong: 0, dong_cd: 0, loi: String(e && e.message || e).slice(0, 100) })  // KHÔNG chết cả vòng
    }
  }
  let upsert = 0, upsertCd = 0
  if (rows.length || cdRows.length) {
    // MỘT transaction ghim GUC meta_he_thong (set_config rơi ở multiplex — khuôn L-09). opts.tx = sql.begin ghim
    //   backend (Cloudflare Hyperdrive); vắng tx = begin/commit (pg local). j: Hyperdrive shim sql.json object, local JSON.stringify.
    const j = v => opts.tx ? v : JSON.stringify(v)
    const ghiWrite = async (cl) => {
      await cl.query(`select set_config('kho.meta_he_thong','1',true)`)
      if (rows.length) upsert = (await cl.query(`select kho.chi_ads_ngay_ghi($1::jsonb) n`, [j(rows)])).rows[0].n
      if (cdRows.length) upsertCd = (await cl.query(`select kho.chi_chien_dich_ngay_ghi($1::jsonb) n`, [j(cdRows)])).rows[0].n
    }
    if (opts.tx) await opts.tx(ghiWrite)
    else { await client.query('begin'); try { await ghiWrite(client); await client.query('commit') } catch (e) { try { await client.query('rollback') } catch {} throw e } }
  }
  return { taiKhoan: ketQua, upsert, upsertCd, tongDong: rows.length, tongDongCd: cdRows.length, skip: null }
}

// [WP-91 L-91.2] Kéo CÓ GHI SỔ MỐC (khoá tự hết hạn) + GỘP KỲ tự động ngay sau — MỘT tiến trình.
//   3 chỗ nối: 'mo' trước Meta (chặn trùng → thoát êm), 'xong' sau kéo (so_dong THẬT), 'loi' ở catch (ném lại).
//   Hai cửa ad/campaign = HAI nguồn (meta_chi_ad · meta_chi_chien_dich). Gộp kỳ = nguồn gop_ky.
export async function keoChiAdsMetaCoSo(client, opts = {}) {
  const t0 = Date.now()
  const range = opts.range
  // GHI khoang THẬT đã kéo (kể cả last_7d) → chi_ads_kiem_do_phu đo coverage theo mốc, KHÔNG theo row
  //   (ngày không-tiêu-tiền không có row nhưng VẪN đã kéo → không tính là trống).
  const den = (range && range.until) || new Date().toISOString().slice(0, 10)
  const tu = (range && range.since) || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const ghi = (hd, nguon = null, id = null, so = null, loi = null) =>
    client.query('select kho.ads_moc_keo_ghi($1,$2,$3,$4,$5::date,$6::date,$7) g', [hd, nguon, id, so, tu, den, loi])
  // 1) MỞ lượt (khoá). Bị chặn (khoá còn hạn) → thoát ÊM (mã 0), scheduler không kêu giả.
  let idAd
  try { idAd = (await ghi('mo', 'meta_chi_ad')).rows[0].g.id }
  catch (e) {
    if (/đang chạy|chặn lượt trùng/.test(e.message)) { console.log('ads-keo: đang có lượt chạy, bỏ qua.'); return { skip: 'khoa' } }
    throw e
  }
  const idCd = (await ghi('mo', 'meta_chi_chien_dich')).rows[0].g.id
  try {
    const kq = await keoChiAdsMeta(client, opts)     // kéo Meta + upsert chi_ads_ngay + chi_chien_dich_ngay
    if (kq.skip) {   // hiếm: keoChiAdsMeta tự skip (thiếu token) → đóng lượt xong với 0 dòng, không coi là lỗi
      await ghi('xong', null, idAd, 0); await ghi('xong', null, idCd, 0)
      console.log(`ads-keo: SKIP (${kq.skip})`); return kq
    }
    // [WP-113 lô 2F] HẾT NUỐT LỖI: TK nào ném lỗi trong keoChiAdsMeta → mốc 'loi' (KHÔNG 'xong' giả),
    //   ghi ok/tổng + danh sách lỗi (đã lọc access_token). ok_ads=false nối ở keoAdsLuot qua kq.loiTK.
    const locTok = s => String(s || '').replace(/access_token=[^&\s]+/gi, 'access_token=<ẩn>').slice(0, 120)
    const loiTK = (kq.taiKhoan || []).filter(t => t.loi).map(t => ({ act: t.act, loi: locTok(t.loi) }))
    const tongTK = (kq.taiKhoan || []).length, okTK = tongTK - loiTK.length
    if (loiTK.length) {
      const tom = `ok ${okTK}/${tongTK} · ` + loiTK.map(t => '...' + String(t.act || '').slice(-4) + ':' + t.loi).join(' | ')
      await ghi('loi', null, idAd, kq.tongDong, tom.slice(0, 400))
      await ghi('loi', null, idCd, kq.tongDongCd, tom.slice(0, 400))
    } else {
      await ghi('xong', null, idAd, kq.tongDong)
      await ghi('xong', null, idCd, kq.tongDongCd)
    }
    // 2) GỘP KỲ tự động (idempotent QD-90 — KHÔNG đè nhập tay), CÙNG tiến trình
    let idGop, soGop = 0
    try {
      idGop = (await ghi('mo', 'gop_ky')).rows[0].g.id
      // chi_ads_gop_meta đòi GUC kho.meta_he_thong — tx ghim (Hyperdrive) hoặc begin/commit (pg local)
      const doGop = async (cl) => { await cl.query(`select set_config('kho.meta_he_thong','1',true)`); return (await cl.query('select kho.chi_ads_gop_meta() j')).rows[0].j }
      let g
      if (opts.tx) g = await opts.tx(doGop)
      else { await client.query('begin'); try { g = await doGop(client); await client.query('commit') } catch (e) { await client.query('rollback').catch(() => {}); throw e } }
      soGop = g && g.so_dong_gop != null ? g.so_dong_gop : 0
      await ghi('xong', null, idGop, soGop)
    } catch (e) {
      if (idGop) await ghi('loi', null, idGop, null, String(e.message).slice(0, 200)).catch(() => {})
      throw e
    }
    const s = ((Date.now() - t0) / 1000).toFixed(1)
    const kho = tu ? `${tu}→${den}` : 'last_7d'
    console.log(`ads-keo ${loiTK.length ? 'LỖI(' + okTK + '/' + tongTK + ' TK)' : 'XONG'} · meta_chi_ad ${kho}: ${kq.tongDong} dòng · meta_chi_chien_dich: ${kq.tongDongCd} dòng · gop_ky: ${soGop} dòng · ${s}s`)
    return { ...kq, soGop, loiTK, okTK, tongTK }
  } catch (e) {
    await ghi('loi', null, idAd, null, String(e.message).slice(0, 200)).catch(() => {})
    await ghi('loi', null, idCd, null, String(e.message).slice(0, 200)).catch(() => {})
    throw e
  }
}

// gom mảng ngày 'YYYY-MM-DD' LIÊN TỤC thành [[since,until],...]
function gomKhoangNgay(days) {
  if (!days.length) return []
  const next = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
  const out = []; let s = days[0], p = days[0]
  for (let i = 1; i < days.length; i++) { if (days[i] === next(p)) { p = days[i]; continue } out.push([s, p]); s = days[i]; p = days[i] }
  out.push([s, p]); return out
}

// [WP-90 L-23] NHỊP THƯỜNG (cho scheduler L-91.3 gọi): kéo BÙ ngày CHƯA KÉO (do_phu 90 ngày) rồi cửa sổ 7 ngày.
//   Cửa sổ 7 ngày GIỮ NGUYÊN (bắt số Meta chốt muộn). Auto-backfill idempotent — chạy nhiều lần không hại.
export async function keoChiAdsMetaNhip(client, opts = {}) {
  const den = new Date().toISOString().slice(0, 10)
  const tu90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const dp = (await client.query('select kho.chi_ads_kiem_do_phu($1,$2) j', [tu90, den])).rows[0].j
  const trong = [...new Set((dp || []).flatMap(r => r.ngay_chua_keo || []))].sort()
  const khoang = gomKhoangNgay(trong)
  for (const [s, e] of khoang) { console.log(`ads-nhip: kéo bù ngày chưa kéo ${s}→${e}`); await keoChiAdsMetaCoSo(client, { ...opts, range: { since: s, until: e } }) }
  if (!khoang.length) console.log('ads-nhip: 90 ngày đã đủ, không có ngày trống.')
  // [L-108-13] cửa sổ refresh 7 → 30 ngày (Meta chốt số/hoàn tiền tới ~28 ngày). Dùng range CHUNG của lượt (đồng bộ với D) nếu có.
  const denR = new Date().toISOString().slice(0, 10), tu30R = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  return keoChiAdsMetaCoSo(client, { ...opts, range: opts.rangeRefresh || { since: tu30R, until: denR } })
}

// ── C · SỔ THAY ĐỔI META (/act_<id>/activities) ────────────────────────────────
//   30 ngày (sổ ít dòng, rẻ). Tên người thực hiện LƯU NGUYÊN (che ở màn là việc lệnh sau).
//   0 bản ghi/tài khoản = kết quả HỢP LỆ (3/6 TK không có ai sửa gì), KHÔNG phải lỗi.
export async function layThayDoi(fetchFn, token, act, since, until) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/activities?fields=event_time,event_type,translated_event_type,object_id,object_name,extra_data,actor_name' +
    '&since=' + since + '&until=' + until + '&limit=200&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 20 && url; i++) {
    const j = await goi(fetchFn, url)
    out.push(...(j.data || []))
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

export async function keoThayDoiMeta(client, opts = {}) {
  const t0 = Date.now()
  const fetchFn = opts.fetch || globalThis.fetch
  const token = opts.token
  if (!token) return { skip: 'thieu_token' }
  const den = new Date().toISOString().slice(0, 10)
  const tu = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const ghi = (hd, id = null, so = null, loi = null) =>
    client.query('select kho.ads_moc_keo_ghi($1,$2,$3,$4,$5::date,$6::date,$7) g', [hd, 'meta_thay_doi', id, so, tu, den, loi])
  let idM
  try { idM = (await ghi('mo')).rows[0].g.id }
  catch (e) { if (/đang chạy|chặn lượt trùng/.test(e.message)) { console.log('ads-thay-doi: đang chạy, bỏ.'); return { skip: 'khoa' } } throw e }
  try {
    const accts = await dsTaiKhoanHopNhat(client, fetchFn, token)   // [2G] danh sách chung
    const rows = []; const theoTk = []
    for (const a of accts) {
      try {
        const acts = await layThayDoi(fetchFn, token, a.act, tu, den)
        for (const r of acts) rows.push({
          act_id: a.act_id, event_time: r.event_time, event_type: r.event_type,
          doi_tuong: r.object_name || null, ma_doi_tuong: r.object_id || null,
          mo_ta: r.extra_data || r.translated_event_type || null,   // extra_data = JSON chuỗi, giữ nguyên text
          nguoi_thuc_hien: r.actor_name || null                     // LƯU NGUYÊN, không che ở DB
        })
        theoTk.push({ ten: a.name, act: a.act, dong: acts.length })   // 0 dòng = hợp lệ
      } catch (e) { theoTk.push({ ten: a.name, act: a.act, dong: 0, loi: String(e.message).slice(0, 100) }) }
    }
    let ghiN = 0
    if (rows.length) {
      const j = v => opts.tx ? v : JSON.stringify(v)
      const w = async (cl) => { await cl.query(`select set_config('kho.meta_he_thong','1',true)`); ghiN = (await cl.query('select kho.ads_thay_doi_ghi($1::jsonb) n', [j(rows)])).rows[0].n }
      if (opts.tx) await opts.tx(w)
      else { await client.query('begin'); try { await w(client); await client.query('commit') } catch (e) { await client.query('rollback').catch(() => {}); throw e } }
    }
    await ghi('xong', idM, rows.length)
    console.log(`ads-thay-doi XONG · ${tu}→${den}: ${rows.length} bản ghi (mới ${ghiN}) · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return { tongDong: rows.length, ghiMoi: ghiN, theoTk }
  } catch (e) { await ghi('loi', idM, null, String(e.message).slice(0, 200)).catch(() => {}); throw e }
}

// ── D · TÁCH FACEBOOK / INSTAGRAM (Insights level=ad, breakdowns=publisher_platform) ──
//   CHỈ MỘT chiều breakdown (KHÔNG platform_position, KHÔNG device — v77 cấm chồng). Cửa sổ 7 ngày.
export async function layNenTang(fetchFn, token, act, range) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/insights?level=ad&time_increment=1&breakdowns=publisher_platform' + chonThoiGian(range) +
    '&fields=ad_id,spend,impressions,inline_link_clicks,date_start&limit=500&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 30 && url; i++) {
    const j = await goi(fetchFn, url)
    out.push(...(j.data || []))
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

export async function keoNenTangMeta(client, opts = {}) {
  const t0 = Date.now()
  const fetchFn = opts.fetch || globalThis.fetch
  const token = opts.token
  if (!token) return { skip: 'thieu_token' }
  const range = opts.range   // null → last_7d
  const den = (range && range.until) || new Date().toISOString().slice(0, 10)
  const tu = (range && range.since) || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const ghi = (hd, id = null, so = null, loi = null) =>
    client.query('select kho.ads_moc_keo_ghi($1,$2,$3,$4,$5::date,$6::date,$7) g', [hd, 'meta_nen_tang', id, so, tu, den, loi])
  let idM
  try { idM = (await ghi('mo')).rows[0].g.id }
  catch (e) { if (/đang chạy|chặn lượt trùng/.test(e.message)) { console.log('ads-nen-tang: đang chạy, bỏ.'); return { skip: 'khoa' } } throw e }
  try {
    const accts = await dsTaiKhoanHopNhat(client, fetchFn, token)   // [2G] danh sách chung
    const rows = []
    for (const a of accts) {
      try {
        const ins = await layNenTang(fetchFn, token, a.act, range)
        for (const r of ins) rows.push({
          act_id: a.act_id, ad_id: r.ad_id, ngay: r.date_start, nen_tang: r.publisher_platform,
          chi_tieu: Number(r.spend), hien_thi: r.impressions != null ? Number(r.impressions) : null,
          luot_bam_link: r.inline_link_clicks != null ? Number(r.inline_link_clicks) : null, tien_te: a.currency || 'VND'
        })
      } catch (e) { /* một TK lỗi → bỏ, đi tiếp */ console.error(`ads-nen-tang: ${a.act} lỗi ${String(e.message).slice(0, 80)}`) }
    }
    let ghiN = 0
    if (rows.length) {
      const j = v => opts.tx ? v : JSON.stringify(v)
      const w = async (cl) => { await cl.query(`select set_config('kho.meta_he_thong','1',true)`); ghiN = (await cl.query('select kho.chi_ads_nen_tang_ghi($1::jsonb) n', [j(rows)])).rows[0].n }
      if (opts.tx) await opts.tx(w)
      else { await client.query('begin'); try { await w(client); await client.query('commit') } catch (e) { await client.query('rollback').catch(() => {}); throw e } }
    }
    await ghi('xong', idM, rows.length)
    console.log(`ads-nen-tang XONG · ${tu}→${den}: ${rows.length} dòng (ghi ${ghiN}) · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return { tongDong: rows.length, ghi: ghiN }
  } catch (e) { await ghi('loi', idM, null, String(e.message).slice(0, 200)).catch(() => {}); throw e }
}

// ── E · MỘT LƯỢT CRON ADS = B + C + D. Mỗi việc BỌC RIÊNG: một việc lỗi KHÔNG giết hai việc kia;
//   mốc mỗi nguồn tự ghi 'loi'. Trả .loi[] để runner/worker thoát mã ≠0 nếu có bất kỳ việc nào lỗi.
export async function keoAdsLuot(client, opts = {}) {
  const kq = { b: null, c: null, d: null, e: null, loi: [] }
  // [L-108-13] MỘT MỐC THỜI GIAN CHUNG cho B (chi chính) + D (tách nền tảng), CÙNG cửa sổ 30 ngày → hết lệch-thời-điểm
  //   (trước: mỗi hàm tự new Date() + last_7d → D kéo sau B vài phút, ngày cuối chốt cao hơn → tách VƯỢT chính).
  //   Chưa tách được "kéo cả hai rồi mới ghi" vì mỗi hàm tự upsert bên trong; nhưng CÙNG range trong CÙNG lượt đã đủ khớp.
  // [WP-91 L-91k] cửa sổ ĐỌC LÙI N ngày đọc từ BẢNG (không chôn code); thiếu → RAISE, CẤM nền ngầm.
  const pr = await client.query(`select gia_tri::int n from kho.tham_so_van_hanh where ma = 'ads_doc_lui_ngay'`)
  if (!pr.rows.length || pr.rows[0].n == null) throw new Error('THIEU_THAM_SO: ads_doc_lui_ngay (kho.tham_so_van_hanh) — không xác định số ngày đọc lùi')
  const N = pr.rows[0].n
  const den = new Date().toISOString().slice(0, 10)
  const tuN = new Date(Date.now() - N * 86400000).toISOString().slice(0, 10)
  const rangeChung = { since: tuN, until: den }
  try { kq.b = await keoChiAdsMetaNhip(client, { ...opts, rangeRefresh: rangeChung }) } catch (e) { kq.loi.push({ viec: 'B_chi', loi: String(e && e.message || e).slice(0, 200) }) }
  // [WP-113 lô 2F] TK lỗi per-account (đã ghi mốc 'loi') → nổi lên kq.loi để ok_ads=false (hết 'xong' giả).
  if (kq.b && kq.b.loiTK && kq.b.loiTK.length) kq.loi.push({ viec: 'B_chi_TK', loi: `sót ${kq.b.tongTK - kq.b.okTK}/${kq.b.tongTK} TK`, chi_tiet: kq.b.loiTK })
  try { kq.c = await keoThayDoiMeta(client, opts) } catch (e) { kq.loi.push({ viec: 'C_thay_doi', loi: String(e && e.message || e).slice(0, 200) }) }
  try { kq.d = await keoNenTangMeta(client, { ...opts, range: rangeChung }) } catch (e) { kq.loi.push({ viec: 'D_nen_tang', loi: String(e && e.message || e).slice(0, 200) }) }
  // [WP-113 lô 2D] E: kéo NHÓM QUẢNG CÁO (adset) → ads_nhom_quang_cao (kiểm loại chiến dịch). Ghi owner, non-fatal.
  try { kq.e = await keoNhomQuangCao(client, { token: opts.token, fetchFn: opts.fetch || globalThis.fetch }) } catch (e) { kq.loi.push({ viec: 'E_nhom', loi: String(e && e.message || e).slice(0, 200) }) }
  return kq
}
