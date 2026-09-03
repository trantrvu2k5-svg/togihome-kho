// TRANG BỌC app lên đơn: nạp Supabase + đăng nhập + CẤP window.storage (nối Supabase) RỒI MỚI nạp mã file sale.
//   Thứ tự sống còn: window.storage được gán TRƯỚC khi mã file sale chạy -> file dùng của ta (dòng 48 `if(!window.storage)`).
//   CẤM lùi localStorage. Lỗi mạng/quyền -> hiện banner đỏ, KHÔNG nuốt.
import { createClient } from '@supabase/supabase-js'
import SALE_HTML from '../public/togihome_sale.html?raw'   // WP-04: mã app Sale inline vào bundle (hash) thay vì fetch runtime

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
  tk_ban_hang: ['len_don','sua_don_all','xem_tien','giao_thu','huy_don','khai_bao','bao_cao'],  // thiết kế bán hàng — quyền GIỐNG sale (giá vốn ẩn bằng RLS)
  thiet_ke: ['thiet_ke'],
  xuong: ['xuong_lam','xuong_dieu','dieu_van','giao_thu','huy_don','bao_cao'],
  tho: ['xuong_lam'],
  ke_toan: ['giao_thu','xem_tien','xuat_dl','nhap_nh','bao_cao'],
}
const qMap = vt => Object.fromEntries((Q[vt] || []).map(c => [c, true]))

// ── ÁNH XẠ TRẠNG THÁI: file (9) <-> don_hang (12) ──
// Ánh xạ app-tt <-> DB trang_thai. PHẢI phủ ĐỦ 15 trạng thái DB và HAI CHIỀU KHỚP (bijective) —
//   thiếu máng thì đơn cho_cat/cho_giao/nhan_thiet_ke bị đọc 'moi' rồi GHI ĐÈ DB về moi_len_don.
//   cho_cat/cho_giao/nhan_thiet_ke dùng CHÍNH mã DB làm app-tt (nhãn hiển thị ở togihome_sale.html TT_KHAC).
const TT2DB = { bao_gia:'bao_gia', bao_gia_thua:'bao_gia_thua', bao_gia_treo:'bao_gia_treo',
  moi:'moi_len_don', nhan_thiet_ke:'nhan_thiet_ke', tk:'dang_thiet_ke', co_file:'xong_file',
  cho_cat:'cho_cat', da_cat:'da_cat', dang_lam:'dang_lam', xong_sx:'xong_sx', cho_giao:'cho_giao',
  da_giao:'da_giao', tam_ngung:'tam_ngung', huy:'huy' }
