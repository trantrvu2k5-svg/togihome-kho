// App QUẢNG CÁO (WP-93/WP-92 · mẫu v2b) — vào: ads_user · ceo. Vai khác CHẶN Ở CỔNG.
//   Nguồn SỐ DUY NHẤT: RPC ads_bang_ky · ads_tong_so_sanh · ads_viec_phai_lam · ads_ad_ngay. UI KHÔNG tự tính lại số.
//   Đèn 5 trạng thái từ RPC (WP-92); CON SỐ TRẦN KHÔNG BAO GIỜ về client. NULL → "—", cấm hiện 0 giả. Lỗi RPC → đỏ inline.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb

const VAI_VAO = ['ads_user', 'ceo']
const TEN_VAI = { ads_user: 'Người chạy quảng cáo', ceo: 'CEO' }
let USER = null, DL = null
let PRESET = 7, TU = null, DEN = null
let SORT = { col: 'chi', dir: 'desc' }, HIEN_AN = false, KHOI_AD_MO = false, MO = new Set(), MOC = new Set()

const $ = id => document.getElementById(id)
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
// D · MỘT lối số kiểu Việt Nam cho TOÀN màn: nghìn = dấu chấm, thập phân = dấu phẩy.
const nfmt = n => (Number(n) || 0).toLocaleString('vi-VN')
const tien = n => { const x = Number(n); return (n != null && Number.isFinite(x)) ? x.toLocaleString('vi-VN') + 'đ' : '—' }
const so = n => n == null ? '—' : nfmt(n)
const pctTxt = n => n == null ? '—' : String(n).replace('.', ',') + '%'
// Câu từ RPC có số nhóm bằng DẤU PHẨY (to_char kiểu Mỹ) → đổi sang chấm; thập phân "X.Y" → "X,Y". Áp cho MỌI câu.
const dinhSo = s => String(s == null ? '' : s)
  .replace(/\d{1,3}(,\d{3})+/g, m => m.replace(/,/g, '.'))     // 627,123 → 627.123 · 1,234,567 → 1.234.567
  .replace(/(\d)\.(\d+)%/g, '$1,$2%')                          // 0.8% → 0,8%
const dmy = s => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); if (isNaN(d)) return '—'; const p = x => String(x).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) }
const iso = d => { const p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) }

// Đèn 5 trạng thái (WP-92): nhãn lời thường + màu áo (--gn/--am/--do/--xam). KHÔNG số trần.
const DEN_TT = {
  con_du: ['Còn dư', 'gn'], sat_tran: ['Sát mức', 'am'], vuot_tran: ['Vượt mức', 'do'],
  chua_du_so: ['Chưa đủ số', 'xam'], khong_do_duoc: ['Chưa đo được', 'xam']
}
// Objective → chữ người dùng (1d). Ngoài hai cái này → mã thô + badge, CẤM đoán nghĩa.
const OBJ = { OUTCOME_SALES: 'dẫn vào web', OUTCOME_ENGAGEMENT: 'tin nhắn' }

// ══════════ ĐĂNG NHẬP + CỔNG VAI ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML = '<div class="logo">📣</div><h1>Togihome Quảng cáo</h1><div class="sub">Tiền chạy quảng cáo — vào là thấy việc phải làm</div>' +
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
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app Quảng cáo.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro }
  capApp()
}
function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = 'block'
  $('hdTen').textContent = USER.ten || TEN_VAI[USER.vai_tro]; $('hdVai').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  $('btOut').onclick = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  datPreset(7)
}

// ══════════ KHOẢNG THỜI GIAN ══════════
function datPreset(n) {
  PRESET = n; const h = new Date(); DEN = iso(h)
  if (n === 'thang') { TU = iso(new Date(h.getFullYear(), h.getMonth(), 1)) }
  else if (n === 'chon') { /* giữ TU/DEN đang có, mở ô nhập */ }
  else { const t = new Date(h); t.setDate(t.getDate() - (n - 1)); TU = iso(t) }
  nap()
}

