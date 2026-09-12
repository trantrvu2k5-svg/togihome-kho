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
let MAN = 'thuvien'   // [WP-107] màn đang xem (cột trái): thuvien|tongquan|ngay|nentang|chiendich|viec
let FILTER_PAGE = 'all'   // [WP-107 L-1i] lọc thư viện theo page_id THẬT: 'all' | <page_id> | 'null' (chưa rõ page)
// [WP-107 L-1i] NHÃN hiển thị trang (label UI, KHÔNG phải số liệu) — page_id → tên. Trang lạ → "Trang …ID".
const TEN_TRANG = { '576847645509797': 'Sophia Concept', '279205171948766': 'OpenLiving', '223920510804703': 'Togihome - TailorNest' }
const tenTrang = pid => pid ? (TEN_TRANG[pid] || ('Trang …' + String(pid).slice(-4))) : 'Chưa rõ page'
let BRAND = 'all'   // [WP-108] lọc TOÀN APP theo thương hiệu: 'all' | <brand_id> | 'chua_ro'
const brandOfPage = pid => { const r = (DL.tk || []).find(t => t.page_id === pid); return r ? r.brand_id : null }
// mẫu (có page_id) hợp thương hiệu đang chọn? · dòng có sẵn field brand ('chưa rõ') hợp không?
const hopBrandPage = pid => BRAND === 'all' ? true : (BRAND === 'chua_ro' ? !brandOfPage(pid) : brandOfPage(pid) === BRAND)
const hopBrandRow  = b   => BRAND === 'all' ? true : (BRAND === 'chua_ro' ? (b == null || b === 'chưa rõ') : b === BRAND)
// [WP-108] tổng footer bảng chiến dịch tính LẠI từ dòng đã lọc brand (khớp công thức RPC: bấm=luot_bam_link)
const tongTuDong = ds => {
  const chi = ds.reduce((s, d) => s + Number(d.chi || 0), 0), ht = ds.reduce((s, d) => s + Number(d.luot_hien_thi || 0), 0)
  const lbl = ds.reduce((s, d) => s + Number(d.luot_bam || 0), 0), lb = ds.reduce((s, d) => s + Number(d.luot_bam_tong || 0), 0)
  return { chi, luot_hien_thi: ht, luot_bam: lbl, luot_bam_tong: lb,
    ctr: ht > 0 && lbl ? Math.round(lbl * 100 / ht * 100) / 100 : null, cpm: ht > 0 ? Math.round(chi * 1000 / ht) : null,
    cpc: lbl > 0 ? Math.round(chi / lbl) : null, so_chien_dich: ds.filter(d => Number(d.chi || 0) > 0).length }
}

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
  // [WP-107] chân cột trái: vai (đậm) + phạm vi xem
  $('hdTen').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  $('hdVai').textContent = USER.vai_tro === 'ceo' ? 'Xem mọi tài khoản' : (USER.ten || '')
  $('btOut').onclick = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  // [WP-107] cột trái: bấm mục → đổi màn bên phải (bind MỘT lần, nav ngoài #noi)
  document.querySelectorAll('.ads-muc').forEach(b => b.onclick = () => {
    document.querySelectorAll('.ads-muc').forEach(x => x.classList.remove('chon'))
    b.classList.add('chon'); MAN = b.dataset.man; render()
  })
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
  // [WP-108 nhịp 3] BRAND → p_brand cho RPC lọc SERVER (So sánh · FB/IG). 'all'→null · 'chua_ro'→'chưa rõ'
  const pBrand = BRAND === 'all' ? null : (BRAND === 'chua_ro' ? 'chưa rõ' : BRAND)
  const [bk, ss, vl, ad, dp, ng, tk, th, ttk, sk, std, nt, mau, mauTt, tok] = await Promise.all([
    sb.rpc('ads_bang_ky', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_tong_so_sanh', { p_tu_ngay: TU, p_den_ngay: DEN, p_brand: pBrand }),
    sb.rpc('ads_viec_phai_lam', { p_tu_ngay: TU, p_den_ngay: DEN, p_brand: pBrand }),   // [WP-113] lọc brand SERVER cho dòng mới+cũ
    sb.rpc('ads_ad_ngay', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.rpc('ads_do_phu', { p_tu_ngay: TU, p_den_ngay: DEN }),
    sb.from('ads_nguong').select('gia_tri,hieu_luc_tu,hieu_luc_den').eq('ma', 'chi_so_ty_le_dang_ngo'),
    sb.from('ads_trang_brand').select('page_id,brand_id,ten_hien_thi').is('hieu_luc_den', null),   // [WP-108] khoá TRANG
    sb.from('thuong_hieu_ban').select('ma,ten'),
    sb.rpc('ads_tinh_trang_keo'),   // [WP-91] đèn ĐỘ PHỦ + trễ-giờ (RPC thứ 5). Hỏng/rỗng → dải xám, KHÔNG ẩn.
    sb.rpc('ads_suc_khoe_mau', { p_tu_ngay: TU, p_den_ngay: DEN }),   // [WP-100] sức khoẻ mẫu
    sb.rpc('ads_thay_doi_gan_day', { p_so_dong: 50 }),                // [WP-100] sổ thay đổi Meta · [L-108-6] 15→50, khung cuộn
    sb.rpc('chi_ads_nen_tang_tong', { p_tu_ngay: TU, p_den_ngay: DEN, p_brand: pBrand }), // [WP-100] tách FB/IG · [WP-108] +brand
    sb.rpc('ads_mau_ds'),         // [WP-103] thư viện mẫu (creative)
    sb.rpc('ads_mau_tom_tat'),    // [WP-103] tóm tắt: tổng mẫu · fanpage · chưa rõ page · tài khoản
    sb.rpc('meta_token_trang_thai')   // [L-108-7] hạn token Meta (đèn màn Việc phải làm) — nguồn: tham_so_van_hanh
  ])
  const loi = [bk, ss, vl].find(x => x.error)
  if (loi) { $('noi').innerHTML = '<div class="ads-loi">Lỗi tải dữ liệu: ' + esc(loi.error.message) + '</div>'; return }
  const thMap = Object.fromEntries((th.data || []).map(x => [x.ma, x.ten]))
  // Cờ chi_so_ty_le_dang_ngo hiệu lực HÔM NAY: bật (=1) thì ẩn CTR/CPM/CPC (nguồn tỷ lệ đang ngờ).
  // [L-108-14] cờ "nguồn tỷ lệ đang ngờ" là trạng thái NGUỒN HÔM NAY, KHÔNG theo khoảng đang xem.
  //   Trước lấy homNay=DEN → xem tháng 6 (DEN<02/09) trúng cờ CŨ =1 → ẩn CTR/CPM/CPC dù nguồn đã sửa (db/208, cờ=0 từ 02/09).
  const homNay = iso(new Date())
  const ngRow = (ng.data || []).find(r => r.hieu_luc_tu <= homNay && (r.hieu_luc_den == null || homNay <= r.hieu_luc_den))
  const tyLeNgo = ngRow ? Number(ngRow.gia_tri) === 1 : false
  const okD = r => (r && r.error) ? null : (r && r.data)   // RPC lỗi/rỗng → null (khối tự hiện dải xám, KHÔNG ẩn)
  DL = { bk: bk.data, ss: ss.data, vl: vl.data, ad: ad.data || [], adErr: ad.error, dp: dp.data, tk: tk.data || [], thMap, tyLeNgo,
    ttk: okD(ttk), sk: okD(sk), std: okD(std), nt: okD(nt), mau: okD(mau), mauTt: okD(mauTt), tok: okD(tok) }
  render()
}

// ══════════ RENDER (thứ tự v2b) ══════════
function render() {
  const { bk, ss, vl, ad, dp, tk, thMap, tyLeNgo, ttk, sk, std, nt, mau, mauTt } = DL
  // [WP-107] cột trái đổi màn: chỉ dựng nội dung của MÀN ĐANG XEM. 5 màn cũ GIỮ NGUYÊN section đang chạy,
  //   chia đủ để KHÔNG mất chức năng: mọi khối cũ đều nằm trong đúng một màn.
  // [WP-108 nhịp 3] 6 MÀN — mỗi màn TRẢ LỜI MỘT CÂU. Bỏ số toàn cục 1–8; số lại theo từng màn. Bỏ "Để sau".
  const h = []
  h.push(boChonBrand(tk, thMap))   // bộ chọn thương hiệu — ĐẦU APP, lọc mọi màn
  const coPicker = MAN === 'tongquan' || MAN === 'chiendich' || MAN === 'nentang' || MAN === 'viec'
  if (coPicker) h.push(khoiThoiGian())
  if (MAN === 'thuvien') {                      // MẪU NÀO CHẠY, MẪU NÀO MỎI CẦN THAY
    h.push(khoiThuVienMau(mau, mauTt)); h.push(khoiSucKhoe(sk))
  } else if (MAN === 'tongquan') {              // KỲ NÀY HƠN KÉM KỲ TRƯỚC
    h.push(baOTrangThai(bk, tk, thMap)); h.push(khoiTrungThuc(dp, vl, bk)); h.push(khoiSoSanh(ss, tyLeNgo)); h.push(khoiDenPhu(ttk)); h.push(khoiChuGiai())
  } else if (MAN === 'chiendich') {             // TIỀN VÀO CHIẾN DỊCH NÀO
    let dong = (bk.dong || []).filter(d => hopBrandRow(d.brand))
    const anCount = dong.filter(d => d.co_an).length
    if (!HIEN_AN) dong = dong.filter(d => !d.co_an)
    const s = SORT
    dong.sort((a, b) => { const va = a[s.col], vb = b[s.col]; const na = va == null ? -Infinity : Number(va), nb = vb == null ? -Infinity : Number(vb); return s.dir === 'desc' ? nb - na : na - nb })
    h.push(khoiBang(dong, BRAND === 'all' ? bk.tong : tongTuDong(dong), anCount))
    h.push(khoiMucAd((ad || []).filter(a => hopBrandRow(a.brand)), DL.adErr))
  } else if (MAN === 'nentang') {               // NỀN TẢNG NÀO ĂN TIỀN (lọc server theo p_brand)
    const tongBrandNT = (bk.dong || []).filter(d => hopBrandRow(d.brand)).reduce((s, d) => s + Number(d.chi || 0), 0)
    h.push(khoiNenTang(nt, tongBrandNT))   // [L-108-13] truyền Σ chính (brand) để dựng dòng "chưa tách"
  } else if (MAN === 'viec') {                  // HÔM NAY PHẢI XỬ LÝ CÁI GÌ
    h.push(khoiViec(vl, DL.tok))
  } else if (MAN === 'sothaydoi') {             // AI VỪA SỬA GÌ
    h.push(khoiSoThayDoi(std))
  }
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
  // [WP-103] ảnh Meta hỏng/hết hạn → khung xám có chữ (không vỡ lưới) — bind ở đây để tránh onerror inline (CSP)
  $('noi').querySelectorAll('.ads-mau-img').forEach(im => im.onerror = () => { im.style.display = 'none'; im.parentNode.setAttribute('data-hong', '1') })
  // [WP-107 L-1i] lọc thư viện theo TRANG → đổi FILTER_PAGE rồi render lại (ô tóm tắt + lưới đổi theo)
  $('noi').querySelectorAll('.ads-mau-loc').forEach(b => b.onclick = () => { FILTER_PAGE = b.dataset.page; render() })
  // [WP-108] bộ chọn thương hiệu → đổi BRAND, NẠP LẠI (So sánh + FB/IG lọc server theo p_brand; các màn khác lọc client)
  $('noi').querySelectorAll('.ads-brand').forEach(b => b.onclick = () => { BRAND = b.dataset.brand; nap() })
  // [WP-107 L-1c] chip "N ảnh" → mở khay dải xoay vòng; ✕ / nền → đóng
  const modalDai = $('ads-mau-dai')
  if (modalDai) {
    const ds = modalDai.querySelector('.ads-mau-dai-ds')
    const dong = () => { modalDai.hidden = true; ds.innerHTML = '' }
    $('noi').querySelectorAll('.ads-mau-chip-dai').forEach(ch => ch.onclick = () => {
      let urls = []; try { urls = JSON.parse(ch.dataset.dai) } catch (e) {}
      ds.innerHTML = urls.map(u => '<img src="' + String(u).replace(/"/g, '&quot;') + '" alt="" loading="lazy">').join('')
      modalDai.hidden = false
    })
    modalDai.querySelector('.ads-mau-dai-x').onclick = dong
    modalDai.onclick = e => { if (e.target === modalDai) dong() }
  }
}

function khoiThoiGian() {
  const nut = [[7, '7 ngày'], [14, '14 ngày'], [30, '30 ngày'], ['thang', 'Tháng này'], ['chon', 'Chọn ngày']]
  let b = '<div class="ads-tg">'
  for (const [v, t] of nut) b += '<button class="ads-nut-tg' + (String(PRESET) === String(v) ? ' on' : '') + '" data-tg="' + v + '">' + t + '</button>'
  b += '<span class="ads-tg-khoang">' + dmy(TU) + ' → ' + dmy(DEN) + '</span>'
  if (PRESET === 'chon') b += '<span class="ads-tg-chon"><input id="ads_tu" type="date" value="' + esc(TU) + '"> → <input id="ads_den" type="date" value="' + esc(DEN) + '"><button id="ads_xem">Xem</button></span>'
  return b + '</div>'
}

// [WP-108] BỘ CHỌN THƯƠNG HIỆU — dựng động từ ads_trang_brand (biến tk). Nhãn = ten_hien_thi trang.
function boChonBrand(tk, thMap) {
  const bmap = {}
  for (const t of (tk || [])) if (t.brand_id && !bmap[t.brand_id]) bmap[t.brand_id] = t.ten_hien_thi || (thMap && thMap[t.brand_id]) || t.brand_id
  const btn = (val, label) => '<button class="ads-brand' + (BRAND === val ? ' on' : '') + '" data-brand="' + esc(val) + '">' + esc(label) + '</button>'
  return '<div class="ads-brand-bar"><span class="ads-brand-nhan">Thương hiệu</span>' +
    btn('all', 'Mọi thương hiệu') + Object.keys(bmap).map(b => btn(b, bmap[b])).join('') + btn('chua_ro', 'Chưa rõ') + '</div>'
}

function baOTrangThai(bk, tk, thMap) {
  // [WP-108] tính lại theo BRAND từ bk.dong (mỗi chiến dịch có .brand). "Tài khoản" = TK THỰC CHI (distinct act_id), KHÔNG đếm bảng gán.
  const dong = (bk.dong || []).filter(d => hopBrandRow(d.brand))
  const chi = dong.reduce((s, d) => s + Number(d.chi || 0), 0)
  const soCd = dong.filter(d => Number(d.chi || 0) > 0).length
  const soTk = new Set(dong.map(d => d.act_id).filter(Boolean)).size
  const phu = BRAND === 'all' ? 'tài khoản thực chi' : (BRAND === 'chua_ro' ? 'chưa rõ thương hiệu' : esc(thMap[BRAND] || BRAND))
  return '<div class="ads-3o">' +
    '<div class="ads-o"><div class="ads-o-big num">' + tien(chi) + '</div><div class="ads-o-sub">tổng chi khoảng này</div></div>' +
    '<div class="ads-o"><div class="ads-o-big num">' + so(soCd) + '</div><div class="ads-o-sub">chiến dịch có chi</div></div>' +
    '<div class="ads-o"><div class="ads-o-big num">' + so(soTk) + ' tài khoản</div><div class="ads-o-sub">' + phu + '</div></div></div>'
}

function khoiTrungThuc(dp, vl, bk) {
  const loc = BRAND !== 'all'
  let b = '<div class="thucte"><b>Chi phí</b> là số thật từ Meta (chưa rõ đã gồm VAT hay chưa). ' +
    '<b>Hiệu quả từng đồng CHƯA đo được:</b> quảng cáo đang chạy dẫn khách vào web, không gắn dấu lên hội thoại. ' +
    'Sẽ đo được khi bật đường nối đơn hàng.'
  // F2 · HAI số độ phủ có mốc (ads_do_phu). [L-108-6] hội thoại di sản KHÔNG tách được theo brand → ghi rõ "toàn hệ".
  if (dp && dp.khoang && dp.lich_su) {
    const k = dp.khoang, l = dp.lich_su
    const nhan = loc ? ' <b class="ads-toan-he">(toàn hệ, chưa tách theo thương hiệu)</b>' : ''
    b += '<span class="ads-phu-moc">Hội thoại có gắn mã quảng cáo (di sản quảng cáo tin nhắn đã tắt, không phải phần đo được của tiền đang chạy)' + nhan + ':' +
      '<br>• trong khoảng đang xem (' + dmy(k.tu) + '→' + dmy(k.den) + '): <b>' + pctTxt(k.pct) + '</b> (' + so(k.co_ma) + '/' + so(k.tong) + ')' +
      '<br>• toàn bộ từ 05/2020: <b>' + pctTxt(l.pct) + '</b> (' + so(l.co_ma) + '/' + so(l.tong) + ')</span>'
  }
  b += '</div>'
  // 1b · dòng "đang tiêu" — [L-108-6] TÍNH LẠI theo BRAND đang chọn (từ bk.dong đã lọc), KHÔNG để số toàn hệ.
  const dongB = ((bk && bk.dong) || []).filter(d => hopBrandRow(d.brand) && Number(d.chi || 0) > 0)
  const soCd = dongB.length, tongChi = dongB.reduce((s, d) => s + Number(d.chi || 0), 0)
  if (soCd > 0) b += '<div class="ads-gop">' + soCd + ' chiến dịch đang tiêu <b class="num">' + tien(tongChi) +
    '</b> nhưng chưa đo được hiệu quả vì dẫn khách vào web. Sẽ đo được khi bật đường nối đơn hàng.</div>'
  return b
}

function khoiViec(vl, tok) {
  // [L-108-6] MÀN QUAN TRỌNG NHẤT — không được rỗng. Hiện ĐỦ 4 loại: loại KÊU (có việc) + loại IM (ghi điều kiện kích hoạt).
  const v = vl.viec || [], ng = vl.nguong || {}
  // [L-108-7] ĐÈN TOKEN META: <14 ngày = KÊU (nổi), còn nhiều = MỜ kèm số ngày. Ngày hết hạn từ tham_so_van_hanh (một chỗ).
  let tokenHtml = ''
  if (tok && tok.con_ngay != null) {
    const n = Number(tok.con_ngay), keu = n < 14
    tokenHtml = '<div class="ads-viec-item' + (keu ? '' : ' im') + '"><span class="ads-viec-loai' + (keu ? '' : ' im') + '">Token Meta</span>' +
      '<div class="ads-viec-cau' + (keu ? '' : ' im') + '">' + (keu
        ? '⚠ Token Meta còn <b>' + n + ' ngày</b> (hết hạn ' + esc(tok.han) + ') — XIN TOKEN MỚI, hết hạn là bộ kéo đứng câm.'
        : 'Còn ' + n + ' ngày (hết hạn ' + esc(tok.han) + '). Sẽ kêu khi dưới 14 ngày.') + '</div></div>'
  }
  const CATS = [
    { loai: 'chi_cao_khong_hoi_thoai', ten: 'Chi cao, chưa thấy hội thoại', dk: 'chiến dịch tiêu > ' + tien(ng.chi_cao_khong_hoi_thoai) + ' mà 0 hội thoại' },
    { loai: 'chi_tang_dot_bien', ten: 'Chi tăng đột biến', dk: 'chi tăng vượt nhịp chung của cả tài khoản' + (vl.nhip_chung_pct != null ? ' (kỳ này +' + vl.nhip_chung_pct + '%)' : '') },
    { loai: 'ad_moi_chua_du_ngay', ten: 'Mới chạy, chưa đủ ngày', dk: 'quảng cáo mới chạy dưới ' + (ng.ad_moi_du_ngay || 3) + ' ngày, chưa đủ để đọc' },
    { loai: 'moi_bat', ten: 'Mới bật trong kỳ', dk: 'chiến dịch mới bật, chưa có kỳ trước để so' }
  ]
  const byLoai = {}; for (const x of v) (byLoai[x.loai] = byLoai[x.loai] || []).push(x)
  // [WP-113 L-113-4] dòng MỚI dùng đúng khuôn cũ: nhãn + câu, kêu→đậm, im→mờ; danh sách ten_chien_dich gập dưới câu.
  const NHAN = { keo_do: 'Số Meta thiếu', loi_web: 'Lỗi web', mau_can_doi: 'Mẫu cần đổi', gia_cuoc_tro_chuyen_cao: 'Giá cuộc trò chuyện cao' }
  const itemNew = (x, ten) => {
    const keu = x.keu !== false
    const list = (x.ten_chien_dich && x.ten_chien_dich.length)
      ? '<details class="ads-viec-mo"><summary>mở bảng xem từng cái (' + x.ten_chien_dich.length + ')</summary><ul class="ads-viec-ds">' + x.ten_chien_dich.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></details>' : ''
    return '<div class="ads-viec-item' + (keu ? '' : ' im') + '"><span class="ads-viec-loai' + (keu ? '' : ' im') + '">' + esc(ten) +
      '</span><div class="ads-viec-cau' + (keu ? '' : ' im') + '">' + esc(dinhSo(x.cau)) + list + '</div></div>'
  }
  // keo_do LUÔN đứng đầu
  let head = ''; for (const x of (byLoai['keo_do'] || [])) head += itemNew(x, NHAN.keo_do)
  let body = ''
  for (const c of CATS) {
    const hit = byLoai[c.loai]
    if (hit) for (const x of hit) body += '<div class="ads-viec-item"><span class="ads-viec-loai">' + esc(c.ten) + '</span><div class="ads-viec-cau">' + esc(dinhSo(x.cau)) + '</div></div>'
    else body += '<div class="ads-viec-item im"><span class="ads-viec-loai im">' + esc(c.ten) + '</span><div class="ads-viec-cau im">Không có. Kêu khi: ' + esc(c.dk) + '.</div></div>'
  }
  // loi_web · mau_can_doi · gia_cuoc_tro_chuyen_cao theo THỨ TỰ hàm trả
  let newBody = ''
  for (const x of v) if (NHAN[x.loai] && x.loai !== 'keo_do') newBody += itemNew(x, NHAN[x.loai])
  const nhip = '<div class="ads-viec-nhip im">Nhịp tuần: thứ 2 đọc trang này, mỗi lần sửa một thứ và ghi Sổ thay đổi; thứ 5 kiểm lại, không tốt thì đảo lại.</div>'
  return sec('1', 'Việc phải làm', 'kêu khi vượt ngưỡng · mục mờ = đang im, kèm điều kiện', head + body + newBody + tokenHtml + nhip)
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
  // [L-108-14] kỳ trước KHÔNG CÓ DỮ LIỆU (không phải chi 0đ) → cột trước "chưa có dữ liệu", cột lệch gạch ngang.
  const prevTrong = !!b.khong_co_du_lieu
  const pF = r => prevTrong ? '<span class="ads-kodo">—</span>' : r.f(r.prev)
  const lF = r => prevTrong ? '<td class="dash">—</td>' : lechCell(r.lv)
  const trs = show.map(r => '<tr><td>' + r.k + '</td><td class="num">' + r.f(r.now) + '</td><td class="num">' + pF(r) + '</td>' + lF(r) + '</tr>').join('')
  const tbl = '<div class="ads-so2-tbl tblwrap"><table><thead><tr><th>Chỉ tiêu</th><th>' + dd + ' ngày qua</th><th>' + dd + ' ngày trước đó</th><th>Lệch</th></tr></thead><tbody>' + trs + '</tbody></table></div>'
  const cards = '<div class="ads-so2-cards">' + show.map(r =>
    '<div class="ads-so2-card"><div class="k">' + r.k + '</div><div class="now">' + r.f(r.now) + '</div><div class="prev">trước: ' + (prevTrong ? 'chưa có dữ liệu' : r.f(r.prev) + ' · ' + lechTxt(r.lv)) + '</div></div>').join('') + '</div>'
  const note = tyLeNgo ? '<div class="ads-uoctinh">⚠ CTR · CPM · CPC đang ẩn theo cờ <b>chi_so_ty_le_dang_ngo</b> (nghi nguồn bấm-vào-link sai). Việc phải làm: xác minh nguồn rồi TẮT cờ (ads_nguong) mới hiện lại.</div>' : ''
  const noteData = prevTrong ? '<div class="ads-bang-note">Kỳ trước (' + dmy(b.tu) + '→' + dmy(b.den) + ') <b>CHƯA CÓ DỮ LIỆU</b> — hệ chỉ có chi từ 01/06/2026 (mốc kéo). Không so được, cột lệch để trống — KHÔNG lấy 0 làm nền.</div>' : ''
  return sec('1', 'So với kỳ liền trước', dd + ' ngày mỗi kỳ · theo ngày chi', tbl + cards + note + noteData)
}

// [WP-91] ĐÈN ĐỘ PHỦ — dải mỏng NGAY TRÊN khối tổng. Nguồn: ads_tinh_trang_keo() (KHÔNG tính lại ở FE).
//   Màu KHÔNG đứng một mình: mỗi dải có icon hình + chữ nói rõ nghĩa (người mù màu vẫn đọc được).
function khoiDenPhu(tt) {
  const hm = s => { const d = new Date(s); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
  const dm = s => { const d = new Date(s); return isNaN(d) ? '' : String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') }
  // B · RPC hỏng/rỗng → dải XÁM, KHÔNG ẩn (ẩn khi hỏng = quay lại bệnh cũ im lặng)
  if (!tt || !tt.do_phu) return '<div class="ads-dophu ads-dophu-xam"><span class="ads-dophu-ic">○</span><b>Không đọc được tình trạng kéo số.</b></div>'
  const dp = tt.do_phu, kh = (dp.khoang_thieu || []).join(', ')
  let cls, txt
  if (dp.dai_du_so === 'chua_co_du_lieu') { cls = 'xam'; txt = 'Chưa kéo lần nào.' }
  else if (dp.dai_du_so === 'xanh') { cls = 'xanh'; txt = 'Số ads đủ tới ' + dm(dp.ngay_du_lieu_moi_nhat) + '.' }
  else if (dp.dai_du_so === 'vang') { cls = 'vang'; txt = 'Thiếu ' + dp.thieu_so_ngay + ' ngày: ' + kh + '. Số dưới đây đang thấp hơn thực tế.' }
  else { cls = 'do'; txt = 'Thiếu ' + dp.thieu_so_ngay + ' ngày: ' + kh + '. ĐỪNG dùng số dưới đây để quyết.' }
  // [L-108-14] TÁCH HAI CHUYỆN: (1) độ phủ dữ liệu · (2) tình trạng lần kéo cuối — mỗi cái MỘT DÒNG.
  const loi = (tt.nguon || []).map(n => n.loi_gan_nhat).find(Boolean)
  const xong = (tt.nguon || []).map(n => n.lan_xong_luc).filter(Boolean).sort().pop()
  // đủ số (xanh) NHƯNG lần kéo cuối lỗi → đèn VÀNG (không xanh): màu phản ánh cả kéo-lỗi, không chỉ độ phủ.
  if (cls === 'xanh' && loi) cls = 'vang'
  const ic = { xanh: '●', vang: '▲', do: '■', xam: '○' }[cls]
  const keoLine = loi
    ? '<div class="ads-dophu-sub ads-dophu-loi">⚠ Lần kéo cuối lúc ' + hm(loi.luc) + ' ngày ' + dm(loi.luc) + ' BỊ LỖI — số có thể chưa mới nhất.</div>'
    : (xong ? '<div class="ads-dophu-sub">Lần kéo cuối XONG lúc ' + hm(xong) + ' ngày ' + dm(xong) + '.</div>' : '')
  return '<div class="ads-dophu ads-dophu-' + cls + '"><div class="ads-dophu-hang"><span class="ads-dophu-ic">' + ic + '</span><b>Độ phủ: ' + esc(txt) + '</b></div>' + keoLine + '</div>'
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

// [WP-113 L-113-4] số hiển thị dạng tỉ lệ "lượt vào / 100 bấm" (số thường, KHÔNG %). NULL → "—".
function ratCell(d) {
  const rat = n => n == null ? '—' : String(n).replace('.', ',')
  const chuaTin = d.so_pixel_chua_tin === true || d.web_chua_co_su_kien_lien_he === 'chua_tin'
  const note = '<span class="ads-note-nho">pixel chưa tin (sửa 11/09)</span>'
  if (chuaTin) return '<td class="num ads-mo">' + rat(d.toi_trang_100_bam) + ' ' + note + '</td>'
  if (d.toi_trang_100_bam != null && Number(d.toi_trang_100_bam) < 70)
    return '<td class="num ads-do-so">' + rat(d.toi_trang_100_bam) + ' <span class="ads-note-nho">lỗi web</span></td>'
  return '<td class="num">' + rat(d.toi_trang_100_bam) + '</td>'
}
function webCols(d) {   // 4 cột web: Tới trang/100 bấm · Giá 1 lượt vào · Lượt liên hệ · Giá 1 liên hệ
  const chuaTin = d.so_pixel_chua_tin === true || d.web_chua_co_su_kien_lien_he === 'chua_tin'
  const khong = d.web_chua_co_su_kien_lien_he === 'khong'
  const note = '<span class="ads-note-nho">pixel chưa tin (sửa 11/09)</span>'
  const g1v = chuaTin ? '<td class="num ads-mo">' + tien(d.gia_1_luot_vao) + ' ' + note + '</td>' : '<td class="num">' + tien(d.gia_1_luot_vao) + '</td>'
  let llh
  if (khong) llh = '<td class="num">' + so(d.luot_lien_he) + ' <span class="ads-note-nho">chỉ tính nhắn trên quảng cáo</span></td>'
  else if (chuaTin) llh = '<td class="num ads-mo">' + so(d.luot_lien_he) + ' ' + note + '</td>'
  else llh = '<td class="num">' + so(d.luot_lien_he) + '</td>'
  let g1l
  if (khong) g1l = '<td class="num">—</td>'
  else if (chuaTin) g1l = '<td class="num ads-mo">' + tien(d.gia_1_lien_he) + '</td>'
  else g1l = '<td class="num">' + tien(d.gia_1_lien_he) + '</td>'
  return ratCell(d) + g1v + llh + g1l
}

function cotTyleFoot(ds) {   // ô CTR/CPM/CPC của dòng TỔNG một bảng (tính từ nhóm)
  const ht = ds.reduce((s, d) => s + Number(d.luot_hien_thi || 0), 0)
  const lbl = ds.reduce((s, d) => s + Number(d.luot_bam || 0), 0)
  const chi = ds.reduce((s, d) => s + Number(d.chi || 0), 0)
  const ctr = ht > 0 ? Math.round(lbl * 10000 / ht) / 100 : null
  const cpm = ht > 0 ? Math.round(chi * 1000 / ht) : null
  const cpc = lbl > 0 ? Math.round(chi / lbl) : null
  return '<td class="num">' + pctTxt(ctr) + '</td><td class="num">' + tien(cpm) + '</td><td class="num">' + tien(cpc) + '</td>'
}
function khoiBang(dong, tong, anCount) {
  const web = dong.filter(d => d.loai_chien_dich === 'dan_vao_web')
  const nhan = dong.filter(d => d.loai_chien_dich === 'nhan_tin')
  const chuaXep = dong.filter(d => d.loai_chien_dich === 'chua_xep')
  const sumChi = ds => ds.reduce((s, d) => s + Number(d.chi || 0), 0)
  const cot3 = d => '<td>' + esc(d.campaign_name || d.campaign_id) +
    (d.dang_chay === false ? '<div class="ads-datat">đã tắt · chi cuối ' + dmy(d.ngay_chi_cuoi) + '</div>' : '') +
    '</td><td>' + objCell(d.objective) + '</td><td>' + tkCell(d) + '</td>'
  const demTat = ds => { const c = ds.filter(d => d.dang_chay === true).length, t = ds.filter(d => d.dang_chay === false).length
    return '<div class="ads-dem-tat">' + c + ' đang chạy · ' + t + ' đã tắt trong kỳ</div>' }
  const cot123 = d => '<td class="num">' + tien(d.chi) + '</td><td class="num">' + so(d.luot_hien_thi) + '</td><td class="num">' + so(d.luot_bam) + '</td>'
  const cotTyle = d => '<td class="num">' + pctTxt(d.ctr) + '</td><td class="num">' + tien(d.cpm) + '</td><td class="num">' + tien(d.cpc) + '</td>'
  const footN = (ds, extra) => { const T = { chi: sumChi(ds), ht: ds.reduce((s, d) => s + Number(d.luot_hien_thi || 0), 0), lb: ds.reduce((s, d) => s + Number(d.luot_bam || 0), 0) }
    return '<tr class="ngoai"><td>TỔNG (' + ds.length + ' chiến dịch)</td><td></td><td></td><td class="num">' + tien(T.chi) + '</td><td class="num">' + so(T.ht) + '</td><td class="num">' + so(T.lb) + '</td>' + extra + '</tr>' }
  // Bảng DẪN VÀO WEB (+4 cột sau Bấm vào link)
  const webRows = web.map(d => '<tr class="cdrow" data-cd="' + esc(d.campaign_id) + '">' + cot3(d) + cot123(d) + webCols(d) + cotTyle(d) + denCell(d.den) + '</tr>').join('')
  const webTbl = '<div class="ads-bang3 tblwrap"><table><thead><tr><th>Chiến dịch</th><th>Loại</th><th>Tài khoản</th>' +
    thSort('chi', 'Chi') + thSort('luot_hien_thi', 'Hiển thị') + thSort('luot_bam', 'Bấm vào link') +
    '<th class="r">Tới trang / 100 bấm</th><th class="r">Giá 1 lượt vào</th><th class="r">Lượt liên hệ</th><th class="r">Giá 1 liên hệ</th>' +
    thSort('ctr', 'CTR') + thSort('cpm', 'CPM') + thSort('cpc', 'CPC') + '<th>Có khách</th></tr></thead><tbody>' +
    (webRows || '<tr><td colspan="14" class="trong2">Không có chiến dịch Dẫn vào web nào chạy trong khoảng ngày này.</td></tr>') +
    '</tbody><tfoot>' + (web.length ? footN(web, '<td></td><td></td><td></td><td></td>' + cotTyleFoot(web) + '<td></td>') : '') + '</tfoot></table></div>'
  // Bảng NHẮN TIN (+2 cột sau Bấm vào link)
  const nhanRows = nhan.map(d => '<tr class="cdrow" data-cd="' + esc(d.campaign_id) + '">' + cot3(d) + cot123(d) +
    '<td class="num">' + so(d.cuoc_tro_chuyen) + '</td><td class="num">' + tien(d.gia_1_cuoc) + '</td>' + cotTyle(d) + denCell(d.den) + '</tr>').join('')
  const nhanTbl = '<div class="ads-bang3 tblwrap"><table><thead><tr><th>Chiến dịch</th><th>Loại</th><th>Tài khoản</th>' +
    thSort('chi', 'Chi') + thSort('luot_hien_thi', 'Hiển thị') + thSort('luot_bam', 'Bấm vào link') +
    '<th class="r">Cuộc trò chuyện</th><th class="r">Giá 1 cuộc</th>' +
    thSort('ctr', 'CTR') + thSort('cpm', 'CPM') + thSort('cpc', 'CPC') + '<th>Có khách</th></tr></thead><tbody>' +
    (nhanRows || '<tr><td colspan="12" class="trong2">Không có chiến dịch Nhắn tin nào chạy trong khoảng ngày này.</td></tr>') +
    '</tbody><tfoot>' + (nhan.length ? footN(nhan, '<td></td><td></td>' + cotTyleFoot(nhan) + '<td></td>') : '') + '</tfoot></table></div>'
  // đối soát + chưa xếp (từ dong đang hiện)
  const cx = chuaXep.length
  const doiSoat = '<div class="ads-doisoat">Dẫn vào web ' + tien(sumChi(web)) + ' + Nhắn tin ' + tien(sumChi(nhan)) +
    ' + Chưa xếp ' + tien(sumChi(chuaXep)) + ' = tổng chi kỳ ' + tien(sumChi(dong)) + '</div>'
  const cxLine = cx > 0
    ? '<div class="ads-chuaxep ads-do-so">Chưa xếp được loại: ' + cx + ' chiến dịch · ' + tien(sumChi(chuaXep)) + ' — ' + chuaXep.map(d => esc(d.campaign_name || d.campaign_id)).join(', ') + '</div>'
    : '<div class="ads-chuaxep">Chưa xếp được loại: 0 chiến dịch · 0đ</div>'
  const noteWeb = '<div class="ads-bang-note">Tới trang / 100 bấm: cứ 100 lượt bấm ra web thì bao nhiêu lượt mở được trang… Dưới 70 là lỗi web, không phải lỗi quảng cáo.</div>'
  const tbl = '<div class="ads-truc">chi/hiển thị/bấm: theo ngày chi</div>' +
    '<h3 class="ads-bang-tieude">Dẫn vào web</h3>' + webTbl + demTat(web) + noteWeb +
    '<h3 class="ads-bang-tieude">Nhắn tin</h3>' + nhanTbl + demTat(nhan) + cxLine + doiSoat
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
  return sec('1', 'Bảng chiến dịch', 'gộp theo loại chiến dịch', tbl + cards + duoi)
}

// D · khối RPC hỏng/rỗng → dải xám, KHÔNG ẩn khối (ẩn khi hỏng = bệnh im lặng cũ).
function xamKhoi(msg) { return '<div class="ads-xam">' + esc(msg) + '</div>' }

// [WP-100 A] SỨC KHOẺ MẪU — nguồn ads_suc_khoe_mau (RPC tính HẾT; FE không tính lại). ket_luan ⟂ ghi_chu = 2 cột.
// ══════════ [WP-103] THƯ VIỆN MẪU (creative) — app ĐỌC, không có đường ghi ══════════
function khoiThuVienMau(mau, tt) {
  const dau = '<div class="ads-mau-dau"><h1>Thư viện mẫu</h1>'
  if (!mau || !Array.isArray(mau)) return dau + '</div>' + xamKhoi('Không đọc được thư viện mẫu.')
  const t = (Array.isArray(tt) ? tt[0] : tt) || {}
  // [L-108-6] BỎ thanh lọc trang RIÊNG — dùng chung thanh THƯƠNG HIỆU ở đầu app (brand ⟺ trang 1:1, tránh 2 thanh chồng).
  const view = mau.filter(m => hopBrandPage(m.page_id))
  const dangChay = view.filter(m => m.dang_chay), daNghi = view.filter(m => !m.dang_chay)
  const fpView = new Set(view.map(m => m.page_id).filter(Boolean)).size
  const chuaPage = view.filter(m => !m.page_id).length
  const nAct = t.so_tai_khoan != null ? t.so_tai_khoan : '—'
  const brandTen = BRAND === 'chua_ro' ? 'chưa rõ trang' : (((DL.tk || []).find(x => x.brand_id === BRAND) || {}).ten_hien_thi || BRAND)
  const headTxt = BRAND === 'all'
    ? view.length + ' mẫu · ' + nAct + ' tài khoản · ' + fpView + ' fanpage'
    : view.length + ' mẫu · ' + esc(brandTen)
  const head = dau + '<p>' + headTxt + '</p></div>'
  const box = (cls, v, ten) => '<div class="ads-mau-o ' + cls + '"><div class="s">' + esc(String(v)) + '</div><div class="t">' + esc(ten) + '</div></div>'
  const tom = '<div class="ads-mau-tom">' + box('ads-mau-o1', view.length, 'Mẫu') + box('ads-mau-o2', dangChay.length, 'Đang chạy 7 ngày') +
    box('ads-mau-o3', fpView, 'Fanpage') + box('ads-mau-o4', chuaPage, 'Chưa rõ page') + '</div>'
  // [WP-107 L-1c] CHIP = định dạng SUY ĐƯỢC (dinh_dang_that), KHÔNG phải object_type (VIDEO/SHARE sai)
  const chip = d => '<span class="ads-mau-chip dd">' + esc(d || 'chưa rõ') + '</span>'
  const anhHtml = m => {
    const dai = Array.isArray(m.anh_dai_url) ? m.anh_dai_url : []
    if (m.anh_net_url) {   // ảnh nét (video đơn) HOẶC ảnh đầu của xoay vòng + chip "N ảnh" mở dải
      const chipDai = dai.length > 1 ? '<button class="ads-mau-chip-dai" data-dai="' + esc(JSON.stringify(dai)) + '">' + dai.length + ' ảnh</button>' : ''
      return '<div class="ads-mau-anh"><img class="ads-mau-img" src="' + esc(m.anh_net_url) + '" alt="" loading="lazy"><span class="ads-mau-anh-txt">Ảnh Meta hết hạn</span>' + chipDai + '</div>'
    }
    // [WP-107 L-1i] KHÔNG để ô xám câm. Đẩy-bài CÓ page mà vẫn trống ⇒ token CHƯA có quyền đọc trang đó
    //   (nếu có quyền, bộ kéo đã lấy full_picture) → nói rõ TÊN TRANG + cần CEO cấp quyền. Định dạng khác trống
    //   ⇒ bộ kéo chưa có đường lấy ảnh cho định dạng đó (vd ảnh-đơn dùng link_data.image_hash).
    const moBai = m.link_fb ? '<a class="ads-mau-mobai" href="' + esc(m.link_fb) + '" target="_blank" rel="noopener">Mở bài</a>' : ''
    let txt
    if (m.dinh_dang_that === 'đẩy bài có sẵn' && m.page_id) txt = 'Bài đăng ở trang <b>' + esc(tenTrang(m.page_id)) + '</b> — token chưa có quyền đọc trang này, cần CEO cấp quyền để lấy ảnh'
    else if (m.dinh_dang_that === 'quảng cáo link') txt = 'Quảng cáo link — Meta không trả ảnh qua API (mẫu chỉ dùng ảnh xem-trước của trang đích)'   // [L-108-7]
    else txt = 'Chưa lấy được ảnh cho định dạng “' + esc(m.dinh_dang_that || 'chưa rõ') + '”'
    return '<div class="ads-mau-anh" data-hong="1"><span class="ads-mau-anh-txt">' + txt + '</span>' + moBai + '</div>'
  }
  const ctr7 = m => m.ctr_7ngay == null ? '—' : (Number(m.ctr_7ngay) * 100).toFixed(2).replace('.', ',') + '%'
  const tienN = n => n == null ? '—' : so(n) + 'đ'   // [WP-107 L-1f] CPM/CPC: mẫu số 0 → NULL → "—"
  const lechTd = m => {
    if (m.ctr_lech_pct == null) return '<td class="ads-mau-chua">chưa đủ 7 ngày</td>'
    const p = Number(m.ctr_lech_pct) * 100
    return '<td class="' + (p >= 0 ? 'ads-mau-len' : '') + '"' + (p < 0 ? ' style="color:#C8202E;font-weight:600"' : '') + '>' + (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(0) + '%</td>'
  }
  const fbNut = (m, cls) => m.link_fb ? '<a class="' + cls + '" href="' + esc(m.link_fb) + '" target="_blank" rel="noopener">Bài FB</a>' : '<span class="' + cls + ' tat">Không có bài FB</span>'
  const igNut = (m, cls) => m.ig_link ? '<a class="' + cls + '" href="' + esc(m.ig_link) + '" target="_blank" rel="noopener">Bài IG</a>' : '<span class="' + cls + ' tat">Không có bài IG</span>'
  // thẻ ĐANG CHẠY (đúng mẫu: chi to riêng dòng + bảng 2 cột)
  const the = m => '<article class="ads-mau-the">' + anhHtml(m) +
    '<div class="ads-mau-than">' +
      '<div class="ads-mau-chiph">' + chip(m.dinh_dang_that) + '<span class="ads-mau-chip">' + esc(m.nut || '—') + '</span><span class="ads-mau-chipad">' + (m.so_ad || 0) + ' ad</span></div>' +
      '<div class="ads-mau-ten">' + esc(m.tieu_de || m.ten || '(không tiêu đề)') + '</div>' +
      '<div class="ads-mau-body">' + esc(m.body || '') + '</div>' +
      // [WP-107 L-1f] KHỐI TIỀN: chi to · CPM · CPC link
      '<div class="ads-mau-khoi-t">Tiền</div>' +
      '<div class="ads-mau-chi">' + so(m.chi_7ngay || 0) + '<span>đ</span></div><div class="ads-mau-chinhan">chi 7 ngày</div>' +
      '<table class="ads-mau-so">' +
        '<tr><td>CPM</td><td>' + tienN(m.cpm_7ngay) + '</td></tr>' +
        '<tr><td>CPC link</td><td>' + tienN(m.cpc_link_7ngay) + '</td></tr></table>' +
      // vạch ngăn + KHỐI KẾT QUẢ
      '<div class="ads-mau-vach"></div><div class="ads-mau-khoi-t">Kết quả</div>' +
      '<table class="ads-mau-so">' +
        '<tr><td>Hiển thị</td><td>' + so(m.hien_thi_7ngay || 0) + '</td></tr>' +
        '<tr><td>Bấm link</td><td>' + so(m.bam_7ngay || 0) + '</td></tr>' +
        '<tr><td>CTR link</td><td>' + ctr7(m) + '</td></tr>' +
        '<tr><td>Tuổi mẫu</td><td>' + (m.tuoi_ngay != null ? m.tuoi_ngay : '—') + ' ngày</td></tr>' +
        '<tr><td>So tuần đầu</td>' + lechTd(m) + '</tr></table>' +
      '<div class="ads-mau-nuth">' + fbNut(m, 'ads-mau-nut') + igNut(m, 'ads-mau-nut') + '</div>' +
    '</div></article>'
  const luoi = dangChay.length ? '<div class="ads-mau-luoi">' + dangChay.map(the).join('') + '</div>' : xamKhoi('Không có mẫu nào đang chạy trong 7 ngày.')
  // ĐÃ NGHỈ (bảng dòng như mẫu)
  const dongNghi = m => '<tr><td><div class="ads-mau-catten">' + esc(m.tieu_de || m.ten || m.creative_id) + '</div></td>' +
    '<td>' + esc(m.dinh_dang_that || '') + '</td><td class="p">' + (m.tuoi_ngay != null ? m.tuoi_ngay : '—') + ' ngày</td>' +
    '<td class="p">' + tien(m.chi) + '</td><td class="p">' + tienN(m.cpm_doi) + '</td><td class="p">' + tienN(m.cpc_link_doi) + '</td>' +
    '<td style="text-align:right;white-space:nowrap">' + fbNut(m, 'ads-mau-bnut') + ' ' + igNut(m, 'ads-mau-bnut') + '</td></tr>'
  const nghi = daNghi.length ? '<p class="ads-mau-nhom-h nghi">Đã nghỉ (' + daNghi.length + ')</p><p class="ads-mau-nhom-phu">Không tiêu đồng nào trong 7 ngày. CPM/CPC là số cộng dồn cả đời mẫu. Vẫn giữ để xem lại và dựng lại.</p>' +
    '<div class="ads-mau-bang-wrap"><table class="ads-mau-bang"><tr><th>Mẫu</th><th>Định dạng</th><th style="text-align:right">Tuổi</th><th style="text-align:right">Chi cộng dồn</th><th style="text-align:right">CPM (cộng dồn)</th><th style="text-align:right">CPC link (cộng dồn)</th><th></th></tr>' + daNghi.map(dongNghi).join('') + '</table></div>' : ''
  // [WP-107 L-1c] khay xem dải ảnh xoay vòng (đơn giản: mở/đóng, không thư viện cầu kỳ)
  const modal = '<div id="ads-mau-dai" class="ads-mau-dai-modal" hidden><div class="ads-mau-dai-in"><button class="ads-mau-dai-x" aria-label="Đóng">✕</button><div class="ads-mau-dai-ds"></div></div></div>'
  return head + tom + '<p class="ads-mau-nhom-h">Đang chạy (' + dangChay.length + ')</p><p class="ads-mau-nhom-phu">Sắp theo chi 7 ngày, nhiều nhất lên đầu</p>' + luoi + nghi + modal
}

function khoiSucKhoe(sk) {
  if (!sk || !sk.mau) return sec('2', 'Sức khoẻ mẫu quảng cáo', '', xamKhoi('Không đọc được sức khoẻ mẫu.'))
  // [WP-108] lọc mẫu theo BRAND; NỀN mới = pooled RIÊNG BRAND (chọn 1 thương hiệu) hoặc pooled cả hệ ("Mọi thương hiệu")
  const mau = (sk.mau || []).filter(m => hopBrandRow(m.brand))
  const nb = sk.nen_theo_brand || {}
  const nn = (BRAND !== 'all' && BRAND !== 'chua_ro' && nb[BRAND]) ? nb[BRAND] : (sk.nen_7ngay || {})
  const pf = x => (x == null) ? '—' : (Number(x) * 100).toFixed(0) + '%'
  const pf2 = x => (x == null) ? '—' : String((Number(x) * 100).toFixed(2)).replace('.', ',') + '%'
  const tsF = x => (x == null) ? '—' : String(Number(x).toFixed(2)).replace('.', ',')
  // video NULL → chữ "không đo được" mờ (KHÔNG 0, KHÔNG trống). Số → %.
  const vidCell = v => (typeof v === 'number') ? pf(v) : '<span class="ads-kodo">không đo được</span>'
  const tot = mau.filter(m => m.ket_luan === 'đang tốt').length
  const dongTren = '<div class="ads-sk-tom">' + tot + '/' + mau.length + ' đang tốt · ' + (mau.length - tot) + ' cần xem lại</div>'
  let rows = ''
  for (const m of mau) {
    const xau = m.ket_luan !== 'đang tốt'
    rows += '<tr class="' + (xau ? 'ads-sk-canxem' : '') + '"><td>' + esc(m.ten || m.ad_id) + '</td>' +
      '<td class="num">' + tien(m.chi) + '</td><td class="num">' + so(m.hien_thi) + '</td>' +
      '<td class="num">' + tsF(m.tan_suat) + '</td><td class="num">' + vidCell(m.ty_le_bat_dau_xem) + '</td>' +
      '<td class="num">' + vidCell(m.ty_le_giu_xem) + '</td><td class="num">' + pf2(m.ctr_link) + '</td>' +
      '<td class="num">' + tien(m.cpm) + '</td>' +
      '<td>' + (xau ? '<b>' + esc(m.ket_luan) + '</b>' : esc(m.ket_luan)) + '</td>' +
      '<td class="ads-sk-gc">' + (m.ghi_chu ? esc(m.ghi_chu) : '') + '</td></tr>'
  }
  const nenNhan = (BRAND !== 'all' && BRAND !== 'chua_ro' && nb[BRAND]) ? 'Nền ' + esc(BRAND) + ' 7 ngày (pooled)' : 'Nền 7 ngày · cả hệ (pooled)'
  const foot = '<tr class="ads-sk-nen"><td>' + nenNhan + '</td><td></td><td></td><td></td>' +
    '<td class="num">' + pf(nn.bat_dau_xem) + '</td><td class="num">' + pf(nn.giu_xem) + '</td>' +
    '<td class="num">' + pf2(nn.ctr_link) + '</td><td class="num">' + tien(nn.cpm) + '</td><td colspan="2"></td></tr>'
  const tbl = '<div class="tblwrap"><table class="ads-sk-tbl"><thead><tr><th>Mẫu</th><th class="r">Chi</th><th class="r">Hiển thị</th>' +
    '<th class="r">Tần suất</th><th class="r">Bắt đầu xem</th><th class="r">Giữ xem</th><th class="r">CTR</th><th class="r">CPM</th><th>Kết luận</th><th>Ghi chú</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="10" class="trong2">Chưa có mẫu nào trong khoảng này.</td></tr>') + '</tbody>' +
    '<tfoot>' + foot + '</tfoot></table></div>' +
    '<div class="ads-bang-note">Nền bắt-đầu-xem tính trên ' + so(nn.so_mau_video_trong_nen) + ' mẫu video / ' + so(nn.so_mau_trong_nen) + ' mẫu.</div>'
  return sec('2', 'Sức khoẻ mẫu quảng cáo', 'thứ tự đọc mỏi: bắt đầu xem → CTR → xếp hạng → tần suất', dongTren + tbl)
}

// [WP-100 C] FACEBOOK / INSTAGRAM — chi_ads_nen_tang_tong. Dòng ước tính đọc cờ + câu TỪ RPC (không gõ cứng HTML).
function khoiNenTang(nt, tongBrand) {
  if (!nt || !nt.dong) return sec('1', 'Facebook / Instagram', '', xamKhoi('Không đọc được tách nền tảng.'))
  const TEN = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', audience_network: 'Audience Network', messenger: 'Messenger' }
  const pct1 = x => (x == null) ? '—' : String(x).replace('.', ',') + '%'
  // [L-108-6] ẩn dòng < 100 hiển thị (CTR từ mẫu quá nhỏ = rác, vd Audience Network 42,86% từ 7 hiển thị)
  //   → gộp vào MỘT dòng "Khác" chỉ ghi TỔNG CHI, KHÔNG hiện tỷ lệ.
  const NGUONG_HT = 100
  const to = (nt.dong || []).filter(r => Number(r.hien_thi || 0) >= NGUONG_HT)
  const nho = (nt.dong || []).filter(r => Number(r.hien_thi || 0) < NGUONG_HT)
  let rows = ''
  for (const r of to) rows += '<tr><td>' + esc(TEN[r.nen_tang] || r.nen_tang) + '</td>' +
    '<td class="num">' + tien(r.chi) + '</td><td class="num">' + so(r.hien_thi) + '</td>' +
    '<td class="num">' + pct1(r.ctr) + '</td><td class="num">' + pct1(r.phan_tram_chi) + '</td></tr>'
  if (nho.length) {
    const chiKhac = nho.reduce((s, r) => s + Number(r.chi || 0), 0), htKhac = nho.reduce((s, r) => s + Number(r.hien_thi || 0), 0)
    const pcKhac = nho.reduce((s, r) => s + Number(r.phan_tram_chi || 0), 0)
    rows += '<tr class="ads-nt-khac"><td>Khác <span class="ads-tk-id">(' + nho.length + ' nền tảng < ' + NGUONG_HT + ' hiển thị)</span></td>' +
      '<td class="num">' + tien(chiKhac) + '</td><td class="num">' + so(htKhac) + '</td>' +
      '<td class="num">—</td><td class="num">' + (pcKhac ? pct1(Math.round(pcKhac * 10) / 10) : '—') + '</td></tr>'
  }
  // [L-108-13] TIỀN KHÔNG ĐƯỢC BIẾN MẤT GIỮA HAI MÀN: dòng cuối = Σ chính (brand) − Σ đã tách.
  //   =0 → ẩn · >0 → "Chưa có số tách" (Meta chưa chia) · <0 → ĐỎ "số tách đang vượt số chính, đang tra" (KHÔNG giấu).
  const daTach = (nt.dong || []).reduce((s, r) => s + Number(r.chi || 0), 0)
  const chuaTach = (tongBrand != null ? Number(tongBrand) : daTach) - daTach
  if (Math.round(chuaTach) > 0) rows += '<tr class="ads-nt-chuatach"><td>Chưa có số tách <span class="ads-tk-id">(Meta chưa chia nền tảng cho phần này)</span></td>' +
    '<td class="num">' + tien(chuaTach) + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>'
  else if (Math.round(chuaTach) < 0) rows += '<tr class="ads-nt-vuot"><td><b>⚠ Số tách đang VƯỢT số chính — đang tra</b></td>' +
    '<td class="num">' + tien(chuaTach) + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>'
  const tbl = '<div class="tblwrap"><table class="ads-nt-tbl"><thead><tr><th>Nền tảng</th><th class="r">Chi</th><th class="r">Hiển thị</th><th class="r">CTR</th><th class="r">% chi</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="5" class="trong2">Chưa có số tách nền tảng.</td></tr>') + '</tbody></table></div>' +
    (Math.round(chuaTach) !== 0 ? '<div class="ads-bang-note">Tổng bảng (gồm dòng chưa tách) = ' + tien((tongBrand != null ? Number(tongBrand) : daTach)) + ' — khớp màn Tổng quan.</div>' : '') +
    (nho.length ? '<div class="ads-bang-note">Ẩn ' + nho.length + ' nền tảng dưới ' + NGUONG_HT + ' hiển thị (tỷ lệ từ mẫu quá nhỏ không đáng tin) — gộp vào dòng "Khác", chỉ tính tổng chi.</div>' : '')
  const note = nt.la_uoc_tinh ? '<div class="ads-uoctinh">⚠ ' + esc(nt.ghi_chu) + '</div>' : ''
  return sec('1', 'Facebook / Instagram', 'chi theo nền tảng (một chiều breakdown)', tbl + note)
}

// [WP-100 B] SỔ THAY ĐỔI META — ads_thay_doi_gan_day. Tên người ĐÃ che ở RPC ("N.V.A"). 0 bản ghi → nói rõ, KHÔNG ẩn.
function khoiSoThayDoi(std) {
  if (!std || !std.dong) return sec('1', 'Sổ thay đổi Meta', '', xamKhoi('Không đọc được sổ thay đổi.'))
  if (!std.dong.length) return sec('1', 'Sổ thay đổi Meta', '', xamKhoi('Không ai sửa trong 30 ngày.'))
  const hm = s => { const x = new Date(s); if (isNaN(x)) return '—'; const p = n => String(n).padStart(2, '0'); return p(x.getDate()) + '/' + p(x.getMonth() + 1) + ' ' + p(x.getHours()) + ':' + p(x.getMinutes()) }
  const tkTxt = r => r.ten_tk ? esc(r.ten_tk) : '<span class="adid">…' + esc(String(r.act_id).slice(-4)) + '</span>'
  let rows = ''
  for (const r of std.dong) rows += '<tr><td class="ads-td-luc">' + hm(r.luc) + '</td>' +
    '<td>' + tkTxt(r) + ' <span class="ads-td-ng">' + esc(r.nguoi) + '</span></td>' +
    '<td>' + esc(r.viec) + '</td><td>' + esc(r.doi_tuong || '—') + '</td></tr>'
  const tbl = '<div class="ads-std-cuon"><table class="ads-std-tbl"><thead><tr><th>Lúc</th><th>Tài khoản</th><th>Việc</th><th>Đối tượng</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
  // [L-108-6] nói rõ đang hiện bao nhiêu / tổng; khung .ads-std-cuon cuộn (max-height + overflow)
  const hien = std.dong.length, con = (std.tong || 0) - hien
  const duoi = con > 0 ? '<div class="ads-bang-note">Đang hiện ' + hien + ' bản ghi mới nhất / tổng ' + so(std.tong) + ' (30 ngày). Cuộn trong khung để xem hết ' + hien + '.</div>' : ''
  return sec('1', 'Sổ thay đổi Meta', 'hiện ' + hien + '/' + so(std.tong) + ' bản ghi · ' + std.so_tai_khoan + ' tài khoản (30 ngày · tên đã che)', tbl + duoi)
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
  const h2 = '<h2><span class="n">2</span> <button class="mo-khoi" id="btKhoiAd">' + (KHOI_AD_MO ? '▾' : '▸') + ' Mức từng quảng cáo (ad)</button> <span class="h2sub">chỉ đúng cho quảng cáo tin nhắn — thu gọn</span></h2>'
  return '<div class="sec">' + h2 + inner + '</div>'
}

function khoiChuGiai() {
  const item = (k) => '<span class="ads-cg"><span class="ads-den ads-den-' + DEN_TT[k][1] + '"></span>' + DEN_TT[k][0] + '</span>'
  const g = '<div class="ads-cg-wrap">' + item('con_du') + item('sat_tran') + item('vuot_tran') + item('chua_du_so') + item('khong_do_duoc') + '</div>' +
    '<div class="ads-cg-note">"Chi phí có khách" so tiền bỏ ra với mức trần theo cỡ đơn khách mua. Còn dư / Sát mức / Vượt mức chỉ hiện khi đã có đơn thật quy về chiến dịch; hiện các chiến dịch dẫn web nên phần lớn là "Chưa đo được".</div>'
  return sec('2', 'Chú giải đèn', '', g)
}

function khoiDeSau() {
  return '<div class="sec"><h2><span class="n">9</span> Chỗ để sau</h2>' +
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
