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
  if (USER.vai_tro === 'tho') { $('n-qd').style.display = 'none'; $('d-qd').style.display = 'none'; $('n-tl').style.display = 'none'; $('d-tl').style.display = 'none'; $('n-nl').style.display = 'none'; $('d-nl').style.display = 'none' }   // tho KHÔNG thấy quản đốc / tải & lịch / nhìn lại (L-74)
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
  if ((m === 'qd' || m === 'tl' || m === 'nl') && USER.vai_tro === 'tho') return
  ;['viec', 'tram', 'tem', 'dem', 'loi', 'qd', 'tl', 'nl'].forEach(k => { $('s-' + k).style.display = (k === m) ? 'block' : 'none'
    $('n-' + k).classList.toggle('chon', k === m); if ($('d-' + k)) $('d-' + k).classList.toggle('chon', k === m) })
  window.scrollTo(0, 0)
  if (m === 'qd') taiQuanDoc()
  if (m === 'tram') taiTram()
  if (m === 'tl') taiTaiLich()
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
async function taiQuanDoc(trang) {
  taiChoVaoChuyen()
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
  vePanel(d, vet || [], tem || [], (fileRes && fileRes.data) || [], gc)
}
const LOAI_FILE = { dxf: '▤ DXF', cutlist: '▦ Cutlist', anh_ban_ve: '🖼 Ảnh bản vẽ', khac: '📄 File' }
async function taiFileXuong(path) {
  const { data } = await sb.storage.from('file-san-xuat').createSignedUrl(path, 3600, { download: true })
  if (data && data.signedUrl) window.open(data.signedUrl, '_blank'); else bao('Không tải được file', true)
}
function vePanel(d, vet, tem, files, gc) {
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
    `<div class="muc"><h3>Phụ kiện</h3><div class="thieu"><b>Chưa có dữ liệu</b>Plugin tính được bản lề, ray, ben hơi nhưng hiện chỉ đẩy số tổng (12 driver), không đẩy chi tiết từng loại. Tổ Lắp ráp vẫn phải tra bản vẽ.</div></div>` +
    // WP-32: giữ chỗ vật tư của đơn (ẩn nếu 0 dòng — nhiệm C)
    (gc.length ? `<div class="muc"><h3>Giữ chỗ · ${gc.length} dòng</h3><table class="xg-gc-tbl"><thead><tr><th>Vật tư</th><th>Nguồn</th><th class="r">Giữ</th><th class="r">Đã xuất</th><th class="r">Còn giữ</th></tr></thead><tbody>${gc.map(g => `<tr><td><span class="xg-gc-ma">${esc(g.ma || '')}</span> ${esc(g.ten || '')}</td><td><span class="xg-gc-src">${esc(g.nguon || '—')}</span></td><td class="r xg-gc-n">${fmt(g.so_luong_giu)}</td><td class="r xg-gc-n">${fmt(g.so_luong_da_xuat)}</td><td class="r xg-gc-n">${fmt(Number(g.so_luong_giu) - Number(g.so_luong_da_xuat))}</td></tr>`).join('')}</tbody></table></div>` : '') +
    `<div class="muc"><h3>Đã qua tay ai</h3>${vet.length ? vet.map(v => `<div class="vet"><span class="luc">${dmyhm(v.luc)}</span><span class="noi">${v.nguoi_ten ? '<b>' + esc(v.nguoi_ten) + '</b> ' : ''}<span>${v.tu ? 'xong ' + esc(BUOC[v.tu] || v.tu).toLowerCase() + ' → ' : ''}${esc(BUOC[v.den] || v.den).toLowerCase()}</span></span></div>`).join('') : '<p style="color:var(--chu-mo);font-size:13.5px">Chưa có vết đổi bước.</p>'}</div>`
  $('pThan').querySelectorAll('[data-taixuong]').forEach(b => b.onclick = () => taiFileXuong(b.dataset.taixuong))
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
let TRAM = null, TRAM_INFO = null, HONG = false, DANG_QUET = false
const TT_TEN = { chay: 'Đang chạy', nghi: 'Nghỉ', hong: 'Máy hỏng', cho_vat_tu: 'Chờ vật tư', ve_sinh: 'Vệ sinh' }
let TT_CHON = 'chay'
const focusO = () => { const o = $('tqO'); if (o && !o.disabled && $('s-tram').style.display === 'block' && !moNaoDangMo()) o.focus() }
const moNaoDangMo = () => $('tqTtPhu').style.display !== 'none' || $('tqBuPhu').style.display !== 'none'

// wiring MỘT LẦN (DOM luôn có)
function setupTram() {
  // giữ con trỏ: blur ô quét mà không có modal → tự về ô
  $('tqO').addEventListener('blur', () => setTimeout(focusO, 40))
  $('tqO').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quetGui($('tqO').value.trim()) } })
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
  if (!data.co_ca) return veMoca()
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
  $('tqNguoi').textContent = t.nguoi_truc || '—'
  veDen(t.trang_thai || 'chay')
  $('tqGhibu').style.display = (USER.vai_tro === 'xuong' || USER.vai_tro === 'ceo') ? '' : 'none'
  $('tqKq').innerHTML = ''
  taiCho(); taiCa(); taiLuot()
  focusO()
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
  DANG_QUET = true
  const hongLan = HONG
  let res, netErr = false
  try {
    const { data, error } = await sb.rpc('tram_quet', { p_tem: ma, p_tram: TRAM, p_so_hong: hongLan ? 1 : 0, p_so_lam_lai: 0 })
    if (error) throw error
    res = data
  } catch (e) { netErr = true }
  $('tqO').value = ''
  DANG_QUET = false
  if (netErr) { veKqMang(ma); focusO(); return }   // KHÔNG hiện xanh, KHÔNG xếp hàng ngầm
  // quét có ghi (nhận/chặn) → tắt nút hỏng (một lần dùng), làm mới các khối
  if (hongLan) { HONG = false; $('tqHong').classList.remove('bat'); $('tqHong').textContent = 'Tấm sau bị hỏng' }
  if (res) res.tem_ma = ma
  veKq(res)
  taiCho(); taiCa(); taiLuot()
  if (res && res.trang_thai) veDen(res.trang_thai)
  focusO()
}

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

