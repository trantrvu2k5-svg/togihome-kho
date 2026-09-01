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
let USER = null, DL = null, MO = new Set()   // MO = ad_id đang bung

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
  const { data, error } = await sb.rpc('ads_ad_ngay', { p_tu_ngay: tu, p_den_ngay: den })
  if (error) { $('noi').innerHTML = '<div class="trong">Lỗi tải: ' + esc(error.message) + '</div>'; return }
  const rows = data || []
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
  DL = { ads, ngoai, coAd, tong, coSdt, chot, giao, pheu: [...pmap.values()], BAC_TEN, NHAN_TXT }
  render()
}

function render() {
  const { ads, ngoai, coAd, tong, coSdt, chot, giao, pheu, BAC_TEN, NHAN_TXT } = DL
  const ngoaiHt = ngoai ? ngoai.hoi_thoai : 0
  // ── câu trung thực (VIỆC 2) — cố định + số thật từ RPC ──
  const banner = '<div class="thucte"><b>Phạm vi quy kết:</b> Mức từng quảng cáo CHỈ phủ khách nhắn thẳng Facebook/Instagram. ' +
    'Khách đến từ quảng cáo dẫn vào web rồi nhắn Zalo/Messenger <b>hiện chưa quy kết được</b> về từng quảng cáo. ' +
    '<span class="num">' + nfmt(coAd) + '</span> / <span class="num">' + nfmt(tong) + '</span> lead có mã quảng cáo' +
    (tong ? ' (' + (100 * coAd / tong).toFixed(1) + '%)' : '') + ' — còn <span class="num">' + nfmt(ngoaiHt) + '</span> ngoài quy kết.</div>'

  // ── ① chất lượng nguồn ──
  const c1 = '<div class="sec"><h2><span class="n">1</span> Nguồn này chắc tới đâu</h2><div class="cards">' +
    '<div class="c"><div class="big">' + nfmt(coAd) + ' <span class="sub2">/ ' + nfmt(tong) + '</span></div><div class="lbl">lead CÓ mã quảng cáo / tổng lead</div>' +
    '<div class="d">Còn ' + nfmt(ngoaiHt) + ' lead ngoài quy kết (khách tự nhắn, không qua ad).</div></div>' +
    '<div class="c"><div class="big">' + ads.length + '</div><div class="lbl">mã quảng cáo phân biệt</div><div class="d">Khớp đúng ad_id trong hội thoại Pancake.</div></div>' +
    '<div class="c' + (chot === 0 ? ' zero' : '') + '"><div class="big">' + nfmt(chot) + '</div><div class="lbl">đơn đã gắn lead (chốt)</div>' +
    '<div class="d">' + (chot === 0 ? 'Chưa đơn nào gắn lead → hai bậc cuối phễu (chốt · đã giao) RỖNG tới khi màn Sale chạy. Trống vì CHƯA GẮN, không phải hỏng.' : 'Đơn gắn lead đã bắt đầu về.') + '</div></div>' +
    '</div></div>'

  // ── ② phễu 6 bậc (nhãn đọc từ pheu[].nhan) ──
  const maxV = Math.max(1, ...pheu.map(p => p.gia_tri || 0))
  const fr = pheu.map(p => {
    const meta = p.nhan === 'cho_nguon_meta'
    const rong = p.gia_tri ? Math.max(4, 100 * p.gia_tri / maxV) : 100
    let bar, fv
    if (meta) { bar = '<div class="bar dash"><span class="tag">' + esc(NHAN_TXT[p.nhan] || p.nhan) + '</span></div>'; fv = '<div class="fv cho">— chờ Meta</div>' }
    else if ((p.gia_tri || 0) === 0 && (p.bac === 'chot' || p.bac === 'da_giao')) { bar = '<div class="bar hollow"><span class="tag">' + esc(NHAN_TXT.cho_gan_lead) + '</span></div>'; fv = '<div class="fv zero">0</div>' }
    else { bar = '<div class="bar solid" style="width:' + rong.toFixed(1) + '%"></div>'; fv = '<div class="fv">' + nfmt(p.gia_tri || 0) + '</div>' }
    return '<div class="fr"><div class="fl">' + esc(BAC_TEN[p.bac] || p.bac) + '</div>' + bar + fv + '</div>'
  }).join('')
  const c2 = '<div class="sec"><h2><span class="n">2</span> Phễu 6 bậc</h2><div class="funnel">' + fr + '</div></div>'

  // ── ③ bảng ad gộp (bấm bung từng ngày) ──
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
    if (mo) for (const d of g.ngays) {
      body += '<tr class="ngayrow"><td class="adid ngayc">' + dmy(d.ngay) + '</td><td></td>' +
        '<td class="num">' + nfmt(d.so_hoi_thoai) + '</td><td class="num">' + nfmt(d.so_co_sdt) + '</td><td class="num">' + nfmt(d.don_chot) + '</td>' +
        gtCell(Number(d.gia_tri_chot)) + '<td class="num">' + nfmt(d.don_giao) + '</td>' +
        (d.chi_ad != null ? '<td class="num">' + tien(d.chi_ad) + '</td>' : '<td class="cho">chưa có nguồn</td>') +
        (d.cac_ad != null ? '<td class="num">' + tien(d.cac_ad) + '</td>' : '<td class="cho">chưa có nguồn</td>') + '</tr>'
    }
  }
  if (ngoai) body += '<tr class="ngoai"><td>Ngoài quy kết (không có ad)</td><td>—</td>' +
    '<td class="num">' + nfmt(ngoai.hoi_thoai) + '</td><td class="num">' + nfmt(ngoai.co_sdt) + '</td><td class="num">' + nfmt(ngoai.chot) + '</td>' +
    gtCell(ngoai.gt_chot) + '<td class="num">' + nfmt(ngoai.giao) + '</td><td>—</td><td>—</td></tr>'
  const c3 = '<div class="sec"><h2><span class="n">3</span> Bảng mã quảng cáo × ngày <span class="h2sub">(gộp theo ad, nhiều hội thoại nhất lên đầu · bấm để bung từng ngày)</span></h2>' +
    '<div class="tblwrap"><table><thead><tr><th>Mã quảng cáo</th><th>Khoảng ngày</th><th>Hội thoại</th><th>Có SĐT</th><th>Chốt</th><th>Giá trị chốt</th><th>Đã giao</th><th>Chi</th><th>CAC</th></tr></thead>' +
    '<tbody>' + (body || '<tr><td colspan="9" class="trong2">Không có hội thoại quảng cáo trong khoảng này.</td></tr>') + '</tbody></table></div></div>'

  // ── ④ chỗ để sau ──
  const c4 = '<div class="sec"><h2><span class="n">4</span> Chỗ để sau</h2>' +
    '<div class="placeholder">🔒 <b>Tắt / nhân bản quảng cáo</b> — cần chi phí mức ad để có ngưỡng 3× CAC. <b>Chờ WP-77.</b><br>' +
    '<span class="ph2">Vẽ chỗ trống có tên còn hơn để người dùng tưởng app quên việc chính của họ. Nút bấm không ra quyết định được là nút lừa.</span></div></div>'

  $('noi').innerHTML = banner + c1 + c2 + c3 + c4
  $('noi').querySelectorAll('tr.adrow').forEach(tr => tr.onclick = () => {
    const a = tr.dataset.ad; if (MO.has(a)) MO.delete(a); else MO.add(a); render()
  })
}

// ══════════ KHỞI ĐỘNG ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data && data.session) laySauDangNhap(data.session.user); else manDangNhap()
})()
