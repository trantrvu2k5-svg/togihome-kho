// TRANG BỌC app lên đơn: nạp Supabase + đăng nhập + CẤP window.storage (nối Supabase) RỒI MỚI nạp mã file sale.
//   Thứ tự sống còn: window.storage được gán TRƯỚC khi mã file sale chạy -> file dùng của ta (dòng 48 `if(!window.storage)`).
//   CẤM lùi localStorage. Lỗi mạng/quyền -> hiện banner đỏ, KHÔNG nuốt.
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const sb = createClient(URL, ANON, { db: { schema: 'kho' }, auth: { persistSession: true } })
window.__sb = sb

// ── hiện lỗi lưu (VIỆC 2: không nuốt) ──
function bao_loi(msg) {
  const el = document.getElementById('loi-luu')
  if (el) { el.textContent = '⚠ ' + msg; el.style.display = 'block' }
}
function xoa_loi() { const el = document.getElementById('loi-luu'); if (el) el.style.display = 'none' }

// ── VAI TRÒ (kho 7) -> QUYỀN (file 14). Chỉ để ẩn/hiện UI; chặn thật ở RLS + trigger. ──
const ALL = ['len_don','sua_don_all','thiet_ke','xuong_lam','xuong_dieu','dieu_van','giao_thu','huy_don','xem_tien','xem_ads','khai_ads','nhap_nh','bao_cao','xuat_dl','khai_bao']
const Q = {
  ceo: ALL,
  kho: ALL,                                                    // kho = admin kho, RLS cho full đơn hàng
  sale: ['len_don','sua_don_all','xem_tien','giao_thu','huy_don','khai_bao','bao_cao'],
  thiet_ke: ['thiet_ke'],
  xuong: ['xuong_lam','xuong_dieu','dieu_van','giao_thu','huy_don','bao_cao'],
  tho: ['xuong_lam'],
  ke_toan: ['giao_thu','xem_tien','xuat_dl','nhap_nh','bao_cao'],
}
const qMap = vt => Object.fromEntries((Q[vt] || []).map(c => [c, true]))

// ── ÁNH XẠ TRẠNG THÁI: file (9) <-> don_hang (12) ──
const TT2DB = { moi:'moi_len_don', tk:'dang_thiet_ke', co_file:'xong_file', da_cat:'da_cat',
  dang_lam:'dang_lam', xong_sx:'xong_sx', da_giao:'da_giao', tam_ngung:'tam_ngung', huy:'huy' }
const DB2TT = Object.fromEntries(Object.entries(TT2DB).map(([a, b]) => [b, a]))
const toTT = db => DB2TT[db] || 'moi'
const toDB = tt => TT2DB[tt] || 'moi_len_don'

const nz = v => (v === undefined || v === '' ? null : v)
// dong: app (ban_le/combo) <-> don_hang CHECK (le/combo/du_an)
const DONG_W = { ban_le: 'le', combo: 'combo', du_an: 'du_an', le: 'le' }
const DONG_R = { le: 'ban_le', combo: 'combo', du_an: 'du_an' }

