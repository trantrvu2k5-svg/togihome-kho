// App XƯỞNG bản đầy đủ — bố cục theo mẫu CEO. 5 màn responsive + panel chi tiết món. Đăng nhập xuong/tho/ceo.
//   Đọc qua RPC curated (tho không đọc bảng). KHÔNG hiện giá bán/giá vốn/tên khách. Quản đốc: chỉ xuong/ceo.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb   // L-74: phơi client cho kiểm chéo RPC (như sale/tài chính/thiết kế)

const VAI_VAO = ['xuong', 'tho', 'ceo'], TEN_VAI = { xuong: 'Xưởng', tho: 'Thợ', ceo: 'CEO' }
const BUOC = { cho_cat: 'Chờ cắt', da_cat: 'Đã cắt', dang_lam: 'Đang làm', xong_sx: 'Xong SX', cho_giao: 'Chờ giao' }
const KE = { cho_cat: 'da_cat', da_cat: 'dang_lam', dang_lam: 'xong_sx' }
const TO_BUOC = { cho_cat: 'CNC (cắt)', da_cat: 'Dán cạnh / khoan', dang_lam: 'Lắp ráp' }
const DEM_TO = { pu: 'son_pu', lot: 'cha_lot', giuong_lap: 'giuong' }
let USER = null, KHO_TEM = '70x40', TEM = { ma_don: null, pb: null, lan: 0, tam: [], tick: {} }
let THO_LIST = [], PANEL = { monId: null, ke: null, nguoi: null }
const $ = id => document.getElementById(id)
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmt = n => { n = Number(n); return Number.isFinite(n) ? (n === Math.round(n) ? String(n) : n.toFixed(1)) : '?' }
const kgv = v => (v && typeof v === 'object') ? (v.ten || v.ma || JSON.stringify(v)) : (v || '')   // khong_gian jsonb
function bao(t, loi) { const el = $('bao'); el.textContent = t; el.classList.toggle('loi', !!loi); el.classList.add('hien'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hien'), 2600) }

// ══════════ ĐĂNG NHẬP ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML = '<div class="logo">🪚</div><h1>Togihome Xưởng</h1><div class="sub">Đăng nhập để vào việc</div>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<button id="b">Vào xưởng</button><div class="err" id="er">' + (err || '') + '</div>'
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
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app xưởng.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro }; capApp()
}

