// NHẬP sản phẩm bán chạy từ web Laravel+Nuxt (togihome.vn & 4 web brand cùng nền).
//   THAM SỐ HOÁ theo API_HOST → dùng lại cho lô sau. CHẠY LẠI ĐƯỢC (upsert theo PK tất định), KHÔNG nhân đôi.
//   Chạy: cd web && API_HOST=api.togihome.vn SO_LUONG=100 node ops/nhap_web.mjs
//   CHỐNG TRÙNG ĐA WEB: nếu ảnh sản phẩm của host trỏ về api.togihome.vn → backend CHUNG → BỎ QUA (đã nhập).
import pg from 'pg'; import { docConfig } from './conn.mjs'; import { readFileSync, writeFileSync, existsSync } from 'fs'
const API_HOST = process.env.API_HOST || 'api.togihome.vn'
const SO_LUONG = parseInt(process.env.SO_LUONG || '100', 10)
const SB_URL = 'https://ugebruuxkslsnbramils.supabase.co'
const ANON = 'sb_publishable_zIjWBNYyHg0KrqS3XMovIw_lq89OKEj'
const CEO = { email: 'ceo@togihome.local', pw: 'togihome2026' }
const CACHE = `/tmp/nhap_${API_HOST}.json`
const UA = 'Mozilla/5.0 (import-tool)'
const H = { 'X-LANG': 'vi', 'User-Agent': UA }
const c = new pg.Client(await docConfig()); await c.connect()
const q = (s, a = []) => c.query(s, a)
const log = (...a) => console.log(...a)

// ---- helpers ----
const bo_dau = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const VL_KW = ['go tu nhien', 'plywood', 'go soi', 'go oc cho', 'cao su', 'mdf', 'melamine', 'go cong nghiep', 'mfc', 'veneer', 'go ash', 'tan bi', 'go thong', 'go']
function doanVatLieu(ten) { const t = bo_dau(ten).replace(/-/g, ' '); for (const k of VL_KW) if (t.includes(k)) return k; return null }
const soMm = (raw, unit) => Math.round(parseFloat(String(raw).replace(',', '.')) * (unit === 'mm' ? 1 : unit === 'm' ? 1000 : 10))  // mặc định cm→mm
function tachKichThuoc(str) {  // → [dai,rong,cao] mm. KHÔNG bịa: thiếu trục nào để null. Không tách được → null.
  const s = str || ''
  // 1) NHÃN "Dài .. Rộng/Sâu .. Cao .." (đáng tin nhất — trục theo nhãn). Sep nhãn↔số: khoảng trắng / : / -
  const lab = re => { const m = s.match(re); return m ? soMm(m[1], (m[2] || 'cm').toLowerCase()) : null }
  const d = lab(/d[àa]i[\s:\-.]*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?/i)
  const r = lab(/(?:r[ộo]ng|s[âa]u)[\s:\-.]*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?/i)
  const c = lab(/cao[\s:\-.]*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?/i)
  if ([d, r, c].filter(x => x != null).length >= 2) return [d, r, c]   // ≥2 nhãn → tin; trục thiếu = null
  // 2) "A x B x C" — sep gồm x × * (web hay dùng "120*50*75cm"). Theo THỨ TỰ CHUỖI (chưa chuẩn hoá trục).
  const cm = /cm|centimet/i.test(s), u = cm ? 'cm' : /\bmm\b/i.test(s) ? 'mm' : 'cm'
  const SEP = '\\s*(?:cm|mm|m)?\\s*[x×X*]\\s*', N = '(\\d+(?:[.,]\\d+)?)'   // cho phép đơn vị dính sau số ("140cm * 200cm")
  const m3 = s.match(new RegExp(N + SEP + N + SEP + N))
  if (m3) return [1, 2, 3].map(i => soMm(m3[i], u))
  // 3) "A x B" (2 trục — cao KHÔNG cho → null, không bịa)
  const m2 = s.match(new RegExp(N + SEP + N))
  if (m2) return [soMm(m2[1], u), soMm(m2[2], u), null]
  return null
}
// chọn chuỗi giàu số đo nhất trong các ứng viên (tên biến thể thường chứa "Dài..Rộng.."); trả {ktStr, dims}
function docKichThuoc(ty, p) {
  const cands = [ty.name, ty.property_item?.value, p.name].filter(Boolean)
  for (const cand of cands) { const dims = tachKichThuoc(cand); if (dims) return { ktStr: cand, dims } }
  return { ktStr: ty.property_item?.value || ty.name || '', dims: null }   // không tách được → giữ chuỗi gốc, dims null
}