const DB2TT = Object.fromEntries(Object.entries(TT2DB).map(([a, b]) => [b, a]))
// FAIL-ĐÓNG: trạng thái lạ -> BÁO console + trả NGUYÊN GIÁ TRỊ (không âm thầm coerce về moi/moi_len_don,
//   tránh ghi đè phá dữ liệu). Với 15 máng đầy đủ, nhánh cảnh báo gần như không chạy.
const toTT = db => { if (db in DB2TT) return DB2TT[db]; console.error('[sale] toTT: trạng thái DB KHÔNG có máng ánh xạ: ' + db); return db }
const toDB = tt => { if (tt in TT2DB) return TT2DB[tt]; console.error('[sale] toDB: app-tt KHÔNG có máng ánh xạ: ' + tt); return tt }

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
    gia_cong_thuc: d.giaCongThuc ?? null, gia_chot: d.giaChot ?? null,
    ma_ns_duyet_giam: nz(d.nsDuyet), ly_do_giam: nz(d.lyDoGiam),
    trang_thai: toDB(d.tt), ly_do_huy: nz(d.lyDo),
    ly_do_thua: nz(d.lyDoThua), ghi_chu_thua: nz(d.ghiChuThua),
    tk_coc: nz(d.tkCoc), tien_coc: d.coc ?? null, so_tien_thuc_thu: d.daTT ?? null,
    lap_ai: nz(d.lapAi), file_tk: nz(d.fileTK), gio_thiet_ke: d.gioTK ?? null, nguoi_tk: nz(d.nguoiTK),
    don_vi_van_chuyen: nz(d.vanChuyen), khoi_luong_kg: d.kg ?? null, dia_ban: nz(d.diaBan),
    ship_thuc_tra: d.ship ?? null, lap_thuc_tra: d.lap ?? null,
    ngay_di_hang: nz(d.ngayDiHang), ngay_giao: nz(d.ngayGiao), ngay_du_kien: nz(d.ngayDuKien),
    ngay_hen_khach: nz(d.ngayHenKhach),   // sale hứa giao KHÁCH (khác "dự kiến sản xuất xong"); ban_dau tự bắt ở DB
    lo: nz(d.lo), ghi_chu: nz(d.ghiChu), link: nz(d.link),
    // KHÁCH MUỐN GÌ + AI DỰNG (form báo giá v5, db/092). ghi_chu=yêu cầu riêng, link=link tham khảo (dùng lại).
    phong_cach: nz(d.phongCach), ngan_sach_trieu: (d.nganSach === '' || d.nganSach == null) ? null : Number(d.nganSach),
    tu_dung: !!d.tuDung, nguon_khach: nz(d.nguonKhach),   // L-67: khách biết mình qua đâu (không bắt buộc)
    kgs: Array.isArray(d.kgs) ? d.kgs : null, hoa_don: d.hd || null,
    nguoi_tao: null,   // saleId app không phải uuid nguoi_dung -> để null (nguoi_tao đặt sau ở tầng UI)
  }
}
function rowToDon(r) {
  return {
    id: r.ma_don, ma: r.ma_don, ngay: r.ngay_chot || '', brand: r.thuong_hieu || '',
    khachId: r.sdt_khach || '', diaChi: r.dia_chi_khach || '',
    dong: DONG_R[r.dong] || r.dong || 'ban_le', loai: r.loai || '', giam: Number(r.chiet_khau) || 0,
    giaCongThuc: r.gia_cong_thuc != null ? Number(r.gia_cong_thuc) : null, giaChot: r.gia_chot != null ? Number(r.gia_chot) : null,
    nsDuyet: r.ma_ns_duyet_giam || '', lyDoGiam: r.ly_do_giam || '',
    tt: toTT(r.trang_thai), lyDo: r.ly_do_huy || '',
    lyDoThua: r.ly_do_thua || '', ghiChuThua: r.ghi_chu_thua || '',
    ngayTaoBG: r.ngay_tao_bao_gia || '', ngayKetThucBG: r.ngay_ket_thuc_bao_gia || '',
    tkCoc: r.tk_coc || '', coc: Number(r.tien_coc) || 0, daTT: Number(r.so_tien_thuc_thu) || 0,
    lapAi: r.lap_ai || '', fileTK: r.file_tk || '', gioTK: Number(r.gio_thiet_ke) || 0, nguoiTK: r.nguoi_tk || '',
    vanChuyen: r.don_vi_van_chuyen || '', kg: Number(r.khoi_luong_kg) || 0, diaBan: r.dia_ban || '',
    ship: Number(r.ship_thuc_tra) || 0, lap: Number(r.lap_thuc_tra) || 0,
    ngayDiHang: r.ngay_di_hang || '', ngayGiao: r.ngay_giao || '', ngayDuKien: r.ngay_du_kien || '', ngayHenKhach: r.ngay_hen_khach || '', ngayHenKhachBanDau: r.ngay_hen_khach_ban_dau || '', laDemo: r.la_demo || false,
    lo: r.lo || '', ghiChu: r.ghi_chu || '', link: r.link || '',
    phongCach: r.phong_cach || '', nganSach: r.ngan_sach_trieu != null ? Number(r.ngan_sach_trieu) : '', tuDung: !!r.tu_dung, nguonKhach: r.nguon_khach || '',
    kgs: r.kgs || [], hd: r.hoa_don || null, saleId: '', leadId: r.lead_id || '',   // [WP-70 L-04] hội thoại nguồn đã gắn
    khachMoi: r.khach_moi == null ? null : !!r.khach_moi,   // L-45: khách MỚI/CŨ (DB set lúc da_giao); null = chưa xác định
    salePhuTrach: r.sale_phu_trach || '',   // L-71: chủ đơn (uuid); tên hiện từ bg.sale_ten hoặc roster dsSale
  }
}

// Bộ nhớ trong cho khoá CHƯA CÓ BẢNG + cache ánh xạ appId->ma của đơn.
const mem = {}
let donKeyMap = {}      // app don.id -> ma_don (để giải món/nhật ký)
// Cụm ads còn KEYLESS (lô sau): people/acc/cards/conn/bank + users_extra.
// Đã chuyển sang DB (029): tho, kgs, cfg, dsvc — và lines (enum)/session (bỏ) xử lý riêng.
const KEYLESS = new Set(['people','acc','cards','conn','bank','users_extra'])