// ══════════ VÀO APP ══════════
async function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = 'flex'
  $('navDay').style.display = ''    // xoá inline -> CSS media quyết (ẩn desktop / hiện ≤819)
  $('hdTen').textContent = USER.ten || TEN_VAI[USER.vai_tro]; $('hdVai').textContent = TEN_VAI[USER.vai_tro] || USER.vai_tro
  // ĐĂNG XUẤT: signOut + XOÁ HẲN token localStorage TRƯỚC reload (tránh reload cắt ngang -> token còn -> vào lại app).
  const thoat = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  $('btOut').onclick = thoat
  if ($('btOutM')) $('btOutM').onclick = thoat   // nút Thoát ở thanh dưới (mobile — sidebar ẩn ≤819px)
  document.querySelectorAll('.thanh-muc, .thanh-day button').forEach(b => { if (b.dataset.man) b.onclick = () => di(b.dataset.man) })   // bỏ nút không có data-man (vd Thoát)
  if (USER.vai_tro === 'tho') { $('n-qd').style.display = 'none'; $('d-qd').style.display = 'none'; $('n-tl').style.display = 'none'; $('d-tl').style.display = 'none'; $('n-nlt').style.display = 'none'; $('d-nlt').style.display = 'none'; $('n-nl').style.display = 'none'; $('d-nl').style.display = 'none' }   // tho KHÔNG thấy quản đốc / tải & lịch / năng lực tổ / nhìn lại (L-74, WP-47)
  setupTL()
  document.querySelectorAll('.tab button').forEach(b => b.onclick = () => tab(b.dataset.qd))
  document.querySelectorAll('#s-tem .loc button[data-kho]').forEach(b => b.onclick = () => datKho(b.dataset.kho))
  $('chonDon').onchange = () => taiTem($('chonDon').value)
  $('btInBo').onclick = () => inTem('bo'); $('btInChon').onclick = () => inTem('chon')
  $('btDem').onclick = luuDem; $('btLoi').onclick = luuLoi
  $('kbTo').onchange = veKanban; $('kbDong').onchange = veKanban
  $('loiDon').onchange = () => taiMonLoi($('loiDon').value)
  $('viecLocTo').onchange = veViec; $('viecLocBuoc').onchange = veViec
  $('mo').onclick = dongPanel
  document.addEventListener('keydown', e => { if (e.key === 'Escape') dongPanel() })
  setupTram()
  datKho('70x40')
  const { data: tl } = await sb.rpc('xuong_tho_list'); THO_LIST = tl || []
  await taiTo(); await taiDon(); await taiViec()
}
function di(m) {
  if ((m === 'qd' || m === 'tl' || m === 'nlt' || m === 'nl') && USER.vai_tro === 'tho') return
  ;['viec', 'tram', 'tem', 'dem', 'loi', 'qd', 'tl', 'nlt', 'nl'].forEach(k => { $('s-' + k).style.display = (k === m) ? 'block' : 'none'
    $('n-' + k).classList.toggle('chon', k === m); if ($('d-' + k)) $('d-' + k).classList.toggle('chon', k === m) })
  window.scrollTo(0, 0)
  if (m === 'qd') taiQuanDoc()
  if (m === 'tram') taiTram()
  if (m === 'tl') taiTaiLich()
  if (m === 'nlt') taiNangLuc()
  if (m === 'nl') taiNhinLai()
}
// ── L-74: NHÌN LẠI (Quản đốc, chỉ đọc) — 3 khối từ xuong_nhin_lai. Class xnl-. KHÔNG tiền, chỉ giờ. ──
async function taiNhinLai() {
  if (!['xuong', 'ceo'].includes(USER.vai_tro)) return
  const { data, error } = await sb.rpc('xuong_nhin_lai', { p_ngay: 30, p_gioi_han: 50 })
  if (error) { $('xnl-gio').innerHTML = `<div class="xnl-rong">Lỗi: ${esc(error.message)}</div>`; return }
  const g1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ',')
  // KHỐI 1 · giờ chạm tay chuẩn vs thực theo tổ
  $('xnl-gio').innerHTML = '<table class="xnl-tbl"><thead><tr><th>Tổ</th><th class="xnl-num">Giờ chuẩn</th><th class="xnl-num">Giờ thực</th><th class="xnl-num">Chênh</th></tr></thead><tbody>'
    + ((data.gio_to || []).map(r => `<tr><td>${esc(r.to)}</td><td class="xnl-num">${g1(r.chuan)}</td><td class="xnl-num">${g1(r.thuc)}</td><td class="xnl-num">${r.chenh_pct == null ? '—' : (r.chenh_pct > 0 ? '+' : '') + g1(r.chenh_pct) + '%'}</td></tr>`).join('')
      || '<tr><td colspan="4" class="xnl-rong">Chưa có giờ trong 30 ngày.</td></tr>') + '</tbody></table>'
  // KHỐI 2 · lỗi & làm lại
  $('xnl-loi').innerHTML = '<table class="xnl-tbl"><thead><tr><th>Loại lỗi</th><th>Tổ</th><th class="xnl-num">Tổng</th><th class="xnl-num">Tuần này</th><th class="xnl-num">Tuần trước</th><th>Xu hướng</th></tr></thead><tbody>'
    + ((data.loi || []).map(r => `<tr><td>${esc(r.loai_loi)}</td><td>${esc(r.to)}</td><td class="xnl-num">${r.so_luong}</td><td class="xnl-num">${r.tuan_nay}</td><td class="xnl-num">${r.tuan_truoc}</td><td class="xnl-xh xnl-${r.xu_huong === 'tăng' ? 'xau' : r.xu_huong === 'giảm' ? 'tot' : ''}">${r.xu_huong === 'tăng' ? '↑ tăng' : r.xu_huong === 'giảm' ? '↓ giảm' : '→ đứng'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="xnl-rong">Chưa có lỗi ghi trong 30 ngày. (bảng loi_lam_lai — lần đầu có người đọc)</td></tr>') + '</tbody></table>'
  // KHỐI 3 · tắc quét (thời gian trôi qua)
  $('xnl-tac-ng').textContent = `món chưa xong không quét gì quá ${data.nguong_lang} ngày (thời gian TRÔI qua, khác giờ chạm tay ở khối 1) · nguồn tien_do_tem`
  $('xnl-tac').innerHTML = '<table class="xnl-tbl"><thead><tr><th>Mã đơn</th><th>Khách</th><th class="xnl-num">Lặng (ngày)</th><th class="xnl-num">Số tem</th><th>Tổ đang cầm</th></tr></thead><tbody>'
    + ((data.tac_quet || []).map(r => `<tr><td><b>${esc(r.ma_don)}</b></td><td>${esc(r.ten_khach)}</td><td class="xnl-num">${r.lang}</td><td class="xnl-num">${r.so_tem}</td><td>${esc(r.to || '—')}</td></tr>`).join('')
      || '<tr><td colspan="5" class="xnl-rong">Không có món nào tắc quét. 🎉</td></tr>') + '</tbody></table>'
}
function tab(w) {
  $('qd-lam').style.display = (w === 'lam') ? 'block' : 'none'; $('qd-kb').style.display = (w === 'kb') ? 'block' : 'none'
  $('t-lam').classList.toggle('chon', w === 'lam'); $('t-kb').classList.toggle('chon', w === 'kb')
  if (w === 'kb') taiKanban()
}

// ══════════ VIỆC ══════════
// Phân trang xuong_don_san_xuat: "Xem thêm 50 đơn" (GOM DỒN, không thay trang) —
// vì RPC này còn nuôi 2 dropdown (In tem · Ghi lỗi) + danh sách món; gom dồn thì đơn
// đã tải chỉ TĂNG, không đơn nào đang thấy bị trang mới đá mất. Xem lo_phan_trang.md.
const MOI_TRANG = 50
let DONS = [], MONS = [], DON_TONG = 0   // MONS = [{...món, ma_don}]
async function taiDon(them) {
  const bo_qua = them ? DONS.length : 0
  const { data } = await sb.rpc('xuong_don_san_xuat', { p_gioi_han: MOI_TRANG, p_bo_qua: bo_qua })
  const rows = data || []
  DON_TONG = rows.length ? Number(rows[0].tong_so) : (them ? DON_TONG : 0)
  DONS = them ? DONS.concat(rows) : rows
  veViecTrang()
  const coTem = DONS.filter(d => d.co_tem)
  $('chonDon').innerHTML = coTem.length ? coTem.map(d => `<option value="${esc(d.ma_don)}">${esc(d.ma_don)} · ${esc(BUOC[d.trang_thai] || d.trang_thai)}</option>`).join('') : '<option value="">(chưa đơn nào có tem)</option>'
  if (coTem.length) taiTem(coTem[0].ma_don); else { TEM = { ma_don: null, pb: null, lan: 0, tam: [], tick: {} }; $('temBanner').innerHTML = ''; $('dsTam').innerHTML = '<div class="trong-rong"><p>Chưa có đơn nào được đẩy tem.</p></div>' }
  $('loiDon').innerHTML = DONS.length ? DONS.map(d => `<option value="${esc(d.ma_don)}">${esc(d.ma_don)}</option>`).join('') : '<option value="">(chưa có đơn)</option>'
  if (DONS.length) taiMonLoi(DONS[0].ma_don)
}
async function taiViec() {
  MONS = []
  for (const d of DONS) { const { data } = await sb.rpc('xuong_mon_cua_don', { p_ma_don: d.ma_don }); (data || []).forEach(m => MONS.push({ ...m, ma_don: d.ma_don })) }
  const tos = [...new Set(MONS.map(m => TO_BUOC[m.trang_thai]).filter(Boolean))]
  $('viecLocTo').innerHTML = '<option value="">Tất cả tổ</option>' + tos.map(t => `<option>${esc(t)}</option>`).join('')
  veViec()
}
function veViec() {
  const fTo = $('viecLocTo').value, fBuoc = $('viecLocBuoc').value
  const rows = MONS.filter(m => m.trang_thai !== 'xong_sx' && (!fTo || TO_BUOC[m.trang_thai] === fTo) && (!fBuoc || m.trang_thai === fBuoc))
  $('viecDem').textContent = rows.length + ' món đang chờ'
  const box = $('dsViec')
  if (!rows.length) { box.innerHTML = '<div class="trong-rong"><h3>Không có món nào đang chờ</h3><p>Các đơn đã xong sản xuất hoặc chưa vào chuyền.</p></div>'; return }
  box.innerHTML = rows.map(m => {
    const cho = m.trang_thai === 'cho_cat'
    return `<button class="mon" data-mon="${esc(m.id)}" data-don="${esc(m.ma_don)}">
      <div class="mon-than"><div class="mon-ten"><span class="ma">${esc(m.ma_don)}</span><b>${esc(m.ten || 'Món')}</b></div>
      <p class="mon-phu">${Number(m.so_luong) > 1 ? 'Số lượng ×' + Number(m.so_luong) + ' · ' : ''}bấm để xem chi tiết</p></div>
      <span class="to">${esc(TO_BUOC[m.trang_thai] || '—')}</span><span class="buoc${cho ? ' cho' : ''}">${esc(BUOC[m.trang_thai])}</span></button>`
  }).join('')
  box.querySelectorAll('.mon').forEach(b => b.onclick = () => moMon(b.dataset.mon, b.dataset.don))
}
function veViecTrang() {
  const el = $('viecTrang'); if (!el) return
  if (!DON_TONG) { el.innerHTML = ''; return }
  const con = DON_TONG - DONS.length, them = Math.min(MOI_TRANG, con)
  el.innerHTML = `<span class="so">Việc của ${DONS.length}/${DON_TONG} đơn đang sản xuất${con > 0 ? '' : ' · đã xem hết'}</span>`
    + (con > 0 ? `<div class="nut"><button id="viecThem">Xem thêm ${them} đơn (còn ${con})</button></div>` : '')
  if (con > 0) $('viecThem').onclick = async () => { $('viecThem').disabled = true; await taiDon(true); await taiViec() }
}

// ══════════ IN TEM ══════════
async function taiTem(maDon) {
  if (!maDon) return
  const { data, error } = await sb.rpc('xuong_tem_cua_don', { p_ma_don: maDon })
  if (error) { $('dsTam').innerHTML = `<div class="trong-rong"><p>Lỗi: ${esc(error.message)}</p></div>`; return }
  const rows = data || []
  TEM = { ma_don: maDon, pb: rows.length ? rows[0].phien_ban : null, lan: rows.length ? rows[0].lan_da_in : 0, tam: rows, tick: {} }
  rows.forEach((_, i) => TEM.tick[i] = true)
  const catLai = (TEM.lan || 0) >= 1
  $('temBanner').innerHTML = TEM.pb == null ? '<div class="canh-bao">Đơn này chưa được đẩy tem từ máy thiết kế.</div>'
    : (catLai ? `<div class="canh-bao"><b>Lượt in thứ ${TEM.lan + 1}</b>Đơn này đã in tem ${TEM.lan} lượt (phiên bản ${TEM.pb}). In lại được tính là CẮT LẠI.</div>`
      : `<div class="canh-bao xanh"><b>Phiên bản ${TEM.pb} · chưa in</b>In lần này = lượt 1 (cắt đầu).</div>`)
  $('dsTam').innerHTML = rows.length ? rows.map((t, i) => `<div class="tam"><input type="checkbox" data-i="${i}" checked><span class="vt">${esc((t.vai_tro || 'tấm').replace(/_/g, ' '))}</span><span class="kt">${fmt(t.dai)}×${fmt(t.rong)}×${fmt(t.day)}</span><span class="sl">×1</span></div>`).join('') : '<div class="trong-rong"><p>Phiên bản này không có tấm nào.</p></div>'
  $('dsTam').querySelectorAll('input[data-i]').forEach(el => el.onchange = () => { TEM.tick[+el.dataset.i] = el.checked; capNhatTem() })
  capNhatTem()
}
function capNhatTem() {
  const n = Object.values(TEM.tick).filter(Boolean).length, tot = TEM.tam.length
  $('temDem').textContent = tot ? `${n}/${tot} tấm chọn` : ''
  const moiTrang = KHO_TEM === '70x40' ? 12 : 24
  $('temKho').textContent = tot ? `Khổ ${KHO_TEM}mm · ${moiTrang} tem mỗi trang A4` : ''
  $('btInBo').textContent = tot ? `In cả bộ (${tot} tem)` : 'In cả bộ'
  $('btInChon').textContent = `In ${n} tấm đã tick`
  const co = TEM.pb != null && tot > 0
  $('btInBo').disabled = !co; $('btInChon').disabled = !co || !n
}
function datKho(k) { KHO_TEM = k; document.querySelectorAll('#s-tem [data-kho]').forEach(b => b.classList.toggle('chon', b.dataset.kho === k)); document.querySelectorAll('#s-tem [data-kho]').forEach(b => { b.style.background = b.dataset.kho === k ? 'var(--do)' : ''; b.style.color = b.dataset.kho === k ? '#fff' : '' }); capNhatTem() }
async function inTem(che) {
  if (TEM.pb == null || !TEM.tam.length) return
  const chon = che === 'bo' ? TEM.tam : TEM.tam.filter((_, i) => TEM.tick[i])
  if (!chon.length) return bao('Chưa tick tấm nào', true)
  const maTam = chon.map(t => t.ma_tam)
  const { data, error } = await sb.rpc('ghi_lan_in_tem', { p_ma_don: TEM.ma_don, p_phien_ban: TEM.pb, p_ma_tam: maTam })
  if (error) return bao('Ghi lượt in lỗi: ' + error.message, true)
  const trang = Math.ceil(maTam.length / (KHO_TEM === '70x40' ? 12 : 24))
  bao((data.cat_lai ? '⚠ CẮT LẠI · ' : '✓ ') + 'Lượt in ' + data.lan_thu + ' · ' + maTam.length + ' tem · ' + trang + ' trang')
  await moInTem(chon); taiTem(TEM.ma_don)
}
async function moInTem(chon) {
  const paths = chon.map(t => t.duong_dan_svg).filter(Boolean)
  if (!paths.length) return bao('Đã ghi lượt in. (Chưa có SVG tem — máy thiết kế chưa đẩy.)')
  const { data, error } = await sb.storage.from('tem-svg').createSignedUrls(paths, 120)
  const urls = (error ? [] : data).filter(x => x.signedUrl).map(x => x.signedUrl)
  if (!urls.length) return bao('Đã ghi lượt in. SVG tem chưa có trên hệ.')
  const w = window.open('', '_blank'); if (!w) return bao('Đã ghi lượt in. Trình duyệt chặn cửa sổ in.')
  const [tw, th] = KHO_TEM === '70x40' ? [70, 40] : [50, 30]
  w.document.write(`<!doctype html><meta charset=utf-8><title>Tem ${esc(TEM.ma_don)}</title><style>@page{size:A4;margin:8mm}body{margin:0}.g{display:flex;flex-wrap:wrap;gap:2mm}.t{width:${tw}mm;height:${th}mm;border:.3mm solid #000;overflow:hidden}.t img{width:100%;height:100%}</style><div class="g">${urls.map(u => `<div class="t"><img src="${u}"></div>`).join('')}</div><script>let n=${urls.length},d=0;document.querySelectorAll('img').forEach(i=>i.onload=i.onerror=()=>{if(++d>=n)setTimeout(()=>print(),250)})<\/script>`)
  w.document.close()
}

// ══════════ ĐẾM ══════════
async function luuDem() {
  const rows = [{ hoat_dong: 'pu', so_luong: +$('demPu').value || 0 }, { hoat_dong: 'lot', so_luong: +$('demLot').value || 0 }, { hoat_dong: 'giuong_lap', so_luong: +$('demGiuong').value || 0 }].filter(r => r.so_luong > 0)
  if (!rows.length) return bao('Chưa nhập số nào', true)
  const ma_ns = $('demAi').value === 'toi' ? USER.id : null
  const { error } = await sb.from('phieu_dem_ngay').insert(rows.map(r => ({ ma_to: DEM_TO[r.hoat_dong], hoat_dong: r.hoat_dong, so_luong: r.so_luong, ma_ns })))
  if (error) return bao('Lưu đếm lỗi: ' + error.message, true)
  bao('✔️ Đã lưu ' + rows.length + ' dòng đếm' + (ma_ns ? ' (riêng bạn)' : ' (cả tổ)'))
  $('demPu').value = ''; $('demLot').value = ''; $('demGiuong').value = ''
}

// ══════════ GHI LỖI ══════════
async function taiTo() {
  const { data } = await sb.from('to_san_xuat').select('ma_to,ten').order('ma_to')
  $('loiTo').innerHTML = (data || []).map(t => `<option value="${esc(t.ma_to)}">${esc(t.ten)}</option>`).join('')
}
let MON_LOI = []
async function taiMonLoi(maDon) {
  if (!maDon) { MON_LOI = []; $('loiMon').innerHTML = '<option value="">(chưa có đơn)</option>'; return }
  const { data } = await sb.rpc('xuong_mon_cua_don', { p_ma_don: maDon }); MON_LOI = data || []
  $('loiMon').innerHTML = MON_LOI.length ? MON_LOI.map(m => `<option value="${esc(m.id)}">${esc(m.ten || 'Món')}</option>`).join('') : '<option value="">(đơn chưa có món)</option>'
}
async function luuLoi() {
  const ma_don = $('loiDon').value; if (!ma_don) return bao('Chưa chọn đơn', true)
  const { error } = await sb.from('loi_lam_lai').insert({ ma_to: $('loiTo').value || null, ma_don, mon_id: $('loiMon').value || null, loai_loi: $('loiLoai').value, so_luong: +$('loiSo').value || 1, ma_ns_ghi: USER.id })
  if (error) return bao('Ghi lỗi thất bại: ' + error.message, true)
  bao('⚠️ Đã ghi lỗi: ' + $('loiLoai').value); $('loiSo').value = ''
}

// ══════════ QUẢN ĐỐC ══════════
async function taiChoVaoChuyen() {
  const box = $('qdChoBox'), list = $('qdChoList')
  const { data, error } = await sb.rpc('xuong_don_cho_vao_chuyen')
  if (error || !data || !data.length) { box.style.display = 'none'; return }   // ẩn hẳn khi không có đơn
  box.style.display = 'block'
  $('qdChoDem').textContent = data.length + (data.length === 1 ? ' đơn' : ' đơn')
  const TT = { moi_len_don: 'mới lên đơn', xong_file: 'xong file thiết kế' }
  list.innerHTML = data.map(d => `<div class="cho-don" data-don="${esc(d.ma_don)}">
    <div class="cd-than"><div class="cd-ten"><span class="ma">${esc(d.ma_don)}</span><b>${d.so_mon} món</b></div>
    <p class="cd-phu">${esc(TT[d.trang_thai] || d.trang_thai)}${d.ngay_hen_khach ? ' · hẹn giao ' + dmy(d.ngay_hen_khach) : ''}</p></div>
    <button class="cd-nut">Đưa vào chuyền</button></div>`).join('')
  list.querySelectorAll('.cho-don').forEach(row => {
    const btn = row.querySelector('.cd-nut')
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Đang đưa…'
      const { error: e } = await sb.rpc('dua_vao_chuyen', { p_ma_don: row.dataset.don })
      if (e) { bao('Không đưa được vào chuyền: ' + e.message, true); btn.disabled = false; btn.textContent = 'Đưa vào chuyền'; return }
      bao('✓ ' + row.dataset.don + ' đã vào chuyền (chờ cắt)')
      await taiDon(); await taiViec(); await taiQuanDoc(); if ($('qd-kb').style.display === 'block') taiKanban()
    }
  })
}
// Phân trang viec_uu_tien: TRƯỚC/SAU (thay trang) — danh sách xếp hạng làm từ trên xuống,
// trang rời khớp cách quản đốc xử theo lô 50 việc. Số thứ tự nối tiếp qua các trang.
let QD_TRANG = 0, QD_TONG = 0
// việc đang giữ TOÀN XƯỞNG (WP-46a) — thay cho tự-động-đóng; giữ lâu nhất lên trên (RPC order vao_luc)
async function taiGiuXuong() {
  const box = $('qdGiuBox'); if (!box) return
  const { data, error } = await sb.rpc('viec_dang_giu', { p_ma_ns: null })
  const ds = (error || !data) ? [] : data
  if (!ds.length) { box.style.display = 'none'; return }
  box.style.display = 'block'
  $('qdGiuDem').textContent = ds.length + ' việc'
  $('qdGiuList').innerHTML = ds.map(v => `<div class="tq-giu-hang"><span class="gtem">${esc(v.tem)}</span><span class="gmon">${esc(v.mon || '')}${v.tram_ten ? ' · ' + esc(v.tram_ten) : ''}</span><span class="gnguoi">${esc(v.nguoi_ten || '')}</span><span class="glau">giữ ${giuLau(v.giu_gio)}</span></div>`).join('')
}
async function taiQuanDoc(trang) {
  taiChoVaoChuyen()
  taiGiuXuong()
  QD_TRANG = trang || 0
  const { data: red } = await sb.rpc('can_ceo_quyet')
  $('qdCeo').innerHTML = (red && red.length)
    ? `<div class="ceo"><h2>Cần CEO quyết</h2><p class="phu">Quản đốc không tự xử được ${red.length === 1 ? 'việc này' : red.length + ' việc này'}.</p>${red.map(r => `<div class="ceo-muc"><p>${esc(r.mo_ta)}</p></div>`).join('')}</div>` : ''
  const { data, error } = await sb.rpc('viec_uu_tien', { p_gioi_han: MOI_TRANG, p_bo_qua: QD_TRANG * MOI_TRANG }); const box = $('qdList')
  if (error) { box.innerHTML = `<div class="trong-rong"><p>Lỗi: ${esc(error.message)}</p></div>`; veQdTrang(); return }
  const rows = data || []
  QD_TONG = rows.length ? Number(rows[0].tong_so) : 0
  $('qdGio').textContent = QD_TONG + ' việc đang chờ'; $('qdDem').textContent = QD_TONG + ' việc'
  if (!rows.length) { box.innerHTML = '<div class="trong-rong"><h3>Không có việc nào đang chờ</h3></div>'; veQdTrang(); return }
  const lyCls = r => r === 1 ? 'ly-tre' : r === 2 ? 'ly-gap' : r === 3 ? 'ly-tac' : r === 5 ? 'ly-mau' : 'ly-thuong'
  box.innerHTML = rows.map((v, i) => `<button class="viec" data-don="${esc(v.ma_don)}"><span class="stt">${QD_TRANG * MOI_TRANG + i + 1}</span><div class="viec-than"><div class="viec-ten"><span class="ma">${esc(v.ma_don)}</span><b>${esc(v.ten_mon)}</b></div><p class="viec-ly ${lyCls(v.rank_uu_tien)}">${esc(v.ly_do)}</p></div><span class="to">${esc(v.to_goi_y)}</span></button>`).join('')
  box.querySelectorAll('.viec').forEach(b => b.onclick = () => moDon(b.dataset.don))
  veQdTrang()
}
function veQdTrang() {
  const el = $('qdTrang'); if (!el) return
  if (QD_TONG <= MOI_TRANG) { el.innerHTML = QD_TONG ? `<span class="so">${QD_TONG} việc</span>` : ''; return }
  const soTrang = Math.ceil(QD_TONG / MOI_TRANG), tu = QD_TRANG * MOI_TRANG + 1, den = Math.min((QD_TRANG + 1) * MOI_TRANG, QD_TONG)
  el.innerHTML = `<span class="so">${tu}–${den} trong ${QD_TONG} việc</span>`
    + `<div class="nut"><button id="qdTruoc"${QD_TRANG <= 0 ? ' disabled' : ''}>Trước</button><button id="qdSau"${QD_TRANG >= soTrang - 1 ? ' disabled' : ''}>Sau</button></div>`
  if (QD_TRANG > 0) $('qdTruoc').onclick = () => taiQuanDoc(QD_TRANG - 1)
  if (QD_TRANG < soTrang - 1) $('qdSau').onclick = () => taiQuanDoc(QD_TRANG + 1)
}
let KB = []
const KB_COT = [['cho_cat', 'Chờ cắt'], ['da_cat', 'Đã cắt'], ['dang_lam', 'Đang làm'], ['xong_sx', 'Xong SX'], ['cho_giao', 'Chờ giao']]
// Phân trang kanban_xuong: TRƯỚC/SAU (thay trang), phân trang CHUNG cho cả 5 cột — KHÔNG
// riêng từng cột. Vì RPC giới hạn/bỏ-qua trên TOÀN danh sách đơn (order ma_don); phân trang
// riêng mỗi cột phải gọi 5 lần có tham số khác nhau (RPC chưa hỗ trợ). Cửa 50 đơn rải vào 5 cột.
let KB_TRANG = 0, KB_TONG = 0
async function taiKanban(trang) {
  KB_TRANG = trang || 0
  const { data } = await sb.rpc('kanban_xuong', { p_gioi_han: MOI_TRANG, p_bo_qua: KB_TRANG * MOI_TRANG }); KB = data || []
  KB_TONG = KB.length ? Number(KB[0].tong_so) : 0
  const tos = [...new Set(KB.map(x => x.to_goi_y))].filter(Boolean).sort(), dongs = [...new Set(KB.map(x => x.dong))].filter(Boolean).sort()
  const c1 = $('kbTo').value, c2 = $('kbDong').value
  $('kbTo').innerHTML = '<option value="">Tất cả tổ</option>' + tos.map(t => `<option${t === c1 ? ' selected' : ''}>${esc(t)}</option>`).join('')
  $('kbDong').innerHTML = '<option value="">Tất cả dòng</option>' + dongs.map(d => `<option${d === c2 ? ' selected' : ''}>${esc(d)}</option>`).join('')
  veKanban()
  veKbTrang()
}
function veKbTrang() {
  const el = $('kbTrang'); if (!el) return
  if (KB_TONG <= MOI_TRANG) { el.innerHTML = KB_TONG ? `<span class="so">${KB_TONG} đơn trên bảng</span>` : ''; return }
  const soTrang = Math.ceil(KB_TONG / MOI_TRANG), tu = KB_TRANG * MOI_TRANG + 1, den = Math.min((KB_TRANG + 1) * MOI_TRANG, KB_TONG)
  el.innerHTML = `<span class="so">Đang xem đơn ${tu}–${den} trong ${KB_TONG} trên bảng</span>`
    + `<div class="nut"><button id="kbTruoc"${KB_TRANG <= 0 ? ' disabled' : ''}>Trước</button><button id="kbSau"${KB_TRANG >= soTrang - 1 ? ' disabled' : ''}>Sau</button></div>`
  if (KB_TRANG > 0) $('kbTruoc').onclick = () => taiKanban(KB_TRANG - 1)
  if (KB_TRANG < soTrang - 1) $('kbSau').onclick = () => taiKanban(KB_TRANG + 1)
}
function veKanban() {
  const fTo = $('kbTo').value, fDong = $('kbDong').value
  const rows = KB.filter(x => (!fTo || x.to_goi_y === fTo) && (!fDong || x.dong === fDong))
  $('kbDem').textContent = rows.length + ' đơn đang chạy'
  $('kbBoard').innerHTML = KB_COT.map(([code, ten]) => {
    const cards = rows.filter(x => x.cot === code), u = cards.length > 5
    return `<div><div class="cot-dau${u ? ' u' : ''}"><b>${ten}</b><i>${cards.length}${u ? ' · ứ' : ''}</i></div><div class="cot-than">${cards.map(kbCard).join('') || '<span style="color:var(--chu-mo);font-size:12px;text-align:center;padding:8px">—</span>'}</div></div>`
  }).join('')
  $('kbBoard').querySelectorAll('.the-don').forEach(b => b.onclick = () => moDon(b.dataset.don))
}
function kbCard(x) {
  const done = x.cot === 'cho_giao', cls = done ? 'hoanthanh' : x.la_tre ? 'tre' : x.la_gap ? 'gap' : x.la_mau_moi ? 'mau' : ''
  const pct = x.so_mon_tong ? Math.round(100 * x.so_mon_qua / x.so_mon_tong) : 0
  const nhan = done ? '<span class="nhan hoanthanh">Chờ giao</span>' : x.la_tre ? '<span class="nhan tre">Trễ</span>' : x.la_gap ? '<span class="nhan gap">Gấp</span>' : x.la_mau_moi ? '<span class="nhan mau">Mẫu mới</span>' : `<span class="nhan thuong">${x.ngay_hen_khach ? 'Có hạn' : 'Bình thường'}</span>`
  return `<button class="the-don ${cls}" data-don="${esc(x.ma_don)}"><span class="ma">${esc(x.ma_don)}</span><p class="ten">${esc((x.ten_rut_gon || '').slice(0, 30))}</p><div class="thanh-tien"><div style="width:${pct}%"></div></div><div class="the-chan">${nhan}<span class="sm">${x.so_mon_qua}/${x.so_mon_tong}</span></div></button>`
}

// ══════════ PANEL CHI TIẾT MÓN ══════════
async function moDon(maDon) {   // từ Kanban/Quản đốc: mở món nút cổ chai của đơn
  const { data } = await sb.rpc('xuong_mon_cua_don', { p_ma_don: maDon })
  const m = (data || []).find(x => x.trang_thai !== 'xong_sx') || (data || [])[0]
  if (m) moMon(m.id, maDon); else bao('Đơn chưa có món')
}
async function moMon(monId, maDon) {
  PANEL = { monId, ke: null, nguoi: null }
  $('mo').classList.add('hien'); $('panel').classList.add('hien')
  $('pDau').innerHTML = '<p style="color:var(--chu-mo);padding:6px 0">Đang tải…</p>'; $('pThan').innerHTML = ''
  const [{ data: ct }, { data: vet }, { data: tem }, fileRes] = await Promise.all([
    sb.rpc('xuong_chi_tiet_mon', { p_mon_id: monId }),
    sb.rpc('xuong_vet_mon', { p_mon_id: monId }),
    maDon ? sb.rpc('xuong_tem_cua_don', { p_ma_don: maDon }) : Promise.resolve({ data: [] }),
    maDon ? sb.rpc('xuong_file_cua_don', { p_ma_don: maDon }) : Promise.resolve({ data: [] })
  ])
  const d = (ct || [])[0]
  if (!d) { $('pDau').innerHTML = '<p>Không tải được món.</p>'; return }
  // WP-32: giữ chỗ theo ĐƠN (giu_cho_ds cần don_hang_id — tra từ ma_don). Rỗng/lỗi → bảng ẩn (nhiệm C).
  let gc = []
  if (maDon) { try { const { data: dh } = await sb.from('don_hang').select('id').eq('ma_don', maDon).maybeSingle(); if (dh) { const { data: g } = await sb.rpc('giu_cho_ds', { p_don_hang_id: dh.id }); gc = (g || []).filter(x => x.trang_thai === 'mo') } } catch (_) { gc = [] } }
  // [WP-31 · L-111] phụ kiện CỦA MÓN từ BOM plugin. HYBRID theo vai (vat_tu RLS = ceo/kho/tho; don_hang RLS = KHÔNG tho):
  //   xuong/ceo/kho → bom_don_ds(don_id) [SECURITY DEFINER trả ma/tên dù xuong KHÔNG đọc vat_tu] lọc theo mon_id;
  //   tho (không lấy được don_id nhưng đọc THẲNG don_hang_mon_bom + vat_tu được) → đọc thẳng.
  let pk = { rows: [], loi: null }
  try {
    let donId = null
    try { const { data: dh } = await sb.from('don_hang').select('id').eq('ma_don', maDon).maybeSingle(); donId = dh && dh.id } catch (_) { donId = null }
    if (donId) {
      const { data, error } = await sb.rpc('bom_don_ds', { p_don_id: donId, p_moc: 'du_kien' })
      if (error) throw error
      pk.rows = (data || []).filter(r => r.mon_id === monId && r.co_bom && r.don_vi !== 'tam')
        .map(r => ({ ma: r.ma, ten: r.ten, so_luong: r.so_luong, don_vi: r.don_vi, so_luong_co_so: r.so_luong_co_so, ghi_chu: null }))
    } else {
      const { data, error } = await sb.from('don_hang_mon_bom')
        .select('so_luong,don_vi,so_luong_co_so,ghi_chu,vat_tu:vat_tu_id(ma,ten)')
        .eq('mon_id', monId).eq('moc', 'du_kien').neq('don_vi', 'tam')
      if (error) throw error
      pk.rows = (data || []).map(r => ({ ma: (r.vat_tu || {}).ma, ten: (r.vat_tu || {}).ten, so_luong: r.so_luong, don_vi: r.don_vi, so_luong_co_so: r.so_luong_co_so, ghi_chu: r.ghi_chu }))
    }
  } catch (e) { pk.loi = e.message || String(e) }   // luật 00 — không nuốt, hiện đỏ ở panel
  vePanel(d, vet || [], tem || [], (fileRes && fileRes.data) || [], gc, pk)
}
const LOAI_FILE = { dxf: '▤ DXF', cutlist: '▦ Cutlist', anh_ban_ve: '🖼 Ảnh bản vẽ', khac: '📄 File' }
async function taiFileXuong(path) {
  const { data } = await sb.storage.from('file-san-xuat').createSignedUrl(path, 3600, { download: true })
  if (data && data.signedUrl) window.open(data.signedUrl, '_blank'); else bao('Không tải được file', true)
}
function vePanel(d, vet, tem, files, gc, pk) {
  files = files || []; gc = gc || []
  const ke = KE[d.trang_thai]
  PANEL.ke = ke; PANEL.nguoi = USER.vai_tro === 'tho' ? USER.id : (THO_LIST[0] && THO_LIST[0].id) || USER.id
  const conNgay = d.ngay_hen_khach ? Math.ceil((new Date(d.ngay_hen_khach) - new Date()) / 86400000) : null
  const tre = conNgay != null && conNgay < 0
  const hanTxt = d.ngay_hen_khach ? `${dmy(d.ngay_hen_khach)} · ${tre ? 'quá ' + (-conNgay) + ' ngày' : 'còn ' + conNgay + ' ngày'}` : 'chưa hẹn'
  $('pDau').innerHTML =
    `<div class="hang"><div><span class="ma">${esc(d.ma_don)}</span><h2>${esc(d.ten || 'Món')}</h2>
      <div class="dong"><span class="vien-nhan">${esc(kgv(d.khong_gian) || '—')}</span><span class="vien-nhan">${esc(BUOC[d.trang_thai] || d.trang_thai)}</span>${d.danh_dau_gap ? '<span class="vien-nhan tre">GẤP</span>' : ''}</div></div>
      <button class="dong-x" id="pX">×</button></div>` +
    (ke ? `<div class="hanh-dong"><p>Bước hiện tại: <b>${esc(BUOC[d.trang_thai])}</b> → xong sẽ sang <b>${esc(BUOC[ke])}</b></p>
      <div class="chon-tho" id="chonTho"></div>
      <button class="nut-to" id="pXong">Xong bước ${esc(BUOC[d.trang_thai].toLowerCase())}</button></div>`
      : '<div class="hanh-dong"><p>Món đã <b>xong sản xuất</b>.</p></div>')
  $('pX').onclick = dongPanel
  if (ke) {
    const list = USER.vai_tro === 'tho' ? [{ id: USER.id, ho_ten: USER.ten || 'Tôi' }] : THO_LIST
    $('chonTho').innerHTML = list.length ? list.map((t, i) => `<button class="${i === 0 ? 'chon' : ''}" data-ns="${t.id}">${esc(t.ho_ten)}</button>`).join('') : '<span style="font-size:12.5px;color:var(--chu-mo)">Ghi cho: ' + esc(USER.ten || '') + '</span>'
    $('chonTho').querySelectorAll('button').forEach(b => b.onclick = () => { PANEL.nguoi = b.dataset.ns; $('chonTho').querySelectorAll('button').forEach(x => x.classList.toggle('chon', x === b)) })
    $('pXong').onclick = xongBuoc
  }
  // p-than: thông số · ghi chú · ảnh · tấm · phụ kiện · vết
  const anhArr = Array.isArray(d.anh) ? d.anh : []
  const tamGop = {}; let metNep = 0
  tem.forEach(t => { const k = (t.vai_tro || 'tấm') + '|' + fmt(t.dai) + '×' + fmt(t.rong) + '×' + fmt(t.day); tamGop[k] = (tamGop[k] || 0) + 1; (Array.isArray(t.canh_dan) ? t.canh_dan : []).forEach(e => metNep += Number(e && e.dai || 0)) })
  $('pThan').innerHTML =
    `<div class="muc"><h3>Thông số</h3><div class="o-luoi">
      <div class="o"><span>Kích thước</span><b class="mono">${esc(d.kt || '—')}</b></div>
      <div class="o"><span>Hạn giao</span><b>${esc(hanTxt)}</b></div>
      <div class="o"><span>Vật liệu</span><b>${esc(d.vl || '—')}</b></div>
      <div class="o"><span>Mã màu</span><b>${esc(d.ma_mau || '—')}</b></div>
      <div class="o"><span>Ước xuất xưởng</span><b>${d.ngay_du_kien ? dmy(d.ngay_du_kien) : '—'}</b></div>
      <div class="o"><span>Hẹn khách ban đầu</span><b>${d.ngay_hen_khach_ban_dau ? dmy(d.ngay_hen_khach_ban_dau) : '—'}</b></div>
    </div></div>` +
    `<div class="muc"><h3>Ghi chú</h3>${(d.chi_tiet ? `<div class="ghi"><em>Của món</em>${esc(d.chi_tiet)}</div>` : '') + (d.ghi_chu_don ? `<div class="ghi"><em>Của đơn</em>${esc(d.ghi_chu_don)}</div>` : '')}${(!d.chi_tiet && !d.ghi_chu_don) ? '<p style="color:var(--chu-mo);font-size:13.5px">Không có ghi chú.</p>' : ''}</div>` +
    `<div class="muc"><h3>Ảnh · bản vẽ</h3><div class="anh">${anhArr.length ? esc(anhArr.length + ' ảnh') : 'Chưa có ảnh'}${d.file_tk ? ' · file dựng hình ' + esc(d.file_tk) : ' · chưa gắn file dựng hình'}</div></div>` +
    `<div class="muc"><h3>Tấm chi tiết${tem.length ? ' · ' + tem.length + ' tấm (cả đơn)' : ''}</h3>${Object.keys(tamGop).length ? Object.entries(tamGop).map(([k, n]) => { const [vt, kt] = k.split('|'); return `<div class="tam" style="padding-left:0;padding-right:0"><span class="vt">${esc(vt.replace(/_/g, ' '))}</span><span class="kt">${esc(kt)}</span><span class="sl">×${n}</span></div>` }).join('') + (metNep ? `<p style="margin-top:10px;font-size:13px;color:var(--chu-nhat)">Nẹp dán cạnh: <b>${(metNep / 1000).toFixed(1)} m</b></p>` : '') : '<p style="color:var(--chu-mo);font-size:13.5px">Chưa có tem — máy thiết kế chưa đẩy.</p>'}</div>` +
    `<div class="muc"><h3>File từ thiết kế${files.length ? ' · ' + files.length + ' file' : ''}</h3>${files.length ? files.map(f => `<div class="tam" style="padding-left:0;padding-right:0"><span class="vt">${LOAI_FILE[f.loai_file] || f.loai_file}${f.ten_goc ? ' · ' + esc(f.ten_goc) : ''}</span><span class="kt">${f.co_byte ? Math.round(f.co_byte / 1024) + ' KB' : ''}</span><button class="nut-phu" data-taixuong="${esc(f.duong_dan)}" style="width:auto;padding:5px 12px">Tải về</button></div>`).join('') + '<p style="margin-top:9px;font-size:12.5px;color:var(--chu-mo)">Nguồn: <b>thiết kế tải lên</b>. Khối "Tấm chi tiết" ở trên đến <b>từ plugin</b>.</p>' : '<p style="color:var(--chu-mo);font-size:13.5px">Chưa có file thiết kế tải lên. Tem/tấm ở trên (nếu có) đến từ plugin.</p>'}</div>` +
    xuPkHtml(pk) +
    // WP-32: giữ chỗ vật tư của đơn (ẩn nếu 0 dòng — nhiệm C)
    (gc.length ? `<div class="muc"><h3>Giữ chỗ · ${gc.length} dòng</h3><table class="xg-gc-tbl"><thead><tr><th>Vật tư</th><th>Nguồn</th><th class="r">Giữ</th><th class="r">Đã xuất</th><th class="r">Còn giữ</th></tr></thead><tbody>${gc.map(g => `<tr><td><span class="xg-gc-ma">${esc(g.ma || '')}</span> ${esc(g.ten || '')}</td><td><span class="xg-gc-src">${esc(g.nguon || '—')}</span></td><td class="r xg-gc-n">${fmt(g.so_luong_giu)}</td><td class="r xg-gc-n">${fmt(g.so_luong_da_xuat)}</td><td class="r xg-gc-n">${fmt(Number(g.so_luong_giu) - Number(g.so_luong_da_xuat))}</td></tr>`).join('')}</tbody></table></div>` : '') +
    `<div class="muc"><h3>Đã qua tay ai</h3>${vet.length ? vet.map(v => `<div class="vet"><span class="luc">${dmyhm(v.luc)}</span><span class="noi">${v.nguoi_ten ? '<b>' + esc(v.nguoi_ten) + '</b> ' : ''}<span>${v.tu ? 'xong ' + esc(BUOC[v.tu] || v.tu).toLowerCase() + ' → ' : ''}${esc(BUOC[v.den] || v.den).toLowerCase()}</span></span></div>`).join('') : '<p style="color:var(--chu-mo);font-size:13.5px">Chưa có vết đổi bước.</p>'}</div>`
  $('pThan').querySelectorAll('[data-taixuong]').forEach(b => b.onclick = () => taiFileXuong(b.dataset.taixuong))
}
// ── [WP-31 · L-111] Phụ kiện CỦA MÓN (từ BOM plugin, chỉ đọc) — thay câu tĩnh "12 driver" ──
function xuNhan(r) { return r.so_luong_co_so == null ? '<span class="xu-pk-nhan hs">⧗ chờ hệ số</span>' : '<span class="xu-pk-nhan chac">chắc</span>' }
function xuPkHtml(pk) {
  xuPkCss()
  pk = pk || { rows: [], loi: null }
  if (pk.loi) return `<div class="muc"><h3>Phụ kiện</h3><div class="xu-pk-loi">Lỗi đọc phụ kiện: ${esc(pk.loi)}</div></div>`
  const rows = pk.rows || []
  if (!rows.length) return `<div class="muc"><h3>Phụ kiện</h3><p class="xu-pk-trong">Chưa thấy phụ kiện từ bản plugin cho món này — máy thiết kế chưa đẩy BOM (hoặc đơn chưa có bản đẩy từ SketchUp).</p></div>`
  const tr = rows.map(r =>
    `<tr><td><b class="mono">${esc(r.ma || '—')}</b></td><td>${esc(r.ten || '')}</td><td class="r">${fmt(r.so_luong)}</td><td>${esc(r.don_vi || '')}</td><td>${esc(r.ghi_chu || '')}</td><td>${xuNhan(r)}</td></tr>`).join('')
  return `<div class="muc"><h3>Phụ kiện · ${rows.length} loại <span class="xu-pk-ng">từ plugin</span></h3>` +
    `<table class="xu-pk-tbl"><thead><tr><th>Mã kho</th><th>Tên</th><th class="r">SL</th><th>ĐV</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead><tbody>${tr}</tbody></table>` +
    `<p class="xu-pk-ct"><span class="xu-pk-nhan chac">chắc</span> mã kho đã chốt · <span class="xu-pk-nhan hs">⧗ chờ hệ số</span> thiếu quy đổi đơn vị. Nguồn: <b>plugin SketchUp</b> (per món).</p></div>`
}
function xuPkCss() {
  if (document.getElementById('xu-pk-css')) return
  const s = document.createElement('style'); s.id = 'xu-pk-css'
  s.textContent = '.xu-pk-tbl{width:100%;border-collapse:collapse;font-size:13px}.xu-pk-tbl th{text-align:left;font-weight:600;color:var(--chu-nhat);border-bottom:1px solid var(--vien);padding:5px 8px}.xu-pk-tbl td{border-bottom:1px solid var(--vien);padding:5px 8px;vertical-align:top}.xu-pk-tbl .r{text-align:right;white-space:nowrap}.xu-pk-trong{color:var(--chu-mo);font-size:13.5px}.xu-pk-loi{background:#FDECEA;border:1px solid #F3C9C4;color:#B2312A;border-radius:7px;padding:9px 12px;font-size:13px}.xu-pk-ng{font-size:11px;font-weight:600;color:var(--chu-mo);text-transform:uppercase;letter-spacing:.04em;margin-left:4px}.xu-pk-ct{margin-top:9px;font-size:12px;color:var(--chu-nhat);display:flex;gap:10px;flex-wrap:wrap;align-items:center}.xu-pk-nhan{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11.5px;font-weight:600}.xu-pk-nhan.chac{background:#E7EFEA;color:#15805F}.xu-pk-nhan.hs{background:#FDECEA;color:#B2312A}'
  document.head.appendChild(s)
}
async function xongBuoc() {
  if (!PANEL.ke) return
  const { error } = await sb.rpc('tien_mon', { p_mon_id: PANEL.monId, p_trang_thai: PANEL.ke, p_nguoi_id: PANEL.nguoi })
  if (error) return bao('Không đẩy được bước: ' + error.message, true)
  bao('✓ Đã sang bước "' + (BUOC[PANEL.ke] || PANEL.ke) + '"'); dongPanel()
  await taiDon(); await taiViec(); if ($('s-qd').style.display === 'block') { taiQuanDoc(); if ($('qd-kb').style.display === 'block') taiKanban() }
}
function dongPanel() { $('panel').classList.remove('hien'); $('mo').classList.remove('hien') }
const dmy = s => { const d = new Date(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') }
const dmyhm = s => { const d = new Date(s); return dmy(s) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

// ══════════ TRẠM QUÉT ══════════
let TRAM = null, TRAM_INFO = null, HONG = false, DANG_QUET = false, LOAI = null   // LOAI: 'vao'|'ra' — thợ chọn, KHÔNG đoán (WP-46a)
let PHIEN = null   // {nguoi_id, ho_ten} — thợ đang cầm trạm (nguồn "ai làm", WP-46a L-35)
const TT_TEN = { chay: 'Đang chạy', nghi: 'Nghỉ', hong: 'Máy hỏng', cho_vat_tu: 'Chờ vật tư', ve_sinh: 'Vệ sinh' }
let TT_CHON = 'chay'
const focusO = () => { const o = $('tqO'); if (o && !o.disabled && $('s-tram').style.display === 'block' && !moNaoDangMo()) o.focus() }
const moNaoDangMo = () => $('tqTtPhu').style.display !== 'none' || $('tqBuPhu').style.display !== 'none'

// wiring MỘT LẦN (DOM luôn có)
function setupTram() {
  // giữ con trỏ: blur ô quét mà không có modal → tự về ô
  $('tqO').addEventListener('blur', () => setTimeout(focusO, 40))
  $('tqO').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quetGui($('tqO').value.trim()) } })
  // HAI NÚT (WP-46a): chọn việc → sáng nút + đặt LOAI; nếu ô đã có tem thì quét luôn
  $('tqNhan').onclick = () => chonViec('vao')
  $('tqXong').onclick = () => chonViec('ra')
  // nút hỏng: bật/tắt (một lần bật một lần dùng)
  $('tqHong').onclick = () => { HONG = !HONG; $('tqHong').classList.toggle('bat', HONG); $('tqHong').textContent = HONG ? 'TẤM SAU: GHI HỎNG' : 'Tấm sau bị hỏng'; focusO() }
  // đổi trạng thái
  $('tqDoiTt').onclick = moHopTt
  $('tqTtHuy').onclick = () => { $('tqTtPhu').style.display = 'none'; focusO() }
  $('tqTtLuu').onclick = luuTt
  document.querySelectorAll('#tqTtChon button').forEach(b => b.onclick = () => chonTt(b.dataset.tt))
  // ghi bù (chỉ xuong/ceo)
  $('tqGhibu').onclick = moHopBu
  $('tqDoiTram2').onclick = () => { localStorage.removeItem('tq_tram'); TRAM = null; taiTram() }
  $('tqBuHuy').onclick = () => { $('tqBuPhu').style.display = 'none'; focusO() }
  $('tqBuLuu').onclick = luuBu
}

async function taiTram() {
  ;['tqChon', 'tqMoca', 'tqChinh'].forEach(k => $(k).style.display = 'none')
  // 1) xác định trạm: URL ?tram= thắng → lưu; else localStorage
  const urlTram = new URLSearchParams(location.search).get('tram')
  if (urlTram) { TRAM = urlTram; try { localStorage.setItem('tq_tram', urlTram) } catch (e) {} }
  else TRAM = TRAM || (() => { try { return localStorage.getItem('tq_tram') } catch (e) { return null } })()
  if (!TRAM) return veChonTram()
  // 2) đọc đầu màn
  const { data, error } = await sb.rpc('tram_man', { p_tram: TRAM })
  if (error || !data || data.khong_co) { localStorage.removeItem('tq_tram'); TRAM = null; return veChonTram(error ? error.message : 'Trạm không có trong hệ') }
  TRAM_INFO = data
  // WP-46a L-35: "ai làm" nay là PHIÊN thợ (không mở-ca). Vào thẳng màn chính; khối phiên xử người.
  veChinh()
}

async function veChonTram(loi) {
  $('tqChon').style.display = ''
  const { data } = await sb.rpc('tram_ds')
  const box = $('tqChonDs')
  box.innerHTML = (loi ? '<p style="color:var(--do)">' + esc(loi) + '</p>' : '') +
    (data || []).map(t => `<button data-t="${esc(t.ma_tram)}"><span style="font-weight:700;color:var(--chu)">${esc(t.ten)}</span><span>${esc(t.hd_ten)}</span></button>`).join('')
  box.querySelectorAll('button[data-t]').forEach(b => b.onclick = () => { try { localStorage.setItem('tq_tram', b.dataset.t) } catch (e) {} TRAM = b.dataset.t; taiTram() })
}

async function veMoca(loi) {
  $('tqMoca').style.display = ''
  $('tqMocaTitle').textContent = 'Mở ca ở ' + (TRAM_INFO?.ten || TRAM)
  const { data } = await sb.rpc('tram_ds_nguoi')
  const box = $('tqMocaDs')
  box.innerHTML = (loi ? '<p style="color:var(--do)">' + esc(loi) + '</p>' : '') +
    (data || []).map(n => `<button data-n="${esc(n.id)}"><span style="font-weight:700;color:var(--chu)">${esc(n.ho_ten)}</span><span>${esc(TEN_VAI[n.vai_tro] || n.vai_tro)}</span></button>`).join('')
  box.querySelectorAll('button[data-n]').forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc('mo_ca', { p_tram: TRAM, p_nguoi: b.dataset.n })
    if (error) return veMoca(error.message)
    taiTram()
  })
}

