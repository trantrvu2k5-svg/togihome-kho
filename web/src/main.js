// Togihome Kho — web app. Nối Supabase (schema kho) bằng khoá anon; RLS là cổng.
import { createClient } from '@supabase/supabase-js'
import { ngayNghiepVu, kyNghiepVu, congNgay } from './ngay.js'   // WP-14b: MỘT nguồn sinh ngày (ghim TZ VN)

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const sb = createClient(URL, ANON, { db: { schema: 'kho' }, auth: { persistSession: true } })

// ── helpers (giữ từ bản nháp) ──
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)]
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = v => Math.round(v || 0).toLocaleString('vi-VN')
const gio = d => d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ngay = d => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const anhUrl = ma => ma ? `https://drive.google.com/thumbnail?id=${ma}&sz=w400` : null
// URL ảnh bucket công khai — địa chỉ dự án lấy từ env VITE_SUPABASE_URL (KHÔNG viết cứng). f = kho.vat_tu.anh_file.
const anhBucket = f => f ? `${URL}/storage/v1/object/public/kho-images/${f}` : null

// ── trạng thái ──
let KHO = [], NCC = [], NHOM = [], TO = [], TK = {}, ANH = {}, PHIEU = [], SO = { nhap: 0, xuat: 0 }
let locNhom = '*', locKho = '*', ROLE = null, ME = null, ME_ID = null
const laQuanLy = () => ROLE === 'ceo' || ROLE === 'kho'   // chỉ ceo/kho thấy nút tải ảnh
// ═══════════ ĐĂNG NHẬP — chỉ EMAIL + mật khẩu (CEO / Thủ kho) ═══════════
$('#lg-btn').onclick = dangNhap
$('#lg-email').addEventListener('keydown', e => { if (e.key === 'Enter') dangNhap() })
$('#lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') dangNhap() })

async function dangNhap() {
  const err = $('#lg-err'); err.textContent = ''
  const email = $('#lg-email').value.trim(), pass = $('#lg-pass').value
  $('#lg-btn').disabled = true; $('#lg-btn').textContent = 'Đang vào…'
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass })
  $('#lg-btn').disabled = false; $('#lg-btn').textContent = 'Đăng nhập'
  if (error) { err.textContent = 'Sai email hoặc mật khẩu.'; return }
  await vaoApp(data.user)
}

