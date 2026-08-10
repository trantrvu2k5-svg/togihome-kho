// App XƯỞNG — nối DB thật (BƯỚC 4). Đăng nhập chỉ xuong/tho/ceo.
//   ĐỌC qua RPC curated (tho không đọc bảng): xuong_don_san_xuat · xuong_mon_cua_don · xuong_tem_cua_don.
//   GHI: tien_mon (①) · ghi_lan_in_tem (②) · phieu_dem_ngay (③) · loi_lam_lai (④).
//   KHÔNG hiện giá bán/giá vốn/tên khách. SVG tem lấy signed-url từ bucket 'tem-svg' (plugin đẩy).
import { createClient } from '@supabase/supabase-js'

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'kho' }, auth: { persistSession: true } })

const VAI_VAO = ['xuong', 'tho', 'ceo']            // chỉ 3 vai vào app xưởng
const TEN_VAI = { xuong: 'Xưởng', tho: 'Thợ', ceo: 'CEO' }
const BUOC = { cho_cat: 'Chờ cắt', da_cat: 'Đã cắt', dang_lam: 'Đang làm', xong_sx: 'Xong SX' }
const KE = { cho_cat: 'da_cat', da_cat: 'dang_lam', dang_lam: 'xong_sx' }   // bước KẾ (xong_sx = hết)
const DEM_TO = { pu: 'son_pu', lot: 'cha_lot', giuong_lap: 'giuong' }        // hoạt động → tổ
let USER = null, KHO_TEM = '70x40', TEM = { ma_don: null, pb: null, lan: 0, tam: [], tick: {} }
const $ = id => document.getElementById(id)

// ══════════ ĐĂNG NHẬP ══════════
function manDangNhap(err) {
  $('boot').style.display = 'none'; $('app').style.display = 'none'
  const g = $('cong'); g.style.display = ''
  g.innerHTML =
    '<div class="logo">🪚</div><h1>Togihome Xưởng</h1><div class="sub">Đăng nhập để vào việc</div>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<button id="b">Vào xưởng</button><div class="err" id="er">' + (err || '') + '</div>'
  const go = async () => {
    $('er').textContent = ''
    const { data, error } = await sb.auth.signInWithPassword({ email: $('e').value.trim(), password: $('p').value })
    if (error) { $('er').textContent = 'Sai email hoặc mật khẩu.'; return }
    laySauDangNhap(data.user)
  }
  $('b').onclick = go
  $('p').onkeydown = e => { if (e.key === 'Enter') go() }
}

async function laySauDangNhap(user) {
  const { data, error } = await sb.from('nguoi_dung')
    .select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (error || !data) { await sb.auth.signOut(); return manDangNhap('Tài khoản chưa gán vai trò — báo CEO.') }
  if (!data.dang_hoat_dong) { await sb.auth.signOut(); return manDangNhap('Tài khoản đang bị khoá — báo CEO.') }
  if (!VAI_VAO.includes(data.vai_tro)) { await sb.auth.signOut(); return manDangNhap('Vai "' + data.vai_tro + '" không vào được app xưởng.') }
  USER = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro }
  capApp()
}

// ══════════ VÀO APP ══════════
async function capApp() {
  $('cong').style.display = 'none'; $('boot').style.display = 'none'; $('app').style.display = ''
  $('hdTo').innerHTML = (USER.ten ? USER.ten + ' · ' : '') + '<b>' + (TEN_VAI[USER.vai_tro] || USER.vai_tro) + '</b> ' +
    '<button class="dangxuat" id="btOut">Thoát</button>'
  $('btOut').onclick = async () => { await sb.auth.signOut(); location.reload() }
  // nav
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => doiMan(b.dataset.man))
  // ② handlers
  $('chonDon').onchange = () => taiTem($('chonDon').value)
  $('tamHet').onclick = chonHet
  document.querySelectorAll('.khokho button').forEach(b => b.onclick = () => datKho(b.dataset.kho))
  $('btInBo').onclick = () => inTem('bo')
  $('btInChon').onclick = () => inTem('chon')
  // ③ ④
  $('btDem').onclick = luuDem
  $('btLoi').onclick = luuLoi
  await taiTo()          // tổ cho ④
  await taiDon()         // đơn cho ② + ④
  await taiViec()        // ①
}

