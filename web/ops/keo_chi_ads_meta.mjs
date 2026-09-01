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

// Insights cấp ad × ngày (7 ngày gần nhất) của MỘT tài khoản.
export async function layInsights(fetchFn, token, act) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/insights?level=ad&time_increment=1&date_preset=last_7d' +
    '&fields=ad_id,ad_name,spend,impressions,clicks,date_start&limit=500&access_token=' + encodeURIComponent(token)
  const out = []
  for (let i = 0; i < 20 && url; i++) {
    const j = await goi(fetchFn, url)
    out.push(...(j.data || []))
    url = j.paging && j.paging.next ? j.paging.next : null
  }
  return out
}

// Insights cấp CHIẾN DỊCH × ngày (trục chính). objective NGUYÊN TRẠNG. Số Meta cấp campaign = nguồn gốc (không suy từ ad).
export async function layInsightsChienDich(fetchFn, token, act) {
  const B = 'https://graph.facebook.com/' + CAPI_V
  let url = B + '/' + act + '/insights?level=campaign&time_increment=1&date_preset=last_7d' +
    '&fields=campaign_id,campaign_name,objective,spend,impressions,clicks,date_start&limit=500&access_token=' + encodeURIComponent(token)
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
  const accts = await layTaiKhoan(fetchFn, token)
  const ketQua = []
  const rows = []      // cấp ad → chi_ads_ngay (giữ nguyên, cho ad tin nhắn)
  const cdRows = []    // cấp CHIẾN DỊCH → chi_chien_dich_ngay (trục chính)
  for (const a of accts) {
    try {
      const [ins, insCd] = [await layInsights(fetchFn, token, a.act), await layInsightsChienDich(fetchFn, token, a.act)]
      for (const r of ins) rows.push({
        act_id: a.act_id, ad_id: r.ad_id, ad_name: r.ad_name || null, ngay: r.date_start,
        chi_tieu: Number(r.spend),              // NGUYÊN TRẠNG (không +VAT, không quy đổi)
        hien_thi: r.impressions != null ? Number(r.impressions) : null,
        luot_bam: r.clicks != null ? Number(r.clicks) : null,
        tien_te: a.currency || 'VND'
      })
      for (const r of insCd) cdRows.push({
        act_id: a.act_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name || null,
        objective: r.objective || null,         // NGUYÊN TRẠNG (không dịch, không phân loại lại)
        ngay: r.date_start, chi_tieu: Number(r.spend),
        hien_thi: r.impressions != null ? Number(r.impressions) : null,
        luot_bam: r.clicks != null ? Number(r.clicks) : null, tien_te: a.currency || 'VND'
      })
      ketQua.push({ ten: a.name, act: a.act, dong: ins.length, dong_cd: insCd.length, loi: null })
    } catch (e) {
      ketQua.push({ ten: a.name, act: a.act, dong: 0, dong_cd: 0, loi: String(e && e.message || e).slice(0, 100) })  // KHÔNG chết cả vòng
    }
  }
  let upsert = 0, upsertCd = 0
  if (rows.length || cdRows.length) {
    // MỘT transaction ghim GUC meta_he_thong cho cả 2 cửa ghi (set_config local mất ở autocommit — khuôn L-09). Một nguồn số.
    await client.query('begin')
    try {
      await client.query(`select set_config('kho.meta_he_thong','1',true)`)
      if (rows.length) upsert = (await client.query(`select kho.chi_ads_ngay_ghi($1::jsonb) n`, [JSON.stringify(rows)])).rows[0].n
      if (cdRows.length) upsertCd = (await client.query(`select kho.chi_chien_dich_ngay_ghi($1::jsonb) n`, [JSON.stringify(cdRows)])).rows[0].n
      await client.query('commit')
    } catch (e) { try { await client.query('rollback') } catch {} throw e }
  }
  return { taiKhoan: ketQua, upsert, upsertCd, tongDong: rows.length, tongDongCd: cdRows.length, skip: null }
}