async function api(path) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(`https://${API_HOST}${path}`, { headers: H }); if (r.ok) return await r.json() } catch (e) {}
    await new Promise(r => setTimeout(r, 300))
  }
  return null
}

// ---- 0. chốt chống trùng đa web ----
async function backendChung() {
  const d = await api('/buyer/products/search?keyword=&page=1'); const it = d?.data?.data?.[0]
  if (!it) return false
  const det = await api(`/buyer/products/${it.id}?slug=${it.slug}`); const p = det?.data?.product
  const anhHost = (p?.default_image || '').match(/https?:\/\/([^/]+)/)?.[1] || ''
  return { anhHost, chung: anhHost.includes('api.togihome.vn') && API_HOST !== 'api.togihome.vn' }
}

// ---- upload ảnh: DÙNG service_role (batch server-side; app KHÔNG upload, chỉ đọc public + sửa DB) ----
//   (bucket san-pham tạo qua SQL → storage service từ chối token authenticated dù RLS SQL pass; service_role bỏ RLS.)
const SERVICE = process.env.SB_SERVICE || ''
async function taiVaDay(imgUrl, path) {
  if (!SERVICE || !imgUrl) return null
  try {
    const buf = Buffer.from(await (await fetch(imgUrl, { headers: { 'User-Agent': UA } })).arrayBuffer())
    const up = await fetch(`${SB_URL}/storage/v1/object/san-pham/${path}`, { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: buf })
    return up.ok ? path : null
  } catch (e) { return null }
}