function doiMan(m) {
  ['viec', 'tem', 'dem', 'loi'].forEach(k => {
    $('man-' + k).classList.toggle('on', k === m)
  })
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.man === m))
  window.scrollTo(0, 0)
}
function toast(t, loi) {
  const el = $('toast'); el.textContent = t; el.classList.toggle('loi', !!loi); el.classList.add('hien')
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hien'), 2400)
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ══════════ ① VIỆC ══════════
let DONS = []
async function taiDon() {
  const { data, error } = await sb.rpc('xuong_don_san_xuat')
  DONS = error ? [] : (data || [])
  // ② chọn đơn (ưu tiên đơn có tem)
  const coTem = DONS.filter(d => d.co_tem)
  $('chonDon').innerHTML = coTem.length
    ? coTem.map(d => `<option value="${esc(d.ma_don)}">${esc(d.ma_don)} · ${esc(BUOC[d.trang_thai] || d.trang_thai)}</option>`).join('')
    : '<option value="">(chưa đơn nào có tem)</option>'
  if (coTem.length) taiTem(coTem[0].ma_don)
  else { TEM = { ma_don: null, pb: null, lan: 0, tam: [], tick: {} }; $('temBanner').innerHTML = ''; $('dsTam').innerHTML = '<div class="trong">Chưa có đơn nào được đẩy tem.</div>'; capNhatChon() }
  // ④ đơn
  $('loiDon').innerHTML = DONS.length
    ? DONS.map(d => `<option value="${esc(d.ma_don)}">${esc(d.ma_don)}</option>`).join('')
    : '<option value="">(chưa có đơn)</option>'
  $('loiDon').onchange = () => taiMonLoi($('loiDon').value)
  if (DONS.length) taiMonLoi(DONS[0].ma_don)
}

async function taiViec() {
  const box = $('dsViec')
  if (!DONS.length) { box.innerHTML = '<div class="trong">Chưa có đơn nào đang sản xuất.</div>'; return }
  box.innerHTML = '<div class="trong">Đang tải…</div>'
  const parts = []
  for (const d of DONS) {
    const { data } = await sb.rpc('xuong_mon_cua_don', { p_ma_don: d.ma_don })
    for (const m of (data || [])) {
      const ke = KE[m.trang_thai]
      parts.push(
        `<div class="the">
          <div class="mon">${esc(m.ten || 'Món')} ${Number(m.so_luong) > 1 ? '×' + Number(m.so_luong) : ''}</div>
          <div class="phu">${esc(d.ma_don)}<span class="chip-to" style="color:#41506b;background:#F0F3F9">${esc(BUOC[m.trang_thai] || m.trang_thai)}</span></div>
          ${ke ? `<button class="nut nut-chinh" data-mon="${esc(m.id)}" data-ke="${ke}">✅ Xong bước "${esc(BUOC[m.trang_thai])}" → ${esc(BUOC[ke])}</button>`
               : `<button class="nut nut-phu" disabled>✓ Đã xong sản xuất</button>`}
        </div>`)
    }
  }
  box.innerHTML = parts.length ? parts.join('') : '<div class="trong">Các đơn chưa có món.</div>'
  box.querySelectorAll('button[data-mon]').forEach(b => b.onclick = () => xongBuoc(b.dataset.mon, b.dataset.ke))
}
async function xongBuoc(monId, ke) {
  const { data, error } = await sb.rpc('tien_mon', { p_mon_id: monId, p_trang_thai: ke })
  if (error) return toast('Không đẩy được bước: ' + error.message, true)
  toast('✓ Đã sang bước "' + (BUOC[ke] || ke) + '"')
  await taiDon(); await taiViec()
}

// ══════════ ② IN TEM ══════════
async function taiTem(maDon) {
  if (!maDon) return
  const { data, error } = await sb.rpc('xuong_tem_cua_don', { p_ma_don: maDon })
  if (error) { $('dsTam').innerHTML = '<div class="trong">Lỗi tải tem: ' + esc(error.message) + '</div>'; return }
  const rows = data || []
  TEM = { ma_don: maDon, pb: rows.length ? rows[0].phien_ban : null, lan: rows.length ? rows[0].lan_da_in : 0, tam: rows, tick: {} }
  const lanKe = (TEM.lan || 0) + 1
  const catLai = (TEM.lan || 0) >= 1
  $('temBanner').innerHTML = TEM.pb == null
    ? '<div class="banner banner-mo">Đơn này chưa được đẩy tem từ máy thiết kế.</div>'
    : (catLai
      ? `<div class="banner banner-do">🔁 CẮT LẠI — phiên bản ${TEM.pb}, đã in ${TEM.lan} lượt. In tiếp = lượt ${lanKe} (KHÔNG phải cắt đầu).</div>`
      : `<div class="banner banner-xanh">🟢 Phiên bản ${TEM.pb} · chưa in lần nào. In = lượt 1 (cắt đầu).</div>`)
  $('dsTam').innerHTML = rows.length
    ? rows.map((t, i) => `<div class="tam" data-i="${i}">
        <div class="ck">✓</div>
        <div class="ten">${esc(temTen(t))} <span class="kt">${fmt(t.dai)}×${fmt(t.rong)}×${fmt(t.day)}</span><div class="vt">${esc(t.vai_tro || '')}${t.kien ? ' · kiện ' + t.kien : ''}</div></div>
      </div>`).join('')
    : '<div class="trong">Phiên bản này không có tấm nào.</div>'
  $('dsTam').querySelectorAll('.tam').forEach(el => el.onclick = () => tick(+el.dataset.i))
  capNhatChon()
}
const temTen = t => (t.vai_tro || 'tam').replace(/_/g, ' ')
const fmt = n => { n = Number(n); return Number.isFinite(n) ? (n === Math.round(n) ? String(n) : n.toFixed(1)) : '?' }
function tick(i) { TEM.tick[i] = !TEM.tick[i]; $('dsTam').querySelector(`.tam[data-i="${i}"]`).classList.toggle('on', !!TEM.tick[i]); capNhatChon() }
function chonHet() {
  const het = TEM.tam.length && Object.keys(TEM.tick).filter(k => TEM.tick[k]).length === TEM.tam.length
  TEM.tam.forEach((_, i) => { TEM.tick[i] = !het; const el = $('dsTam').querySelector(`.tam[data-i="${i}"]`); if (el) el.classList.toggle('on', !het) })
  capNhatChon()
}
function capNhatChon() {
  const n = Object.keys(TEM.tick).filter(k => TEM.tick[k]).length, tot = TEM.tam.length
  $('soChon').textContent = n ? '· ' + n + '/' + tot + ' tấm' : ''
  $('ckHet').textContent = tot && n === tot ? '✓' : (n ? '–' : '▪')
  const co = TEM.pb != null && tot > 0
  $('btInBo').disabled = !co; $('btInChon').disabled = !co
}
function datKho(k) { KHO_TEM = k; $('kho7040').classList.toggle('on', k === '70x40'); $('kho5030').classList.toggle('on', k === '50x30') }

async function inTem(che) {
  if (TEM.pb == null || !TEM.tam.length) return
  const chon = che === 'bo' ? TEM.tam : TEM.tam.filter((_, i) => TEM.tick[i])
  if (!chon.length) return toast('Chưa tick tấm nào', true)
  const maTam = chon.map(t => t.ma_tam)
  const { data, error } = await sb.rpc('ghi_lan_in_tem', { p_ma_don: TEM.ma_don, p_phien_ban: TEM.pb, p_ma_tam: maTam })
  if (error) return toast('Ghi lượt in lỗi: ' + error.message, true)
  const moiTrang = KHO_TEM === '70x40' ? 12 : 24, trang = Math.ceil(maTam.length / moiTrang)
  toast((data.cat_lai ? '⚠ CẮT LẠI · ' : '✓ ') + 'Lượt in ' + data.lan_thu + ' · ' + maTam.length + ' tem · ' + trang + ' trang')
  await moInTem(chon)
  taiTem(TEM.ma_don)   // cập nhật lại lan_da_in
}
// Mở cửa sổ IN: lấy signed-url SVG từng tem trong bucket rồi xếp lưới A4, window.print().
async function moInTem(chon) {
  const paths = chon.map(t => t.duong_dan_svg).filter(Boolean)
  if (!paths.length) return toast('Đã ghi lượt in. (Chưa có SVG tem — máy thiết kế chưa đẩy.)')
  const { data, error } = await sb.storage.from('tem-svg').createSignedUrls(paths, 120)
  const urls = (error ? [] : data).filter(x => x.signedUrl).map(x => x.signedUrl)
  if (!urls.length) return toast('Đã ghi lượt in. SVG tem chưa có trên hệ (máy thiết kế chưa đẩy).')
  const w = window.open('', '_blank')
  if (!w) return toast('Đã ghi lượt in. Trình duyệt chặn cửa sổ in — bật popup để in tem.')
  const [tw, th] = KHO_TEM === '70x40' ? [70, 40] : [50, 30]
  w.document.write(`<!doctype html><meta charset=utf-8><title>Tem ${esc(TEM.ma_don)}</title>
    <style>@page{size:A4;margin:8mm}body{margin:0}.g{display:flex;flex-wrap:wrap;gap:2mm}
    .t{width:${tw}mm;height:${th}mm;border:.3mm solid #000;overflow:hidden}.t img{width:100%;height:100%}</style>
    <div class="g">${urls.map(u => `<div class="t"><img src="${u}"></div>`).join('')}</div>
    <script>let n=${urls.length},d=0;document.querySelectorAll('img').forEach(i=>i.onload=i.onerror=()=>{if(++d>=n)setTimeout(()=>print(),250)})<\/script>`)
  w.document.close()
}

// ══════════ ③ ĐẾM ══════════
async function luuDem() {
  const rows = [
    { hoat_dong: 'pu', so_luong: +$('demPu').value || 0 },
    { hoat_dong: 'lot', so_luong: +$('demLot').value || 0 },
    { hoat_dong: 'giuong_lap', so_luong: +$('demGiuong').value || 0 },
  ].filter(r => r.so_luong > 0)
  if (!rows.length) return toast('Chưa nhập số nào', true)
  const ma_ns = $('demAi').value === 'toi' ? USER.id : null
  const recs = rows.map(r => ({ ma_to: DEM_TO[r.hoat_dong], hoat_dong: r.hoat_dong, so_luong: r.so_luong, ma_ns }))
  const { error } = await sb.from('phieu_dem_ngay').insert(recs)
  if (error) return toast('Lưu đếm lỗi: ' + error.message, true)
  toast('✔️ Đã lưu ' + recs.length + ' dòng đếm' + (ma_ns ? ' (riêng bạn)' : ' (cả tổ)'))
  $('demPu').value = ''; $('demLot').value = ''; $('demGiuong').value = ''
}

// ══════════ ④ GHI LỖI ══════════
async function taiTo() {
  const { data } = await sb.from('to_san_xuat').select('ma_to,ten').order('ma_to')
  $('loiTo').innerHTML = (data || []).map(t => `<option value="${esc(t.ma_to)}">${esc(t.ten)}</option>`).join('')
}
let MON_LOI = []
async function taiMonLoi(maDon) {
  if (!maDon) { MON_LOI = []; $('loiMon').innerHTML = '<option value="">(chưa có đơn)</option>'; return }
  const { data } = await sb.rpc('xuong_mon_cua_don', { p_ma_don: maDon })
  MON_LOI = data || []
  $('loiMon').innerHTML = MON_LOI.length
    ? MON_LOI.map(m => `<option value="${esc(m.id)}">${esc(m.ten || 'Món')}</option>`).join('')
    : '<option value="">(đơn chưa có món)</option>'
}
async function luuLoi() {
  const ma_don = $('loiDon').value, mon_id = $('loiMon').value || null
  if (!ma_don) return toast('Chưa chọn đơn', true)
  const rec = { ma_to: $('loiTo').value || null, ma_don, mon_id, loai_loi: $('loiLoai').value,
    so_luong: +$('loiSo').value || 1, ma_ns_ghi: USER.id }
  const { error } = await sb.from('loi_lam_lai').insert(rec)
  if (error) return toast('Ghi lỗi thất bại: ' + error.message, true)
  toast('⚠️ Đã ghi lỗi: ' + rec.loai_loi + ' ×' + rec.so_luong)
}

// ══════════ BOOT ══════════
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) laySauDangNhap(data.session.user)
  else manDangNhap('')
})()