// VAT (%) từ cau_hinh_sale — dùng quy đổi giá CHƯA VAT (DB) ↔ CÓ VAT (màn hình). Cache 1 lần.
let _vatCache = null
async function getVat() {
  if (_vatCache != null) return _vatCache
  try { const { data } = await sb.rpc('cau_hinh_sale'); _vatCache = Number(data?.vat) || 10 } catch { _vatCache = 10 }
  return _vatCache
}
const themVat = (n, vat) => n == null ? n : Math.round(Number(n) * (1 + vat / 100))   // pre-VAT -> CÓ VAT
const boVat   = (n, vat) => n == null ? n : Math.round(Number(n) / (1 + vat / 100))   // CÓ VAT -> pre-VAT

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
  if (k === 'c2:brands') { const { data, error } = await sb.from('thuong_hieu_ban').select('*'); if (error) throw error   // L-48a: view danh mục CHUNG (đang bật + không phải kênh + có mã 3 chữ) — khớp app Sản phẩm
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
  if (k === 'c2:don') { const vat = await getVat(); const { data, error } = await sb.from('don_hang').select('*'); if (error) throw error
    donKeyMap = Object.fromEntries(data.map(r => [r.ma_don, r.ma_don]))
    // giá công thức/chốt/chiết khấu lưu CHƯA VAT -> trả app dạng CÓ VAT (cọc/đã thu GIỮ nguyên).
    const arr = data.map(r => { const d = rowToDon(r); d.giam = themVat(d.giam, vat) || 0
      d.giaCongThuc = themVat(d.giaCongThuc, vat); d.giaChot = themVat(d.giaChot, vat); return d })
    // SNAPSHOT để lúc lưu chỉ upsert đơn ĐANG SỬA (đơn không đổi -> không đụng, tránh ghi đè trạng thái).
    mem['__donSnap'] = Object.fromEntries(arr.map(d => [d.ma, JSON.stringify(d)]))
    return arr }
  if (k === 'c2:ct') {
    const vat = await getVat()
    const { data, error } = await sb.from('don_hang_mon').select('*, don_hang(ma_don)'); if (error) throw error
    return data.map(m => ({ id: m.id, donId: m.don_hang ? m.don_hang.ma_don : '', spId: m.sp_id || '', ten: m.ten || '',
      vl: m.vl || '', kt: m.kt || '', sl: Number(m.so_luong) || 1, gia: themVat(Number(m.gia) || 0, vat), tho: m.tho || '',
      maMau: m.ma_mau || '', ct: m.chi_tiet || '', dungMoi: !!m.dung_moi, anh: m.anh || [], khongGian: m.khong_gian || [] })) }
  if (k === 'c2:ls') {
    const { data, error } = await sb.from('don_hang_nhat_ky').select('*, don_hang(ma_don)').order('luc'); if (error) throw error
    return data.map(l => ({ id: l.id, donId: l.don_hang ? l.don_hang.ma_don : '', tu: l.tu ? toTT(l.tu) : '',
      den: toTT(l.den), nguoi: '', luc: l.luc, lyDo: l.ly_do || '' })) }
  if (k === 'c2:gia_tham_so') {
    // GIỜ dựng hình: hàm gio_thiet_ke() cho MỌI vai trò (kể cả sale) — chỉ 3 số giờ, không tiền.
    const out = {}
    try {
      const { data } = await sb.rpc('gio_thiet_ke')
      const r = Array.isArray(data) ? data[0] : data
      if (r) { out.gioL1 = Number(r.gio_l1); out.gioL2 = Number(r.gio_l2); out.gioL3 = Number(r.gio_l3) }
    } catch (e) { /* thiếu giờ -> app tự ẩn số gợi ý */ }
    // TIỀN nội bộ (đơn giá giờ, CNC, setup): tham_so_tai_chinh RLS chỉ ceo/ke_toan -> sale ra RỖNG.
    try {
      const { data } = await sb.from('tham_so_tai_chinh')
        .select('dg_gio_tk,cnc_lap_trinh,setup_to_hop').order('ngay_ap_dung', { ascending: false }).limit(1).maybeSingle()
      if (data) { out.dgGioTK = Number(data.dg_gio_tk); out.cncLapTrinh = Number(data.cnc_lap_trinh); out.setupToHop = Number(data.setup_to_hop) }
    } catch (e) { /* sale bị RLS chặn -> không có tiền, đúng ý đồ */ }
    return out
  }
  if (k === 'c2:tho') {   // danh mục thợ (029) -> mảng tên (như THO0)
    const { data, error } = await sb.from('tho').select('ten,dang_lam').eq('dang_lam', true).order('ten'); if (error) throw error
    return data.map(t => t.ten) }
  if (k === 'c2:kgs') {   // danh mục không gian (029) -> [{c,n}] (như KG0)
    const { data, error } = await sb.from('khong_gian').select('ma,ten').eq('ngung', false); if (error) throw error
    return data.map(x => ({ c: x.ma, n: x.ten })) }
  if (k === 'c2:cfg') {   // vat + giờ + ghi_de + ngưỡng qua cau_hinh_sale() (KHÔNG lộ cột tiền)
    const { data } = await sb.rpc('cau_hinh_sale'); const r = data || {}
    if (r.vat != null) _vatCache = Number(r.vat)
    return { vat: r.vat ?? 10, gio: r.gio_mo_cua || ['01:00', '13:00'], ghiDe: r.ghi_de ?? 7,
      nAds: r.n_ads, nCac: r.n_cac, nKg: r.n_kg, nNo: r.n_no, nGiam: r.n_giam,
      tranSale: r.tran_sale, tranTruongNhom: r.tran_truong_nhom } }
  if (k === 'c2:dsvc') {  // ship dự toán {ma_ky|dong: số}
    const { data } = await sb.rpc('ship_du_toan_map'); return data || {} }
  if (k === 'c2:nguoi_duyet') {  // danh sách người duyệt giảm giá (id, tên, cấp) — cho picker của sale
    const { data } = await sb.rpc('nguoi_duyet_giam'); return (data || []).map(x => ({ id: x.ns_id, ten: x.ten, cap: x.cap })) }
  if (k === 'c2:lines') return [{ c: 'ban_le', n: 'Bán lẻ' }, { c: 'combo', n: 'Combo' }, { c: 'du_an', n: 'Dự án' }]  // enum, khỏi bảng
  if (k === 'c2:session') return null   // BỎ: auth thật do Supabase persistSession lo
  if (KEYLESS.has(k.replace('c2:', ''))) { if (k in mem) return mem[k]; const e = new Error('khong co khoa'); e.__keyless = true; throw e }
  const e = new Error('khong co khoa'); throw e
}