// ── ÁNH XẠ ĐƠN: app don <-> don_hang ──
function donToRow(d, khMap) {
  const kh = khMap[d.khachId] || {}
  return {
    ma_don: d.ma, ngay_chot: nz(d.ngay), thuong_hieu: nz(d.brand),
    sdt_khach: nz(kh.sdt), ten_khach: nz(kh.ten), tinh_khach: nz(kh.tinh), dia_chi_khach: nz(d.diaChi || kh.diaChi),
    dong: DONG_W[d.dong] || nz(d.dong), loai: nz(d.loai), chiet_khau: d.giam ?? null,
    trang_thai: toDB(d.tt), ly_do_huy: nz(d.lyDo),
    tk_coc: nz(d.tkCoc), tien_coc: d.coc ?? null, so_tien_thuc_thu: d.daTT ?? null,
    lap_ai: nz(d.lapAi), file_tk: nz(d.fileTK), gio_thiet_ke: d.gioTK ?? null, nguoi_tk: nz(d.nguoiTK),
    don_vi_van_chuyen: nz(d.vanChuyen), khoi_luong_kg: d.kg ?? null, dia_ban: nz(d.diaBan),
    ship_thuc_tra: d.ship ?? null, lap_thuc_tra: d.lap ?? null,
    ngay_di_hang: nz(d.ngayDiHang), ngay_giao: nz(d.ngayGiao), ngay_du_kien: nz(d.ngayDuKien),
    lo: nz(d.lo), ghi_chu: nz(d.ghiChu), link: nz(d.link),
    kgs: Array.isArray(d.kgs) ? d.kgs : null, hoa_don: d.hd || null,
    nguoi_tao: null,   // saleId app không phải uuid nguoi_dung -> để null (nguoi_tao đặt sau ở tầng UI)
  }
}
function rowToDon(r) {
  return {
    id: r.ma_don, ma: r.ma_don, ngay: r.ngay_chot || '', brand: r.thuong_hieu || '',
    khachId: r.khach_sdt || r.sdt_khach || '', diaChi: r.dia_chi_khach || '',
    dong: DONG_R[r.dong] || r.dong || 'ban_le', loai: r.loai || '', giam: Number(r.chiet_khau) || 0,
    tt: toTT(r.trang_thai), lyDo: r.ly_do_huy || '',
    tkCoc: r.tk_coc || '', coc: Number(r.tien_coc) || 0, daTT: Number(r.so_tien_thuc_thu) || 0,
    lapAi: r.lap_ai || '', fileTK: r.file_tk || '', gioTK: Number(r.gio_thiet_ke) || 0, nguoiTK: r.nguoi_tk || '',
    vanChuyen: r.don_vi_van_chuyen || '', kg: Number(r.khoi_luong_kg) || 0, diaBan: r.dia_ban || '',
    ship: Number(r.ship_thuc_tra) || 0, lap: Number(r.lap_thuc_tra) || 0,
    ngayDiHang: r.ngay_di_hang || '', ngayGiao: r.ngay_giao || '', ngayDuKien: r.ngay_du_kien || '',
    lo: r.lo || '', ghiChu: r.ghi_chu || '', link: r.link || '',
    kgs: r.kgs || [], hd: r.hoa_don || null, saleId: '',
  }
}

// Bộ nhớ trong cho khoá CHƯA CÓ BẢNG + cache ánh xạ appId->ma của đơn.
const mem = {}
let donKeyMap = {}      // app don.id -> ma_don (để giải món/nhật ký)
const KEYLESS = new Set(['tho','lines','kgs','people','acc','cards','conn','bank','dsvc','cfg','users_extra','session'])

// ── resolve ma_don + id(uuid) ──
async function donIdCuaMa(ma) {
  const { data, error } = await sb.from('don_hang').select('id').eq('ma_don', ma).maybeSingle()
  if (error) throw error
  return data ? data.id : null
}
function maCuaAppId(appId) { return donKeyMap[appId] || appId }   // sau reload appId=ma nên fallback chính nó

