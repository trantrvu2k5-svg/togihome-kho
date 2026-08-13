// App XƯỞNG bản đầy đủ — bố cục theo mẫu CEO. 5 màn responsive + panel chi tiết món. Đăng nhập xuong/tho/ceo.
//   Đọc qua RPC curated (tho không đọc bảng). KHÔNG hiện giá bán/giá vốn/tên khách. Quản đốc: chỉ xuong/ceo.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })

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
  if (USER.vai_tro === 'tho') { $('n-qd').style.display = 'none'; $('d-qd').style.display = 'none' }   // tho KHÔNG thấy quản đốc
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
  datKho('70x40')
  const { data: tl } = await sb.rpc('xuong_tho_list'); THO_LIST = tl || []
  await taiTo(); await taiDon(); await taiViec()
}
function di(m) {
  if (m === 'qd' && USER.vai_tro === 'tho') return
  ;['viec', 'tem', 'dem', 'loi', 'qd'].forEach(k => { $('s-' + k).style.display = (k === m) ? 'block' : 'none'
    $('n-' + k).classList.toggle('chon', k === m); $('d-' + k).classList.toggle('chon', k === m) })
  window.scrollTo(0, 0)
  if (m === 'qd') taiQuanDoc()
}
function tab(w) {
  $('qd-lam').style.display = (w === 'lam') ? 'block' : 'none'; $('qd-kb').style.display = (w === 'kb') ? 'block' : 'none'
  $('t-lam').classList.toggle('chon', w === 'lam'); $('t-kb').classList.toggle('chon', w === 'kb')
  if (w === 'kb') taiKanban()
}

// ══════════ VIỆC ══════════
let DONS = [], MONS = []   // MONS = [{...món, ma_don}]
async function taiDon() {
  const { data } = await sb.rpc('xuong_don_san_xuat'); DONS = data || []
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
async function taiQuanDoc() {
  taiChoVaoChuyen()
  const { data: red } = await sb.rpc('can_ceo_quyet')
  $('qdCeo').innerHTML = (red && red.length)
    ? `<div class="ceo"><h2>Cần CEO quyết</h2><p class="phu">Quản đốc không tự xử được ${red.length === 1 ? 'việc này' : red.length + ' việc này'}.</p>${red.map(r => `<div class="ceo-muc"><p>${esc(r.mo_ta)}</p></div>`).join('')}</div>` : ''
  const { data, error } = await sb.rpc('viec_uu_tien'); const box = $('qdList')
  if (error) { box.innerHTML = `<div class="trong-rong"><p>Lỗi: ${esc(error.message)}</p></div>`; return }
  $('qdGio').textContent = (data || []).length + ' việc đang chờ'; $('qdDem').textContent = (data || []).length + ' việc'
  if (!data || !data.length) { box.innerHTML = '<div class="trong-rong"><h3>Không có việc nào đang chờ</h3></div>'; return }
  const lyCls = r => r === 1 ? 'ly-tre' : r === 2 ? 'ly-gap' : r === 3 ? 'ly-tac' : r === 5 ? 'ly-mau' : 'ly-thuong'
  box.innerHTML = data.map((v, i) => `<button class="viec" data-don="${esc(v.ma_don)}"><span class="stt">${i + 1}</span><div class="viec-than"><div class="viec-ten"><span class="ma">${esc(v.ma_don)}</span><b>${esc(v.ten_mon)}</b></div><p class="viec-ly ${lyCls(v.rank_uu_tien)}">${esc(v.ly_do)}</p></div><span class="to">${esc(v.to_goi_y)}</span></button>`).join('')
  box.querySelectorAll('.viec').forEach(b => b.onclick = () => moDon(b.dataset.don))
}
let KB = []
const KB_COT = [['cho_cat', 'Chờ cắt'], ['da_cat', 'Đã cắt'], ['dang_lam', 'Đang làm'], ['xong_sx', 'Xong SX'], ['cho_giao', 'Chờ giao']]
async function taiKanban() {
  const { data } = await sb.rpc('kanban_xuong'); KB = data || []
  const tos = [...new Set(KB.map(x => x.to_goi_y))].filter(Boolean).sort(), dongs = [...new Set(KB.map(x => x.dong))].filter(Boolean).sort()
  const c1 = $('kbTo').value, c2 = $('kbDong').value
  $('kbTo').innerHTML = '<option value="">Tất cả tổ</option>' + tos.map(t => `<option${t === c1 ? ' selected' : ''}>${esc(t)}</option>`).join('')
  $('kbDong').innerHTML = '<option value="">Tất cả dòng</option>' + dongs.map(d => `<option${d === c2 ? ' selected' : ''}>${esc(d)}</option>`).join('')
  veKanban()
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
  vePanel(d, vet || [], tem || [], (fileRes && fileRes.data) || [])
}
const LOAI_FILE = { dxf: '▤ DXF', cutlist: '▦ Cutlist', anh_ban_ve: '🖼 Ảnh bản vẽ', khac: '📄 File' }
async function taiFileXuong(path) {
  const { data } = await sb.storage.from('file-san-xuat').createSignedUrl(path, 3600, { download: true })
  if (data && data.signedUrl) window.open(data.signedUrl, '_blank'); else bao('Không tải được file', true)
}
function vePanel(d, vet, tem, files) {
  files = files || []
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

// ══════════ BOOT ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) laySauDangNhap(data.session.user); else manDangNhap('')
})()