function veChinh() {
  $('tqChinh').style.display = ''
  const t = TRAM_INFO
  $('tqTen').textContent = t.ten || t.ma_tram
  $('tqHd').textContent = (t.hd_ten || '') + (t.ma_tram ? ' · ' + t.ma_tram : '')
  PHIEN = t.co_phien ? { nguoi_id: t.phien_nguoi_id, ho_ten: t.phien_ho_ten } : null
  $('tqNguoi').textContent = (PHIEN && PHIEN.ho_ten) || '—'
  veDen(t.trang_thai || 'chay')
  $('tqGhibu').style.display = (USER.vai_tro === 'xuong' || USER.vai_tro === 'ceo') ? '' : 'none'
  $('tqKq').innerHTML = ''
  // reset chọn việc mỗi lần vào màn (WP-46a) — không nhớ lượt cũ
  LOAI = null; $('tqNhan').classList.remove('armed'); $('tqXong').classList.remove('armed'); $('tqO').placeholder = 'chọn việc rồi quét…'
  vePhien(); taiCho(); taiCa(); taiLuot(); taiGiu()
  if (PHIEN) focusO()
}

// AI ĐANG LÀM — có phiên: tên chữ to + "Không phải tôi"; chưa phiên: danh sách chọn thợ (WP-46a L-35)
function vePhien(nhuongText) {
  const box = $('tqPhien')
  if (PHIEN) {
    box.innerHTML = `<div class="tq-phien-co"><span class="nhan">Đang làm ở trạm này</span><b>${esc(PHIEN.ho_ten || '')}</b>
      <button class="doi" id="tqDoiPhien">Không phải tôi</button></div>${nhuongText ? `<p class="tq-phien-nhuong">${nhuongText}</p>` : ''}`
    $('tqDoiPhien').onclick = () => vePhienChon()
  } else {
    vePhienChon(nhuongText)
  }
}
async function vePhienChon(nhuongText) {
  const box = $('tqPhien')
  box.innerHTML = `<div class="tq-phien-chon"><p>Ai nhận trạm này? Bấm tên để bắt đầu.</p><div class="tq-phien-ds" id="tqPhienDs">Đang tải…</div>${nhuongText ? `<p class="tq-phien-nhuong">${nhuongText}</p>` : ''}</div>`
  const { data } = await sb.rpc('tram_ds_nguoi')   // PHÁT SINH: chưa có bảng người↔tổ → liệt kê toàn bộ tho/xuong/ceo
  $('tqPhienDs').innerHTML = (data || []).map(n => `<button data-n="${esc(n.id)}">${esc(n.ho_ten)}</button>`).join('') || '<span>Không có thợ nào.</span>'
  document.querySelectorAll('#tqPhienDs button').forEach(b => b.onclick = () => moPhienChon(b.dataset.n))
}
async function moPhienChon(nguoiId) {
  const { data, error } = await sb.rpc('mo_phien', { p_nguoi: nguoiId, p_tram: TRAM })
  if (error) { bao(error.message, true); return }
  PHIEN = { nguoi_id: data.nguoi_nhan_id, ho_ten: data.nguoi_nhan }
  $('tqNguoi').textContent = PHIEN.ho_ten || '—'
  const nhuong = data.nguoi_nhuong ? `Đã chuyển trạm từ <b>${esc(data.nguoi_nhuong)}</b> sang <b>${esc(data.nguoi_nhan)}</b>.` : ''
  vePhien(nhuong); taiGiu(); focusO()
}
function veDen(tt) {
  const el = $('tqDen'); const chay = tt === 'chay'
  el.className = 'tq-den ' + (chay ? 'chay' : 'dung'); el.textContent = TT_TEN[tt] || tt
}

