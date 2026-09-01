// App QUẢNG CÁO (app thứ 8) — WP-78 L-12. Vào: ads_user · ceo. Vai khác CHẶN Ở CỔNG (không ẩn menu).
//   Nguồn DUY NHẤT: RPC kho.ads_ad_ngay(tu, den) — mức ad_id × NGÀY (db/189). Gộp theo ad ở client; bấm ad → bung từng ngày.
//   Nhãn (chi/CAC, bậc phễu) ĐỌC TỪ RPC (nguon_chi · pheu[].nhan) — có nguồn Meta thì màn tự đổi, KHÔNG sửa code.
//   CẤM ở màn này: giá vốn/lãi/CM/lương/dòng tiền/công nợ · ô nhập chi ads · nút tắt/nhân bản GIẢ (chờ WP-77).
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb   // phơi client cho kiểm chéo RPC (đối chiếu VIỆC 5d)

const VAI_VAO = ['ads_user', 'ceo']
const TEN_VAI = { ads_user: 'Người chạy quảng cáo', ceo: 'CEO' }
let USER = null, DL = null, MO = new Set()   // MO = ad_id đang bung (khối phụ)
let MOC = new Set(), KHOI_AD_MO = false      // MOC = campaign đang bung · KHOI_AD_MO = mở khối phụ mức ad

const $ = id => document.getElementById(id)
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const nfmt = n => (Number(n) || 0).toLocaleString('vi-VN')
const tien = n => { n = Number(n); return Number.isFinite(n) && n ? n.toLocaleString('vi-VN') + 'đ' : '—' }
const dmy = s => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return '—'; const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) }
const isoNgay = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) }

// ══════════ ĐĂNG NHẬP + CỔNG VAI ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML = '<div class="logo">📣</div><h1>Togihome Quảng cáo</h1><div class="sub">Người chạy ads · theo ad_id × ngày</div>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<button id="b">Vào</button><div class="err" id="er">' + (err || '') + '</div>'
  const go = async () => {
    $('er').textContent = ''
    const { data, error } = await sb.auth.signInWithPassword({ email: $('e').value.trim(), password: $('p').value })
    if (error) { $('er').textContent = 'Sai email hoặc mật khẩu.'; return }
    laySauDangNhap(data.user)
  }
  $('b').onclick = go; $('p').onkeydown = e => { if (e.key === 'Enter') go() }
}
async function laySauDangNhap(user) {
  const { data, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (error || !data) { await sb.auth.signOut(); return manDangNhap('Tài khoản chưa gán vai trò — báo CEO.') }
  if (!data.dang_hoat_dong) { await sb.auth.signOut(); return manDangNhap('Tài khoản đang bị khoá — báo CEO.') }
  // CỔNG VAI: chỉ ads_user/ceo. Vai khác → CHẶN Ở CỔNG (không vào app rồi ẩn menu).
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app Quảng cáo.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro }
  capApp()
}
async function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = 'block'
  $('hdTen').textContent = USER.ten || TEN_VAI[USER.vai_tro]; $('hdVai').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  $('btOut').onclick = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  // dải ngày mặc định: từ 2025-01-01 tới hôm nay (phủ hết dữ liệu ads hiện có)
  const hnay = new Date(); const den = isoNgay(hnay)
  $('dTu').value = '2025-01-01'; $('dDen').value = den
  $('btXem').onclick = () => nap()
  nap()
}

