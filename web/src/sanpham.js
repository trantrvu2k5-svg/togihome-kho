// App SẢN PHẨM — ba tầng: lõi → biến thể → niêm yết. Lô này 2 tab: Cây sản phẩm · Danh sách.
//   Vào: ceo · ke_toan (có giá vốn). Vai khác CHẶN. Đọc qua RPC curated (sp_danh_sach / sp_cay / sp_loc_options).
//   Nhãn vàng ở Danh sách = cần soát: vật liệu ĐOÁN chưa xác nhận · kích thước chưa có số. Bấm nhãn → sửa (sp_sua_bien_the).
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb   // L-74: phơi client cho kiểm chéo RPC

const VAI_VAO = ['ceo', 'ke_toan', 'thiet_ke']   // thiet_ke vào cho tab Quy trình
const TEN_VAI = { ceo: 'CEO', ke_toan: 'Kế toán', thiet_ke: 'Thiết kế sản xuất' }
const laQT = () => ['ceo', 'thiet_ke'].includes(USER.vai_tro)   // vai được vào tab Quy trình
const laCatalog = () => ['ceo', 'ke_toan'].includes(USER.vai_tro) // vai xem Cây/Danh sách
// tổ + đơn vị đếm + đơn vị ngắn cho tab Quy trình
const TEN_TO = { cnc: 'CNC', dan_canh: 'Dán cạnh', cha_lot: 'Chà lót', son_pu: 'Sơn PU', lap_rap: 'Lắp ráp', dong_goi: 'Đóng gói', giuong: 'Giường' }
const DV_DEM = { cat: 'số tấm chi tiết', dan: 'mét cạnh', cam: 'số lỗ', thung: 'số tấm carcass', cup: 'số cup', ray: 'số ngăn kéo', canh: 'số cánh', goi: 'số kiện', lot: 'm² bề mặt', pu: 'm² bề mặt sơn', son_canh: 'mét cạnh sơn', giuong_lap: 'giường' }
const DV_NGAN = { cat: 'tấm', dan: 'mét', cam: 'lỗ', thung: 'tấm', cup: 'cup', ray: 'ngăn', canh: 'cánh', goi: 'kiện', lot: 'm²', pu: 'm²', son_canh: 'mét', giuong_lap: 'giường' }

let USER = null, TAB = 'cay', OPTS = null
let DS = []                 // danh sách niêm yết (phẳng, đã lọc, xếp bán chạy)
let CAY_MO = new Set()      // ma_loi đang mở trong tab Cây
let CAY_LIST = []           // [ [ma_loi, L] ] theo thứ tự render — bung/thu tra theo chỉ số, KHÔNG dựng lại cả cây
let SUA = null              // biến thể đang sửa trong modal

const $ = id => document.getElementById(id)
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const tien = n => { n = Number(n); return Number.isFinite(n) && n ? n.toLocaleString('vi-VN') + 'đ' : '—' }
const tienGon = n => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' tỷ' : n >= 1e6 ? Math.round(n / 1e6) + ' tr' : n ? Math.round(n / 1e3) + 'k' : '0' }
// ảnh lưu ở DB chỉ là PATH trong bucket san-pham → dựng URL public đầy đủ
const ANH_BASE = (import.meta.env.VITE_SUPABASE_URL || '') + '/storage/v1/object/public/san-pham/'
const anhUrl = p => p ? (/^https?:/.test(p) ? p : ANH_BASE + p) : ''
const anhPair = anh => { const a = (anh || [])[0] || {}; return { nho: anhUrl(a.nho || a.to), to: anhUrl(a.to || a.nho) } }   // nhỏ để hiển thị · to để phóng
// thẻ ảnh: bấm → phóng to (data-full = ảnh to). Không có ảnh → chuỗi rỗng (ô để trống)
const imgTag = anh => { const p = anhPair(anh); return p.nho ? '<img src="' + esc(p.nho) + '" data-full="' + esc(p.to) + '" alt="">' : '' }
function ganPhong(root) { root.querySelectorAll('img[data-full]').forEach(im => { im.onclick = e => { e.stopPropagation(); moPhong(im.dataset.full) } }) }
function moPhong(url) { if (!url) return; const lb = $('lb'); lb.querySelector('img').src = url; lb.classList.add('hien') }
const num = n => { if (n === null || n === undefined || n === '') return null; n = Number(n); return Number.isFinite(n) ? n : null }
const ngayGon = s => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return '—'; const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) }
function bao(t, loi) { const el = $('bao'); el.textContent = t; el.classList.toggle('loi', !!loi); el.classList.add('hien'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hien'), 2800) }
function ktText(d, r, c) { const p = [d, r, c].map(x => num(x)); if (p.every(x => x == null)) return null; return p.map(x => x == null ? '?' : x).join('×') + ' mm' }

// ══════════ ĐĂNG NHẬP ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML = '<div class="logo">📦</div><h1>Togihome Sản phẩm</h1><div class="sub">Đăng nhập để xem ba tầng sản phẩm</div>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<button id="b">Vào sản phẩm</button><div class="err" id="er">' + (err || '') + '</div>'
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
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app sản phẩm.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro }
  capApp()
}

// ══════════ VÀO APP ══════════
async function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = 'flex'
  $('hdTen').textContent = USER.ten || TEN_VAI[USER.vai_tro]; $('hdVai').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  const thoat = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  $('btOut').onclick = thoat
  document.querySelectorAll('.thanh-muc').forEach(b => { b.onclick = () => di(b.dataset.tab) })
  ;['cLocBrand', 'cLocNhom', 'cLocNguon'].forEach(id => $(id).onchange = veCay)
  ;['dLocBrand', 'dLocNhom', 'dLocNguon'].forEach(id => $(id).onchange = veDanhSach)
  $('mo').onclick = dongSua; $('hopMX').onclick = dongSua
  $('lb').onclick = () => $('lb').classList.remove('hien')
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('lb').classList.remove('hien'); if ($('hopM').classList.contains('hien')) dongSua() } })
  // tab theo vai: Cây/Danh sách cho ceo/ke_toan · Quy trình cho ceo/thiet_ke
  $('n-cay').style.display = laCatalog() ? '' : 'none'
  $('n-ds').style.display = laCatalog() ? '' : 'none'
  $('n-soban').style.display = laCatalog() ? '' : 'none'   // L-74: Số bán theo dòng — ceo/ke_toan
  $('n-quytrinh').style.display = laQT() ? '' : 'none'
  if (laCatalog()) { await napOptions(); await napDongBrand(); if ($('btThemSP')) $('btThemSP').onclick = themSP; if ($('btThemSP2')) $('btThemSP2').onclick = themSP }
  di(laCatalog() ? 'cay' : 'quytrinh')
}

