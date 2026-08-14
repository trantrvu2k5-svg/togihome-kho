// App THIẾT KẾ — 3 màn: Việc của tôi · Bảng công việc (kanban+panel) · Giờ & chi phí (+2 bảng thành tích).
//   Vào: thiet_ke (SẢN XUẤT) · tk_ban_hang (BÁN HÀNG) · ceo · truong_nhom_thiet_ke. Đọc qua RPC curated (KHÔNG giá/khách).
//   ceo/trưởng nhóm KHÔNG nhận việc — chỉ GIAO/CHUYỂN. Gửi bản 3D làm ngay ở đây (gui_ban_thiet_ke).
import { createClient } from '@supabase/supabase-js'
import { nutNhapSo } from './nut_nhap_so.js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })

const VAI_VAO = ['thiet_ke', 'tk_ban_hang', 'ceo', 'truong_nhom_thiet_ke']
const TEN_VAI = { thiet_ke: 'Thiết kế sản xuất', tk_ban_hang: 'Thiết kế bán hàng', ceo: 'CEO', truong_nhom_thiet_ke: 'Trưởng nhóm thiết kế' }
const LOAI_CAP = {
  co_file_san: 'Lẻ có mẫu sẵn · L1', toan_mon_co_san: 'Toàn món có sẵn · L1',
  thiet_ke_rieng: 'Lẻ thiết kế riêng · L2', co_mon_dung_moi: 'Combo có món mới · L1+L2',
  full_can: 'Full căn · L3', cat_lai: 'Cắt lại · L1', bao_hanh: 'Bảo hành · L1'
}
const COT = { cho_nhan: 'Chờ nhận', dang_dung: 'Đang dựng', cho_duyet: 'Chờ duyệt', sua_gop_y: 'Sửa theo góp ý', xong_file: 'Xong file' }
const COT_ORDER = ['cho_nhan', 'dang_dung', 'cho_duyet', 'sua_gop_y', 'xong_file']