// ══════════ NẠP (nguồn số DUY NHẤT là RPC) ══════════
async function nap() {
  $('noi').innerHTML = '<div class="trong">Đang tải…</div>'
  const [bk, ss, vl, ad, dp, ng, tk, th] = await Promise.all([
    sb.rpc('ads_bang_ky', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_tong_so_sanh', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_viec_phai_lam', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_ad_ngay', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_do_phu', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.from('ads_nguong').select('gia_tri,hieu_luc_tu,hieu_luc_den').eq('ma', 'chi_so_ty_le_dang_ngo'),
    sb.from('ads_tai_khoan_brand').select('act_id,brand_id,ten_hien_thi').is('hieu_luc_den', null),
    sb.from('thuong_hieu_ban').select('ma,ten')
  ])
  const loi = [bk, ss, vl].find(x => x.error)
  if (loi) { $('noi').innerHTML = '<div class="ads-loi">Lỗi tải dữ liệu: ' + esc(loi.error.message) + '</div>'; return }
  const thMap = Object.fromEntries((th.data || []).map(x => [x.ma, x.ten]))
  // Cờ chi_so_ty_le_dang_ngo hiệu lực HÔM NAY: bật (=1) thì ẩn CTR/CPM/CPC (nguồn tỷ lệ đang ngờ).
  const homNay = DEN
  const ngRow = (ng.data || []).find(r => r.hieu_luc_tu <= homNay && (r.hieu_luc_den == null || homNay <= r.hieu_luc_den))
  const tyLeNgo = ngRow ? Number(ngRow.gia_tri) === 1 : false
  DL = { bk: bk.data, ss: ss.data, vl: vl.data, ad: ad.data || [], adErr: ad.error, dp: dp.data, tk: tk.data || [], thMap, tyLeNgo }
  render()
}

// ══════════ RENDER (thứ tự v2b) ══════════
function render() {
  const { bk, ss, vl, ad, dp, tk, thMap, tyLeNgo } = DL
  let dong = (bk.dong || []).slice()
  const anCount = dong.filter(d => d.co_an).length
  if (!HIEN_AN) dong = dong.filter(d => !d.co_an)
  // sort theo cột số
  const s = SORT
  dong.sort((a, b) => { const va = a[s.col], vb = b[s.col]; const na = va == null ? -Infinity : Number(va), nb = vb == null ? -Infinity : Number(vb); return s.dir === 'desc' ? nb - na : na - nb })

  const h = []
  h.push(khoiThoiGian())
  h.push(baOTrangThai(bk, tk, thMap))
  h.push(khoiTrungThuc(dp, vl))
  h.push(khoiViec(vl))
  h.push(khoiSoSanh(ss, tyLeNgo))
  h.push(khoiBang(dong, bk.tong, anCount))
  h.push(khoiMucAd(ad, DL.adErr))
  h.push(khoiChuGiai())
  h.push(khoiDeSau())
  $('noi').innerHTML = h.join('')

  // wiring
  $('noi').querySelectorAll('.ads-nut-tg').forEach(b => b.onclick = () => {
    const v = b.dataset.tg
    if (v === 'chon') { PRESET = 'chon'; render(); } else datPreset(v === 'thang' ? 'thang' : Number(v))
  })
  const bx = $('ads_xem'); if (bx) bx.onclick = () => { const t = $('ads_tu').value, d = $('ads_den').value; if (t && d) { TU = t; DEN = d; nap() } }
  $('noi').querySelectorAll('th.ads-sort').forEach(t => t.onclick = () => {
    const col = t.dataset.col; SORT = { col, dir: (SORT.col === col && SORT.dir === 'desc') ? 'asc' : 'desc' }; render()
  })
  const hn = $('ads_hien'); if (hn) hn.onclick = () => { HIEN_AN = !HIEN_AN; render() }
  const bt = $('btKhoiAd'); if (bt) bt.onclick = () => { KHOI_AD_MO = !KHOI_AD_MO; render() }
  $('noi').querySelectorAll('tr.cdrow').forEach(tr => tr.onclick = () => { const a = tr.dataset.cd; MOC.has(a) ? MOC.delete(a) : MOC.add(a); render() })
  $('noi').querySelectorAll('tr.adrow').forEach(tr => tr.onclick = () => { const a = tr.dataset.ad; MO.has(a) ? MO.delete(a) : MO.add(a); render() })
}

function khoiThoiGian() {
  const nut = [[7, '7 ngày'], [14, '14 ngày'], [30, '30 ngày'], ['thang', 'Tháng này'], ['chon', 'Chọn ngày']]
  let b = '<div class="ads-tg">'
  for (const [v, t] of nut) b += '<button class="ads-nut-tg' + (String(PRESET) === String(v) ? ' on' : '') + '" data-tg="' + v + '">' + t + '</button>'
  b += '<span class="ads-tg-khoang">' + dmy(TU) + ' → ' + dmy(DEN) + '</span>'
  if (PRESET === 'chon') b += '<span class="ads-tg-chon"><input id="ads_tu" type="date" value="' + esc(TU) + '"> → <input id="ads_den" type="date" value="' + esc(DEN) + '"><button id="ads_xem">Xem</button></span>'
  return b + '</div>'
}

function baOTrangThai(bk, tk, thMap) {
  const tong = bk.tong || {}
  const brands = [...new Set((tk || []).map(x => x.brand_id))]
  const brandTxt = brands.length === 1 ? (thMap[brands[0]] || brands[0]) : brands.map(b => thMap[b] || b).join(', ')
  const brandDong = (tk || []).length
    ? '<div class="ads-o-big">' + (tk.length) + ' tài khoản</div><div class="ads-o-sub">' + (brands.length === 1 ? 'đều thuộc ' : brands.length + ' thương hiệu: ') + esc(brandTxt) + '</div>'
    : '<div class="ads-o-big">—</div><div class="ads-o-sub">chưa map tài khoản</div>'
  return '<div class="ads-3o">' +
    '<div class="ads-o"><div class="ads-o-big num">' + tien(tong.chi) + '</div><div class="ads-o-sub">tổng chi khoảng này</div></div>' +
    '<div class="ads-o"><div class="ads-o-big num">' + so(tong.so_chien_dich) + '</div><div class="ads-o-sub">chiến dịch đang chạy</div></div>' +
    '<div class="ads-o">' + brandDong + '</div></div>'
}

function khoiTrungThuc(dp, vl) {
  let b = '<div class="thucte"><b>Chi phí</b> là số thật từ Meta (chưa rõ đã gồm VAT hay chưa). ' +
    '<b>Hiệu quả từng đồng CHƯA đo được:</b> quảng cáo đang chạy dẫn khách vào web, không gắn dấu lên hội thoại. ' +
    'Sẽ đo được khi bật đường nối đơn hàng.'
  // F2 · HAI số độ phủ có mốc rõ (ads_do_phu): khoảng đang xem vs toàn bộ từ 05/2020. KHÔNG để hai số trần trụi.
  if (dp && dp.khoang && dp.lich_su) {
    const k = dp.khoang, l = dp.lich_su
    b += '<span class="ads-phu-moc">Hội thoại có gắn mã quảng cáo (di sản quảng cáo tin nhắn đã tắt, không phải phần đo được của tiền đang chạy):' +
      '<br>• trong khoảng đang xem (' + dmy(k.tu) + '→' + dmy(k.den) + '): <b>' + pctTxt(k.pct) + '</b> (' + so(k.co_ma) + '/' + so(k.tong) + ')' +
      '<br>• toàn bộ từ 05/2020: <b>' + pctTxt(l.pct) + '</b> (' + so(l.co_ma) + '/' + so(l.tong) + ')</span>'
  }
  b += '</div>'
  // 1b · dòng cảnh báo gộp (canh_bao_gop). NULL → ẩn hẳn.
  const g = vl.canh_bao_gop
  if (g && g.so_chien_dich > 0) b += '<div class="ads-gop">' + g.so_chien_dich + ' chiến dịch đang tiêu <b class="num">' + tien(g.tong_chi) +
    '</b> nhưng chưa đo được hiệu quả vì dẫn khách vào web. Sẽ đo được khi bật đường nối đơn hàng.</div>'
  return b
}

function khoiViec(vl) {
  const v = vl.viec || []
  const TEN = { chi_cao_khong_hoi_thoai: 'Chi cao, chưa thấy hội thoại', chi_tang_dot_bien: 'Chi tăng đột biến', ad_moi_chua_du_ngay: 'Mới chạy, chưa đủ ngày', moi_bat: 'Mới bật trong kỳ' }
  let body = ''
  if (!v.length) body = '<div class="ads-viec-trong">Không có việc nào cần xử ngay trong khoảng này.</div>'
  else for (const x of v) body += '<div class="ads-viec-item"><span class="ads-viec-loai">' + esc(TEN[x.loai] || x.loai) + '</span><div class="ads-viec-cau">' + esc(dinhSo(x.cau)) + '</div></div>'
  return sec('1', 'Việc phải làm', '', body)
}

function khoiSoSanh(ss, tyLeNgo) {
  const a = ss.ky_nay || {}, b = ss.ky_truoc || {}, l = ss.lech_pct || {}, dd = ss.do_dai_ngay || ''
  const lechClient = (av, bv) => (bv != null && Number(bv) > 0 && av != null) ? Math.round((av - bv) / bv * 1000) / 10 : null
  const lechTxt = v => v == null ? '—' : (v > 0 ? '+' : '') + String(v).replace('.', ',') + '%'
  const lechCell = v => v == null ? '<td class="dash">—</td>' : '<td class="num ads-lech ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + lechTxt(v) + '</td>'
  // E · 6 dòng: chi · hiển thị · bấm vào link · CTR · CPM · CPC. Ba dòng tỷ lệ ẩn khi cờ chi_so_ty_le_dang_ngo bật.
  const rows6 = [
    { k: 'Chi', now: a.chi, prev: b.chi, lv: l.chi, f: tien, tyle: false },
    { k: 'Hiển thị', now: a.hien_thi, prev: b.hien_thi, lv: l.hien_thi, f: so, tyle: false },
    { k: 'Bấm vào link', now: a.luot_bam_link, prev: b.luot_bam_link, lv: lechClient(a.luot_bam_link, b.luot_bam_link), f: so, tyle: false },
    { k: 'CTR', now: a.ctr, prev: b.ctr, lv: l.ctr, f: pctTxt, tyle: true },
    { k: 'CPM', now: a.cpm, prev: b.cpm, lv: l.cpm, f: tien, tyle: true },
    { k: 'CPC', now: a.cpc, prev: b.cpc, lv: l.cpc, f: tien, tyle: true }
  ]
  const show = rows6.filter(r => !(r.tyle && tyLeNgo))
  const trs = show.map(r => '<tr><td>' + r.k + '</td><td class="num">' + r.f(r.now) + '</td><td class="num">' + r.f(r.prev) + '</td>' + lechCell(r.lv) + '</tr>').join('')
  const tbl = '<div class="ads-so2-tbl tblwrap"><table><thead><tr><th>Chỉ tiêu</th><th>' + dd + ' ngày qua</th><th>' + dd + ' ngày trước đó</th><th>Lệch</th></tr></thead><tbody>' + trs + '</tbody></table></div>'
  const cards = '<div class="ads-so2-cards">' + show.map(r =>
    '<div class="ads-so2-card"><div class="k">' + r.k + '</div><div class="now">' + r.f(r.now) + '</div><div class="prev">trước: ' + r.f(r.prev) + ' · ' + lechTxt(r.lv) + '</div></div>').join('') + '</div>'
  const note = tyLeNgo ? '<div class="ads-bang-note">CTR · CPM · CPC tạm ẩn: nguồn "bấm vào link" đang được rà lại, sẽ hiện lại khi xong.</div>' : ''
  return sec('2', 'So với kỳ liền trước', dd + ' ngày mỗi kỳ · theo ngày chi', tbl + cards + note)
}

function objCell(o) {
  const t = OBJ[o]
  return t ? esc(t) : '<span class="obj">' + esc(o || '—') + '</span>'
}
function tkCell(d) {
  const ten = d.ten_tai_khoan, id4 = d.act_id ? String(d.act_id).slice(-4) : ''
  if (!ten) return '<span class="adid">' + esc(d.act_id || '—') + '</span>'
  return esc(ten) + (id4 ? ' <span class="ads-tk-id">· …' + id4 + '</span>' : '')
}
function denCell(den) {
  const [ten, mau] = DEN_TT[den] || [den, 'xam']
  return '<td><span class="ads-den ads-den-' + mau + '"></span>' + esc(ten) + '</td>'
}
function thSort(col, ten) { const on = SORT.col === col; return '<th class="ads-sort r' + (on ? ' ads-on' : '') + '" data-col="' + col + '">' + ten + (on ? (SORT.dir === 'desc' ? ' ▾' : ' ▴') : '') + '</th>' }

function khoiBang(dong, tong, anCount) {
  let rows = ''
  for (const d of dong) {
    rows += '<tr class="cdrow" data-cd="' + esc(d.campaign_id) + '"><td>' + esc(d.campaign_name || d.campaign_id) + '</td>' +
      '<td>' + objCell(d.objective) + '</td><td>' + tkCell(d) + '</td>' +
      '<td class="num">' + tien(d.chi) + '</td><td class="num">' + so(d.luot_hien_thi) + '</td><td class="num">' + so(d.luot_bam) + '</td>' +
      '<td class="num">' + pctTxt(d.ctr) + '</td><td class="num">' + tien(d.cpm) + '</td><td class="num">' + tien(d.cpc) + '</td>' +
      denCell(d.den) + '</tr>'
  }
  const T = tong || {}
  const foot = '<tr class="ngoai"><td>TỔNG (' + so(T.so_chien_dich) + ' chiến dịch)</td><td></td><td></td>' +
    '<td class="num">' + tien(T.chi) + '</td><td class="num">' + so(T.luot_hien_thi) + '</td><td class="num">' + so(T.luot_bam) + '</td>' +
    '<td class="num">' + pctTxt(T.ctr) + '</td><td class="num">' + tien(T.cpm) + '</td><td class="num">' + tien(T.cpc) + '</td><td></td></tr>'
  const tbl = '<div class="ads-truc">chi/hiển thị/bấm: theo ngày chi</div><div class="ads-bang3 tblwrap"><table><thead><tr>' +
    '<th>Chiến dịch</th><th>Loại</th><th>Tài khoản</th>' +
    thSort('chi', 'Chi') + thSort('luot_hien_thi', 'Hiển thị') + thSort('luot_bam', 'Bấm vào link') +
    thSort('ctr', 'CTR') + thSort('cpm', 'CPM') + thSort('cpc', 'CPC') + '<th>Có khách</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="10" class="trong2">Không có chiến dịch chi trong khoảng này.</td></tr>') + '</tbody><tfoot>' + (dong.length ? foot : '') + '</tfoot></table></div>'
  // C · thẻ cho màn hẹp (<860px) — cùng số liệu, một thẻ mỗi chiến dịch
  const cardRow = (k, v) => '<div class="ads-card-row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'
  const cardHtml = dong.map(d => {
    const [dten, dmau] = DEN_TT[d.den] || [d.den, 'xam']
    return '<div class="ads-card"><div class="ads-card-top"><div>' +
      '<div class="ads-card-ten">' + esc(d.campaign_name || d.campaign_id) + '</div>' +
      '<div class="ads-card-meta">' + objCell(d.objective) + ' · ' + tkCell(d) + '</div></div>' +
      '<div class="ads-card-den"><span class="ads-den ads-den-' + dmau + '"></span>' + esc(dten) + '</div></div>' +
      cardRow('Chi', tien(d.chi)) + cardRow('Bấm vào link', so(d.luot_bam)) + cardRow('CTR', pctTxt(d.ctr)) + cardRow('CPM', tien(d.cpm)) + cardRow('CPC', tien(d.cpc)) +
      '</div>'
  }).join('')
  const cards = '<div class="ads-cards">' + (dong.length ? cardHtml : '<div class="ads-viec-trong">Không có chiến dịch chi trong khoảng này.</div>') + '</div>'
  // F1 · một dòng phân biệt bấm-link vs tổng lượt bấm
  const noteBam = '<div class="ads-bang-note">Cột <b>“Bấm vào link”</b> là lượt bấm vào đường dẫn. Tổng mọi lượt bấm (gồm thả cảm xúc, bình luận, bấm vào trang) nhiều hơn; CTR và CPC tính trên bấm vào link.</div>'
  let duoi = noteBam
  if (anCount > 0) duoi += '<div class="ads-hien-wrap">' + (HIEN_AN ? 'Đang hiện cả chiến dịch không chi. ' : 'Đang ẩn ' + anCount + ' chiến dịch không chi đồng nào. ') + '<a id="ads_hien" class="ads-hien">' + (HIEN_AN ? 'Ẩn lại' : 'Hiện cả') + '</a></div>'
  const cotDen = new Set(dong.map(d => d.den))
  if (dong.length && [...cotDen].every(x => x === 'chua_du_so' || x === 'khong_do_duoc'))
    duoi += '<div class="ads-den-lydo">Cả bảng đang "chưa đo được": các chiến dịch dẫn khách vào web nên chưa đo được hiệu quả từng đồng — sẽ đo được khi bật đường nối đơn hàng.</div>'
  return sec('3', 'Bảng chiến dịch', 'gộp theo loại chiến dịch', tbl + cards + duoi)
}

