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

// ── trạng thái ──
let KHO = [], NCC = [], TK = {}, ANH = {}, PHIEU = [], SO = { nhap: 0, xuat: 0 }
let locNhom = '*', locKho = '*', ROLE = null, ME = null
const laTho = () => ROLE === 'tho'

// ═══════════ ĐĂNG NHẬP ═══════════
let cheDo = 'email'
$('#tab-email').onclick = () => { cheDo = 'email'; $('#tab-email').classList.add('on'); $('#tab-pin').classList.remove('on'); $('#f-email').style.display = ''; $('#f-pin').style.display = 'none' }
$('#tab-pin').onclick = () => { cheDo = 'pin'; $('#tab-pin').classList.add('on'); $('#tab-email').classList.remove('on'); $('#f-pin').style.display = ''; $('#f-email').style.display = 'none' }
$('#lg-btn').onclick = dangNhap
$('#lg-pin').addEventListener('keydown', e => { if (e.key === 'Enter') dangNhap() })
$('#lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') dangNhap() })

async function dangNhap() {
  const err = $('#lg-err'); err.textContent = ''
  let email, pass
  if (cheDo === 'email') { email = $('#lg-email').value.trim(); pass = $('#lg-pass').value }
  else { const pin = $('#lg-pin').value.trim(); if (!/^\d{4,}$/.test(pin)) { err.textContent = 'PIN tối thiểu 4 số.'; return } email = `tho${pin}@kho.local`; pass = pin }
  $('#lg-btn').disabled = true; $('#lg-btn').textContent = 'Đang vào…'
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass })
  $('#lg-btn').disabled = false; $('#lg-btn').textContent = 'Đăng nhập'
  if (error) { err.textContent = 'Sai thông tin đăng nhập hoặc tài khoản chưa tạo.'; return }
  await vaoApp(data.user)
}

async function vaoApp(user) {
  const { data: nd, error } = await sb.from('nguoi_dung').select('ho_ten,vai_tro').eq('auth_uid', user.id).maybeSingle()
  if (error || !nd) { $('#lg-err').textContent = 'Tài khoản chưa được gán vai trò trong kho.nguoi_dung — báo CEO.'; await sb.auth.signOut(); return }
  ROLE = nd.vai_tro; ME = nd.ho_ten
  $('#login').classList.remove('on')
  $('#ai').textContent = `${nd.ho_ten} · ${ROLE.toUpperCase()}`
  // nút Đăng xuất (thêm 1 lần)
  if (!document.getElementById('btn-out')) {
    const b = document.createElement('button'); b.id = 'btn-out'; b.textContent = 'Đăng xuất'
    b.style.cssText = 'margin-left:10px;background:#fff;color:#C0392B;border:0;border-radius:3px;padding:3px 11px;font-size:12px;font-weight:600;cursor:pointer'
    b.onclick = async () => { await sb.auth.signOut(); location.reload() }
    document.querySelector('header').appendChild(b)
  }
  // thợ: chỉ Quét mã
  if (laTho()) { $$('nav button').forEach(b => { if (b.dataset.m !== 'quet') b.style.display = 'none' }); chuyenMan('quet') }
  await taiDuLieu()
  boot()
}

// phiên cũ còn hạn -> vào thẳng
sb.auth.getSession().then(({ data }) => { if (data.session) vaoApp(data.session.user) })

