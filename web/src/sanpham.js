// App SẢN PHẨM — ba tầng: lõi → biến thể → niêm yết. Lô này 2 tab: Cây sản phẩm · Danh sách.
//   Vào: ceo · ke_toan (có giá vốn). Vai khác CHẶN. Đọc qua RPC curated (sp_danh_sach / sp_cay / sp_loc_options).
//   Nhãn vàng ở Danh sách = cần soát: vật liệu ĐOÁN chưa xác nhận · kích thước chưa có số. Bấm nhãn → sửa (sp_sua_bien_the).
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })

const VAI_VAO = ['ceo', 'ke_toan']
const TEN_VAI = { ceo: 'CEO', ke_toan: 'Kế toán' }

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
  await napOptions()
  di('cay')
}

function di(tab) {
  TAB = tab
  document.querySelectorAll('.thanh-muc').forEach(b => b.classList.toggle('chon', b.dataset.tab === tab))
  $('s-cay').style.display = tab === 'cay' ? '' : 'none'
  $('s-ds').style.display = tab === 'ds' ? '' : 'none'
  if (tab === 'cay') veCay(); else veDanhSach()
}

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
  $('cDem').textContent = loiMap.size + ' lõi · ' + rows.length + ' niêm yết'
  $('emCay').textContent = loiMap.size
  if (!loiMap.size) { $('cayBody').innerHTML = '<div class="trong-rong">Chưa có sản phẩm nào khớp bộ lọc.</div>'; return }
  $('cayBody').innerHTML = CAY_LIST.map(([ml, L], i) => veLoi(ml, L, i)).join('')
  // bung/thu = CHỈ ẩn/hiện khối biến thể của lõi đó (KHÔNG dựng lại cả cây → không cuộn về đầu)
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

// ══════════ KHỞI ĐỘNG ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data && data.session) laySauDangNhap(data.session.user); else manDangNhap()
})()