async function _set(k, jsonStr) {
  const v = JSON.parse(jsonStr)
  if (k === 'c2:don') {
    const vat = await getVat()
    donKeyMap = Object.fromEntries((v || []).map(d => [d.id, d.ma]))
    const { data: kd } = await sb.from('khach').select('*')
    const khMap = Object.fromEntries((kd || []).map(x => [x.sdt, { sdt: x.sdt, ten: x.ten, tinh: x.tinh, diaChi: x.dia_chi }]))
    // khMap theo id app: đơn app dùng khachId; nhưng khách app nằm ở c2:khach (id=sdt). Ghép qua mem nếu có.
    const khByAppId = mem['__khByAppId'] || {}
    // giá công thức/chốt/chiết khấu lưu CHƯA VAT; cọc/đã thu là tiền mặt -> GIỮ nguyên.
    // CHỈ upsert đơn MỚI hoặc ĐÃ ĐỔI (so với snapshot lúc nạp) — KHÔNG đụng đơn khác trong xưởng.
    //   Lỗ cũ: upsert CẢ danh sách -> đơn cho_cat/cho_giao bị ghi về moi_len_don khi sale lưu đơn bất kỳ.
    const snap = mem['__donSnap'] || {}
    const doiOrMoi = (v || []).filter(d => snap[d.ma] !== JSON.stringify(d))
    // ═══ [WP-06 L-06c · WP-07 L-133] TRẠNG THÁI ĐI QUA CỔNG (RPC), KHÔNG upsert cột trang_thai ═══
    //   Đơn ĐANG CÓ đổi trạng thái -> chot_don / doi_trang_thai_don (db/148·149). Đơn MỚI -> tao_don (db/151):
    //   server ÉP trang_thai='bao_gia', "+ Lên đơn" thì tao_don(p_chot=true) gọi chot_don cùng transaction.
    //   Client KHÔNG còn gửi trang_thai ở cả hai nhánh (điều kiện để L-06d/L-134 revoke quyền cột mà không 403).
    //   Lỗi RPC (món giá=0, thiếu nguồn khách, mã trùng…) NÉM NGUYÊN VĂN lên UI — không nuốt (luật 00).
    const rowCua = d => { const r = donToRow(d, { [d.khachId]: khByAppId[d.khachId] || khMap[d.khachId] || {} })
      r.chiet_khau = boVat(r.chiet_khau, vat); r.gia_cong_thuc = boVat(r.gia_cong_thuc, vat); r.gia_chot = boVat(r.gia_chot, vat)
      return r }
    for (const d of doiOrMoi) {
      const old = snap[d.ma] ? JSON.parse(snap[d.ma]) : null
      const denDB = toDB(d.tt)
      if (!old) {
        // ═══ [WP-07 L-133] ĐƠN MỚI -> RPC tao_don. Server ÉP trang_thai='bao_gia'; "+ Lên đơn" (đích moi_len_don)
        //   -> p_chot=true -> chot_don CÙNG transaction. KHÔNG gửi trang_thai (như đơn cũ WP-06 dòng 237).
        const r = rowCua(d); delete r.trang_thai   // trang_thai do SERVER ép, không phải client gửi
        // [WP-70 L-04] hội thoại nguồn đã chọn → p_lead_id; server tao_don tự đặt nguon_khach theo lead (đè p_don.nguon_khach)
        const { data: tr, error } = await sb.rpc('tao_don', { p_don: r, p_chot: denDB === 'moi_len_don', p_lead_id: d.leadId || null })
        if (error) throw new Error(error.message)   // RAISE nguyên văn -> hiện đỏ tại chỗ (không nuốt)
        const srv = Array.isArray(tr) ? tr[0] : tr
        if (srv && srv.trang_thai) d.tt = toTT(srv.trang_thai)   // vẽ lại theo trạng thái SERVER TRẢ VỀ, không đoán
        continue
      }
      const tuDB = toDB(old.tt)
      if (tuDB === denDB) continue                          // đơn CŨ không đổi trạng thái
      const { data: dd, error: eLook } = await sb.from('don_hang').select('id').eq('ma_don', d.ma).single()
      if (eLook) throw eLook
      if (denDB === 'moi_len_don') {                        // "Chốt giá / lên đơn" (đơn cũ WP-06)
        const { error } = await sb.rpc('chot_don', { p_don_id: dd.id, p_nguon_khach: d.nguonKhach || null, p_thuong_hieu: d.brand || null })
        if (error) throw new Error(error.message)
      } else {                                              // da_giao · bao_gia* · tam_ngung · huy (đích khác -> DB gác)
        // [WP-72] bao_gia_thua: cổng bản mới bắt p_ly_do_thua (danh mục đóng) + p_ghi_chu_thua.
        const { error } = await sb.rpc('doi_trang_thai_don', { p_don_id: dd.id, p_trang_thai_moi: denDB, p_ly_do: d.lyDo || null,
          p_ly_do_thua: denDB === 'bao_gia_thua' ? (d.lyDoThua || null) : null,
          p_ghi_chu_thua: denDB === 'bao_gia_thua' ? (d.ghiChuThua || null) : null })
        if (error) throw new Error(error.message)
      }
    }
    // ĐƠN CŨ: UPDATE cột dữ liệu (KHÔNG upsert — client KHÔNG có INSERT sau QD-66/67, .upsert INSERT-on-conflict → 403).
    //   [WP-72 L-72d] trang_thai/ly_do_thua/ghi_chu_thua là cột CỔNG (doi_trang_thai_don, QD-64/66) — xoá khỏi payload, client không ghi thẳng.
    for (const d of doiOrMoi.filter(d => snap[d.ma])) {
      const r = rowCua(d); delete r.trang_thai; delete r.ly_do_thua; delete r.ghi_chu_thua; delete r.ma_don
      const { error } = await sb.from('don_hang').update(r).eq('ma_don', d.ma)
      if (error) throw new Error(error.message)   // RAISE nguyên văn -> banner đỏ (không nuốt)
    }
    mem['__donSnap'] = Object.fromEntries((v || []).map(d => [d.ma, JSON.stringify(d)]))   // cập nhật snapshot
    // KHÔNG xoá đơn (sale/tk_ban_hang không có quyền). Nếu danh sách app thiếu đơn đang có trong DB
    //   -> đó là ý đồ XOÁ -> BÁO RÕ, không .delete() im lặng. Muốn bỏ đơn thì chuyển trạng thái (huỷ/tạm ngưng).
    const mas = new Set((v || []).map(d => d.ma))
    const { data: hienCo, error: eList } = await sb.from('don_hang').select('ma_don'); if (eList) throw eList
    const thieu = (hienCo || []).map(r => r.ma_don).filter(ma => !mas.has(ma))
    if (thieu.length) throw new Error('Không được phép xoá đơn hàng (' + thieu.join(', ') + ') — hãy chuyển trạng thái (huỷ/tạm ngưng) thay vì xoá.')
    return
  }
  if (k === 'c2:ct') {
    // GIỮ trang_thai + id món CŨ: update theo id (KHÔNG đụng trang_thai), insert món MỚI (mặc định cho_cat),
    //   xoá món người dùng bỏ. Lỗ cũ: delete-all + insert -> món về cho_cat, mất tiến độ SX + đứt nhật ký món.
    const vat = await getVat()
    const fields = m => ({ sp_id: nz(m.spId), ten: nz(m.ten), vl: nz(m.vl), kt: nz(m.kt),
      so_luong: m.sl ?? 1, gia: boVat(m.gia ?? null, vat), tho: nz(m.tho), ma_mau: nz(m.maMau), chi_tiet: nz(m.ct),
      dung_moi: !!m.dungMoi, anh: m.anh || [], khong_gian: Array.isArray(m.khongGian) ? m.khongGian : [] })
    const byMa = {}
    for (const m of (v || [])) { const ma = maCuaAppId(m.donId); (byMa[ma] = byMa[ma] || []).push(m) }
    for (const ma of Object.keys(byMa)) {
      const did = await donIdCuaMa(ma); if (!did) continue
      const { data: exist } = await sb.from('don_hang_mon').select('id').eq('don_id', did)
      const exSet = new Set((exist || []).map(x => x.id)); const giu = new Set()
      for (const m of byMa[ma]) {
        if (exSet.has(m.id)) {   // món CŨ -> UPDATE (giữ id + trang_thai + nhật ký)
          giu.add(m.id); const { error } = await sb.from('don_hang_mon').update(fields(m)).eq('id', m.id); if (error) throw error
        } else {                 // món MỚI -> INSERT (trang_thai mặc định cho_cat)
          const { error } = await sb.from('don_hang_mon').insert({ don_id: did, ...fields(m) }); if (error) throw error
        }
      }
      const boa = (exist || []).map(x => x.id).filter(id => !giu.has(id))   // món người dùng bỏ khỏi đơn
      if (boa.length) { const { error } = await sb.from('don_hang_mon').delete().in('id', boa); if (error) throw error }
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
  if (k === 'c2:gio_bh') {   // tk_ban_hang ghi GIỜ dựng 3D (loai_gio='ban_hang', của MÌNH). RLS chặn nếu sai vai/loại.
    const uid = (window.__saleUser && window.__saleUser.id) || null
    const { error } = await sb.from('gio_thiet_ke_thuc').insert({ ma_don: v.ma_don, ma_ns: uid,
      loai_gio: 'ban_hang', gio_thuc: Number(v.gio) || 0, cap: nz(v.cap) }); if (error) throw error
    return
  }
  if (k === 'c2:cfg') {   // vat + giờ + ghi_de + ngưỡng -> cột non-money của kỳ hiện hành (RLS ceo/ke_toan)
    if (v.vat != null) _vatCache = Number(v.vat)
    const { data: ky, error: eKy } = await sb.from('tham_so_tai_chinh').select('ma_ky').order('ngay_ap_dung', { ascending: false }).limit(1).maybeSingle(); if (eKy) throw eKy
    if (ky) { const { error } = await sb.rpc('luu_cau_hinh_van_hanh', {   // WP-11d: qua RPC (grant .update revoke), bố cục màn KHÔNG đổi
        p_ma_ky: ky.ma_ky, p_vat: v.vat, p_gio_mo_cua: v.gio, p_ghi_de: v.ghiDe,
        p_n_ads: v.nAds, p_n_cac: v.nCac, p_n_kg: v.nKg, p_n_no: v.nNo, p_n_giam: v.nGiam })
      if (error) throw error }
    return
  }
  if (k === 'c2:dsvc') {   // {ma_ky|dong: số} -> gọi dat_ship_du_toan từng khoá (ceo/ke_toan)
    for (const key of Object.keys(v || {})) { const [mk, dong] = key.split('|')
      if (mk && dong) { const { error } = await sb.rpc('dat_ship_du_toan', { p_ma_ky: mk, p_dong: dong, p_val: Number(v[key]) || 0 }); if (error) throw error } }
    return
  }
  if (k === 'c2:session') return   // BỎ: không lưu (Supabase persistSession lo)
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

// ══════════ RPC curated cho sale (bọc HẾT — cột trả về do RPC chọn, KHÔNG phụ thuộc RLS) ══════════
//   Trả {data, error} thô để React tự xử. dong: app (ban_le…) -> DB (le…) qua DONG_W.
window.saleApi = {
  monTrangThai: maDon => sb.rpc('sale_mon_cua_don', { p_ma_don: maDon }),
  // [WP-75 L-2a] Đợt lịch thu ĐẾN HẠN (mốc đã đạt, chưa thu đủ) — {ok, ngay, dot:[...]}. Tiền TỪ DB.
  lichThuDenHan: async (ngay = null) => { const { data, error } = await sb.rpc('lich_thu_den_han', ngay ? { p_ngay: ngay } : {}); if (error) throw error; return data },
  // [WP-75 L-2a] Ghi phiếu thu — dùng pt_ghi CÓ SẴN (KHÔNG mở đường ghi tiền thứ hai). p_phieu={ma_don,so_tien,loai,ghi_chu?}.
  ptGhi: async phieu => { const { data, error } = await sb.rpc('pt_ghi', { p_phieu: phieu }); if (error) throw error; return data },
  // [WP-75 L-2b] đọc CẢ bộ đợt của MỘT đơn cho thẻ đơn (tiền từ DB) — {ok, gia, da_thu, moc_ban_giao, sum_ty_le, tong_due, con_phai_thu, dot:[...]}.
  lichThuCuaDon: async maDon => { const { data, error } = await sb.rpc('lich_thu_cua_don', { p_ma_don: maDon }); if (error) throw error; return data },
  // [WP-75 L-2b] ghi/sửa bộ đợt (tách khoảng + lý do). p_dot=[{so_dot,moc,ty_le,ngay_han?}].
  ltGhi: async (donId, dot, lyDo = null) => { const { data, error } = await sb.rpc('lt_ghi', { p_don_id: donId, p_dot: dot, p_ly_do: lyDo }); if (error) throw error; return data },
  // [WP-75 L-2b] đẩy/lùi mốc bàn giao. moc∈{chua_giao,da_giao_chua_lap,da_lap_xong}. Lùi cần lý do (server gác).
  datMocBanGiao: async (donId, moc, lyDo = null) => { const { data, error } = await sb.rpc('dat_moc_ban_giao', { p_don_id: donId, p_moc: moc, p_ly_do: lyDo }); if (error) throw error; return data },
  // chuông "bản chờ gửi" (db/087) — trả {tong, ds} cùng một điều kiện; badge=tong, danh sách=ds (≤ gioi_han)
  banChoGui: async (gioiHan = 50) => { const { data, error } = await sb.rpc('sale_ban_cho_gui', { p_gioi_han: gioiHan }); if (error) throw error; return data },
  // màn báo giá (db/091) — {tong, ds:[đơn báo giá + gd]}. App tự tính ô/lọc như v5. Sale KHÔNG thấy giá vốn.
  baoGiaDs: async (gioiHan = 1000) => { const { data, error } = await sb.rpc('sale_bao_gia_ds', { p_gioi_han: gioiHan }); if (error) throw error; return data },
  // [WP-72] đếm 3 nhóm hạn (quá hạn / sắp hết hạn ≤3 ngày / còn hạn) + tiền, cho khối đầu màn. Chỉ đơn thật (loại demo).
  baoGiaHanDem: async () => { const { data, error } = await sb.rpc('sale_bao_gia_han_dem'); if (error) throw error; return data },
  // [WP-72] Đánh dấu THUA (cổng bản mới bắt lý do trong 5 giá trị) — cửa "Đánh dấu thua" gọi thẳng, không qua batch upsert.
  danhDauThua: async (donId, lyDoThua, ghiChuThua = null) => { const { data, error } = await sb.rpc('doi_trang_thai_don', { p_don_id: donId, p_trang_thai_moi: 'bao_gia_thua', p_ly_do: null, p_ly_do_thua: lyDoThua, p_ghi_chu_thua: ghiChuThua || null }); if (error) throw error; return data },
  // [WP-72] sale sửa hạn trả lời tay (dh_sua RLS) — trigger không ghi đè giá trị đã có.
  datHan: async (maDon, han) => { const { error } = await sb.from('don_hang').update({ han_tra_loi: han || null }).eq('ma_don', maDon); if (error) throw error; return true },
  // dải 6 số mặt-đồng-hồ màn Báo giá (db/099) — {so1..so6, tong_funnel, nguong_tam}. KHÔNG giá vốn. n nhỏ → app dán [TẠM].
  daiSoBaoGia: async (gioiHan = 50) => { const { data, error } = await sb.rpc('sale_dai_so_bao_gia', { p_gioi_han: gioiHan }); if (error) throw error; return data },
  // sale ghi phản hồi khách (dùng lại phan_hoi_ban db/051): khach_duyet | khach_doi_y | chua_dung_yeu_cau
  phanHoiBanRpc: async (banId, ketQua, ghiChu) => { const { data, error } = await sb.rpc('phan_hoi_ban', { p_ban_id: banId, p_ket_qua: ketQua, p_ghi_chu: ghiChu || '' }); if (error) throw error; return data },
  leadTime: (dong, sku) => sb.rpc('sale_lead_time', { p_dong: DONG_W[dong] || dong || null, p_sku: sku || null }),
  // [WP-70 L-04] gợi ý hội thoại nguồn (Pancake) cho form lên đơn — rỗng → 7 ngày gần nhất ≤50; có chữ → khớp tên/sđt.
  leadGoiY: async (tim = null, ngay = 7) => { const { data, error } = await sb.rpc('lead_goi_y', { p_tim: tim || null, p_ngay: ngay }); if (error) throw error; return data || [] },
  // [WP-70 L-09] "Kéo ngay": gọi Worker Cloudflare kéo một lượt (không chờ nhịp). Sale KHÔNG ghi thẳng — Worker ghi
  //   qua lead_ghi + GUC như cron. Khoá chống chồng ở Worker; app tự chặn bấm lại 30s.
  keoNgay: async () => { const r = await fetch('https://togihome-keo-lead.togihome-keo-lead.workers.dev/', { method: 'GET' }); return await r.json().catch(() => ({})) },
  // [WP-44] ngày XONG XƯỞNG (dự kiến) cho MỘT đơn — nay dùng ngay_giao_hua (CTP: tải + thiếu vật tư + lead),
  //   KHÔNG còn atp thẳng. Gọi TỪNG đơn (temp table/lần → không gộp). Map ngay_hua→ngay_hua_duoc để render cũ chạy;
  //   kèm căn cứ/độ tin: {ok,ngay_hua_duoc,ngay_hua,do_tin,can_cu,vat_tu_dang_doan,so_vat_tu_dang_doan,cac_gia_dinh,...}.
  ngayXong: async maDon => { const { data, error } = await sb.rpc('ngay_giao_hua', { p_ma_don: maDon }); if (error) return { ok: false, loi: 'LOI_GOI' }; return (data && data.ok) ? Object.assign({}, data, { ngay_hua_duoc: data.ngay_hua }) : data },
  // Tiến độ xưởng của 1 đơn — mỗi món 1 dòng (bước hiện tại + lần quét). Sale CHỈ XEM (db/094, không giá vốn).
  tienDoMon: async maDon => { const { data, error } = await sb.rpc('sale_tien_do_mon', { p_ma_don: maDon }); if (error) return []; return data || [] },
  // Dòng đời đơn — kể lại đơn từ lúc sinh (db/096, gộp nhật ký + bản + phản hồi + link). CHỈ ĐỌC, không giá vốn.
  dongDoiDon: async (maDon, gh = 60) => { const { data, error } = await sb.rpc('sale_dong_doi_don', { p_ma_don: maDon, p_gioi_han: gh }); if (error) return []; return data || [] },
  // Đổi CHỦ đơn (db/101) — chỉ truong_nhom_sale/ceo (server gác). Ghi nhật ký. Trả {ok, ten_moi}.
  doiSalePhuTrach: async (maDon, nsMoi, lyDo) => { const { data, error } = await sb.rpc('doi_sale_phu_trach', { p_ma_don: maDon, p_ns_moi: nsMoi, p_ly_do: lyDo || null }); if (error) throw error; return data },
  // Danh sách sale (cho dropdown lọc/đổi chủ) — chỉ vai bán hàng đang hoạt động.
  dsSale: async () => { const { data, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro').in('vai_tro', ['sale', 'truong_nhom_sale', 'tk_ban_hang']).eq('dang_hoat_dong', true).order('ho_ten'); if (error) return []; return data || [] },
  // Số theo người 30 ngày cho màn Nhóm (db/102) — {ds, so_ngay, nguong_tam}. Guard truong_nhom_sale/ceo. KHÔNG giá vốn.
  nhomSoNguoi: async (soNgay = 30, gioiHan = 50) => { const { data, error } = await sb.rpc('nhom_so_nguoi', { p_ngay: soNgay, p_gioi_han: gioiHan }); if (error) throw error; return data },

  // ── BẢN THIẾT KẾ (db/051) ──
  // đọc danh sách bản + ảnh của 1 đơn (RLS cho sale/thiet_ke/tk_ban_hang/ceo; xuong chỉ bản khach_duyet)
  banCuaDon: maDon => sb.from('ban_thiet_ke')
    .select('id,ma_don,phien_ban,ghi_chu,trang_thai,luc_gui,luc_phan_hoi,ghi_chu_phan_hoi,file_3d_path,file_3d_byte,anh:anh_ban_thiet_ke(id,duong_dan_nho,duong_dan_to,byte_nho,byte_to,thu_tu)')
    .eq('ma_don', maDon).order('phien_ban', { ascending: false }),
  phanHoiBan: (banId, ketQua, ghiChu) => sb.rpc('phan_hoi_ban', { p_ban_id: banId, p_ket_qua: ketQua, p_ghi_chu: ghiChu || '' }),
  guiBan: (maDon, ghiChu, anh) => sb.rpc('gui_ban_thiet_ke', { p_ma_don: maDon, p_ghi_chu: ghiChu || '', p_anh: anh }),
  // signed URL để XEM ảnh bucket private trong app (1 giờ đủ cho phiên xem)
  kyXem: async path => { const { data } = await sb.storage.from('ban-thiet-ke').createSignedUrl(path, 3600); return data?.signedUrl || null },
  taiAnh: (path, blob, ct) => sb.storage.from('ban-thiet-ke').upload(path, blob, { contentType: ct || 'image/webp', upsert: true }),
  // Gửi link khách: RPC sinh token+nội dung curated -> app KÝ signed URL 7 ngày -> nạp lại -> trả link
  linkGuiKhach: async banId => {
    const { data, error } = await sb.rpc('link_gui_khach', { p_ban_id: banId }); if (error) throw error
    const urls = []
    for (const a of (data.anh || [])) {
      const [nho, to] = await Promise.all([
        sb.storage.from('ban-thiet-ke').createSignedUrl(a.duong_dan_nho, 604800),
        sb.storage.from('ban-thiet-ke').createSignedUrl(a.duong_dan_to, 604800)])
      urls.push({ nho: nho.data?.signedUrl || '', to: to.data?.signedUrl || '', thu_tu: a.thu_tu })
    }
    const { error: e2 } = await sb.rpc('nap_anh_link', { p_token: data.token, p_urls: urls }); if (e2) throw e2
    return location.origin + '/xem-ban.html?t=' + data.token
  },

  // ── [WP-78 L-05] GẮN LEAD theo SĐT khách: gợi ý (db/190) · gắn/đổi có vết (db/192) · đọc vết (db/196) ──
  //   donGanLead/donLeadVet nhận MÃ ĐƠN (app dùng ma_don), tự phân giải uuid — cửa ghi lead_id DUY NHẤT là don_gan_lead.
  leadGoiYTheoSdt: async sdt => { const { data, error } = await sb.rpc('lead_goi_y_theo_sdt', { p_sdt: sdt }); if (error) throw error; return data || [] },
  donGanLead: async (ma, leadId, lyDo = null) => { const id = await donIdCuaMa(ma); if (!id) throw new Error('Đơn chưa lưu trên máy chủ — lưu đơn trước khi gắn lead'); const { data, error } = await sb.rpc('don_gan_lead', { p_don_id: id, p_lead_id: leadId, p_ly_do: lyDo }); if (error) throw error; return data },
  donLeadVet: async ma => { const id = await donIdCuaMa(ma); if (!id) return []; const { data, error } = await sb.rpc('don_lead_vet', { p_don_id: id }); if (error) throw error; return data || [] },
}

// ══════════ NÉN ẢNH HAI CỠ trong trình duyệt (WebP, lùi JPEG). KHÔNG lưu ảnh gốc. ══════════
//   nhỏ: rộng ≤400px q0.75 (<40KB) · to: rộng ≤1600px q0.82 (<400KB). Làm ở máy người dùng — không tốn máy chủ.
window.nenAnh = async function (file) {
  // ⚠ URL ở scope này bị che bởi hằng VITE_SUPABASE_URL (dòng 6) — phải dùng window.URL cho Blob URL.
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = window.URL.createObjectURL(file) })
  const webpOk = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  const kieu = webpOk ? 'image/webp' : 'image/jpeg'
  const ve = (maxW, q) => new Promise(res => {
    const scale = Math.min(1, maxW / img.width), w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    cv.getContext('2d').drawImage(img, 0, 0, w, h)
    cv.toBlob(b => res(b), kieu, q)
  })
  const nho = await ve(400, 0.75), to = await ve(1600, 0.82)
  window.URL.revokeObjectURL(img.src)
  return { nho, to, byteNho: nho.size, byteTo: to.size, duoi: webpOk ? 'webp' : 'jpg', ct: kieu }
}

// ══════════ ĐĂNG NHẬP + nạp mã app (thứ tự: storage đã gán ở trên -> giờ mới nạp file sale) ══════════
async function napApp() {
  // WP-04: INLINE togihome_sale.html vào bundle qua ?raw (như tab Hướng dẫn Tài chính) — KHÔNG fetch runtime.
  //   Lý do: file tĩnh fetch lúc chạy bị CDN cache/minify → sửa UI KHÔNG tới prod. Đi qua bundle có HASH thì chắc.
  const html = SALE_HTML
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])   // 2 script inline (không src)
  for (const code of scripts) { const s = document.createElement('script'); s.textContent = code; document.body.appendChild(s) }
}

async function laySauDangNhap(user) {
  const { data, error } = await sb.from('nguoi_dung').select('id,ho_ten,vai_tro,dang_hoat_dong').eq('auth_uid', user.id).maybeSingle()
  if (error || !data) { manDangNhap('Tài khoản chưa được gán vai trò trong kho.nguoi_dung — báo CEO.'); await sb.auth.signOut(); return }
  if (!data.dang_hoat_dong) { await sb.auth.signOut(); manDangNhap('Tài khoản đã bị tắt hoạt động — báo CEO.'); return }
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

// ĐĂNG XUẤT THẬT: signOut Supabase (xoá token localStorage) + xoá __saleUser + về màn đăng nhập.
//   KHÔNG để lại phiên/token nào trong trình duyệt. React app gọi window.dangXuat.
window.dangXuat = async () => {
  try { await sb.auth.signOut() } catch (e) {}
  try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
  window.__saleUser = null
  location.reload()
}

;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) laySauDangNhap(data.session.user)
  else manDangNhap('')
})()