// ══════════ NẠP + GỘP DỮ LIỆU (nguồn DUY NHẤT ads_ad_ngay) ══════════
async function nap() {
  $('noi').innerHTML = '<div class="trong">Đang tải…</div>'
  const tu = $('dTu').value, den = $('dDen').value
  // TRỤC CHÍNH: chiến dịch × ngày (ads_chien_dich_ngay). Khối phụ: mức ad (ads_ad_ngay).
  const [cd, ad] = await Promise.all([
    sb.rpc('ads_chien_dich_ngay', { p_tu_ngay: tu, p_den_ngay: den }),
    sb.rpc('ads_ad_ngay', { p_tu_ngay: tu, p_den_ngay: den })
  ])
  if (cd.error) { $('noi').innerHTML = '<div class="trong">Lỗi tải: ' + esc(cd.error.message) + '</div>'; return }
  // ── gộp CHIẾN DỊCH ──
  const cmap = new Map()
  for (const r of (cd.data || [])) {
    let g = cmap.get(r.campaign_id)
    if (!g) { g = { campaign_id: r.campaign_id, name: r.campaign_name, objective: r.objective, act_id: r.act_id, nguon_don: r.nguon_don, ngays: [], chi: 0, ht: 0, lb: 0, tuN: r.ngay, denN: r.ngay }; cmap.set(r.campaign_id, g) }
    g.ngays.push(r); g.chi += Number(r.chi) || 0; g.ht += Number(r.hien_thi) || 0; g.lb += Number(r.luot_bam) || 0
    if (r.ngay < g.tuN) g.tuN = r.ngay; if (r.ngay > g.denN) g.denN = r.ngay
    g.ngays.sort((a, b) => (a.ngay < b.ngay ? 1 : -1))
  }
  const chienDich = [...cmap.values()].sort((a, b) => b.chi - a.chi)
  const perAct = {}; for (const g of chienDich) perAct[g.act_id] = (perAct[g.act_id] || 0) + g.chi
  const chiTong = chienDich.reduce((s, g) => s + g.chi, 0)
  const rows = ad.data || []   // dữ liệu MỨC AD (khối phụ)
  // gộp theo ad_id: giữ per-day để bung
  const map = new Map()
  for (const r of rows) {
    const k = r.ad_id == null ? '__NGOAI__' : r.ad_id
    let g = map.get(k)
    if (!g) { g = { ad_id: r.ad_id, ngays: [], hoi_thoai: 0, co_sdt: 0, chot: 0, gt_chot: 0, giao: 0, nguon_chi: r.nguon_chi, chi: r.chi_ad, cac: r.cac_ad, tuN: r.ngay, denN: r.ngay }; map.set(k, g) }
    g.ngays.push(r)
    g.hoi_thoai += r.so_hoi_thoai || 0; g.co_sdt += r.so_co_sdt || 0; g.chot += r.don_chot || 0
    g.gt_chot += Number(r.gia_tri_chot) || 0; g.giao += r.don_giao || 0
    if (r.ngay < g.tuN) g.tuN = r.ngay; if (r.ngay > g.denN) g.denN = r.ngay
    g.ngays.sort((a, b) => (a.ngay < b.ngay ? 1 : -1))   // mới nhất trên
  }
  const ads = [...map.values()].filter(g => g.ad_id != null).sort((a, b) => b.hoi_thoai - a.hoi_thoai)
  const ngoai = map.get('__NGOAI__') || null
  // TỔNG (cho ① ② và câu trung thực) — tất cả từ RPC
  const coAd = ads.reduce((s, g) => s + g.hoi_thoai, 0)
  const tong = coAd + (ngoai ? ngoai.hoi_thoai : 0)
  const coSdt = ads.reduce((s, g) => s + g.co_sdt, 0) + (ngoai ? ngoai.co_sdt : 0)
  const chot = ads.reduce((s, g) => s + g.chot, 0) + (ngoai ? ngoai.chot : 0)
  const giao = ads.reduce((s, g) => s + g.giao, 0) + (ngoai ? ngoai.giao : 0)
  // phễu: đọc CẤU TRÚC bậc (bac, nhan) từ RPC (pheu), gộp gia_tri
  const pmap = new Map()
  for (const r of rows) for (const b of (r.pheu || [])) {
    let p = pmap.get(b.bac); if (!p) { p = { bac: b.bac, nhan: b.nhan, gia_tri: null }; pmap.set(b.bac, p) }
    if (b.gia_tri != null) p.gia_tri = (p.gia_tri || 0) + Number(b.gia_tri)
    if (b.nhan !== 'that') p.nhan = b.nhan   // giữ nhãn chờ-nguồn nếu bậc chưa có nguồn
  }
  const BAC_TEN = { hien_thi: 'Hiển thị', bam: 'Bấm', hoi_thoai: 'Hội thoại', co_sdt: 'Có SĐT', chot: 'Chốt', da_giao: 'Đã giao' }
  const NHAN_TXT = { cho_nguon_meta: 'chờ nguồn Meta', cho_gan_lead: 'chưa có đơn gắn lead' }
  DL = { chienDich, perAct, chiTong, ads, ngoai, coAd, tong, coSdt, chot, giao, pheu: [...pmap.values()], BAC_TEN, NHAN_TXT }
  render()
}