function setupTL() {
  if (setupTL._done) return; setupTL._done = true
  $('tl-ky').onchange = taiTaiLich
  document.querySelectorAll('#s-tl .tl-doi-truc button').forEach(b => b.onclick = () => tlDoiTruc(b.dataset.truc))
  $('tl-bt-mts').onclick = () => { TL.hienMts = !TL.hienMts; $('tl-bt-mts').classList.toggle('tl-bat', TL.hienMts); if (TL.oMo) veBungTL() }
  $('tl-loc-van').onchange = () => veDonTL(1)
  $('tl-loc-to').onchange = () => veDonTL(1)
  $('tl-tim').oninput = () => veDonTL(1)
  // hộp xếp lại
  $('tl-xep-x').onclick = $('tl-xep-huy').onclick = () => tlDong('tl-hop-xep')
  $('tl-xep-luu').onclick = tlLuuXep
  document.querySelectorAll('#tl-hop-xep .tl-kieu button').forEach(b => b.onclick = () => { TL.kieuXep = b.dataset.kieu; tlVeKieu(); tlChayThu() })
  $('tl-cb-ngoaile').onchange = () => { tlVeTuanGiao(); tlChayThu() }
  $('tl-hop-xep').addEventListener('click', e => { if (e.target === $('tl-hop-xep')) tlDong('tl-hop-xep') })
  // hộp dời tay
  $('tl-doi-x').onclick = $('tl-doi-huy').onclick = () => tlDong('tl-hop-doi')
  $('tl-doi-luu').onclick = tlLuuDoi
  $('tl-cb-ngoaile2').onchange = tlVeChonTuan
  $('tl-hop-doi').addEventListener('click', e => { if (e.target === $('tl-hop-doi')) tlDong('tl-hop-doi') })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { tlDong('tl-hop-xep'); tlDong('tl-hop-doi') } })
  // ngoại lệ chỉ ceo
  if (!tlLaCeo()) { const a = $('tl-cb-ngoaile').closest('.tl-ongoaile'), b = $('tl-cb-ngoaile2').closest('.tl-ongoaile'); if (a) a.style.display = 'none'; if (b) b.style.display = 'none' }
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
        + '<div class="tl-l-o" style="display:flex;align-items:center;padding:8px 14px"><button class="tl-nut-vien" data-xep="' + esc(d.ma_don) + '">Xếp lại đơn</button></div></div>'
    })
    if (TL.tongDon > 15) h += '<div class="tl-l-hang" style="grid-template-columns:1fr"><div style="padding:12px 18px;font-size:13px;color:var(--chu-nhat)">Hiện 15 đơn đầu trong ' + TL.tongDon + '. Dùng bộ lọc bên dưới để thu hẹp.</div></div>'
  }
  $('tl-luoi').innerHTML = h
  $('tl-luoi').querySelectorAll('.tl-o-gop').forEach(b => b.onclick = () => moOTL(b.dataset.to, b.dataset.tuan))
  $('tl-luoi').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepTL(b.dataset.xep))
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
      + '<div class="tl-ma">' + (lms ? 'làm sẵn' : esc(v.ma_don)) + '</div>'
      + '<div class="tl-ten">' + esc(lms ? v.ten_san_pham : (v.ten_khach || '(không tên)') + ' · ' + v.ten_san_pham) + '</div>'
      + '<div class="tl-b"><span class="tl-stt">' + v.buoc_thu_tu + '</span>' + esc(tlLabel(v.ten_buoc)) + '</div>'
      + '<div class="tl-g">' + Number(v.gio).toFixed(1) + 'g</div>'
      + '<div class="tl-n">' + (lms
        ? '<button data-doi="' + v.viec_id + '">Dời</button>'
        : '<button data-xep="' + esc(v.ma_don) + '">Xếp lại đơn</button>') + '</div>'
      + '</div>'
  })
  if (tong > rows.length) h += '<div class="tl-bung-them"><button id="tl-them">Xem thêm ' + Math.min(20, tong - rows.length) + ' việc (còn ' + (tong - rows.length) + ')</button></div>'
  h += '</div>'
  $('tl-bung').innerHTML = h
  $('tl-bung').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepTL(b.dataset.xep))
  $('tl-bung').querySelectorAll('[data-doi]').forEach(b => b.onclick = () => moDoiTL(+b.dataset.doi))
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
      + '<div class="tl-n"><button data-xep="' + esc(d.ma_don) + '">Xếp lại đơn</button></div></div>'
  })
  $('tl-ds-don').innerHTML = h
  $('tl-ds-don').querySelectorAll('[data-xep]').forEach(b => b.onclick = () => moXepTL(b.dataset.xep))
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