async function taiCho() {
  const { data } = await sb.rpc('tram_dang_cho', { p_tram: TRAM })
  const so = data?.so || 0, ds = data?.ds || []
  $('tqChoSo').textContent = so + ' tấm'
  $('tqChoDs').innerHTML = so === 0
    ? '<div class="tq-cho-rong">Không có tấm nào chờ ở trạm này.</div>'
    : ds.map(x => `<div class="tq-cho-hang"><span class="tq-ctem">${esc(x.tem)}</span><span class="tq-cmon">${esc(x.mon || x.tam || '')}${x.don ? ' · đơn ' + esc(x.don) : ''}</span><span class="tq-clau">${x.cho_phut == null ? '' : 'chờ ' + choLau(x.cho_phut)}</span></div>`).join('')
}
const choLau = p => p < 60 ? p + ' phút' : Math.floor(p / 60) + ' giờ ' + (p % 60) + ' phút'

async function taiCa() {
  const { data } = await sb.rpc('tram_ca_hom_nay', { p_tram: TRAM })
  if (!data || !data.co_ca) { $('tqCa').textContent = 'ca hôm nay: chưa có'; return }
  $('tqCa').textContent = `ca hôm nay: ${data.so_tam} tấm · ${fmt(data.so_hong)} hỏng · ${fmt(data.gio)} giờ`
}