let USER = null, BANG = [], CAM = 0, CHE_DO = 'tu_nhan', NGUOI_NHAN = []
let DS_CHO = [], CHO_NHOM = '', BANG_DAT = false
let GUIBAN = { ma_don: null, files: [], fileNguon: null }, FILESX = { ma_don: null, files: [] }, MODAL = null
const LOAI_ICON = { dxf: '▤ DXF', cutlist: '▦ Cutlist', anh_ban_ve: '🖼 Ảnh bản vẽ', khac: '📄 File' }
function loaiFile(name) { const e = (name.split('.').pop() || '').toLowerCase(); return e === 'dxf' ? 'dxf' : ['csv', 'txt', 'xlsx', 'xls'].includes(e) ? 'cutlist' : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e) ? 'anh_ban_ve' : 'khac' }
const $ = id => document.getElementById(id)
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const g1 = n => { n = Number(n); return Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—' }
const loaiCap = c => LOAI_CAP[c] || (c ? c.replace(/_/g, ' ') : '—')
const laNhanEr = () => USER && (USER.coTK || USER.coBH)          // có năng lực nhận việc (base + phụ)
const laTruong = () => USER && ['ceo', 'truong_nhom_thiet_ke'].includes(USER.vai_tro)
const laBaoGia = tt => ['bao_gia', 'bao_gia_treo'].includes(tt)  // đơn báo giá = việc BÁN HÀNG
function bao(t, loi) { const el = $('bao'); el.textContent = t; el.classList.toggle('loi', !!loi); el.classList.add('hien'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hien'), 2800) }
const homNay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const treKhong = ngay => ngay && new Date(ngay) < homNay()
const gioLuc = s => { if (!s) return ''; const d = new Date(s); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}` }

// ══════════ ẢNH (nén 2 cỡ WebP + upload bucket ban-thiet-ke) ══════════
async function nenAnh(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const webpOk = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  const kieu = webpOk ? 'image/webp' : 'image/jpeg'
  const ve = (maxW, q) => new Promise(res => {
    const scale = Math.min(1, maxW / img.width), w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h)
    cv.toBlob(b => res(b), kieu, q)
  })
  const nho = await ve(400, 0.75), to = await ve(1600, 0.82); URL.revokeObjectURL(img.src)
  return { nho, to, byteNho: nho.size, byteTo: to.size, duoi: webpOk ? 'webp' : 'jpg', ct: kieu, preview: URL.createObjectURL(nho) }
}

// ══════════ ĐĂNG NHẬP ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'; $('navDay').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML = '<div class="logo">📐</div><h1>Togihome Thiết kế</h1><div class="sub">Đăng nhập để vào việc</div>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<button id="b">Vào thiết kế</button><div class="err" id="er">' + (err || '') + '</div>'
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
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app thiết kế.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro, coTK: false, coBH: false }
  const { data: vai } = await sb.rpc('tk_vai_cua_toi')   // vai HIỆU LỰC (base + phụ) — người kiêm hai vai
  if (vai) { USER.coTK = !!vai.thiet_ke; USER.coBH = !!vai.tk_ban_hang }
  capApp()
}

// ══════════ VÀO APP ══════════
async function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = 'flex'
  $('navDay').style.display = ''
  $('hdTen').textContent = USER.ten || TEN_VAI[USER.vai_tro]; $('hdVai').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  $('hdVaiPhu').textContent = laTruong() ? 'Toàn đội thiết kế' : TEN_VAI[USER.vai_tro]
  const thoat = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  $('btOut').onclick = thoat; if ($('btOutM')) $('btOutM').onclick = thoat
  document.querySelectorAll('.thanh-muc, .thanh-day button').forEach(b => { if (b.dataset.man) b.onclick = () => di(b.dataset.man) })
  // Tab NHẬP SỐ SẢN XUẤT chỉ cho thiet_ke + ceo
  if (['thiet_ke', 'ceo'].includes(USER.vai_tro)) { $('n-nhapso').style.display = ''; $('d-nhapso').style.display = '' }
  $('nsHdDau').onclick = () => { const t = $('nsHdThan'), n = $('nsHdNhan'); const an = t.style.display !== 'none'; t.style.display = an ? 'none' : 'block'; n.textContent = an ? 'mở ra ▼' : 'thu gọn ▲' }
  $('locVai').onchange = veKanban; $('locNguoi').onchange = veKanban; $('locLoai').onchange = veKanban
  $('chonKy').onchange = taiGio
  // panel + modal đóng
  $('mo').onclick = dongPanel
  $('moM').onclick = dongModal; $('hopMX').onclick = dongModal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { dongPanel(); dongModal() } })
  const d = new Date(), thang = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  const kys = [...new Set(['2099-08', thang])]
  $('chonKy').innerHTML = kys.map(k => `<option value="${k}">Kỳ ${k}</option>`).join('')
  const { data: cd } = await sb.rpc('tk_che_do'); CHE_DO = cd || 'tu_nhan'
  // URL có ?don= và vai thiet_ke/ceo → mở thẳng tab Nhập số cho đơn đó
  if (new URLSearchParams(location.search).get('don') && ['thiet_ke', 'ceo'].includes(USER.vai_tro)) di('nhapso')
  else await taiViec()
}
function di(m) {
  ;['viec', 'bang', 'gio', 'nhapso'].forEach(k => {
    $('s-' + k).style.display = (k === m) ? 'block' : 'none'
    const n = $('n-' + k), d = $('d-' + k); if (n) n.classList.toggle('chon', k === m); if (d) d.classList.toggle('chon', k === m)
  })
  window.scrollTo(0, 0)
  if (m === 'viec') taiViec(); if (m === 'bang') taiBang(); if (m === 'gio') taiGio(); if (m === 'nhapso') taiNhapSo()
}

// ══════════ ① VIỆC CỦA TÔI ══════════
// Nhãn theo VIỆC THIẾT KẾ (không theo trang_thai đơn): bán hàng dựng 3D · sản xuất dựng file · mẫu mới.
function viecCua(r) {
  if (r.la_mau || r.loai === 'mau_moi') return { text: 'Mẫu mới', cls: 'mau', nhan: 'n-mau' }
  if (['bao_gia', 'bao_gia_treo'].includes(r.trang_thai)) return { text: 'Dựng 3D báo giá', cls: 'bh', nhan: 'n-bh' }
  return { text: 'Dựng file sản xuất', cls: 'xuong', nhan: 'n-xuong' }   // moi_len_don·nhan_thiet_ke·dang_thiet_ke·xong_file
}
// r.viec (từ RPC) = 'tk_ban_hang'|'thiet_ke'|'mau' — dùng khi có; else suy từ trang_thai/loai
function vcTuViec(v) { return v === 'mau' ? { cls: 'mau', nhan: 'n-mau', text: 'Mẫu mới' } : v === 'tk_ban_hang' ? { cls: 'bh', nhan: 'n-bh', text: 'Dựng 3D báo giá' } : { cls: 'xuong', nhan: 'n-xuong', text: 'Dựng file sản xuất' } }
function nhanTT(r) { const v = r.viec ? vcTuViec(r.viec) : viecCua(r); return `<span class="nhan ${v.nhan}">${v.text}</span>` }
async function taiViec() {
  const [lam, cho] = await Promise.all([sb.rpc('tk_viec_cua_toi'), sb.rpc('tk_don_cho_nhan')])
  if (lam.error) { $('dsDangLam').innerHTML = `<div class="trong-rong"><p>Lỗi: ${esc(lam.error.message)}</p></div>`; return }
  const dsLam = lam.data || [], dsCho = cho.data || []
  CAM = dsLam.length
  $('dangCam').innerHTML = laTruong() ? `${dsCho.length} đơn chờ giao` : `Đang cầm <b>${CAM}/5</b>`
  // Đang làm — ghi giờ + gửi bản (ceo/trưởng thường rỗng vì không cầm đơn)
  $('dsDangLam').innerHTML = dsLam.length ? dsLam.map(r => {
    const tre = treKhong(r.ngay_hen_khach) && r.buoc_thiet_ke !== 'xong_file'
    const ly = tre ? `<p class="don-ly ly-tre">Quá hạn giao khách${r.vong_sua ? ' · đã sửa ' + r.vong_sua + ' vòng' : ''}</p>`
      : (r.danh_dau_gap ? `<p class="don-ly ly-gap">Gấp — CEO đánh dấu${r.ngay_hen_khach ? ' · hạn ' + r.ngay_hen_khach : ''}</p>`
        : `<p class="don-ly ly-thuong">${r.ngay_hen_khach ? 'Hạn ' + r.ngay_hen_khach : 'Chưa có hạn'} · bước: ${COT[r.buoc_thiet_ke] || '—'}</p>`)
    const nsN = nutNhapSo(r.trang_thai, USER.vai_tro, r.ma_don)   // nút Nhập số sản xuất (chỉ thiet_ke/ceo · đơn đã chốt)
    return `<div class="don"><div class="don-than">
      <div class="don-ten"><span class="mono">${esc(r.ma_don)}</span><b>${esc(r.ten)}</b>${nhanTT(r)}</div>
      <p class="don-phu">${esc(loaiCap(r.cap_thiet_ke))} · ${r.so_mon || 0} món · ước ${g1(r.gio_uoc)} giờ · đã ghi ${g1(r.gio_da_ghi)}</p>${ly}</div>
      <div class="o-gio"><span>thêm</span><input type="number" step="0.5" min="0" placeholder="0" data-gio="${esc(r.ma_don)}"><span>giờ</span></div>
      <button class="nut-nho" data-ghi="${esc(r.ma_don)}">Ghi giờ</button>
      ${laBaoGia(r.trang_thai)
        ? `<button class="nut-nho nut-xam" data-guiban="${esc(r.ma_don)}">Gửi bản 3D cho sale</button>`
        : `<button class="nut-nho nut-xam" data-guifile="${esc(r.ma_don)}">Gửi file sản xuất cho xưởng</button>`}
      ${nsN ? `<button class="nut-nho nut-xam" data-nhapso="${esc(r.ma_don)}">${nsN.text}</button>` : ''}</div>`
  }).join('') : `<div class="trong-rong"><h3>${laTruong() ? 'Bạn không cầm đơn — chỉ giao/chuyển' : 'Chưa cầm đơn nào'}</h3><p>${laTruong() ? 'Giao đơn cho thiết kế ở khối "Chờ nhận" bên dưới.' : 'Nhận việc từ khối "Chờ nhận" bên dưới.'}</p></div>`
  $('dsDangLam').querySelectorAll('[data-ghi]').forEach(b => b.onclick = () => ghiGio(b.dataset.ghi))
  $('dsDangLam').querySelectorAll('[data-guiban]').forEach(b => b.onclick = () => moGuiBan(b.dataset.guiban))
  $('dsDangLam').querySelectorAll('[data-guifile]').forEach(b => b.onclick = () => moGuiFile(b.dataset.guifile))
  $('dsDangLam').querySelectorAll('[data-nhapso]').forEach(b => b.onclick = () => moNhapSo(b.dataset.nhapso))
  // Chờ nhận (RPC đã lọc theo vai: thiet_ke chỉ SX · tk_ban_hang chỉ báo giá · ceo/trưởng cả hai)
  DS_CHO = dsCho; veChoNhan()
}
function veChoNhan() {
  const day = CAM >= 5, choTuNhan = laNhanEr() && ['tu_nhan', 'hon_hop'].includes(CHE_DO)
  const ds = laTruong() && CHO_NHOM ? DS_CHO.filter(r => (r.viec || '') === CHO_NHOM) : DS_CHO
  $('choDem').textContent = `xếp sẵn theo mức cần làm trước — ${ds.length} đơn` +
    (laNhanEr() ? (day ? ' · bạn đang đầy 5/5' : '') : ` · chế độ: ${CHE_DO === 'giao_viec' ? 'giao việc' : CHE_DO === 'hon_hop' ? 'hỗn hợp' : 'tự nhận'}`)
  // ceo/trưởng: bộ lọc chuyển qua lại giữa hai nhóm việc
  const loc = laTruong() ? `<div class="loc" style="padding:10px 18px 0;margin:0"><select id="choLoc">
      <option value="">Cả hai nhóm việc</option>
      <option value="tk_ban_hang"${CHO_NHOM === 'tk_ban_hang' ? ' selected' : ''}>Dựng 3D báo giá (bán hàng)</option>
      <option value="thiet_ke"${CHO_NHOM === 'thiet_ke' ? ' selected' : ''}>Dựng file sản xuất</option>
      <option value="mau"${CHO_NHOM === 'mau' ? ' selected' : ''}>Mẫu mới</option></select></div>` : ''
  const body = ds.length ? ds.map((r, i) => {
    const tre = treKhong(r.ngay_hen_khach)
    const ly = tre ? `<p class="don-ly ly-tre">Quá hạn gửi giá — cần làm trước</p>`
      : (r.danh_dau_gap ? `<p class="don-ly ly-gap">Gấp — CEO đánh dấu</p>`
        : `<p class="don-ly ly-thuong">${r.ngay_hen_khach ? 'Hạn ' + r.ngay_hen_khach : 'Chưa có hạn'}</p>`)
    let nut = ''
    if (laTruong()) nut = `<button class="nut-nho" data-giao="${esc(r.ma_don)}">Giao cho…</button>`
    else if (choTuNhan) nut = `<button class="nut-nho" data-nhan="${esc(r.ma_don)}" ${day ? 'disabled title="Đang cầm 5/5 — làm xong bớt rồi nhận thêm"' : ''}>Nhận việc</button>`
    else nut = `<span class="don-phu" style="color:var(--chu-mo)">Chờ trưởng nhóm giao</span>`
    return `<div class="don"><span class="stt">${i + 1}</span><div class="don-than">
      <div class="don-ten"><span class="mono">${esc(r.ma_don)}</span><b>${esc(r.ten)}</b>${nhanTT(r)}</div>
      <p class="don-phu">${esc(loaiCap(r.cap_thiet_ke))} · ${r.so_mon || 0} món · ước ${g1(r.gio_uoc)} giờ</p>${ly}</div>${nut}</div>`
  }).join('') : '<div class="trong-rong"><p>Không có đơn nào đang chờ nhận.</p></div>'
  $('dsChoNhan').innerHTML = loc + body
  if ($('choLoc')) $('choLoc').onchange = () => { CHO_NHOM = $('choLoc').value; veChoNhan() }
  $('dsChoNhan').querySelectorAll('[data-nhan]').forEach(b => b.onclick = () => nhanViec(b.dataset.nhan))
  $('dsChoNhan').querySelectorAll('[data-giao]').forEach(b => b.onclick = () => moGiao(b.dataset.giao))
}
async function ghiGio(maDon) {
  const inp = document.querySelector(`[data-gio="${CSS.escape(maDon)}"]`)
  const so = Number(inp && inp.value)
  if (!so || so <= 0) { bao('Nhập số giờ trước đã', true); return }
  const { error } = await sb.rpc('ghi_gio_thiet_ke', { p_ma_don: maDon, p_so_gio: so })
  if (error) { bao(error.message, true); return }
  bao(`Đã ghi ${g1(so)} giờ cho ${maDon}`); taiViec()
}
async function nhanViec(maDon) {
  const { error } = await sb.rpc('nhan_viec_thiet_ke', { p_ma_don: maDon })
  if (error) { bao(error.message, true); return }
  bao(`Đã nhận ${maDon}`); taiViec()
}
// Dẫn vào màn Nhập số sản xuất của ĐÚNG đơn: đặt ?don=<ma_don> rồi mở tab (đọc lại URL).
function moNhapSo(maDon) {
  const u = new URL(location.href); u.searchParams.set('don', maDon); history.pushState({}, '', u)
  di('nhapso')
}

// ══════════ MODAL chung ══════════
function moModal(ten, thanHtml, nutHtml) {
  $('hopMTen').textContent = ten; $('hopMThan').innerHTML = thanHtml; $('hopMNut').innerHTML = nutHtml
  $('moM').classList.add('hien'); $('hopM').classList.add('hien')
}
function dongModal() { $('moM').classList.remove('hien'); $('hopM').classList.remove('hien'); GUIBAN = { ma_don: null, files: [] } }

// ── Gửi bản 3D cho sale (kèm file nguồn tuỳ chọn) ──
function moGuiBan(maDon) {
  GUIBAN = { ma_don: maDon, files: [], fileNguon: null }
  moModal('Gửi bản 3D cho sale — ' + maDon,
    `<label>Ảnh render (kéo thả hoặc bấm chọn)</label>
     <div class="tha-anh" id="thaAnh">Kéo ảnh vào đây hoặc bấm để chọn<input type="file" id="fileAnh" accept="image/*" multiple hidden></div>
     <div class="anh-luoi" id="anhLuoi"></div>
     <label>File nguồn — để thiết kế sản xuất dùng lại, đỡ dựng hai lần (tuỳ chọn)</label>
     <div class="tha-anh" id="thaNguon">Kéo file 3D nguồn (.skp/.3dm/…) hoặc bấm chọn<input type="file" id="fileNguon" hidden></div>
     <div id="nguonTen" class="don-phu" style="margin-top:6px"></div>
     <label>Ghi chú cho sale (tuỳ chọn)</label>
     <textarea id="banGhiChu" placeholder="Ví dụ: phương án 2, đổi màu cánh theo yêu cầu…"></textarea>`,
    `<button class="nut-vien" id="banHuy">Huỷ</button><button class="nut-chinh" id="banGui" disabled>Gửi bản</button>`)
  const zone = $('thaAnh'), inp = $('fileAnh')
  zone.onclick = () => inp.click()
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('keo') }
  zone.ondragleave = () => zone.classList.remove('keo')
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('keo'); themAnh(e.dataTransfer.files) }
  inp.onchange = () => themAnh(inp.files)
  const zn = $('thaNguon'), inpN = $('fileNguon')
  const nhanNguon = f => { if (!f) return; GUIBAN.fileNguon = f; $('nguonTen').innerHTML = `📎 ${esc(f.name)} · ${Math.round(f.size / 1024)} KB <button class="xoa" data-xoanguon style="position:static">×</button>`; $('nguonTen').querySelector('[data-xoanguon]').onclick = () => { GUIBAN.fileNguon = null; $('nguonTen').innerHTML = '' } }
  zn.onclick = () => inpN.click()
  zn.ondragover = e => { e.preventDefault(); zn.classList.add('keo') }
  zn.ondragleave = () => zn.classList.remove('keo')
  zn.ondrop = e => { e.preventDefault(); zn.classList.remove('keo'); nhanNguon(e.dataTransfer.files[0]) }
  inpN.onchange = () => nhanNguon(inpN.files[0])
  $('banHuy').onclick = dongModal
  $('banGui').onclick = guiBan
}
// ── Gửi FILE SẢN XUẤT cho xưởng (đường 2, song song plugin) ──
function moGuiFile(maDon) {
  FILESX = { ma_don: maDon, files: [] }
  moModal('Gửi file sản xuất cho xưởng — ' + maDon,
    `<label>File cắt (DXF), cutlist (CSV), ảnh bản vẽ — kéo thả hoặc bấm chọn</label>
     <div class="tha-anh" id="thaFile">Kéo file vào đây hoặc bấm để chọn<input type="file" id="fileSX" multiple hidden></div>
     <div id="fileList" style="margin-top:9px"></div>
     <label>Ghi chú cho xưởng (tuỳ chọn)</label>
     <textarea id="fileGhiChu" placeholder="Ví dụ: cắt ván 18 trước, kính đặt riêng…"></textarea>`,
    `<button class="nut-vien" id="fileHuy">Huỷ</button><button class="nut-chinh" id="fileGui" disabled>Gửi file cho xưởng</button>`)
  const zone = $('thaFile'), inp = $('fileSX')
  zone.onclick = () => inp.click()
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('keo') }
  zone.ondragleave = () => zone.classList.remove('keo')
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('keo'); themFile(e.dataTransfer.files) }
  inp.onchange = () => themFile(inp.files)
  $('fileHuy').onclick = dongModal
  $('fileGui').onclick = guiFile
}
async function themFile(fileList) {
  for (const f of Array.from(fileList || [])) {
    const loai = loaiFile(f.name)
    let blob = f, byte = f.size
    if (loai === 'anh_ban_ve') { try { const n = await nenAnh(f); blob = n.to; byte = n.byteTo } catch (e) {} }   // nén ảnh; DXF/CSV giữ nguyên
    FILESX.files.push({ file: f, blob, loai, ten: f.name, byte })
  }
  veFileList()
}
function veFileList() {
  const el = $('fileList'); if (!el) return
  el.innerHTML = FILESX.files.map((f, i) => `<div class="tam" style="border:1px solid var(--vien);border-radius:6px;margin-bottom:6px;padding:8px 11px">
    <span class="vt">${LOAI_ICON[f.loai]} · ${esc(f.ten)}</span><span class="kt">${Math.round(f.byte / 1024)} KB</span>
    <button class="xoa" data-xf="${i}" style="position:static">×</button></div>`).join('')
  el.querySelectorAll('[data-xf]').forEach(b => b.onclick = () => { FILESX.files.splice(+b.dataset.xf, 1); veFileList() })
  if ($('fileGui')) $('fileGui').disabled = FILESX.files.length === 0
}
async function guiFile() {
  const btn = $('fileGui'); if (!FILESX.files.length) return
  btn.disabled = true; btn.textContent = 'Đang tải file…'
  try {
    const stamp = Date.now(), ds = []
    for (let i = 0; i < FILESX.files.length; i++) {
      const f = FILESX.files[i], safe = f.ten.replace(/[^\w.\-]/g, '_')
      const path = `${FILESX.ma_don}/${stamp}_${i}_${safe}`
      const up = await sb.storage.from('file-san-xuat').upload(path, f.blob)   // path duy nhất (stamp) → không upsert (upsert cần quyền SELECT thiet_ke không có)
      if (up.error) throw new Error(up.error.message)
      ds.push({ loai_file: f.loai, duong_dan: path, ten_goc: f.ten, co_byte: f.byte })
    }
    const { error } = await sb.rpc('gui_file_san_xuat', { p_ma_don: FILESX.ma_don, p_danh_sach: ds, p_ghi_chu: $('fileGhiChu').value || '' })
    if (error) throw new Error(error.message)
    bao('Đã gửi file cho xưởng'); dongModal(); taiViec(); if ($('s-bang').style.display !== 'none') taiBang()
  } catch (e) { bao(e.message, true); if ($('fileGui')) { $('fileGui').disabled = false; $('fileGui').textContent = 'Gửi file cho xưởng' } }
}
async function themAnh(fileList) {
  for (const f of Array.from(fileList || [])) {
    if (!f.type.startsWith('image/')) continue
    try { GUIBAN.files.push(await nenAnh(f)) } catch (e) { bao('Ảnh lỗi, bỏ qua', true) }
  }
  veAnhLuoi()
}
function veAnhLuoi() {
  const el = $('anhLuoi'); if (!el) return
  el.innerHTML = GUIBAN.files.map((f, i) => `<div class="o-anh"><img src="${f.preview}"><button class="xoa" data-xoa="${i}">×</button></div>`).join('')
  el.querySelectorAll('[data-xoa]').forEach(b => b.onclick = () => { GUIBAN.files.splice(+b.dataset.xoa, 1); veAnhLuoi() })
  if ($('banGui')) $('banGui').disabled = GUIBAN.files.length === 0
}
async function guiBan() {
  const btn = $('banGui'); if (!GUIBAN.files.length) return
  btn.disabled = true; btn.textContent = 'Đang tải ảnh…'
  try {
    const stamp = Date.now(), anh = []
    for (let i = 0; i < GUIBAN.files.length; i++) {
      const f = GUIBAN.files[i], base = `${GUIBAN.ma_don}/${stamp}_${i}`
      const pNho = `${base}_nho.${f.duoi}`, pTo = `${base}_to.${f.duoi}`
      const u1 = await sb.storage.from('ban-thiet-ke').upload(pNho, f.nho, { contentType: f.ct, upsert: true })
      const u2 = await sb.storage.from('ban-thiet-ke').upload(pTo, f.to, { contentType: f.ct, upsert: true })
      if (u1.error || u2.error) throw new Error((u1.error || u2.error).message)
      anh.push({ duong_dan_nho: pNho, duong_dan_to: pTo, byte_nho: f.byteNho, byte_to: f.byteTo, thu_tu: i })
    }
    let fileNguon = null
    if (GUIBAN.fileNguon) {   // file nguồn 3D → bucket ban-thiet-ke (private)
      const fn = GUIBAN.fileNguon, safe = fn.name.replace(/[^\w.\-]/g, '_'), pN = `${GUIBAN.ma_don}/nguon/${stamp}_${safe}`
      const u = await sb.storage.from('ban-thiet-ke').upload(pN, fn, { upsert: true })
      if (u.error) throw new Error(u.error.message)
      fileNguon = { duong_dan: pN, byte: fn.size }
    }
    const { error } = await sb.rpc('gui_ban_thiet_ke', { p_ma_don: GUIBAN.ma_don, p_ghi_chu: $('banGhiChu').value || '', p_anh: anh, p_file_nguon: fileNguon })
    if (error) throw new Error(error.message)
    bao('Đã gửi bản cho sale'); dongModal(); taiViec()
  } catch (e) { bao(e.message, true); if ($('banGui')) { $('banGui').disabled = false; $('banGui').textContent = 'Gửi bản' } }
}

// ── Giao / Chuyển việc (trưởng nhóm/ceo) ──
async function napNguoiNhan() {
  if (NGUOI_NHAN.length) return NGUOI_NHAN
  const { data } = await sb.rpc('tk_nguoi_nhan'); NGUOI_NHAN = data || []; return NGUOI_NHAN
}
function optNguoi(ds, boId) {
  return ds.filter(n => n.id !== boId).map(n => `<option value="${n.id}">${esc(n.ho_ten)} · ${n.vai_tro === 'tk_ban_hang' ? 'bán hàng' : 'sản xuất'} · đang cầm ${n.dang_cam}</option>`).join('')
}
async function moGiao(maDon) {
  const ds = await napNguoiNhan()
  moModal('Giao việc — ' + maDon,
    `<label>Giao cho</label><select id="giaoAi">${optNguoi(ds)}</select>
     <label>Lý do (tuỳ chọn)</label><textarea id="giaoLy" placeholder="Ví dụ: gấp, đúng chuyên môn…"></textarea>`,
    `<button class="nut-vien" id="giaoHuy">Huỷ</button><button class="nut-chinh" id="giaoOk">Giao việc</button>`)
  $('giaoHuy').onclick = dongModal
  $('giaoOk').onclick = async () => {
    const { data, error } = await sb.rpc('giao_viec_thiet_ke', { p_ma_don: maDon, p_ma_ns_nhan: $('giaoAi').value, p_ly_do: $('giaoLy').value || null })
    if (error) { bao(error.message, true); return }
    bao(data && data.vuot_tran ? 'Đã giao — CẢNH BÁO: ' + data.canh_bao : 'Đã giao việc'); dongModal(); taiViec(); if ($('s-bang').style.display !== 'none') taiBang()
  }
}
async function moChuyen(maDon, aiCam) {
  const ds = await napNguoiNhan()
  moModal('Chuyển việc — ' + maDon,
    `<p class="don-phu" style="margin-bottom:6px">Đang do <b>${esc(aiCam || '?')}</b> cầm. Lý do bắt buộc.</p>
     <label>Chuyển sang</label><select id="chAi">${optNguoi(ds)}</select>
     <label>Lý do <span style="color:var(--do)">*</span></label><textarea id="chLy" placeholder="Ví dụ: người cũ nghỉ phép, quá tải…"></textarea>`,
    `<button class="nut-vien" id="chHuy">Huỷ</button><button class="nut-chinh" id="chOk">Chuyển việc</button>`)
  $('chHuy').onclick = dongModal
  $('chOk').onclick = async () => {
    if (!$('chLy').value.trim()) { bao('Phải ghi lý do chuyển', true); return }
    const { data, error } = await sb.rpc('chuyen_viec', { p_ma_don: maDon, p_ma_ns_moi: $('chAi').value, p_ly_do: $('chLy').value })
    if (error) { bao(error.message, true); return }
    bao(data && data.vuot_tran ? 'Đã chuyển — người mới đang cầm >5 đơn' : 'Đã chuyển việc'); dongModal(); dongPanel(); taiBang()
  }
}

// ══════════ ② BẢNG CÔNG VIỆC ══════════
async function taiBang() {
  const { data, error } = await sb.rpc('tk_bang_cong_viec')
  if (error) { $('kbBoard').innerHTML = `<div class="trong-rong"><p>Lỗi: ${esc(error.message)}</p></div>`; return }
  BANG = data || []
  const nguoi = [...new Set(BANG.map(r => r.ai_cam).filter(Boolean))].sort()
  $('locNguoi').innerHTML = '<option value="">Mọi người</option>' + nguoi.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
  const loais = [...new Set(BANG.map(r => r.cap_thiet_ke).filter(Boolean))]
  $('locLoai').innerHTML = '<option value="">Mọi loại đơn</option>' + loais.map(c => `<option value="${esc(c)}">${esc(loaiCap(c))}</option>`).join('')
  // mặc định lọc theo VAI người xem (Xem cả hai nhóm = chọn "Cả hai nhóm"). Đặt 1 lần, giữ lựa chọn tay sau đó.
  if (!BANG_DAT) { $('locVai').value = laNhanEr() ? USER.vai_tro : ''; BANG_DAT = true }
  veKanban()
}
function veKanban() {
  const fVai = $('locVai').value, fNguoi = $('locNguoi').value, fLoai = $('locLoai').value
  // lọc theo VIỆC (r.viec): '' = xem cả hai nhóm
  const rows = BANG.filter(r => (!fVai || r.viec === fVai) && (!fNguoi || r.ai_cam === fNguoi) && (!fLoai || r.cap_thiet_ke === fLoai))
  $('bangDem').innerHTML = `${[...new Set(rows.map(r => r.ai_cam).filter(Boolean))].length} người · ${rows.length} việc`
  const board = $('kbBoard'); board.innerHTML = ''
  COT_ORDER.forEach(cot => {
    const ds = rows.filter(r => r.cot === cot)
    let u = false
    if (cot === 'dang_dung') { const dem = {}; ds.forEach(r => { if (r.ai_cam) dem[r.ai_cam] = (dem[r.ai_cam] || 0) + 1 }); u = Object.values(dem).some(n => n > 5) }
    const col = document.createElement('div')
    col.innerHTML = `<div class="cot-dau${u ? ' day' : ''}"><b>${COT[cot]}</b><i>${ds.length}${u ? ' · ứ' : ''}</i></div>
      <div class="cot-than">${ds.length ? ds.map(the).join('') : '<div class="trong-cot">—</div>'}</div>`
    board.appendChild(col)
  })
  board.querySelectorAll('[data-the]').forEach(b => b.onclick = () => moPanel(b.dataset.the))
  $('kbNhac').style.display = 'none'
  const suaRows = rows.filter(r => r.cot === 'sua_gop_y')
  if (suaRows.length >= 3) {
    $('kbNhac').style.display = ''
    $('kbNhac').innerHTML = `<b>Cột "Sửa theo góp ý" đang ứ — ${suaRows.length} việc</b>Chỗ giờ chảy máu mà không ai thấy: khách xem 3D rồi đổi ý nhiều vòng. Tháng nào cũng ứ thì vấn đề ở khâu chốt yêu cầu với khách, không phải ở thiết kế viên.`
  }
}
function the(r) {
  const tre = treKhong(r.ngay_hen_khach) && r.cot !== 'xong_file'
  const cls = tre ? 'tre' : vcTuViec(r.viec).cls   // viền theo VIỆC (bán hàng/sản xuất/mẫu mới)
  const thuc = Number(r.gio_thuc) > 0 ? `<span class="thuc${Number(r.gio_thuc) > Number(r.gio_uoc) ? ' vuot' : ''}">thực ${g1(r.gio_thuc)}</span>` : '<span class="thuc">—</span>'
  return `<button class="the-viec ${cls}" data-the="${esc(r.ma_don)}">
    <span class="mono ma">${esc(r.ma_don)}</span>
    <p class="ten">${esc(r.ten)}</p>
    <p class="loai">${esc(loaiCap(r.cap_thiet_ke))}</p>
    <div class="gio-hang"><span class="uoc">ước ${g1(r.gio_uoc)}</span>${thuc}</div>
    ${r.ai_cam ? `<p class="ai">${esc(r.ai_cam)}${r.vai_cam ? ' · ' + (r.vai_cam === 'tk_ban_hang' ? 'bán hàng' : 'sản xuất') : ''}</p>` : ''}
    ${r.vong_sua ? `<span class="vong-sua">sửa vòng ${r.vong_sua}</span>` : ''}</button>`
}

// ══════════ PANEL chi tiết đơn ══════════
async function moPanel(maDon) {
  $('mo').classList.add('hien'); $('panel').classList.add('hien')
  $('pDau').innerHTML = `<div class="ma">${esc(maDon)}</div><h2>Đang tải…</h2>`
  $('pThan').innerHTML = ''; $('pNut').style.display = 'none'
  const { data, error } = await sb.rpc('tk_chi_tiet_don', { p_ma_don: maDon })
  if (error) { $('pThan').innerHTML = `<div class="trong-rong nho"><p>Lỗi: ${esc(error.message)}</p></div>`; return }
  const d = data
  const tre = treKhong(d.ngay_hen_khach) && d.buoc_thiet_ke !== 'xong_file'
  $('pDau').innerHTML = `<div class="hang"><div><div class="ma">${esc(d.ma_don)}</div><h2>${esc(d.ten)}</h2>
      <div class="dong"><span class="vien-nhan">${esc(loaiCap(d.cap_thiet_ke))}</span>
        <span class="vien-nhan">${esc(COT[d.buoc_thiet_ke] || d.buoc_thiet_ke)}</span>
        ${tre ? '<span class="vien-nhan" style="background:var(--do-nhat);color:#8E2A22">Trễ hạn</span>' : ''}</div></div>
      <button class="dong-x" id="pX">×</button></div>`
  $('pX').onclick = dongPanel
  const mon = (d.mon || []).map(m => `<div class="mon-p"><b>${esc(m.ten)}</b>${m.so_luong > 1 ? ' ×' + m.so_luong : ''}${m.dung_moi ? ' · <span style="color:var(--tim)">dựng mới</span>' : ''}
      <div class="phu">${m.kt ? '<span class="kt">' + esc(m.kt) + '</span> · ' : ''}${esc(m.vl || '—')}${m.mau ? ' · màu ' + esc(m.mau) : ''}</div>
      ${m.chi_tiet ? '<div class="phu">' + esc(m.chi_tiet) + '</div>' : ''}</div>`).join('') || '<p class="don-phu">Chưa có món.</p>'
  const lich = (d.lich_su || []).map(v => `<div class="vet"><span class="luc">${gioLuc(v.luc)}</span><span>${esc(v.viec)}</span></div>`).join('') || '<p class="don-phu">Chưa có mốc nào.</p>'
  const bkd = d.ban_khach_duyet
  const tuiDung = bkd && bkd.nguoi_ban_hang && bkd.nguoi_ban_hang === USER.ten   // kiêm: chính mình dựng 3D
  const banKDHtml = bkd ? `<div class="muc"><h3>Bản khách đã duyệt — dựng file cho khớp</h3>
    <div class="ghitxt" style="background:var(--xong-nhat);border-color:#B8DCCC;color:#0F5C45">${tuiDung && d.la_toi_cam && !d.la_bao_gia ? '<b>Bạn dựng tiếp file sản xuất cho đơn này.</b> ' : ''}Thiết kế bán hàng <b>${esc(bkd.nguoi_ban_hang || '—')}</b> đã dựng 3D <b>bản ${bkd.phien_ban}</b>${bkd.luc_duyet ? ', khách duyệt ' + gioLuc(bkd.luc_duyet) : ''}. Dựng file bám đúng bản này.
      ${bkd.file_nguon ? `<div style="margin-top:8px"><button class="nut-vien" data-taifile="${esc(bkd.file_nguon.duong_dan)}">⬇ Tải file nguồn (dùng lại, đỡ dựng hai lần)</button></div>` : '<div style="margin-top:8px;color:var(--tre);font-weight:600">Không có file nguồn — phải dựng lại từ đầu.</div>'}</div>
    <div class="anh-luoi" id="bkdAnh" style="margin-top:10px"></div></div>` : ''
  $('pThan').innerHTML = `
    ${panelActions(d)}
    <div class="muc"><div class="o-cap">
      <div class="o"><span>Loại + cấp</span><b>${esc(loaiCap(d.cap_thiet_ke))}</b></div>
      <div class="o"><span>Người cầm</span><b>${esc(d.ai_cam || 'Chưa ai nhận')}${d.vai_cam ? ' · ' + (d.vai_cam === 'tk_ban_hang' ? 'bán hàng' : 'sản xuất') : ''}</b></div>
      <div class="o"><span>Giờ ước / thực</span><b>${g1(d.gio_uoc)} / ${g1(d.gio_thuc)} giờ</b></div>
      <div class="o"><span>Số vòng sửa</span><b>${d.vong_sua || 0}</b></div>
      <div class="o"><span>Hạn giao khách</span><b>${d.ngay_hen_khach || '—'}</b></div>
    </div></div>
    ${banKDHtml}
    ${d.ghi_chu ? `<div class="muc"><h3>Ghi chú đơn</h3><div class="ghitxt">${esc(d.ghi_chu)}</div></div>` : ''}
    <div class="muc"><h3>Món (${(d.mon || []).length}) — yêu cầu dựng</h3>${mon}</div>
    <div class="muc"><h3>Lịch sử chuyển bước</h3>${lich}</div>`
  $('pNut').style.display = 'none'
  wireActions(d)
  if ($('taiFileBkd')) {}
  document.querySelectorAll('[data-taifile]').forEach(b => b.onclick = () => taiFileNguon(b.dataset.taifile))
  if (bkd && Array.isArray(bkd.anh) && bkd.anh.length) {
    const urls = await Promise.all(bkd.anh.map(p => sb.storage.from('ban-thiet-ke').createSignedUrl(p, 3600).then(x => x.data && x.data.signedUrl).catch(() => null)))
    if ($('bkdAnh')) $('bkdAnh').innerHTML = urls.filter(Boolean).map(u => `<div class="o-anh"><img src="${u}"></div>`).join('') || '<p class="don-phu">(ảnh bản đã duyệt)</p>'
  }
}
function dongPanel() { $('mo').classList.remove('hien'); $('panel').classList.remove('hien') }
async function taiFileNguon(path) {
  const { data } = await sb.storage.from('ban-thiet-ke').createSignedUrl(path, 3600, { download: true })
  if (data && data.signedUrl) window.open(data.signedUrl, '_blank'); else bao('Không tải được file', true)
}

// ⑤ Khối hành động ĐẦU panel — nút theo LOẠI ĐƠN + người cầm + bước
function panelActions(d) {
  const canNhan = d.la_bao_gia ? USER.coBH : USER.coTK   // đủ năng lực làm việc của đơn này
  const ghiHtml = `<div class="loc" style="margin:0 0 9px"><input type="number" step="0.5" min="0" placeholder="giờ" id="pGio" style="width:90px">
    <button class="nut-nho" id="pGhi">Ghi giờ</button></div>`
  let body = ''
  if (!d.ai_cam) {                                        // chưa ai cầm
    if (laTruong()) body = `<button class="nut-chinh" id="pGiao">Giao cho…</button>`
    else if (CHE_DO === 'giao_viec') body = `<span class="don-phu" style="color:var(--chu-mo)">Chờ trưởng nhóm giao</span>`
    else if (!canNhan) body = `<span class="don-phu" style="color:var(--chu-mo)">Không thuộc nhóm việc của bạn</span>`
    else if (CAM >= 5) body = `<button class="nut-chinh" disabled>Đang cầm 5/5, xong bớt đã</button>`
    else body = `<button class="nut-chinh" id="pNhan">Nhận việc</button>`
  } else if (d.la_toi_cam) {                              // TÔI cầm
    if (d.la_bao_gia) {
      const saleBox = (d.buoc_thiet_ke === 'sua_gop_y' && d.sale_ghi_chu)
        ? `<div class="ghitxt" style="background:var(--do-nhat);border-color:#F3C9C4;color:#7C1D18;margin-bottom:9px"><b>Sale trả về — sửa theo:</b> ${esc(d.sale_ghi_chu)}</div>` : ''
      const nut = d.buoc_thiet_ke === 'cho_duyet' ? `<span class="don-phu" style="color:var(--cho)">Đang chờ sale phản hồi</span>`
        : `<button class="nut-chinh" id="pGuiBan">${d.buoc_thiet_ke === 'sua_gop_y' ? 'Gửi bản mới' : 'Gửi bản 3D cho sale'}</button>`
      body = saleBox + ghiHtml + nut
    } else {
      const nut = (d.buoc_thiet_ke === 'xong_file' || d.da_gui_xuong) ? `<span class="don-phu" style="color:var(--xong)">Đã gửi xưởng</span>`
        : `<button class="nut-chinh" id="pGuiFile">Gửi file sản xuất cho xưởng</button>`
      body = ghiHtml + nut
    }
  } else {                                               // NGƯỜI KHÁC cầm
    body = `<span class="don-phu">Đơn này do <b>${esc(d.ai_cam)}</b> đang cầm</span>`
    if (laTruong()) body += `<div style="margin-top:9px"><button class="nut-vien" id="pChuyen">Chuyển cho người khác</button></div>`
  }
  return `<div class="muc" style="background:#FAFBFC;margin:0 -22px;padding:16px 22px"><h3>Hành động</h3>${body}</div>`
}
function wireActions(d) {
  if ($('pGhi')) $('pGhi').onclick = () => ghiGioPanel(d.ma_don)
  if ($('pNhan')) $('pNhan').onclick = async () => { await nhanViec(d.ma_don); dongPanel() }
  if ($('pGiao')) $('pGiao').onclick = () => moGiao(d.ma_don)
  if ($('pChuyen')) $('pChuyen').onclick = () => moChuyen(d.ma_don, d.ai_cam)
  if ($('pGuiBan')) $('pGuiBan').onclick = () => moGuiBan(d.ma_don)
  if ($('pGuiFile')) $('pGuiFile').onclick = () => moGuiFile(d.ma_don)
}
async function ghiGioPanel(maDon) {
  const so = Number($('pGio') && $('pGio').value)
  if (!so || so <= 0) { bao('Nhập số giờ trước đã', true); return }
  const { error } = await sb.rpc('ghi_gio_thiet_ke', { p_ma_don: maDon, p_so_gio: so })
  if (error) { bao(error.message, true); return }
  bao(`Đã ghi ${g1(so)} giờ`); moPanel(maDon); if ($('s-viec').style.display !== 'none') taiViec()
}

// ══════════ ③ GIỜ & CHI PHÍ ══════════
async function taiGio() {
  const ky = $('chonKy').value
  const laX = ['ceo', 'thiet_ke', 'truong_nhom_thiet_ke'].includes(USER.vai_tro)   // bảng SẢN XUẤT
  const laB = ['ceo', 'tk_ban_hang', 'truong_nhom_thiet_ke'].includes(USER.vai_tro) // bảng BÁN HÀNG
  const [gcp, ttx, ttb] = await Promise.all([
    sb.rpc('tk_gio_chi_phi', { p_ma_ky: ky }),
    laX ? sb.rpc('tt_thiet_ke_xuong', { p_ma_ky: ky }) : Promise.resolve({ skip: true }),
    laB ? sb.rpc('tt_thiet_ke_ban_hang', { p_ma_ky: ky }) : Promise.resolve({ skip: true })
  ])
  const d = gcp.data || { o_so: {}, gio_di_dau: {}, uoc_thuc: [] }
  const o = d.o_so || {}
  $('oSo').innerHTML = `
    <div class="o-so"><p>Giờ thiết kế trong kỳ</p><b>${g1(o.gio_thang || 0)}</b><small>giờ đã ghi</small></div>
    <div class="o-so"><p>Tỷ lệ giờ về được đơn</p><b>${o.ty_le_ve_don == null ? '—' : o.ty_le_ve_don + '%'}</b><small>còn lại: báo giá thua, sửa, mẫu mới</small></div>
    <div class="o-so do"><p>Giờ đổ vào báo giá THUA</p><b>${g1(o.gio_bao_gia_thua || 0)}</b><small>thành chi phí bán hàng, không vào giá vốn</small></div>
    <div class="o-so do"><p>Giờ sửa theo góp ý</p><b>${g1(o.gio_sua_gop_y || 0)}</b><small>không nằm trong số ước nào</small></div>`
  const ut = d.uoc_thuc || []
  $('uocThuc').innerHTML = ut.length ? ut.map(x => {
    const duTin = x.du_tin, uoc = Number(x.gio_uoc), thuc = duTin ? Number(x.gio_thuc_tb) : null
    const lech = duTin && thuc != null ? thuc - uoc : null, mx = Math.max(uoc, thuc || 0, 1)
    const lechHtml = lech == null ? '<span class="lech">chưa đủ đơn để tin</span>'
      : `<span class="lech ${lech > 0 ? 'xau' : 'tot'}">${lech > 0 ? '+' : ''}${g1(lech)} giờ · ${lech > 0 ? 'ước thiếu' : 'ước dư'}</span>`
    return `<div class="so-sanh"><div class="ss-dau"><b>${esc(loaiCap(x.cap))}</b>${lechHtml}</div>
      <div class="thanh-doi">
        <div class="hang"><span class="nhan-h">Ước</span><div class="rang"><div style="width:${Math.round(uoc / mx * 100)}%;background:var(--chu-mo)"></div></div><span class="so">${g1(uoc)} giờ</span></div>
        <div class="hang"><span class="nhan-h">Thực</span><div class="rang"><div style="width:${thuc != null ? Math.round(thuc / mx * 100) : 0}%;background:${lech > 0 ? 'var(--tre)' : 'var(--xong)'}"></div></div><span class="so">${thuc != null ? g1(thuc) + ' giờ' : '—'}</span></div>
      </div>
      <p class="ss-can-cu">Căn cứ: ${x.so_don} đơn${duTin ? '' : ' — cần ít nhất 5 đơn mới tính được'}</p></div>`
  }).join('') : '<div class="trong-rong nho"><p>Chưa có đơn nào xong file trong kỳ (đơn demo không tính vào thành tích).</p></div>'
  const gd = d.gio_di_dau || {}, tong = (Number(gd.thang) || 0) + (Number(gd.thua) || 0) + (Number(gd.sua) || 0) + (Number(gd.mau_cho) || 0)
  $('gioDiDauTong').textContent = tong ? g1(tong) + ' giờ trong kỳ' : ''
  const pc = v => tong ? Math.round((Number(v) || 0) / tong * 100) : 0
  $('gioDiDau').innerHTML = tong ? `
    <div class="chia">
      <div style="width:${pc(gd.thang)}%;background:var(--xong)"></div><div style="width:${pc(gd.thua)}%;background:var(--cho)"></div>
      <div style="width:${pc(gd.sua)}%;background:var(--tre)"></div><div style="width:${pc(gd.mau_cho)}%;background:var(--chu-mo)"></div>
    </div>
    <div class="chu-giai">
      <span><i style="background:var(--xong)"></i>Đơn thắng — vào giá vốn <b>${pc(gd.thang)}%</b></span>
      <span><i style="background:var(--cho)"></i>Báo giá thua — vào phí đơn <b>${pc(gd.thua)}%</b></span>
      <span><i style="background:var(--tre)"></i>Sửa theo góp ý <b>${pc(gd.sua)}%</b></span>
      <span><i style="background:var(--chu-mo)"></i>Mẫu mới, chờ việc <b>${pc(gd.mau_cho)}%</b></span>
    </div>` : '<p class="trong-rong nho">Chưa có giờ nào ghi trong kỳ này.</p>'
  if (ttx.skip) $('ttXuong').innerHTML = '<tr><td colspan="5" class="nen-xam" style="padding:22px 18px">Bạn là thiết kế BÁN HÀNG — chỉ số sản xuất không áp dụng; xem bảng bán hàng bên dưới.</td></tr>'
  else veTTXuong(ttx.data || [], ttx.error)
  if (ttb.skip) $('ttBanHang').innerHTML = '<tr><td colspan="5" class="nen-xam" style="padding:22px 18px">Bạn là thiết kế SẢN XUẤT — chỉ số bán hàng không áp dụng; xem bảng sản xuất bên trên.</td></tr>'
  else veTTBanHang(ttb.data || [], ttb.error)
}
const tenAi = r => `<span class="ten-nguoi"><b>${esc(r.ho_ten || '—')}</b></span>`
function veTTXuong(rows, err) {
  const tb = $('ttXuong')
  if (err) { tb.innerHTML = `<tr><td colspan="5" style="color:var(--do)">${esc(err.message)}</td></tr>`; return }
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="nen-xam" style="padding:22px 18px">Chưa có đơn thật nào của thiết kế sản xuất trong kỳ (đơn demo không tính).</td></tr>`; return }
  tb.innerHTML = rows.map(r => {
    const du = r.du_tin, fileP = r.file_dung_lan_dau_pct, uoc = r.uoc_lech_gio_tb
    return `<tr>
      <td>${tenAi(r)}${!du ? '<span class="phu-nho">' + esc(r.canh_bao || '') + '</span>' : ''}</td>
      <td><span class="so-chinh">${g1(r.viec_xong_chuan_hoa)}</span><span class="phu-nho">giờ chuẩn · ${r.so_don_can_cu} đơn</span></td>
      <td>${!du ? '<span class="nen-xam">chưa đủ đơn</span>' : (fileP == null ? '<span class="nen-xam">—</span>' : `<span class="so-chinh ${fileP >= 90 ? 'tot' : (fileP < 70 ? 'xau' : 'vua')}">${fileP}%</span>`)}</td>
      <td><span class="so-chinh ${r.loi_do_file_bat > 0 ? 'xau' : 'tot'}">${r.loi_do_file_bat}</span></td>
      <td>${uoc == null ? '<span class="nen-xam">chưa ghi giờ</span>' : `<span class="so-chinh ${Math.abs(uoc) <= 10 ? 'tot' : 'vua'}">${uoc > 0 ? '+' : ''}${g1(uoc)}</span>`}</td></tr>`
  }).join('')
}
function veTTBanHang(rows, err) {
  const tb = $('ttBanHang')
  if (err) { tb.innerHTML = `<tr><td colspan="5" style="color:var(--do)">${esc(err.message)}</td></tr>`; return }
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="nen-xam" style="padding:22px 18px">Chưa có đơn thật nào của thiết kế bán hàng trong kỳ (đơn demo không tính).</td></tr>`; return }
  tb.innerHTML = rows.map(r => {
    const du = r.du_tin, ra = r.ra_phuong_an_dau_gio
    return `<tr>
      <td>${tenAi(r)}${!du ? '<span class="phu-nho">' + esc(r.canh_bao || '') + '</span>' : ''}</td>
      <td>${ra == null ? '<span class="nen-xam">—</span>' : `<span class="so-chinh ${ra <= 24 ? 'tot' : 'vua'}">${g1(ra)}</span><span class="phu-nho">giờ từ lúc nhận</span>`}</td>
      <td><span class="so-chinh ${r.sale_tra_ve_hieu_sai > 0 ? 'xau' : 'tot'}">${r.sale_tra_ve_hieu_sai}</span></td>
      <td><span class="so-chinh">${g1(r.viec_xong_chuan_hoa)}</span><span class="phu-nho">giờ chuẩn · ${r.so_don_can_cu} đơn</span></td>
      <td>${r.ty_le_khach_chot == null ? '<span class="nen-xam">—</span>' : `<span class="so-chinh nen-xam">${r.ty_le_khach_chot}%</span><span class="phu-nho">chỉ để nhìn</span>`}</td></tr>`
  }).join('')
}

// ══════════════════ TAB NHẬP SỐ SẢN XUẤT ══════════════════
let NS = { ma_don: null, data: null, sel: null, qtds: null, hdMo: {} }   // ma_don LẤY TỪ URL ?don=
const DV_TEN = { cat: 'số tấm chi tiết', dan: 'mét cạnh', cam: 'số lỗ', thung: 'số tấm carcass', cup: 'số cup', ray: 'số ngăn kéo', canh: 'số cánh', goi: 'số kiện', lot: 'm² bề mặt', pu: 'm² sơn', son_canh: 'mét cạnh sơn', giuong_lap: 'số giường', cho_kho: '—' }
const TEN_TO = { cnc: 'CNC', dan_canh: 'Dán cạnh', cha_lot: 'Chà lót', son_pu: 'Sơn PU', lap_rap: 'Lắp ráp', dong_goi: 'Đóng gói', giuong: 'Giường' }
const HD_TO = { cat: 'cnc', dan: 'dan_canh', cam: 'dan_canh', lot: 'cha_lot', pu: 'son_pu', son_canh: 'son_pu', cup: 'lap_rap', thung: 'lap_rap', ray: 'lap_rap', canh: 'lap_rap', goi: 'dong_goi', giuong_lap: 'giuong', cho_kho: 'son_pu' }
// Nội dung "?" NGUYÊN VĂN từ file mẫu (8 hoạt động)
const HD_DONG = {
  cat: { dem: ['Đếm <b>số tấm gỗ</b> phải cắt ra, tính cả tấm hậu và tấm hộp kéo', '<b>Không</b> tính kính, thép, sào treo — không qua máy cắt', 'Một tấm cắt ra hai mảnh giống nhau vẫn là hai'], canh: 'Đây là số <b style="display:inline">tấm chi tiết</b>, không phải số tấm ván nguyên mua về. Máy chạy theo số mảnh phải cắt và số lần nạp/dỡ.', vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Thùng 24 tấm (hông, đáy, nóc, vách, hậu, đợt).<br>Cánh 12 tấm (4 cánh, mỗi cánh 3 mảnh ghép).<br>Hộp kéo 9 tấm (3 ngăn × 3 mảnh).', tinh: 'gõ: 24+12+9 → = 45 tấm' },
  dan: { dem: ['Chỉ đếm <b>cạnh lộ ra ngoài</b> — cạnh nhìn thấy được sau khi lắp', 'Cạnh áp tường, cạnh giáp tấm khác thì <b>không dán</b>, không đếm', 'Cộng chiều dài các cạnh dán, đổi ra <b>mét</b>'], canh: 'Đây là bước tốn giờ nhất của hầu hết món. Đếm dư 10 mét là dôi hơn một giờ rưỡi — soi kỹ cạnh nào thật sự lộ.', vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Cánh: 4 cánh dán 4 cạnh → 4 × (2,2+2,2+0,6+0,6) = 22,4 m<br>Thùng: hông/nóc/đáy chỉ dán cạnh trước → ~14 m<br>Đợt và vách: dán cạnh trước → ~13,6 m', tinh: 'gõ: 22.4+14+13.6 → = 50 m' },
  cam: { dem: ['Đếm <b>số lỗ</b>, không phải số tấm có lỗ', 'Mỗi mối nối hai tấm dùng 2–3 bộ cam tuỳ chiều sâu', 'Tấm sâu trên 600 thì thêm một cặp'], canh: 'Dễ nhầm nhất: đếm "12 tấm có khoan cam" rồi gõ 12. Sai — phải là tổng số lỗ trên cả 12 tấm.', vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Đếm được 40 mối nối giữa các tấm thùng.<br>Sâu 600 nên mỗi mối 3 bộ cam.', tinh: 'gõ: 40*3 → = 120 lỗ' },
  thung: { dem: ['Chỉ tấm làm nên <b>thùng</b>: hông, đáy, nóc, vách, hậu, đợt', '<b>Không</b> tính cánh — cánh có bước riêng', '<b>Không</b> tính tấm hộp kéo — thuộc bước ngăn kéo'], canh: 'Gõ nhầm cả 45 tấm vào đây là tính dôi công lắp gấp bốn lần. Số này luôn nhỏ hơn số tấm cắt.', vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: '2 hông · 1 đáy · 1 nóc · 4 hậu · 4 đợt', tinh: 'gõ: 2+1+1+4+4 → = 12 tấm' },
  cup: { dem: ['Số bản lề = <b>số cánh × số bản lề mỗi cánh</b>', 'Số bản lề mỗi cánh theo <b>chiều cao cánh</b> — xem luật của xưởng', 'Cánh lùa không có bản lề, không đếm'], canh: 'Con số bản lề theo chiều cao trong ví dụ là <b style="display:inline">tham khảo</b>. Xưởng có luật riêng thì theo luật xưởng.', vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Cánh cao 2200, theo luật xưởng dùng 4 bản lề mỗi cánh.<br>4 cánh mở.', tinh: 'gõ: 4*4 → = 16 cup' },
  ray: { dem: ['Đếm <b>số ngăn kéo</b>, không đếm số ray', 'Một ngăn kéo dùng một đôi ray — công tính theo ngăn', 'Ngăn kéo chìm và ngăn kéo lộ đếm như nhau'], canh: null, vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Buồng giữa có 3 ngăn kéo xếp dọc.', tinh: 'gõ: 3 → = 3 ngăn' },
  canh: { dem: ['Đếm <b>số cánh</b> phải treo và căn chỉnh khe hở', 'Cánh lùa vẫn đếm — vẫn tốn công căn', 'Mặt ngăn kéo không tính là cánh'], canh: null, vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: '4 cánh mở, không có cánh lùa.', tinh: 'gõ: 4 → = 4 cánh' },
  goi: { dem: ['Đếm <b>số kiện</b> bọc ra để bốc lên xe', 'Món to phải tách nhiều kiện cho vừa xe và vừa thang máy', 'Cánh thường bó riêng một kiện'], canh: null, vdT: 'Ví dụ — tủ áo 4 cánh 2m4', vd: 'Thùng bó 1 kiện, cánh bó riêng 1 kiện.', tinh: 'gõ: 2 → = 2 kiện' }
}
const NHANH_CLS = n => n === 'thùng' ? ' nhanh-thung' : n === 'cánh' ? ' nhanh-canh' : ''
// eval biểu thức: chỉ + và * · null=rỗng · NaN=rác
function tinhBt(s) { s = String(s || '').replace(/\s/g, ''); if (s === '') return null; if (!/^[0-9]+([+*][0-9]+)*$/.test(s)) return NaN; return s.split('+').reduce((a, t) => a + t.split('*').reduce((p, f) => p * Number(f), 1), 0) }
const gioT = n => n == null ? '—' : g1(n)   // giờ luôn kèm [TẠM] ở chỗ hiển thị

function nsRong(msg) {   // màn rỗng / lỗi tải — KHÔNG hiện đơn nào
  $('nsDau').innerHTML = '<div><h1>Nhập số sản xuất</h1><p>' + esc(msg) + '</p></div>'
  const hd = document.querySelector('#s-nhapso .hd'); if (hd) hd.style.display = 'none'
  $('nsTong').innerHTML = ''; $('nsMonDs').innerHTML = ''
  $('nsPhai').innerHTML = '<div class="nhac"><b>Chưa mở đơn nào</b>' + esc(msg) + '</div>'
}
function nsLoiDon(m) {   // fail-đóng: dịch mã lỗi ra lý do rõ
  let ly = m
  if (/DON_KHONG_TON_TAI/.test(m)) ly = 'Mã đơn không tồn tại.'
  else if (/DON_CHUA_CHOT/.test(m)) ly = 'Đơn này còn là báo giá, chưa chốt — lên đơn trước.'
  else if (/chỉ ceo\/thiet_ke/.test(m)) ly = 'Bạn không có quyền xem đơn này.'
  nsRong(ly)
}
async function taiNhapSo() {
  if (!['thiet_ke', 'ceo'].includes(USER.vai_tro)) { nsRong('Chỉ Thiết kế sản xuất và CEO vào được màn này.'); return }
  const md = new URLSearchParams(location.search).get('don')
  if (!md) { nsRong('Mở màn này từ một đơn cụ thể — ví dụ /?don=DH-2026-0142. Chưa có mã đơn nên không hiện đơn nào.'); return }
  const hd = document.querySelector('#s-nhapso .hd'); if (hd) hd.style.display = ''
  $('nsDau').innerHTML = '<div><h1>Đang tải…</h1></div>'; $('nsTong').innerHTML = ''; $('nsMonDs').innerHTML = ''; $('nsPhai').innerHTML = ''
  if (!NS.qtds) { const { data } = await sb.rpc('quy_trinh_ds'); NS.qtds = data || [] }
  const { data, error } = await sb.rpc('nhap_so_don_don_hang', { p_ma_don: md })
  if (error) { nsLoiDon(error.message); return }
  NS.ma_don = md; NS.data = data
  if (!NS.sel || !data.mon.find(m => m.sp_id === NS.sel)) NS.sel = (data.mon[0] || {}).sp_id
  renderNsDau(); renderNsTong(); renderNsMonDs(); await renderNsPhai()
}
function renderNsDau() {
  const d = NS.data
  let nhan, dis
  if (d.da_vao_chuyen) { nhan = 'Đã vào chuyền — chờ cắt'; dis = true }
  else if (d.day_duoc) { nhan = 'Đẩy xuống xưởng'; dis = false }
  else if (d.so_thieu_mon > 0) { nhan = 'Đẩy xuống xưởng — còn ' + d.so_thieu_mon + ' món thiếu số'; dis = true }
  else { nhan = 'Đẩy xuống xưởng — đơn chưa ở trạng thái đẩy'; dis = true }
  $('nsDau').innerHTML = '<div><span class="ma mono">' + esc(d.ma_don) + '</span><h1>' + esc(d.ten_don || d.ma_don) +
    '</h1><p>Gán quy trình cho từng món và nhập số đơn vị. Đủ số thì đẩy được xuống xưởng.</p></div>' +
    '<button class="nut-day" id="nsNutDay"' + (dis ? ' disabled' : '') + '>' + esc(nhan) + '</button>'
  $('nsNutDay').onclick = nsDay
}
function renderNsTong() {
  const t = NS.data.dai_tong
  if (!t) { $('nsTong').innerHTML = ''; return }   // đơn 1 món → ẩn dải
  const tos = Object.entries(t.theo_to || {}).sort((a, b) => b[1] - a[1])
  const max = tos.length ? tos[0][1] : 1
  const bars = tos.map(([k, v]) => '<div class="hang"><span class="ten">' + esc(TEN_TO[k] || k) + '</span><div class="rang"><div style="width:' + Math.round(v / max * 100) + '%"></div></div><span class="sl">' + g1(v) + '</span></div>').join('')
  $('nsTong').innerHTML = '<div class="tong"><div class="o"><p>Tổng giờ dự kiến</p><b>' + g1(t.tong_gio) + '</b>' +
    '<small>[TẠM] · mới tính ' + t.dem_du + '/' + t.so_mon + ' món</small></div>' +
    '<div class="o"><p>Món nặng nhất</p><b>' + (t.mon_nang_nhat ? g1(t.mon_nang_nhat.gio) : '—') + '</b><small>' +
    (t.mon_nang_nhat ? esc(t.mon_nang_nhat.ten) + ' — quyết ngày giao' : '') + '</small></div>' +
    '<div class="to"><p style="font-size:12.5px;color:var(--chu-nhat);margin-bottom:7px">Giờ theo tổ · [TẠM]</p>' + bars + '</div></div>'
}
function renderNsMonDs() {
  const d = NS.data
  const nut = d.mon.map(m => {
    let tt = '', cls = ''
    if (m.trang_thai === 'du') { cls = 'tt-xong'; tt = 'Đủ số · ' + g1(m.tong_gio) + ' giờ [TẠM]' }
    else if (m.trang_thai === 'thieu') { cls = 'tt-thieu'; tt = 'Thiếu ' + m.so_thieu + ' số' }
    else { cls = 'tt-chua'; tt = 'Chưa gán quy trình' }
    const qt = esc(m.kt || '') + ' · ' + esc(m.ten_quy_trinh || 'chưa gán quy trình')
    return '<button class="mon' + (m.sp_id === NS.sel ? ' chon' : '') + '" data-mon="' + esc(m.sp_id) + '"><b>' + esc(m.ten) +
      '</b><span class="qt">' + qt + '</span><span class="tt ' + cls + '">' + tt + '</span></button>'
  }).join('')
  $('nsMonDs').innerHTML = '<div class="dau-ds">' + d.so_mon + ' món<em>' + (d.so_mon - d.so_thieu_mon) + ' xong · ' + d.so_thieu_mon + ' thiếu</em></div>' + nut
  $('nsMonDs').querySelectorAll('[data-mon]').forEach(b => b.onclick = () => { NS.sel = b.dataset.mon; renderNsMonDs(); renderNsPhai() })
}
async function renderNsPhai() {
  const m = NS.data.mon.find(x => x.sp_id === NS.sel)
  if (!m) { $('nsPhai').innerHTML = ''; return }
  const { data: ct } = await sb.rpc('nhap_so_chi_tiet_mon', { p_ma_bt: NS.sel })
  const idx = NS.data.mon.findIndex(x => x.sp_id === NS.sel) + 1
  const opts = NS.qtds.map(q => '<option value="' + esc(q.ma_quy_trinh) + '"' + (q.ma_quy_trinh === (ct && ct.ma_quy_trinh) ? ' selected' : '') + '>' + esc(q.ten) + ' — ' + q.so_buoc + ' bước</option>').join('')
  let h = '<div class="the"><div class="the-dau"><div><h2>' + esc(m.ten) + '</h2><p>' + esc(m.kt) + ' mm · lõi ' + esc(m.ma_loi || '—') + '</p></div>' +
    '<span class="mono" style="font-size:13px;color:var(--chu-nhat)">món ' + idx + '/' + NS.data.so_mon + '</span></div>'
  // chọn quy trình + preview bước
  h += '<div class="qt-chon"><label>Quy trình sản xuất</label>' +
    '<select id="nsQt"><option value="">— chọn quy trình —</option>' + opts + '</select>'
  if (ct && !ct.chua_gan) {
    h += '<div class="qt-buoc">' + ct.buoc.map((b, i) => '<span class="buoc' + NHANH_CLS(b.nhanh) + '">' + esc(b.ten_hoat_dong || b.hoat_dong) + '</span>' + (i < ct.buoc.length - 1 ? '<span class="mui">→</span>' : '')).join('') + '</div>' +
      '<div class="chu-giai-nhanh"><span><i style="background:#CFDDEE"></i>nhánh thùng</span><span><i style="background:#D6D1F3"></i>nhánh cánh</span><span>hai nhánh chạy song song, gộp ở bước lắp cánh</span></div>'
  }
  h += '</div>'
  if (!ct || ct.chua_gan) {
    h += '<div class="nhac do"><b>Chưa gán quy trình</b>Chọn quy trình ở trên để hiện bảng nhập số đơn vị. Món này chưa đẩy xuống xưởng được.</div></div>'
    $('nsPhai').innerHTML = h + nsNhacCuoi()
    $('nsQt').onchange = nsGanQt
    return
  }
  // bảng nhập
  const nguoiBuoc = ct.buoc.filter(b => b.loai_buoc !== 'tu_chay')
  h += '<div class="nhap-dau"><h3>Số đơn vị — ' + nguoiBuoc.length + ' số</h3><button class="nut-plugin" id="nsPlugin">Lấy từ plugin</button></div>' +
    '<div class="dv-dau"><div>Hoạt động</div><div>Số đơn vị</div><div>Nguồn</div><div>Giờ</div></div>'
  let tongMon = 0, duHet = true
  ct.buoc.forEach(b => {
    if (b.loai_buoc === 'tu_chay') { h += nsDongTuChay(b); if (b.gio != null) tongMon += Number(b.gio); return }
    const co = b.so_don_vi != null
    if (!co) duHet = false; else tongMon += Number(b.gio || 0)
    h += nsDongNhap(b, co)
  })
  h += '<div class="tong-mon"><span>Tổng món này</span><b>' + (duHet ? g1(tongMon) + ' giờ [TẠM]' : '— (còn thiếu số)') + '</b></div></div>'
  $('nsPhai').innerHTML = h + nsNhacCuoi()
  // bind
  $('nsQt').onchange = nsGanQt
  $('nsPlugin').onclick = () => bao('Chưa nối plugin — nhập tay hoặc chọn Ước', true)
  ct.buoc.filter(b => b.loai_buoc !== 'tu_chay').forEach(b => nsBindDong(b))
}
function nsDongNhap(b, co) {
  const val = co ? esc(b.bieu_thuc != null ? b.bieu_thuc : String(b.so_don_vi)) : ''
  const bang = co ? '<span class="bang">= ' + g1(b.so_don_vi).replace(',0', '') + '</span>' : ''
  const ng = b.nguon || 'go_tay'
  const nguon = ['cutlist', 'go_tay', 'uoc'].map(x => '<button data-ng="' + x + '"' + (co && ng === x ? ' class="chon"' : (!co && x === 'go_tay' ? '' : '')) + '>' + ({ cutlist: 'Plugin', go_tay: 'Gõ tay', uoc: 'Ước' }[x]) + '</button>').join('')
  const gio = co ? '<div class="gio">' + g1(b.gio) + '<small>giờ [TẠM]</small></div>' : '<div class="gio trong">—</div>'
  return '<div class="dong-nhom" data-hd="' + esc(b.hoat_dong) + '">' +
    '<div class="dv"><div class="nhan"><span class="dv-ten"><b>' + esc(b.ten_hoat_dong || b.hoat_dong) + '</b>' +
    (HD_DONG[b.hoat_dong] ? '<button class="nut-hd" data-hdbtn>?</button>' : '') + '</span><small>' + esc(DV_TEN[b.hoat_dong] || 'số đơn vị') + '</small></div>' +
    '<div class="o-nhap"><input' + (co ? '' : ' class="trong"') + ' value="' + val + '"' + (co ? '' : ' placeholder="chưa nhập"') + '>' + bang + '</div>' +
    '<div class="nguon">' + nguon + '</div>' + gio + '</div>' +
    (HD_DONG[b.hoat_dong] ? nsHdDong(b.hoat_dong) : '') + '</div>'
}
function nsDongTuChay(b) {
  return '<div class="dong-nhom"><div class="dv"><div class="nhan"><span class="dv-ten"><b>' + esc(b.ten_hoat_dong || b.hoat_dong) + '</b></span><small>tự chạy — không nhập số</small></div>' +
    '<div style="font-size:12.5px;color:var(--chu-mo)">hệ thống tự suy</div><div></div>' +
    '<div class="gio">' + g1(b.gio) + '<small>giờ [TẠM]</small></div></div></div>'
}
function nsHdDong(hd) {
  const g = HD_DONG[hd]; const mo = NS.hdMo[hd]
  return '<div class="hd-dong" data-hdbox="' + hd + '"' + (mo ? '' : ' style="display:none"') + '><div class="cot">' +
    '<div><h4>Đếm cái gì</h4><ul>' + g.dem.map(x => '<li>' + x + '</li>').join('') + '</ul>' +
    (g.canh ? '<div class="canh">' + g.canh + '</div>' : '') + '</div>' +
    '<div class="vd"><b>' + esc(g.vdT) + '</b>' + g.vd + '<span class="tinh">' + esc(g.tinh) + '</span></div></div></div>'
}
function nsBindDong(b) {
  const root = $('nsPhai').querySelector('.dong-nhom[data-hd="' + b.hoat_dong + '"]'); if (!root) return
  const inp = root.querySelector('input'), oNhap = root.querySelector('.o-nhap')
  const hdbtn = root.querySelector('[data-hdbtn]')
  if (hdbtn) hdbtn.onclick = () => { NS.hdMo[b.hoat_dong] = !NS.hdMo[b.hoat_dong]; const box = root.querySelector('[data-hdbox]'); box.style.display = NS.hdMo[b.hoat_dong] ? 'block' : 'none'; hdbtn.classList.toggle('mo', NS.hdMo[b.hoat_dong]) }
  let ng = b.nguon || 'go_tay'
  root.querySelectorAll('.nguon [data-ng]').forEach(nb => nb.onclick = () => { ng = nb.dataset.ng; root.querySelectorAll('.nguon [data-ng]').forEach(x => x.classList.toggle('chon', x === nb)); nsLuu(b.hoat_dong, inp.value, ng, root) })
  // live "= N" + lỗi
  const live = () => {
    oNhap.querySelector('.loi-txt') && oNhap.querySelector('.loi-txt').remove()
    let bang = oNhap.querySelector('.bang'); if (!bang) { bang = document.createElement('span'); bang.className = 'bang'; oNhap.appendChild(bang) }
    const v = tinhBt(inp.value)
    if (Number.isNaN(v)) { inp.classList.add('loi'); bang.textContent = ''; const e = document.createElement('div'); e.className = 'loi-txt'; e.textContent = 'Chỉ nhận số, dấu + và dấu *'; root.querySelector('.dv').appendChild(e); return false }
    inp.classList.remove('loi'); bang.textContent = v == null ? '' : '= ' + g1(v).replace(',0', '')
    return true
  }
  inp.oninput = live
  inp.onchange = () => { if (live()) nsLuu(b.hoat_dong, inp.value, ng, root) }
}
async function nsLuu(hd, bieu_thuc, nguon, root) {
  if (Number.isNaN(tinhBt(bieu_thuc))) return  // rác — không lưu
  const { error } = await sb.rpc('luu_so_don_vi', { p_ma_bt: NS.sel, p_hoat_dong: hd, p_bieu_thuc: bieu_thuc, p_nguon: nguon })
  if (error) { bao('Lưu lỗi: ' + error.message, true); return }
  bao('Đã lưu ' + (DV_TEN[hd] || hd))
  await taiNhapSo()   // cập nhật giờ dòng + tổng món + trạng thái đơn
}
async function nsGanQt() {
  const qt = $('nsQt').value; if (!qt) return
  const { error } = await sb.rpc('gan_quy_trinh_mon', { p_ma_bt: NS.sel, p_ma_qt: qt })
  if (error) { bao('Gán lỗi: ' + error.message, true); return }
  await taiNhapSo()
}
async function nsDay() {
  const { error } = await sb.rpc('day_so_san_xuat', { p_ma_don: NS.ma_don })
  if (error) { bao(error.message.replace(/^.*(CHUA_GAN_QUY_TRINH|THIEU_SO_DON_VI|DA_VAO_CHUYEN|TRANG_THAI_KHONG_DAY|DON_CHUA_CHOT):\s*/, ''), true); return }
  bao('Đã đẩy xuống xưởng — đơn vào chờ cắt ✓'); await taiNhapSo()
}
function nsNhacCuoi() {
  return '<div class="nhac"><b>Vì sao phải nhập tay</b>Món dựng bằng plugin thì bấm "Lấy từ plugin", các số tự về trong một giây. Món dựng tự do trong SketchUp và hàng gỗ tự nhiên không có sẵn số — đếm rồi gõ. Đó là chuyện bình thường, không phải lỗi.</div>'
}

// ══════════ BOOT ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session && data.session.user) laySauDangNhap(data.session.user)
  else manDangNhap()
})()