function di(tab) {
  if (tab === 'quytrinh' && !laQT()) return
  if ((tab === 'cay' || tab === 'ds' || tab === 'soban') && !laCatalog()) return
  TAB = tab
  document.querySelectorAll('.thanh-muc').forEach(b => b.classList.toggle('chon', b.dataset.tab === tab))
  $('s-cay').style.display = tab === 'cay' ? '' : 'none'
  $('s-ds').style.display = tab === 'ds' ? '' : 'none'
  $('s-soban').style.display = tab === 'soban' ? '' : 'none'
  $('s-quytrinh').style.display = tab === 'quytrinh' ? '' : 'none'
  if (tab === 'cay') veCay(); else if (tab === 'ds') veDanhSach(); else if (tab === 'soban') taiSoBan(); else if (tab === 'quytrinh') veQuyTrinh()
}
// ── L-74: SỐ BÁN THEO DÒNG (ceo/ke_toan, chỉ đọc) — 2 khối từ sp_so_ban. Class spb-. ──
async function taiSoBan() {
  if (!laCatalog()) return
  const { data, error } = await sb.rpc('sp_so_ban', { p_ngay: 90, p_gioi_han: 50 })
  if (error) { $('spb-dong').innerHTML = `<div class="spb-rong">Lỗi: ${esc(error.message)}</div>`; return }
  const NGT = data.nguong_tam || 30
  const pct = v => v == null ? '—' : (Math.round(v * 1000) / 10).toString().replace('.', ',') + '%'
  // KHỐI 1 · theo dòng × thương hiệu
  $('spb-dong').innerHTML = '<table class="spb-tbl"><thead><tr><th>Dòng</th><th>Thương hiệu</th><th class="spb-num">Báo giá</th><th class="spb-num">Chốt</th><th class="spb-num">Tỉ lệ</th><th class="spb-num">Giá trị TB</th></tr></thead><tbody>'
    + ((data.theo_dong || []).map(r => `<tr><td>${esc(r.dong)}${r.n < NGT ? '<span class="spb-tam">TẠM n=' + r.n + '</span>' : ''}</td><td>${esc(r.thuong_hieu)}</td><td class="spb-num">${r.bao_gia}</td><td class="spb-num">${r.chot}</td><td class="spb-num">${pct(r.ti_le)}</td><td class="spb-num">${r.gia_tri_tb == null ? '—' : tien(r.gia_tri_tb)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="spb-rong">Chưa có báo giá trong 90 ngày.</td></tr>') + '</tbody></table>'
  // KHỐI 2 · món tự do lặp
  $('spb-mon').innerHTML = '<table class="spb-tbl"><thead><tr><th>Tên món (chuẩn hoá)</th><th class="spb-num">Số lần</th><th>Lần gần nhất</th></tr></thead><tbody>'
    + ((data.mon_lap || []).map(r => `<tr><td>${esc(r.ten)}</td><td class="spb-num">${r.so_lan}</td><td>${r.gan_nhat ? new Date(r.gan_nhat).toLocaleDateString('vi-VN') : '—'}</td></tr>`).join('')
      || '<tr><td colspan="3" class="spb-rong">Chưa có món tự do nào lặp ≥2 lần.</td></tr>')
    + '</tbody></table><div class="spb-hint" style="margin-top:8px">Chỉ danh sách ứng viên — thêm sản phẩm vào catalog là quy trình riêng (không tự thêm ở đây).</div>'
}
// modal chung (dùng #mo/#hopM có sẵn)
function moModal(ten, thanHtml, nutHtml) { $('hopMTen').textContent = ten; $('hopMThan').innerHTML = thanHtml; $('hopMNut').innerHTML = nutHtml || ''; $('mo').classList.add('hien'); $('hopM').classList.add('hien') }

// ══════════ TUỲ CHỌN LỌC ══════════
async function napOptions() {
  const { data, error } = await sb.rpc('sp_loc_options')
  if (error) { bao('Không tải được bộ lọc: ' + error.message, true); return }
  OPTS = data
  const doBrand = sel => { (data.brand || []).forEach(b => { const o = document.createElement('option'); o.value = b.ma; o.textContent = b.ten; sel.appendChild(o) }) }
  const doNhom = sel => { (data.nhom || []).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o) }) }
  const doNguon = sel => { (data.nguon || []).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o) }) }
  ;['cLocBrand', 'dLocBrand'].forEach(id => doBrand($(id)))
  ;['cLocNhom', 'dLocNhom'].forEach(id => doNhom($(id)))
  ;['cLocNguon', 'dLocNguon'].forEach(id => doNguon($(id)))
}
const locVal = pre => ({ brand: $(pre + 'Brand').value || null, nhom: $(pre + 'Nhom').value || null, nguon: $(pre + 'Nguon').value || null })

async function taiDanhSach(pre) {
  const { brand, nhom, nguon } = locVal(pre)
  const { data, error } = await sb.rpc('sp_danh_sach', { p_brand: brand, p_nhom: nhom, p_nguon: nguon })
  if (error) { bao('Không tải được danh sách: ' + error.message, true); return [] }
  return data || []
}

// ══════════ TAB ① CÂY SẢN PHẨM (nhóm theo lõi → biến thể → niêm yết) ══════════
async function veCay() {
  $('cayBody').innerHTML = '<div class="trong-rong">Đang tải…</div>'
  const rows = await taiDanhSach('cLoc')
  // gom theo lõi, rồi biến thể
  const loiMap = new Map()
  for (const r of rows) {
    const ml = r.ma_loi || ('_' + r.ma_ny)
    if (!loiMap.has(ml)) loiMap.set(ml, { ma_loi: r.ma_loi, ten: r.ten, nhom: r.nhom_hang, nguon: r.nguon, anh: r.anh, bt: new Map(), ban: 0, dt: 0 })
    const L = loiMap.get(ml)
    const bm = r.ma_bien_the || ('_' + r.ma_ny)
    if (!L.bt.has(bm)) L.bt.set(bm, { ma: r.ma_bien_the, vat_lieu: r.vat_lieu, vl_chua: r.vl_chua_xac_nhan, gia_von: r.gia_von, kt: ktText(r.dai_mm, r.rong_mm, r.cao_mm), kt_nguon: r.kt_nguon, ny: [] })
    L.bt.get(bm).ny.push(r)
    L.ban += Number(r.total_week_sold) || 0
    L.dt += (Number(r.gia) || 0) * (Number(r.total_week_sold) || 0)
    if (!L.anh || !L.anh.length) L.anh = r.anh
  }
  CAY_LIST = [...loiMap.entries()]
  // L-77c: nhóm theo DÒNG (sp_loi_dong: ma_loi → {dong, ten, tt})
  if (!LOI_DONG) { try { const { data } = await sb.rpc('sp_loi_dong'); LOI_DONG = data || {} } catch (e) { LOI_DONG = {} } }
  const dgOf = ml => (LOI_DONG[ml] || {}).dong || '_khac'
  CAY_LIST.sort((a, b) => { const ta = (LOI_DONG[a[0]] || {}).tt ?? 99, tb = (LOI_DONG[b[0]] || {}).tt ?? 99; return (ta - tb) || String(a[0]).localeCompare(String(b[0])) })
  $('cDem').textContent = loiMap.size + ' lõi · ' + rows.length + ' niêm yết'
  $('emCay').textContent = loiMap.size
  if (!loiMap.size) { $('cayBody').innerHTML = '<div class="trong-rong">Chưa có sản phẩm nào khớp bộ lọc.</div>'; return }
  let html = '', cur = null
  CAY_LIST.forEach(([ml, L], i) => {
    const dk = dgOf(ml), d = LOI_DONG[ml] || {}
    if (dk !== cur) {
      if (cur !== null) html += '</div>'
      const cnt = CAY_LIST.filter(([m]) => dgOf(m) === dk).length
      html += `<div class="cay-dg-hd" data-dg="${esc(dk)}"><span class="cay-dg-mo">▾</span><b>${esc(d.dong || '—')}</b> ${esc(d.ten || '(chưa gán dòng)')} <i>${cnt} lõi</i></div><div class="cay-dg" data-dgb="${esc(dk)}">`
      cur = dk
    }
    html += veLoi(ml, L, i)
  })
  if (cur !== null) html += '</div>'
  $('cayBody').innerHTML = html
  // gập/mở theo DÒNG
  $('cayBody').querySelectorAll('.cay-dg-hd').forEach(h => h.onclick = () => { const b = $('cayBody').querySelector('.cay-dg[data-dgb="' + h.dataset.dg + '"]'); const mo = b.style.display !== 'none'; b.style.display = mo ? 'none' : ''; h.querySelector('.cay-dg-mo').textContent = mo ? '▸' : '▾' })
  // bung/thu lõi (CHỈ ẩn/hiện khối biến thể)
  $('cayBody').querySelectorAll('[data-mo]').forEach(el => el.onclick = () => toggleLoi(+el.dataset.mo))
  ganPhong($('cayBody'))
}
function toggleLoi(i) {
  const body = $('cayBody')
  const wrap = body.querySelector('.bt-wrap[data-wrap="' + i + '"]'); if (!wrap) return
  const mo = wrap.style.display === 'none'
  wrap.style.display = mo ? '' : 'none'
  const [ml, L] = CAY_LIST[i]; if (mo) CAY_MO.add(ml); else CAY_MO.delete(ml)
  const maEl = body.querySelector('.loi-ma[data-mo="' + i + '"]')
  if (maEl) maEl.textContent = (mo ? '▼ ' : '▶ ') + (L.ma_loi || '(chưa gộp lõi)')
  const arr = body.querySelector('.loi-anh .mui-ten[data-mo="' + i + '"]')
  if (arr) arr.textContent = mo ? '▼' : '▶'
}
function veLoi(ml, L, i) {
  const mo = CAY_MO.has(ml)
  const soBt = L.bt.size, soNy = [...L.bt.values()].reduce((s, b) => s + b.ny.length, 0)
  const anhTag = imgTag(L.anh)
  let h = '<div class="loi"><div class="loi-dau">'
  // ảnh: bấm → PHÓNG TO (không phải bung cây). Không có ảnh → mũi tên bung.
  h += '<div class="loi-anh">' + (anhTag || '<span class="mui-ten" data-mo="' + i + '" style="cursor:pointer">' + (mo ? '▼' : '▶') + '</span>') + '</div>'
  h += '<div class="loi-than">'
  h += '<div class="loi-ma" data-mo="' + i + '" style="cursor:pointer">' + (mo ? '▼ ' : '▶ ') + esc(L.ma_loi || '(chưa gộp lõi)') + '</div>'
  h += '<div class="loi-ten" data-mo="' + i + '" style="cursor:pointer"><b>' + esc(L.ten || '—') + '</b>' + (L.nhom ? '<span class="nhan n-loi">' + esc(L.nhom) + '</span>' : '') + '</div>'
  h += '<div class="loi-meta">' + esc(L.nguon || 'nguồn ?') + '</div>'
  h += '<div class="loi-so"><div><span>Biến thể</span><b>' + soBt + '</b></div><div><span>Niêm yết</span><b>' + soNy + '</b></div>'
  h += '<div><span>Bán/tuần</span><b>' + (L.ban || 0) + '</b></div><div><span>Doanh thu/tuần</span><b>' + tienGon(L.dt) + '</b></div></div>'
  h += '</div></div>'
  // khối biến thể LUÔN dựng, ẩn khi thu — bung chỉ đổi display
  h += '<div class="bt-wrap" data-wrap="' + i + '"' + (mo ? '' : ' style="display:none"') + '>'
  for (const [, B] of L.bt) h += veBt(B)
  h += '</div></div>'
  return h
}
function veBt(B) {
  let h = '<div class="bt"><div class="bt-dau">'
  h += '<span class="bt-ma">' + esc(B.ma || '—') + '</span>'
  h += '<div class="bt-vl">' + esc(B.vat_lieu || 'vật liệu ?') + (B.vl_chua ? ' <span class="nhan n-vang">đoán</span>' : '') +
       '<small>' + esc(B.kt || B.kt_nguon || 'kích thước ?') + '</small></div>'
  h += '<div class="bt-gv">' + tien(B.gia_von) + '<span>giá vốn</span></div>'
  h += '</div>'
  for (const n of B.ny) h += veNy(n)
  h += '</div>'
  return h
}
function veNy(n) {
  const lai = (Number(n.gia) || 0) - (Number(n.gia_von) || 0)
  let h = '<div class="ny">'
  h += '<div class="ny-brand"><b>' + esc(n.brand_ten || n.brand || '—') + '</b><small>' + esc(n.ma_ny) + '</small></div>'
  h += '<div class="ny-ten">' + esc(n.ten || '—') + (n.la_combo ? ' <span class="nhan n-combo">combo</span>' : '') + '</div>'
  h += '<div class="ny-so"><b>' + tien(n.gia) + '</b><span>lãi gộp ' + (n.gia_von ? tien(lai) : '—') + '</span></div>'
  h += '<div class="ny-ban">' + (Number(n.total_week_sold) || 0) + ' /tuần</div>'
  h += '</div>'
  return h
}

// ══════════ TAB ② DANH SÁCH (phẳng, xếp bán chạy, nhãn vàng soát) ══════════
async function veDanhSach() {
  $('dsBody').innerHTML = '<div class="trong-rong">Đang tải…</div>'
  DS = await taiDanhSach('dLoc')
  const soat = DS.filter(r => r.vl_chua_xac_nhan || r.kt_thieu).length
  $('dDem').textContent = DS.length + ' niêm yết' + (soat ? ' · ' + soat + ' cần soát' : '')
  if (!DS.length) { $('dsBody').innerHTML = '<div class="trong-rong">Chưa có sản phẩm nào khớp bộ lọc.</div>'; return }
  let head = ''
  if (soat) head = '<div class="nhac"><b>' + soat + ' dòng cần soát</b>Nhãn vàng: vật liệu đoán từ tên (chưa xác nhận), hoặc kích thước chưa có số. Bấm nhãn để nhập/sửa — số nhập tay, không đoán.</div>'
  $('dsBody').innerHTML = head + DS.map(hangDs).join('')
  $('dsBody').querySelectorAll('[data-sua]').forEach(el => el.onclick = e => { e.stopPropagation(); moSua(el.dataset.sua) })
  ganPhong($('dsBody'))
}
function hangDs(r) {
  const lai = (Number(r.gia) || 0) - (Number(r.gia_von) || 0)
  let phu = '<span>' + esc(r.brand_ten || r.brand || '—') + '</span><span>·</span><span class="mono">' + esc(r.ma_ny) + '</span>'
  if (r.nhom_hang) phu += '<span>·</span><span>' + esc(r.nhom_hang) + '</span>'
  // vật liệu
  if (r.vl_chua_xac_nhan) phu += '<span class="nhan n-vang" data-sua="' + esc(r.ma_bien_the) + '">VL đoán: ' + esc(r.vat_lieu || '?') + ' — soát</span>'
  else if (r.vat_lieu) phu += '<span>·</span><span>' + esc(r.vat_lieu) + '</span>'
  // kích thước
  const kt = ktText(r.dai_mm, r.rong_mm, r.cao_mm)
  if (r.kt_thieu) phu += '<span class="nhan n-vang" data-sua="' + esc(r.ma_bien_the) + '">Kích thước ?' + (r.kt_nguon ? ' (' + esc(r.kt_nguon) + ')' : '') + ' — nhập</span>'
  else if (kt) phu += '<span>·</span><span class="mono">' + esc(kt) + '</span>'
  if (r.la_combo) phu += '<span class="nhan n-combo">combo</span>'
  let h = '<div class="hang">'
  h += '<div class="hang-anh">' + imgTag(r.anh) + '</div>'
  h += '<div class="hang-than"><div class="hang-ten">' + esc(r.ten || '—') + '</div><div class="hang-phu">' + phu + '</div></div>'
  h += '<div class="hang-gia"><b>' + tien(r.gia) + '</b><span>vốn ' + tien(r.gia_von) + ' · lãi ' + (r.gia_von ? tien(lai) : '—') + '</span></div>'
  h += '<div class="hang-ban">' + (Number(r.total_week_sold) || 0) + '<br><span style="font-size:10px;color:var(--chu-mo)">/tuần</span></div>'
  h += '</div>'
  return h
}

// ══════════ SỬA BIẾN THỂ (vật liệu + kích thước) ══════════
function moSua(maBt) {
  const r = DS.find(x => x.ma_bien_the === maBt); if (!r) return
  SUA = r
  $('hopMTen').textContent = 'Soát biến thể ' + (r.ma_bien_the || '')
  $('hopMThan').innerHTML =
    '<div style="font-size:13px;color:var(--chu-nhat);margin-bottom:6px">' + esc(r.ten || '') + '</div>' +
    (r.da_soat_tay ? '<div style="font-size:12px;color:var(--chu-mo);margin-bottom:8px">đã soát tay bởi ' + esc(r.soat_ten || '?') + ' ngày ' + ngayGon(r.soat_luc) + '</div>' : '') +
    (r.kt_nguon ? '<div style="font-size:12px;color:var(--chu-mo);margin-bottom:8px">Chuỗi gốc từ web: <b>' + esc(r.kt_nguon) + '</b></div>' : '') +
    '<label>Vật liệu (xác nhận / sửa lại)</label><input id="sVl" value="' + esc(r.vat_lieu || '') + '" placeholder="vd: Gỗ tự nhiên">' +
    '<label>Mã vật tư kho (nếu có)</label><input id="sMaVt" value="' + esc(r.ma_vat_tu_chinh || '') + '" placeholder="mã trong kho">' +
    '<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="sXn" style="width:auto" ' + (r.vl_chua_xac_nhan ? '' : 'checked') + '> Vật liệu đã xác nhận (bỏ nhãn đoán)</label>' +
    '<div style="display:flex;gap:8px;margin-top:10px"><div style="flex:1"><label>Dài (mm)</label><input id="sDai" type="number" value="' + (r.dai_mm ?? '') + '"></div>' +
    '<div style="flex:1"><label>Rộng (mm)</label><input id="sRong" type="number" value="' + (r.rong_mm ?? '') + '"></div>' +
    '<div style="flex:1"><label>Cao (mm)</label><input id="sCao" type="number" value="' + (r.cao_mm ?? '') + '"></div></div>'
  $('hopMNut').innerHTML = '<button class="nut-vien" id="sHuy">Huỷ</button><button class="nut-chinh" id="sLuu">Lưu</button>'
  $('sHuy').onclick = dongSua; $('sLuu').onclick = luuSua
  $('mo').classList.add('hien'); $('hopM').classList.add('hien')
}
function dongSua() { $('mo').classList.remove('hien'); $('hopM').classList.remove('hien'); SUA = null }
async function luuSua() {
  if (!SUA) return
  const p = {
    p_ma: SUA.ma_bien_the,
    p_dai: num($('sDai').value), p_rong: num($('sRong').value), p_cao: num($('sCao').value),
    p_vl: $('sVl').value.trim() || null, p_ma_vt: $('sMaVt').value.trim() || null,
    p_xac_nhan: $('sXn').checked
  }
  $('sLuu').disabled = true
  const { error } = await sb.rpc('sp_sua_bien_the', p)
  $('sLuu').disabled = false
  if (error) { bao('Lưu lỗi: ' + error.message, true); return }
  bao('Đã lưu biến thể ' + SUA.ma_bien_the)
  dongSua()
  if (TAB === 'ds') veDanhSach(); else veCay()
}

// ══════════════════ TAB QUY TRÌNH ══════════════════
let QT = { ds: [], hd: [], sel: null, ct: null }
const dinhPhut = n => n == null ? '' : Number(n).toFixed(1).replace('.', ',')
const docPhut = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN }
function qtLoiText(msg) {
  if (/MA_TRUNG/.test(msg)) return 'Mã quy trình đã tồn tại — chọn mã khác.'
  if (/QT_LOI/.test(msg)) {   // server đã ghi câu ĐÚNG lỗi + tên bước; chỉ lấy phần đó
    const chi = msg.replace(/^[\s\S]*?QT_LOI:\s*/, '').replace(/\s*\n\s*/g, ' · ').trim()
    return 'Không lưu — ' + (chi || 'quy trình hỏng.')
  }
  if (/chỉ ceo\/thiet_ke/.test(msg)) return 'Bạn không có quyền sửa quy trình.'
  return msg
}

async function veQuyTrinh() {
  const [ds, hd] = await Promise.all([sb.rpc('qt_ds'), sb.rpc('hoat_dong_ds')])
  if (ds.error) { $('qtDs').innerHTML = '<div class="ds-dau">Lỗi</div><p style="padding:14px;color:var(--tre)">' + esc(ds.error.message) + '</p>'; return }
  QT.ds = ds.data || []; QT.hd = hd.data || []
  if ($('emQuytrinh')) $('emQuytrinh').textContent = QT.ds.length
  if (!QT.sel || !QT.ds.find(q => q.ma_quy_trinh === QT.sel)) QT.sel = (QT.ds[0] || {}).ma_quy_trinh
  renderQtDs()
  if (QT.sel) await chonQt(QT.sel); else $('qtPhai').innerHTML = ''
  if ($('qtMoi')) $('qtMoi').onclick = () => moChep(null)
}
function renderQtDs() {
  const list = QT.ds.map(q => `<button class="qt ${q.ma_quy_trinh === QT.sel ? 'chon' : ''}" data-qt="${esc(q.ma_quy_trinh)}">
    <span class="ma">${esc(q.ma_quy_trinh)}</span><b>${esc(q.ten)}</b>
    <span class="du">${q.so_buoc} bước · <b>${q.so_mon_dung}</b> món đang dùng</span></button>`).join('')
  $('qtDs').innerHTML = `<div class="ds-dau">${QT.ds.length} quy trình<em>đang dùng</em></div>${list}
    <div class="nhac xanh" style="margin:14px 15px"><b>Cần quy trình cho hàng sơn PU?</b>Bấm "Quy trình mới" rồi chép từ một quy trình có sẵn, chèn thêm chà lót, sơn PU, chờ khô. Nhanh hơn dựng từ đầu và ít sai hơn.</div>`
  $('qtDs').querySelectorAll('[data-qt]').forEach(b => b.onclick = () => { QT.sel = b.dataset.qt; renderQtDs(); chonQt(QT.sel) })
}
async function chonQt(ma) {
  const { data, error } = await sb.rpc('qt_chi_tiet', { p_qt: ma })
  if (error) { $('qtPhai').innerHTML = '<p style="padding:14px;color:var(--tre)">' + esc(error.message) + '</p>'; return }
  QT.ct = data; renderQtPhai()
}
// "Chạy sau bước" HIỆN CHỮ (đọc là chính); bấm mở hộp chọn nhiều (sửa là hiếm)
function textTruoc(b) {
  const t = b.buoc_truoc || []
  if (!t.length) return '<span class="dau-tien">bước đầu tiên</span>'
  return 'sau ' + t.map(tt => { const x = QT.ct.buoc.find(y => y.thu_tu === tt); return tt + ' · ' + esc(x ? (x.ten_hoat_dong || x.hoat_dong) : '?') }).join(', ')
}
function qtBuocRow(b) {
  const tenTo = TEN_TO[b.ma_to] || b.ma_to || '—', dvDem = DV_DEM[b.hoat_dong] || 'đơn vị', dvNgan = DV_NGAN[b.hoat_dong] || 'đv'
  const nhanhCls = b.nhanh === 'thùng' ? 'n-thung' : b.nhanh === 'cánh' ? 'n-canh' : 'n-chung'
  const tuChay = b.loai_buoc === 'tu_chay'
  return `<div class="buoc ${tuChay ? 'tu-chay' : ''}" data-b="${b.thu_tu}">
    <span class="stt">${b.thu_tu}</span>
    <div class="hd"><b>${esc(b.ten_hoat_dong || b.hoat_dong)}</b><small>${esc(dvDem)} · tổ ${esc(tenTo)}</small></div>
    ${tuChay ? '<div style="font-size:12.5px;color:var(--chu-mo)">tự chạy (chờ khô)</div>'
      : `<button class="bt-doc" data-btmo="${b.thu_tu}" title="Bấm để đổi bước chạy trước">${textTruoc(b)}</button>`}
    <div class="o-phut">${tuChay
      ? `<input value="${dinhPhut((b.gio_co_dinh || 0) * 60)}" disabled><span class="dv">phút</span>`
      : `<input data-phut value="${dinhPhut(b.phut)}" inputmode="decimal"><span class="dv">phút</span>`}</div>
    <div><span class="nhanh ${nhanhCls}">${esc(b.nhanh || 'chung')}</span></div>
    <div class="tien">${b.don_gia != null ? Number(b.don_gia).toLocaleString('vi-VN') : '—'}<small>đ/${esc(dvNgan)}</small></div>
    <button class="xoa" data-xoa="${b.thu_tu}" title="Xoá bước">×</button></div>`
}
function renderQtPhai() {
  const c = QT.ct
  const rows = c.buoc.map(qtBuocRow).join('')
  // sơ đồ đường đi (đơn giản: chip theo thứ tự, màu theo nhánh)
  const chip = c.buoc.map((b, i) => {
    const cl = b.loai_buoc === 'tu_chay' ? 'kho' : b.nhanh === 'thùng' ? 'thung' : b.nhanh === 'cánh' ? 'canh' : ''
    const mui = i < c.buoc.length - 1 ? '<span class="mui">→</span>' : ''
    return `<span class="o-b ${cl}">${esc(b.ten_hoat_dong || b.hoat_dong)}</span>${mui}`
  }).join('')
  $('qtPhai').innerHTML = `
    <div class="the">
      <div class="the-dau">
        <div><h2>${esc(c.ten)}</h2><p><span class="mono" style="font-size:12.5px">${esc(c.ma_quy_trinh)}</span> · ${c.so_buoc} bước · ${c.so_mon_dung} món đang dùng</p></div>
        <div class="the-nut"><button class="nut-vien" id="qtChep">Chép thành quy trình mới</button><button class="nut-vien" id="qtXemMon">Xem ${c.so_mon_dung} món</button></div>
      </div>
      ${c.so_mon_dung > 0 ? `<div class="canh"><b>${c.so_mon_dung} món đang dùng quy trình này</b>Sửa sẽ đổi giờ và giá vốn của các món CHƯA bàn giao xuống xưởng. Món ĐÃ bàn giao giữ nguyên số, giờ và giá vốn tại lúc bàn giao.</div>` : ''}
      <div class="so-do"><h3>Đường đi — nhìn hình trước, chi tiết sau</h3><div class="chuoi">${chip}</div></div>
      <div class="b-dau"><div>Thứ tự</div><div>Hoạt động</div><div>Chạy sau bước</div><div>Phút mỗi đơn vị</div><div>Nhánh</div><div>Đơn giá</div><div></div></div>
      ${rows || '<p style="padding:16px;color:var(--chu-mo)">Chưa có bước nào.</p>'}
      <div class="them-buoc"><button id="qtThem">+ Thêm bước</button></div>
      <div class="nhac"><b>Gõ bằng phút, không gõ bằng giờ</b>Không ai nghĩ bằng đơn vị 0,0333 giờ. Gõ 2 phút thì biết ngay đúng hay sai.</div>
    </div>
    <div class="the">
      <div class="the-dau"><div><h2>12 hoạt động — đơn giá và tổ</h2><p>Dùng chung cho mọi quy trình. Đơn giá là tiền công thuần, vật tư nằm khối riêng.</p></div></div>
      <div class="hd-dau"><div>Hoạt động</div><div>Tổ</div><div>Đơn giá</div><div>Phút/đơn vị</div><div>Dùng ở</div></div>
      ${QT.hd.map(h => `<div class="hd-dong">
        <div class="n"><b>${esc(h.ten)}</b><small>${esc(DV_DEM[h.hoat_dong] || '')}</small></div>
        <div class="s nhat">${esc(TEN_TO[h.ma_to] || h.ma_to)}</div>
        <div class="s">${Number(h.don_gia || 0).toLocaleString('vi-VN')}</div>
        <div class="s">${h.phut != null ? dinhPhut(h.phut) : '—'}${h.la_tam ? '<span class="tam">TẠM</span>' : ''}</div>
        <div class="s nhat">${h.dung_o ? h.dung_o + ' QT' : '<span class="chua-qt">chưa vào quy trình nào</span>'}</div></div>`).join('')}
      <div class="nhac"><b>Số giờ còn TẠM — chưa có số đo thật</b>Khi máy quét chạy, giờ thật sẽ tự thay vào và dấu TẠM mất dần.</div>
    </div>`
  // bind
  $('qtChep').onclick = () => moChep(c.ma_quy_trinh)
  $('qtXemMon').onclick = xemMon
  $('qtThem').onclick = moThemBuoc
  $('qtPhai').querySelectorAll('[data-phut]').forEach(inp => inp.onchange = () => xacNhanRoiLuu(() => luuBuoc(Number(inp.closest('[data-b]').dataset.b))))
  $('qtPhai').querySelectorAll('[data-btmo]').forEach(btn => btn.onclick = () => moChonTruoc(Number(btn.dataset.btmo)))
  $('qtPhai').querySelectorAll('[data-xoa]').forEach(b => b.onclick = () => xoaBuoc(Number(b.dataset.xoa)))
}
// hộp chọn "chạy sau bước" (chọn nhiều), không có chính nó
function moChonTruoc(thu_tu) {
  const b = QT.ct.buoc.find(x => x.thu_tu === thu_tu); if (!b) return
  const other = QT.ct.buoc.filter(x => x.thu_tu !== thu_tu)
  const truoc = b.buoc_truoc || []
  const rows = other.length ? other.map(x => `<label style="display:flex;align-items:center;gap:9px;padding:9px 4px;border-bottom:1px solid var(--vien);font-size:14px;cursor:pointer">
    <input type="checkbox" value="${x.thu_tu}" ${truoc.includes(x.thu_tu) ? 'checked' : ''}><span><span class="mono" style="font-size:12.5px">${x.thu_tu}</span> · ${esc(x.ten_hoat_dong || x.hoat_dong)}</span></label>`).join('')
    : '<p style="color:var(--chu-mo);font-size:13px">Chưa có bước khác — bước này là bước đầu tiên.</p>'
  moModal('Bước ' + thu_tu + ' chạy sau bước nào',
    `<p style="font-size:12.5px;color:var(--chu-nhat);margin-bottom:6px">Bỏ chọn hết = bước đầu tiên.</p>${rows}`,
    `<button class="nut-vien" id="ctHuy">Huỷ</button><button class="nut-chinh" id="ctOk">Xong</button>`)
  $('ctHuy').onclick = dongSua
  $('ctOk').onclick = () => {
    const bt = [...$('hopMThan').querySelectorAll('input:checked')].map(i => Number(i.value))
    dongSua(); xacNhanRoiLuu(() => luuBuocTruoc(thu_tu, bt))
  }
}
async function luuBuocTruoc(thu_tu, bt) {
  const b = QT.ct.buoc.find(x => x.thu_tu === thu_tu); if (!b) return
  const { error } = await sb.rpc('qt_luu_buoc', { p_qt: QT.sel, p_thu_tu: thu_tu, p_hoat_dong: b.hoat_dong, p_buoc_truoc: bt, p_nhanh: b.nhanh || 'chung', p_phut: b.phut || 0 })
  if (error) { bao(qtLoiText(error.message), true); await veQuyTrinh(); return }
  bao('Đã đổi bước chạy trước'); await veQuyTrinh()
}
// hộp xác nhận khi quy trình đang có món dùng — tách hai con số (đếm thật)
function xacNhanRoiLuu(fn) {
  const c = QT.ct
  if (!c || c.so_mon_dung === 0) return fn()
  moModal('Xác nhận sửa quy trình',
    `<div class="canh" style="border-radius:8px;border-width:1px"><b>${c.so_mon_dung} món đang dùng quy trình này.</b>Sửa sẽ đổi giờ và giá vốn của các món CHƯA bàn giao xuống xưởng. Món ĐÃ bàn giao giữ nguyên số, giờ và giá vốn tại lúc bàn giao.</div>
     <p style="margin-top:12px;font-size:14.5px;line-height:1.7"><b class="mono">${c.mon_chua_ban_giao}</b> món chưa bàn giao — <b style="color:var(--do)">sẽ đổi</b>.<br><b class="mono">${c.mon_da_ban_giao}</b> món đã bàn giao — <b style="color:var(--xong)">giữ nguyên</b>.</p>`,
    `<button class="nut-vien" id="xnHuy">Huỷ</button><button class="nut-chinh" id="xnOk">Đồng ý, lưu</button>`)
  $('xnHuy').onclick = () => { dongSua(); veQuyTrinh() }
  $('xnOk').onclick = () => { dongSua(); fn() }
}
async function luuBuoc(thu_tu) {
  const row = $('qtPhai').querySelector(`[data-b="${thu_tu}"]`); if (!row) return
  const b = QT.ct.buoc.find(x => x.thu_tu === thu_tu); if (!b) return
  const inp = row.querySelector('[data-phut]')
  const phut = inp ? docPhut(inp.value) : (b.phut || 0)
  if (inp && (!isFinite(phut) || phut < 0)) { bao('Phút phải là số ≥ 0', true); veQuyTrinh(); return }
  const sel = row.querySelector('[data-bt]')
  const bt = sel ? [...sel.selectedOptions].map(o => Number(o.value)).filter(n => !isNaN(n)) : (b.buoc_truoc || [])
  const { error } = await sb.rpc('qt_luu_buoc', { p_qt: QT.sel, p_thu_tu: thu_tu, p_hoat_dong: b.hoat_dong, p_buoc_truoc: bt, p_nhanh: b.nhanh || 'chung', p_phut: phut })
  if (error) { bao(qtLoiText(error.message), true); await veQuyTrinh(); return }   // fail-đóng: tải lại số cũ
  bao('Đã lưu bước ' + thu_tu); await veQuyTrinh()
}
function xoaBuoc(thu_tu) {
  xacNhanRoiLuu(async () => {
    const { error } = await sb.rpc('qt_xoa_buoc', { p_qt: QT.sel, p_thu_tu: thu_tu })
    if (error) { bao(qtLoiText(error.message), true); await veQuyTrinh(); return }
    bao('Đã xoá bước ' + thu_tu); await veQuyTrinh()
  })
}
function moThemBuoc() {
  const c = QT.ct
  const maxTt = c.buoc.reduce((m, b) => Math.max(m, b.thu_tu), 0)
  const hdOpts = QT.hd.map(h => `<option value="${esc(h.hoat_dong)}">${esc(h.ten)} · tổ ${esc(TEN_TO[h.ma_to] || h.ma_to)}</option>`).join('')
  const btOpts = c.buoc.map(b => `<option value="${b.thu_tu}">${b.thu_tu} · ${esc(b.ten_hoat_dong || b.hoat_dong)}</option>`).join('')
  moModal('Thêm bước — ' + c.ma_quy_trinh,
    `<label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin-bottom:5px">Hoạt động</label>
     <select id="tbHd" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px">${hdOpts}</select>
     <label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin:12px 0 5px">Nhánh</label>
     <select id="tbNhanh" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px"><option value="chung">chung</option><option value="thùng">thùng</option><option value="cánh">cánh</option></select>
     <label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin:12px 0 5px">Phút mỗi đơn vị</label>
     <input id="tbPhut" inputmode="decimal" placeholder="ví dụ 2,0" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px;font-family:'JetBrains Mono',monospace">
     <label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin:12px 0 5px">Chạy sau bước (bỏ trống = bước đầu tiên)</label>
     <select id="tbTruoc" multiple size="${Math.min(Math.max(c.buoc.length, 1), 5)}" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:6px">${btOpts || '<option disabled>— chưa có bước —</option>'}</select>`,
    `<button class="nut-vien" id="tbHuy">Huỷ</button><button class="nut-chinh" id="tbOk">Thêm bước</button>`)
  $('tbHuy').onclick = dongSua
  $('tbOk').onclick = () => xacNhanRoiLuu(async () => {
    const phut = docPhut($('tbPhut').value)
    if (!isFinite(phut) || phut < 0) { bao('Phút phải là số ≥ 0', true); return }
    const bt = [...$('tbTruoc').selectedOptions].map(o => Number(o.value)).filter(n => !isNaN(n))
    dongSua()
    const { error } = await sb.rpc('qt_luu_buoc', { p_qt: QT.sel, p_thu_tu: maxTt + 100, p_hoat_dong: $('tbHd').value, p_buoc_truoc: bt, p_nhanh: $('tbNhanh').value, p_phut: phut })
    if (error) { bao(qtLoiText(error.message), true); await veQuyTrinh(); return }
    bao('Đã thêm bước'); await veQuyTrinh()
  })
}
function moChep(nguon) {
  const opts = QT.ds.map(q => `<option value="${esc(q.ma_quy_trinh)}" ${q.ma_quy_trinh === nguon ? 'selected' : ''}>${esc(q.ma_quy_trinh)} — ${esc(q.ten)}</option>`).join('')
  moModal('Quy trình mới (chép từ có sẵn)',
    `<label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin-bottom:5px">Chép từ</label>
     <select id="cpNguon" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px">${opts}</select>
     <label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin:12px 0 5px">Mã quy trình mới</label>
     <input id="cpMa" placeholder="VD: TU-AO-PU" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px;font-family:'JetBrains Mono',monospace;text-transform:uppercase">
     <label style="display:block;font-size:12.5px;color:var(--chu-nhat);margin:12px 0 5px">Tên</label>
     <input id="cpTen" placeholder="VD: Tủ áo sơn PU" style="width:100%;border:1px solid var(--vien);border-radius:7px;padding:9px">`,
    `<button class="nut-vien" id="cpHuy">Huỷ</button><button class="nut-chinh" id="cpOk">Tạo quy trình</button>`)
  $('cpHuy').onclick = dongSua
  $('cpOk').onclick = async () => {
    const ma = $('cpMa').value.trim().toUpperCase(), ten = $('cpTen').value.trim(), ng = $('cpNguon').value
    if (!ma || !ten) { bao('Cần mã và tên mới', true); return }
    dongSua()
    const { error } = await sb.rpc('qt_chep', { p_ma_moi: ma, p_ten_moi: ten, p_nguon: ng })
    if (error) { bao(qtLoiText(error.message), true); return }
    bao('Đã tạo quy trình ' + ma); QT.sel = ma; await veQuyTrinh()
  }
}
async function xemMon() {
  const { data, error } = await sb.rpc('qt_so_mon', { p_qt: QT.sel })
  if (error) { bao(error.message, true); return }
  const ds = data || [], chua = ds.filter(m => !m.da_ban_giao), da = ds.filter(m => m.da_ban_giao)
  const li = arr => arr.length ? arr.map(m => `<div style="padding:7px 0;border-bottom:1px solid var(--vien);font-size:13.5px"><span class="mono" style="font-size:12px">${esc(m.ma_don)}</span> · ${esc(m.ten)}</div>`).join('') : '<p style="color:var(--chu-mo);font-size:13px;padding:6px 0">(không có)</p>'
  moModal('Món dùng ' + QT.sel + ' (' + ds.length + ')',
    `<p style="font-size:13.5px;font-weight:600;color:var(--do);margin-bottom:4px">${chua.length} món CHƯA bàn giao — sửa quy trình sẽ đổi</p>${li(chua)}
     <p style="font-size:13.5px;font-weight:600;color:var(--xong);margin:14px 0 4px">${da.length} món ĐÃ bàn giao — giữ nguyên số cũ</p>${li(da)}`,
    `<button class="nut-chinh" id="xmDong">Đóng</button>`)
  $('xmDong').onclick = dongSua
}

// ══════════ KHỞI ĐỘNG ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data && data.session) laySauDangNhap(data.session.user); else manDangNhap()
})()