async function taiLuot() {
  const { data } = await sb.rpc('tram_luot_gan_day', { p_tram: TRAM })
  $('tqLuot').innerHTML = (data || []).length === 0
    ? '<div class="tq-cho-rong">Chưa có lượt nào.</div>'
    : data.map(l => `<div class="tq-luot"><span class="gio">${esc(l.gio)}</span><span class="tem">${esc(l.tem)}</span><span class="mon">${esc(l.tam || '')}</span><span class="vr tq-vr ${l.vr}">${l.vr === 'chan' ? 'chặn' : l.vr === 'ra' ? 'ra' : 'vào'}</span><span class="hong">${l.hong ? 'hỏng' : ''}</span></div>`).join('')
}

// QUÉT — FAIL-ĐÓNG: luôn gọi server; mất mạng KHÔNG hiện xanh
async function quetGui(ma) {
  if (!ma || DANG_QUET) { focusO(); return }
  if (!LOAI) { bao('Chọn "Nhận việc" hoặc "Làm xong" trước khi quét.', true); focusO(); return }   // KHÔNG đoán hộ (WP-46a)
  DANG_QUET = true
  const hongLan = HONG
  let res, netErr = false, rpcLoi = null
  try {
    const { data, error } = await sb.rpc('tram_quet', { p_tem: ma, p_tram: TRAM, p_so_hong: hongLan ? 1 : 0, p_so_lam_lai: 0, p_loai: LOAI })
    if (error) {
      // RAISE của DB ("đang giữ việc này rồi" / "chưa nhận việc" / …) trả về error CÓ nội dung → hiện NGUYÊN VĂN.
      // Chỉ mất-mạng thật (fetch hỏng) mới coi là mất mạng — KHÔNG nuốt RAISE thành "mất mạng".
      if (/fetch|network|Failed to fetch|timeout|ERR_|offline/i.test(error.message || '')) netErr = true
      else rpcLoi = error.message || 'Không quét được'
    } else res = data
  } catch (e) { netErr = true }
  $('tqO').value = ''
  DANG_QUET = false
  const tatHong = () => { if (hongLan) { HONG = false; $('tqHong').classList.remove('bat'); $('tqHong').textContent = 'Tấm sau bị hỏng' } }
  if (netErr) { veKqMang(ma); focusO(); return }   // KHÔNG hiện xanh, KHÔNG xếp hàng ngầm
  if (rpcLoi) {   // RAISE — chữ to, nguyên văn
    tatHong(); veKqLoi(ma, rpcLoi)
    if (/chưa có thợ nhận trạm/.test(rpcLoi)) { PHIEN = null; vePhienChon() }   // đẩy về chọn thợ, đừng quét lặp vô ích (■1c)
    else taiGiu()
    focusO(); return
  }
  tatHong()
  if (res) res.tem_ma = ma
  veKq(res)
  taiCho(); taiCa(); taiLuot(); taiGiu()
  if (res && res.trang_thai) veDen(res.trang_thai)
  focusO()
}
// chọn việc: sáng nút + đặt LOAI; ô đã có tem thì quét luôn (WP-46a)
function chonViec(l) {
  LOAI = l
  $('tqNhan').classList.toggle('armed', l === 'vao')
  $('tqXong').classList.toggle('armed', l === 'ra')
  $('tqO').placeholder = l === 'vao' ? 'ĐANG NHẬN VIỆC — quét tem…' : 'ĐANG LÀM XONG — quét tem…'
  const v = $('tqO').value.trim()
  if (v) quetGui(v); else focusO()
}
// việc đang giữ — trạm quét: của NGƯỜI-CỦA-PHIÊN (không phải tài khoản đăng nhập) — WP-46a L-35 ■2
async function taiGiu() {
  const wrap = $('tqGiuWrap'); if (!wrap) return
  if (!PHIEN) { wrap.style.display = 'none'; $('tqGiuDs').innerHTML = ''; return }
  const { data, error } = await sb.rpc('viec_dang_giu', { p_ma_ns: PHIEN.nguoi_id })
  const ds = (error || !data) ? [] : data
  if (!ds.length) { wrap.style.display = 'none'; $('tqGiuDs').innerHTML = ''; return }
  wrap.style.display = ''
  $('tqGiuDs').innerHTML = ds.map(v => `<div class="tq-giu-hang"><span class="gtem">${esc(v.tem)}</span><span class="gmon">${esc(v.mon || '')}${v.tram_ten ? ' · ' + esc(v.tram_ten) : ''}</span><span class="glau">giữ ${giuLau(v.giu_gio)}</span></div>`).join('')
}
const giuLau = h => { const g = Number(h) || 0; return g < 1 ? Math.round(g * 60) + ' phút' : (g < 10 ? g.toFixed(1).replace('.', ',') : Math.round(g)) + ' giờ' }

function veKq(g) {
  const box = $('tqKq')
  const monLine = (g.mon ? esc(g.mon) + ' ' : '') + '<span>' + [g.tam, g.don ? 'đơn ' + g.don : ''].filter(Boolean).map(esc).join(' · ') + '</span>'
  if (g.ok) {
    box.innerHTML = `<div class="tq-kq nhan"><div class="tq-kq-dau"><div class="bieu">✓</div><b>Xong</b></div>
      <div class="tq-kq-than"><div class="tem">${esc(g.tem_ma || '')}</div><p class="mon">${monLine}</p>
      <div class="tq-kq-hang">
        <div><p>Vừa ${g.loai === 'ra' ? 'ra' : 'vào'}</p><b>${esc(g.hoat_dong_ten || '')}</b></div>
        ${g.mat_phut != null ? `<div><p>Mất</p><b>${g.mat_phut} phút</b></div>` : ''}
        ${g.buoc_ke ? `<div><p>Tiếp theo</p><b>${esc(g.buoc_ke)}</b></div>` : ''}
        ${g.xong != null && g.tong_buoc != null ? `<div><p>Tấm này</p><b>${g.xong}/${g.tong_buoc} bước</b></div>` : ''}
      </div></div></div>`
    veBfToast(g)
  } else {
    box.innerHTML = `<div class="tq-kq chan"><div class="tq-kq-dau"><div class="bieu">✕</div><b>Chặn</b></div>
      <div class="tq-kq-than"><div class="tem">${esc(g.tem_ma || '')}</div><p class="mon">${monLine}</p>
      <p class="tq-kq-loi">${esc(g.ly_do || 'Không quét được')}<span>${esc(g.duong_thoat || 'Báo tổ trưởng để xử lý.')}</span></p></div></div>`
  }
}
// WP-36 · toast back-flush: kho tự xuất ván/phụ kiện khi quét (xanh) hoặc báo thiếu hệ số (vàng). Tự ẩn 6s, chạm để giữ.
const bfSo = v => (v == null || isNaN(Number(v))) ? '' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
function veBfToast(g) {
  const dong = Array.isArray(g.back_flush) ? g.back_flush : []
  const thieu = Array.isArray(g.thieu_he_so) ? g.thieu_he_so : []
  if (!dong.length && !thieu.length) return
  let el = $('tqBf')
  if (!el) { el = document.createElement('div'); el.id = 'tqBf'; document.body.appendChild(el); el.onclick = () => { el._giu = !el._giu; if (el._giu) clearTimeout(el._t) } }
  el._giu = false
  const xanh = dong.length > 0
  let html = ''
  if (xanh) {
    const list = dong.map(d => `<b>${bfSo(d.so_luong)} ${esc(d.don_vi || '')} ${esc(d.ma || '')}</b>`).join(', ')
    const ph = g.bf_phieu || (dong[0] && dong[0].phieu_so)
    const ton = dong[0] && dong[0].ton_con != null ? ` · tồn còn ${bfSo(dong[0].ton_con)}` : ''
    html += `<div class="tq-bf-body">Kho đã xuất ${list}<small>${ph ? 'Phiếu ' + esc(ph) : 'Đã ghi phiếu xuất'}${ton}</small></div>`
  }
  if (thieu.length) {
    const list = thieu.map(t => `<b>${esc(t.ma || '')}</b> thiếu hệ số ${esc(t.don_vi_bom || '')}${t.don_vi_co_so ? '→' + esc(t.don_vi_co_so) : ''}`).join('; ')
    html += `<div class="tq-bf-body canh">Chưa xuất ván: ${list}<small>Báo kho vào tab "Đơn vị &amp; hao hụt". Tem vẫn chạy tiếp.</small></div>`
  }
  el.className = 'tq-bf' + (xanh ? '' : ' canh') + ' hien'
  el.innerHTML = html
  clearTimeout(el._t); el._t = setTimeout(() => { if (!el._giu) el.classList.remove('hien') }, 6000)
}
function veKqMang(ma) {
  $('tqKq').innerHTML = `<div class="tq-kq mang"><div class="tq-kq-dau"><div class="bieu">⚠</div><b>Mất mạng</b></div>
    <div class="tq-kq-than"><div class="tem">${esc(ma)}</div>
    <p class="tq-kq-loi">MẤT MẠNG — chưa ghi được<span>Tấm này CHƯA được ghi. Quét lại khi có mạng, hoặc nhờ tổ trưởng ghi bù. Đừng bỏ qua.</span></p></div></div>`
}
// RAISE từ DB (hai nút): hiện NGUYÊN VĂN, chữ to, không nuốt (WP-46a)
function veKqLoi(ma, loi) {
  $('tqKq').innerHTML = `<div class="tq-kq chan"><div class="tq-kq-dau"><div class="bieu">✕</div><b>Chưa ghi được</b></div>
    <div class="tq-kq-than"><div class="tem">${esc(ma)}</div>
    <p class="tq-kq-loi">${esc(loi)}<span>Đọc kỹ câu trên rồi bấm đúng nút. Cần thì báo tổ trưởng.</span></p></div></div>`
}

// ĐỔI TRẠNG THÁI
async function moHopTt() {
  TT_CHON = TRAM_INFO?.trang_thai || 'chay'
  $('tqTtPhu').style.display = ''   // mở trước để chặn con trỏ tự nhảy về ô quét
  veChonTt()
  const { data } = await sb.rpc('ly_do_dung_ds')
  $('tqTtLyDo').innerHTML = '<option value="">— chọn lý do —</option>' + (data || []).map(l => `<option value="${esc(l.ten)}">${esc(l.ten)}</option>`).join('')
}
function chonTt(tt) { TT_CHON = tt; veChonTt() }
function veChonTt() {
  document.querySelectorAll('#tqTtChon button').forEach(b => b.classList.toggle('chon', b.dataset.tt === TT_CHON))
  $('tqTtLyDoWrap').style.display = TT_CHON === 'chay' ? 'none' : ''
}
async function luuTt() {
  const lyDo = TT_CHON === 'chay' ? '' : $('tqTtLyDo').value
  if (TT_CHON !== 'chay' && !lyDo) { bao('Chọn lý do dừng trước.', true); return }
  const { error } = await sb.rpc('doi_trang_thai_tram', { p_tram: TRAM, p_trang_thai: TT_CHON, p_ly_do: lyDo || null })
  if (error) return bao('Không đổi được: ' + error.message, true)
  TRAM_INFO.trang_thai = TT_CHON; veDen(TT_CHON)
  $('tqTtPhu').style.display = 'none'; bao('✓ Đã ghi trạng thái trạm'); focusO()
}

// GHI BÙ (xuong/ceo)
function moHopBu() {
  $('tqBuTem').value = ''; $('tqBuLyDo').value = ''; $('tqBuLoai').value = 'vao'
  $('tqBuPhu').style.display = ''; setTimeout(() => $('tqBuTem').focus(), 30)
}
async function luuBu() {
  const tem = $('tqBuTem').value.trim(), loai = $('tqBuLoai').value, luc = $('tqBuLuc').value, lyDo = $('tqBuLyDo').value.trim()
  if (!tem || !luc) { bao('Cần mã tem và lúc thật.', true); return }
  const { data, error } = await sb.rpc('ghi_bu', { p_tem: tem, p_tram: TRAM, p_loai: loai, p_luc_that: new Date(luc).toISOString(), p_ly_do: lyDo || 'ghi bù tại trạm' })
  if (error) return bao('Ghi bù lỗi: ' + error.message, true)
  if (data && data.ok === false) { bao('Ghi bù bị chặn: ' + (data.ly_do || data.loi), true); return }
  $('tqBuPhu').style.display = 'none'; bao('✓ Đã ghi bù'); taiCho(); taiCa(); taiLuot(); focusO()
}