// ═══════════ TẢI DỮ LIỆU ═══════════
async function taiDuLieu() {
  const [{ data: nhom }, { data: vt }, { data: ton }, { data: gv }, { data: ncc }] = await Promise.all([
    sb.from('nhom').select('id,ten'),
    sb.from('vat_tu').select('ma,ten,loai,nhom_id,dvt,so_moi_dvt,do_day_mm,vat_lieu,hoan_thien,ma_van_ncc,anh_ma,ton_toi_thieu'),
    sb.from('ton').select('vat_tu_id,so_luong,vat_tu:vat_tu_id(ma)'),
    sb.from('v_ton_gia_von').select('vat_tu_id,gia_von_bq,vat_tu:vat_tu_id(ma)'),  // rỗng nếu là thợ
    sb.from('nha_cung_cap').select('id,ten,dien_thoai,dia_chi')
  ])
  const tenNhom = Object.fromEntries((nhom || []).map(x => [x.id, x.ten]))
  const tonMa = Object.fromEntries((ton || []).map(t => [t.vat_tu?.ma, t.so_luong]))
  const giaMa = Object.fromEntries((gv || []).map(g => [g.vat_tu?.ma, g.gia_von_bq]))
  KHO = (vt || []).map(v => ({
    ma: v.ma, ten: v.ten, kho: v.loai, nhom: tenNhom[v.nhom_id] || '—',
    dvt: v.dvt, sl: v.so_moi_dvt, min: v.ton_toi_thieu || 0,
    ton: tonMa[v.ma] || 0, gia: giaMa[v.ma] || 0,
    vl: v.vat_lieu, day: v.do_day_mm, mv: v.ma_van_ncc, ht: v.hoan_thien, anh_ma: v.anh_ma
  }))
  KHO.forEach(x => { if (x.anh_ma) ANH[x.ma] = anhUrl(x.anh_ma) })
  NCC = (ncc || []).map(c => ({ id: c.id, ten: c.ten, dt: c.dien_thoai, dc: c.dia_chi, mh: '' }))
  if (!NCC.length) NCC = [{ id: null, ten: '(chưa có nhà cung cấp)', dt: '', dc: '', mh: '' }]
}

// ═══════════ RENDER (thích ứng từ bản nháp) ═══════════
function oAnh(x) {
  const a = ANH[x.ma]
  return a ? `<div class="anh co" onclick="event.stopPropagation();phongTo('${x.ma}')"><img src="${a}" alt="" onerror="this.parentNode.classList.remove('co');this.remove()"></div>`
    : `<div class="anh"><span class="trong">▣<small>ẢNH</small></span></div>`
}
function phongTo(ma) { const v = KHO.find(x => x.ma === ma); if (!ANH[ma]) return; $('#den-img').src = ANH[ma]; $('#den-ct').innerHTML = `<b>${v.ten}</b>${v.ma} · ${v.nhom} · tồn ${n(v.ton)} ${v.dvt}`; $('#den').classList.add('on') }
const dongDen = () => $('#den').classList.remove('on')
document.addEventListener('keydown', e => { if (e.key === 'Escape') { dongDen(); dongThe() } })

function chuyenMan(m) { $$('nav button').forEach(x => x.classList.toggle('on', x.dataset.m === m)); $$('.man').forEach(s => s.classList.toggle('on', s.id === 'm-' + m)); dongThe(); if (m === 'dat') veDat(); if (m === 'ncc') veNcc() }
$$('nav button').forEach(b => b.onclick = () => chuyenMan(b.dataset.m))

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
    const co = []; if (!laTho() && !x.gia) co.push('chưa có giá'); if (x.kho === 'pk' && !x.sl) co.push('thiếu quy cách')
    return `<tr class="click ${duoi ? 'duoi' : ''}" onclick="moThe('${x.ma}')">
      <td>${oAnh(x)}</td><td class="ma">${x.ma}</td>
      <td>${x.ten}${x.ht ? `<span class="ht ${x.ht.includes('Sơn') ? 'son' : 'dan'}">${x.ht.replace(/[🅰🅱]\s*/, '')}</span>` : ''}${co.length ? `<span class="thieu">${co.join(' · ')}</span>` : ''}</td>
      <td class="nhom-t">${x.nhom}</td>
      <td class="r"><div class="mt"><span class="v">${n(x.ton)}</span><span class="bar"><i style="width:${pct}%"></i></span></div></td>
      <td class="r num" style="color:#6E7681">${x.min ? n(x.min) : '—'}</td>
      <td style="color:#6E7681;font-size:13px">${x.dvt}</td>
      <td class="r num">${laTho() ? '·' : (x.gia ? n(x.gia) : '—')}</td></tr>`
  }).join('') || `<tr><td colspan="8" style="padding:22px;color:#6E7681">Không có mã nào khớp.</td></tr>`
  const kv = KHO.filter(x => locKho === '*' || x.kho === locKho)
  $('#k-ma').textContent = n(kv.length)
  $('#k-duoi').textContent = n(kv.filter(x => x.min > 0 && x.ton < x.min).length)
  $('#k-thieu').textContent = laTho() ? '·' : n(kv.filter(x => !x.gia).length)
  $('#k-tien').textContent = laTho() ? '·' : n(kv.reduce((s, x) => s + x.ton * x.gia, 0))
  $('#s-all').textContent = KHO.length; $('#s-pk').textContent = KHO.filter(x => x.kho === 'pk').length; $('#s-van').textContent = KHO.filter(x => x.kho === 'van').length
}

