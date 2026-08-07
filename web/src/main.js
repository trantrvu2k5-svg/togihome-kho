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
function phongTo(ma) { const v = KHO.find(x => x.ma === ma); if (!ANH[ma]) return; $('#den-img').src = ANH[ma]; $('#den-ct').innerHTML = `<b>${v.ten}</b>${v.ma} · ${v.nhom} · tồn ${n(v.ton)} ${v.dvt}`; $('#den').classList.add('on') }
const dongDen = () => $('#den').classList.remove('on')
document.addEventListener('keydown', e => { if (e.key === 'Escape') { dongDen(); dongThe() } })

function chuyenMan(m) { $$('nav button').forEach(x => x.classList.toggle('on', x.dataset.m === m)); $$('.man').forEach(s => s.classList.toggle('on', s.id === 'm-' + m)); dongThe(); if (m === 'ton') lamMoiTon(); if (m === 'dat') veDat(); if (m === 'ncc') veNcc() }
$$('nav button').forEach(b => b.onclick = () => chuyenMan(b.dataset.m))

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
  $('#k-tien').textContent = n(kv.reduce((s, x) => s + x.ton * x.gia, 0))
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
    <span class="cach">${khoa ? `<button class="n nho" onclick="moiPhieu('${loai}');vePhieu('${loai}')">Lập phiếu mới</button>` : `<button class="n" onclick="themDong('${loai}')">+ Thêm dòng</button><button class="n chinh" onclick="ghiSo('${loai}')">Ghi sổ</button>`}</span>${khoa ? '' : `<span class="ghi-nhac">Phiếu chưa ghi sổ sẽ mất nếu tải lại trang.</span>`}</div>
    <div class="ph-than"><div class="hang"><div><label>Ngày chứng từ</label><input class="ip" type="date" ${ro} value="${p.luc.toISOString().slice(0, 10)}" onchange="P['${loai}'].luc=new Date(this.value);vePhieu('${loai}')"></div>${loai === 'nhap' ? dauNhap : dauXuat}<div><label>Ghi chú</label><input class="ip" ${ro} value="${p.ghi}" placeholder="Số hoá đơn, người giao…" oninput="P['${loai}'].ghi=this.value"></div></div>
    <table><thead><tr><th style="width:30px">#</th><th>Vật tư</th><th class="r" style="width:110px">Số lượng</th><th style="width:56px">ĐVT</th>${loai === 'nhap' ? '<th class="r" style="width:130px">Đơn giá (đ)</th>' : '<th class="r" style="width:100px">Tồn sau</th>'}<th class="r" style="width:130px">${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}</th><th style="width:34px"></th></tr></thead><tbody>
    ${p.dong.map((d, i) => { const v = KHO.find(x => x.ma === d.ma) || { ton: 0, dvt: '', min: 0, gia: 0 }; const sau = v.ton - (loai === 'xuat' ? d.sl : -d.sl); return `<tr><td style="color:#8A8F96;font-size:12.5px">${i + 1}</td><td>${khoa ? `<span style="font-size:13.5px">${v.ma || d.ma} — ${v.ten || ''}</span>` : `<select onchange="datDong('${loai}',${i},'ma',this)">${optVt(d.ma)}</select>`}</td><td class="r"><input class="ip num r" type="number" ${ro} value="${d.sl}" oninput="datSo('${loai}',${i},'sl',this)"></td><td style="color:#6E7681;font-size:13px">${v.dvt}</td>${loai === 'nhap' ? `<td class="r"><input class="ip num r" ${ro} value="${n(d.gia)}" oninput="datSo('${loai}',${i},'gia',this)" onblur="tien(this)"></td>` : `<td id="ts-${loai}-${i}" class="r num" style="color:${sau < 0 ? 'var(--do)' : sau < v.min ? 'var(--amber)' : '#6E7681'}">${n(sau)}</td>`}<td id="ct-${loai}-${i}" class="r num">${n(d.sl * (loai === 'nhap' ? d.gia : v.gia))}</td><td>${khoa ? '' : `<button class="xoa" onclick="xoaDong('${loai}',${i})">×</button>`}</td></tr>` }).join('')}</tbody></table></div>
    <div class="tong-ph"><div><span>Số dòng</span><b id="sd-${loai}">${p.dong.length}</b></div><div><span>Tổng số lượng</span><b id="tsl-${loai}">${n(tongSl)}</b></div><div><span>Tổng tiền</span><b id="tt-${loai}" style="color:var(--do)">${n(tongTien)} đ</b></div></div>`
}
async function ghiSo(loai) {
  const p = P[loai]; if (!p.dong.some(d => d.sl > 0)) { bao('Chưa dòng nào có số lượng.'); return }
  const dong = []; for (const d of p.dong) { if (d.sl <= 0) continue; const id = await maToId(d.ma); dong.push({ vat_tu_id: id, so_luong: d.sl, don_gia: loai === 'nhap' ? d.gia : null }) }
  const { data, error } = await sb.rpc('ghi_so_phieu', { p_loai: loai, p_ncc: loai === 'nhap' ? p.ncc : null, p_ly_do: loai === 'xuat' ? p.ly : null, p_ghi_chu: p.ghi, p_dong: dong })
  if (error) { bao('Ghi sổ lỗi: ' + error.message); return }
  p.tt = 'so'; p.so = data?.so_phieu || p.so; vePhieu(loai); await taiDuLieu(); veBang()
  bao(`Đã ghi sổ ${p.so}. Tồn + thẻ kho đã cập nhật.`)
}

function bao(t) { let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#2A323C;color:#fff;padding:11px 20px;border-radius:4px;font-size:14px;z-index:70;box-shadow:0 6px 20px rgba(0,0,0,.28);max-width:min(92vw,620px)'; document.body.appendChild(e) } e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', 4200) }

// ═══════════ BOOT ═══════════
function boot() {
  $('#tim').oninput = veBang
  veChips(); veBang()
  veNcc(); moiPhieu('nhap'); vePhieu('nhap'); moiPhieu('xuat'); vePhieu('xuat')
}

// phơi hàm cho onclick trong HTML sinh động
Object.assign(window, { moThe, dongThe, phongTo, dongDen, anhHong, themNcc, moiPhieu, themDong, xoaDong, datDong, datSo, vePhieu, ghiSo, P, tien, bao, suaVatTu, luuVatTu, lamMoiTon })