// ══════════ BOOT ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) laySauDangNhap(data.session.user); else manDangNhap('')
})()

// ══════════════════════════ TẢI & LỊCH ══════════════════════════
const TL_TO = [['cnc', 'CNC'], ['dan_canh', 'Dán cạnh'], ['cha_lot', 'Chà lót'], ['son_pu', 'Sơn PU'], ['lap_rap', 'Lắp ráp'], ['dong_goi', 'Đóng gói'], ['giuong', 'Giường']]
const TL_TEN_TO = Object.fromEntries(TL_TO)
const TL_NHAN_VUNG = { dong_bang: 'đóng băng', vung_chac: 'vững chắc', day: 'đầy', mo: 'mở' }
const TL_HD = { cat: 'cắt CNC', dan: 'dán cạnh', khoan_cam: 'khoan cam', cha: 'chà nhám', lot: 'chà lót', pu: 'sơn PU', son: 'sơn màu', lap: 'lắp ráp', goi: 'đóng gói', giuong: 'giường', bao_bi: 'bao bì', kiem: 'kiểm' }
const TL_MOI = 12
let TL = { truc: 'to', hienMts: true, tuan: [], vung: {}, o: {}, sv: {}, quaTai: 0, oMo: null, don: [], dem: {}, tongDon: 0, trangDon: 1, xepKq: null, donXep: null, tuanGiao: null, kieuXep: 'nguoc', vD: null, doiTuan: [] }
const tlLabel = hd => TL_HD[hd] || hd
const isoHomNay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const isoCong = (iso, days) => { const x = new Date(new Date(iso + 'T00:00:00').getTime() + days * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
const tlLaCeo = () => USER && USER.vai_tro === 'ceo'
const xepDuoc = () => USER && ['ceo', 'xuong'].includes(USER.vai_tro)   // [WP-45] tho không thấy nút xếp lại

function setupTL() {
  if (setupTL._done) return; setupTL._done = true
  $('tl-ky').onchange = taiTaiLich
  document.querySelectorAll('#s-tl .tl-doi-truc button').forEach(b => b.onclick = () => tlDoiTruc(b.dataset.truc))
  $('tl-bt-mts').onclick = () => { TL.hienMts = !TL.hienMts; $('tl-bt-mts').classList.toggle('tl-bat', TL.hienMts); if (TL.oMo) veBungTL() }
  $('tl-loc-van').onchange = () => veDonTL(1)
  $('tl-loc-to').onchange = () => veDonTL(1)
  $('tl-tim').oninput = () => veDonTL(1)
  // [WP-45] hộp xếp lại cả đơn (thay dời tay một bước)
  $('tl-xl-x').onclick = $('tl-xl-huy').onclick = () => tlDong('tl-hop-xl')
  $('tl-xl-xep').onclick = tlXlXep
  $('tl-xl-lydo').oninput = tlXlDoiNut
  $('tl-hop-xl').addEventListener('click', e => { if (e.target === $('tl-hop-xl')) tlDong('tl-hop-xl') })
  // [WP-43] hộp xếp lại đơn chưa vào được lịch (từ dải đỏ)
  $('tl-ket-x').onclick = $('tl-ket-huy').onclick = () => tlDong('tl-hop-ket')
  $('tl-ket-xep').onclick = tlKetXep
  $('tl-ket-ep').onclick = tlKetEp
  $('tl-ket-lydo').oninput = () => { $('tl-ket-ep').disabled = $('tl-ket-lydo').value.trim().length < 5 }
  $('tl-hop-ket').addEventListener('click', e => { if (e.target === $('tl-hop-ket')) tlDong('tl-hop-ket') })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { tlDong('tl-hop-xl'); tlDong('tl-hop-ket') } })
}

// ══════════ NĂNG LỰC TỔ (WP-47 · class nl-) — nav n-nlt/d-nlt/s-nlt (n-nl = "Nhìn lại" đã có) ══════════
const NL = { rows: [], goc: {}, ml: { dong_bang: 0, vung_chac: 0 } }
const nlLaCeo = () => USER.vai_tro === 'ceo'
const nlGioTuan = r => Math.round(r.so_nguoi * r.gio_moi_ngay * r.ngay_moi_tuan * r.he_so * 10) / 10
const nlDoi = () => NL.rows.filter(r => { const g = NL.goc[r.ma_to]; return g && (r.so_nguoi !== g.so_nguoi || r.gio_moi_ngay !== g.gio_moi_ngay || r.ngay_moi_tuan !== g.ngay_moi_tuan || r.he_so !== g.he_so) })
function nlCapNhatLuu() { const ly = ($('nl-ly-do').value || '').trim(); $('nl-luu').disabled = !(nlDoi().length > 0 && ly.length >= 5) }

async function taiNangLuc() {
  if (USER.vai_tro === 'tho') return
  const { data: ds, error } = await sb.rpc('nl_ds')
  if (error) { $('nl-bang').innerHTML = '<tr><td class="nl-loi">Lỗi tải năng lực: ' + esc(error.message) + '</td></tr>'; return }
  NL.rows = (ds || []).map(r => ({ ma_to: r.ma_to, ten: r.ten, so_nguoi: +r.so_nguoi || 0, gio_moi_ngay: +r.gio_moi_ngay || 0, ngay_moi_tuan: +r.ngay_moi_tuan || 0, he_so: +r.he_so_huu_ich || 0, xac_nhan: r.xac_nhan }))
  NL.goc = {}; NL.rows.forEach(r => { NL.goc[r.ma_to] = { so_nguoi: r.so_nguoi, gio_moi_ngay: r.gio_moi_ngay, ngay_moi_tuan: r.ngay_moi_tuan, he_so: r.he_so } })
  veNLBang()
  const mai = isoCong(isoHomNay(), 1)
  $('nl-tu-ngay').value = mai; $('nl-tu-ngay').min = mai; $('nl-ly-do').value = ''; $('nl-loi-luu').style.display = 'none'
  $('nl-ly-do').oninput = nlCapNhatLuu; $('nl-luu').onclick = nlLuu; $('nl-bo').onclick = nlBo
  nlCapNhatLuu()
  const { data: ml } = await sb.from('moc_lich').select('ma,so_tuan')
  NL.ml.dong_bang = (ml || []).find(x => x.ma === 'dong_bang')?.so_tuan ?? 0
  NL.ml.vung_chac = (ml || []).find(x => x.ma === 'vung_chac')?.so_tuan ?? 0
  veNLVung(); await veNLLichSu()
}
function veNLBang() {
  const th = '<tr><th>Tổ</th><th class="num">Số người</th><th class="num">Giờ/ngày</th><th class="num">Ngày/tuần</th><th class="num">Hệ số hữu ích</th><th class="num">= Giờ/tuần</th></tr>'
  let tP = 0, tG = 0
  const body = NL.rows.map((r, i) => {
    const gt = nlGioTuan(r); tP += r.so_nguoi; tG += gt
    const inp = (f, step, mx) => `<input type="number" min="0"${mx ? ' max="' + mx + '"' : ''} step="${step}" data-i="${i}" data-f="${f}" value="${r[f]}">`
    // chip "chưa xác nhận" + nút "Số này đúng" (nl_xac_nhan) — chỉ hiện khi CHƯA xác nhận.
    const chip = r.xac_nhan ? '' : '<span class="nl-chip">chưa xác nhận</span> <button class="nl-xn" data-mt="' + esc(r.ma_to) + '">Số này đúng</button>'
    return `<tr><td>${esc(r.ten)}${chip}</td><td class="num">${inp('so_nguoi', 1)}</td><td class="num">${inp('gio_moi_ngay', 0.5)}</td><td class="num">${inp('ngay_moi_tuan', 1, 7)}</td><td class="num">${inp('he_so', 0.01, 1)}</td><td class="num"><span class="nl-o-doc" id="nl-gt-${i}">${gt}</span></td></tr>`
  }).join('')
  // dòng Tổng: giờ/tuần cộng SỐ THÔ rồi làm tròn (KHÔNG cộng 7 số đã làm tròn) — sửa 2217,5 → 2217,6.
  const tongGtTho = () => Math.round(NL.rows.reduce((s, r) => s + r.so_nguoi * r.gio_moi_ngay * r.ngay_moi_tuan * r.he_so, 0) * 10) / 10
  $('nl-bang').innerHTML = th + body + `<tr class="nl-tong"><td>Tổng</td><td class="num" id="nl-tong-ng">${tP}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num" id="nl-tong-gt">${tongGtTho()}</td></tr>`
  $('nl-bang').querySelectorAll('input').forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.i, f = inp.dataset.f; NL.rows[i][f] = +inp.value || 0
    $('nl-gt-' + i).textContent = nlGioTuan(NL.rows[i])
    let tp = 0; NL.rows.forEach(r => { tp += r.so_nguoi })
    $('nl-tong-ng').textContent = tp; $('nl-tong-gt').textContent = tongGtTho()
    nlCapNhatLuu()
  })
  $('nl-bang').querySelectorAll('.nl-xn').forEach(b => b.onclick = () => nlXacNhan(b.dataset.mt))
}
// "Số này đúng" — đồng ý số đang có (nl_xac_nhan, KHÔNG tách khoảng). Reload → chip+nút dòng đó biến mất.
async function nlXacNhan(ma_to) {
  $('nl-loi-luu').style.display = 'none'
  const { error } = await sb.rpc('nl_xac_nhan', { p_ma_to: ma_to })
  if (error) { $('nl-loi-luu').style.display = ''; $('nl-loi-luu').textContent = 'Xác nhận ' + ma_to + ': ' + error.message; return }
  bao('Đã xác nhận số của tổ'); await taiNangLuc()
}
function nlBo() { NL.rows.forEach(r => { const g = NL.goc[r.ma_to]; if (g) Object.assign(r, g) }); veNLBang(); $('nl-ly-do').value = ''; $('nl-loi-luu').style.display = 'none'; nlCapNhatLuu() }
async function nlLuu() {
  const doi = nlDoi(), tu = $('nl-tu-ngay').value, ly = ($('nl-ly-do').value || '').trim()
  if (!doi.length || ly.length < 5 || !tu) return
  $('nl-luu').disabled = true; $('nl-loi-luu').style.display = 'none'
  for (const r of doi) {
    const { error } = await sb.rpc('nl_ghi', { p_ma_to: r.ma_to, p_so_nguoi: r.so_nguoi, p_gio_moi_ngay: r.gio_moi_ngay, p_ngay_moi_tuan: r.ngay_moi_tuan, p_he_so: r.he_so, p_tu_ngay: tu, p_ly_do: ly })
    if (error) { $('nl-loi-luu').style.display = ''; $('nl-loi-luu').textContent = 'Tổ ' + r.ma_to + ': ' + error.message; nlCapNhatLuu(); return }
  }
  bao('Đã lưu năng lực mới cho ' + doi.length + ' tổ'); await taiNangLuc()
}
function veNLVung() {
  const db = NL.ml.dong_bang, vc = NL.ml.vung_chac
  if (nlLaCeo()) {
    $('nl-vung-so').innerHTML = '<div class="nl-fld"><label>Đóng băng</label><div class="nl-so-o"><input type="number" min="0" max="8" id="nl-db" value="' + db + '"><span>tuần</span></div></div>' +
      '<div class="nl-fld"><label>Vùng chắc</label><div class="nl-so-o"><input type="number" min="0" max="8" id="nl-vc" value="' + vc + '"><span>tuần</span></div></div>' +
      '<button class="nl-nut" id="nl-vung-luu">Lưu vùng khoá</button>'
    const live = () => veNLDai(+$('nl-db').value || 0, +$('nl-vc').value || 0)
    $('nl-db').oninput = live; $('nl-vc').oninput = live; $('nl-vung-luu').onclick = nlLuuVung
  } else {
    $('nl-vung-so').innerHTML = '<div class="nl-fld"><label>Đóng băng</label><div class="nl-vung-chi"><b>' + db + '</b> tuần</div></div>' +
      '<div class="nl-fld"><label>Vùng chắc</label><div class="nl-vung-chi"><b>' + vc + '</b> tuần</div></div>'
  }
  veNLDai(db, vc)
}
function veNLDai(db, vc) {
  let h = ''
  for (let i = 0; i < 6; i++) {
    const cls = i < db ? 'nl-dai-do' : (i < db + vc ? 'nl-dai-vang' : 'nl-dai-xanh')
    const lb = i < db ? 'đóng băng' : (i < db + vc ? 'cần lý do' : 'thoải mái')
    h += '<div class="nl-dai-o ' + cls + '">Tuần ' + (i + 1) + '<br>' + lb + '</div>'
  }
  $('nl-dai').innerHTML = h
}
async function nlLuuVung() {
  $('nl-vung-loi').style.display = 'none'
  const { error } = await sb.rpc('moc_lich_ghi', { p_dong_bang: +$('nl-db').value || 0, p_vung_chac: +$('nl-vc').value || 0 })
  if (error) { $('nl-vung-loi').style.display = ''; $('nl-vung-loi').textContent = error.message; return }
  bao('Đã lưu vùng khoá lịch'); await taiNangLuc()
}
async function veNLLichSu() {
  const { data, error } = await sb.from('nang_luc_to').select('ma_to,tu_ngay,den_ngay,so_nguoi,sua_boi,ly_do').order('tu_ngay', { ascending: false }).limit(10)
  if (error) { $('nl-lichsu').innerHTML = '<tr><td class="nl-loi">' + esc(error.message) + '</td></tr>'; return }
  const ids = [...new Set((data || []).map(r => r.sua_boi).filter(Boolean))]
  let ten = {}
  if (ids.length) { const { data: nd } = await sb.from('nguoi_dung').select('id,ho_ten').in('id', ids); (nd || []).forEach(u => { ten[u.id] = u.ho_ten }) }
  const tenTo = Object.fromEntries(TL_TO)
  const th = '<tr><th>Khoảng ngày</th><th>Tổ</th><th class="num">Số người</th><th>Người sửa</th><th>Lý do</th></tr>'
  const body = (data || []).map(r => `<tr><td>${r.tu_ngay}${r.den_ngay ? ' → ' + r.den_ngay : ' → nay'}</td><td>${esc(tenTo[r.ma_to] || r.ma_to)}</td><td class="num">${r.so_nguoi}</td><td>${esc(ten[r.sua_boi] || (r.sua_boi ? r.sua_boi.slice(0, 8) + '…' : '— seed'))}</td><td>${esc(r.ly_do || '—')}</td></tr>`).join('')
  $('nl-lichsu').innerHTML = th + body
}