// ── thẻ kho (async: lấy giao dịch của mã từ Supabase) ──
let theMa = null
async function moThe(ma) {
  theMa = ma; const v = KHO.find(x => x.ma === ma)
  const { data: gd } = await sb.from('giao_dich').select('loai,so_luong,tao_luc,nguon,phieu:phieu_id(so_phieu)')
    .eq('vat_tu_id', (await maToId(ma))).order('tao_luc', { ascending: false }).limit(50)
  const lich = (gd || []).map(g => ({ vao: ['nhap', 'tra'].includes(g.loai), sl: Math.abs(g.so_luong), luc: new Date(g.tao_luc), so: g.phieu?.so_phieu || (g.nguon === 'quet_tem' ? 'QUÉT' : '—'), mo: g.loai }))
  let du = v.ton
  const dong = lich.map(g => { const h = `<div class="dong-tk ${g.vao ? 'n' : 'x'}"><span class="ngay">${gio(g.luc)}</span><span>${g.mo}<br><span style="color:#8A8F96;font-size:11.5px">${g.so}</span></span><span class="sl">${g.vao ? '+' : '−'}${n(g.sl)}</span><span class="du">còn ${n(du)}</span></div>`; du += g.vao ? -g.sl : g.sl; return h }).join('')
  $('#the').innerHTML = `<div class="the-dau">${oAnh(v)}<div><h3>${v.ten}</h3><div class="m">${v.ma} · ${v.nhom}</div>${v.kho === 'van' ? `<div class="m" style="margin-top:4px;color:#4A5159">${v.vl || ''}${v.day ? ' · dày ' + v.day + 'mm' : ''}${v.mv ? ' · vân ' + v.mv : ''}</div>` : ''}</div><button class="x" onclick="dongThe()">×</button></div>
    <div class="the-so"><div><span>Tồn hiện tại</span><b style="color:${v.ton < v.min ? 'var(--do)' : 'var(--ink)'}">${n(v.ton)}</b></div>
      <div><span>Tối thiểu</span><b style="color:#6E7681">${v.min ? n(v.min) : '—'}</b></div>
      ${laTho() ? '' : `<div><span>Giá bình quân</span><b>${v.gia ? n(v.gia) : '—'}</b></div><div><span>Giá trị tồn</span><b>${n(v.ton * v.gia)}</b></div>`}</div>
    <div class="the-than"><h4>Thẻ kho — lịch sử nhập xuất</h4>${dong || '<div class="rong">Chưa có giao dịch nào.</div>'}</div>`
  $('#the').classList.add('on')
}
const dongThe = () => { $('#the').classList.remove('on'); theMa = null }
const _idCache = {}
async function maToId(ma) { if (_idCache[ma]) return _idCache[ma]; const { data } = await sb.from('vat_tu').select('id').eq('ma', ma).single(); _idCache[ma] = data?.id; return data?.id }