function khoiMucAd(ad, adErr) {
  let inner = ''
  if (KHOI_AD_MO) {
    if (adErr) inner = '<div class="ads-loi">Lỗi tải mức quảng cáo: ' + esc(adErr.message) + '</div>'
    else {
      const map = new Map()
      for (const r of ad) { const k = r.ad_id == null ? '__NG__' : r.ad_id; let g = map.get(k); if (!g) { g = { ad_id: r.ad_id, ngays: [], ht: 0, sdt: 0, chot: 0, giao: 0, tuN: r.ngay, denN: r.ngay }; map.set(k, g) } g.ngays.push(r); g.ht += r.so_hoi_thoai || 0; g.sdt += r.so_co_sdt || 0; g.chot += r.don_chot || 0; g.giao += r.don_giao || 0; if (r.ngay < g.tuN) g.tuN = r.ngay; if (r.ngay > g.denN) g.denN = r.ngay; g.ngays.sort((a, b) => a.ngay < b.ngay ? 1 : -1) }
      const ads = [...map.values()].filter(g => g.ad_id != null).sort((a, b) => b.ht - a.ht)
      let body = ''
      for (const g of ads) {
        const mo = MO.has(g.ad_id)
        body += '<tr class="adrow" data-ad="' + esc(g.ad_id) + '"><td class="adid">' + (mo ? '▾ ' : '▸ ') + esc(g.ad_id) + '</td><td>' + dmy(g.tuN) + (g.tuN !== g.denN ? '→' + dmy(g.denN) : '') + '</td>' +
          '<td class="num">' + so(g.ht) + '</td><td class="num">' + so(g.sdt) + '</td><td class="num">' + so(g.chot) + '</td><td class="num">' + so(g.giao) + '</td></tr>'
        if (mo) for (const d of g.ngays) body += '<tr class="ngayrow"><td class="adid ngayc">' + dmy(d.ngay) + '</td><td></td><td class="num">' + so(d.so_hoi_thoai) + '</td><td class="num">' + so(d.so_co_sdt) + '</td><td class="num">' + so(d.don_chot) + '</td><td class="num">' + so(d.don_giao) + '</td></tr>'
      }
      inner = '<div class="ads-truc">hội thoại: theo ngày khách nhắn</div><div class="tblwrap"><table><thead><tr><th>Mã quảng cáo</th><th>Khoảng ngày</th><th>Hội thoại</th><th>Có SĐT</th><th>Chốt</th><th>Đã giao</th></tr></thead><tbody>' +
        (body || '<tr><td colspan="6" class="trong2">Không có hội thoại quảng cáo trong khoảng này.</td></tr>') + '</tbody></table></div>'
    }
  }
  const h2 = '<h2><span class="n">4</span> <button class="mo-khoi" id="btKhoiAd">' + (KHOI_AD_MO ? '▾' : '▸') + ' Mức từng quảng cáo (ad)</button> <span class="h2sub">chỉ đúng cho quảng cáo tin nhắn — thu gọn</span></h2>'
  return '<div class="sec">' + h2 + inner + '</div>'
}