async function taiTaiLich() {
  const ky = +$('tl-ky').value
  const tu = isoHomNay(), den = isoCong(tu, ky * 7)
  const [{ data: g, error: eg }, { data: sv }] = await Promise.all([
    sb.rpc('tai_theo_to_tuan', { p_tu_ngay: tu, p_den_ngay: den }),
    sb.rpc('tl_so_viec_luoi', { p_tu: tu, p_den: den })
  ])
  if (eg) { $('tl-luoi').innerHTML = '<div class="tl-rong">Lỗi tải lịch: ' + esc(eg.message) + '</div>'; return }
  TL.tuan = g.tuan || []; TL.o = {}; TL.vung = {}; TL.quaTai = 0
  ;(g.o || []).forEach(c => { TL.o[c.ma_to + '|' + c.tuan_bat_dau] = c; TL.vung[c.tuan_bat_dau] = c.vung; if (c.thieu_thua != null && c.thieu_thua < 0) TL.quaTai++ })
  TL.sv = {}; (sv || []).forEach(r => { TL.sv[r.ma_to + '|' + r.tuan_bat_dau] = r.so_viec })
  if ($('tl-loc-to').options.length <= 1) $('tl-loc-to').innerHTML = '<option value="">Mọi tổ</option>' + TL_TO.map(t => `<option value="${t[0]}">${esc(t[1])}</option>`).join('')
  await veDonTL(1)
  veLuoiTL(); veBangTL(); $('tl-bung').innerHTML = ''; TL.oMo = null
  // [WP-47] dải vàng: còn tổ nào chưa xác nhận năng lực → ngày giao đang tính bằng số đặt tạm
  const cb = $('tl-nl-canhbao'); if (cb) {
    const { data: nlds } = await sb.rpc('nl_ds')
    const chua = (nlds || []).filter(t => t && t.xac_nhan === false).length
    if (chua > 0) {
      cb.style.display = ''; cb.innerHTML = '⚠ <b>Năng lực tổ chưa ai xác nhận</b> (' + chua + ' tổ) — ngày giao đang tính bằng số đặt tạm. <a id="tl-nl-link">Sang màn Năng lực tổ →</a>'
      const lk = $('tl-nl-link'); if (lk) lk.onclick = () => di('nlt')
    } else cb.style.display = 'none'
  }
  // [WP-43] dải ĐỎ (trên dải vàng): đơn đã bàn giao nhưng máy chưa xếp được vào lịch
  const db = $('tl-don-canhbao'); if (db) {
    const { data: dcx } = await sb.rpc('tl_don_chua_xep')
    const ds = dcx || []
    if (ds.length) {
      db.style.display = ''
      db.innerHTML = '⚠ <b>' + ds.length + ' đơn đã bàn giao nhưng chưa vào được lịch</b>'
        + '<div class="tl-dcx-ds">' + ds.map(d =>
          '<div class="tl-dcx-h"><div class="tl-dcx-t"><b>' + esc(d.ma_don) + '</b>'
          + (d.ten_khach ? ' <span>· ' + esc(d.ten_khach) + '</span>' : '')
          + '<small>' + esc(d.ly_do || 'chưa rõ lý do') + '</small></div>'
          + '<button class="tl-nut-vien" data-ketxep="' + esc(d.ma_don) + '" data-ketmota="' + esc(d.ma_don + (d.ten_khach ? ' · ' + d.ten_khach : '')) + '" data-kethen="' + esc(d.ngay_hen_khach || '') + '">Xếp lại đơn</button></div>').join('')
        + '</div>'
      db.querySelectorAll('[data-ketxep]').forEach(b => b.onclick = () => moKetXep(b.dataset.ketxep, b.dataset.ketmota, b.dataset.kethen))
    } else db.style.display = 'none'
  }
}

function veBangTL() {
  const d = TL.dem || {}
  const o = (mau, so, ten, mo, fn) => `<button class="tl-xu-o ${so ? mau : ''}" data-fn="${fn}"><p>${ten}</p><b>${so}</b><small>${mo}</small></button>`
  $('tl-bang').innerHTML =
    o('tl-do', TL.quaTai, 'Ô tổ quá tải', 'tổ làm không kịp trong tuần', 'quatai') +
    o('tl-do', d.dem_tre || 0, 'Đơn sắp trễ hẹn', 'lịch xong sau ngày hẹn khách', 'tre') +
    o('tl-vang', d.dem_thu_tu || 0, 'Đơn sai thứ tự bước', 'bước sau xếp trước bước trước', 'thu_tu') +
    o('tl-vang', d.dem_dung || 0, 'Đơn đứng yên >3 ngày', 'chưa ai quét gì', 'dung') +
    o('tl-xanh', d.dem_thieu || 0, 'Đơn thiếu số đơn vị', 'chưa tính được giờ', 'thieu')
  $('tl-so-don').textContent = d.dem_tat || 0
  document.querySelectorAll('#tl-bang .tl-xu-o').forEach(b => b.onclick = () => tlLocNhanh(b.dataset.fn))
}

function tlLocNhanh(fn) {
  if (fn === 'quatai') {
    let worst = null
    Object.values(TL.o).forEach(c => { if (c.thieu_thua != null && c.thieu_thua < 0 && (!worst || c.thieu_thua < worst.thieu_thua)) worst = c })
    if (!worst) { bao('Không ô nào quá tải trong kỳ này'); return }
    moOTL(worst.ma_to, worst.tuan_bat_dau)
    setTimeout(() => { const b = $('tl-bung'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 60)
    return
  }
  $('tl-loc-van').value = fn; $('tl-loc-to').value = ''; $('tl-tim').value = ''; veDonTL(1)
  $('s-tl').querySelectorAll('.tl-the')[1].scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function veLuoiTL() {
  const sT = TL.tuan.length, cols = '150px repeat(' + sT + ',1fr)'
  let h = '<div class="tl-l-dau" style="grid-template-columns:' + cols + '"><div class="tl-goc">' + (TL.truc === 'to' ? 'Tổ' : 'Đơn') + '</div>'
  TL.tuan.forEach(t => { const vg = TL.vung[t] || 'mo'; h += `<div class="tl-tuan tl-vg-${vg}${vg === 'dong_bang' ? ' tl-db' : ''}"><b>${dmy(t)}</b><em>${TL_NHAN_VUNG[vg]}</em></div>` })
  h += '</div>'
  if (TL.truc === 'to') {
    TL_TO.forEach(([ma, ten]) => {
      const nl = firstNL(ma)
      h += '<div class="tl-l-hang" style="grid-template-columns:' + cols + '"><div class="tl-l-ten"><b>' + ten + '</b><small>' + (nl != null ? Math.round(nl) + ' giờ/tuần' : 'chưa có năng lực') + '</small></div>'
      TL.tuan.forEach(t => {
        const c = TL.o[ma + '|' + t] || {}, g = c.tong_tai || 0, cap = c.nang_luc
        const pct = cap ? Math.round(g / cap * 100) : 0
        const cls = g === 0 ? 'tl-g-trong' : (c.thieu_thua != null && c.thieu_thua < 0 ? 'tl-g-qua' : (pct >= 85 ? 'tl-g-gan' : 'tl-g-vua'))
        const vg = TL.vung[t] || 'mo', nsv = TL.sv[ma + '|' + t] || 0
        const coMts = g === 0 && vg === 'mo'
        h += '<div class="tl-l-o' + (vg === 'dong_bang' ? ' tl-db' : '') + '">'
          + `<button class="tl-o-gop ${cls}" data-to="${ma}" data-tuan="${t}">`
          + '<span class="tl-gio">' + (g === 0 ? '—' : Math.round(g)) + '</span>'
          + (g === 0 ? '<span class="tl-pct">trống</span>' : '<span class="tl-pct">' + pct + '%' + (c.thieu_thua < 0 ? ' · thiếu ' + Math.round(-c.thieu_thua) + 'g' : '') + '</span>')
          + '<span class="tl-muc"><i style="width:' + Math.min(100, pct) + '%"></i></span>'
          + (g === 0 ? '' : '<span class="tl-sv">' + nsv + ' việc</span>')
          + (coMts ? '<span class="tl-o-mts">+ hàng sẵn</span>' : '')
          + '</button></div>'
      })
      h += '</div>'
    })
  } else {
    const ds = TL.don.slice(0, 15)
    if (!ds.length) h += '<div class="tl-l-hang" style="grid-template-columns:1fr"><div style="padding:22px;text-align:center;color:var(--chu-nhat)">Không đơn nào có vấn đề. Xoá bộ lọc để xem lại.</div></div>'
    ds.forEach(d => {
      h += '<div class="tl-l-hang" style="grid-template-columns:1fr auto"><div class="tl-l-ten"><b>' + esc(d.ma_don) + '</b><small>' + esc(d.ten_khach || '(không tên)') + ' · hẹn ' + (d.ngay_hen_khach ? dmy(d.ngay_hen_khach) : '—') + '</small></div>'
        + '<div class="tl-l-o" style="display:flex;align-items:center;padding:8px 14px">' + (xepDuoc() ? '<button class="tl-nut-vien" data-xep="' + esc(d.ma_don) + '">Xếp lại cả đơn</button>' : '') + '</div></div>'
    })
    if (TL.tongDon > 15) h += '<div class="tl-l-hang" style="grid-template-columns:1fr"><div style="padding:12px 18px;font-size:13px;color:var(--chu-nhat)">Hiện 15 đơn đầu trong ' + TL.tongDon + '. Dùng bộ lọc bên dưới để thu hẹp.</div></div>'
  }
  $('tl-luoi').innerHTML = h
  $('tl-luoi').querySelectorAll('.tl-o-gop').forEach(b => b.onclick = () => moOTL(b.dataset.to, b.dataset.tuan))
  $('tl-luoi').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepCaDon(b.dataset.xep))
  $('tl-nhac').innerHTML = TL.quaTai
    ? '<div class="tl-nhac"><b>' + TL.quaTai + ' ô quá tải</b>Bấm ô đỏ để xem việc bên trong. Đơn khách → "Xếp lại đơn" (máy tính cả chuỗi). Hàng làm sẵn → "Dời" tay.</div>'
    : '<div class="tl-nhac tl-xanh"><b>Không ô nào quá tải</b>Mọi tổ còn chỗ trong kỳ này.</div>'
}
function firstNL(ma) { for (const t of TL.tuan) { const c = TL.o[ma + '|' + t]; if (c && c.nang_luc != null) return c.nang_luc } return null }

function tlDoiTruc(t) {
  TL.truc = t; TL.oMo = null; $('tl-bung').innerHTML = ''
  $('tl-bt-to').classList.toggle('tl-chon', t === 'to'); $('tl-bt-don').classList.toggle('tl-chon', t === 'don')
  veLuoiTL()
}

async function moOTL(maTo, tuan) { TL.oMo = { to: maTo, tuan, n: 12 }; await veBungTL() }
async function veBungTL() {
  if (!TL.oMo) { $('tl-bung').innerHTML = ''; return }
  const { to, tuan, n } = TL.oMo
  const { data, error } = await sb.rpc('tl_viec_trong_o', { p_ma_to: to, p_tuan_bat_dau: tuan, p_gioi_han: n, p_bo_qua: 0 })
  if (error) { $('tl-bung').innerHTML = '<div class="tl-bung"><div class="tl-rong">' + esc(error.message) + '</div></div>'; return }
  const rows = data || [], tong = rows.length ? Number(rows[0].tong_so) : 0
  const c = TL.o[to + '|' + tuan] || {}
  let h = '<div class="tl-bung"><div class="tl-bung-dau"><b>' + esc(TL_TEN_TO[to] || to) + ' · tuần ' + dmy(tuan) + '</b><span>'
    + Math.round(c.tong_tai || 0) + '/' + (c.nang_luc != null ? Math.round(c.nang_luc) : '—') + ' giờ · ' + tong + ' việc' + (c.thieu_thua < 0 ? ' · thiếu ' + Math.round(-c.thieu_thua) + ' giờ' : '') + '</span></div>'
  rows.forEach(v => {
    const lms = v.la_hang_lam_san
    h += '<div class="tl-bv' + (lms ? ' tl-mts' : '') + (v.don_sap_tre ? ' tl-tre' : '') + '">'
      + '<div class="tl-ma">' + (lms ? 'làm sẵn' : esc(v.ma_don))
        + (v.khoa_lich_luc ? ' <span class="tl-khoa" title="Đơn đã bàn giao xưởng, lịch đã chốt">🔒 đã bàn giao · lịch đã chốt · ' + dmy(v.khoa_lich_luc) + '</span>' : '') + '</div>'
      + '<div class="tl-ten">' + esc(lms ? v.ten_san_pham : (v.ten_khach || '(không tên)') + ' · ' + v.ten_san_pham) + '</div>'
      + '<div class="tl-b"><span class="tl-stt">' + v.buoc_thu_tu + '</span>' + esc(tlLabel(v.ten_buoc)) + '</div>'
      + '<div class="tl-g">' + Number(v.gio).toFixed(1) + 'g</div>'
      + '<div class="tl-n">' + (xepDuoc() ? '<button data-xep="' + esc(v.ma_don) + '">Xếp lại cả đơn</button>' : '') + '</div>'
      + '</div>'
  })
  if (tong > rows.length) h += '<div class="tl-bung-them"><button id="tl-them">Xem thêm ' + Math.min(20, tong - rows.length) + ' việc (còn ' + (tong - rows.length) + ')</button></div>'
  h += '</div>'
  $('tl-bung').innerHTML = h
  $('tl-bung').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepCaDon(b.dataset.xep))
  if ($('tl-them')) $('tl-them').onclick = () => { TL.oMo.n += 20; veBungTL() }
}

async function veDonTL(tr) {
  TL.trangDon = tr || TL.trangDon
  const loai = $('tl-loc-van').value, to = $('tl-loc-to').value, tim = $('tl-tim').value || ''
  const { data, error } = await sb.rpc('tl_don_co_van_de', { p_loai: loai, p_ma_to: to || null, p_tim: tim || null, p_gioi_han: TL_MOI, p_bo_qua: (TL.trangDon - 1) * TL_MOI })
  if (error) { $('tl-ds-don').innerHTML = '<div class="tl-rong">' + esc(error.message) + '</div>'; return }
  const rows = data || []
  TL.don = rows; TL.tongDon = rows.length ? Number(rows[0].tong_so) : 0
  TL.dem = rows.length ? rows[0] : (TL.dem || {})
  if (!rows.length) {
    // vẫn cần dem khi trang rỗng: gọi lại trang 0
    const { data: d0 } = await sb.rpc('tl_don_co_van_de', { p_loai: 'tat', p_ma_to: null, p_tim: null, p_gioi_han: 1, p_bo_qua: 0 })
    TL.dem = (d0 && d0[0]) || { dem_tat: 0, dem_tre: 0, dem_thu_tu: 0, dem_dung: 0, dem_thieu: 0 }
  }
  const nhan = { tre: 'sắp trễ', thu_tu: 'sai thứ tự', dung: 'đứng yên', thieu: 'thiếu số' }
  let h = ''
  if (!TL.tongDon) h = '<div class="tl-rong"><b>Không đơn nào khớp</b>Đổi bộ lọc hoặc xoá ô tìm kiếm.</div>'
  rows.forEach(d => {
    const van = (d.loai_van_de || []).map(v => `<span class="tl-van tl-van-${v}">${nhan[v] || v}</span>`).join(' ')
    h += '<div class="tl-dv"><div class="tl-ma">' + esc(d.ma_don) + '</div>'
      + '<div class="tl-kh">' + esc(d.ten_khach || '(không tên)') + '</div>'
      + '<div class="tl-han">' + (d.ngay_hen_khach ? dmy(d.ngay_hen_khach) : '—') + '</div>'
      + '<div>' + van + '</div><div class="tl-chi">' + esc(d.chi_tiet || '') + '</div>'
      + '<div class="tl-n">' + (xepDuoc() ? '<button data-xep="' + esc(d.ma_don) + '">Xếp lại cả đơn</button>' : '') + '</div></div>'
  })
  $('tl-ds-don').innerHTML = h
  $('tl-ds-don').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepCaDon(b.dataset.xep))
  $('tl-mota-don').textContent = 'Chỉ hiện đơn có vấn đề. ' + (TL.dem.dem_tat || 0) + ' đơn cần nhìn.'
  const soTr = Math.max(1, Math.ceil(TL.tongDon / TL_MOI))
  let t = ''
  if (TL.tongDon > TL_MOI) t = '<div class="tl-trang"><span>' + ((TL.trangDon - 1) * TL_MOI + 1) + '–' + Math.min(TL.trangDon * TL_MOI, TL.tongDon) + ' trong ' + TL.tongDon + ' đơn</span><div class="tl-nut">'
    + '<button id="tl-dtruoc"' + (TL.trangDon <= 1 ? ' disabled' : '') + '>Trước</button><button id="tl-dsau"' + (TL.trangDon >= soTr ? ' disabled' : '') + '>Sau</button></div></div>'
  else if (TL.tongDon) t = '<div class="tl-trang"><span>' + TL.tongDon + ' đơn</span><div class="tl-nut"></div></div>'
  $('tl-trang-don').innerHTML = t
  if ($('tl-dtruoc')) $('tl-dtruoc').onclick = () => veDonTL(TL.trangDon - 1)
  if ($('tl-dsau')) $('tl-dsau').onclick = () => veDonTL(TL.trangDon + 1)
  if (TL.truc === 'don') veLuoiTL()
  if (TL.tuan.length) veBangTL()
}

