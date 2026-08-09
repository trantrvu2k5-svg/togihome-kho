// TRANG BỌC app TÀI CHÍNH: Supabase + đăng nhập + cổng vai trò (CHỈ ceo/ke_toan) + nối 4 phần vào hàm DB.
// Mọi con số do DB tính (bang_gia, gia_bac_tu_gv, tinh_he_so_m, chot_niem_yet) — giá vốn không rời server.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb

const $ = id => document.getElementById(id)
const fmt = n => (n == null || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('vi-VN')
const pct = n => (Math.round(Number(n) * 10) / 10).toString().replace('.', ',')
const money = id => Number(($(id)?.value || '').replace(/\D/g, '')) || 0
const numv = id => { const v = parseFloat($(id)?.value); return isNaN(v) ? null : v }
const setMoney = (id, v) => { $(id).value = (v == null) ? '' : Number(v).toLocaleString('vi-VN') }
const fmtMoneyEl = el => { const v = el.value.replace(/\D/g, ''); el.value = v ? Number(v).toLocaleString('vi-VN') : '' }
let KY = null, USER = null

// ── đăng nhập ──
function manDangNhap(err) {
  $('root').innerHTML = '<div style="max-width:360px;margin:10vh auto;padding:0 20px;font-family:system-ui">' +
    '<h1 style="font-size:20px">Đăng nhập · Tài chính</h1>' +
    '<input id="e" type="email" placeholder="Email" style="width:100%;padding:12px;margin:8px 0;border:1px solid #D3D9E4;border-radius:10px">' +
    '<input id="p" type="password" placeholder="Mật khẩu" style="width:100%;padding:12px;margin:8px 0;border:1px solid #D3D9E4;border-radius:10px">' +
    '<div id="er" style="color:#C8202E;font-size:13px;min-height:18px">' + (err || '') + '</div>' +
    '<button id="b" style="width:100%;padding:12px;background:#131A2B;color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">Vào</button></div>'
  const go = async () => {
    $('er').textContent = ''
    const { data, error } = await sb.auth.signInWithPassword({ email: $('e').value.trim(), password: $('p').value })
    if (error) { $('er').textContent = 'Sai email hoặc mật khẩu.'; return }
    laySauDangNhap(data.user)
  }
  $('b').onclick = go; $('p').onkeydown = e => { if (e.key === 'Enter') go() }
}
async function laySauDangNhap(user) {
  const { data } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (!data || !data.dang_hoat_dong) { await sb.auth.signOut(); manDangNhap('Tài khoản chưa gán vai trò / đã ngưng.'); return }
  if (!['ceo', 'ke_toan'].includes(data.vai_tro)) {
    $('root').innerHTML = '<div style="max-width:420px;margin:12vh auto;text-align:center;font-family:system-ui">' +
      '<h2>Không có quyền</h2><p>App Tài chính chỉ cho <b>ceo</b> và <b>ke_toan</b>. Bạn là <b>' + data.vai_tro + '</b>.</p>' +
      '<button style="padding:10px 18px;border-radius:8px;cursor:pointer" onclick="window.__sb.auth.signOut().then(()=>location.reload())">Đăng xuất</button></div>'
    return
  }
  USER = data; await napApp()
}

async function napApp() {
  const html = await (await fetch('/togihome_taichinh.html')).text()
  $('root').innerHTML = html
  $('tc_who').textContent = 'Đăng nhập: ' + USER.ho_ten + ' (' + USER.vai_tro + '). Mọi số do DB tính — giá vốn không rời server.'
  const { data: kys } = await sb.from('tham_so_tai_chinh').select('ma_ky').order('ma_ky', { ascending: false })
  $('ky').innerHTML = (kys || []).map(r => `<option>${r.ma_ky}</option>`).join('') || '<option>2026-07</option>'
  // sự kiện
  $('ky').onchange = loadKy
  $('btn_luu').onclick = luuKy
  $('btn_tinh').onclick = refreshHeSoM
  $('btn_chot').onclick = chot
  document.querySelectorAll('#tc input.money').forEach(el => el.addEventListener('input', () => fmtMoneyEl(el)))
  ;['qc_gv', 'qc_loai', 'qc_nhom', 'qc_dx'].forEach(id => $(id).addEventListener('input', refreshQuick))
  await loadKy()
}

async function loadKy() {
  KY = $('ky').value; $('ky_chot').textContent = KY
  const { data } = await sb.from('tham_so_tai_chinh').select('*').eq('ma_ky', KY).maybeSingle()
  const t = data || {}
  setMoney('dt', t.dt_muc_tieu); $('sodon').value = t.so_don_ke_hoach ?? ''
  $('vat').value = t.vat ?? ''; $('hhs').value = t.hh_sale ?? ''; $('hhq').value = t.hh_quan_ly ?? ''; $('hht').value = t.hh_thiet_ke ?? ''
  setMoney('phile', t.phi_don_le); setMoney('phicombo', t.phi_don_combo); setMoney('phitk', t.phi_don_thiet_ke)
  $('transale').value = t.tran_sale ?? ''; $('trantn').value = t.tran_truong_nhom ?? ''; $('ghichu').value = t.ghi_chu ?? ''
  setTags(t.ghi_chu || '')
  await refreshHeSoM(); await refreshBang(); await refreshQuick(); await refreshChotInfo()
}
function setTags(ghichu) {
  const tam = /TẠM/i.test(ghichu)
  document.querySelectorAll('#tc [data-tag]').forEach(el => { el.textContent = tam ? 'TẠM' : 'ĐÃ CHỐT'; el.className = 'tag ' + (tam ? 'tam' : 'chot') })
}

// ① Lưu
async function luuKy() {
  const row = {
    dt_muc_tieu: money('dt'), so_don_ke_hoach: numv('sodon'), vat: numv('vat'),
    hh_sale: numv('hhs'), hh_quan_ly: numv('hhq'), hh_thiet_ke: numv('hht'),
    phi_don_le: money('phile'), phi_don_combo: money('phicombo'), phi_don_thiet_ke: money('phitk'),
    tran_sale: numv('transale'), tran_truong_nhom: numv('trantn'), ghi_chu: $('ghichu').value
  }
  const { error } = await sb.from('tham_so_tai_chinh').update(row).eq('ma_ky', KY)
  $('luu_msg').textContent = error ? ('❌ ' + error.message) : '✅ đã lưu — ② ③ tính lại theo số mới'
  if (!error) { setTags(row.ghi_chu || ''); await refreshHeSoM(); await refreshBang(); await refreshQuick() }
}

// ② he_so_m
async function refreshHeSoM() {
  const { data, error } = await sb.rpc('tinh_he_so_m', { p_ma_ky: KY })
  const box = $('thieu_box'), brk = $('hesom_break')
  if (error) { $('hesom').textContent = '—'; $('hesom_words').textContent = ''; brk.style.display = 'none'; box.style.display = 'block'; box.textContent = 'Lỗi: ' + error.message; return }
  if (data == null) {
    $('hesom').textContent = '—'; $('hesom_words').textContent = ''; brk.style.display = 'none'
    const thieu = await thieuGi()
    box.style.display = 'block'
    box.innerHTML = '<b>Chưa tính được he_so_m — THIẾU:</b><br>' + thieu.map(x => '• ' + x).join('<br>') +
      '<br><span style="color:#5a3">Nhập đủ + có đơn của kỳ rồi bấm “Tính lại”. (Không hiện 0, không để trống.)</span>'
    return
  }
  const m = Number(data); box.style.display = 'none'; brk.style.display = 'block'
  $('hesom').textContent = m.toFixed(4).replace('.', ',')
  $('hesom_words').innerHTML = 'Mỗi đồng giá vốn phải bán ra <b>' + m.toFixed(4).replace('.', ',') +
    '</b> đồng thì đạt mục tiêu <b>' + fmt(money('dt')) + '</b> với <b>' + numv('sodon') + '</b> đơn.'
  brk.innerHTML = '<div class="r"><span>Hệ số nhân giá vốn (từ hàm DB tinh_he_so_m)</span><span><b>' + m.toFixed(4).replace('.', ',') + '</b></span></div>'
}
async function thieuGi() {
  const t = (await sb.from('tham_so_tai_chinh').select('dt_muc_tieu,so_don_ke_hoach,phi_don_le').eq('ma_ky', KY).maybeSingle()).data || {}
  const thieu = []
  if (t.dt_muc_tieu == null) thieu.push('Doanh thu mục tiêu / tháng')
  if (!t.so_don_ke_hoach) thieu.push('Số đơn kế hoạch / tháng')
  if (t.phi_don_le == null) thieu.push('Phí mỗi đơn — hàng lẻ')
  const { count } = await sb.from('don_hang').select('*', { count: 'exact', head: true }).eq('ma_ky_ap_dung', KY)
  if (!count) thieu.push('Đơn có giá chuyển giao đóng dấu kỳ ' + KY + ' (chưa có đơn để lấy giá vốn trung bình / đơn)')
  return thieu.length ? thieu : ['(đủ tham số nhưng hàm trả null — kiểm dữ liệu đơn)']
}

// ③ bảng giá
async function refreshBang() {
  const { data, error } = await sb.rpc('bang_gia', { p_dong: 'le', p_ngay: today() })
  const tb = $('bang')
  if (error) { tb.innerHTML = '<tr><td colspan="6" style="color:#C8202E">Lỗi: ' + error.message + '</td></tr>'; return }
  tb.innerHTML = (data || []).map(r =>
    '<tr><td class="ten">' + r.ten + '</td><td>' + fmt(r.gia_von) + '</td><td>' + fmt(r.tang_1) + '</td><td>' +
    fmt(r.gia_san) + '</td><td>' + fmt(r.bao_khach) + '</td><td>' + pct(r.tran) + '%</td></tr>').join('') ||
    '<tr><td colspan="6" style="text-align:center;color:#8A9">chưa có mẫu</td></tr>'
}

// ★ tính nhanh
async function refreshQuick() {
  const gv = money('qc_gv'), loai = $('qc_loai').value, nhom = numv('qc_nhom') || 1
  const { data, error } = await sb.rpc('gia_bac_tu_gv', { p_gv: gv, p_dong: loai, p_nhom: nhom })
  if (error) { $('qc_cascade').innerHTML = '<div style="color:#C8202E">Lỗi: ' + error.message + '</div>'; return }
  if (!data || data.he_so_m == null) {
    $('qc_cascade').innerHTML = '<div style="color:#8A1620">Chưa tính được — he_so_m của kỳ chưa có.</div>'
    $('qc_baokhach').textContent = '—'; $('qc_salemin').textContent = '—'; return
  }
  const d = data
  const crow = (l, v, tag) => '<div class="row"><span class="lbl">' + l + '</span><span class="val">' + fmt(v) + (tag ? '<span class="tag2">[' + tag + ']</span>' : '') + '</span></div>'
  $('qc_cascade').innerHTML =
    crow('Giá vốn', gv) +
    crow('+ lãi (×' + Number(d.mult).toFixed(4).replace('.', ',') + ')', d.tang_1, 'tầng 1') +
    crow('+ phí đơn (' + labelLoai(loai) + ')', Number(d.tang_1) + Number(d.phi)) +
    crow('÷ (1 − ' + pct(Number(d.hh) * 100) + '% hoa hồng)', d.gia_san, 'GIÁ SÀN — chưa VAT') +
    crow('+ VAT ' + pct(Number(d.vat)) + '%', d.bao_khach, 'BÁO KHÁCH')
  $('qc_baokhach').textContent = fmt(d.bao_khach)
  const salemin = Number(d.bao_khach) * (1 - Number(d.tran_sale) / 100)
  $('qc_salemin_lbl').textContent = 'Sale được giảm tối đa ' + pct(d.tran_sale) + '% → còn'
  $('qc_salemin').textContent = fmt(salemin)
  const dx = money('qc_dx'), out = $('qc_dx_out')
  if (!dx) out.innerHTML = ''
  else if (dx < Number(d.bao_khach)) out.innerHTML = '<span class="red">⚠ Dưới giá sàn — không được. Sàn báo khách là ' + fmt(d.bao_khach) + '.</span>'
  else { const chenh = (dx - d.bao_khach) / d.bao_khach * 100, lan = dx / gv
    out.innerHTML = '<span class="ok">Cao hơn sàn ' + pct(chenh) + '%</span> · bằng <b>' + (Math.round(lan * 100) / 100).toString().replace('.', ',') + '×</b> giá vốn.' }
}
const labelLoai = l => l === 'combo' ? 'combo' : l === 'du_an' ? 'thiết kế' : 'hàng lẻ'

// ④ chốt niêm yết
async function refreshChotInfo() {
  const { data } = await sb.rpc('niem_yet_info', { p_ma_ky: KY })
  const i = data || {}
  $('chot_info').textContent = i.so_dong ? ('Đã chốt ' + i.so_dong + ' mẫu · lúc ' + (i.chot_luc ? new Date(i.chot_luc).toLocaleString('vi-VN') : '—') + ' · bởi ' + (i.chot_boi || '—')) : ''
}
async function chot() {
  if (!confirm('Chốt niêm yết cho kỳ ' + KY + '? Ghi giá hiện tại vào gia_niem_yet (bất biến cho kỳ này).')) return
  const { data, error } = await sb.rpc('chot_niem_yet', { p_ma_ky: KY })
  if (error) { $('chot_info').textContent = '❌ ' + error.message; $('chot_info').style.color = '#C8202E'; return }
  $('chot_info').style.color = '#175E24'
  await refreshChotInfo()
  $('chot_info').textContent = '✅ Đã chốt ' + data + ' mẫu cho kỳ ' + KY + '. ' + $('chot_info').textContent
}

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// ── khởi động ──
sb.auth.getSession().then(({ data }) => { if (data.session) laySauDangNhap(data.session.user); else manDangNhap() })