// ══════════ window.storage — NỐI SUPABASE (get/set giữ nguyên chữ ký) ══════════
async function _get(k) {
  if (k === 'c2:users') {
    const { data, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong')
    if (error) throw error
    return data.map(u => ({ id: u.id, ten: u.ho_ten, mau: u.vai_tro, on: u.dang_hoat_dong, q: qMap(u.vai_tro) }))
  }
  if (k === 'c2:brands') { const { data, error } = await sb.from('thuong_hieu').select('*').eq('ngung', false); if (error) throw error
    return data.map(b => ({ c: b.ma, n: b.ten, dom: b.domain || '', nguoiId: b.nguoi_ads || '' })) }
  if (k === 'c2:sp') { const { data, error } = await sb.from('san_pham_mau').select('ma,ten,kich_thuoc,vat_lieu,file_tk,to_hop,cnc').eq('ngung', false); if (error) throw error
    return data.map(s => ({ id: s.ma, ma: s.ma, ten: s.ten, kt: s.kich_thuoc || '', vl: s.vat_lieu || '', fileTK: s.file_tk || '', toHop: s.to_hop || 1, cnc: s.cnc || 0 })) }
  if (k === 'c2:mau') { const { data, error } = await sb.from('mau_sac').select('*').eq('ngung', false); if (error) throw error
    return data.map(m => ({ c: m.ma, n: m.ten, hex: m.hex || '#ccc' })) }
  if (k === 'c2:vc') { const { data, error } = await sb.from('don_vi_van_chuyen').select('ten').eq('ngung', false); if (error) throw error
    return data.map(v => v.ten) }
  if (k === 'c2:vl') { const { data, error } = await sb.from('vat_lieu_ban').select('*').eq('ngung', false); if (error) throw error
    return data.map(v => ({ c: v.ma, n: v.ten, tho: v.tho || '' })) }
  if (k === 'c2:khach') { const { data, error } = await sb.from('khach').select('*'); if (error) throw error
    return data.map(x => ({ id: x.sdt, sdt: x.sdt, ten: x.ten || '', tinh: x.tinh || '', diaChi: x.dia_chi || '', lanDau: x.ngay_mua_dau || '' })) }
  if (k === 'c2:don') { const { data, error } = await sb.from('don_hang').select('*'); if (error) throw error
    donKeyMap = Object.fromEntries(data.map(r => [r.ma_don, r.ma_don])); return data.map(rowToDon) }
  if (k === 'c2:ct') {
    const { data, error } = await sb.from('don_hang_mon').select('*, don_hang(ma_don)'); if (error) throw error
    return data.map(m => ({ id: m.id, donId: m.don_hang ? m.don_hang.ma_don : '', spId: m.sp_id || '', ten: m.ten || '',
      vl: m.vl || '', kt: m.kt || '', sl: Number(m.so_luong) || 1, gia: Number(m.gia) || 0, tho: m.tho || '',
      maMau: m.ma_mau || '', ct: m.chi_tiet || '', dungMoi: !!m.dung_moi, anh: m.anh || [] })) }
  if (k === 'c2:ls') {
    const { data, error } = await sb.from('don_hang_nhat_ky').select('*, don_hang(ma_don)').order('luc'); if (error) throw error
    return data.map(l => ({ id: l.id, donId: l.don_hang ? l.don_hang.ma_don : '', tu: l.tu ? toTT(l.tu) : '',
      den: toTT(l.den), nguoi: '', luc: l.luc, lyDo: l.ly_do || '' })) }
  if (KEYLESS.has(k.replace('c2:', ''))) { if (k in mem) return mem[k]; const e = new Error('khong co khoa'); e.__keyless = true; throw e }
  const e = new Error('khong co khoa'); throw e
}

async function _set(k, jsonStr) {
  const v = JSON.parse(jsonStr)
  if (k === 'c2:don') {
    donKeyMap = Object.fromEntries((v || []).map(d => [d.id, d.ma]))
    const { data: kd } = await sb.from('khach').select('*')
    const khMap = Object.fromEntries((kd || []).map(x => [x.sdt, { sdt: x.sdt, ten: x.ten, tinh: x.tinh, diaChi: x.dia_chi }]))
    // khMap theo id app: đơn app dùng khachId; nhưng khách app nằm ở c2:khach (id=sdt). Ghép qua mem nếu có.
    const khByAppId = mem['__khByAppId'] || {}
    const rows = (v || []).map(d => donToRow(d, { [d.khachId]: khByAppId[d.khachId] || khMap[d.khachId] || {} }))
    const { error } = await sb.from('don_hang').upsert(rows, { onConflict: 'ma_don' }); if (error) throw error
    const mas = (v || []).map(d => d.ma)
    if (mas.length) { await sb.from('don_hang').delete().not('ma_don', 'in', '(' + mas.map(m => JSON.stringify(m)).join(',') + ')') }
    else { await sb.from('don_hang').delete().neq('ma_don', '___none___') }
    return
  }
  if (k === 'c2:ct') {
    // resolve don_id theo ma; xoá món cũ của các đơn liên quan rồi chèn lại (whole-array write).
    const byMa = {}
    for (const m of (v || [])) { const ma = maCuaAppId(m.donId); (byMa[ma] = byMa[ma] || []).push(m) }
    for (const ma of Object.keys(byMa)) {
      const did = await donIdCuaMa(ma); if (!did) continue
      await sb.from('don_hang_mon').delete().eq('don_id', did)
      const rows = byMa[ma].map(m => ({ don_id: did, sp_id: nz(m.spId), ten: nz(m.ten), vl: nz(m.vl), kt: nz(m.kt),
        so_luong: m.sl ?? 1, gia: m.gia ?? null, tho: nz(m.tho), ma_mau: nz(m.maMau), chi_tiet: nz(m.ct), dung_moi: !!m.dungMoi, anh: m.anh || [] }))
      if (rows.length) { const { error } = await sb.from('don_hang_mon').insert(rows); if (error) throw error }
    }
    return
  }
  if (k === 'c2:ls') {
    // append-only: chỉ chèn dòng CHƯA có (theo don_id, den, luc).
    for (const l of (v || [])) {
      const did = await donIdCuaMa(maCuaAppId(l.donId)); if (!did) continue
      const den = toDB(l.den)
      const { data: co } = await sb.from('don_hang_nhat_ky').select('id').eq('don_id', did).eq('den', den).eq('luc', l.luc).limit(1)
      if (co && co.length) continue
      const { error } = await sb.from('don_hang_nhat_ky').insert({ don_id: did, tu: l.tu ? toDB(l.tu) : null, den,
        nguoi_id: (window.__saleUser && window.__saleUser.id) || null, luc: l.luc || undefined, ly_do: nz(l.lyDo) }); if (error) throw error
    }
    return
  }
  if (k === 'c2:khach') {
    const rows = (v || []).map(x => ({ sdt: x.sdt, ten: nz(x.ten), tinh: nz(x.tinh), dia_chi: nz(x.diaChi), ngay_mua_dau: nz(x.lanDau) }))
    mem['__khByAppId'] = Object.fromEntries((v || []).map(x => [x.id, { sdt: x.sdt, ten: x.ten, tinh: x.tinh, diaChi: x.diaChi }]))
    if (rows.length) { const { error } = await sb.from('khach').upsert(rows, { onConflict: 'sdt' }); if (error) throw error }
    return
  }
  const KMAP = { 'c2:brands': ['thuong_hieu', b => ({ ma: b.c, ten: b.n, domain: nz(b.dom), nguoi_ads: nz(b.nguoiId) }), 'ma'],
    'c2:sp': ['san_pham_mau', s => ({ ma: s.ma, ten: s.ten, kich_thuoc: nz(s.kt), vat_lieu: nz(s.vl), file_tk: nz(s.fileTK), to_hop: s.toHop ?? null, cnc: s.cnc ?? null }), 'ma'],
    'c2:mau': ['mau_sac', m => ({ ma: m.c, ten: m.n, hex: nz(m.hex) }), 'ma'],
    'c2:vl': ['vat_lieu_ban', x => ({ ma: x.c, ten: x.n, tho: nz(x.tho) }), 'ma'],
    'c2:vc': ['don_vi_van_chuyen', t => ({ ten: t }), 'ten'] }
  if (KMAP[k]) { const [tbl, fn, onc] = KMAP[k]; const rows = (v || []).map(fn)
    if (rows.length) { const { error } = await sb.from(tbl).upsert(rows, { onConflict: onc }); if (error) throw error } return }
  // khoá chưa có bảng -> bộ nhớ trong (VIỆC 2)
  mem[k] = jsonStr
}

// TUẦN TỰ HOÁ set: app gọi set("c2:don") rồi set("c2:ct")/set("c2:ls") KHÔNG await -> phải chạy đúng thứ tự
//   (nếu không, món/nhật ký chèn khi đơn chưa có trong DB -> mất). Mỗi set nối vào chuỗi trước.
let _chain = Promise.resolve()
window.storage = {
  get(k) { return new Promise((res, rej) => {
    _get(k).then(val => res({ key: k, value: JSON.stringify(val) }))
      .catch(e => { if (!e.__keyless) bao_loi('Không đọc được "' + k + '": ' + (e.message || e)); rej(e) }) }) },
  set(k, v) {
    const run = _chain.then(() => _set(k, v))
    _chain = run.catch(() => {})   // chuỗi không đứt khi 1 set lỗi
    return run.then(() => { xoa_loi(); return { key: k, value: v } })
      .catch(e => { bao_loi('CHƯA LƯU được "' + k + '": ' + (e.message || e) + ' — dữ liệu chưa xuống Supabase.'); throw e }) },
}

// ══════════ ĐĂNG NHẬP + nạp mã app (thứ tự: storage đã gán ở trên -> giờ mới nạp file sale) ══════════
async function napApp() {
  const html = await (await fetch('/togihome_sale.html')).text()
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])   // 2 script inline (không src)
  for (const code of scripts) { const s = document.createElement('script'); s.textContent = code; document.body.appendChild(s) }
}