// [WP-45 L-20] Đã gỡ moXepTL + hộp xem-trước #tl-hop-xep (thay bằng moXepCaDon).
//   RPC tl_xep_thu (xem trước lịch) GIỮ trong DB — xem PHÁT SINH: "xem trước lịch đã mất đường vào UI".

// ══════════ XẾP LẠI ĐƠN CHƯA VÀO ĐƯỢC LỊCH (WP-43 · từ dải đỏ) ══════════
function moKetXep(maDon, mota, hen) {
  TL.ketDon = maDon; TL.ketHen = hen || null   // có hẹn → kiểu 'nguoc' · không hẹn → 'xuoi' (giống ban_giao_xuong)
  $('tl-ket-mota').textContent = mota || maDon
  $('tl-ket-canh').innerHTML = ''
  $('tl-ket-ceo').style.display = 'none'
  $('tl-ket-canceo').style.display = 'none'
  $('tl-ket-lydo').value = ''
  $('tl-ket-ep').style.display = 'none'; $('tl-ket-ep').disabled = true
  const xep = $('tl-ket-xep'); xep.style.display = ''; xep.disabled = false
  $('tl-hop-ket').classList.add('tl-mo')
}
// MỘT lần gọi. Kiểu chọn theo DỮ LIỆU (giống ban_giao_xuong): có hẹn → 'nguoc' · không hẹn → 'xuoi'.
//   RPC từ chối (đóng băng…) thì trả nguyên văn — KHÔNG thử lại kiểu khác (đổi kiểu im lặng = giấu tin).
async function tlKetGoi(ngoaiLe, lyDo) {
  const kieu = TL.ketHen ? 'nguoc' : 'xuoi'
  return await sb.rpc('luu_xep_lich', { p_ma_don: TL.ketDon, p_kieu: kieu, p_ngoai_le: ngoaiLe, p_ly_do: lyDo || null })
}
async function tlKetXong(r) {
  const ma = TL.ketDon
  tlDong('tl-hop-ket')
  await taiTaiLich()
  bao('✓ Đã xếp lại ' + ma + ' · ' + ((r && r.so_dong) || 0) + ' bước')
}
// hiện NGUYÊN VĂN lý do RPC (chỉ bỏ tiền tố tên hàm). Đóng băng → ceo: mở ô lý do + nút Ép; xuong: chỉ báo "cần CEO".
function tlKetLoi(msg) {
  const ly = String(msg || '').replace(/^luu_xep_lich:\s*/, '')
  $('tl-ket-canh').innerHTML = '<div class="tl-canh"><b>Chưa xếp được</b>' + esc(ly) + '</div>'
  $('tl-ket-xep').style.display = 'none'
  if (/đóng băng/i.test(ly)) {
    if (tlLaCeo()) { $('tl-ket-ceo').style.display = ''; $('tl-ket-ep').style.display = ''; $('tl-ket-ep').disabled = true; $('tl-ket-lydo').focus() }
    else $('tl-ket-canceo').style.display = ''
  }
}
async function tlKetXep() {
  $('tl-ket-xep').disabled = true
  const { data: r, error } = await tlKetGoi(false, null)
  if (error) return tlKetLoi(error.message)
  if (r && r.ok) return tlKetXong(r)
  tlKetLoi((r && r.loi) || 'máy không xếp nổi')
}
async function tlKetEp() {
  const ly = $('tl-ket-lydo').value.trim()
  if (ly.length < 5) return
  $('tl-ket-ep').disabled = true
  const { data: r, error } = await tlKetGoi(true, ly)
  if (error) { $('tl-ket-canh').innerHTML = '<div class="tl-canh"><b>Không ép được</b>' + esc(String(error.message).replace(/^luu_xep_lich:\s*/, '')) + '</div>'; $('tl-ket-ep').disabled = false; return }
  if (r && r.ok) return tlKetXong(r)
  $('tl-ket-canh').innerHTML = '<div class="tl-canh"><b>Không ép được</b>' + esc((r && r.loi) || 'máy không xếp nổi') + '</div>'
  $('tl-ket-ep').disabled = false
}

// ══════════ XẾP LẠI CẢ ĐƠN (WP-45 · thay dời-lẻ) — kiểu theo dữ liệu + hai hàng rào ══════════
//   Bỏ dời lẻ một bước: lịch xếp theo CẢ CHUỖI bước, dời lẻ làm các bước sau đứng sai thứ tự.
async function moXepCaDon(maDon) {
  TL.xlDon = maDon; TL.xlHen = null; TL.xlSX = false; TL.xlXem = null; TL.xlXemOk = false
  $('tl-xl-mota').textContent = maDon
  $('tl-xl-canh').innerHTML = ''; $('tl-xl-lydo').value = ''
  $('tl-xl-xemtruoc').innerHTML = '<div class="tl-xl-dang">Đang xem trước lịch…</div>'
  $('tl-xl-lybox').style.display = 'none'; $('tl-xl-xep').disabled = true
  $('tl-hop-xl').classList.add('tl-mo')
  const { data: m, error } = await sb.rpc('don_lich_meta', { p_ma_don: maDon })
  if (error || !m || m.loi) { $('tl-xl-xemtruoc').innerHTML = ''; $('tl-xl-canh').innerHTML = '<div class="tl-canh"><b>Lỗi</b>' + esc((error && error.message) || (m && m.loi) || '') + '</div>'; return }
  TL.xlHen = m.ngay_hen_khach || null           // có hẹn → nguoc · không hẹn → xuoi (cùng luật luu_xep_lich)
  TL.xlSX = !!m.da_san_xuat                      // từ cho_cat trở đi → planning fence: bắt buộc lý do
  if (TL.xlSX) $('tl-xl-lybox').style.display = ''
  await tlXlXemTruoc()
}
// Bước 1 — XEM TRƯỚC (tl_xep_thu). Hỏng → nguyên văn, Lưu KHÔNG sáng. Không đoán hộ, không thử kiểu khác.
async function tlXlXemTruoc() {
  const kieu = TL.xlHen ? 'nguoc' : 'xuoi'
  TL.xlXem = null; TL.xlXemOk = false
  const { data: r, error } = await sb.rpc('tl_xep_thu', { p_ma_don: TL.xlDon, p_tuan_giao: null, p_kieu: kieu, p_ngoai_le: false })
  if (error) { $('tl-xl-xemtruoc').innerHTML = '<div class="tl-canh"><b>Chưa xem trước được</b>' + esc(String(error.message).replace(/^.*tl_xep_thu:\s*/, '')) + '</div>'; tlXlDoiNut(); return }
  if (!r || r.ok === false) { $('tl-xl-xemtruoc').innerHTML = '<div class="tl-canh"><b>Máy không xếp nổi</b>' + esc((r && r.loi) || '') + '</div>'; tlXlDoiNut(); return }
  const lich = r.lich || []
  const batdau = lich.map(x => x.tuan_moi).filter(Boolean).sort()[0]
  const dongbang = (r.khong_xep_noi || []).filter(k => /đóng băng/i.test(k.ly_do || ''))
  TL.xlXem = { batdau, ketthuc: r.xong_tuan, soBuoc: lich.length, kieu }
  TL.xlXemOk = dongbang.length === 0
  let h = '<div class="tl-xl-xt">'
    + '<div class="tl-xl-r"><span>Số bước</span><b>' + lich.length + ' bước</b></div>'
    + '<div class="tl-xl-r"><span>Tuần bắt đầu → kết thúc</span><b>' + (batdau ? dmy(batdau) : '—') + ' → ' + (r.xong_tuan ? dmy(r.xong_tuan) : '—') + '</b></div>'
  if (TL.xlHen) { const tre = r.xong_sau_hen_ngay; h += '<div class="tl-xl-r"><span>So với hẹn khách</span><b class="' + (tre > 0 ? 'tl-xau' : 'tl-tot') + '">' + (tre > 0 ? 'TRỄ ' + tre + ' ngày' : 'kịp hẹn') + '</b></div>' }
  h += '</div>'
  h += dongbang.length
    ? '<div class="tl-canh"><b>' + dongbang.length + ' bước rơi tuần ĐÓNG BĂNG</b>' + dongbang.map(k => esc(tlLabel(k.hoat_dong))).join(' · ') + ' — cần CEO mở ngoại lệ, không lưu thẳng được.</div>'
    : '<div class="tl-canh tl-xanh"><b>Xếp được</b>Mọi bước đúng thứ tự, không tổ nào vượt năng lực.</div>'
  $('tl-xl-xemtruoc').innerHTML = h
  tlXlDoiNut()
}
// Lưu chỉ sáng khi: đã XEM TRƯỚC OK (không đóng băng) + (không phải SX hoặc lý do ≥5). Không cho bấm mù.
function tlXlDoiNut() {
  const lyOk = !TL.xlSX || $('tl-xl-lydo').value.trim().length >= 5
  $('tl-xl-xep').disabled = !(TL.xlXemOk && lyOk)
}
// Bước 2 — LƯU (luu_xep_lich) + ■2 kiểm xem-trước KHỚP kết quả lưu.
async function tlXlXep() {
  if (!TL.xlXem || !TL.xlXemOk) return
  const kieu = TL.xlHen ? 'nguoc' : 'xuoi'
  const lyDo = TL.xlSX ? $('tl-xl-lydo').value.trim() : null
  if (TL.xlSX && (!lyDo || lyDo.length < 5)) return
  $('tl-xl-xep').disabled = true
  const { data: r, error } = await sb.rpc('luu_xep_lich', { p_ma_don: TL.xlDon, p_kieu: kieu, p_ngoai_le: false, p_ly_do: lyDo })
  if (error) { $('tl-xl-canh').innerHTML = '<div class="tl-canh"><b>Chưa xếp được</b>' + esc(String(error.message).replace(/^.*luu_xep_lich:\s*/, '')) + '</div>'; tlXlDoiNut(); return }
  if (r && r.ok === false) { $('tl-xl-canh').innerHTML = '<div class="tl-canh"><b>Máy không xếp nổi</b>' + esc(r.ly_do || r.loi || '') + '</div>'; tlXlDoiNut(); return }
  // ■2 · so tuần bắt đầu ĐÃ LƯU (đọc xep_lich) với tuần XEM TRƯỚC
  const { data: rows } = await sb.from('xep_lich').select('tuan_bat_dau').eq('ma_don', TL.xlDon).order('tuan_bat_dau', { ascending: true }).limit(1)
  const luuBatDau = rows && rows[0] ? String(rows[0].tuan_bat_dau).slice(0, 10) : null
  const xemBatDau = TL.xlXem.batdau ? String(TL.xlXem.batdau).slice(0, 10) : null
  const ma = TL.xlDon
  if (luuBatDau && xemBatDau && luuBatDau !== xemBatDau) {
    console.error('[Xếp lại đơn] XEM TRƯỚC ≠ LƯU · đơn=' + ma + ' · xem trước=' + xemBatDau + ' · đã lưu=' + luuBatDau)
    $('tl-xl-canh').innerHTML = '<div class="tl-canh"><b>⚠ Xem trước và kết quả lưu KHÔNG khớp</b>Xem trước bắt đầu ' + dmy(xemBatDau) + ' · đã lưu ' + dmy(luuBatDau) + '. Lịch đã ghi theo số THẬT — báo kỹ thuật.</div>'
    await taiTaiLich()
    bao('⚠ Đã lưu nhưng xem trước không khớp — xem cảnh báo', true)
    return   // GIỮ hộp mở để người thấy cảnh báo đỏ
  }
  tlDong('tl-hop-xl')
  await taiTaiLich()
  bao('✓ Đã xếp lại ' + ma + ' · ' + ((r && r.so_dong) || 0) + ' bước')
}

function tlDong(id) { $(id).classList.remove('tl-mo') }

// WP-32: phơi mở màn đơn cho robot/kiểm mắt (như __sb) — không đổi hành vi người dùng.
window.moDon = moDon; window.moMon = moMon; window.veBfToast = veBfToast;