function render() {
  const { chienDich, perAct, chiTong, ads, ngoai, coAd, tong, coSdt, chot, giao, pheu, BAC_TEN, NHAN_TXT } = DL
  const ngoaiHt = ngoai ? ngoai.hoi_thoai : 0
  const pct = tong ? (100 * coAd / tong).toFixed(1) : '0'

  // ── ① CÂU TRUNG THỰC (CEO duyệt) — sửa lại phạm vi quy kết ──
  const perActTxt = Object.keys(perAct).length
    ? Object.entries(perAct).sort((a, b) => b[1] - a[1]).map(([act, v]) => 'TK ' + esc(act) + ': <span class="num">' + tien(v) + '</span>').join(' · ')
    : '(không tài khoản nào tiêu trong khoảng này)'
  const banner = '<div class="thucte">' +
    '<b>Chi phí quảng cáo:</b> số thật từ Meta, <b>chưa rõ gồm VAT hay chưa</b> (đang đối chiếu hoá đơn). ' +
    '<b>Đơn và CAC:</b> chưa có — quảng cáo đang chạy là loại <b>chuyển đổi dẫn vào web</b>, không gắn mã quảng cáo lên hội thoại. ' +
    'Quy kết đơn sẽ mở khi hệ bắn dữ liệu mua hàng về Meta (CAPI).<br>' +
    'Con số <span class="num">' + pct + '%</span> lead có mã quảng cáo là <b>DI SẢN</b> của quảng cáo tin nhắn đã tắt, ' +
    '<b>không phải</b> phần quy kết được của tiền đang chạy.<br>' +
    '<b>Chi 7 ngày:</b> <span class="num">' + tien(chiTong) + '</span> — ' + perActTxt + '</div>'

  // ── ② BẢNG CHIẾN DỊCH × NGÀY (TRỤC CHÍNH) ──
  const tCell = v => v != null ? '<td class="num">' + tien(v) + '</td>' : '<td class="dash">—</td>'
  const donCell = g => g.nguon_don === 'cho_capi' ? '<td class="cho">chờ CAPI</td>' : (g.don != null ? '<td class="num">' + nfmt(g.don) + '</td>' : '<td class="dash">—</td>')
  let cb = ''
  for (const g of chienDich) {
    const mo = MOC.has(g.campaign_id)
    cb += '<tr class="cdrow" data-cd="' + esc(g.campaign_id) + '"><td>' + (mo ? '▾ ' : '▸ ') + esc(g.name || g.campaign_id) + '</td>' +
      '<td><span class="obj">' + esc(g.objective || '—') + '</span></td>' +
      '<td>' + dmy(g.tuN) + (g.tuN !== g.denN ? ' → ' + dmy(g.denN) : '') + '</td>' +
      tCell(g.chi) + '<td class="num">' + nfmt(g.ht) + '</td><td class="num">' + nfmt(g.lb) + '</td>' +
      donCell(g) + '<td class="cho">chờ CAPI</td></tr>'
    if (mo) for (const d of g.ngays) cb += '<tr class="ngayrow"><td class="ngayc">' + dmy(d.ngay) + '</td><td></td><td></td>' +
      tCell(d.chi) + '<td class="num">' + nfmt(d.hien_thi) + '</td><td class="num">' + nfmt(d.luot_bam) + '</td>' +
      '<td class="cho">chờ CAPI</td><td class="cho">chờ CAPI</td></tr>'
  }
  const c2 = '<div class="sec"><h2><span class="n">1</span> Chiến dịch × ngày <span class="h2sub">(trục chính · chi phí thật · bấm để bung từng ngày)</span></h2>' +
    '<div class="tblwrap"><table><thead><tr><th>Chiến dịch</th><th>Mục tiêu</th><th>Khoảng ngày</th><th>Chi</th><th>Hiển thị</th><th>Bấm</th><th>Đơn</th><th>CAC</th></tr></thead>' +
    '<tbody>' + (cb || '<tr><td colspan="8" class="trong2">Không có chi phí trong khoảng này.</td></tr>') + '</tbody></table></div></div>'

  // ── ③ KHỐI PHỤ · MỨC AD (thu gọn mặc định — chỉ đúng cho quảng cáo TIN NHẮN) ──
  let khoiAd = '<div class="sec"><h2><span class="n">2</span> ' +
    '<button class="mo-khoi" id="btKhoiAd">' + (KHOI_AD_MO ? '▾' : '▸') + ' Mức từng quảng cáo (ad_id)</button> ' +
    '<span class="h2sub">chỉ đúng cho quảng cáo TIN NHẮN — tiền hiện chạy ad chuyển đổi nên phần lớn TRỐNG</span></h2>'
  if (KHOI_AD_MO) {
    const chiCell = g => g.chi != null ? '<td class="num">' + tien(g.chi) + '</td>' : '<td class="cho">chưa có nguồn</td>'
    const cacCell = g => g.cac != null ? '<td class="num">' + tien(g.cac) + '</td>' : '<td class="cho">chưa có nguồn</td>'
    const gtCell = v => v ? '<td class="num">' + tien(v) + '</td>' : '<td class="dash">—</td>'
    let body = ''
    for (const g of ads) {
      const mo = MO.has(g.ad_id)
      body += '<tr class="adrow" data-ad="' + esc(g.ad_id) + '"><td class="adid">' + (mo ? '▾ ' : '▸ ') + esc(g.ad_id) + '</td>' +
        '<td>' + dmy(g.tuN) + (g.tuN !== g.denN ? ' → ' + dmy(g.denN) : '') + '</td>' +
        '<td class="num">' + nfmt(g.hoi_thoai) + '</td><td class="num">' + nfmt(g.co_sdt) + '</td><td class="num">' + nfmt(g.chot) + '</td>' +
        gtCell(g.gt_chot) + '<td class="num">' + nfmt(g.giao) + '</td>' + chiCell(g) + cacCell(g) + '</tr>'
      if (mo) for (const d of g.ngays) body += '<tr class="ngayrow"><td class="adid ngayc">' + dmy(d.ngay) + '</td><td></td>' +
        '<td class="num">' + nfmt(d.so_hoi_thoai) + '</td><td class="num">' + nfmt(d.so_co_sdt) + '</td><td class="num">' + nfmt(d.don_chot) + '</td>' +
        gtCell(Number(d.gia_tri_chot)) + '<td class="num">' + nfmt(d.don_giao) + '</td>' +
        (d.chi_ad != null ? '<td class="num">' + tien(d.chi_ad) + '</td>' : '<td class="cho">chưa có nguồn</td>') +
        (d.cac_ad != null ? '<td class="num">' + tien(d.cac_ad) + '</td>' : '<td class="cho">chưa có nguồn</td>') + '</tr>'
    }
    if (ngoai) body += '<tr class="ngoai"><td>Ngoài quy kết (không có ad)</td><td>—</td>' +
      '<td class="num">' + nfmt(ngoai.hoi_thoai) + '</td><td class="num">' + nfmt(ngoai.co_sdt) + '</td><td class="num">' + nfmt(ngoai.chot) + '</td>' +
      gtCell(ngoai.gt_chot) + '<td class="num">' + nfmt(ngoai.giao) + '</td><td>—</td><td>—</td></tr>'
    khoiAd += '<div class="tblwrap"><table><thead><tr><th>Mã quảng cáo</th><th>Khoảng ngày</th><th>Hội thoại</th><th>Có SĐT</th><th>Chốt</th><th>Giá trị chốt</th><th>Đã giao</th><th>Chi</th><th>CAC</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="9" class="trong2">Không có hội thoại quảng cáo trong khoảng này.</td></tr>') + '</tbody></table></div>'
  }
  khoiAd += '</div>'

  // ── ④ chỗ để sau ──
  const c4 = '<div class="sec"><h2><span class="n">3</span> Chỗ để sau</h2>' +
    '<div class="placeholder">🔒 <b>Tắt / nhân bản quảng cáo</b> — cần <b>đơn theo chiến dịch</b> để có ngưỡng quyết định. <b>Chờ CAPI bắn dữ liệu mua hàng về Meta.</b><br>' +
    '<span class="ph2">Vẽ chỗ trống có tên còn hơn để người dùng tưởng app quên việc chính của họ. Nút bấm không ra quyết định được là nút lừa.</span></div></div>'

  $('noi').innerHTML = banner + c2 + khoiAd + c4
  $('noi').querySelectorAll('tr.cdrow').forEach(tr => tr.onclick = () => { const a = tr.dataset.cd; if (MOC.has(a)) MOC.delete(a); else MOC.add(a); render() })
  $('noi').querySelectorAll('tr.adrow').forEach(tr => tr.onclick = () => { const a = tr.dataset.ad; if (MO.has(a)) MO.delete(a); else MO.add(a); render() })
  const bt = $('btKhoiAd'); if (bt) bt.onclick = () => { KHOI_AD_MO = !KHOI_AD_MO; render() }
}

// ══════════ KHỞI ĐỘNG ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data && data.session) laySauDangNhap(data.session.user); else manDangNhap()
})()