async function laySauDangNhap(user) {
  const { data, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (error || !data) { manDangNhap('Tài khoản chưa được gán vai trò trong kho.nguoi_dung — báo CEO.'); await sb.auth.signOut(); return }
  window.__saleUser = { id: data.id, ten: data.ho_ten, vai_tro: data.vai_tro, on: data.dang_hoat_dong, q: qMap(data.vai_tro) }
  napApp()
}

function manDangNhap(err) {
  document.getElementById('root').innerHTML =
    '<div id="dn"><h1>Đăng nhập · Lên đơn</h1>' +
    '<input id="e" type="email" placeholder="Email" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Mật khẩu" autocomplete="current-password">' +
    '<div class="err" id="er">' + (err || '') + '</div>' +
    '<button id="b">Vào</button></div>'
  const go = async () => {
    document.getElementById('er').textContent = ''
    const { data, error } = await sb.auth.signInWithPassword({ email: document.getElementById('e').value.trim(), password: document.getElementById('p').value })
    if (error) { document.getElementById('er').textContent = 'Sai email hoặc mật khẩu.'; return }
    laySauDangNhap(data.user)
  }
  document.getElementById('b').onclick = go
  document.getElementById('p').onkeydown = e => { if (e.key === 'Enter') go() }
}

;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) laySauDangNhap(data.session.user)
  else manDangNhap('')
})()