async function vaoApp(user) {
  const { data: nd, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (error || !nd) { $('#lg-err').textContent = 'Tài khoản chưa được gán vai trò trong kho.nguoi_dung — báo CEO.'; await sb.auth.signOut(); return }
  if (!nd.dang_hoat_dong) { $('#lg-err').textContent = 'Tài khoản đã bị tắt hoạt động — báo CEO.'; await sb.auth.signOut(); return }
  ROLE = nd.vai_tro; ME = nd.ho_ten; ME_ID = nd.id
  if (laQuanLy()) { const nd_ = $('#nav-dm'); if (nd_) nd_.style.display = '' }   // WP-20: Đơn mua chỉ kho/ceo
  $('#login').classList.remove('on')
  $('#ai').textContent = `${nd.ho_ten} · ${ROLE.toUpperCase()}`
  // nút Đăng xuất (thêm 1 lần)
  if (!document.getElementById('btn-out')) {
    const b = document.createElement('button'); b.id = 'btn-out'; b.textContent = 'Đăng xuất'
    b.style.cssText = 'margin-left:10px;background:#fff;color:#C0392B;border:0;border-radius:3px;padding:3px 11px;font-size:12px;font-weight:600;cursor:pointer'
    // ĐĂNG XUẤT: signOut + XOÁ HẲN token localStorage TRƯỚC reload (tránh reload cắt ngang -> token còn -> vào lại app).
    b.onclick = async () => {
      try { await sb.auth.signOut() } catch (e) {}
      try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
      location.reload()
    }
    document.querySelector('header').appendChild(b)
  }
  await taiDuLieu()
  boot()
}

// phiên cũ còn hạn -> vào thẳng
sb.auth.getSession().then(({ data }) => { if (data.session) vaoApp(data.session.user) })

// ═══════════ TẢI DỮ LIỆU ═══════════
async function taiDuLieu() {
  const res = await Promise.all([
    sb.from('nhom').select('id,ten'),
    sb.from('vat_tu').select('id,ma,ten,loai,nhom_id,dvt,so_moi_dvt,do_day_mm,vat_lieu,hoan_thien,ma_van_ncc,anh_ma,anh_file,ton_toi_thieu'),
    sb.from('ton').select('vat_tu_id,so_luong,vat_tu:vat_tu_id(ma)'),
    sb.from('v_ton_gia_von').select('vat_tu_id,gia_von_bq,vat_tu:vat_tu_id(ma)'),  // rỗng nếu là thợ
    sb.from('v_gia_tham_khao').select('ma,gia_tham_khao'),                          // rỗng nếu là thợ
    sb.from('nha_cung_cap').select('id,ten,dien_thoai,dia_chi'),
    sb.from('to_san_xuat').select('ma_to,ten,so_nguoi'),   // [037] tổ nhận cho phiếu xuất
    sb.from('v_ton_kha_dung').select('vat_tu_id,giu_cho,dang_ve,kha_dung').limit(5000)   // WP-32: giữ chỗ + khả dụng (VIEW không embed FK → map qua vat_tu.id; 1 query, LIMIT trần QD-42)
  ])
  // Lỗi bất kỳ truy vấn -> KHÔNG dựng lại KHO (giữ nguyên, không clobber), trả lỗi cho nơi gọi hiện ra.
  const loi = res.find(r => r.error)
  if (loi) return { ok: false, loi: loi.error.message }
  const [{ data: nhom }, { data: vt }, { data: ton }, { data: gv }, { data: gtk }, { data: ncc }, { data: toList }, { data: kd }] = res
  TO = toList || []
  NHOM = nhom || []
  const tenNhom = Object.fromEntries(NHOM.map(x => [x.id, x.ten]))
  const tonMa = Object.fromEntries((ton || []).map(t => [t.vat_tu?.ma, t.so_luong]))
  const giaMa = Object.fromEntries((gv || []).map(g => [g.vat_tu?.ma, g.gia_von_bq]))
  const gtkMa = Object.fromEntries((gtk || []).map(g => [g.ma, g.gia_tham_khao]))
  const idMa = Object.fromEntries((vt || []).map(v => [v.id, v.ma]))         // WP-32: vat_tu.id → mã
  const kdMa = Object.fromEntries((kd || []).map(k => [idMa[k.vat_tu_id], k]))   // giữ chỗ theo mã
  KHO = (vt || []).map(v => ({
    ma: v.ma, ten: v.ten, kho: v.loai, nhom: tenNhom[v.nhom_id] || '—', nhom_id: v.nhom_id,
    dvt: v.dvt, sl: v.so_moi_dvt, min: v.ton_toi_thieu || 0, cktr: v.can_kiem_tra,
    ton: tonMa[v.ma] || 0, gia: giaMa[v.ma] || 0, gtk: gtkMa[v.ma] || 0,
    giu_cho: Number(kdMa[v.ma]?.giu_cho || 0), dang_ve: Number(kdMa[v.ma]?.dang_ve || 0),
    kha_dung: kdMa[v.ma] ? Number(kdMa[v.ma].kha_dung) : (tonMa[v.ma] || 0),   // không có dòng KD → = tồn
    vl: v.vat_lieu, day: v.do_day_mm, mv: v.ma_van_ncc, ht: v.hoan_thien, anh_ma: v.anh_ma, anh_file: v.anh_file
  }))
  // Nguồn ảnh theo THỨ TỰ: (1) anh_file -> bucket công khai · (2) anh_ma -> Drive dự phòng · (3) không có -> ô trống.
  KHO.forEach(x => { const u = anhBucket(x.anh_file) || anhUrl(x.anh_ma); if (u) ANH[x.ma] = u })
  NCC = (ncc || []).map(c => ({ id: c.id, ten: c.ten, dt: c.dien_thoai, dc: c.dia_chi, mh: '' }))
  if (!NCC.length) NCC = [{ id: null, ten: '(chưa có nhà cung cấp)', dt: '', dc: '', mh: '' }]
  window.KHO = KHO   // phơi tham chiếu hiện hành (mảng bị thay mới mỗi lần nạp) — cho kiểm thử soi bộ nhớ
  return { ok: true, loi: null }
}

// ═══════════ RENDER (thích ứng từ bản nháp) ═══════════
function oAnh(x) {
  const a = ANH[x.ma]
  return a ? `<div class="anh co" onclick="event.stopPropagation();phongTo('${x.ma}')"><img src="${a}" alt="" onerror="anhHong(this)"></div>`
    : `<div class="anh"><span class="trong">▣<small>ẢNH</small></span></div>`
}
// Ảnh CÓ nguồn nhưng tải HỎNG -> hiện ⚠HỎNG (đỏ), KHÁC hẳn ô 'chưa có ảnh' (▣ẢNH). Không nuốt lỗi im lặng.
function anhHong(el) { const p = el.parentNode; p.classList.remove('co'); p.classList.add('hong'); p.onclick = null; p.innerHTML = '<span class="trong" style="color:var(--do)">⚠<small>HỎNG</small></span>' }

// ── TẢI ẢNH VẬT TƯ (ceo/kho) — thu nhỏ ≤800px rồi lên bucket kho-images, tên MỚI mỗi lần (không đè) ──
// Thu nhỏ qua canvas: cạnh dài ≤ canhMax, xuất JPEG chất lượng vừa. window.URL vì `URL` (dòng 4) là chuỗi env.
function thuNhoAnh(file, canhMax = 800, chatLuong = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const u = window.URL.createObjectURL(file)
    img.onload = () => {
      window.URL.revokeObjectURL(u)
      let w = img.naturalWidth, h = img.naturalHeight; const tl = Math.max(w, h)
      if (tl > canhMax) { const k = canhMax / tl; w = Math.round(w * k); h = Math.round(h * k) }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(img, 0, 0, w, h)
      cv.toBlob(b => b ? resolve(b) : reject(new Error('không tạo được ảnh thu nhỏ')), 'image/jpeg', chatLuong)
    }
    img.onerror = () => { window.URL.revokeObjectURL(u); reject(new Error('ảnh hỏng, không đọc được')) }
    img.src = u
  })
}
let dangTaiAnh = false
async function taiAnh(ma, inp) {
  const file = inp.files && inp.files[0]; inp.value = ''      // reset để lần sau chọn lại cùng file vẫn kích hoạt
  if (!file || dangTaiAnh) return
  const v = KHO.find(x => x.ma === ma); if (!v) return
  const txt = $('#nut-anh-txt'); const nhan0 = txt ? txt.textContent : ''
  // b. kiểm loại + cỡ (chặn TRƯỚC khi tải)
  if (!['image/jpeg', 'image/png'].includes(file.type)) { bao('Chỉ nhận ảnh JPG hoặc PNG — không tải.'); return }
  if (file.size > 5 * 1024 * 1024) { bao(`Ảnh ${(file.size / 1048576).toFixed(1)}MB vượt 5MB — không tải.`); return }
  dangTaiAnh = true; if (txt) txt.textContent = '⏳ Đang tải…'
  const xong = () => { dangTaiAnh = false; if (txt) txt.textContent = nhan0 }
  // c. thu nhỏ
  let blob
  try { blob = await thuNhoAnh(file) } catch (e) { xong(); bao('Lỗi xử lý ảnh: ' + e.message); return }
  // d. tải lên tên MỚI (upsert:false -> không bao giờ đè file cũ)
  const path = `kho/${ma}_${Date.now()}.jpg`
  const up = await sb.storage.from('kho-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (up.error) { xong(); bao('TẢI ẢNH LÊN LỖI: ' + up.error.message + ' — chưa đổi gì.'); return }   // lỗi 1: không nuốt
  // e. cập nhật cột anh_file
  const upd = await sb.from('vat_tu').update({ anh_file: path }).eq('ma', ma)
  if (upd.error) {   // lỗi 2 (NGUY NHẤT): ảnh đã ở bucket mà bảng không biết -> nêu TÊN FILE để truy
    xong(); bao('NGUY: ảnh ĐÃ tải lên bucket "' + path + '" NHƯNG lưu cột anh_file LỖI: ' + upd.error.message + '. Báo kỹ thuật, giữ tên file này.')
    return
  }
  // f. cập nhật hiển thị NGAY (không tải lại trang)
  v.anh_file = path; ANH[ma] = anhBucket(path)
  dangTaiAnh = false
  bao('Đã tải ảnh cho ' + ma + '. Ảnh cũ (nếu có) vẫn giữ trong bucket.')
  veBang(); moThe(ma)
}
function phongTo(ma) { const v = KHO.find(x => x.ma === ma); if (!ANH[ma]) return; $('#den-img').src = ANH[ma]; $('#den-ct').innerHTML = `<b>${v.ten}</b>${v.ma} · ${v.nhom} · tồn ${n(v.ton)} ${v.dvt}`; $('#den').classList.add('on') }
const dongDen = () => $('#den').classList.remove('on')
document.addEventListener('keydown', e => { if (e.key === 'Escape') { dongDen(); dongThe() } })

function chuyenMan(m) { $$('nav button[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === m)); $$('.man').forEach(s => s.classList.toggle('on', s.id === 'm-' + m)); dongThe(); dongNav(); if (m === 'ton') lamMoiTon(); if (m === 'dat') veDat(); if (m === 'ncc') veNcc(); if (m === 'nhap') veDsPhieu('nhap'); if (m === 'xuat') veDsPhieu('xuat'); if (m === 'ghep') veGhepMa(); if (m === 'dm') veDonMua(); if (m === 'tsvt') veTsvt() }
// ── điều khiển bố cục điện thoại (chỉ tác dụng ở màn hẹp; desktop các phần tử ẩn) ──
function moNav() { $('nav')?.classList.add('mo'); $('#navNen')?.classList.add('mo') }
function dongNav() { $('nav')?.classList.remove('mo'); $('#navNen')?.classList.remove('mo') }
function toggleLoc() { $('#chips-row')?.classList.toggle('mo'); $('.mb-loc')?.classList.toggle('on') }
let tienDayDu = false
const tienNgan = v => v >= 1e9 ? (Math.round(v / 1e8) / 10) + ' tỷ' : v >= 1e6 ? Math.round(v / 1e6) + 'tr' : n(v)
function veOTien(val) { const el = $('#k-tien'); if (!el) return; el.dataset.full = val
  const hep = window.matchMedia('(max-width:819.98px)').matches
  el.textContent = (hep && !tienDayDu) ? tienNgan(val) : n(val) }
function toggleTien() { tienDayDu = !tienDayDu; veOTien(Number($('#k-tien')?.dataset.full || 0)) }
$$('nav button[data-m]').forEach(b => b.onclick = () => chuyenMan(b.dataset.m))

// Trang Tồn kho: nạp LẠI từ DB rồi mới vẽ. Hiện "Đang tải…" lúc nạp; lỗi thì hiện rõ, KHÔNG giữ số cũ im lặng.
async function lamMoiTon() {
  const bang = $('#bang'), btn = $('#btn-lammoi')
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tải…' }
  if (bang) bang.innerHTML = '<tr><td colspan="11" style="padding:22px;color:#6E7681">Đang tải…</td></tr>'
  const r = await taiDuLieu()
  if (btn) { btn.disabled = false; btn.textContent = 'Làm mới' }
  if (!r || !r.ok) {
    if (bang) bang.innerHTML = `<tr><td colspan="11" style="padding:22px;color:var(--do)">Không tải được dữ liệu từ máy chủ${r && r.loi ? ': ' + r.loi : ''}. Bấm Làm mới để thử lại.</td></tr>`
    return
  }
  veChips(); veBang()
}

function veChips() {
  const ds = KHO.filter(x => locKho === '*' || x.kho === locKho)
  const g = [...new Set(ds.map(x => x.nhom))].sort((a, b) => ds.filter(x => x.nhom === b).length - ds.filter(x => x.nhom === a).length)
  $('#chips').innerHTML = g.map(t => `<button class="chip" data-n="${t}">${t}</button>`).join(' ')
  $$('.chip').forEach(c => { if (c.dataset.n) c.onclick = () => { $$('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); locNhom = c.dataset.n; veBang() } })
}
$$('.seg button').forEach(b => { if (b.dataset.k) b.onclick = () => { $$('.seg button').forEach(x => x.classList.remove('on')); b.classList.add('on'); locKho = b.dataset.k; locNhom = '*'; veChips(); veBang() } })

function veBang() {
  const q = ($('#tim').value || '').trim().toLowerCase()
  const ds = KHO.filter(x => (locKho === '*' || x.kho === locKho) && (locNhom === '*' || x.nhom === locNhom) &&
    (!q || x.ma.toLowerCase().includes(q) || x.ten.toLowerCase().includes(q)))
  $('#bang').innerHTML = ds.map(x => {
    const duoi = x.min > 0 && x.ton < x.min, pct = x.min > 0 ? Math.min(100, x.ton / x.min * 100) : (x.ton > 0 ? 100 : 0)
    const co = []; if (!x.gia && !x.gtk) co.push('chưa có giá'); if (x.kho === 'pk' && !x.sl) co.push('thiếu quy cách')
    return `<tr class="click ${duoi ? 'duoi' : ''}" onclick="moThe('${x.ma}')">
      <td>${oAnh(x)}</td><td class="ma">${x.ma}</td>
      <td>${x.ten}${x.ht ? `<span class="ht ${x.ht.includes('Sơn') ? 'son' : 'dan'}">${x.ht.replace(/[🅰🅱]\s*/, '')}</span>` : ''}${co.length ? `<span class="thieu">${co.join(' · ')}</span>` : ''}</td>
      <td class="nhom-t">${x.nhom}</td>
      <td class="r"><div class="mt"><span class="v">${n(x.ton)}</span><span class="bar"><i style="width:${pct}%"></i></span></div></td>
      <td class="r num" style="color:#6E7681">${x.min ? n(x.min) : '—'}</td>
      <td style="color:#6E7681;font-size:13px">${x.dvt}</td>
      <td class="r num">${x.gia ? n(x.gia) : (x.gtk ? `<span class="chua-gia" title="giá mua tham khảo — chưa có tồn/giá vốn thật">${n(x.gtk)} · tham khảo</span>` : '—')}</td>
      <td class="tk-gc-giu">${x.giu_cho ? n(x.giu_cho) : '<span class="tk-gc-0">0</span>'}</td>
      <td class="tk-gc-ve">${x.dang_ve ? n(x.dang_ve) : '<span class="tk-gc-0">0</span>'}</td>
      <td class="tk-gc-kd ${x.kha_dung < 0 ? 'tk-gc-am' : ''}">${x.kha_dung < 0 ? '−' + n(-x.kha_dung) : n(x.kha_dung)}${x.kha_dung < 0 && x.dang_ve > 0 ? '<span class="tk-gc-badge">chờ hàng về</span>' : ''}</td></tr>`
  }).join('') || `<tr><td colspan="11" style="padding:22px;color:#6E7681">Không có mã nào khớp.</td></tr>`
  const kv = KHO.filter(x => locKho === '*' || x.kho === locKho)
  $('#k-ma').textContent = n(kv.length)
  $('#k-duoi').textContent = n(kv.filter(x => x.kha_dung < 0).length)         // khả dụng âm
  $('#k-thieu').textContent = n(kv.filter(x => x.giu_cho > 0).length)          // mã đang giữ chỗ
  $('#k-tien').textContent = n(kv.filter(x => x.dang_ve > 0).length)           // mã đang về
  $('#s-all').textContent = KHO.length; $('#s-pk').textContent = KHO.filter(x => x.kho === 'pk').length; $('#s-van').textContent = KHO.filter(x => x.kho === 'van').length
}

// ── thẻ kho (async: lấy giao dịch của mã từ Supabase) ──
let theMa = null
async function moThe(ma) {
  theMa = ma; const v = KHO.find(x => x.ma === ma)
  const vid = await maToId(ma)
  // Tồn TƯƠI + giao dịch: hỏi DB cùng lúc. KHÔNG dùng v.ton trong bộ nhớ nữa.
  const [{ data: gd, error: eGd }, { data: tonRows, error: eTon }] = await Promise.all([
    sb.from('giao_dich').select('loai,so_luong,tao_luc,nguon,phieu:phieu_id(so_phieu)')
      .eq('vat_tu_id', vid).order('tao_luc', { ascending: false }).limit(50),
    sb.from('ton').select('so_luong').eq('vat_tu_id', vid)
  ])
  // Lỗi đọc tồn (hoặc giao dịch) -> KHÔNG âm thầm dùng số cũ. Hiện rõ, không in con số nào.
  if (eTon || eGd) {
    $('#the').innerHTML = `<div class="the-dau"><div><h3>${v ? v.ten : ma}</h3><div class="m">${ma}</div></div><button class="x" onclick="dongThe()" style="margin-left:auto">×</button></div>
      <div class="the-than"><div class="rong" style="color:var(--do)">Không đọc được tồn từ máy chủ.</div></div>`
    $('#the').classList.add('on'); return
  }
  // Tồn tươi = tổng so_luong các dòng ton của mã (một kho -> một dòng). Cập nhật lại KHO để bảng không lệch panel.
  const tonTuoi = (tonRows || []).reduce((s, r) => s + Number(r.so_luong || 0), 0)
  v.ton = tonTuoi
  const lich = (gd || []).map(g => ({ vao: ['nhap', 'tra'].includes(g.loai), sl: Math.abs(g.so_luong), luc: new Date(g.tao_luc), so: g.phieu?.so_phieu || (g.nguon === 'quet_tem' ? 'QUÉT' : '—'), mo: g.loai }))
  let du = tonTuoi
  const dong = lich.map(g => { const h = `<div class="dong-tk ${g.vao ? 'n' : 'x'}"><span class="ngay">${gio(g.luc)}</span><span>${g.mo}<br><span style="color:#8A8F96;font-size:11.5px">${g.so}</span></span><span class="sl">${g.vao ? '+' : '−'}${n(g.sl)}</span><span class="du">còn ${n(du)}</span></div>`; du += g.vao ? -g.sl : g.sl; return h }).join('')
  $('#the').innerHTML = `<div class="the-dau">${oAnh(v)}<div><h3>${v.ten}</h3><div class="m">${v.ma} · ${v.nhom}</div>${v.kho === 'van' ? `<div class="m" style="margin-top:4px;color:#4A5159">${v.vl || ''}${v.day ? ' · dày ' + v.day + 'mm' : ''}${v.mv ? ' · vân ' + v.mv : ''}</div>` : ''}</div><button class="n nho" onclick="suaVatTu('${v.ma}')" style="margin-left:auto">✎ Sửa</button><button class="x" onclick="dongThe()">×</button></div>
    ${laQuanLy() ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 6px">
      <label class="n nho" id="nut-anh" style="cursor:pointer"><span id="nut-anh-txt">📷 ${ANH[v.ma] ? 'Thay ảnh' : 'Thêm ảnh'}</span><input type="file" accept="image/jpeg,image/png" capture="environment" style="display:none" onchange="taiAnh('${v.ma}',this)"></label>
      <span style="font-size:12px;color:var(--muted)">Ảnh sẽ được thu nhỏ; ảnh cũ vẫn được giữ lại.</span></div>` : ''}
    <div class="the-so"><div><span>Tồn hiện tại</span><b style="color:${v.ton < v.min ? 'var(--do)' : 'var(--ink)'}">${n(v.ton)}</b></div>
      <div><span>Tối thiểu</span><b style="color:#6E7681">${v.min ? n(v.min) : '—'}</b></div>
      <div><span>Giá bình quân</span><b>${v.gia ? n(v.gia) : '—'}</b></div><div><span>Giá trị tồn</span><b>${n(v.ton * v.gia)}</b></div></div>
    <div class="the-than"><h4>Thẻ kho — lịch sử nhập xuất</h4>${dong || '<div class="rong">Chưa có giao dịch nào.</div>'}</div>`
  $('#the').classList.add('on')
}
const dongThe = () => { $('#the').classList.remove('on'); theMa = null }
const escA = s => String(s ?? '').replace(/"/g, '&quot;')

// ── SỬA DANH MỤC (ceo/kho) — form trong thẻ kho; giá vốn KHÔNG sửa ở đây ──
function suaVatTu(ma) {
  const v = KHO.find(x => x.ma === ma)
  const opts = NHOM.filter(nh => !nh.loai || nh.loai === v.kho).map(nh => `<option value="${nh.id}"${nh.id === v.nhom_id ? ' selected' : ''}>${nh.ten}</option>`).join('')
  $('#the').innerHTML = `
    <div class="the-dau"><div><h3>Sửa vật tư</h3><div class="m">${v.ma} · ${v.kho === 'van' ? 'ván' : 'phụ kiện'}</div></div><button class="x" onclick="moThe('${ma}')" style="margin-left:auto">×</button></div>
    <div class="the-than">
      <label>Tên</label><input class="ip" id="e-ten" style="width:100%" value="${escA(v.ten)}">
      <label style="margin-top:10px">Nhóm</label><select class="ip" id="e-nhom" style="width:100%">${opts}</select>
      <label style="margin-top:10px">Đơn vị tính</label><input class="ip" id="e-dvt" style="width:100%" value="${escA(v.dvt)}">
      <label style="margin-top:10px">Quy cách (số cái / đơn vị mua)</label><input class="ip num" id="e-sl" type="number" style="width:100%" value="${v.sl ?? ''}">
      <label style="margin-top:10px">Mức tối thiểu</label><input class="ip num" id="e-min" type="number" style="width:100%" value="${v.min ?? 0}">
      <label style="margin-top:12px;display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="e-cktr" ${v.cktr ? 'checked' : ''} style="width:auto"> Cần kiểm tra (dữ liệu nghi ngờ)</label>
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">Giá vốn tính từ phiếu nhập (bình quân gia quyền) — không sửa ở đây. Muốn đổi thì lập phiếu điều chỉnh.</div>
      <div style="display:flex;gap:8px;margin-top:16px"><button class="n chinh" onclick="luuVatTu('${ma}')">Lưu</button><button class="n" onclick="moThe('${ma}')">Huỷ</button></div>
      <div id="e-err" style="color:var(--do);font-size:13px;margin-top:8px"></div>
    </div>`
  $('#the').classList.add('on')
}
async function luuVatTu(ma) {
  const err = $('#e-err'); err.textContent = ''
  const ten = $('#e-ten').value.trim(); if (!ten) { err.textContent = 'Tên không được để trống.'; return }
  const upd = {
    ten, nhom_id: $('#e-nhom').value || null, dvt: $('#e-dvt').value.trim() || null,
    so_moi_dvt: $('#e-sl').value === '' ? null : Number($('#e-sl').value),
    ton_toi_thieu: Number($('#e-min').value) || 0, can_kiem_tra: $('#e-cktr').checked,
    sua_luc: new Date().toISOString(), nguoi_thao_tac: ME_ID
  }
  const { error } = await sb.from('vat_tu').update(upd).eq('ma', ma)
  if (error) { err.textContent = 'Lưu lỗi: ' + error.message; return }
  await taiDuLieu(); veChips(); veBang(); bao(`Đã lưu ${ma}.`); moThe(ma)
}
const _idCache = {}
async function maToId(ma) { if (_idCache[ma]) return _idCache[ma]; const { data } = await sb.from('vat_tu').select('id').eq('ma', ma).single(); _idCache[ma] = data?.id; return data?.id }

// ── cần đặt hàng ──
// ═══ WP-42 · CẦN ĐẶT HÀNG (Mức 2/3) — dữ liệu từ kho.canh_bao_dat_hang() ═══
const nd = v => (Math.round(Number(v || 0) * 100) / 100).toLocaleString('vi-VN')   // số lượng: giữ tới 2 lẻ (ván quy m²)
const nd1 = v => (Math.round(Number(v || 0) * 10) / 10).toLocaleString('vi-VN')     // tốc độ xuất/ngày: 1 lẻ
async function veDat() {
  const box = $('#cdh'); if (!box) return
  box.innerHTML = '<div class="cdh-note">Đang tính…</div>'
  const { data, error } = await sb.rpc('canh_bao_dat_hang')
  if (error) { box.innerHTML = `<div class="cdh-err" style="padding:14px">Lỗi: ${esc(error.message)}</div>`; return }
  const rows = data || [], g1 = rows.filter(r => r.nhom === 'canh_bao'), g2 = rows.filter(r => r.nhom === 'thieu_lead'), g3 = rows.filter(r => r.nhom === 'chua_co_muc')
  const gio = new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dngay = iso => iso ? Math.round((new Date(iso + 'T00:00:00') - today) / 864e5) : null
  const fmtN = iso => iso ? iso.split('-').reverse().join('/') : '—'

  const h1 = !g1.length ? '<div class="cdh-rong">✓ Không mã nào tụt dưới mức tối thiểu</div>'
    : `<div class="cdh-wrap"><table class="cdh-tbl"><thead><tr><th></th><th>Mã · Tên</th><th class="r">Tồn</th><th class="r">Giữ chỗ</th><th class="r">PO đang về</th><th class="r">Khả dụng</th><th>Min / Max</th><th class="r">Đặt</th><th>Trước ngày</th><th>NCC gợi ý</th></tr></thead><tbody>
      ${g1.map((r, i) => { const dd = dngay(r.ngay_dat), gap = dd != null && dd <= 2
        return `<tr><td><input type="checkbox" class="cdh-ck" data-i="${i}"></td>
          <td class="cdh-mt"><b>${esc(r.ma)}</b><span>${esc(r.ten)}</span></td>
          <td class="r">${nd(r.ton)}</td><td class="r">${nd(r.giu_cho)}</td><td class="r">${nd(r.po_dang_ve)}</td>
          <td class="r cdh-do">${nd(r.kha_dung)}</td>
          <td>${nd(r.ton_toi_thieu)} / ${r.muc_dat_len_toi != null ? nd(r.muc_dat_len_toi) : '—'}${r.thieu_muc_max ? '<span class="cdh-co" title="đặt = min − khả dụng">chưa có mức max</span>' : ''}</td>
          <td class="r cdh-dat">${nd(r.so_dat)} <span class="cdh-ghi">${esc(r.don_vi_co_so)}</span></td>
          <td><span class="${gap ? 'cdh-do' : ''}">${fmtN(r.ngay_dat)}</span>${dd != null ? `<div class="cdh-ghi" style="color:${gap ? '#B42318' : '#6B7488'}">(còn ${dd} ngày)</div>` : ''}</td>
          <td class="cdh-ncc">${r.ncc_ten ? `${esc(r.ncc_ten)} · ${n(r.don_gia)}đ · lead ${r.lead_time}` : '—'}</td></tr>` }).join('')}
      </tbody></table></div><div class="cdh-foot"><button class="n chinh" id="cdh-tao" disabled>Tạo đơn mua</button><span class="cdh-msg" id="cdh-msg"></span></div>`

  const h2 = !g2.length ? '<div class="cdh-rong" style="color:#4A5462;background:#F4F5F7">✓ Không mã nào thiếu lead time</div>'
    : `<div class="cdh-wrap"><table class="cdh-tbl"><thead><tr><th>Mã · Tên</th><th class="r">Khả dụng</th><th class="r">Min</th><th class="r">Thiếu</th><th></th></tr></thead><tbody>
      ${g2.map(r => `<tr><td class="cdh-mt"><b>${esc(r.ma)}</b><span>${esc(r.ten)}</span></td>
        <td class="r">${nd(r.kha_dung)} <span class="cdh-ghi">${esc(r.don_vi_co_so)}</span></td>
        <td class="r">${nd(r.ton_toi_thieu)}</td><td class="r cdh-dat">${nd(r.so_dat)}</td>
        <td><button class="n cdh-bs" data-ma="${esc(r.ma)}">Bổ sung giá NCC</button></td></tr>`).join('')}
      </tbody></table></div><div class="cdh-note">Nhập giá + lead time ở tab Nhà cung cấp rồi bấm ↻ Tính lại — dòng tự lên nhóm "Cần đặt".</div>`

  const h3 = !g3.length ? '<div class="cdh-rong" style="color:#4A5462;background:#F4F5F7">✓ Mọi mã đều đã có mức</div>'
    : `<div class="cdh-wrap"><table class="cdh-tbl"><thead><tr><th>Mã · Tên</th><th class="r">Tồn</th><th class="r">Xuất bq/ngày (30n)</th><th class="r">Min</th><th class="r">Max</th><th></th></tr></thead><tbody>
      ${g3.map(r => `<tr data-vt="${r.vat_tu_id}"><td class="cdh-mt"><b>${esc(r.ma)}</b><span>${esc(r.ten)}</span></td>
        <td class="r">${nd(r.ton)}</td><td class="r">${nd1(r.toc_do)}</td>
        <td class="r"><input class="ip cdh-min" inputmode="decimal" placeholder="min"></td>
        <td class="r"><input class="ip cdh-max" inputmode="decimal" placeholder="—"></td>
        <td><button class="n cdh-luu">Lưu</button><div class="cdh-err"></div></td></tr>`).join('')}
      </tbody></table></div>`

  box.innerHTML = `<div class="cdh-dau"><div>Tính lúc ${gio} · <span class="cdh-ct">khả dụng = tồn − giữ chỗ + PO đang về</span></div><button class="n" id="cdh-tinh">↻ Tính lại</button></div>
    <div class="cdh-khoi"><div class="cdh-dau-khoi cdh-k1">Cần đặt <span class="cdh-dem">${g1.length}</span></div>${h1}</div>
    <div class="cdh-khoi"><div class="cdh-dau-khoi cdh-k2">Thiếu lead time <span class="cdh-dem">${g2.length}</span> <span class="cdh-ghi">— chưa tính được ngày đặt</span></div>${h2}</div>
    <div class="cdh-khoi"><div class="cdh-dau-khoi cdh-k3">Chưa có mức <span class="cdh-dem">${g3.length}</span> <span class="cdh-ghi">— gõ min/max để bật cảnh báo</span></div>${h3}</div>`

  $('#cdh-tinh').onclick = () => veDat()
  if (g1.length) {
    const tao = $('#cdh-tao')
    const capNhat = () => { const ck = [...box.querySelectorAll('.cdh-ck:checked')].map(c => g1[+c.dataset.i]); const nccs = new Set(ck.map(r => r.ncc_id).filter(Boolean))
      tao.disabled = ck.length === 0; tao.textContent = ck.length ? `Tạo đơn mua (${ck.length} dòng · ${nccs.size} NCC → ${nccs.size} PO)` : 'Tạo đơn mua'; tao._dong = ck }
    box.querySelectorAll('.cdh-ck').forEach(c => c.onchange = capNhat); capNhat()
    tao.onclick = async () => { const ck = tao._dong || []; if (!ck.length) return
      const dong = ck.map(r => ({ vat_tu_id: r.vat_tu_id, so_luong: Number(r.so_dat), ncc_id: r.ncc_id, don_gia: Number(r.don_gia) }))
      tao.disabled = true
      const { data, error } = await sb.rpc('tao_po_tu_canh_bao', { p_dong: dong })
      if (error) { $('#cdh-msg').innerHTML = `<span class="cdh-err">${esc(error.message)}</span>`; tao.disabled = false; return }
      $('#cdh-msg').textContent = `Đã tạo ${data.so_po} PO nháp — sửa/gửi ở tab Đơn mua.` }
  }
  box.querySelectorAll('.cdh-bs').forEach(b => b.onclick = () => { bao(`Thêm mã ${b.dataset.ma} vào bảng giá 1 NCC (kèm lead time) rồi ↻ Tính lại.`); chuyenMan('ncc') })
  box.querySelectorAll('.cdh-luu').forEach(b => b.onclick = () => luuMuc(b))
  box.querySelectorAll('.cdh-min,.cdh-max').forEach(inp => inp.onkeydown = e => { if (e.key === 'Enter') luuMuc(e.target.closest('tr').querySelector('.cdh-luu')) })
}
async function luuMuc(btn) {
  const tr = btn.closest('tr'), err = tr.querySelector('.cdh-err'); err.textContent = ''
  const minV = tr.querySelector('.cdh-min').value.trim(), maxV = tr.querySelector('.cdh-max').value.trim()
  if (minV === '') { err.textContent = 'Nhập mức tối thiểu (gõ 0 nếu không cần dự trữ).'; return }
  const p_min = Number(minV.replace(/[^\d.]/g, '')), p_max = maxV === '' ? null : Number(maxV.replace(/[^\d.]/g, ''))
  const { error } = await sb.rpc('dat_muc_ton', { p_vat_tu_id: tr.dataset.vt, p_min, p_max })
  if (error) { err.textContent = error.message; return }
  tr.style.opacity = .5; btn.textContent = '✓ đã lưu'; btn.disabled = true
}

// ── nhà cung cấp ──
async function themNcc() {
  const t = $('#ncc-ten').value.trim(); if (!t) { bao('Nhập tên nhà cung cấp đã.'); return }
  const { error } = await sb.from('nha_cung_cap').insert({ ten: t, dien_thoai: $('#ncc-dt').value.trim() || null, dia_chi: null })
  if (error) { bao('Không thêm được: ' + error.message); return }
  $('#ncc-ten').value = ''; $('#ncc-dt').value = ''; $('#ncc-mh').value = ''
  await taiDuLieu(); veNcc(); bao(`Đã thêm ${t}.`)
}
// ═══ WP-23 · TAB NHÀ CUNG CẤP: banner thiếu lead time + bảng NCC (hạn TT + số mã) + panel bảng giá ═══
let NCC_VT = null, VTDV = null, NCC_SEL = null
async function nccVatTu() { if (!NCC_VT) { const { data, error } = await sb.from('vat_tu').select('id,ma,ten,don_vi_co_so').eq('ngung_dung', false).order('ma'); if (error) { console.error('nccVatTu:', error.message); return [] } NCC_VT = data || [] } return NCC_VT }
async function nccVtdv() { if (!VTDV) { const { data } = await sb.from('vat_tu_don_vi').select('vat_tu_id,don_vi'); VTDV = {}; (data || []).forEach(r => (VTDV[r.vat_tu_id] = VTDV[r.vat_tu_id] || []).push(r.don_vi)) } return VTDV }
async function nccDonViList(vat_tu_id) { const vt = (await nccVatTu()).find(v => v.id === vat_tu_id); const dv = await nccVtdv(); return vt ? [vt.don_vi_co_so, ...(dv[vat_tu_id] || [])] : [] }
async function veNcc() {
  // Banner: ván thiếu lead time
  try {
    const { data: tl } = await sb.rpc('vat_tu_thieu_lead_time')
    const b = $('#ncc-banner')
    if (b) b.innerHTML = (tl && tl.length)
      ? `<div class="ncc-canhbao">⚠ <b>${tl.length} mã ván chưa có lead time</b> ở bất kỳ NCC nào — chưa tính được "đặt trước ngày nào" (WP-42).<ul>${tl.slice(0, 20).map(x => `<li>${x.ma} · ${esc(x.ten || '')}</li>`).join('')}${tl.length > 20 ? `<li>… +${tl.length - 20} mã</li>` : ''}</ul></div>` : ''
  } catch (e) {}
  const [{ data: nccs }, { data: gcnt }] = await Promise.all([
    sb.from('nha_cung_cap').select('id,ten,dien_thoai,han_thanh_toan_ngay').order('ten'),
    sb.from('gia_ncc').select('ncc_id')
  ])
  const cnt = {}; (gcnt || []).forEach(g => cnt[g.ncc_id] = (cnt[g.ncc_id] || 0) + 1)
  $('#ncc-b').innerHTML = (nccs || []).length ? nccs.map(c => {
    const han = c.han_thanh_toan_ngay ?? 30
    return `<tr class="ncc-row ${c.id === NCC_SEL ? 'ncc-chon' : ''}" data-ncc="${c.id}"><td><b>${esc(c.ten)}</b></td><td style="color:#5A6169">${c.dien_thoai || '—'}</td>`
      + `<td class="r num">${han}${han === 30 ? ' <span class="ncc-mo">(mặc định)</span>' : ''}</td><td class="r num">${cnt[c.id] || 0}</td>`
      + `<td><span class="ncc-lichsu">${c.id === NCC_SEL ? 'đang mở ▼' : 'mở'}</span></td></tr>`
  }).join('') : '<tr><td colspan="5" class="rong">Chưa có nhà cung cấp.</td></tr>'
  $$('#ncc-b .ncc-row').forEach(r => r.onclick = () => { NCC_SEL = (NCC_SEL === r.dataset.ncc) ? null : r.dataset.ncc; veNcc(); if (NCC_SEL) nccPanel(NCC_SEL, nccs.find(x => x.id === NCC_SEL)) })
  if (NCC_SEL) nccPanel(NCC_SEL, (nccs || []).find(x => x.id === NCC_SEL)); else $('#ncc-panel').innerHTML = ''
}
async function nccPanel(ncc_id, ncc) {
  const box = $('#ncc-panel'); if (!box) return
  box.innerHTML = '<div class="ncc-the"><div class="rong">Đang tải bảng giá…</div></div>'
  const { data: rows, error } = await sb.rpc('gia_ncc_ds', { p_ncc_id: ncc_id })
  if (error) { box.innerHTML = `<div class="ncc-the" style="color:var(--do)">Lỗi: ${esc(error.message)}</div>`; return }
  const laQL = ['kho', 'ceo'].includes(ROLE)
  const han = ncc?.han_thanh_toan_ngay ?? 30
  const tbl = (rows || []).length ? `<div class="ncc-tbl-wrap"><table class="ncc-tbl"><thead><tr><th>Vật tư</th><th>Đơn vị</th><th class="r">Đơn giá (chưa VAT)</th><th class="r">Lead time (ngày)</th><th>Áp dụng từ</th><th></th></tr></thead><tbody>`
    + rows.map(g => `<tr><td>${g.ma} · ${esc(g.ten || '')}</td><td>${g.don_vi}</td><td class="r num">${dmTien(g.don_gia)}</td>`
      + `<td class="r num">${g.lead_time_ngay != null ? g.lead_time_ngay : '<span class="ncc-mo">—</span> <span class="ncc-nhan ncc-thieu">thiếu</span>'}</td>`
      + `<td>${dmNgay(g.ap_dung_tu)}</td><td>${laQL ? `<span class="ncc-lichsu ncc-sua-gia" data-vt="${g.vat_tu_id}" data-dv="${g.don_vi}" data-gia="${g.don_gia}" data-lt="${g.lead_time_ngay ?? ''}">sửa</span>` : ''}</td></tr>`).join('')
    + '</tbody></table></div>' : '<div class="ncc-mo" style="padding:8px 0">Chưa có mã nào trong bảng giá NCC này.</div>'
  box.innerHTML = `<div class="ncc-the">
    <div class="ncc-hang-phai" style="margin-bottom:10px">
      <b>${esc(ncc?.ten || '')}</b>
      <span>· Hạn thanh toán <input type="number" id="ncc-han" value="${han}" style="width:64px" ${laQL ? '' : 'disabled'}> ngày</span>
      <span class="ncc-mo" style="font-size:12px">(HĐ mới của NCC này: hạn = ngày HĐ + <span id="ncc-han-x">${han}</span>; HĐ cũ không đổi)</span>
      <span style="flex:1"></span>
      <span class="ncc-lichsu" id="ncc-ls-btn">Lịch sử bảng giá</span>
    </div>
    ${tbl}
    ${laQL ? '<div style="margin-top:10px" class="ncc-hang-phai"><button class="n chinh" id="ncc-them-gia">+ Thêm mã vào bảng giá</button><span class="ncc-mo" style="font-size:12px">Ô đơn vị = dropdown đơn vị hợp lệ của vật tư (cơ sở + quy đổi), không gõ tự do.</span></div>' : ''}
    <div id="ncc-gia-form"></div><div id="ncc-ls"></div><div class="ncc-err" id="ncc-panel-err"></div></div>`
  if (laQL) {
    const hi = $('#ncc-han'); hi.onchange = async () => {
      const v = Number(hi.value) || 30; const r = await sb.from('nha_cung_cap').update({ han_thanh_toan_ngay: v }).eq('id', ncc_id)
      if (r.error) { $('#ncc-panel-err').textContent = r.error.message; return } $('#ncc-han-x').textContent = v; bao('Đã lưu hạn thanh toán ' + v + ' ngày'); if (ncc) ncc.han_thanh_toan_ngay = v
    }
    $('#ncc-them-gia').onclick = () => nccGiaForm(ncc_id, null)
    box.querySelectorAll('.ncc-sua-gia').forEach(s => s.onclick = () => nccGiaForm(ncc_id, { vat_tu_id: s.dataset.vt, don_vi: s.dataset.dv, don_gia: s.dataset.gia, lead: s.dataset.lt }))
  }
  $('#ncc-ls-btn').onclick = () => nccLichSu(ncc_id)
}
async function nccGiaForm(ncc_id, sua) {
  await nccVatTu()
  const box = $('#ncc-gia-form')
  const vtSel = sua ? NCC_VT.find(v => v.id === sua.vat_tu_id) : null
  const dvOpts = async vid => { const u = (await nccDonViList(vid)).filter(Boolean); return u.map((d, i) => `<option value="${d}"${(sua ? sua.don_vi === d : i === 0) ? ' selected' : ''}>${d}</option>`).join('') }   // '' khi vật tư chưa có đơn vị cơ sở
  box.innerHTML = `<div class="ncc-the" style="background:#f8fafc;margin-top:10px">
    <div class="ncc-hang-phai" style="align-items:flex-end;gap:10px">
      <div style="flex:1;min-width:200px"><label style="font-size:12px;color:#6b7280">Vật tư</label><br>
        ${sua ? `<b>${vtSel ? vtSel.ma + ' — ' + esc(vtSel.ten) : ''}</b>` : `<input class="ip ncc-gia-vt" placeholder="gõ mã / tên…" style="width:100%" autocomplete="off"><div class="ncc-goi" id="ncc-goi"></div>`}</div>
      <div><label style="font-size:12px;color:#6b7280">Đơn vị</label><br><select class="ip ncc-gia-dv" id="ncc-gia-dv" style="width:90px" ${sua ? '' : 'disabled'}>${sua ? await dvOpts(sua.vat_tu_id) : '<option>—</option>'}</select></div>
      <div><label style="font-size:12px;color:#6b7280">Đơn giá (chưa VAT)</label><br><input class="ip ncc-gia-dg" inputmode="numeric" style="width:110px;text-align:right" value="${sua ? dmFmt(sua.don_gia) : ''}"></div>
      <div><label style="font-size:12px;color:#6b7280">Lead time (ngày)</label><br><input class="ip ncc-gia-lt" inputmode="numeric" style="width:90px" value="${sua && sua.lead ? sua.lead : ''}"></div>
      <button class="n chinh" id="ncc-gia-luu">Lưu</button><button class="n" id="ncc-gia-huy">Huỷ</button>
    </div><div class="ncc-err" id="ncc-gia-err"></div></div>`
  let vtId = sua ? sua.vat_tu_id : null
  if (!sua) {
    const inp = box.querySelector('.ncc-gia-vt'), goi = $('#ncc-goi'), dvsel = $('#ncc-gia-dv')
    inp.oninput = () => {
      vtId = null; dvsel.disabled = true; dvsel.innerHTML = '<option>—</option>'
      const q = inp.value.trim().toLowerCase(); if (!q) { goi.innerHTML = ''; return }
      const kq = NCC_VT.filter(v => v.ma.toLowerCase().includes(q) || v.ten.toLowerCase().includes(q)).slice(0, 8)
      goi.innerHTML = kq.map(v => `<div class="dm-goi-item" data-vt="${v.id}">${v.ma} — ${esc(v.ten)}</div>`).join('') || '<div class="dm-goi-none">không thấy</div>'
      goi.querySelectorAll('.dm-goi-item').forEach(it => it.onmousedown = async e => {
        e.preventDefault(); const v = NCC_VT.find(x => x.id === it.dataset.vt); vtId = v.id; inp.value = `${v.ma} — ${v.ten}`; goi.innerHTML = ''
        const opts = await dvOpts(v.id), err = $('#ncc-gia-err')   // load đơn vị theo vat_tu_id (cơ sở + quy đổi), chọn sẵn cơ sở
        if (opts) { dvsel.innerHTML = opts; dvsel.disabled = false; err.textContent = '' }
        else { dvsel.innerHTML = '<option value="">—</option>'; dvsel.disabled = true; err.textContent = `Vật tư ${v.ma} chưa có đơn vị cơ sở — nhập ở tab "Đơn vị & hao hụt" trước.` }   // 2c: KHÔNG tự gán đơn vị cơ sở
      })
    }
    inp.onblur = () => setTimeout(() => goi.innerHTML = '', 150)
  }
  $('#ncc-gia-huy').onclick = () => box.innerHTML = ''
  $('#ncc-gia-luu').onclick = async () => {
    const err = box.querySelector('#ncc-gia-err')
    try {   // CẤM nuốt im lặng: mọi lỗi (JS lẫn RPC) hiện đỏ ngay dưới form
      err.textContent = ''
      if (!vtId) { err.textContent = 'Chọn vật tư (chọn từ gợi ý).'; return }
      // dùng class scoped theo box: các ô Đơn giá/Lead time chỉ có class, KHÔNG có id (bug L-85: $('#…') → null.value)
      const dv = box.querySelector('.ncc-gia-dv').value
      const dg = Number((box.querySelector('.ncc-gia-dg').value || '').replace(/\D/g, '')) || 0
      if (!dv) { err.textContent = 'Vật tư chưa có đơn vị cơ sở — nhập ở tab "Đơn vị & hao hụt" trước.'; return }
      const ltRaw = box.querySelector('.ncc-gia-lt').value.trim()
      const lt = ltRaw === '' ? null : Number(ltRaw)
      const r = await sb.rpc('gia_ncc_ghi', { p_ncc_id: ncc_id, p_vat_tu_id: vtId, p_don_vi: dv, p_don_gia: dg, p_lead_time_ngay: lt })
      if (r.error) { err.textContent = r.error.message; return }
      bao('Đã lưu giá NCC'); box.innerHTML = ''; veNcc()
    } catch (e) { if (err) err.textContent = 'Lỗi: ' + (e.message || e); else console.error('gia_ncc luu:', e) }
  }
}
async function nccLichSu(ncc_id) {
  const box = $('#ncc-ls'); if (box.dataset.open === ncc_id) { box.innerHTML = ''; box.dataset.open = ''; return }
  const { data } = await sb.from('gia_ncc_lich_su').select('truong,gia_tri_cu,gia_tri_moi,luc,vat_tu_id').eq('ncc_id', ncc_id).order('luc', { ascending: false }).limit(50)
  const vts = await nccVatTu(); const maOf = id => (vts.find(v => v.id === id) || {}).ma || ''
  box.dataset.open = ncc_id
  box.innerHTML = `<div class="ncc-the" style="margin-top:10px"><b>Lịch sử bảng giá</b>` + ((data || []).length
    ? `<table class="ncc-tbl" style="margin-top:6px"><thead><tr><th>Lúc</th><th>Mã</th><th>Trường</th><th>Cũ → Mới</th></tr></thead><tbody>${data.map(h => `<tr><td>${dmNgay(h.luc)}</td><td>${maOf(h.vat_tu_id)}</td><td>${h.truong}</td><td>${JSON.stringify(h.gia_tri_cu ?? '—')} → ${JSON.stringify(h.gia_tri_moi ?? '—')}</td></tr>`).join('')}</tbody></table>`
    : '<div class="ncc-mo" style="padding:6px 0">Chưa có thay đổi.</div>') + '</div>'
}

// ── phiếu nhập/xuất (nháp → ghi sổ) ──
const P = { nhap: null, xuat: null }
function tien(el) { const v = el.value.replace(/\D/g, ''); el.value = v ? Number(v).toLocaleString('vi-VN') : '' }
const soTien = el => Number(String(el.value).replace(/\D/g, '')) || 0
function moiPhieu(loai) { SO[loai]++; P[loai] = { loai, so: (loai === 'nhap' ? 'NK' : 'XK') + '-2026-' + String(SO[loai]).padStart(4, '0'), luc: new Date(), ncc: NCC[0]?.id, ly: 'Sản xuất', to: loai === 'xuat' ? (TO[0]?.ma_to || null) : null, ghi: '', tt: 'nhap', dong: [] }; themDong(loai) }
function themDong(loai) { P[loai].dong.push({ ma: KHO[0]?.ma, sl: 0, gia: KHO[0]?.gia || 0 }); vePhieu(loai) }
function xoaDong(loai, i) { P[loai].dong.splice(i, 1); if (!P[loai].dong.length) themDong(loai); vePhieu(loai) }
// Đổi VẬT TƯ (select onchange, KHÔNG phải gõ phím) -> vẽ lại toàn phiếu (đổi ĐVT/đơn giá/tồn sau).
function datDong(loai, i, truong, el) { const d = P[loai].dong[i]; d.ma = el.value; const v = KHO.find(x => x.ma === el.value); if (loai === 'nhap' && v) d.gia = v.gia; vePhieu(loai) }
// Gõ SỐ LƯỢNG / ĐƠN GIÁ (oninput): CHỈ cập nhật biến P + ô dẫn xuất bằng textContent. KHÔNG vẽ lại,
//   KHÔNG định dạng el.value lúc gõ (giữ nguyên chuỗi người nhập). -> con trỏ/focus không rời.
function datSo(loai, i, truong, el) {
  const d = P[loai].dong[i]
  if (truong === 'gia') d.gia = soTien(el)          // parse số, KHÔNG viết đè el.value
  else d.sl = Number(el.value) || 0
  capNhatDanXuat(loai, i)
}
// Cập nhật ô SỐ DẪN XUẤT bằng textContent (khớp đúng công thức vePhieu), không đụng ô đang gõ.
function capNhatDanXuat(loai, i) {
  const p = P[loai]; if (!p) return
  const d = p.dong[i]; const v = KHO.find(x => x.ma === d.ma) || { ton: 0, min: 0, gia: 0 }
  const ct = $(`#ct-${loai}-${i}`); if (ct) ct.textContent = n(d.sl * (loai === 'nhap' ? d.gia : v.gia))
  if (loai === 'xuat') { const sau = v.ton - d.sl; const ts = $(`#ts-${loai}-${i}`); if (ts) { ts.textContent = n(sau); ts.style.color = sau < 0 ? 'var(--do)' : sau < v.min ? 'var(--amber)' : '#6E7681' } }
  const tongSl = p.dong.reduce((s, x) => s + x.sl, 0), tongTien = p.dong.reduce((s, x) => s + x.sl * (x.gia || 0), 0)
  const sd = $(`#sd-${loai}`); if (sd) sd.textContent = p.dong.length
  const tsl = $(`#tsl-${loai}`); if (tsl) tsl.textContent = n(tongSl)
  const tt = $(`#tt-${loai}`); if (tt) tt.textContent = n(tongTien) + ' đ'
}
function optVt(ma) { const g = {}; KHO.forEach(x => (g[x.nhom] = g[x.nhom] || []).push(x)); const ten = Object.keys(g).sort((a, b) => { const av = a.startsWith('Ván') || a.startsWith('GỖ'), bv = b.startsWith('Ván') || b.startsWith('GỖ'); if (av !== bv) return av ? -1 : 1; return g[b].length - g[a].length }); return ten.map(t => `<optgroup label="${t} (${g[t].length})">` + g[t].map(x => `<option value="${x.ma}"${x.ma === ma ? ' selected' : ''}>${x.ma} — ${x.ten}</option>`).join('') + '</optgroup>').join('') }
function vePhieu(loai) {
  const p = P[loai]; if (!p) { $('#ph-' + loai).innerHTML = ''; return }
  const khoa = p.tt === 'so', ro = khoa ? 'disabled' : ''
  const tongTien = p.dong.reduce((s, d) => s + d.sl * (d.gia || 0), 0), tongSl = p.dong.reduce((s, d) => s + d.sl, 0)
  const dauNhap = `<div><label>Nhà cung cấp</label><select id="p-ncc" ${ro} onchange="P.nhap.ncc=this.value">${NCC.map(c => `<option value="${c.id}"${c.id === p.ncc ? ' selected' : ''}>${c.ten}</option>`).join('')}</select></div>`
  const dauXuat = `<div><label>Lý do xuất</label><select ${ro} onchange="P.xuat.ly=this.value">${['Sản xuất', 'Lắp đặt tại nhà khách', 'Hỏng / mất', 'Trả nhà cung cấp'].map(l => `<option${l === p.ly ? ' selected' : ''}>${l}</option>`).join('')}</select></div><div><label>Tổ nhận</label><select ${ro} onchange="P.xuat.to=this.value">${TO.map(t => `<option value="${t.ma_to}"${t.ma_to === p.to ? ' selected' : ''}>${t.ten}</option>`).join('')}</select></div>`
  $('#ph-' + loai).innerHTML = `<div class="ph-dau"><span class="ph-so">${p.so}</span><span class="tt ${khoa ? 'so' : 'nhap-tt'}">${khoa ? 'ĐÃ GHI SỔ' : 'NHÁP'}</span><span style="font-size:13px;color:var(--muted)">Lập lúc ${gio(p.luc)}</span>
    <span class="cach">${khoa ? `<button class="n nho" onclick="moiPhieu('${loai}');vePhieu('${loai}')">Lập phiếu mới</button>` : `<button class="n" onclick="themDong('${loai}')">+ Thêm dòng</button><button class="n chinh" onclick="ghiSo('${loai}')">Ghi sổ</button>`}</span>${khoa ? '' : `<span class="ghi-nhac">Ghi sổ rồi là <b>KHOÁ</b> — muốn sửa phải <b>huỷ phiếu</b> rồi làm lại. (Phiếu chưa ghi sổ sẽ mất nếu tải lại trang.)</span>`}</div>
    <div class="ph-than"><div class="hang"><div><label>Ngày chứng từ</label><input class="ip" type="date" ${ro} value="${ngayNghiepVu(p.luc)}" onchange="P['${loai}'].luc=new Date(this.value);vePhieu('${loai}')"></div>${loai === 'nhap' ? dauNhap : dauXuat}<div><label>Ghi chú</label><input class="ip" ${ro} value="${p.ghi}" placeholder="Số hoá đơn, người giao…" oninput="P['${loai}'].ghi=this.value"></div></div>
    <table><thead><tr><th style="width:30px">#</th><th>Vật tư</th><th class="r" style="width:110px">Số lượng</th><th style="width:56px">ĐVT</th>${loai === 'nhap' ? '<th class="r" style="width:130px">Đơn giá (đ)</th>' : '<th class="r" style="width:100px">Tồn sau</th>'}<th class="r" style="width:130px">${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}</th><th style="width:34px"></th></tr></thead><tbody>
    ${p.dong.map((d, i) => { const v = KHO.find(x => x.ma === d.ma) || { ton: 0, dvt: '', min: 0, gia: 0 }; const sau = v.ton - (loai === 'xuat' ? d.sl : -d.sl); return `<tr><td style="color:#8A8F96;font-size:12.5px">${i + 1}</td><td data-label="Vật tư">${khoa ? `<span style="font-size:13.5px">${v.ma || d.ma} — ${v.ten || ''}</span>` : `<select onchange="datDong('${loai}',${i},'ma',this)">${optVt(d.ma)}</select>`}</td><td class="r" data-label="Số lượng"><input class="ip num r" type="number" ${ro} value="${d.sl}" oninput="datSo('${loai}',${i},'sl',this)"></td><td style="color:#6E7681;font-size:13px" data-label="ĐVT">${v.dvt}</td>${loai === 'nhap' ? `<td class="r" data-label="Đơn giá"><input class="ip num r" ${ro} value="${n(d.gia)}" oninput="datSo('${loai}',${i},'gia',this)" onblur="tien(this)"></td>` : `<td id="ts-${loai}-${i}" class="r num" data-label="Tồn sau" style="color:${sau < 0 ? 'var(--do)' : sau < v.min ? 'var(--amber)' : '#6E7681'}">${n(sau)}</td>`}<td id="ct-${loai}-${i}" class="r num" data-label="${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}">${n(d.sl * (loai === 'nhap' ? d.gia : v.gia))}</td><td>${khoa ? '' : `<button class="xoa" onclick="xoaDong('${loai}',${i})">×</button>`}</td></tr>` }).join('')}</tbody></table></div>
    <div class="tong-ph"><div><span>Số dòng</span><b id="sd-${loai}">${p.dong.length}</b></div><div><span>Tổng số lượng</span><b id="tsl-${loai}">${n(tongSl)}</b></div><div><span>Tổng tiền</span><b id="tt-${loai}" style="color:var(--do)">${n(tongTien)} đ</b></div></div>`
}
async function ghiSo(loai) {
  const p = P[loai]; if (!p.dong.some(d => d.sl > 0)) { bao('Chưa dòng nào có số lượng.'); return }
  const dong = []; for (const d of p.dong) { if (d.sl <= 0) continue; const id = await maToId(d.ma); dong.push({ vat_tu_id: id, so_luong: d.sl, don_gia: loai === 'nhap' ? d.gia : null }) }
  const { data, error } = await sb.rpc('ghi_so_phieu', { p_loai: loai, p_ncc: loai === 'nhap' ? p.ncc : null, p_ly_do: loai === 'xuat' ? p.ly : null, p_ghi_chu: p.ghi, p_dong: dong, p_ma_to: loai === 'xuat' ? p.to : null })
  if (error) { bao('Ghi sổ lỗi: ' + error.message); return }
  p.tt = 'so'; p.so = data?.so_phieu || p.so; vePhieu(loai); await taiDuLieu(); veBang(); veDsPhieu(loai)
  bao(`Đã ghi sổ ${p.so}. Tồn + thẻ kho đã cập nhật.`)
}

// ── DANH SÁCH PHIẾU ĐÃ LẬP · XEM CHI TIẾT (chỉ đọc) · HUỶ PHIẾU (gọi RPC huy_phieu) ──
// Trang nhập hiện tiền tố NK (nhập) + HN (huỷ nhập); trang xuất hiện XK + HX. Phiếu ngược mang loai 'dieu_chinh'
// nên KHÔNG lọc theo loai mà lọc theo tiền tố mã phiếu.
// XSX = xuất back-flush (WP-33) hiện ở trang xuất. Lọc theo TIỀN TỐ (không theo loai) để giữ phiếu ĐẢO (dieu_chinh): HN ở nhập, HX ở xuất.
const PH_PRE = { nhap: ['NK', 'HN'], xuat: ['XK', 'HX', 'XSX'] }
let DSPH = { nhap: [], xuat: [] }, phGioi = { nhap: 50, xuat: 50 }, phXem = null

async function veDsPhieu(loai, gomDemo = false) {
  const el = $('#ds-' + loai); if (!el) return
  el.innerHTML = '<div class="rong">Đang tải…</div>'
  const pre = PH_PRE[loai]
  // Đơn giá/thành tiền ở phieu_dong (đã cấp quyền đọc ở migration 016). Vật tư nhúng để hiện tên.
  let query = sb.from('phieu')
    .select('id,so_phieu,loai,trang_thai,ncc_id,ly_do,phieu_goc_id,tao_luc,ghi_so_luc,ghi_so_boi,don_mua_id,la_demo,ma_don,mon_id,' +
            'ncc:ncc_id(ten), nguoi:ghi_so_boi(ho_ten), dm:don_mua_id(so_don), mon:mon_id(ten), dong:phieu_dong(so_luong,don_gia,thanh_tien, vt:vat_tu_id(ma,ten))')
    .or(pre.map(p => `so_phieu.like.${p}-*`).join(','))
  if (!gomDemo) query = query.eq('la_demo', false)   // WP-33/QD-46: phiếu demo (xuat_sx back-flush) lọc mặc định như 6 RPC tài chính
  const { data, error } = await query
    .order('tao_luc', { ascending: false })
    .limit(phGioi[loai])
  if (error) {   // KHÔNG để trống im lặng — báo rõ lỗi + nút thử lại
    el.innerHTML = `<div class="rong" style="color:var(--do)">Không tải được danh sách phiếu: ${error.message}. <button class="n nho" onclick="veDsPhieu('${loai}')">Thử lại</button></div>`; return
  }
  DSPH[loai] = data || []
  // Phiếu ngược trỏ phiếu gốc bằng phieu_goc_id — đổi ra mã phiếu (map từ tập vừa tải; thiếu thì hỏi thêm)
  const map = Object.fromEntries(DSPH[loai].map(r => [r.id, r.so_phieu]))
  const thieu = [...new Set(DSPH[loai].filter(r => r.phieu_goc_id && !map[r.phieu_goc_id]).map(r => r.phieu_goc_id))]
  if (thieu.length) { const { data: g } = await sb.from('phieu').select('id,so_phieu').in('id', thieu); (g || []).forEach(x => (map[x.id] = x.so_phieu)) }
  DSPH[loai].forEach(r => (r._goc = r.phieu_goc_id ? (map[r.phieu_goc_id] || 'phiếu gốc') : null))
  if (!DSPH[loai].length) { el.innerHTML = '<div class="rong">Chưa có phiếu nào.</div>'; return }
  el.innerHTML = DSPH[loai].map(r => {
    const dong = r.dong || [], sl = dong.reduce((s, d) => s + Number(d.so_luong || 0), 0), tien = dong.reduce((s, d) => s + Number(d.thanh_tien || 0), 0)
    const huy = r.trang_thai === 'da_huy', nguoc = !!r.phieu_goc_id
    const tag = huy ? '<span class="dsp-tag huy">ĐÃ HUỶ</span>'
      : nguoc ? `<span class="dsp-tag nguoc">↩ huỷ ${r._goc}</span>`
        : r.trang_thai === 'ghi_so' ? '<span class="dsp-tag so">ĐÃ GHI SỔ</span>' : '<span class="dsp-tag nhap">NHÁP</span>'
    const laSX = r.loai === 'xuat_sx'
    const nguon = r.dm?.so_don ? `<span class="dmn-chip nguon" data-dm="${r.don_mua_id}" title="Mở đơn mua">Đơn mua ${r.dm.so_don}</span>`
      : laSX ? `<span class="dsp-tag sx">Xuất SX</span> <span class="dmn-hist">${r.mon?.ten ? (r.ma_don || '') + ' · ' + r.mon.ten : (r.ma_don || 'đơn demo đã xoá')}</span>`
      : (loai === 'nhap' && !nguoc ? '<span class="dmn-hist">nhập tay</span>' : '')
    return `<div class="dsp-row ${huy ? 'huy' : ''}" onclick="moPhieuXem('${loai}','${r.id}')">
      <div><span class="dsp-so">${r.so_phieu}</span>${tag} ${nguon}</div>
      <div class="dsp-meta">${gio(new Date(r.tao_luc))}${r.ncc?.ten ? ' · ' + r.ncc.ten : ''} · ${dong.length} dòng · SL ${n(sl)} · ${n(tien)} đ · ${r.nguoi?.ho_ten || '—'}</div></div>`
  }).join('') + (DSPH[loai].length >= phGioi[loai] ? `<div class="dsp-more"><button class="n nho" onclick="phXemThem('${loai}')">Xem thêm</button></div>` : '')
  el.querySelectorAll('.dmn-chip.nguon').forEach(c => c.onclick = e => { e.stopPropagation(); chuyenMan('dm'); dmXem(c.dataset.dm) })
}
async function phXemThem(loai) { phGioi[loai] += 50; await veDsPhieu(loai) }

function moPhieuXem(loai, id) {
  const r = DSPH[loai].find(x => x.id === id); if (!r) return
  phXem = id
  const huy = r.trang_thai === 'da_huy', nguoc = !!r.phieu_goc_id, coHuy = r.trang_thai === 'ghi_so' && !nguoc
  const dong = r.dong || []
  const rows = dong.map((d, i) => `<tr><td>${i + 1}</td><td>${d.vt ? escA(d.vt.ma) + ' — ' + escA(d.vt.ten) : '—'}</td><td class="r">${n(d.so_luong)}</td><td class="r">${d.don_gia != null ? n(d.don_gia) : '—'}</td><td class="r">${d.thanh_tien != null ? n(d.thanh_tien) : '—'}</td></tr>`).join('')
  const tag = huy ? '<span class="dsp-tag huy">ĐÃ HUỶ</span>' : nguoc ? `<span class="dsp-tag nguoc">↩ huỷ ${r._goc}</span>` : '<span class="dsp-tag so">ĐÃ GHI SỔ</span>'
  $('#the').innerHTML = `<div class="the-dau"><div><h3 id="xem-so">${r.so_phieu} ${tag}</h3><div class="m">${loai === 'nhap' ? 'Phiếu nhập' : 'Phiếu xuất'} · lập ${gio(new Date(r.tao_luc))}</div></div><button class="x" onclick="dongThe()" style="margin-left:auto">×</button></div>
    <div class="the-than">
      <div class="dsp-meta" style="margin-bottom:8px">${r.ncc?.ten ? 'NCC: ' + escA(r.ncc.ten) + ' · ' : ''}Người ghi: ${r.nguoi?.ho_ten ? escA(r.nguoi.ho_ten) : '—'}${r.ly_do ? ' · Lý do: ' + escA(r.ly_do) : ''}${nguoc ? ' · Đây là phiếu NGƯỢC, huỷ ' + r._goc : ''}</div>
      <table class="ph-dong-tb" id="xem-dong"><thead><tr><th style="width:26px">#</th><th>Vật tư</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="dsp-meta">Bảng này <b>chỉ đọc</b> — phiếu đã ghi sổ không sửa được; muốn đổi thì huỷ phiếu.</div>
      ${coHuy ? `<div style="margin-top:14px"><button class="n do" id="xem-huy" onclick="moXacNhanHuy('${loai}','${id}')">Huỷ phiếu</button></div>` : ''}
    </div>`
  $('#the').classList.add('on')
}

function moXacNhanHuy(loai, id) {
  const r = DSPH[loai].find(x => x.id === id); if (!r) return
  const giam = r.loai === 'nhap'   // huỷ phiếu nhập -> tồn GIẢM; huỷ phiếu xuất -> tồn TĂNG
  $('#the').innerHTML = `<div class="the-dau"><div><h3>Huỷ phiếu ${r.so_phieu}?</h3></div><button class="x" onclick="moPhieuXem('${loai}','${id}')" style="margin-left:auto">×</button></div>
    <div class="the-than huy-box">
      <div class="chua" style="margin-bottom:10px">Huỷ phiếu <b>không xoá</b> phiếu gốc — nó vẫn nằm trong sổ và bị đánh dấu <b>ĐÃ HUỶ</b>. Hệ thống tạo thêm một <b>phiếu ngược</b> (mã ${giam ? 'HN' : 'HX'}) đảo lại tác động. Tồn kho các mã trong phiếu sẽ <b>${giam ? 'GIẢM' : 'TĂNG'}</b> ${giam ? '(hoàn lại lượng đã nhập)' : '(hoàn lại lượng đã xuất)'}.</div>
      <label>Lý do huỷ (bắt buộc)</label>
      <textarea id="huy-lydo" placeholder="Ví dụ: nhập nhầm số lượng, sai nhà cung cấp…" oninput="document.getElementById('huy-ok').disabled = !this.value.trim()"></textarea>
      <div id="huy-err" style="color:var(--do);font-size:13px;margin-top:8px;white-space:pre-wrap"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="n do" id="huy-ok" disabled onclick="xacNhanHuy('${loai}','${id}','${r.so_phieu}')">Xác nhận huỷ</button>
        <button class="n" onclick="moPhieuXem('${loai}','${id}')">Không huỷ</button></div>
    </div>`
  $('#the').classList.add('on')
}
async function xacNhanHuy(loai, id, so) {
  const ta = document.getElementById('huy-lydo'), ly = (ta.value || '').trim(); if (!ly) return
  const btn = document.getElementById('huy-ok'), err = document.getElementById('huy-err')
  btn.disabled = true; btn.textContent = 'Đang huỷ…'; err.textContent = ''
  const { data, error } = await sb.rpc('huy_phieu', { p_so_phieu: so, p_ly_do: ly })
  if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'Xác nhận huỷ'; return }   // hiện NGUYÊN VĂN lỗi máy chủ (gồm ca xuất một phần)
  bao(`Đã huỷ ${so}. Phiếu ngược: ${data}`)
  await taiDuLieu(); veBang(); await veDsPhieu(loai); moPhieuXem(loai, id)
}

function bao(t) { let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#2A323C;color:#fff;padding:11px 20px;border-radius:4px;font-size:14px;z-index:70;box-shadow:0 6px 20px rgba(0,0,0,.28);max-width:min(92vw,620px)'; document.body.appendChild(e) } e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', 4200) }

// ═══════════ GHÉP MÃ PLUGIN — đọc/ghi kho.plugin_ma_map (map MÃ plugin ↔ mã kho; đổi tên từ quy_doi ở WP-36) ═══════════
let GHEP = [], gmFilter = 'tat_ca'
const gmSelectCols = 'id,mo_ta_thiet_ke,ten_mo_ta,ma_plugin,dvt_plugin,gia_plugin,nhom_dinh_muc,ma_kho,he_so_quy_doi,muc_tin_cay,la_mac_dinh,trang_thai,ghi_chu'
const gmKm = () => Object.fromEntries(KHO.map(x => [x.ma, x]))   // ma -> {ten,nhom,dvt,ton,gia(=giá vốn)}
const gmActive = g => g.rows.find(r => r.la_mac_dinh) || g.rows[0]
const gmCoUV = g => g.rows.some(r => r.ma_kho)
const gmChotRoi = g => g.rows.some(r => r.trang_thai === 'DA_DUYET' || r.trang_thai === 'KHONG_GHEP')

// So gia_plugin với giá vốn kho của ứng viên ĐANG CHỌN (chia hệ số). Chưa có giá vốn -> null (không cảnh báo giả).
function gmWarn(g) {
  const act = gmActive(g)
  if (!act || !act.ma_kho || g.gia == null) return null
  const k = gmKm()[act.ma_kho]; if (!k || !k.gia) return null
  const heso = Number(act.he_so_quy_doi) || 1, eff = k.gia / heso
  const lech = (g.gia - eff) / eff * 100
  if (Math.abs(lech) <= 20) return null
  return { lo: g.gia < eff, plugin: g.gia, eff, lech }
}
function gmWarnHtml(g) {
  const w = gmWarn(g); if (!w) return ''
  const t = w.lo
    ? `⚠ Giá plugin <b>${n(w.plugin)}</b> THẤP HƠN giá vốn kho <b>${n(w.eff)}</b> — lệch <b>${w.lech.toFixed(0)}%</b>. Plugin thấp hơn nghĩa là báo giá đang <b>THIẾU tiền</b>.`
    : `ℹ Giá plugin <b>${n(w.plugin)}</b> CAO HƠN giá vốn kho <b>${n(w.eff)}</b> — lệch <b>+${w.lech.toFixed(0)}%</b>. Plugin cao hơn nghĩa là báo giá đang <b>ĐẮT hơn thực tế</b>.`
  return `<div class="cbao ${w.lo ? 'lo' : ''}">${t}</div>`
}

async function veGhepMa() {
  const el = $('#gm-ds'); if (!el) return
  el.innerHTML = '<div class="rong">Đang tải…</div>'
  const { data, error } = await sb.from('plugin_ma_map').select(gmSelectCols)
    .order('mo_ta_thiet_ke').order('la_mac_dinh', { ascending: false }).order('ma_kho', { nullsFirst: false })
  if (error) { el.innerHTML = `<div class="gm-loi">Không tải được bảng ghép mã: ${error.message}. <button class="nut" onclick="veGhepMa()">Thử lại</button></div>`; return }
  const g = {}
  ;(data || []).forEach(r => { (g[r.mo_ta_thiet_ke] ||= { mo_ta: r.mo_ta_thiet_ke, ten: r.ten_mo_ta, mp: r.ma_plugin, dvt: r.dvt_plugin, gia: r.gia_plugin, nhom: r.nhom_dinh_muc, rows: [] }).rows.push(r) })
  GHEP = Object.values(g).sort((a, b) => a.mo_ta < b.mo_ta ? -1 : 1)
  if (!GHEP.length) { el.innerHTML = '<div class="rong">Bảng quy đổi trống.</div>'; return }
  el.innerHTML = GHEP.map(gmKhoiHtml).join('')
  gmDem(); gmLoc(); gmCanhBao()
}

// ── CẢNH BÁO mã kho CHƯA nằm trong bảng quy_doi (mã mới thủ kho thêm mà chưa ai ghép) ──
// Dấu "không liên quan" lưu ở localStorage (key gm_bo_qua) — KHÔNG tạo bảng mới. Xem báo cáo §chỗ-lưu.
function gmBoQua() { try { return new Set(JSON.parse(localStorage.getItem('gm_bo_qua') || '[]')) } catch { return new Set() } }
async function gmCanhBao() {
  const el = $('#gm-canhbao'), box = $('#gm-chuaghep'); if (!el) return
  const { data, error } = await sb.from('plugin_ma_map').select('ma_kho')
  if (error) { el.style.display = 'none'; return }
  const daCo = new Set((data || []).map(r => r.ma_kho).filter(Boolean))   // mã kho đã có TRONG bảng (bất kỳ dòng nào)
  const boQua = gmBoQua()
  const chua = KHO.filter(x => !daCo.has(x.ma) && !boQua.has(x.ma))
  window._gmChua = chua
  if (!chua.length) { el.style.display = 'none'; if (box) box.style.display = 'none'; return }
  el.style.display = 'block'
  el.innerHTML = `⚠ Có <b>${chua.length}</b> mã vật tư trong kho CHƯA nằm trong bảng quy đổi (thủ kho thêm mã mới, chưa ai ghép). Bảng sẽ mục ruỗng dần nếu bỏ sót — <b>bấm để xem danh sách</b> rồi quyết mã nào cần thêm.`
  if (box && box.style.display === 'block') gmRenderChua()   // đang mở -> cập nhật lại
}
function gmRenderChua() {
  const box = $('#gm-chuaghep'), chua = window._gmChua || []
  box.innerHTML = chua.length ? chua.map(x => `<div class="gm-chua-row">
      <span class="u-ma">${x.ma}</span>
      <span class="u-ten">${escA(x.ten)} · ${x.nhom}</span>
      <span class="u-so">tồn ${x.ton != null ? x.ton : '—'} · vốn ${x.gia ? n(x.gia) + 'đ' : '—'}</span>
      <button class="gm-ghep-btn" onclick="gmMoGhepVao('${x.ma}')">+ Ghép vào mô tả</button>
      <button class="nut" onclick="gmBoQuaMa('${x.ma}')">Không liên quan</button>
      <div class="gm-ghep-slot" id="gm-ghep-${x.ma}" style="flex-basis:100%"></div></div>`).join('')
    : '<div class="trong">Không còn mã nào chưa ghép.</div>'
}
function gmMoChua() {
  const box = $('#gm-chuaghep'); if (!box) return
  if (box.style.display === 'block') { box.style.display = 'none'; return }
  gmRenderChua(); box.style.display = 'block'
}
function gmBoQuaMa(ma) {
  const s = gmBoQua(); s.add(ma); localStorage.setItem('gm_bo_qua', JSON.stringify([...s]))
  bao(`Đã đánh dấu ${ma} là KHÔNG LIÊN QUAN — lần sau không đếm nữa.`)
  gmCanhBao()   // đếm lại (giảm 1) + cập nhật danh sách nếu đang mở
}

// ── XUẤT bảng quy đổi: dựng file GIỐNG HỆT web/ops/xuat_quy_doi.mjs, tải về máy ──
async function gmXuat() {
  const { data, error } = await sb.from('plugin_ma_map').select('mo_ta_thiet_ke,trang_thai,la_mac_dinh')
  if (error) { bao('Đọc quy_doi lỗi: ' + error.message); return }
  const soMoTa = new Set((data || []).map(r => r.mo_ta_thiet_ke)).size
  const daDuyet = (data || []).filter(r => r.trang_thai === 'DA_DUYET' && r.la_mac_dinh).length
  if (daDuyet === 0) { bao('Chưa có dòng nào ĐÃ DUYỆT — không có gì để xuất (không tải file rỗng).'); return }
  const conLai = soMoTa - daDuyet
  if (conLai > 0) {
    gmModal(`Xuất bây giờ: <b>${daDuyet}</b> mô tả CÓ giá kho (sẽ ghi vào file). Còn <b>${conLai}</b> mô tả CHƯA chốt — plugin vẫn phải dùng <b>giá cũ</b> cho các mã này. Làm dần từng phần là hợp lý — vẫn xuất phần đã có?`, 'Xuất', () => gmTaiFile())
  } else {
    gmTaiFile()
  }
}
function gmModalDong() { const m = $('#gm-modal'); if (m) m.style.display = 'none' }
async function gmTaiFile() {
  // ĐỌC + DỰNG y hệt xuat_quy_doi.mjs: chỉ DA_DUYET+la_mac_dinh, sắp theo mo_ta_thiet_ke, giá vốn từ v_ton_gia_von (raw, null giữ nguyên)
  const { data, error } = await sb.from('plugin_ma_map')
    .select('mo_ta_thiet_ke,ma_plugin,ma_kho,he_so_quy_doi,tao_luc')
    .eq('trang_thai', 'DA_DUYET').eq('la_mac_dinh', true).order('mo_ta_thiet_ke', { ascending: true })
  if (error) { bao('Đọc quy_doi lỗi: ' + error.message); return }
  if (!data.length) { bao('Chưa có dòng ĐÃ DUYỆT — không có gì để xuất.'); return }
  const gv = {}
  const { data: vg } = await sb.from('v_ton_gia_von').select('gia_von_bq, vat_tu:vat_tu_id(ma)')
  ;(vg || []).forEach(r => { if (r.vat_tu) gv[r.vat_tu.ma] = r.gia_von_bq == null ? null : Number(r.gia_von_bq) })
  const quy_doi = data.map(r => ({
    mo_ta_thiet_ke: r.mo_ta_thiet_ke,
    ma_plugin: r.ma_plugin,
    ma_kho: r.ma_kho,
    he_so_quy_doi: Number(r.he_so_quy_doi),
    gia_von_kho: (r.ma_kho in gv) ? gv[r.ma_kho] : null,
  }))
  const moc = data.reduce((m, r) => (r.tao_luc > m ? r.tao_luc : m), data[0].tao_luc)   // MAX(tao_luc); test bỏ qua dấu thời gian
  const doc = { thoi_gian_xuat: moc, so_dong: quy_doi.length, quy_doi }
  const noiDung = JSON.stringify(doc, null, 2) + '\n'
  const d = new Date(), p2 = x => String(x).padStart(2, '0')
  const fn = `quy_doi_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`
  const blob = new Blob([noiDung], { type: 'application/json' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => window.URL.revokeObjectURL(url), 1500)
  bao(`Đã xuất ${quy_doi.length} dòng ĐÃ DUYỆT ra file ${fn}. Chép file này vào repo plugin để báo giá dùng giá vốn kho.`)
}

function gmKhoiHtml(g) {
  const km = gmKm(), act = gmActive(g), coUV = gmCoUV(g), chot = gmChotRoi(g)
  const bo = g.rows.some(r => r.trang_thai === 'KHONG_GHEP')
  const badge = { A: 'A · hình học', B: 'B · theo mét/m²', C: 'C · khách chọn' }[g.nhom] || g.nhom || '—'
  const ttTxt = bo ? '<span class="tt tt-bo">KHÔNG GHÉP</span>' : chot ? '<span class="tt tt-duyet">ĐÃ DUYỆT</span>' : '<span class="tt tt-chua">CHƯA CHỐT</span>'
  const nhac = coUV ? 'Chọn một mã kho làm mặc định (bấm Chọn), hoặc Không ghép nếu không mã nào đúng.' : 'Kho chưa có mã khớp — nhập lý do rồi bấm Không ghép.'
  let phai
  if (!coUV) {
    phai = `<div class="trong">Kho chưa có mã nào khớp. Nhập lý do vào ô ghi chú rồi bấm <b>Không ghép</b>.</div>`
  } else {
    phai = g.rows.filter(r => r.ma_kho).map(r => {
      const k = km[r.ma_kho] || {}
      const giaTxt = k.gia ? `vốn <b class="tien">${n(k.gia)}đ</b>` : '<b style="color:var(--amber)">chưa có giá vốn</b>'
      const tc = { CHAC: '<span class="tc tc-chac">CHẮC</span>', NGO: '<span class="tc tc-ngo">NGỜ</span>', CHUA_RO: '<span class="tc tc-chuaro">CHƯA RÕ</span>' }[r.muc_tin_cay] || ''
      const md = r.la_mac_dinh ? ' <span class="tc tc-ngo">mặc định</span>' : ''
      const chon = r.la_mac_dinh && r.trang_thai === 'DA_DUYET'
      return `<div class="uv${r.la_mac_dinh ? ' dexuat' : ''}${chon ? ' chon' : ''}">
        <span class="u-ma">${r.ma_kho}</span>
        <span class="u-ten">${escA(k.ten || r.ma_kho)}${k.nhom ? ` · ${k.nhom}` : ''} ${tc}${md}</span>
        <span class="u-so">${k.dvt || ''} · ${giaTxt} · tồn <span class="num">${k.ton != null ? k.ton : '—'}</span></span>
        <button class="nut${chon ? ' on' : ''}" onclick="gmChon('${r.id}','${g.mo_ta}')">${chon ? '✓ Đã chọn' : 'Chọn'}</button>
        <button class="nut gm-xoa" title="Xoá ứng viên khỏi mô tả" onclick="gmXoaUngVien('${r.id}','${g.mo_ta}')">🗑</button></div>`
    }).join('')
  }
  const hsHtml = coUV ? `<div class="hs">Hệ số quy đổi (1 đơn vị kho = ? đơn vị plugin) <input class="gm-ip" type="number" min="0" step="any" value="${act && Number(act.he_so_quy_doi) !== 1 ? act.he_so_quy_doi : ''}" placeholder="1" data-hs="${act ? act.id : ''}" data-mota="${g.mo_ta}"></div>` : ''
  return `<div class="khoi ${chot ? 'chot' : ''} ${bo ? 'bo' : ''}" id="gm-k-${g.mo_ta}">
    <div class="khoi-nhac">${nhac}</div>
    <div class="khoi-than">
      <div class="trai">
        <div class="mp">${g.mp} ${ttTxt}</div>
        <div class="mota">${escA(g.ten)}</div>
        <div class="meta">Đơn vị: <b>${g.dvt || '—'}</b> · giá plugin: <b class="tien">${g.gia == null ? '(tra bảng)' : n(g.gia)}</b></div>
        <span class="badge b-${g.nhom || 'A'}">${badge}</span>
      </div>
      <div class="phai">
        ${phai}
        ${hsHtml}
        <div class="gm-them-wrap"><button class="nut" onclick="gmMoThem('${g.mo_ta}')">+ Thêm mã kho khác</button>
          <span class="gm-them-note">Dùng khi các mã gợi ý trên đều KHÔNG đúng — tìm và thêm mã kho bất kỳ.</span></div>
        <div class="gm-them-slot" id="gm-them-${g.mo_ta}"></div>
        <div style="margin-top:8px"><button class="nut bo${bo ? ' on' : ''}" onclick="gmKhongGhep('${g.mo_ta}')">${bo ? '✓ Không ghép' : 'Không ghép (kho chưa có hàng)'}</button></div>
        <div class="gm-cbao-slot">${gmWarnHtml(g)}</div>
        <div class="ghi"><label>Ghi chú (lý do chọn / không ghép):</label><input class="gm-ip" value="${escA((act && act.ghi_chu) || '')}" data-ghi="${act ? act.id : ''}" data-mota="${g.mo_ta}" placeholder="ví dụ: đúng hàng đang mua…"></div>
      </div>
    </div>
  </div>`
}

function gmDem() {
  let chot = 0, cbao = 0
  GHEP.forEach(g => { if (gmChotRoi(g)) chot++; if (gmWarn(g)) cbao++ })
  $('#gm-chot').textContent = chot; $('#gm-conlai').textContent = GHEP.length - chot; $('#gm-cbao').textContent = cbao
}
function gmLoc() {
  GHEP.forEach(g => {
    const el = $(`#gm-k-${g.mo_ta}`); if (!el) return
    let hien = true
    if (gmFilter === 'chua_chot') hien = !gmChotRoi(g)
    else if (gmFilter === 'cbao') hien = !!gmWarn(g)
    else if (gmFilter === 'khong_uv') hien = !gmCoUV(g)
    el.style.display = hien ? '' : 'none'
  })
}
async function gmReload(mo_ta) {
  const { data } = await sb.from('plugin_ma_map').select(gmSelectCols).eq('mo_ta_thiet_ke', mo_ta)
    .order('la_mac_dinh', { ascending: false }).order('ma_kho', { nullsFirst: false })
  const g = GHEP.find(x => x.mo_ta === mo_ta)
  if (g && data && data.length) { g.rows = data; g.ten = data[0].ten_mo_ta ?? g.ten }
  const el = $(`#gm-k-${mo_ta}`); if (el && g) el.outerHTML = gmKhoiHtml(g)
  gmDem(); gmLoc()
}

// CHỌN ứng viên: BỎ cờ mặc định cũ TRƯỚC (tránh vi phạm ràng buộc 1-mặc-định), rồi đặt cờ mới + DA_DUYET.
async function gmChon(id, mo_ta) {
  const g = GHEP.find(x => x.mo_ta === mo_ta), row = g && g.rows.find(r => r.id === id)
  // BỎ CHỌN: bấm lại ứng viên đang chọn -> về CHUA_DUYET, không mặc định (để đổi / xoá được).
  if (row && row.la_mac_dinh && row.trang_thai === 'DA_DUYET') {
    const { error } = await sb.from('plugin_ma_map').update({ la_mac_dinh: false, trang_thai: 'CHUA_DUYET', nguoi_duyet: null, duyet_luc: null }).eq('id', id)
    if (error) { bao('Bỏ chọn lỗi: ' + error.message); return }
    bao('Đã BỎ CHỌN mã kho cho mô tả này.'); return gmReload(mo_ta)
  }
  // CHỌN: revert DA_DUYET cũ về CHUA_DUYET + bỏ MỌI cờ mặc định TRƯỚC (ràng buộc 1-mặc-định) rồi đặt cờ mới.
  const eR = (await sb.from('plugin_ma_map').update({ trang_thai: 'CHUA_DUYET', nguoi_duyet: null, duyet_luc: null }).eq('mo_ta_thiet_ke', mo_ta).eq('trang_thai', 'DA_DUYET')).error
  const eC = (await sb.from('plugin_ma_map').update({ la_mac_dinh: false }).eq('mo_ta_thiet_ke', mo_ta)).error
  if (eR || eC) { bao('Bỏ cờ mặc định cũ lỗi: ' + (eR || eC).message); return }
  const { error } = await sb.from('plugin_ma_map').update({ la_mac_dinh: true, trang_thai: 'DA_DUYET', nguoi_duyet: ME_ID, duyet_luc: new Date().toISOString() }).eq('id', id)
  if (error) { bao('Chốt lỗi: ' + error.message); return }   // hiện NGUYÊN VĂN lỗi (gồm lỗi ràng buộc)
  bao('Đã chốt mã kho mặc định cho mô tả này.')
  await gmReload(mo_ta)
}

// Hộp xác nhận dùng chung (tái dùng #gm-modal): msg + nhãn nút OK + việc khi OK.
function gmModal(msgHtml, okLabel, onOk) {
  $('#gm-modal-msg').innerHTML = msgHtml
  const ok = $('#gm-modal-ok'); ok.textContent = okLabel; ok.onclick = () => { gmModalDong(); onOk() }
  $('#gm-modal').style.display = 'flex'
}

// THÊM 1 mã kho làm ứng viên MỚI của mô tả (VIỆC 1 + 2). Chặn TRÙNG trước (ràng buộc uniq mo_ta+ma_kho).
async function gmThemUngVien(mo_ta, ma) {
  const g = GHEP.find(x => x.mo_ta === mo_ta); if (!g) return
  if (g.rows.some(r => r.ma_kho === ma)) { bao(`Mã ${ma} ĐÃ là ứng viên của mô tả này — không thêm trùng.`); return }
  const khac = GHEP.filter(x => x.mo_ta !== mo_ta && x.rows.some(r => r.ma_kho === ma)).map(x => x.mo_ta)
  const { error } = await sb.from('plugin_ma_map').insert({
    mo_ta_thiet_ke: mo_ta, ten_mo_ta: g.ten, ma_plugin: g.mp, dvt_plugin: g.dvt, gia_plugin: g.gia,
    nhom_dinh_muc: g.nhom, ma_kho: ma, he_so_quy_doi: 1, muc_tin_cay: 'CHUA_RO', la_mac_dinh: false,
    trang_thai: 'CHUA_DUYET', ghi_chu: 'CEO thêm tay từ giao diện'
  })
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) { bao(`Mã ${ma} ĐÃ là ứng viên của mô tả này — không thêm trùng.`); return }
    bao('Thêm lỗi: ' + error.message); return   // hiện nguyên văn lỗi khác
  }
  bao(`Đã thêm ${ma} vào mô tả${khac.length ? ` (LƯU Ý: mã này cũng đang dùng ở: ${khac.join(', ')})` : ''}.`)
  await gmReload(mo_ta); gmCanhBao()
}

// VIỆC 1 — picker tìm mã kho trong khối
function gmMoThem(mo_ta) {
  const slot = $(`#gm-them-${mo_ta}`); if (!slot) return
  if (slot.dataset.open === '1') { slot.innerHTML = ''; slot.dataset.open = ''; return }
  slot.dataset.open = '1'
  slot.innerHTML = `<input class="gm-ip gm-them-tim" placeholder="Gõ MÃ hoặc TÊN kho để tìm…" oninput="gmThemLoc('${mo_ta}')"><div class="gm-them-kq"></div>`
  const inp = slot.querySelector('.gm-them-tim'); if (inp) inp.focus()
  gmThemLoc(mo_ta)
}
function gmThemLoc(mo_ta) {
  const slot = $(`#gm-them-${mo_ta}`); if (!slot) return
  const inp = slot.querySelector('.gm-them-tim'), kq = slot.querySelector('.gm-them-kq')
  const q = (inp ? inp.value : '').trim().toLowerCase()
  const g = GHEP.find(x => x.mo_ta === mo_ta), coRoi = new Set(g ? g.rows.map(r => r.ma_kho) : [])
  let ds = KHO
  if (q) ds = ds.filter(x => x.ma.toLowerCase().includes(q) || (x.ten || '').toLowerCase().includes(q))
  ds = ds.slice(0, 25)
  kq.innerHTML = ds.length ? ds.map(x => `<div class="gm-them-row">
      <span class="u-ma">${x.ma}</span><span class="u-ten">${escA(x.ten)} · ${x.nhom}${coRoi.has(x.ma) ? ' <span class="tc tc-chuaro">đã có</span>' : ''}</span>
      <span class="u-so">${x.dvt || ''} · vốn ${x.gia ? n(x.gia) + 'đ' : '—'} · tồn ${x.ton != null ? x.ton : '—'}</span>
      <button class="nut" onclick="gmThemUngVien('${mo_ta}','${x.ma}')">Chọn</button></div>`).join('')
    : `<div class="trong">${q ? 'Không mã nào khớp.' : 'Gõ để tìm mã kho.'}</div>`
}

// VIỆC 2 — từ danh sách mã chưa ghép: chọn MÔ TẢ để ghép vào
function gmMoGhepVao(ma) {
  const slot = $(`#gm-ghep-${ma}`); if (!slot) return
  if (slot.dataset.open === '1') { slot.innerHTML = ''; slot.dataset.open = ''; return }
  slot.dataset.open = '1'
  slot.innerHTML = `<input class="gm-ip gm-ghep-tim" placeholder="Gõ để tìm mô tả thiết kế…" oninput="gmGhepLoc('${ma}')"><div class="gm-ghep-kq"></div>`
  const inp = slot.querySelector('.gm-ghep-tim'); if (inp) inp.focus()
  gmGhepLoc(ma)
}
function gmGhepLoc(ma) {
  const slot = $(`#gm-ghep-${ma}`); if (!slot) return
  const inp = slot.querySelector('.gm-ghep-tim'), kq = slot.querySelector('.gm-ghep-kq')
  const q = (inp ? inp.value : '').trim().toLowerCase()
  let ds = GHEP
  if (q) ds = ds.filter(g => g.mo_ta.toLowerCase().includes(q) || (g.ten || '').toLowerCase().includes(q) || (g.mp || '').toLowerCase().includes(q))
  ds = ds.slice(0, 25)
  kq.innerHTML = ds.length ? ds.map(g => `<div class="gm-them-row">
      <span class="u-ma">${g.mp}</span><span class="u-ten">${escA(g.ten)}</span>
      <button class="nut" onclick="gmGhepVaoChon('${g.mo_ta}','${ma}')">Ghép</button></div>`).join('')
    : `<div class="trong">${q ? 'Không mô tả nào khớp.' : 'Gõ để tìm mô tả.'}</div>`
}
async function gmGhepVaoChon(mo_ta, ma) { await gmThemUngVien(mo_ta, ma) }   // thêm + gmCanhBao (dải giảm 1)

// VIỆC 3 — xoá ứng viên (chỉ khi KHÔNG mặc định + chưa duyệt). Hỏi xác nhận, xoá hẳn dòng.
async function gmXoaUngVien(id, mo_ta) {
  const g = GHEP.find(x => x.mo_ta === mo_ta), row = g && g.rows.find(r => r.id === id)
  if (!row) return
  if (row.la_mac_dinh || row.trang_thai === 'DA_DUYET') { bao('Ứng viên đang là MẶC ĐỊNH / đã duyệt — BỎ CHỌN trước khi xoá (bấm lại nút Đã chọn).'); return }
  gmModal(`Xoá hẳn ứng viên <b>${row.ma_kho}</b> khỏi mô tả này? Không hoàn tác được.`, 'Xoá', async () => {
    const { error } = await sb.from('plugin_ma_map').delete().eq('id', id)
    if (error) { bao('Xoá lỗi: ' + error.message); return }
    bao(`Đã xoá ứng viên ${row.ma_kho}.`)
    await gmReload(mo_ta); gmCanhBao()
  })
}
// KHÔNG GHÉP: bắt buộc có ghi chú (app chặn TRƯỚC, không để lỗi CSDL bắn thô).
async function gmKhongGhep(mo_ta) {
  const g = GHEP.find(x => x.mo_ta === mo_ta); if (!g) return
  const ghiInp = $(`#gm-k-${mo_ta} [data-ghi]`), ly = (ghiInp ? ghiInp.value : '').trim()
  if (!ly) { bao('Nhập LÝ DO vào ô ghi chú trước khi bấm Không ghép.'); if (ghiInp) ghiInp.focus(); return }
  const primary = gmActive(g)
  const { error } = await sb.from('plugin_ma_map').update({ trang_thai: 'KHONG_GHEP', ma_kho: null, la_mac_dinh: false, ghi_chu: ly, nguoi_duyet: ME_ID, duyet_luc: new Date().toISOString() }).eq('id', primary.id)
  if (error) { bao('Lưu Không ghép lỗi: ' + error.message); return }
  bao(`Đã đánh dấu KHÔNG GHÉP: ${g.mp}.`)
  await gmReload(mo_ta)
}

function gmGanSuKien() {
  const ds = $('#gm-ds'); if (!ds || ds._gm) return; ds._gm = 1
  // gõ hệ số -> cảnh báo tính lại NGAY (chưa lưu); blur/Enter -> LƯU
  ds.addEventListener('input', e => {
    const t = e.target; if (t.dataset.hs == null) return
    const g = GHEP.find(x => x.mo_ta === t.dataset.mota); if (!g) return
    const act = gmActive(g), v = parseFloat(t.value), tmp = act.he_so_quy_doi
    act.he_so_quy_doi = (v > 0) ? v : 1
    const slot = $(`#gm-k-${g.mo_ta} .gm-cbao-slot`); if (slot) slot.innerHTML = gmWarnHtml(g)
    act.he_so_quy_doi = tmp
  })
  ds.addEventListener('change', async e => {
    const t = e.target
    if (t.dataset.hs != null && t.dataset.hs !== '') {
      const val = t.value.trim()
      if (val !== '' && !(parseFloat(val) > 0)) { bao('Hệ số quy đổi phải là số DƯƠNG.'); t.value = ''; return }
      const so = val === '' ? 1 : parseFloat(val)
      const { error } = await sb.from('plugin_ma_map').update({ he_so_quy_doi: so }).eq('id', t.dataset.hs)
      if (error) { bao('Lưu hệ số lỗi: ' + error.message); return }
      const g = GHEP.find(x => x.mo_ta === t.dataset.mota), row = g && g.rows.find(r => r.id === t.dataset.hs); if (row) row.he_so_quy_doi = so
      const slot = $(`#gm-k-${t.dataset.mota} .gm-cbao-slot`); if (slot && g) slot.innerHTML = gmWarnHtml(g)
      gmDem(); gmLoc(); bao('Đã lưu hệ số quy đổi.')
    } else if (t.dataset.ghi != null && t.dataset.ghi !== '') {
      const { error } = await sb.from('plugin_ma_map').update({ ghi_chu: t.value }).eq('id', t.dataset.ghi)
      if (error) { bao('Lưu ghi chú lỗi: ' + error.message); return }
      const g = GHEP.find(x => x.mo_ta === t.dataset.mota), row = g && g.rows.find(r => r.id === t.dataset.ghi); if (row) row.ghi_chu = t.value
      bao('Đã lưu ghi chú.')
    }
  })
  $('#gm-loc').addEventListener('click', e => {
    const c = e.target.closest('.gm-chip'); if (!c) return
    gmFilter = c.dataset.f
    $$('#gm-loc .gm-chip').forEach(x => x.classList.toggle('on', x === c)); gmLoc()
  })
}

// ═══════════ BOOT ═══════════
function boot() {
  $('#tim').oninput = veBang
  veChips(); veBang()
  veNcc(); moiPhieu('nhap'); vePhieu('nhap'); moiPhieu('xuat'); vePhieu('xuat')
  gmGanSuKien()
}

// phơi hàm cho onclick trong HTML sinh động
Object.assign(window, { moThe, dongThe, phongTo, dongDen, anhHong, taiAnh, themNcc, moiPhieu, themDong, xoaDong, datDong, datSo, vePhieu, ghiSo, P, tien, bao, suaVatTu, luuVatTu, lamMoiTon, moNav, dongNav, toggleLoc, toggleTien, veDsPhieu, phXemThem, moPhieuXem, moXacNhanHuy, xacNhanHuy, veGhepMa, gmChon, gmKhongGhep, gmXuat, gmModalDong, gmMoChua, gmBoQuaMa, gmMoThem, gmThemLoc, gmThemUngVien, gmMoGhepVao, gmGhepLoc, gmGhepVaoChon, gmXoaUngVien })

// ═══════════════════ WP-20 · ĐƠN MUA (màn dm) ═══════════════════
const DM = { loc: null, ncc: '', tim: '', ds: [], vt: null, form: null, _t: null }
const DM_BUOC = [['moi', 'Mới'], ['da_gui', 'Đã gửi NCC'], ['xac_nhan', 'NCC xác nhận'], ['da_nhan', 'Đã nhận'], ['da_khop_hd', 'Khớp HĐ']]
const DM_TT = { moi: 'Mới', da_gui: 'Đã gửi', xac_nhan: 'NCC xác nhận', da_nhan: 'Đã nhận', da_khop_hd: 'Khớp HĐ', huy: 'Đã huỷ' }
const dmTien = v => Math.round(v || 0).toLocaleString('vi-VN')
const dmNgay = s => s ? new Date(s).toLocaleDateString('vi-VN') : '—'
const dmTre = (hen, can) => hen && can && new Date(hen) > new Date(can)

async function dmVatTu() { if (!DM.vt) { const { data } = await sb.from('vat_tu').select('id,ma,ten,dvt').eq('ngung_dung', false).order('ma'); DM.vt = data || [] } return DM.vt }
// LƯU Ý: global KHO trong app này là danh sách VẬT TƯ (không phải kho hàng). Kho hàng phải fetch riêng.
async function dmKho() { if (!DM.kho) { const { data } = await sb.from('kho').select('id,ten,la_mac_dinh').order('ten'); DM.kho = data || [] } return DM.kho }

// tiến độ nhận: thanh + chip n/m dòng (còn thiếu / đủ)
function dmProg(d) {
  const m = d.so_dong || 0, nn = d.dong_da_nhan || 0, pct = m ? Math.round(nn / m * 100) : 0
  const chip = d.trang_thai === 'da_nhan' ? `<span class="dmn-chip du">${nn}/${m} dòng</span>`
    : (d.trang_thai === 'xac_nhan' && nn < m) ? `<span class="dmn-chip thieu">${nn}/${m} dòng · còn thiếu</span>`
      : `${nn}/${m} dòng`
  return `<span class="dmn-prog"><i style="width:${pct}%"></i></span>${chip}`
}
async function veDonMua() {
  $('#dm-ct').style.display = 'none'; $('#dm-form').style.display = 'none'; $('#dm-nhan').style.display = 'none'; $('#dm-list').style.display = ''
  const chips = [['', 'Tất cả'], ...Object.entries(DM_TT)]
  $('#dm-chips').innerHTML = chips.map(([v, t]) => `<span class="dm-chip ${DM.loc === (v || null) ? 'sel' : ''}" data-tt="${v}">${t}</span>`).join('')
  $$('#dm-chips .dm-chip').forEach(c => c.onclick = () => { DM.loc = c.dataset.tt || null; veDonMua() })
  const sel = $('#dm-f-ncc')
  if (sel && !sel.dataset.done) { sel.innerHTML = '<option value="">Mọi NCC</option>' + NCC.map(x => `<option value="${x.id}">${x.ten}</option>`).join(''); sel.onchange = () => { DM.ncc = sel.value; veDonMua() }; sel.dataset.done = '1' }
  $('#dm-f-tim').oninput = e => { DM.tim = e.target.value; clearTimeout(DM._t); DM._t = setTimeout(veDonMua, 300) }
  $('#dm-moi-btn').onclick = () => dmMoiForm()   // KHÔNG truyền event làm suaId (event truthy → tưởng đang sửa)
  const r = await sb.rpc('dm_danh_sach', { p_trang_thai: DM.loc, p_ncc: DM.ncc || null, p_tim: DM.tim || null })
  if (r.error) { $('#dm-ds').innerHTML = `<div class="rong" style="color:var(--do)">Lỗi: ${r.error.message} <button class="n nho" onclick="veDonMua()">Thử lại</button></div>`; return }
  DM.ds = r.data || []
  const c = (f) => DM.ds.filter(f).length
  $('#dm-dem').textContent = `${DM.ds.length} đơn · ${c(x => ['moi', 'da_gui', 'xac_nhan'].includes(x.trang_thai))} đang mở · ${c(x => ['da_gui', 'xac_nhan'].includes(x.trang_thai))} chờ hàng về · ${c(x => x.co_qua_ngay_can)} quá ngày cần`
  if (!DM.ds.length) { $('#dm-ds').innerHTML = '<div class="rong">Chưa có đơn mua nào.</div>'; return }
  $('#dm-ds').innerHTML = `<table><thead><tr><th>Số đơn</th><th>NCC</th><th>Kho nhận</th><th>Ngày cần</th><th>NCC hẹn</th><th class="r">Tạm tính</th><th>Trạng thái</th><th>Đã nhận</th><th></th></tr></thead><tbody>${DM.ds.map(d => `<tr style="cursor:pointer" data-id="${d.id}"><td class="dm-mono"><b>${d.so_don}</b></td><td>${d.ncc}</td><td>${d.kho}</td><td class="${d.co_qua_ngay_can ? 'dm-late' : ''}">${dmNgay(d.ngay_can)}</td><td class="${dmTre(d.ngay_ncc_hen, d.ngay_can) ? 'dm-late' : ''}">${dmNgay(d.ngay_ncc_hen)}</td><td class="r dm-mono">${dmTien(d.tam_tinh)}</td><td><span class="dm-tt ${d.trang_thai}">${DM_TT[d.trang_thai]}</span></td><td>${dmProg(d)}</td><td>${d.trang_thai === 'xac_nhan' && laQuanLy() ? `<button class="n chinh nho dmn-nhan-btn" data-id="${d.id}">Nhận hàng</button>` : ''}</td></tr>`).join('')}</tbody></table>`
  // điện thoại: thẻ từng đơn (CSS ẩn bảng, hiện thẻ ở ≤480px)
  $('#dm-ds').insertAdjacentHTML('beforeend', `<div class="dmn-list-cards">${DM.ds.map(d => `<div class="dmn-po" data-id="${d.id}"><div><b class="dm-mono">${d.so_don}</b> · ${d.ncc}<br><span class="dmn-hist">${d.kho} · hẹn ${dmNgay(d.ngay_ncc_hen)}</span><br><span class="dm-tt ${d.trang_thai}">${DM_TT[d.trang_thai]}</span> ${dmProg(d)}</div>${d.trang_thai === 'xac_nhan' && laQuanLy() ? `<button class="n chinh dmn-nhan-btn" data-id="${d.id}">Nhận</button>` : ''}</div>`).join('')}</div>`)
  $$('#dm-ds tr[data-id], #dm-ds .dmn-po[data-id]').forEach(el => el.onclick = () => dmXem(el.dataset.id))
  $$('#dm-ds .dmn-nhan-btn').forEach(b => b.onclick = e => { e.stopPropagation(); dmNhanForm(b.dataset.id) })
}

async function dmXem(id) {
  $('#dm-list').style.display = 'none'; $('#dm-form').style.display = 'none'; $('#dm-nhan').style.display = 'none'
  const box = $('#dm-ct'); box.style.display = ''; box.innerHTML = '<div class="rong">Đang tải…</div>'
  const r = await sb.rpc('dm_chi_tiet', { p_id: id })
  if (r.error) { box.innerHTML = `<div class="rong" style="color:var(--do)">Lỗi: ${r.error.message}</div>`; return }
  const j = r.data, d = j.dau_don, tt = d.trang_thai
  const idx = DM_BUOC.findIndex(b => b[0] === tt)
  const lsBy = {}; (j.lich_su || []).forEach(l => { if (l.toi) lsBy[l.toi] = l })
  const steps = DM_BUOC.map((b, i) => { const done = tt !== 'huy' && i <= idx; const l = lsBy[b[0]]; const auto = i >= 3 && !l; return `<div class="dm-step ${done ? 'done' : ''}">${b[1]}<div class="d">${l ? dmNgay(l.luc) + (l.boi ? ' · ' + l.boi : '') : (auto ? 'tự động · WP-21/22' : '')}</div></div>` }).join('')
  const lh = j.lien_he_ncc || {}
  const rows = (j.dong || []).map(x => `<tr><td class="r">${x.stt}</td><td class="dm-mono">${x.ma}</td><td>${x.ten}</td><td class="r dm-mono">${dmTien(x.so_luong)}</td><td>${x.dvt || ''}</td><td class="r dm-mono">${dmTien(x.don_gia)}</td><td class="r dm-mono">${dmTien(x.thanh_tien)}</td><td class="r dm-mono">${dmTien(x.so_luong_da_nhan)}</td></tr>`).join('')
  // WP-22: danh sách hoá đơn NCC đã ghi của đơn này (hd_ncc_ds)
  let hdSection = ''
  if (['da_nhan', 'da_khop_hd'].includes(tt)) {
    const hr = await sb.rpc('hd_ncc_ds', { p_don_mua_id: id })
    const hds = hr.data || []
    const canXoa = ['kho', 'ke_toan', 'ceo'].includes(ROLE)
    hdSection = `<div class="kho-hd-ds"><h4 class="kho-hd-ds-h">Hoá đơn NCC đã ghi <span class="kho-hd-mo">(${hds.length})</span></h4>` + (hds.length
      ? `<table class="kho-hd-tbl"><thead><tr><th>Số HĐ</th><th>Loại</th><th>Ngày</th><th>Hạn TT</th><th class="r">Tổng gồm VAT</th><th class="r">Đã trả</th><th class="r">Còn lại</th><th>Lệch giá</th><th></th></tr></thead><tbody>${hds.map(h => `<tr><td class="dm-mono"><b>${h.so_hd}</b></td><td>${h.loai === 'bang_ke' ? 'Bảng kê' : 'HĐ VAT ' + h.vat_pct + '%'}</td><td>${dmNgay(h.ngay_hd)}</td><td>${dmNgay(h.han_thanh_toan)}</td><td class="r dm-mono">${dmTien(h.tong_gom_vat)}</td><td class="r dm-mono">${dmTien(h.da_tra)}</td><td class="r dm-mono">${dmTien(h.con_lai)}</td><td>${h.lech_gia_so_dong > 0 ? `<span class="kho-hd-nhan vang">lệch ${h.lech_gia_so_dong} dòng</span>` : '<span class="kho-hd-nhan luc">khớp giá</span>'}</td><td>${canXoa ? `<button class="n nho kho-hd-xoa" data-hid="${h.id}" data-so="${h.so_hd}">Xoá</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="kho-hd-mo">Chưa ghi hoá đơn nào cho đơn này.</div>') + `<div class="kho-hd-err" id="kho-hd-err"></div></div>`
  }
  // nút theo cổng (màn phản chiếu; DB là cổng thật)
  const B = []
  if (['moi', 'da_gui', 'xac_nhan'].includes(tt)) B.push(['Sửa dòng', 'sua', true])
  if (tt === 'moi') B.push(['Gửi NCC', 'da_gui', true])
  if (tt === 'da_gui') B.push(['NCC xác nhận', 'xac_nhan', true])
  if (tt === 'xac_nhan') B.push(['Nhận hàng', 'nhan', laQuanLy()])
  if (['da_nhan', 'da_khop_hd'].includes(tt)) B.push(['Khớp hoá đơn', 'khop', ['kho', 'ke_toan', 'ceo'].includes(ROLE)])
  if (['moi', 'da_gui', 'xac_nhan'].includes(tt)) B.push(['Huỷ đơn', 'huy', true])
  box.innerHTML = `<div class="dm-row"><button class="n" onclick="veDonMua()">← Danh sách</button><h3 class="dm-mono" style="margin:0 0 0 6px">${d.so_don}</h3><span class="dm-tt ${tt}" style="margin-left:8px">${DM_TT[tt]}</span></div>
    <div class="dm-steps">${steps}</div>
    <div class="dm-kv"><b>Nhà cung cấp</b><div>${d.ncc}${lh.dien_thoai ? ' · ' + lh.dien_thoai : ''}${lh.dia_chi ? ' · ' + lh.dia_chi : ''}${lh.lead_time_ngay != null ? ' · lead ' + lh.lead_time_ngay + ' ngày' : ''}</div>
      <b>Kho nhận</b><div>${d.kho}</div><b>Ngày đặt / cần</b><div>${dmNgay(d.ngay_dat)} → <span class="${d.ngay_ncc_hen && dmTre(d.ngay_ncc_hen, d.ngay_can) ? 'dm-late' : ''}">${dmNgay(d.ngay_can)}</span></div>
      <b>NCC hẹn</b><div class="${dmTre(d.ngay_ncc_hen, d.ngay_can) ? 'dm-late' : ''}">${dmNgay(d.ngay_ncc_hen)}</div>${d.ghi_chu ? '<b>Ghi chú</b><div>' + d.ghi_chu + '</div>' : ''}${d.ly_do_huy ? '<b>Lý do huỷ</b><div class="dm-late">' + d.ly_do_huy + '</div>' : ''}</div>
    <table><thead><tr><th class="r">#</th><th>Mã</th><th>Tên</th><th class="r">SL đặt</th><th>ĐVT</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th><th class="r">Đã nhận</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="6" class="r"><b>Tạm tính</b></td><td class="r dm-mono"><b>${dmTien(d.tam_tinh)}</b></td><td></td></tr></tfoot></table>
    <div class="dm-gate">${B.map(([l, a, en]) => `<button class="n ${en ? (a === 'huy' ? '' : 'chinh') : 'mo'}" ${en ? '' : 'disabled'} data-act="${a}">${l}</button>`).join('')}</div>
    <div class="dm-err" id="dm-ct-err"></div><div class="dm-legend">Nút mờ = cổng DB chưa cho (vai/trạng thái). Mọi lỗi hiện nguyên văn.</div>
    ${hdSection}`
  box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => dmNutCt(id, b.dataset.act, box.querySelector('#dm-ct-err')))
  box.querySelectorAll('.kho-hd-xoa').forEach(b => b.onclick = async () => {
    const err = box.querySelector('#kho-hd-err'); err.textContent = ''
    if (!confirm(`Xoá hoá đơn ${b.dataset.so}? (đảo giá lô nếu còn sống; đơn có thể lùi về "đã nhận")`)) return
    const r = await sb.rpc('hd_ncc_xoa', { p_id: b.dataset.hid })
    if (r.error) { err.textContent = r.error.message.replace(/^.*HD_CO_PHIEU_CHI: */, 'Không xoá được: '); return }
    bao('Đã xoá hoá đơn ' + b.dataset.so); dmXem(id)
  })
}

async function dmNutCt(id, act, errEl) {
  errEl.textContent = ''
  if (act === 'sua') return dmMoiForm(id)
  if (act === 'nhan') return dmNhanForm(id)
  if (act === 'khop') return dmKhopForm(id)
  let toi = act, ngay = null, lyDo = null
  if (act === 'xac_nhan') { const cur = DM.ds.find(x => x.id === id); const def = cur ? cur.ngay_can : ''; ngay = prompt('Ngày NCC hẹn giao (YYYY-MM-DD), mặc định = ngày cần:', def || ''); if (ngay === null) return; ngay = ngay.trim() || null }
  if (act === 'huy') { lyDo = prompt('Lý do huỷ (bắt buộc):', ''); if (lyDo === null) return; if (!lyDo.trim()) { errEl.textContent = 'Huỷ phải có lý do.'; return } }
  const r = await sb.rpc('dm_chuyen_trang_thai', { p_id: id, p_toi: toi, p_ngay_ncc_hen: ngay, p_ly_do: lyDo })
  if (r.error) { errEl.textContent = r.error.message; return }
  dmXem(id)
}

async function dmGia() { if (!DM.gia) { const { data } = await sb.from('v_gia_tham_khao').select('vat_tu_id,gia_tham_khao'); DM.gia = Object.fromEntries((data || []).map(r => [r.vat_tu_id, r.gia_tham_khao])) } return DM.gia }
const dmFmt = v => (v === '' || v == null || isNaN(Number(v))) ? '' : Math.round(Number(v)).toLocaleString('vi-VN')

// Form tạo/sửa đơn mua — ô GÕ TÌM vật tư + bảng dòng 7 cột. suaId → sửa dòng (cùng bảng, không bản thứ hai).
async function dmMoiForm(suaId) {
  $('#dm-list').style.display = 'none'; $('#dm-ct').style.display = 'none'
  const box = $('#dm-form'); box.style.display = ''
  const vt = await dmVatTu(), khoList = await dmKho(), gia = await dmGia()
  const dauCan = ngayNghiepVu(congNgay(new Date(), 7))
  const nDong = () => ({ vat_tu_id: '', so_luong: '', don_gia: '', don_vi: '', nguon: '', lead: null, hen: '' })
  let dong = [nDong()], ct = null
  if (suaId) { const r = await sb.rpc('dm_chi_tiet', { p_id: suaId }); if (!r.error) { ct = r.data.dau_don; dong = r.data.dong.map(x => ({ vat_tu_id: x.vat_tu_id, so_luong: x.so_luong, don_gia: x.don_gia, don_vi: x.dvt || '', nguon: '', lead: null, hen: '' })) } }
  const vById = id => vt.find(x => x.id === id)
  const rowTT = i => (Number(dong[i].so_luong) || 0) * (Number(dong[i].don_gia) || 0)
  const tamTinh = () => dong.reduce((s, d, i) => s + (d.vat_tu_id ? rowTT(i) : 0), 0)

  const nguonNhan = d => {
    if (d.nguon === 'bang_gia_ncc') return `<span class="dmx-nhan dmx-banggia">Bảng giá NCC</span>${d.lead != null ? `<div class="dmx-goiy">lead ${d.lead} ngày</div>` : ''}`
    if (d.nguon === 'tham_khao') return `<span class="dmx-nhan dmx-thamkhao">Tham khảo</span><div class="dmx-goiy">NCC chưa có giá mã này</div>`
    if (d.nguon === 'tu_nhap') return `<span class="dmx-nhan dmx-tunhap">Tự nhập</span><div class="dmx-goiy">không có giá nào trong hệ</div>`
    return ''
  }
  const henCell = d => d.lead != null ? `<span class="dmx-hengiao">gợi ý ${d.hen}</span><div class="dmx-goiy">(hôm nay + ${d.lead})</div>` : (d.vat_tu_id ? '<span class="dm-mo">—</span><div class="dmx-goiy">⚠ chưa có lead time</div>' : '')
  const veDong = () => `<div class="dmx-tbl-wrap"><table class="dm-tbl dmx-tbl"><thead><tr><th style="width:28px">#</th><th>Vật tư</th><th style="width:74px">Đơn vị</th><th class="r" style="width:70px">SL</th><th class="r" style="width:110px">Đơn giá</th><th style="width:130px">Nguồn giá</th><th style="width:120px">Hẹn giao</th><th class="r" style="width:110px">Thành tiền</th><th style="width:28px"></th></tr></thead><tbody>${dong.map((d, i) => {
    const v = vById(d.vat_tu_id), lbl = v ? `${v.ma} — ${v.ten}` : ''
    return `<tr data-i="${i}"><td>${i + 1}</td>
      <td class="dm-vtcell"><input class="ip d-vt" data-i="${i}" autocomplete="off" placeholder="gõ mã hoặc tên vật tư…" value="${lbl.replace(/"/g, '&quot;')}"><div class="dm-goi" data-i="${i}"></div></td>
      <td><select class="ip d-dv" data-i="${i}" style="width:70px"><option value="${d.don_vi || ''}">${d.don_vi || '—'}</option></select></td>
      <td class="r"><input class="ip d-sl" data-i="${i}" inputmode="decimal" placeholder="0" value="${d.so_luong}"></td>
      <td class="r"><input class="ip d-dg" data-i="${i}" inputmode="numeric" value="${dmFmt(d.don_gia)}"></td>
      <td class="d-nguon" data-i="${i}">${nguonNhan(d)}</td>
      <td class="d-hen" data-i="${i}">${henCell(d)}</td>
      <td class="r dm-mono d-tt" data-i="${i}">${d.vat_tu_id ? dmFmt(rowTT(i)) : ''}</td>
      <td><button class="n nho d-xoa" data-i="${i}" title="Xoá dòng">×</button></td></tr>`
  }).join('')}<tr class="dm-tam-r"><td colspan="7" class="r"><b>Tạm tính (chưa VAT)</b></td><td class="r dm-mono" id="dm-tam"><b>${dmFmt(tamTinh())}</b></td><td></td></tr></tbody></table></div>`

  box.innerHTML = `<div class="dm-row"><button class="n" id="dm-huy-form">← Danh sách</button><h3 style="margin:0 0 0 6px">${suaId ? 'Sửa dòng · ' + ct.so_don : 'Đơn mua mới'}</h3></div>
    <div class="dm-sub">${suaId ? 'Sửa số lượng / đơn giá các dòng.' : 'Chọn nhà cung cấp, gõ mã vật tư, nhập số lượng → Lưu. Số đơn cấp tự động.'}</div>
    ${suaId ? '' : `<div class="dm-row"><div><label>Nhà cung cấp</label><select class="ip" id="dm-f-ncc2" style="width:220px">${NCC.map(x => `<option value="${x.id}">${x.ten}</option>`).join('')}</select></div>
      <div><label>Kho nhận</label><select class="ip" id="dm-f-kho" style="width:160px">${khoList.map(x => `<option value="${x.id}" ${x.la_mac_dinh ? 'selected' : ''}>${x.ten}</option>`).join('')}</select></div>
      <div><label>Ngày cần</label><input class="ip" id="dm-f-can" type="date" value="${dauCan}"></div>
      <div style="flex:1;min-width:180px"><label>Ghi chú</label><input class="ip" id="dm-f-gc" style="width:100%" placeholder="tuỳ chọn"></div></div>`}
    <div id="dm-dong">${veDong()}</div>
    <button class="n nho" id="dm-them-dong">+ Thêm dòng</button>
    <div class="dm-err" id="dm-form-err"></div>
    <div class="dm-gate">${suaId ? '<button class="n chinh" id="dm-luu-sua">Lưu dòng</button>' : '<button class="n" id="dm-luu">Lưu (Mới)</button><button class="n chinh" id="dm-luu-gui">Lưu và gửi NCC</button>'}</div>`

  const capNhatTien = () => { box.querySelectorAll('.d-tt').forEach(c => { const i = +c.dataset.i; c.textContent = dong[i].vat_tu_id ? dmFmt(rowTT(i)) : '' }); const t = $('#dm-tam'); if (t) t.innerHTML = '<b>' + dmFmt(tamTinh()) + '</b>' }
  const dongGoi = () => box.querySelectorAll('.dm-goi').forEach(g => g.innerHTML = '')
  const nccId = () => suaId ? (ct && ct.ncc_id) : $('#dm-f-ncc2')?.value
  const dmyISO = n => { const d = new Date(Date.now() + (n || 0) * 864e5); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) }
  let ngayCanTay = false   // WP-23: người dùng sửa tay "Ngày cần" → thôi tự gợi ý
  const capNgayCan = () => {   // gợi ý = hôm nay + MAX lead các dòng có lead; không lead → giữ mặc định
    if (ngayCanTay || suaId) return
    const leads = dong.map(d => d.lead).filter(l => l != null)
    if (!leads.length) return
    const el = $('#dm-f-can'); if (el) el.value = ngayNghiepVu(congNgay(new Date(), Math.max(...leads)))
  }
  async function suyGia(i) {   // WP-23: gọi goi_y_gia_dong_mua → điền giá/đơn vị/nguồn/hẹn
    const v = vById(dong[i].vat_tu_id); if (!v) return
    const units = await nccDonViList(v.id)   // đơn vị hợp lệ (cơ sở + quy đổi)
    let g = { co: false }
    const ncc = nccId(); if (ncc) { const r = await sb.rpc('goi_y_gia_dong_mua', { p_ncc_id: ncc, p_vat_tu_id: v.id }); if (!r.error) g = r.data }
    if (g.co) { dong[i].don_gia = Number(g.don_gia); dong[i].don_vi = g.don_vi; dong[i].nguon = g.nguon; dong[i].lead = g.lead_time_ngay ?? null }
    else { dong[i].nguon = 'tu_nhap'; dong[i].lead = null; if (!dong[i].don_vi) dong[i].don_vi = units[0] || v.dvt || '' }
    dong[i].hen = dong[i].lead != null ? dmyISO(dong[i].lead) : ''
    // đơn vị dropdown: các đơn vị hợp lệ, chọn theo gợi ý
    const uni = [...new Set([dong[i].don_vi, ...units].filter(Boolean))]
    const dvsel = box.querySelector(`.d-dv[data-i="${i}"]`); if (dvsel) { dvsel.innerHTML = uni.map(u => `<option value="${u}"${u === dong[i].don_vi ? ' selected' : ''}>${u}</option>`).join(''); }
    const dg = box.querySelector(`.d-dg[data-i="${i}"]`); if (dg) dg.value = dong[i].don_gia === '' || dong[i].don_gia == null ? '' : dmFmt(dong[i].don_gia)
    const nc = box.querySelector(`.d-nguon[data-i="${i}"]`); if (nc) nc.innerHTML = nguonNhan(dong[i])
    const hc = box.querySelector(`.d-hen[data-i="${i}"]`); if (hc) hc.innerHTML = henCell(dong[i])
    capNhatTien(); capNgayCan()
  }
  const chonVt = async (i, v) => {
    dong[i].vat_tu_id = v.id; dong[i].don_gia = ''; dong[i].don_vi = ''
    const inp = box.querySelector(`.d-vt[data-i="${i}"]`); if (inp) inp.value = `${v.ma} — ${v.ten}`
    dongGoi(); await suyGia(i)
    box.querySelector(`.d-sl[data-i="${i}"]`)?.focus()
  }
  const themDong = () => { dong.push(nDong()); $('#dm-dong').innerHTML = veDong(); bind(); box.querySelector(`.d-vt[data-i="${dong.length - 1}"]`)?.focus() }

  function bind() {
    box.querySelectorAll('.d-vt').forEach(inp => {
      const i = +inp.dataset.i, goi = box.querySelector(`.dm-goi[data-i="${i}"]`)
      inp.oninput = () => {
        dong[i].vat_tu_id = ''   // gõ lại = bỏ chọn cũ
        const q = inp.value.trim().toLowerCase()
        if (!q) { goi.innerHTML = ''; return }
        const kq = vt.filter(v => v.ma.toLowerCase().includes(q) || v.ten.toLowerCase().includes(q)).slice(0, 8)
        goi.innerHTML = kq.map(v => `<div class="dm-goi-item" data-vt="${v.id}">${v.ma} — ${v.ten} <span class="dm-goi-dvt">(${v.dvt || ''})</span></div>`).join('') || '<div class="dm-goi-none">không thấy vật tư</div>'
        goi.querySelectorAll('.dm-goi-item').forEach(it => it.onmousedown = e => { e.preventDefault(); chonVt(i, vById(it.dataset.vt)) })
      }
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const first = goi.querySelector('.dm-goi-item'); if (first) chonVt(i, vById(first.dataset.vt)) } }
      inp.onblur = () => setTimeout(() => { goi.innerHTML = '' }, 150)
    })
    box.querySelectorAll('.d-sl').forEach(s => {
      const i = +s.dataset.i
      s.oninput = () => { dong[i].so_luong = s.value; capNhatTien() }
      s.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (i === dong.length - 1) themDong(); else box.querySelector(`.d-vt[data-i="${i + 1}"]`)?.focus() } }
    })
    box.querySelectorAll('.d-dg').forEach(s => {
      const i = +s.dataset.i
      s.oninput = () => { const raw = s.value.replace(/\D/g, ''); dong[i].don_gia = raw === '' ? '' : Number(raw); s.value = raw === '' ? '' : dmFmt(raw); capNhatTien() }
    })
    box.querySelectorAll('.d-dv').forEach(s => { const i = +s.dataset.i; s.onchange = () => { dong[i].don_vi = s.value } })
    box.querySelectorAll('.d-xoa').forEach(s => s.onclick = () => { const i = +s.dataset.i; if (dong.length > 1) dong.splice(i, 1); else dong = [nDong()]; $('#dm-dong').innerHTML = veDong(); bind() })
  }
  bind()
  box.querySelector('.d-vt[data-i="0"]')?.focus()   // con trỏ sẵn ở ô vật tư dòng 1
  $('#dm-huy-form').onclick = () => veDonMua()
  $('#dm-them-dong').onclick = themDong
  // WP-23: đổi NCC đầu đơn → gợi ý lại giá/lead cho dòng đã chọn vật tư
  if (!suaId) $('#dm-f-can')?.addEventListener('change', () => ngayCanTay = true)   // WP-23: sửa tay → thôi tự gợi ý
  if (!suaId) $('#dm-f-ncc2')?.addEventListener('change', () => dong.forEach((d, i) => { if (d.vat_tu_id) suyGia(i) }))
  else dong.forEach(async (d, i) => { if (d.vat_tu_id) { const u = [...new Set([d.don_vi, ...(await nccDonViList(d.vat_tu_id))].filter(Boolean))]; const s = box.querySelector(`.d-dv[data-i="${i}"]`); if (s) s.innerHTML = u.map(x => `<option value="${x}"${x === d.don_vi ? ' selected' : ''}>${x}</option>`).join('') } })

  const goiDong = () => dong.filter(d => d.vat_tu_id && (Number(d.so_luong) || 0) > 0).map(d => ({ vat_tu_id: d.vat_tu_id, so_luong: Number(d.so_luong), don_gia: d.don_gia === '' || d.don_gia == null ? null : Number(d.don_gia), don_vi: d.don_vi || null }))
  const luu = async (gui) => {
    const err = $('#dm-form-err'); err.textContent = ''
    const ds = goiDong()
    if (!ds.length) { err.textContent = 'Cần ít nhất 1 dòng vật tư có số lượng.'; return }
    if (suaId) { const r = await sb.rpc('dm_sua_dong', { p_id: suaId, p_dong: ds }); if (r.error) { err.textContent = r.error.message; return } dmXem(suaId); return }
    const r = await sb.rpc('dm_tao', { p_ncc: $('#dm-f-ncc2').value, p_kho: $('#dm-f-kho').value, p_ngay_can: $('#dm-f-can').value, p_ghi_chu: $('#dm-f-gc').value || null, p_dong: ds, p_gui_ngay: !!gui })
    if (r.error) { err.textContent = r.error.message; return }
    if (r.data.canh_bao_gia) { err.style.color = 'var(--am,#9A6412)'; err.textContent = r.data.canh_bao_gia; setTimeout(() => { err.style.color = '' }, 50) }
    dmXem(r.data.id)
  }
  if (suaId) $('#dm-luu-sua').onclick = () => luu(false)
  else { $('#dm-luu').onclick = () => luu(false); $('#dm-luu-gui').onclick = () => luu(true) }
}
// ── WP-21 · Hộp NHẬN HÀNG đơn mua (bảng máy tính + thẻ điện thoại, cùng RPC dm_nhan_hang) ──
async function dmNhanForm(id) {
  $('#dm-list').style.display = 'none'; $('#dm-ct').style.display = 'none'; $('#dm-form').style.display = 'none'
  const box = $('#dm-nhan'); box.style.display = ''; box.innerHTML = '<div class="rong">Đang tải…</div>'
  const r = await sb.rpc('dm_chi_tiet', { p_id: id })
  if (r.error) { box.innerHTML = `<div class="rong" style="color:var(--do)">Lỗi: ${r.error.message}</div>`; return }
  const d = r.data.dau_don
  if (d.trang_thai !== 'xac_nhan') { box.innerHTML = `<div class="dm-row"><button class="n" onclick="veDonMua()">← Danh sách</button></div><div class="rong">Đơn ${d.so_don} đang "${DM_TT[d.trang_thai]}" — chỉ nhận hàng khi NCC đã xác nhận.</div>`; return }
  const lh = r.data.lien_he_ncc || {}
  // dòng nhận: con = đặt − đã nhận; dòng đủ (con<=0) khoá
  const L = (r.data.dong || []).map(x => ({ ...x, con: Number(x.so_luong) - Number(x.so_luong_da_nhan), nhan: '', ghi: '' }))
  // lịch sử nhận (phiếu gắn đơn này)
  const { data: phs } = await sb.from('phieu').select('so_phieu,tao_luc,trang_thai,phieu_dong(so_luong)').eq('don_mua_id', id).order('tao_luc', { ascending: false })
  const hist = (phs || []).map(p => `<tr><td>${gio(new Date(p.tao_luc))}</td><td class="dm-mono">${p.so_phieu}${p.trang_thai === 'da_huy' ? ' <span class="dsp-tag huy">huỷ</span>' : ''}</td><td>${(p.phieu_dong || []).length} dòng · ${dmTien((p.phieu_dong || []).reduce((s, x) => s + Number(x.so_luong || 0), 0))} đơn vị</td></tr>`).join('')

  const vuot = i => L[i].con > 0 && (Number(L[i].nhan) || 0) > L[i].con
  const coVuot = () => L.some((_, i) => vuot(i))
  const dongGhi = () => L.map((x, i) => ({ i, x })).filter(({ x, i }) => x.con > 0 && (Number(x.nhan) || 0) > 0 && !vuot(i))

  const rowDesk = (x, i) => x.con <= 0
    ? `<tr class="done"><td>${x.ma} — ${x.ten}</td><td>${x.dvt || ''}</td><td class="n">${dmTien(x.so_luong)}</td><td class="n">${dmTien(x.so_luong_da_nhan)}</td><td class="n">0</td><td class="n"><input class="dmn-inp" value="0" disabled></td><td class="n">${dmTien(x.don_gia)}</td><td><span class="dmn-chip du">đã đủ</span></td></tr>`
    : `<tr><td>${x.ma} — ${x.ten}</td><td>${x.dvt || ''}</td><td class="n">${dmTien(x.so_luong)}</td><td class="n">${dmTien(x.so_luong_da_nhan)}</td><td class="n">${dmTien(x.con)}</td>
       <td class="n"><input class="dmn-inp n-sl" data-i="${i}" inputmode="decimal" placeholder="0" value="${x.nhan}">${vuot(i) ? `<div class="dmn-err">vượt ${dmTien((Number(x.nhan) || 0) - x.con)} so với đặt</div>` : ''}</td>
       <td class="n">${dmTien(x.don_gia)}</td><td><input class="dmn-inp txt n-gc" data-i="${i}" placeholder="vd: lô ML-0821" value="${(x.ghi || '').replace(/"/g, '&quot;')}"></td></tr>`

  const cardPhone = (x, i) => x.con <= 0
    ? `<div class="dmn-card done"><div class="dmn-name">${x.ma} — ${x.ten}</div><div class="dmn-row2"><span>Đặt <b>${dmTien(x.so_luong)}</b></span><span>Đã nhận <b>${dmTien(x.so_luong_da_nhan)}</b></span><span class="dmn-chip du">đủ</span></div></div>`
    : `<div class="dmn-card"><div class="dmn-name">${x.ma} — ${x.ten}</div>
       <div class="dmn-row2"><span>Đặt <b>${dmTien(x.so_luong)}</b></span><span>Đã nhận <b>${dmTien(x.so_luong_da_nhan)}</b></span><span>Còn <b>${dmTien(x.con)}</b></span><span>${dmTien(x.don_gia)}/${x.dvt || 'đv'}</span></div>
       <div class="dmn-in"><button class="dmn-step n-minus" data-i="${i}">−</button><input class="dmn-inp n-sl" data-i="${i}" inputmode="decimal" placeholder="0" value="${x.nhan}"><button class="dmn-step n-plus" data-i="${i}" ${vuot(i) || (Number(x.nhan) || 0) >= x.con ? 'disabled' : ''}>+</button><span class="dmn-hist">${x.dvt || ''}</span></div>
       ${vuot(i) ? `<div class="dmn-err">vượt ${dmTien((Number(x.nhan) || 0) - x.con)} so với đặt</div>` : ''}
       <div class="dmn-in" style="margin-top:8px"><input class="dmn-inp txt n-gc" data-i="${i}" placeholder="Ghi chú lô (không bắt buộc)" value="${(x.ghi || '').replace(/"/g, '&quot;')}"></div></div>`

  const render = () => {
    const nDong = dongGhi().length, chan = coVuot() || nDong === 0
    box.innerHTML = `<div class="dm-row"><button class="n" id="dmn-back">← Danh sách</button><h3 class="dm-mono" style="margin:0 0 0 6px">Nhận hàng · ${d.so_don}</h3></div>
      <div class="dmn-head"><div><span>NCC</span> <b>${d.ncc}</b>${lh.dien_thoai ? ' · ' + lh.dien_thoai : ''}</div><div><span>Kho nhận</span> <b>${d.kho}</b></div><div><span>Ngày nhận</span> <b>${dmNgay(new Date())}</b></div><div><span>Người nhận</span> <b>${ME || '—'}</b></div></div>
      <table class="dmn-tbl"><thead><tr><th>Vật tư</th><th>ĐVT</th><th class="n">Đặt</th><th class="n">Đã nhận</th><th class="n">Còn</th><th class="n">Nhận lần này</th><th class="n">Đơn giá (đơn)</th><th>Ghi chú lô</th></tr></thead>
        <tbody>${L.map(rowDesk).join('')}</tbody></table>
      <div class="dmn-cards">${L.map(cardPhone).join('')}</div>
      <div class="dmn-prev">Bấm <b>Ghi nhận</b> → tự sinh <b>1 phiếu nhập</b> (số tự cấp, nguồn = đơn mua) · dòng sổ + lô nhập (giá vốn = đơn giá theo đơn). Nhận thiếu → đơn vẫn <b>NCC xác nhận</b>; đủ mọi dòng → tự sang <b>Đã nhận</b>.</div>
      <div class="dmn-bar">
        <div><button class="n nho" id="dmn-fill">Điền nhận đủ phần còn lại</button> <span class="dmn-hist" style="margin-left:8px">Đếm được bao nhiêu ghi bấy nhiêu — lần sau nhận tiếp.</span></div>
        <div style="text-align:right"><button class="n chinh" id="dmn-ghi" ${chan ? 'disabled' : ''}>Ghi nhận${nDong ? ' · ' + nDong + ' dòng' : ''}</button>${coVuot() ? '<div class="dmn-err">Sửa dòng đỏ (vượt số đặt) rồi mới ghi được</div>' : ''}<div class="dmn-err" id="dmn-err"></div></div>
      </div>
      <table class="dmn-tbl" style="margin-top:14px"><thead><tr><th colspan="3">Lịch sử nhận của đơn này</th></tr></thead><tbody class="dmn-hist">${hist || '<tr><td colspan="3">Chưa nhận lần nào.</td></tr>'}</tbody></table>
      <div class="dmn-foot">${''}</div>`
    bind()
  }
  const setNhan = (i, val) => { L[i].nhan = val === '' ? '' : Math.max(0, Number(val) || 0); render() }
  function bind() {
    $('#dmn-back').onclick = () => veDonMua()
    $('#dmn-fill').onclick = () => { L.forEach(x => { if (x.con > 0) x.nhan = x.con }); render() }
    box.querySelectorAll('.n-sl').forEach(inp => { inp.oninput = () => { const i = +inp.dataset.i; L[i].nhan = inp.value === '' ? '' : Number(inp.value.replace(/[^\d.]/g, '')) || 0; render(); const el = box.querySelector(`.n-sl[data-i="${i}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } } })
    box.querySelectorAll('.n-gc').forEach(inp => inp.oninput = () => { L[+inp.dataset.i].ghi = inp.value })   // không render lại (giữ con trỏ)
    box.querySelectorAll('.n-minus').forEach(b => b.onclick = () => { const i = +b.dataset.i; setNhan(i, Math.max(0, (Number(L[i].nhan) || 0) - 1)) })
    box.querySelectorAll('.n-plus').forEach(b => b.onclick = () => { const i = +b.dataset.i; setNhan(i, (Number(L[i].nhan) || 0) + 1) })
    const g = $('#dmn-ghi'); if (g) g.onclick = ghiNhan
  }
  async function ghiNhan() {
    const err = $('#dmn-err'); err.textContent = ''
    if (coVuot()) { err.textContent = 'Còn dòng vượt số đặt — sửa rồi mới ghi.'; return }
    // dm_chi_tiet trả stt (không trả id dòng) → map stt→id để ghép dong_id cho RPC
    const payload = await dmDongIds(id, dongGhi())
    if (!payload.length) { err.textContent = 'Cần nhập số nhận cho ít nhất 1 dòng.'; return }
    $('#dmn-ghi').disabled = true
    const res = await sb.rpc('dm_nhan_hang', { p_don_mua_id: id, p_dong: payload, p_ngay: ngayNghiepVu() })
    if (res.error) { err.textContent = res.error.message; $('#dmn-ghi').disabled = false; return }
    dmNhanXong(id, res.data, L)
  }
  render()
}
// dm_chi_tiet trả stt, không trả id dòng → map stt→id để ghép dong_id cho RPC
async function dmDongIds(donId, chon) {
  const { data } = await sb.from('don_mua_dong').select('id,stt').eq('don_mua_id', donId)
  const byStt = Object.fromEntries((data || []).map(r => [r.stt, r.id]))
  return chon.map(({ x }) => ({ dong_id: byStt[x.stt], so_luong: Number(x.nhan), ghi_chu_lo: x.ghi || null })).filter(p => p.dong_id && p.so_luong > 0)
}
// màn kết quả sau ghi nhận
function dmNhanXong(id, res, L) {
  const box = $('#dm-nhan')
  const byId = Object.fromEntries(L.map(x => [x.vat_tu_id, x]))
  const ts = (res.ton_truoc_sau || []).map(t => { const x = byId[t.vat_tu_id]; return `<div class="dmn-res-row"><span>${x ? x.ma + ' — ' + x.ten : t.vat_tu_id}</span><span class="dm-mono">${dmTien(t.truoc)} → <b>${dmTien(t.sau)}</b></span></div>` }).join('')
  const ttTxt = DM_TT[res.trang_thai_don] || res.trang_thai_don
  box.innerHTML = `<div class="dm-row"><button class="n" id="dmn-back2">← Danh sách đơn</button></div>
    <div class="dmn-prev" style="border-left-color:var(--xanh,#1B8A54)">✔ Đã ghi nhận · phiếu <b>${res.so_phieu}</b> · đơn <b>${ttTxt}</b> (đủ ${res.dong_du}/${res.dong_tong} dòng).</div>
    <div class="dmn-res"><div class="dmn-res-head">Tồn trước → sau</div>${ts}</div>
    <div class="dmn-foot" style="position:static;border:0;padding-top:14px">
      <div class="dm-row"><button class="n chinh" id="dmn-ve">Về danh sách đơn</button><button class="n" id="dmn-xemdon">Xem đơn</button><button class="n" id="dmn-xemphieu">Xem phiếu nhập</button></div></div>`
  $('#dmn-back2').onclick = () => veDonMua()
  $('#dmn-ve').onclick = () => veDonMua()
  $('#dmn-xemdon').onclick = () => dmXem(id)
  $('#dmn-xemphieu').onclick = () => { chuyenMan('nhap') }
}
// ═══════════════════ WP-22 · KHỚP HOÁ ĐƠN NCC (màn khớp, dùng chung ô #dm-nhan) ═══════════════════
async function dmKhopForm(id) {
  $('#dm-list').style.display = 'none'; $('#dm-ct').style.display = 'none'; $('#dm-form').style.display = 'none'
  const box = $('#dm-nhan'); box.style.display = ''; box.innerHTML = '<div class="rong">Đang tải…</div>'
  const [rc, rd] = await Promise.all([sb.rpc('dm_chi_tiet', { p_id: id }), sb.rpc('hd_ncc_khop_dong', { p_don_mua_id: id })])
  if (rc.error || rd.error) { box.innerHTML = `<div class="rong" style="color:var(--do)">Lỗi: ${(rc.error || rd.error).message}</div>`; return }
  const d = rc.data.dau_don
  if (!['da_nhan', 'da_khop_hd'].includes(d.trang_thai)) { box.innerHTML = `<div class="dm-row"><button class="n" onclick="veDonMua()">← Danh sách</button></div><div class="rong">Đơn ${d.so_don} đang "${DM_TT[d.trang_thai]}" — chỉ khớp hoá đơn khi đã nhận.</div>`; return }
  const iso = t => ngayNghiepVu(t)
  const H = { loai: 'hoa_don_vat', so_hd: '', ngay_hd: iso(Date.now()), han: iso(Date.now() + 30 * 864e5), vat: 10, ghi_chu: '' }
  const L = (rd.data || []).map(x => { const rem = Number(x.so_luong_da_nhan) - Number(x.so_luong_da_hd); return { ...x, rem, sl_hd: rem > 0 ? rem : '', dg_hd: Number(x.don_gia) } })
  const parseSL = v => v === '' ? '' : Math.max(0, Number(String(v).replace(/[^\d.]/g, '')) || 0)
  const num = v => Number(v) || 0
  const tt_hd = x => num(x.sl_hd) * num(x.dg_hd)
  const vuot = x => x.rem > 0 && num(x.sl_hd) > x.rem
  const kLabel = x => {
    if (x.rem <= 0) return ['xam', 'đã khớp đủ']
    const sl = num(x.sl_hd)
    if (sl > x.rem) return ['do', `vượt đã nhận ${dmTien(sl - x.rem)}`]
    if (sl <= 0) return ['xam', '—']
    if (num(x.dg_hd) !== num(x.don_gia)) return ['vang', 'lệch giá']
    if (sl < x.rem) return ['vang', 'HĐ < đã nhận']
    if (num(x.so_luong_da_nhan) < num(x.so_luong)) return ['vang', `HĐ < đặt (chưa giao ${dmTien(num(x.so_luong) - num(x.so_luong_da_nhan))})`]
    return ['luc', 'khớp']
  }
  const tong = () => { const chua = L.reduce((s, x) => s + tt_hd(x), 0); const vat = Math.round(chua * (H.loai === 'bang_ke' ? 0 : H.vat) / 100); return { chua, vat, gom: chua + vat } }
  const cham = x => num(x.dg_hd) - num(x.don_gia)

  const render = () => {
    const T = tong()
    const coVuot = L.some(vuot), coDong = L.some(x => num(x.sl_hd) > 0)
    const chan = coVuot || !coDong || !H.so_hd.trim()
    const rows = L.map((x, i) => {
      const [c, lbl] = kLabel(x), ch = cham(x)
      const dis = x.rem <= 0
      return `<tr class="${dis ? 'kho-hd-done' : ''}"><td>${x.ma} — ${x.ten}</td>
        <td class="so">${dmTien(x.so_luong)} ${x.dvt || ''}</td><td class="so">${dmTien(x.so_luong_da_nhan)}</td><td class="so">${dmTien(x.so_luong_da_hd)}</td>
        <td class="so"><input class="kho-hd-inp k-sl" data-i="${i}" inputmode="decimal" ${dis ? 'disabled' : ''} value="${dis ? 0 : x.sl_hd}"></td>
        <td class="so">${dmTien(x.don_gia)}</td>
        <td class="so"><input class="kho-hd-inp k-dg" data-i="${i}" inputmode="numeric" ${dis ? 'disabled' : ''} value="${dmFmt(x.dg_hd)}"></td>
        <td class="so ${ch !== 0 ? 'kho-hd-do' : 'kho-hd-luc'}">${ch === 0 ? '0' : (ch > 0 ? '+' : '') + dmTien(ch)}</td>
        <td class="so dm-mono">${dmTien(tt_hd(x))}</td>
        <td><span class="kho-hd-nhan ${c}">${lbl}</span></td></tr>`
    }).join('')
    box.innerHTML = `<div class="dm-row"><button class="n" id="kho-hd-back">← Danh sách</button><h3 class="dm-mono" style="margin:0 0 0 6px">Khớp hoá đơn · ${d.so_don}</h3><span class="dm-tt ${d.trang_thai}" style="margin-left:8px">${DM_TT[d.trang_thai]}</span></div>
      <div class="kho-hd-form">
        <div><label>Loại chứng từ</label><select id="k-loai"><option value="hoa_don_vat"${H.loai === 'hoa_don_vat' ? ' selected' : ''}>Hoá đơn VAT</option><option value="bang_ke"${H.loai === 'bang_ke' ? ' selected' : ''}>Bảng kê / không HĐ (VAT 0)</option></select></div>
        <div><label>Số hoá đơn</label><input id="k-sohd" value="${H.so_hd.replace(/"/g, '&quot;')}" placeholder="vd: 0001234"></div>
        <div><label>Ngày hoá đơn</label><input id="k-ngay" type="date" value="${H.ngay_hd}"></div>
        <div><label>Hạn thanh toán <span class="kho-hd-mo">(mặc định +30 ngày)</span></label><input id="k-han" type="date" value="${H.han}"></div>
        <div><label>VAT %</label><select id="k-vat" ${H.loai === 'bang_ke' ? 'disabled' : ''}>${[0, 5, 8, 10].map(v => `<option value="${v}"${(H.loai === 'bang_ke' ? 0 : H.vat) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>Ghi chú</label><input id="k-ghi" value="${H.ghi_chu.replace(/"/g, '&quot;')}" placeholder="vd: HĐ gộp 2 lần giao"></div>
      </div>
      <table class="kho-hd-tbl"><thead><tr><th>Vật tư</th><th class="so">SL đặt</th><th class="so">SL đã nhận</th><th class="so">Đã có HĐ</th><th class="so">SL trên HĐ</th><th class="so">Đơn giá đơn</th><th class="so">Đơn giá HĐ</th><th class="so">Chênh/đv</th><th class="so">Thành tiền</th><th>Khớp</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="kho-hd-tong"><td colspan="8" class="so">Cộng chưa VAT</td><td class="so dm-mono">${dmTien(T.chua)}</td><td></td></tr>
          <tr class="kho-hd-tong"><td colspan="8" class="so">VAT ${H.loai === 'bang_ke' ? 0 : H.vat}%</td><td class="so dm-mono">${dmTien(T.vat)}</td><td></td></tr>
          <tr class="kho-hd-tong"><td colspan="8" class="so">Tổng gồm VAT = <b>công nợ phải trả</b></td><td class="so dm-mono"><b>${dmTien(T.gom)}</b></td><td></td></tr></tfoot></table>
      <div class="kho-hd-cb">⚠ Khớp 3 chiều (ERP 4.4): <b>SL trên HĐ ≤ SL đã nhận</b> (vượt → chặn). Giá HĐ ≠ giá đơn → <b>ghi lệch</b>, không chặn; giá lô còn sống của dòng đó đổi theo giá HĐ + bình quân tồn tính lại. Đơn sang <b>đã khớp HĐ</b> khi HĐ phủ hết SL đã nhận & mọi dòng giao đủ.</div>
      <div class="dm-row" style="margin-top:10px"><button class="n chinh" id="k-ghi-btn" ${chan ? 'disabled' : ''}>Ghi hoá đơn & tạo công nợ${coDong ? '' : ''}</button><button class="n" id="k-huy">Huỷ</button></div>
      ${coVuot ? '<div class="kho-hd-err">Sửa dòng đỏ (vượt số đã nhận) rồi mới ghi được.</div>' : ''}
      <div class="kho-hd-err" id="k-err"></div>`
    bind()
  }
  const focusBack = sel => { const el = box.querySelector(sel); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }
  function bind() {
    $('#kho-hd-back').onclick = () => veDonMua(); $('#k-huy').onclick = () => dmXem(id)
    $('#k-loai').onchange = e => { H.loai = e.target.value; if (H.loai === 'bang_ke') H.vat = 0; render() }
    $('#k-sohd').oninput = e => { H.so_hd = e.target.value; const b = $('#k-ghi-btn'); if (b) b.disabled = !(H.so_hd.trim() && L.some(x => num(x.sl_hd) > 0) && !L.some(vuot)) }
    $('#k-ngay').onchange = e => H.ngay_hd = e.target.value
    $('#k-han').onchange = e => H.han = e.target.value
    const kv = $('#k-vat'); if (kv) kv.onchange = e => { H.vat = Number(e.target.value); render() }
    $('#k-ghi').oninput = e => H.ghi_chu = e.target.value
    box.querySelectorAll('.k-sl').forEach(inp => inp.oninput = () => { const i = +inp.dataset.i; L[i].sl_hd = parseSL(inp.value); render(); focusBack(`.k-sl[data-i="${i}"]`) })
    box.querySelectorAll('.k-dg').forEach(inp => inp.oninput = () => { const i = +inp.dataset.i; L[i].dg_hd = Number(inp.value.replace(/\D/g, '')) || 0; render(); focusBack(`.k-dg[data-i="${i}"]`) })
    const g = $('#k-ghi-btn'); if (g) g.onclick = ghi
  }
  async function ghi() {
    const err = $('#k-err'); err.textContent = ''
    const dong = L.filter(x => x.rem > 0 && num(x.sl_hd) > 0 && !vuot(x)).map(x => ({ don_mua_dong_id: x.don_mua_dong_id, so_luong: num(x.sl_hd), don_gia_hd: num(x.dg_hd) }))
    if (!dong.length) { err.textContent = 'Cần nhập SL trên HĐ cho ít nhất 1 dòng.'; return }
    $('#k-ghi-btn').disabled = true
    const r = await sb.rpc('hd_ncc_ghi', { p_don_mua_id: id, p_so_hd: H.so_hd.trim(), p_loai: H.loai, p_ngay_hd: H.ngay_hd, p_han: H.han, p_vat_pct: H.loai === 'bang_ke' ? 0 : H.vat, p_ghi_chu: H.ghi_chu || null, p_dong: dong })
    if (r.error) {
      let m = r.error.message
      if (/HD_VUOT_NHAN/.test(m)) m = 'Số lượng trên hoá đơn vượt số đã nhận — ' + m.replace(/^.*HD_VUOT_NHAN: */, '')
      else if (/HD_TRUNG/.test(m)) m = 'NCC này đã có hoá đơn cùng số. ' + m.replace(/^.*HD_TRUNG: */, '')
      err.textContent = m; $('#k-ghi-btn').disabled = false; return
    }
    const g = r.data
    bao(`Đã ghi HĐ ${g.so_hd} · công nợ ${dmTien(g.tong_gom_vat)}đ${g.lech_gia_so_dong ? ' · lệch giá ' + g.lech_gia_so_dong + ' dòng' : ''} · đơn ${DM_TT[g.trang_thai_don] || g.trang_thai_don}`)
    dmXem(id)
  }
  render()
}
window.veDonMua = veDonMua
window.dmNhanForm = dmNhanForm
window.dmKhopForm = dmKhopForm

// ═══════════════════ WP-36 · ĐƠN VỊ & HAO HỤT (màn tsvt) ═══════════════════
const TSVT = { ds: [], sel: null, tim: '', chithieu: false }
// số VN: dấu phẩy thập phân; d = số lẻ. Trả '—' khi rỗng.
const tsN = (v, d = 2) => (v == null || v === '' || isNaN(Number(v))) ? '—' : Number(v).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d })
const tsParse = s => { if (s == null) return null; const t = String(s).trim().replace(/\./g, '').replace(',', '.'); return t === '' ? null : Number(t) }

async function veTsvt() {
  const el = $('#tsvt-ds'); if (el) el.innerHTML = '<li>Đang tải…</li>'
  const r = await sb.rpc('tham_so_vat_tu_ds')
  if (r.error) { if (el) el.innerHTML = `<li class="tsvt-loi">Không tải được: ${r.error.message}</li>`; return }
  TSVT.ds = r.data || []
  tsvtLoc()
  if (TSVT.sel && !TSVT.ds.find(v => v.id === TSVT.sel)) TSVT.sel = null
  if (TSVT.sel) tsvtChon(TSVT.sel, true)
}
function tsvtLoc() {
  TSVT.tim = ($('#tsvt-tim')?.value || '').trim().toLowerCase()
  TSVT.chithieu = !!$('#tsvt-chithieu')?.checked
  const ds = TSVT.ds.filter(v =>
    (!TSVT.chithieu || v.thieu_he_so) &&
    (!TSVT.tim || (v.ma + ' ' + (v.ten || '')).toLowerCase().includes(TSVT.tim)))
  const el = $('#tsvt-ds'); if (!el) return
  el.innerHTML = ds.length ? ds.map(v => {
    const m2 = (v.don_vi || []).find(u => u.don_vi === 'm2')
    let tag = '<span class="tsvt-tag">—</span>'
    if (v.thieu_he_so) tag = '<span class="tsvt-tag thieu">thiếu hệ số</span>'
    else if (m2 && Number(m2.he_so) > 0) tag = `<span class="tsvt-tag">${tsN(1 / Number(m2.he_so))} m²/tấm</span>`
    return `<li class="${v.id === TSVT.sel ? 'on' : ''}" onclick="tsvtChon('${v.id}')">
      <span>${v.ma}<br><small>${(v.ten || '').replace(/</g, '&lt;')} · ${v.don_vi_co_so}</small></span>${tag}</li>`
  }).join('') : '<li><small>Không có mã khớp bộ lọc.</small></li>'
}
function tsvtChon(id, giuHtml) {
  TSVT.sel = id
  if (!giuHtml) $$('#tsvt-ds li').forEach(li => li.classList.toggle('on', li.getAttribute('onclick')?.includes(id)))
  const v = TSVT.ds.find(x => x.id === id); const box = $('#tsvt-ct'); if (!v || !box) return
  const dv = (v.don_vi || []).slice().filter(u => u.don_vi !== v.don_vi_co_so)
  const khoaLy = `đã khoá — ${v.so_lo || 0} lô nhập · ${v.so_giu_cho || 0} giữ chỗ`
  const khoRow = v.la_van ? `
    <div class="tsvt-hang"><label>Khổ ván (mm)</label>
      <div><input id="ts-dai" inputmode="numeric" value="${v.kho_dai_mm ?? ''}" oninput="tsvtDienTich()"> ×
        <input id="ts-rong" inputmode="numeric" value="${v.kho_rong_mm ?? ''}" oninput="tsvtDienTich()">
        <span class="tsvt-chugiai" id="ts-dt"></span></div></div>` : ''
  const haoVal = v.hao_hut_pct == null ? '' : v.hao_hut_pct
  box.innerHTML = `
    <h3>${v.ma} — ${(v.ten || '').replace(/</g, '&lt;')}</h3>
    <div class="tsvt-hang"><label>Đơn vị cơ sở (kho đếm)</label>
      <div><input value="${v.don_vi_co_so}" disabled> <span class="tsvt-tag khoa">${khoaLy}</span></div></div>
    ${khoRow}
    <div class="tsvt-hang"><label>% hao hụt khi cắt</label>
      <div><input id="ts-hao" inputmode="decimal" value="${haoVal}"> % <span class="tsvt-tag tam">[TẠM] — WP-34 đo lại</span></div></div>
    <div class="tsvt-hang" style="border:0;padding-top:0"><label></label>
      <div class="tsvt-chugiai">Bỏ trống = dùng <b>mặc định nhóm</b> (ván 10 % · phụ kiện 0 %). Hiện áp: <b>${tsN(v.hao_hut_hieu_luc, 0)} %</b> (${v.hao_hut_nguon === 'tay' ? 'nhập tay' : 'mặc định nhóm'}).</div></div>
    <table class="tsvt-dv" id="ts-dv"><tr><th>Đơn vị khác</th><th>1 đơn vị = ? ${v.don_vi_co_so}</th><th>Nguồn</th><th></th></tr>
      ${dv.map((u, i) => tsvtRowDv(u.don_vi, u.he_so, v)).join('')}
      <tr id="ts-dv-add"><td colspan="4"><span class="tsvt-dvlink" onclick="tsvtThemDv()">+ thêm đơn vị</span> <span class="tsvt-chugiai">(đơn vị mua NCC, đơn vị bản vẽ…)</span></td></tr>
    </table>
    <div class="tsvt-ktra" id="ts-ktra"><span class="mo">Đang tính kiểm thử…</span></div>
    <div class="tsvt-nut"><button onclick="tsvtChon('${id}')">Huỷ</button><button class="chinh" onclick="tsvtLuu('${id}')">Lưu tham số</button></div>
    <div class="tsvt-chugiai">Lưu qua <code>luu_tham_so_vat_tu</code> (vai kho/ceo). Đổi hệ số KHÔNG sửa BOM đã snapshot — chỉ áp cho bàn giao sau; mỗi lần lưu ghi lịch sử.</div>`
  tsvtDienTich(); tsvtKtra(id)
}
function tsvtRowDv(don_vi, he_so, v) {
  const suy = don_vi === 'm2' && v.la_van
  return `<tr data-dv="${don_vi}"><td>${don_vi}</td>
    <td><input class="ts-hs" inputmode="decimal" value="${he_so == null ? '' : tsN(he_so, 5).replace(/\.?0+$/, '')}"></td>
    <td><span class="tsvt-tag ${suy ? 'suy' : ''}">${suy ? 'suy từ khổ' : 'nhập tay'}</span></td>
    <td><span class="tsvt-dvlink" onclick="this.closest('tr').remove()">xoá</span></td></tr>`
}
function tsvtThemDv() {
  const add = $('#ts-dv-add'); if (!add) return
  const tr = document.createElement('tr')
  tr.innerHTML = `<td><input class="ts-dv-ma" placeholder="vd: kien" style="width:90px;padding:6px 8px;border:1px solid var(--line);border-radius:6px"></td>
    <td><input class="ts-hs" inputmode="decimal" placeholder="hệ số"></td>
    <td><span class="tsvt-tag">nhập tay</span></td><td><span class="tsvt-dvlink" onclick="this.closest('tr').remove()">xoá</span></td>`
  add.parentNode.insertBefore(tr, add)
}
function tsvtDienTich() {
  const out = $('#ts-dt'); if (!out) return
  const d = tsParse($('#ts-dai')?.value), r = tsParse($('#ts-rong')?.value)
  out.innerHTML = (d > 0 && r > 0) ? `→ diện tích 1 tấm = <span class="tsvt-suy">${tsN(d * r / 1e6, 4)} m²</span> · hệ số m² = ${tsN(1e6 / (d * r), 5)}` : ''
}
async function tsvtKtra(id) {
  const box = $('#ts-ktra'); const v = TSVT.ds.find(x => x.id === id); if (!box || !v) return
  if (!v.don_demo) { box.innerHTML = '<span class="mo">Chưa có đơn demo nào dùng mã này để kiểm thử.</span>'; return }
  const r = await sb.rpc('thu_quy_doi_bom', { p_vat_tu_id: id, p_don_hang_id: v.don_demo.id })
  if (r.error || !r.data?.co) { box.innerHTML = `<span class="mo">Không tính được kiểm thử${r.error ? ': ' + r.error.message : ''}.</span>`; return }
  const g = r.data
  if (g.thieu_he_so) {
    box.innerHTML = `<b>Kiểm thử trên đơn demo ${v.don_demo.ma_don}</b> (chỉ tính)<br>
      BOM chuẩn mã này: <b>${tsN(g.bom_so_luong)} ${g.bom_don_vi}</b> → <span style="color:var(--do-dam)">chưa quy được (thiếu hệ số ${g.bom_don_vi}→${v.don_vi_co_so})</span>.
      <span class="mo">Nhập hệ số rồi Lưu → kho xuất bù các tem đã cắt.</span>`
    return
  }
  box.innerHTML = `<b>Kiểm thử trên đơn demo ${v.don_demo.ma_don}</b> (chỉ tính, không ghi sổ)<br>
    BOM chuẩn mã này: <b>${tsN(g.bom_so_luong)} ${g.bom_don_vi}</b> → ${tsN(g.so_co_so)} ${v.don_vi_co_so} → × (1 + ${tsN(g.hao_hut_pct, 0)} %) → làm tròn = <b>xuất ${tsN(g.so_xuat_ceil, 0)} ${v.don_vi_co_so}</b> khi quét CẮT.
    <span class="mo">Dư làm tròn ${tsN(g.so_du_lam_tron)} ${v.don_vi_co_so}.</span><br>
    <span class="mo">Giữ chỗ hiện tại: ${tsN(g.giu_cho_hien_tai)} → sau khi lưu: ${tsN(g.giu_cho_sau_khi_luu)} ${v.don_vi_co_so}.</span>`
}
async function tsvtLuu(id) {
  const v = TSVT.ds.find(x => x.id === id); if (!v) return
  const dai = v.la_van ? tsParse($('#ts-dai')?.value) : null
  const rong = v.la_van ? tsParse($('#ts-rong')?.value) : null
  const hao = tsParse($('#ts-hao')?.value)   // null = xoá ghi đè → mặc định nhóm
  const dv = []
  for (const tr of $$('#ts-dv tr[data-dv], #ts-dv tr:not([id])')) {
    const maEl = tr.querySelector('.ts-dv-ma'); const hsEl = tr.querySelector('.ts-hs'); if (!hsEl) continue
    const don_vi = maEl ? (maEl.value || '').trim() : tr.getAttribute('data-dv')
    const he_so = tsParse(hsEl.value)
    if (!don_vi || he_so == null) continue
    if (don_vi === 'm2' && v.la_van && dai > 0 && rong > 0) continue   // m² suy từ khổ → RPC tự ghi, khỏi gửi tay
    dv.push({ don_vi, he_so })
  }
  const r = await sb.rpc('luu_tham_so_vat_tu', { p_vat_tu_id: id, p_kho_dai_mm: dai, p_kho_rong_mm: rong, p_hao_hut_pct: hao, p_don_vi: dv })
  if (r.error) { bao('Lưu lỗi: ' + r.error.message); return }
  const bu = r.data?.tem_xuat_bu || 0
  bao(bu > 0 ? `Đã lưu · đã xuất bù ${bu} tem` : 'Đã lưu tham số')
  await veTsvt()
}
Object.assign(window, { veTsvt, tsvtLoc, tsvtChon, tsvtThemDv, tsvtDienTich, tsvtLuu })