// ══════════ L-77c: FORM "+ THÊM SẢN PHẨM" (3 bước · mã tự sinh · tên 3 kênh + self-check 7 điều) ══════════
let DONG_LIST = [], BRAND3 = [], SP = null, LOI_DONG = null
async function napDongBrand() {
  const { data: dd } = await sb.from('dong_san_pham').select('ma_dong,ten').order('thu_tu'); DONG_LIST = dd || []
  const { data: bb } = await sb.from('thuong_hieu_ban').select('ma,ten,ma_3chu,loai,ngung'); BRAND3 = (bb || [])   // L-48a: view danh mục CHUNG (đã lọc bật+không-kênh+có-mã-3-chữ) — khớp app Sale
}
const titleCase = s => (s || '').split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const mmSize = rong => { if (!rong) return ''; const s = (rong / 1000).toFixed(1); return s.replace('.', 'm').replace(/m0$/, 'm') }   // 1600→1m6 · 2000→2m
function fmtSizes(sz) { const u = [...new Set(sz.filter(Boolean))]; if (!u.length) return ''; if (u.length <= 3) return u.join('/'); return 'nhiều size từ ' + u[0] + ' đến ' + u[u.length - 1] }
function brandTen(ma) { return (BRAND3.find(b => b.ma === ma) || {}).ten || ma || '' }
function genTen() {
  const f = SP, dd = titleCase(f.dacDiem), br = brandTen(f.ny[0] && f.ny[0].brand), sizes = f.bt.map(b => mmSize(b.rong))
  const web = `${dd} - ${f.loai} ${f.chatLieu}, ${f.phongCach} | ${br} - ${f.ma}`
  const san = `${f.loai} ${f.dacDiemCT || f.dacDiem} ${f.chatLieu} - ${f.phongCach}, size ${fmtSizes(sizes)} | ${br} - ${f.ma}`
  return { web: f.tenWeb != null ? f.tenWeb : web, san: f.tenSan != null ? f.tenSan : san, noiBo: f.ma }
}
function selfCheck(t) {
  const e = [], br = brandTen(SP.ny[0] && SP.ny[0].brand)
  if (t.web.length < 60 || t.web.length > 90) e.push('⑦ Tên website ' + t.web.length + ' ký tự — cần 60–90 (' + (t.web.length < 60 ? 'khách thấy quá cụt, thiếu từ khoá tìm kiếm' : 'quá dài, bị cắt trên kết quả tìm') + ')')
  if (t.san.length < 100 || t.san.length > 120) e.push('⑦ Tên sàn ' + t.san.length + ' ký tự — cần 100–120 (sàn TMĐT ưu tiên tên dài đủ từ khoá)')
  if (/chính hãng/i.test(t.web + ' ' + t.san)) e.push('④ Có chữ "chính hãng" — cấm (ngầm nói hàng nơi khác là giả, dễ bị report)')
  if (/\bsize\b/i.test(t.web) || /\dm\d/i.test(t.web)) e.push('⑤ Tên website KHÔNG được có size (size để bên sàn TMĐT)')
  if (/(đơn|đôi)\s*$/i.test((t.web.split('|')[0] || '').trim())) e.push('② Kết thúc bằng "đơn/đôi" — cấm')
  if (/\dm\d\s*-\s*\dm\d/.test(t.san)) e.push('③ Size dạng "1m2-1m8" — cấm; phải "1m4/1m6/1m8" hoặc "nhiều size từ… đến…"')
  if (br) { const n = (t.web.match(new RegExp(br.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length; if (n !== 1) e.push('① Brand "' + br + '" xuất hiện ' + n + ' lần — phải đúng 1 lần ở cuối (khách chỉ mua từ 1 brand)') }
  const head = (t.web.split(' - ')[0] || '').trim(); if (head && head !== titleCase(head)) e.push('⑥ Đặc điểm phân biệt phải In Hoa Đầu mỗi từ ở đầu tên website')
  return e
}
function themSP() {
  if (!laCatalog()) return
  SP = { dong: '', ma: '', loai: '', dacDiem: '', dacDiemCT: '', chatLieu: '', phongCach: '', tenKyThuat: '', tenWeb: null, tenSan: null,
    bt: [{ ten: '', vl: '', rong: '', dai: '', cao: '' }], ny: [{ brand: (BRAND3.find(b => b.ma === 'togihome') || BRAND3[0] || {}).ma || '', gia: '', quyTrinh: '' }], buoc: 1 }
  moModal('Thêm sản phẩm — bước 1/3: Lõi', '<div id="spForm"></div>', '')
  veBuoc()
}
async function pkMa() { if (!SP.dong) { SP.ma = ''; return } const { data } = await sb.rpc('sp_peek_ma_loi', { p_dong: SP.dong }); SP.ma = data || '' }
function veBuoc() {
  const b = SP.buoc; $('hopMTen').textContent = 'Thêm sản phẩm — bước ' + b + '/3: ' + ['Lõi', 'Biến thể', 'Niêm yết'][b - 1]
  const el = $('spForm')
  if (b === 1) {
    const t = SP.ma ? genTen() : null, errs = t ? selfCheck(t) : []
    el.innerHTML =
      '<div class="sp-r"><label>Dòng *</label><select id="f_dong"><option value="">— chọn dòng —</option>' + DONG_LIST.map(d => `<option value="${d.ma_dong}"${SP.dong === d.ma_dong ? ' selected' : ''}>${esc(d.ma_dong)} · ${esc(d.ten)}</option>`).join('') + '</select>'
      + '<span class="sp-ma">Mã tự sinh: <b>' + (SP.ma || '—') + '</b></span></div>'
      + '<div class="sp-g"><div class="sp-r"><label>Loại SP</label><input id="f_loai" value="' + esc(SP.loai) + '" placeholder="Tủ quần áo"></div>'
      + '<div class="sp-r"><label>Đặc điểm phân biệt</label><input id="f_dd" value="' + esc(SP.dacDiem) + '" placeholder="Cửa trượt gương"></div>'
      + '<div class="sp-r"><label>Chất liệu</label><input id="f_cl" value="' + esc(SP.chatLieu) + '" placeholder="gỗ MDF phủ Melamine"></div>'
      + '<div class="sp-r"><label>Phong cách</label><input id="f_pc" value="' + esc(SP.phongCach) + '" placeholder="Bắc Âu"></div></div>'
      + '<div class="sp-r"><label>Đặc điểm chi tiết <span class="sp-hint" style="margin:0">— dài hơn, cho tên sàn TMĐT (100–120 ký tự)</span></label><input id="f_ddct" value="' + esc(SP.dacDiemCT) + '" placeholder="cửa trượt gương khung nhôm chống trầy lắp ráp sẵn"></div>'
      + '<div class="sp-r"><label>Tên kỹ thuật (nội bộ)</label><input id="f_tkt" value="' + esc(SP.tenKyThuat) + '" placeholder="mô tả kỹ thuật ngắn"></div>'
      + (t ? '<div class="sp-ten"><div><b>Website</b> <i>' + t.web.length + ' ký tự</i><textarea id="f_web">' + esc(t.web) + '</textarea></div>'
        + '<div><b>Sàn TMĐT</b> <i>' + t.san.length + ' ký tự</i><textarea id="f_san">' + esc(t.san) + '</textarea></div>'
        + '<div><b>Nội bộ</b> <span class="mono">' + esc(t.noiBo) + '</span></div></div>'
        + (errs.length ? '<div class="sp-err">' + errs.map(x => '<div>⚠ ' + esc(x) + '</div>').join('') + '</div>' : '<div class="sp-ok">✓ Tên đạt 7 nguyên tắc</div>')
        + '<div id="f_trung" class="sp-hint"></div>' : '')
    $('f_dong').onchange = async e => { SP.dong = e.target.value; await pkMa(); veBuoc() }
    ;[['f_loai', 'loai'], ['f_dd', 'dacDiem'], ['f_ddct', 'dacDiemCT'], ['f_cl', 'chatLieu'], ['f_pc', 'phongCach'], ['f_tkt', 'tenKyThuat']].forEach(([id, k]) => { const n = $(id); if (n) n.oninput = () => { SP[k] = n.value; if (id !== 'f_tkt') { SP.tenWeb = null; SP.tenSan = null; veBuocDebounce() } } })
    const fw = $('f_web'), fs = $('f_san'); if (fw) fw.oninput = () => { SP.tenWeb = fw.value; veBuocDebounce() }; if (fs) fs.oninput = () => { SP.tenSan = fs.value; veBuocDebounce() }
    if (t) kiemTrung(t.web)
  } else if (b === 2) {
    el.innerHTML = '<p class="sp-note">Vật liệu × kích thước (rộng dùng làm size trong tên sàn). ≥1 biến thể.</p>'
      + SP.bt.map((v, i) => `<div class="sp-bt"><input placeholder="Tên biến thể" value="${esc(v.ten)}" data-i="${i}" data-k="ten"><input placeholder="Vật liệu" value="${esc(v.vl)}" data-i="${i}" data-k="vl"><input placeholder="Rộng(mm)" value="${v.rong}" data-i="${i}" data-k="rong" style="width:90px"><input placeholder="Dài" value="${v.dai}" data-i="${i}" data-k="dai" style="width:75px"><input placeholder="Cao" value="${v.cao}" data-i="${i}" data-k="cao" style="width:75px"><span class="sp-sz">${mmSize(v.rong) || '—'}</span>${SP.bt.length > 1 ? `<button class="sp-x" data-del="${i}">×</button>` : ''}</div>`).join('')
      + '<button class="nut-vien" id="f_addbt">+ Biến thể</button>'
    el.querySelectorAll('.sp-bt input').forEach(n => n.oninput = () => { SP.bt[+n.dataset.i][n.dataset.k] = n.value; if (n.dataset.k === 'rong') veBuoc() })
    el.querySelectorAll('[data-del]').forEach(n => n.onclick = () => { SP.bt.splice(+n.dataset.del, 1); veBuoc() })
    $('f_addbt').onclick = () => { SP.bt.push({ ten: '', vl: '', rong: '', dai: '', cao: '' }); veBuoc() }
  } else {
    el.innerHTML = '<p class="sp-note">Niêm yết theo brand. Giá ≥ giá sàn (server chặn). Quy trình để trống được (nhãn cảnh báo).</p>'
      + SP.ny.map((v, i) => `<div class="sp-ny"><select data-i="${i}" data-k="brand"><option value="">— brand —</option>${BRAND3.map(b => `<option value="${b.ma}"${v.brand === b.ma ? ' selected' : ''}>${esc(b.ten)} (${b.ma_3chu})</option>`).join('')}</select><input placeholder="Giá niêm yết" value="${v.gia}" data-i="${i}" data-k="gia" style="width:130px"><span class="sp-qt">${v.quyTrinh ? 'có QT' : '⚠ chưa gắn quy trình'}</span>${SP.ny.length > 1 ? `<button class="sp-x" data-del="${i}">×</button>` : ''}</div>`).join('')
      + '<button class="nut-vien" id="f_addny">+ Brand</button>'
    el.querySelectorAll('.sp-ny select,.sp-ny input').forEach(n => n.oninput = n.onchange = () => { SP.ny[+n.dataset.i][n.dataset.k] = n.value; if (n.dataset.k === 'brand') { SP.tenWeb = null; SP.tenSan = null } })
    el.querySelectorAll('[data-del]').forEach(n => n.onclick = () => { SP.ny.splice(+n.dataset.del, 1); veBuoc() })
    $('f_addny').onclick = () => { SP.ny.push({ brand: '', gia: '', quyTrinh: '' }); veBuoc() }
  }
  $('hopMNut').innerHTML = (b > 1 ? '<button class="nut-vien" id="f_truoc">← Trước</button>' : '')
    + (b < 3 ? '<button class="nut-chinh" id="f_tiep">Tiếp →</button>' : '<button class="nut-chinh" id="f_luu">Lưu sản phẩm</button>')
  if ($('f_truoc')) $('f_truoc').onclick = () => { SP.buoc--; veBuoc() }
  if ($('f_tiep')) $('f_tiep').onclick = () => { if (SP.buoc === 1 && !SP.dong) return bao('Chọn dòng trước', true); SP.buoc++; veBuoc() }
  if ($('f_luu')) $('f_luu').onclick = luuSP
}
let _dbTimer = null
function veBuocDebounce() { clearTimeout(_dbTimer); _dbTimer = setTimeout(veBuoc, 350) }
async function kiemTrung(ten) {
  try { const { data } = await sb.rpc('sp_kiem_ten_trung', { p_ten: ten }); const n = $('f_trung'); if (!n) return
    if (data && (data.trung_niem_yet || data.trung_mon_tu_do > 0)) n.innerHTML = '⚠ Trùng: ' + (data.trung_niem_yet ? 'đã có niêm yết cùng tên. ' : '') + (data.trung_mon_tu_do > 0 ? 'món tự do lặp ' + data.trung_mon_tu_do + ' lần (ứng viên đã có).' : '')
    else n.textContent = '' } catch (e) {}
}
async function luuSP() {
  const t = genTen(), errs = selfCheck(t)
  if (errs.length) return bao('Tên còn ' + errs.length + ' lỗi nguyên tắc — sửa ở bước 1', true)
  if (!SP.bt.some(v => v.ten.trim())) return bao('Cần ≥1 biến thể có tên', true)
  if (!SP.ny.some(v => v.brand && v.gia)) return bao('Cần ≥1 niêm yết (brand + giá)', true)
  bao('Đang lưu…')
  try {
    const rl = await sb.rpc('sp_tao_loi_moi', { p_dong: SP.dong, p_ten_ky_thuat: SP.tenKyThuat || t.web, p_nhom: SP.loai || null, p_kich_thuoc: null, p_ghi_chu: null })
    if (rl.error) throw rl.error
    const maLoi = rl.data.ma_loi, skus = []
    for (const v of SP.bt.filter(v => v.ten.trim())) {
      const rb = await sb.rpc('sp_tao_bien_the', { p_ma_loi: maLoi, p_ten: v.ten, p_vat_lieu: v.vl || null, p_kich_thuoc: [v.dai, v.rong, v.cao].filter(Boolean).join('x') || null, p_dai: +v.dai || null, p_rong: +v.rong || null, p_cao: +v.cao || null })
      if (rb.error) throw rb.error; skus.push(rb.data.ma)
    }
    for (const v of SP.ny.filter(v => v.brand && v.gia)) {
      // 1 niêm yết/(lõi,brand): tên listing (web KHÔNG size), size ở biến thể — slug niêm yết phải duy nhất
      const rn = await sb.rpc('tao_niem_yet', { p_ma_bien_the: skus[0], p_ma_brand: v.brand, p_ten_ban_hang: t.web, p_duong_dan: null, p_ten_dai: t.san, p_gia: +String(v.gia).replace(/\D/g, '') })
      if (rn.error) throw rn.error
    }
    dongSua(); bao('✓ Đã tạo ' + maLoi + ' (' + skus.length + ' biến thể)')
    if (typeof veCay === 'function') veCay()
  } catch (e) { bao('Lỗi: ' + (e.message || e), true) }
}
