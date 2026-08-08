// Togihome Kho — web app. Nối Supabase (schema kho) bằng khoá anon; RLS là cổng.
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const sb = createClient(URL, ANON, { db: { schema: 'kho' }, auth: { persistSession: true } })

// ── helpers (giữ từ bản nháp) ──
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)]
const n = v => Math.round(v || 0).toLocaleString('vi-VN')
const gio = d => d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ngay = d => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const anhUrl = ma => ma ? `https://drive.google.com/thumbnail?id=${ma}&sz=w400` : null
// URL ảnh bucket công khai — địa chỉ dự án lấy từ env VITE_SUPABASE_URL (KHÔNG viết cứng). f = kho.vat_tu.anh_file.
const anhBucket = f => f ? `${URL}/storage/v1/object/public/kho-images/${f}` : null

// ── trạng thái ──
let KHO = [], NCC = [], NHOM = [], TK = {}, ANH = {}, PHIEU = [], SO = { nhap: 0, xuat: 0 }
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
  const { data: nd, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro').eq('auth_uid', user.id).maybeSingle()
  if (error || !nd) { $('#lg-err').textContent = 'Tài khoản chưa được gán vai trò trong kho.nguoi_dung — báo CEO.'; await sb.auth.signOut(); return }
  ROLE = nd.vai_tro; ME = nd.ho_ten; ME_ID = nd.id
  $('#login').classList.remove('on')
  $('#ai').textContent = `${nd.ho_ten} · ${ROLE.toUpperCase()}`
  // nút Đăng xuất (thêm 1 lần)
  if (!document.getElementById('btn-out')) {
    const b = document.createElement('button'); b.id = 'btn-out'; b.textContent = 'Đăng xuất'
    b.style.cssText = 'margin-left:10px;background:#fff;color:#C0392B;border:0;border-radius:3px;padding:3px 11px;font-size:12px;font-weight:600;cursor:pointer'
    b.onclick = async () => { await sb.auth.signOut(); location.reload() }
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
    sb.from('vat_tu').select('ma,ten,loai,nhom_id,dvt,so_moi_dvt,do_day_mm,vat_lieu,hoan_thien,ma_van_ncc,anh_ma,anh_file,ton_toi_thieu'),
    sb.from('ton').select('vat_tu_id,so_luong,vat_tu:vat_tu_id(ma)'),
    sb.from('v_ton_gia_von').select('vat_tu_id,gia_von_bq,vat_tu:vat_tu_id(ma)'),  // rỗng nếu là thợ
    sb.from('v_gia_tham_khao').select('ma,gia_tham_khao'),                          // rỗng nếu là thợ
    sb.from('nha_cung_cap').select('id,ten,dien_thoai,dia_chi')
  ])
  // Lỗi bất kỳ truy vấn -> KHÔNG dựng lại KHO (giữ nguyên, không clobber), trả lỗi cho nơi gọi hiện ra.
  const loi = res.find(r => r.error)
  if (loi) return { ok: false, loi: loi.error.message }
  const [{ data: nhom }, { data: vt }, { data: ton }, { data: gv }, { data: gtk }, { data: ncc }] = res
  NHOM = nhom || []
  const tenNhom = Object.fromEntries(NHOM.map(x => [x.id, x.ten]))
  const tonMa = Object.fromEntries((ton || []).map(t => [t.vat_tu?.ma, t.so_luong]))
  const giaMa = Object.fromEntries((gv || []).map(g => [g.vat_tu?.ma, g.gia_von_bq]))
  const gtkMa = Object.fromEntries((gtk || []).map(g => [g.ma, g.gia_tham_khao]))
  KHO = (vt || []).map(v => ({
    ma: v.ma, ten: v.ten, kho: v.loai, nhom: tenNhom[v.nhom_id] || '—', nhom_id: v.nhom_id,
    dvt: v.dvt, sl: v.so_moi_dvt, min: v.ton_toi_thieu || 0, cktr: v.can_kiem_tra,
    ton: tonMa[v.ma] || 0, gia: giaMa[v.ma] || 0, gtk: gtkMa[v.ma] || 0,
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

function chuyenMan(m) { $$('nav button[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === m)); $$('.man').forEach(s => s.classList.toggle('on', s.id === 'm-' + m)); dongThe(); dongNav(); if (m === 'ton') lamMoiTon(); if (m === 'dat') veDat(); if (m === 'ncc') veNcc(); if (m === 'nhap') veDsPhieu('nhap'); if (m === 'xuat') veDsPhieu('xuat'); if (m === 'ghep') veGhepMa() }
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
  if (bang) bang.innerHTML = '<tr><td colspan="8" style="padding:22px;color:#6E7681">Đang tải…</td></tr>'
  const r = await taiDuLieu()
  if (btn) { btn.disabled = false; btn.textContent = 'Làm mới' }
  if (!r || !r.ok) {
    if (bang) bang.innerHTML = `<tr><td colspan="8" style="padding:22px;color:var(--do)">Không tải được dữ liệu từ máy chủ${r && r.loi ? ': ' + r.loi : ''}. Bấm Làm mới để thử lại.</td></tr>`
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
      <td class="r num">${x.gia ? n(x.gia) : (x.gtk ? `<span class="chua-gia" title="giá mua tham khảo — chưa có tồn/giá vốn thật">${n(x.gtk)} · tham khảo</span>` : '—')}</td></tr>`
  }).join('') || `<tr><td colspan="8" style="padding:22px;color:#6E7681">Không có mã nào khớp.</td></tr>`
  const kv = KHO.filter(x => locKho === '*' || x.kho === locKho)
  $('#k-ma').textContent = n(kv.length)
  $('#k-duoi').textContent = n(kv.filter(x => x.min > 0 && x.ton < x.min).length)
  $('#k-thieu').textContent = n(kv.filter(x => !x.gia).length)
  veOTien(kv.reduce((s, x) => s + x.ton * x.gia, 0))
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
function veDat() {
  $$('.muc button').forEach(b => b.onclick = () => { const l = +b.dataset.l; if (l > 1) { bao(l === 2 ? 'Mức 2 cần đơn đã chốt + BOM từ plugin — chưa nối.' : 'Mức 3 cần lịch sử xuất + thời gian giao hàng — chưa có.'); return } $$('.muc button').forEach(x => x.classList.remove('on')); b.classList.add('on'); veDat() })
  const ds = KHO.filter(x => x.min > 0 && x.ton < x.min)
  if (!ds.length) { $('#dat-ds').innerHTML = '<div class="rong">Không mã nào dưới mức tối thiểu.</div>'; return }
  const ct = ds.reduce((s, x) => s + Math.ceil(x.min - x.ton) * x.gia, 0)
  $('#dat-ds').innerHTML = `<div style="display:flex;align-items:baseline;gap:12px;margin:20px 0 8px"><h3 style="font-size:14px;margin:0">Chưa gán nhà cung cấp</h3><span style="font-size:12.5px;color:var(--muted)">${ds.length} mã · ước ${n(ct)} đ</span></div>
    <table><thead><tr><th style="width:64px">Ảnh</th><th style="width:86px">Mã</th><th>Tên</th><th class="r" style="width:70px">Tồn</th><th class="r" style="width:78px">Tối thiểu</th><th class="r" style="width:96px">Cần mua</th><th class="r" style="width:120px">Ước tiền</th></tr></thead>
    <tbody>${ds.map(x => { const c = Math.ceil(x.min - x.ton); return `<tr class="click" onclick="moThe('${x.ma}')"><td>${oAnh(x)}</td><td class="ma">${x.ma}</td><td>${x.ten}</td><td class="r num" style="color:var(--do);font-weight:700">${n(x.ton)}</td><td class="r num" style="color:#6E7681">${n(x.min)}</td><td class="r num"><b>${n(c)}</b> <span style="color:#6E7681;font-size:12px">${x.dvt}</span></td><td class="r num">${x.gia ? n(c * x.gia) : '<span style="color:var(--amber)">chưa có giá</span>'}</td></tr>` }).join('')}</tbody></table>`
}

// ── nhà cung cấp ──
async function themNcc() {
  const t = $('#ncc-ten').value.trim(); if (!t) { bao('Nhập tên nhà cung cấp đã.'); return }
  const { error } = await sb.from('nha_cung_cap').insert({ ten: t, dien_thoai: $('#ncc-dt').value.trim() || null, dia_chi: null })
  if (error) { bao('Không thêm được: ' + error.message); return }
  $('#ncc-ten').value = ''; $('#ncc-dt').value = ''; $('#ncc-mh').value = ''
  await taiDuLieu(); veNcc(); bao(`Đã thêm ${t}.`)
}
function veNcc() { $('#ncc-b').innerHTML = NCC.filter(c => c.id).map(c => `<tr><td class="ma">${c.id.slice ? c.id.slice(0, 4) : c.id}</td><td><b>${c.ten}</b></td><td class="num" style="font-size:13px">${c.dt || '—'}</td><td style="font-size:13.5px;color:#5A6169">${c.mh || '—'}</td><td style="font-size:13px;color:#8A8F96">${c.dc || '—'}</td><td class="r num">—</td></tr>`).join('') || '<tr><td colspan="6" class="rong">Chưa có nhà cung cấp.</td></tr>' }

// ── phiếu nhập/xuất (nháp → ghi sổ) ──
const P = { nhap: null, xuat: null }
function tien(el) { const v = el.value.replace(/\D/g, ''); el.value = v ? Number(v).toLocaleString('vi-VN') : '' }
const soTien = el => Number(String(el.value).replace(/\D/g, '')) || 0
function moiPhieu(loai) { SO[loai]++; P[loai] = { loai, so: (loai === 'nhap' ? 'NK' : 'XK') + '-2026-' + String(SO[loai]).padStart(4, '0'), luc: new Date(), ncc: NCC[0]?.id, ly: 'Sản xuất', ghi: '', tt: 'nhap', dong: [] }; themDong(loai) }
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
  const dauXuat = `<div><label>Lý do xuất</label><select ${ro} onchange="P.xuat.ly=this.value">${['Sản xuất', 'Lắp đặt tại nhà khách', 'Hỏng / mất', 'Trả nhà cung cấp'].map(l => `<option${l === p.ly ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`
  $('#ph-' + loai).innerHTML = `<div class="ph-dau"><span class="ph-so">${p.so}</span><span class="tt ${khoa ? 'so' : 'nhap-tt'}">${khoa ? 'ĐÃ GHI SỔ' : 'NHÁP'}</span><span style="font-size:13px;color:var(--muted)">Lập lúc ${gio(p.luc)}</span>
    <span class="cach">${khoa ? `<button class="n nho" onclick="moiPhieu('${loai}');vePhieu('${loai}')">Lập phiếu mới</button>` : `<button class="n" onclick="themDong('${loai}')">+ Thêm dòng</button><button class="n chinh" onclick="ghiSo('${loai}')">Ghi sổ</button>`}</span>${khoa ? '' : `<span class="ghi-nhac">Ghi sổ rồi là <b>KHOÁ</b> — muốn sửa phải <b>huỷ phiếu</b> rồi làm lại. (Phiếu chưa ghi sổ sẽ mất nếu tải lại trang.)</span>`}</div>
    <div class="ph-than"><div class="hang"><div><label>Ngày chứng từ</label><input class="ip" type="date" ${ro} value="${p.luc.toISOString().slice(0, 10)}" onchange="P['${loai}'].luc=new Date(this.value);vePhieu('${loai}')"></div>${loai === 'nhap' ? dauNhap : dauXuat}<div><label>Ghi chú</label><input class="ip" ${ro} value="${p.ghi}" placeholder="Số hoá đơn, người giao…" oninput="P['${loai}'].ghi=this.value"></div></div>
    <table><thead><tr><th style="width:30px">#</th><th>Vật tư</th><th class="r" style="width:110px">Số lượng</th><th style="width:56px">ĐVT</th>${loai === 'nhap' ? '<th class="r" style="width:130px">Đơn giá (đ)</th>' : '<th class="r" style="width:100px">Tồn sau</th>'}<th class="r" style="width:130px">${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}</th><th style="width:34px"></th></tr></thead><tbody>
    ${p.dong.map((d, i) => { const v = KHO.find(x => x.ma === d.ma) || { ton: 0, dvt: '', min: 0, gia: 0 }; const sau = v.ton - (loai === 'xuat' ? d.sl : -d.sl); return `<tr><td style="color:#8A8F96;font-size:12.5px">${i + 1}</td><td data-label="Vật tư">${khoa ? `<span style="font-size:13.5px">${v.ma || d.ma} — ${v.ten || ''}</span>` : `<select onchange="datDong('${loai}',${i},'ma',this)">${optVt(d.ma)}</select>`}</td><td class="r" data-label="Số lượng"><input class="ip num r" type="number" ${ro} value="${d.sl}" oninput="datSo('${loai}',${i},'sl',this)"></td><td style="color:#6E7681;font-size:13px" data-label="ĐVT">${v.dvt}</td>${loai === 'nhap' ? `<td class="r" data-label="Đơn giá"><input class="ip num r" ${ro} value="${n(d.gia)}" oninput="datSo('${loai}',${i},'gia',this)" onblur="tien(this)"></td>` : `<td id="ts-${loai}-${i}" class="r num" data-label="Tồn sau" style="color:${sau < 0 ? 'var(--do)' : sau < v.min ? 'var(--amber)' : '#6E7681'}">${n(sau)}</td>`}<td id="ct-${loai}-${i}" class="r num" data-label="${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}">${n(d.sl * (loai === 'nhap' ? d.gia : v.gia))}</td><td>${khoa ? '' : `<button class="xoa" onclick="xoaDong('${loai}',${i})">×</button>`}</td></tr>` }).join('')}</tbody></table></div>
    <div class="tong-ph"><div><span>Số dòng</span><b id="sd-${loai}">${p.dong.length}</b></div><div><span>Tổng số lượng</span><b id="tsl-${loai}">${n(tongSl)}</b></div><div><span>Tổng tiền</span><b id="tt-${loai}" style="color:var(--do)">${n(tongTien)} đ</b></div></div>`
}
async function ghiSo(loai) {
  const p = P[loai]; if (!p.dong.some(d => d.sl > 0)) { bao('Chưa dòng nào có số lượng.'); return }
  const dong = []; for (const d of p.dong) { if (d.sl <= 0) continue; const id = await maToId(d.ma); dong.push({ vat_tu_id: id, so_luong: d.sl, don_gia: loai === 'nhap' ? d.gia : null }) }
  const { data, error } = await sb.rpc('ghi_so_phieu', { p_loai: loai, p_ncc: loai === 'nhap' ? p.ncc : null, p_ly_do: loai === 'xuat' ? p.ly : null, p_ghi_chu: p.ghi, p_dong: dong })
  if (error) { bao('Ghi sổ lỗi: ' + error.message); return }
  p.tt = 'so'; p.so = data?.so_phieu || p.so; vePhieu(loai); await taiDuLieu(); veBang(); veDsPhieu(loai)
  bao(`Đã ghi sổ ${p.so}. Tồn + thẻ kho đã cập nhật.`)
}

// ── DANH SÁCH PHIẾU ĐÃ LẬP · XEM CHI TIẾT (chỉ đọc) · HUỶ PHIẾU (gọi RPC huy_phieu) ──
// Trang nhập hiện tiền tố NK (nhập) + HN (huỷ nhập); trang xuất hiện XK + HX. Phiếu ngược mang loai 'dieu_chinh'
// nên KHÔNG lọc theo loai mà lọc theo tiền tố mã phiếu.
const PH_PRE = { nhap: ['NK', 'HN'], xuat: ['XK', 'HX'] }
let DSPH = { nhap: [], xuat: [] }, phGioi = { nhap: 50, xuat: 50 }, phXem = null

async function veDsPhieu(loai) {
  const el = $('#ds-' + loai); if (!el) return
  el.innerHTML = '<div class="rong">Đang tải…</div>'
  const pre = PH_PRE[loai]
  // Đơn giá/thành tiền ở phieu_dong (đã cấp quyền đọc ở migration 016). Vật tư nhúng để hiện tên.
  const { data, error } = await sb.from('phieu')
    .select('id,so_phieu,loai,trang_thai,ncc_id,ly_do,phieu_goc_id,tao_luc,ghi_so_luc,ghi_so_boi,' +
            'ncc:ncc_id(ten), nguoi:ghi_so_boi(ho_ten), dong:phieu_dong(so_luong,don_gia,thanh_tien, vt:vat_tu_id(ma,ten))')
    .or(pre.map(p => `so_phieu.like.${p}-*`).join(','))
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
    return `<div class="dsp-row ${huy ? 'huy' : ''}" onclick="moPhieuXem('${loai}','${r.id}')">
      <div><span class="dsp-so">${r.so_phieu}</span>${tag}</div>
      <div class="dsp-meta">${gio(new Date(r.tao_luc))}${r.ncc?.ten ? ' · ' + r.ncc.ten : ''} · ${dong.length} dòng · SL ${n(sl)} · ${n(tien)} đ · ${r.nguoi?.ho_ten || '—'}</div></div>`
  }).join('') + (DSPH[loai].length >= phGioi[loai] ? `<div class="dsp-more"><button class="n nho" onclick="phXemThem('${loai}')">Xem thêm</button></div>` : '')
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

// ═══════════ GHÉP MÃ — đọc/ghi kho.quy_doi (bảng quy đổi thiết kế ↔ mã kho) ═══════════
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
  const { data, error } = await sb.from('quy_doi').select(gmSelectCols)
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
  const { data, error } = await sb.from('quy_doi').select('ma_kho')
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
      <button class="nut" onclick="gmBoQuaMa('${x.ma}')">Không liên quan</button></div>`).join('')
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
  const { data, error } = await sb.from('quy_doi').select('mo_ta_thiet_ke,trang_thai,la_mac_dinh')
  if (error) { bao('Đọc quy_doi lỗi: ' + error.message); return }
  const soMoTa = new Set((data || []).map(r => r.mo_ta_thiet_ke)).size
  const daDuyet = (data || []).filter(r => r.trang_thai === 'DA_DUYET' && r.la_mac_dinh).length
  if (daDuyet === 0) { bao('Chưa có dòng nào ĐÃ DUYỆT — không có gì để xuất (không tải file rỗng).'); return }
  const conLai = soMoTa - daDuyet
  if (conLai > 0) {
    $('#gm-modal-msg').innerHTML = `Xuất bây giờ: <b>${daDuyet}</b> mô tả CÓ giá kho (sẽ ghi vào file). Còn <b>${conLai}</b> mô tả CHƯA chốt — plugin vẫn phải dùng <b>giá cũ</b> cho các mã này. Làm dần từng phần là hợp lý — vẫn xuất phần đã có?`
    $('#gm-modal').style.display = 'flex'
    $('#gm-modal-ok').onclick = () => { gmModalDong(); gmTaiFile() }
  } else {
    gmTaiFile()
  }
}
function gmModalDong() { const m = $('#gm-modal'); if (m) m.style.display = 'none' }
async function gmTaiFile() {
  // ĐỌC + DỰNG y hệt xuat_quy_doi.mjs: chỉ DA_DUYET+la_mac_dinh, sắp theo mo_ta_thiet_ke, giá vốn từ v_ton_gia_von (raw, null giữ nguyên)
  const { data, error } = await sb.from('quy_doi')
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
        <button class="nut${chon ? ' on' : ''}" onclick="gmChon('${r.id}','${g.mo_ta}')">${chon ? '✓ Đã chọn' : 'Chọn'}</button></div>`
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
  const { data } = await sb.from('quy_doi').select(gmSelectCols).eq('mo_ta_thiet_ke', mo_ta)
    .order('la_mac_dinh', { ascending: false }).order('ma_kho', { nullsFirst: false })
  const g = GHEP.find(x => x.mo_ta === mo_ta)
  if (g && data && data.length) { g.rows = data; g.ten = data[0].ten_mo_ta ?? g.ten }
  const el = $(`#gm-k-${mo_ta}`); if (el && g) el.outerHTML = gmKhoiHtml(g)
  gmDem(); gmLoc()
}

// CHỌN ứng viên: BỎ cờ mặc định cũ TRƯỚC (tránh vi phạm ràng buộc 1-mặc-định), rồi đặt cờ mới + DA_DUYET.
async function gmChon(id, mo_ta) {
  const e1 = (await sb.from('quy_doi').update({ la_mac_dinh: false }).eq('mo_ta_thiet_ke', mo_ta)).error
  if (e1) { bao('Bỏ cờ mặc định cũ lỗi: ' + e1.message); return }
  const { error } = await sb.from('quy_doi').update({ la_mac_dinh: true, trang_thai: 'DA_DUYET', nguoi_duyet: ME_ID, duyet_luc: new Date().toISOString() }).eq('id', id)
  if (error) { bao('Chốt lỗi: ' + error.message); return }   // hiện NGUYÊN VĂN lỗi (gồm lỗi ràng buộc)
  bao('Đã chốt mã kho mặc định cho mô tả này.')
  await gmReload(mo_ta)
}
// KHÔNG GHÉP: bắt buộc có ghi chú (app chặn TRƯỚC, không để lỗi CSDL bắn thô).
async function gmKhongGhep(mo_ta) {
  const g = GHEP.find(x => x.mo_ta === mo_ta); if (!g) return
  const ghiInp = $(`#gm-k-${mo_ta} [data-ghi]`), ly = (ghiInp ? ghiInp.value : '').trim()
  if (!ly) { bao('Nhập LÝ DO vào ô ghi chú trước khi bấm Không ghép.'); if (ghiInp) ghiInp.focus(); return }
  const primary = gmActive(g)
  const { error } = await sb.from('quy_doi').update({ trang_thai: 'KHONG_GHEP', ma_kho: null, la_mac_dinh: false, ghi_chu: ly, nguoi_duyet: ME_ID, duyet_luc: new Date().toISOString() }).eq('id', primary.id)
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
      const { error } = await sb.from('quy_doi').update({ he_so_quy_doi: so }).eq('id', t.dataset.hs)
      if (error) { bao('Lưu hệ số lỗi: ' + error.message); return }
      const g = GHEP.find(x => x.mo_ta === t.dataset.mota), row = g && g.rows.find(r => r.id === t.dataset.hs); if (row) row.he_so_quy_doi = so
      const slot = $(`#gm-k-${t.dataset.mota} .gm-cbao-slot`); if (slot && g) slot.innerHTML = gmWarnHtml(g)
      gmDem(); gmLoc(); bao('Đã lưu hệ số quy đổi.')
    } else if (t.dataset.ghi != null && t.dataset.ghi !== '') {
      const { error } = await sb.from('quy_doi').update({ ghi_chu: t.value }).eq('id', t.dataset.ghi)
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
Object.assign(window, { moThe, dongThe, phongTo, dongDen, anhHong, taiAnh, themNcc, moiPhieu, themDong, xoaDong, datDong, datSo, vePhieu, ghiSo, P, tien, bao, suaVatTu, luuVatTu, lamMoiTon, moNav, dongNav, toggleLoc, toggleTien, veDsPhieu, phXemThem, moPhieuXem, moXacNhanHuy, xacNhanHuy, veGhepMa, gmChon, gmKhongGhep, gmXuat, gmModalDong, gmMoChua, gmBoQuaMa })