// ══════════ HỘP XẾP LẠI ĐƠN (đường chính) ══════════
async function moXepTL(maDon) {
  const d = TL.don.find(x => x.ma_don === maDon) || {}
  TL.donXep = maDon; TL.kieuXep = 'nguoc'; TL.tuanGiao = null
  $('tl-cb-ngoaile').checked = false
  $('tl-xep-mota').textContent = maDon + (d.ten_khach ? ' · ' + d.ten_khach : '') + (d.ngay_hen_khach ? ' · hẹn ' + dmy(d.ngay_hen_khach) : '')
  tlVeKieu(); tlVeTuanGiao()
  $('tl-hop-xep').classList.add('tl-mo')
  await tlChayThu()
}
function tlVeKieu() { $('tl-xk-nguoc').classList.toggle('tl-chon', TL.kieuXep === 'nguoc'); $('tl-xk-xuoi').classList.toggle('tl-chon', TL.kieuXep === 'xuoi') }
function tlVeTuanGiao() {
  const ngoaiLe = $('tl-cb-ngoaile').checked
  let h = ''
  TL.tuan.forEach(t => {
    const db = (TL.vung[t] === 'dong_bang') && !ngoaiLe
    const chon = TL.tuanGiao === t
    h += `<button class="${chon ? 'tl-chon' : (db ? 'tl-bang' : '')}" data-tg="${t}"${db ? ' disabled' : ''}>${dmy(t)}${TL.vung[t] === 'dong_bang' ? ' 🔒' : ''}</button>`
  })
  $('tl-xep-tuan').innerHTML = h
  $('tl-xep-tuan').querySelectorAll('[data-tg]').forEach(b => b.onclick = () => { TL.tuanGiao = b.dataset.tg; tlVeTuanGiao(); tlChayThu() })
}
async function tlChayThu() {
  const ngoaiLe = $('tl-cb-ngoaile').checked && tlLaCeo()
  const { data: r, error } = await sb.rpc('tl_xep_thu', { p_ma_don: TL.donXep, p_tuan_giao: TL.tuanGiao, p_kieu: TL.kieuXep, p_ngoai_le: ngoaiLe })
  if (error) { $('tl-xep-canh').innerHTML = '<div class="tl-canh"><b>Lỗi</b>' + esc(error.message) + '</div>'; $('tl-xep-luu').disabled = true; return }
  TL.xepKq = r
  if (!r.ok) {
    $('tl-xep-lich').innerHTML = ''; $('tl-xep-tai').innerHTML = ''
    $('tl-xep-canh').innerHTML = '<div class="tl-canh"><b>Máy không xếp nổi</b>' + esc(r.loi || '') + ' — nới kỳ 12 tuần, hoặc tăng ca, hoặc dời đơn khác.</div>'
    $('tl-xep-luu').disabled = true; return
  }
  // lịch từng bước
  $('tl-xep-lich').innerHTML = (r.lich || []).map(v =>
    '<div class="tl-ah-d"><span class="tl-n"><b style="font-weight:600">' + v.thu_tu + '</b> ' + esc(tlLabel(v.hoat_dong)) + ' · ' + esc(v.ten_to || '—') + '</span>'
    + '<span class="tl-v">' + (v.tuan_cu ? dmy(v.tuan_cu) : 'chưa xếp') + (v.doi ? ' → ' + dmy(v.tuan_moi) : ' · giữ') + '</span></div>').join('')
  // tải đổi
  $('tl-xep-tai').innerHTML = (r.tai_doi || []).length
    ? r.tai_doi.map(o => '<div class="tl-ah-d"><span class="tl-n">' + esc(o.ten_to) + ' tuần ' + dmy(o.tuan) + '</span><span class="tl-v ' + (o.vuot ? 'tl-xau' : 'tl-tot') + '">' + Math.round(o.truoc) + ' → ' + Math.round(o.sau) + '/' + (o.nang_luc != null ? Math.round(o.nang_luc) : '—') + ' giờ' + (o.vuot ? ' · VƯỢT' : '') + '</span></div>').join('')
    : '<div class="tl-ah-d"><span class="tl-n">Không tổ nào đổi tải</span><span class="tl-v">—</span></div>'
  // cảnh báo
  let c = ''
  if ((r.khong_xep_noi || []).length) c += '<div class="tl-canh"><b>Không xếp nổi ' + r.khong_xep_noi.length + ' bước</b>' + r.khong_xep_noi.map(k => esc(tlLabel(k.hoat_dong)) + ' (' + esc(k.ly_do) + ')').join(' · ') + '</div>'
  if (r.xong_sau_hen_ngay > 0) c += '<div class="tl-canh"><b>Xong sau hẹn khách ' + (r.xong_sau_hen_ngay) + ' ngày</b>Gọi báo khách trước khi chốt.</div>'
  else if (!(r.khong_xep_noi || []).length) c += '<div class="tl-canh tl-xanh"><b>Xếp được, kịp hẹn</b>Mọi bước đúng thứ tự, không tổ nào vượt năng lực.</div>'
  $('tl-xep-canh').innerHTML = c
  $('tl-xep-luu').disabled = (r.khong_xep_noi || []).length > 0
}
async function tlLuuXep() {
  if (!TL.xepKq || !TL.xepKq.ok || (TL.xepKq.khong_xep_noi || []).length) return
  const ngoaiLe = $('tl-cb-ngoaile').checked && tlLaCeo()
  const { data: r, error } = await sb.rpc('luu_xep_lich', { p_ma_don: TL.donXep, p_kieu: TL.kieuXep, p_ngoai_le: ngoaiLe, p_ly_do: $('tl-xep-lydo').value || null })
  if (error) return bao('Không lưu được: ' + error.message, true)
  const ma = TL.donXep
  tlDong('tl-hop-xep'); $('tl-xep-lydo').value = ''
  await taiTaiLich()
  bao('✓ Đã xếp lại ' + ma + ' · ' + (r.so_dong || 0) + ' bước')
}