function khoiChuGiai() {
  const item = (k) => '<span class="ads-cg"><span class="ads-den ads-den-' + DEN_TT[k][1] + '"></span>' + DEN_TT[k][0] + '</span>'
  const g = '<div class="ads-cg-wrap">' + item('con_du') + item('sat_tran') + item('vuot_tran') + item('chua_du_so') + item('khong_do_duoc') + '</div>' +
    '<div class="ads-cg-note">"Chi phí có khách" so tiền bỏ ra với mức trần theo cỡ đơn khách mua. Còn dư / Sát mức / Vượt mức chỉ hiện khi đã có đơn thật quy về chiến dịch; hiện các chiến dịch dẫn web nên phần lớn là "Chưa đo được".</div>'
  return sec('5', 'Chú giải đèn', '', g)
}

function khoiDeSau() {
  return '<div class="sec"><h2><span class="n">6</span> Chỗ để sau</h2>' +
    '<div class="placeholder">🔒 <b>Tắt / nhân bản quảng cáo</b> — cần đơn theo chiến dịch để có ngưỡng quyết định. <b>Sẽ mở khi bật đường nối đơn hàng.</b>' +
    '<div class="ph2">Vẽ chỗ trống có tên còn hơn để người dùng tưởng app quên việc chính. Nút không ra quyết định được là nút lừa.</div></div></div>'
}

function sec(n, ten, sub, body) {
  return '<div class="sec"><h2><span class="n">' + n + '</span> ' + esc(ten) + (sub ? ' <span class="h2sub">' + esc(sub) + '</span>' : '') + '</h2>' + body + '</div>'
}

// ══════════ KHỞI ĐỘNG ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data && data.session) laySauDangNhap(data.session.user); else manDangNhap()
})()