try {
  const bc = await backendChung()
  log(`[HOST ${API_HOST}] ảnh trỏ về: ${bc.anhHost}`)
  if (bc.chung) { log('→ BACKEND CHUNG với api.togihome.vn → BỎ QUA (đã nhập từ togihome.vn).'); process.exit(0) }

  // ---- 1. liệt kê toàn bộ + 2. detail (order_count) — cache ----
  let details
  if (existsSync(CACHE)) { details = JSON.parse(readFileSync(CACHE, 'utf8')); log(`cache: ${details.length} sản phẩm`) }
  else {
    log('liệt kê tất cả trang...')
    const items = []
    for (let pg = 1; ; pg++) {
      const d = await api(`/buyer/products/search?keyword=&page=${pg}`)
      const arr = d?.data?.data || []; if (!arr.length) break
      arr.forEach(x => items.push({ id: x.id, slug: x.slug }))
      if (pg % 50 === 0) log(`  ...trang ${pg}, ${items.length} sp`)
      if (pg > 600) break
    }
    log(`tổng ${items.length} sp · lấy detail (order_count)...`)
    details = []
    for (let i = 0; i < items.length; i += 20) {
      const batch = await Promise.all(items.slice(i, i + 20).map(async it => {
        const det = await api(`/buyer/products/${it.id}?slug=${it.slug}`); const p = det?.data?.product
        return p ? { id: p.id, name: p.name, slug: p.slug, order_count: p.order_count || 0, total_week_sold: p.total_week_sold || 0 } : null
      }))
      details.push(...batch.filter(Boolean))
      if (i % 400 === 0) log(`  detail ${i}/${items.length}`)
    }
    writeFileSync(CACHE, JSON.stringify(details)); log(`cache lưu: ${details.length}`)
  }

  // ---- 3. xếp bán chạy, lấy top N ----
  details.sort((a, b) => b.order_count - a.order_count)
  const top = details.slice(0, SO_LUONG)
  log(`TOP ${top.length}: cao nhất order_count=${top[0]?.order_count}, thấp nhất=${top[top.length - 1]?.order_count}`)

  // ---- map shop → thuong_hieu ----
  //   SHOP_MAP tường minh theo id gian trên api.togihome.vn (CEO chốt: mỗi gian Togihome = brand riêng;
  //   Nguyễn Đức Việt id15 → togihome). Ưu tiên id; hụt thì dò theo tên (dùng lại cho host khác).
  const SHOP_MAP = {
    2: 'togihome-vp', 6: 'togihome-hd', 4: 'togihome-gaming', 9: 'togihome-office',
    3: 'togihome-bcc', 5: 'togihome-kr', 11: 'togihome-bh', 15: 'togihome',
    14: 'togismart', 19: 'haigo', 22: 'openliving', 21: 'vufurni'
  }
  const brands = (await q(`select ma, ten, ten_tren_web, ma_3chu from kho.thuong_hieu`)).rows
  const coBrand = ma => brands.some(b => b.ma === ma)
  function mapBrand(shop) {
    if (!shop) return null
    if (API_HOST === 'api.togihome.vn' && SHOP_MAP[shop.id] && coBrand(SHOP_MAP[shop.id])) return SHOP_MAP[shop.id]
    return brands.find(b => b.ma === shop.slug || b.ten === shop.name || b.ten_tren_web === shop.name || bo_dau(b.ten) === bo_dau(shop.name))?.ma || null
  }

  if (!SERVICE) log('⚠ THIẾU SB_SERVICE — sẽ KHÔNG re-host ảnh (chạy lại với SB_SERVICE=… để có ảnh).')
  // FAIL-ĐÓNG: nếu KHÔNG đọc được cờ da_soat_tay (thiếu cột) → CHẶN, không chạy import mù (sẽ ghi đè ô người đã soát).
  try { await q(`select da_soat_tay from kho.san_pham_mau limit 1`) }
  catch (e) { throw new Error('CHẶN: không xác định được da_soat_tay (thiếu cột? áp db/060 trước). ' + e.message) }
  const conNull = Number((await q(`select count(*) n from kho.san_pham_mau where ma like 'W%-%' and da_soat_tay is null`)).rows[0].n)
  if (conNull > 0) throw new Error(`CHẶN: ${conNull} biến thể web có da_soat_tay = NULL (không xác định) — dừng, không đoán.`)
  const stat = { loi: 0, bt: 0, ny: 0, kt_tach: 0, kt_khong: 0, vl_doan: 0, combo: 0, shop_la: new Set(), anh: 0, giu_soat: 0 }
  const anhChung = []  // path bỏ RLS: chèn qua ceo token
  for (const t of top) {
    const det = await api(`/buyer/products/${t.id}?slug=${t.slug}`); const p = det?.data?.product; if (!p) continue
    const brand = mapBrand(p.shop)
    if (!brand) { stat.shop_la.add(`${p.shop?.id}:${p.shop?.name}`); continue }
    const laCombo = /combo|bộ\s/i.test(p.name)
    const vlDoan = doanVatLieu(p.name)
    // LÕI TẠM: mỗi sp một lõi
    const maLoi = `WEB-${p.id}`
    await q(`insert into kho.san_pham_loi(ma_loi,ten_ky_thuat,nhom_hang,nguon,ghi_chu)
      values($1,$2,$3,'xuong',$4)
      on conflict (ma_loi) do update set ten_ky_thuat=excluded.ten_ky_thuat, ghi_chu=excluded.ghi_chu`,
      [maLoi, p.name, null, `nhập web ${API_HOST} id ${p.id}`]); stat.loi++
    // ảnh chính (2 cỡ web: thumb + original), re-host
    const imgs = (p.productImages || []).slice(0, 1)
    const anhList = []
    for (let ai = 0; ai < imgs.length; ai++) {
      const im = imgs[ai]
      const nho = await taiVaDay(im.full_thumb_url, `${p.id}/${ai}_nho.webp`)
      const to = await taiVaDay(im.full_url, `${p.id}/${ai}_to.webp`)
      if (nho || to) { anhList.push({ nho, to }); stat.anh++ }
    }
    const anhJson = JSON.stringify(anhList)
    // productTypes → biến thể + niêm yết (mỗi kích thước một cái, giữ giá riêng)
    const types = (p.productTypes && p.productTypes.length) ? p.productTypes : [{ id: 0, name: p.name, price: Number(String(p.price).replace(/\D/g, '')) || 0, property_item: { value: '' } }]
    for (let ti = 0; ti < types.length; ti++) {
      const ty = types[ti]
      const { ktStr, dims } = docKichThuoc(ty, p)
      if (dims && dims.some(x => x != null)) stat.kt_tach++; else if (/\d/.test(ktStr)) stat.kt_khong++
      // trục thứ 4 (số ghế / cấu hình / màu web) — giữ để phân biệt biến thể cùng kích thước, KHÔNG mất dữ liệu
      const propVal = ty.property_item?.value || null
      const ttKhac = (propVal && !tachKichThuoc(propVal)) ? JSON.stringify({ web: propVal }) : null
      const maBT = `W${p.id}-${ti}`
      // cờ chua_xac_nhan = TRUE chỉ khi CÓ ĐOÁN vật liệu (không đoán → null → cờ false, chỉ là "chưa biết", không phải đoán sai)
      // ⚠ GUARD ĐÃ SOÁT TAY: on conflict CHỈ update khi da_soat_tay=false → dòng người đã soát BỎ QUA HOÀN TOÀN (không ghi đè cả cột NULL).
      const up = await q(`insert into kho.san_pham_mau(ma,ten,ma_loi,dai_mm,rong_mm,cao_mm,kt_nguon,thuoc_tinh_khac,vl_doan,vl_chua_xac_nhan,ngung)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,false)
        on conflict (ma) do update set ten=excluded.ten,ma_loi=excluded.ma_loi,dai_mm=excluded.dai_mm,rong_mm=excluded.rong_mm,cao_mm=excluded.cao_mm,kt_nguon=excluded.kt_nguon,thuoc_tinh_khac=excluded.thuoc_tinh_khac,vl_doan=excluded.vl_doan,vl_chua_xac_nhan=excluded.vl_chua_xac_nhan
          where kho.san_pham_mau.da_soat_tay = false
        returning (xmax = 0) as chen_moi`,
        [maBT, ty.name || p.name, maLoi, dims?.[0] ?? null, dims?.[1] ?? null, dims?.[2] ?? null, ktStr || null, ttKhac, vlDoan, !!vlDoan]); stat.bt++
      if (!up.rows.length) stat.giu_soat++   // conflict + WHERE false → không update → dòng đã soát được giữ
      if (vlDoan) stat.vl_doan++
      const gia = Number(ty.price) || Number(String(p.price).replace(/\D/g, '')) || 0
      const maNy = types.length === 1 ? (p.sku_code || `W-${p.id}`) : `${p.sku_code || 'W' + p.id}-${ti}`
      const slug = types.length === 1 ? p.slug : `${p.slug}-${ti}`   // ti đảm bảo DUY NHẤT trong sp (property value có thể trùng giữa các type)
      await q(`insert into kho.niem_yet(ma_ny,ma_bien_the,ma_thuong_hieu,ten_ban_hang,duong_dan,duong_dan_chuan,gia_niem_yet,dang_ban,mo_ta_html,order_count,total_week_sold,la_combo,anh,nguon_host,id_web,shop_web_id)
        values($1,$2,$3,$4,$5,kho.bo_dau($5),$6,true,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
        on conflict (ma_ny) do update set gia_niem_yet=excluded.gia_niem_yet,ten_ban_hang=excluded.ten_ban_hang,mo_ta_html=excluded.mo_ta_html,order_count=excluded.order_count,total_week_sold=excluded.total_week_sold,la_combo=excluded.la_combo,anh=excluded.anh,shop_web_id=excluded.shop_web_id`,
        [maNy, maBT, brand, types.length === 1 ? p.name : `${p.name} · ${ktStr}`, slug, gia, p.description || null, p.order_count || 0, p.total_week_sold || 0, laCombo, anhJson, API_HOST, p.id, p.shop?.id ?? null]); stat.ny++
    }
    if (laCombo) stat.combo++
  }
  log('\n===== KẾT QUẢ NHẬP =====')
  log(`lõi: ${stat.loi} · biến thể: ${stat.bt} · niêm yết: ${stat.ny} · combo (cờ): ${stat.combo}`)
  log(`kích thước TÁCH được: ${stat.kt_tach} · có số nhưng KHÔNG tách: ${stat.kt_khong} · còn lại NULL`)
  log(`vật liệu ĐOÁN (cờ chua_xac_nhan): ${stat.vl_doan}/${stat.bt} biến thể · ảnh re-host: ${stat.anh}`)
  log(`biến thể ĐÃ SOÁT TAY được GIỮ (không ghi đè): ${stat.giu_soat}`)
  if (stat.shop_la.size) log(`⚠ SHOP LẠ chưa có trong thuong_hieu (BỎ QUA, KHÔNG tự thêm): ${[...stat.shop_la].join(' · ')}`)
} catch (e) { console.error('LỖI NHẬP:', e.message, e.stack?.split('\n').slice(0, 3).join('\n')) }
finally { await c.end() }