// ══════════ HỘP DỜI TAY (đường phụ) ══════════
async function moDoiTL(viecId) {
  TL.vD = viecId; $('tl-cb-ngoaile2').checked = false; $('tl-doi-lydo').value = ''
  $('tl-doi-luu').disabled = true
  $('tl-doi-cu').textContent = '…'; $('tl-doi-moi').textContent = '— chọn tuần —'; $('tl-doi-moi-mo').textContent = ''
  $('tl-ah-list').innerHTML = ''; $('tl-doi-canh').innerHTML = ''
  $('tl-hop-doi').classList.add('tl-mo')
  await tlVeChonTuan()
}
async function tlVeChonTuan() {
  const ngoaiLe = $('tl-cb-ngoaile2').checked && tlLaCeo()
  const { data, error } = await sb.rpc('tl_tuan_doi_duoc', { p_viec_id: TL.vD, p_ngoai_le: ngoaiLe, p_so_tuan: TL.tuan.length || 12 })
  if (error) { $('tl-chon-tuan').innerHTML = '<span style="color:var(--tre)">' + esc(error.message) + '</span>'; return }
  TL.doiTuan = data || []
  // hiện "đang ở" từ tuần đầu không đổi được? Lấy từ dữ liệu: tuần hiện tại của việc không có trong list (đã bỏ)
  let h = ''
  TL.doiTuan.forEach(t => {
    const kin = t.co_the_doi && t.se_vuot
    const cls = !t.co_the_doi ? (t.vung === 'dong_bang' ? 'tl-bang' : 'tl-cam') : (kin ? 'tl-kin' : '')
    const dau = !t.co_the_doi ? (t.vung === 'dong_bang' ? ' 🔒' : ' ⛔') : (kin ? ' ✕' : '')
    h += `<button class="${cls}" data-dt="${t.tuan_bat_dau}"${t.co_the_doi ? '' : ' disabled title="' + esc(t.ly_do_khong || '') + '"'}>${dmy(t.tuan_bat_dau)}${dau}</button>`
  })
  $('tl-chon-tuan').innerHTML = h
  $('tl-lb-chon').innerHTML = 'Chọn tuần dời sang <span style="color:var(--chu-mo)">· ⛔ sai thứ tự · 🔒 đóng băng · ✕ tổ đã kín</span>'
  $('tl-chon-tuan').querySelectorAll('[data-dt]:not([disabled])').forEach(b => b.onclick = () => tlChonTuan(b.dataset.dt))
}
async function tlChonTuan(tuan) {
  $('tl-chon-tuan').querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('tl-chon', b.dataset.dt === tuan))
  TL.doiMoi = tuan
  const { data: a, error } = await sb.rpc('tl_anh_huong_doi', { p_viec_id: TL.vD, p_tuan_moi: tuan })
  if (error) return bao(error.message, true)
  $('tl-doi-cu').textContent = dmy(a.tuan_cu); $('tl-doi-cu-mo').textContent = a.ten_to
  $('tl-doi-moi').textContent = dmy(tuan); $('tl-doi-moi-mo').textContent = a.ten_to
  const nl = a.to_moi.nang_luc
  let h = '<div class="tl-ah-d"><span class="tl-n">' + esc(a.ten_to) + ' tuần ' + dmy(a.tuan_cu) + '</span><span class="tl-v tl-tot">' + Math.round(a.to_cu.truoc) + ' → ' + Math.round(a.to_cu.sau) + ' giờ</span></div>'
    + '<div class="tl-ah-d"><span class="tl-n">' + esc(a.ten_to) + ' tuần ' + dmy(tuan) + '</span><span class="tl-v ' + (a.to_moi.se_vuot ? 'tl-xau' : '') + '">' + Math.round(a.to_moi.truoc) + ' → ' + Math.round(a.to_moi.sau) + '/' + (nl != null ? Math.round(nl) : '—') + ' giờ' + (a.to_moi.se_vuot ? ' · VƯỢT' : '') + '</span></div>'
    + '<div class="tl-ah-d"><span class="tl-n">' + (a.la_hang_lam_san ? 'Hàng làm sẵn' : 'Đơn') + ' xong sản xuất</span><span class="tl-v ' + (a.don_lui_ngay > 0 ? 'tl-xau' : 'tl-tot') + '">' + (a.don_lui_ngay > 0 ? 'lùi ' + a.don_lui_ngay + ' ngày' : 'sớm ' + (-a.don_lui_ngay) + ' ngày') + '</span></div>'
  $('tl-ah-list').innerHTML = h
  $('tl-doi-canh').innerHTML = a.la_hang_lam_san
    ? '<div class="tl-canh tl-xanh"><b>Hàng làm sẵn dời thoải mái</b>Không ai chờ lô này.</div>'
    : (a.tre_khach ? '<div class="tl-canh"><b>Có thể trễ hẹn khách</b>Dời muộn làm đơn xong sau ngày hẹn. Gọi báo khách.</div>' : '<div class="tl-canh tl-xanh"><b>Vẫn kịp hẹn khách</b></div>')
  $('tl-doi-luu').disabled = false
}
async function tlLuuDoi() {
  if (!TL.doiMoi) return
  const lyDo = $('tl-doi-lydo').value.trim()
  if (!lyDo) return bao('Dời tay bắt buộc ghi lý do', true)
  const ngoaiLe = $('tl-cb-ngoaile2').checked && tlLaCeo()
  const { error } = await sb.rpc('tl_doi_viec', { p_viec_id: TL.vD, p_tuan_moi: TL.doiMoi, p_ngoai_le: ngoaiLe, p_ly_do: lyDo })
  if (error) return bao('Không dời được: ' + error.message, true)
  tlDong('tl-hop-doi')
  await taiTaiLich()
  bao('✓ Đã dời việc sang tuần ' + dmy(TL.doiMoi))
}

function tlDong(id) { $(id).classList.remove('tl-mo') }

// WP-32: phơi mở màn đơn cho robot/kiểm mắt (như __sb) — không đổi hành vi người dùng.
window.moDon = moDon; window.moMon = moMon; window.veBfToast = veBfToast;