// ── cần đặt hàng ──
function veDat() {
  $$('.muc button').forEach(b => b.onclick = () => { const l = +b.dataset.l; if (l > 1) { bao(l === 2 ? 'Mức 2 cần đơn đã chốt + BOM từ plugin — chưa nối.' : 'Mức 3 cần lịch sử xuất + thời gian giao hàng — chưa có.'); return } $$('.muc button').forEach(x => x.classList.remove('on')); b.classList.add('on'); veDat() })
  const ds = KHO.filter(x => x.min > 0 && x.ton < x.min)
  if (!ds.length) { $('#dat-ds').innerHTML = '<div class="rong">Không mã nào dưới mức tối thiểu.</div>'; return }
  const ct = ds.reduce((s, x) => s + Math.ceil(x.min - x.ton) * x.gia, 0)
  $('#dat-ds').innerHTML = `<div style="display:flex;align-items:baseline;gap:12px;margin:20px 0 8px"><h3 style="font-size:14px;margin:0">Chưa gán nhà cung cấp</h3><span style="font-size:12.5px;color:var(--muted)">${ds.length} mã${laTho() ? '' : ' · ước ' + n(ct) + ' đ'}</span></div>
    <table><thead><tr><th style="width:64px">Ảnh</th><th style="width:86px">Mã</th><th>Tên</th><th class="r" style="width:70px">Tồn</th><th class="r" style="width:78px">Tối thiểu</th><th class="r" style="width:96px">Cần mua</th>${laTho() ? '' : '<th class="r" style="width:120px">Ước tiền</th>'}</tr></thead>
    <tbody>${ds.map(x => { const c = Math.ceil(x.min - x.ton); return `<tr class="click" onclick="moThe('${x.ma}')"><td>${oAnh(x)}</td><td class="ma">${x.ma}</td><td>${x.ten}</td><td class="r num" style="color:var(--do);font-weight:700">${n(x.ton)}</td><td class="r num" style="color:#6E7681">${n(x.min)}</td><td class="r num"><b>${n(c)}</b> <span style="color:#6E7681;font-size:12px">${x.dvt}</span></td>${laTho() ? '' : `<td class="r num">${x.gia ? n(c * x.gia) : '<span style="color:var(--amber)">chưa có giá</span>'}</td>`}</tr>` }).join('')}</tbody></table>`
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

// ── quét mã (thợ) — ghi thật qua RPC ──
let qSl = 1, qMa = null
function quet() { qMa = KHO[Math.floor(Math.random() * KHO.length)]; qSl = 1; veQuet() }  // bản nháp: mã ngẫu nhiên (thay bằng camera sau)
function veQuet() {
  if (!qMa) { $('#q-kq').innerHTML = ''; return }
  const duoi = qMa.ton < qMa.min
  $('#q-kq').innerHTML = `<div class="kq">${oAnh(qMa)}<div class="t">${qMa.ten}</div><div class="m">${qMa.ma} · ${qMa.nhom}</div>
    <div class="ton-l"><span>Đang có trong kho</span><b style="color:${duoi ? 'var(--do)' : 'var(--ink)'}">${n(qMa.ton)}</b><span>${qMa.dvt}${duoi ? ' · dưới mức tối thiểu' : ''}</span></div>
    <div class="sl-h"><button onclick="qDelta(-1)">−</button><span class="v">${qSl}</span><button onclick="qDelta(1)">+</button></div>
    <div class="hai-nut"><button class="b-ra" onclick="qXong('lay')">Lấy ra</button><button class="b-ve" onclick="qXong('tra')">Trả về</button></div></div>`
}
function qDelta(d) { qSl = Math.max(1, qSl + d); veQuet() }
async function qXong(loai) {
  const v = qMa, s = qSl; if (!v) return
  const { error } = await sb.rpc('quet_giao_dich', { p_vat_tu_ma: v.ma, p_loai: loai, p_so_luong: s })
  if (error) { bao('Không ghi được: ' + error.message); return }
  v.ton += (loai === 'tra' ? s : -s); qMa = null; veBang()
  $('#q-kq').innerHTML = `<div class="kq" style="border-color:#BFDACB;background:#F3F9F5"><div class="t">Đã ghi</div><div class="m" style="margin-top:6px">${loai === 'lay' ? 'Lấy ra' : 'Trả về'} ${s} · ${v.ten}</div><div style="margin-top:10px;font-size:13px;color:#5A6169">Còn ${n(v.ton)} ${v.dvt}. Quét tem tiếp theo.</div></div>`
  setTimeout(() => { if (!qMa) $('#q-kq').innerHTML = '' }, 2800)
}

// ── phiếu nhập/xuất (nháp → ghi sổ) ──
const P = { nhap: null, xuat: null }
function tien(el) { const v = el.value.replace(/\D/g, ''); el.value = v ? Number(v).toLocaleString('vi-VN') : '' }
const soTien = el => Number(String(el.value).replace(/\D/g, '')) || 0
function moiPhieu(loai) { SO[loai]++; P[loai] = { loai, so: (loai === 'nhap' ? 'NK' : 'XK') + '-2026-' + String(SO[loai]).padStart(4, '0'), luc: new Date(), ncc: NCC[0]?.id, ly: 'Sản xuất', ghi: '', tt: 'nhap', dong: [] }; themDong(loai) }
function themDong(loai) { P[loai].dong.push({ ma: KHO[0]?.ma, sl: 0, gia: KHO[0]?.gia || 0 }); vePhieu(loai) }
function xoaDong(loai, i) { P[loai].dong.splice(i, 1); if (!P[loai].dong.length) themDong(loai); vePhieu(loai) }
function datDong(loai, i, truong, el) { const d = P[loai].dong[i]; if (truong === 'ma') { d.ma = el.value; const v = KHO.find(x => x.ma === el.value); if (loai === 'nhap') d.gia = v.gia } else if (truong === 'gia') { tien(el); d.gia = soTien(el) } else d[truong] = Number(el.value) || 0; vePhieu(loai) }
function optVt(ma) { const g = {}; KHO.forEach(x => (g[x.nhom] = g[x.nhom] || []).push(x)); const ten = Object.keys(g).sort((a, b) => { const av = a.startsWith('Ván') || a.startsWith('GỖ'), bv = b.startsWith('Ván') || b.startsWith('GỖ'); if (av !== bv) return av ? -1 : 1; return g[b].length - g[a].length }); return ten.map(t => `<optgroup label="${t} (${g[t].length})">` + g[t].map(x => `<option value="${x.ma}"${x.ma === ma ? ' selected' : ''}>${x.ma} — ${x.ten}</option>`).join('') + '</optgroup>').join('') }
function vePhieu(loai) {
  const p = P[loai]; if (!p) { $('#ph-' + loai).innerHTML = ''; return }
  const khoa = p.tt === 'so', ro = khoa ? 'disabled' : ''
  const tongTien = p.dong.reduce((s, d) => s + d.sl * (d.gia || 0), 0), tongSl = p.dong.reduce((s, d) => s + d.sl, 0)
  const dauNhap = `<div><label>Nhà cung cấp</label><select id="p-ncc" ${ro} onchange="P.nhap.ncc=this.value">${NCC.map(c => `<option value="${c.id}"${c.id === p.ncc ? ' selected' : ''}>${c.ten}</option>`).join('')}</select></div>`
  const dauXuat = `<div><label>Lý do xuất</label><select ${ro} onchange="P.xuat.ly=this.value">${['Sản xuất', 'Lắp đặt tại nhà khách', 'Hỏng / mất', 'Trả nhà cung cấp'].map(l => `<option${l === p.ly ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`
  $('#ph-' + loai).innerHTML = `<div class="ph-dau"><span class="ph-so">${p.so}</span><span class="tt ${khoa ? 'so' : 'nhap-tt'}">${khoa ? 'ĐÃ GHI SỔ' : 'NHÁP'}</span><span style="font-size:13px;color:var(--muted)">Lập lúc ${gio(p.luc)}</span>
    <span class="cach">${khoa ? `<button class="n nho" onclick="moiPhieu('${loai}');vePhieu('${loai}')">Lập phiếu mới</button>` : `<button class="n" onclick="themDong('${loai}')">+ Thêm dòng</button><button class="n" onclick="luuNhap('${loai}')">Lưu nháp</button><button class="n chinh" onclick="ghiSo('${loai}')">Ghi sổ</button>`}</span></div>
    <div class="ph-than"><div class="hang"><div><label>Ngày chứng từ</label><input class="ip" type="date" ${ro} value="${p.luc.toISOString().slice(0, 10)}" onchange="P['${loai}'].luc=new Date(this.value);vePhieu('${loai}')"></div>${loai === 'nhap' ? dauNhap : dauXuat}<div><label>Ghi chú</label><input class="ip" ${ro} value="${p.ghi}" placeholder="Số hoá đơn, người giao…" oninput="P['${loai}'].ghi=this.value"></div></div>
    <table><thead><tr><th style="width:30px">#</th><th>Vật tư</th><th class="r" style="width:110px">Số lượng</th><th style="width:56px">ĐVT</th>${loai === 'nhap' ? '<th class="r" style="width:130px">Đơn giá (đ)</th>' : '<th class="r" style="width:100px">Tồn sau</th>'}<th class="r" style="width:130px">${loai === 'nhap' ? 'Thành tiền' : 'Giá trị'}</th><th style="width:34px"></th></tr></thead><tbody>
    ${p.dong.map((d, i) => { const v = KHO.find(x => x.ma === d.ma) || { ton: 0, dvt: '', min: 0, gia: 0 }; const sau = v.ton - (loai === 'xuat' ? d.sl : -d.sl); return `<tr><td style="color:#8A8F96;font-size:12.5px">${i + 1}</td><td>${khoa ? `<span style="font-size:13.5px">${v.ma || d.ma} — ${v.ten || ''}</span>` : `<select onchange="datDong('${loai}',${i},'ma',this)">${optVt(d.ma)}</select>`}</td><td class="r"><input class="ip num r" type="number" ${ro} value="${d.sl}" oninput="datDong('${loai}',${i},'sl',this)"></td><td style="color:#6E7681;font-size:13px">${v.dvt}</td>${loai === 'nhap' ? `<td class="r"><input class="ip num r" ${ro} value="${n(d.gia)}" oninput="datDong('${loai}',${i},'gia',this)"></td>` : `<td class="r num" style="color:${sau < 0 ? 'var(--do)' : sau < v.min ? 'var(--amber)' : '#6E7681'}">${n(sau)}</td>`}<td class="r num">${n(d.sl * (loai === 'nhap' ? d.gia : v.gia))}</td><td>${khoa ? '' : `<button class="xoa" onclick="xoaDong('${loai}',${i})">×</button>`}</td></tr>` }).join('')}</tbody></table></div>
    <div class="tong-ph"><div><span>Số dòng</span><b>${p.dong.length}</b></div><div><span>Tổng số lượng</span><b>${n(tongSl)}</b></div><div><span>Tổng tiền</span><b style="color:var(--do)">${n(tongTien)} đ</b></div></div>`
}
function luuNhap(loai) { bao(`Nháp ${P[loai].so} — mới nằm ở trình duyệt. Bấm Ghi sổ để lưu vào kho.`) }
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
  if (!laTho()) { veNcc(); moiPhieu('nhap'); vePhieu('nhap'); moiPhieu('xuat'); vePhieu('xuat') }
}

// phơi hàm cho onclick trong HTML sinh động
Object.assign(window, { moThe, dongThe, phongTo, dongDen, quet, veQuet, qXong, qDelta, themNcc, moiPhieu, themDong, xoaDong, datDong, vePhieu, luuNhap, ghiSo, P, tien, bao })
