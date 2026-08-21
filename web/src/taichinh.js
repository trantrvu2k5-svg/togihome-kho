// TRANG BỌC app TÀI CHÍNH: Supabase + đăng nhập + cổng vai trò (CHỈ ceo/ke_toan) + nối 4 phần vào hàm DB.
// Mọi con số do DB tính (bang_gia, gia_bac_tu_gv, tinh_he_so_m, chot_niem_yet) — giá vốn không rời server.
import { createClient } from '@supabase/supabase-js'
import HD_MD from '../../docs/huong_dan_taichinh.md?raw'   // L-52: tài liệu = 1 nguồn (docs/), inline vào bundle
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
  $('tc_who').textContent = USER.ho_ten + ' · ' + USER.vai_tro
  // ĐĂNG XUẤT: signOut + XOÁ HẲN token localStorage TRƯỚC reload. Nếu chỉ signOut rồi reload, việc xoá
  //   storage async có thể bị reload cắt ngang -> token còn -> tải lại thẳng app, KHÔNG ra màn đăng nhập.
  $('tc_out').onclick = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    try { Object.keys(localStorage).filter(k => /^sb-|supabase/i.test(k)).forEach(k => localStorage.removeItem(k)) } catch (e) {}
    location.reload()
  }
  const { data: kys } = await sb.from('tham_so_tai_chinh').select('ma_ky').order('ma_ky', { ascending: false })
  $('ky').innerHTML = (kys || []).map(r => `<option>${r.ma_ky}</option>`).join('') || '<option>2026-07</option>'
  // sự kiện
  $('ky').onchange = loadKy
  $('btn_luu').onclick = luuKy
  $('btn_tinh').onclick = refreshHeSoM
  $('btn_chot').onclick = chot
  $('s6_luu').onclick = luuS6
  $('gv_ghi').onclick = nhapGiaVonTay
  if (USER.vai_tro === 'ceo') $('nav_tk').style.display = 'block'   // tab Quản lý tài khoản CHỈ ceo (RPC cũng guard)
  // L-65: ke_toan XEM giá vốn đơn được, nhưng GHI TAY chỉ ceo/kho (ghi_gia_von_tay giữ nguyên) → ẩn form nhập cho không-ceo
  if (USER.vai_tro !== 'ceo') { const gn = $('gv_nhap'); if (gn) gn.style.display = 'none' }
  $('tk_them').onclick = themNguoi
  $('cpk_them').onclick = () => cpkAddRow()   // L-43: nút màn Chi phí kỳ
  $('cpk_chep').onclick = cpkChepKyTruoc
  $('cpk_luu').onclick = cpkLuu
  $('cpnl_dung').onclick = () => { setMoney('cpnl', window.__suyNL || 0); capNhatCanhBaoNL() }   // L-46: dùng số suy
  $('cpnl').addEventListener('input', capNhatCanhBaoNL)
  $('kc_them').onclick = () => kcAddRow()   // L-48: nút màn Kênh & CAC
  $('kc_luu').onclick = kcLuu
  // L-49: màn Dòng tiền — nút nhập liệu
  $('pt_luu').onclick = ptLuu; $('cg_luu').onclick = cgLuu; $('ch_luu').onclick = chLuu
  $('cs_luu').onclick = csLuu; $('vn_luu').onclick = vnLuu; $('qy_luu').onclick = qyLuu
  $('dt_no_truoc').onclick = () => { if (DT_TRANG > 1) { DT_TRANG--; taiConPhaiThu() } }
  $('dt_no_sau').onclick = () => { if (DT_TRANG < DT_SOTRANG) { DT_TRANG++; taiConPhaiThu() } }
  $('nx_ng_luu').onclick = nxNguongLuu   // L-50: lưu ngưỡng nhận xét
  ;['pt_tien', 'cg_tien', 'vn_tien', 'qy_tien'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', () => fmtMoneyEl(e)) })
  document.querySelectorAll('#tc .navi').forEach(b => { if (b.dataset.tab) b.onclick = () => doiTab(b.dataset.tab) })   // bỏ nút KHÔNG có data-tab (vd Đăng xuất) — nếu không sẽ ghi đè handler đăng xuất
  document.querySelectorAll('#tc .tag[data-param]').forEach(el => el.onclick = () => toggleBadge(el.dataset.param))  // badge từng tham số
  document.querySelectorAll('#tc input.money').forEach(el => el.addEventListener('input', () => fmtMoneyEl(el)))
  ;['qc_gv', 'qc_loai', 'qc_nhom', 'qc_dx'].forEach(id => $(id).addEventListener('input', refreshQuick))
  await loadKy()
  // L-52: default tab THEO VAI — kế toán đáp thẳng "Dòng tiền" (nơi nhập chính), còn lại đáp "Điều hành".
  doiTab(USER.vai_tro === 'ke_toan' ? 'dongtien' : 'dieuhanh')
}

// Chuyển tab — dữ liệu GIỮ NGUYÊN (chỉ ẩn/hiện, không dựng lại DOM).
function doiTab(t) {
  document.querySelectorAll('#tc .tabp').forEach(p => p.classList.toggle('on', p.id === 'tab-' + t))
  document.querySelectorAll('#tc .navi').forEach(b => b.classList.toggle('on', b.dataset.tab === t))
  window.scrollTo(0, 0)
  if (t === 'dieuhanh') taiDieuHanh()
  if (t === 'gvdon') taiGiaVonDon()
  if (t === 'pl') taiPL()
  if (t === 'cmdon') { CM_TRANG = 0; CM_MO = -1; taiCM() }
  if (t === 'kenhcac') { KC_BRAND = 'all'; taiKenhCac() }
  if (t === 'dongtien') { DT_TRANG = 1; taiDongTien() }
  if (t === 'nhanxet') taiNhanXet()
  if (t === 'chiphi') taiChiPhiKy()
  if (t === 'huongdan') taiHuongDan()
  if (t === 'taikhoan') taiTaiKhoan()
}

// ── TAB ĐIỀU HÀNH (L-69): gom số đã có, CHỈ ĐỌC. 5 khối theo độ gấp. Không code lại logic — gọi RPC/nguồn sẵn. ──
const DH_NG = { chua_nhan: 3, ban_moi: 2, da_gui: 4, treo: 25 }   // ngưỡng tắc báo giá (ngày) — HẰNG SỐ (chưa có bảng cài đặt)
const escH = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GD_TEN = { chua_nhan: 'Chưa ai nhận dựng', ban_moi: 'Có bản, chưa gửi', da_gui: 'Đã gửi, chờ khách', sua_gop_y: 'Khách chê, chờ bản', du_len_don: 'Khách duyệt', dang_dung: 'Đang dựng', thua: 'Thua', treo: 'Treo' }
async function taiDieuHanh() {
  if (!$('dh_tac')) return
  const rpc = (fn, args) => sb.rpc(fn, args).then(r => r.error ? null : r.data).catch(() => null)
  const d = new Date(), den = new Date(Date.now() + 21 * 864e5), fmtD = x => x.toISOString().slice(0, 10)
  const [dh, bg, dai, tai] = await Promise.all([
    rpc('dieu_hanh_bang', { p_gioi_han: 100 }),
    rpc('sale_bao_gia_ds', { p_gioi_han: 1000 }),
    rpc('sale_dai_so_bao_gia', { p_gioi_han: 50 }),
    rpc('tai_theo_to_tuan', { p_tu_ngay: fmtD(d), p_den_ngay: fmtD(den) })
  ])
  const bgds = (bg && bg.ds) || []
  // ── KHỐI 1 · ĐANG TẮC (báo giá tắc từ bgds theo ngưỡng + SX-tắc + giao-chưa-thu từ dh) ──
  const tac = []
  bgds.forEach(b => {
    if (b.gd === 'chua_nhan' && b.mo_ngay > DH_NG.chua_nhan) tac.push({ ma: b.ma_don, kh: b.ten_khach, o: 'Chưa ai nhận dựng', ngay: b.mo_ngay, ai: '—' })
    else if (b.gd === 'ban_moi' && b.mo_ngay > DH_NG.ban_moi) tac.push({ ma: b.ma_don, kh: b.ten_khach, o: 'Bản chưa gửi khách', ngay: b.mo_ngay, ai: b.ai_dung || '—' })
    else if (b.gd === 'da_gui' && b.cho_khach > DH_NG.da_gui) tac.push({ ma: b.ma_don, kh: b.ten_khach, o: 'Chờ khách trả lời', ngay: b.cho_khach, ai: 'khách' })
    else if (b.gd === 'treo' && b.mo_ngay > DH_NG.treo) tac.push({ ma: b.ma_don, kh: b.ten_khach, o: 'Treo quá lâu', ngay: b.mo_ngay, ai: '—' })
  })
  ;((dh && dh.sx_tac) || []).forEach(s => tac.push({ ma: s.ma_don, kh: s.ten_khach, o: 'Đang SX · không quét', ngay: s.lang, ai: s.to || '—' }))
  ;((dh && dh.giao_chua_thu) || []).forEach(g => tac.push({ ma: g.ma_don, kh: g.ten_khach, o: 'Đã giao · chưa thu đủ', ngay: null, ai: 'còn ' + fmt(g.con_thu) }))
  tac.sort((a, b) => (b.ngay || 0) - (a.ngay || 0))
  $('dh_tac_ng').textContent = `ngưỡng: chưa nhận >${DH_NG.chua_nhan}ng · chưa gửi >${DH_NG.ban_moi} · chờ khách >${DH_NG.da_gui} · treo >${DH_NG.treo} · SX lặng >${dh ? dh.nguong_sx_lang : 2} (mặc định)`
  $('dh_tac').innerHTML = tac.length
    ? tac.map(t => `<div class="dh-row-tac"><b>${escH(t.ma)}</b><span>${escH(t.kh)}</span><span>${escH(t.o)}${t.ngay != null ? ' · <b>' + t.ngay + '</b> ngày' : ''}</span><span class="hint">${escH(t.ai)}</span></div>`).join('')
    : '<div class="dh-empty">Không có đơn nào đang tắc. 🎉</div>'
  // ── KHỐI 2 · PHỄU (đếm theo gd — CÙNG câu sale_bao_gia_ds, không viết lại) ──
  const dem = {}; bgds.forEach(b => dem[b.gd] = (dem[b.gd] || 0) + 1)
  const mo = bgds.filter(b => !['thua', 'treo'].includes(b.gd))
  const giaTriMo = mo.reduce((s, b) => s + (Number(b.tien) || 0), 0)
  const GD_ORD = ['chua_nhan', 'ban_moi', 'da_gui', 'sua_gop_y', 'du_len_don', 'dang_dung']
  $('dh_pheu').innerHTML =
    '<div class="dh-stats">' + GD_ORD.map(g => oClick('pheu_' + g, GD_TEN[g], dem[g] || 0, '', 'bg-gd')).join('')
    + oStat('Tổng giá trị đang mở', fmt(giaTriMo) + ' đ', mo.length + ' đơn')
    + oClick('pheu_thua', 'Thua', dem.thua || 0, '', 'bg-gd') + oClick('pheu_treo', 'Treo', dem.treo || 0, '', 'bg-gd')
    + '</div><div class="dh-list" id="dh_pheu_list" style="display:none"></div>'
  // gắn click cho từng ô phễu → mở list đúng gd (ô == list)
  GD_ORD.concat(['thua', 'treo']).forEach(g => {
    const o = $('pheu_' + g); if (!o) return
    o.onclick = () => moPheu(g, bgds.filter(b => b.gd === g))
  })
  // ── KHỐI 3 · DẢI 6 SỐ (gọi đúng sale_dai_so_bao_gia, giữ [TẠM]) ──
  $('dh_dai').innerHTML = dai ? veDai(dai) : '<div class="dh-empty">Chưa lấy được dải số.</div>'
  // ── KHỐI 4 · XƯỞNG (tải tuần theo tổ + đang SX + món tắc quét) ──
  const taiRows = Array.isArray(tai) ? tai : (tai && tai.ds) || []
  $('dh_xuong').innerHTML =
    '<div class="dh-stats">'
    + oStat('Đơn đang sản xuất', dh ? dh.sx_dang : '—', 'đang chạy trên chuyền')
    + oClick('xuong_tac', 'Đơn có món tắc quét', dh ? dh.so_don_sx_tac : 0, '>' + (dh ? dh.nguong_sx_lang : 2) + ' ngày không quét', '')
    + oStat('Tổ có lịch tuần này', taiRows.length, 'nguồn Tải & lịch')
    + '</div><div class="dh-list" id="dh_xuong_list" style="display:none"></div>'
  if ($('xuong_tac') && dh) $('xuong_tac').onclick = () => moDs('dh_xuong_list', $('xuong_tac'),
    (dh.sx_tac || []).map(s => `<div class="dh-row-tac"><b>${escH(s.ma_don)}</b><span>${escH(s.ten_khach)}</span><span>lặng <b>${s.lang}</b> ngày · ${s.so_tem} tem</span><span class="hint">${escH(s.to || '—')}</span></div>`))
  // ── KHỐI 5 · TIỀN ──
  $('dh_tien').innerHTML =
    '<div class="dh-stats">'
    + oStat('Còn phải thu (đã giao)', fmt(dh ? dh.phai_thu_tong : 0) + ' đ', 'tổng công nợ đã giao')
    + oClick('tien_giao', 'Đơn đã giao chưa thu đủ', dh ? dh.so_don_giao_no : 0, '', '')
    + oStat('Giá trị tồn kho', fmt(dh ? dh.ton_gia_tri : 0) + ' đ', 'nguồn kho.ton')
    + '</div><div class="dh-list" id="dh_tien_list" style="display:none"></div>'
  // L-74 · công nợ GOM theo KHÁCH (dieu_hanh_cong_no_khach) — bấm khách để bung đơn
  if ($('tien_giao') && dh) $('tien_giao').onclick = async () => {
    const oEl = $('tien_giao'), box = $('dh_tien_list')
    const dangMo = box.style.display !== 'none' && box.dataset.for === 'tien_giao'
    document.querySelectorAll('#tc .dh-o.on').forEach(e => e.classList.remove('on'))
    if (dangMo) { box.style.display = 'none'; return }
    box.dataset.for = 'tien_giao'; oEl.classList.add('on'); box.style.display = 'block'
    box.innerHTML = '<div class="dh-empty">Đang tải công nợ theo khách…</div>'
    const { data, error } = await sb.rpc('dieu_hanh_cong_no_khach', { p_gioi_han: 100 })
    const kh = error ? [] : (data || [])
    box.innerHTML = kh.length ? kh.map((k, i) => {
      const don = (dh.giao_chua_thu || []).filter(g => g.ten_khach === k.khach)
      return `<div class="dh-conno"><button class="dh-conno-kh" data-kh="${i}"><b>${escH(k.khach)}</b><span class="hint">${k.so_don} đơn · lâu nhất ${k.lau_nhat} ngày</span><b class="dh-conno-t">${fmt(k.tong_phai_thu)} đ</b></button>`
        + `<div class="dh-conno-don" id="dh-conno-${i}" style="display:none">`
        + (don.map(g => `<div class="dh-row-tac"><b>${escH(g.ma_don)}</b><span>còn <b>${fmt(g.con_thu)}</b> đ</span><span class="hint">giao ${escH(g.ngay_giao || '')}</span></div>`).join('') || '<div class="dh-empty">(đơn ở trang sau)</div>')
        + '</div></div>'
    }).join('') : '<div class="dh-empty">Không có công nợ đã giao.</div>'
    box.querySelectorAll('.dh-conno-kh').forEach(b => b.onclick = () => { const d = $('dh-conno-' + b.dataset.kh); d.style.display = d.style.display === 'none' ? 'block' : 'none' })
  }
  await veLapDayDH().catch(() => {})   // L-46: ô Lấp đầy xưởng vào khối Xưởng
}
function oStat(lbl, big, sub) { return `<div class="dh-o"><div class="lbl">${escH(lbl)}</div><div class="big">${big}</div><div class="sub">${escH(sub || '')}</div></div>` }
function oClick(id, lbl, big, sub, cls) { return `<button class="dh-o click ${cls || ''}" id="${id}" data-n="${big}"><div class="lbl">${escH(lbl)}</div><div class="big">${big}</div><div class="sub">${escH(sub || '')}</div></button>` }
function moDs(listId, oEl, rowsHtml) {
  const box = $(listId), on = box.style.display !== 'none' && box.dataset.for === oEl.id
  document.querySelectorAll('#tc .dh-o.on').forEach(e => e.classList.remove('on'))
  if (on) { box.style.display = 'none'; return }
  box.dataset.for = oEl.id; oEl.classList.add('on'); box.style.display = 'block'
  box.innerHTML = rowsHtml.length ? rowsHtml.join('') : '<div class="dh-empty">Không có đơn nào.</div>'
}
function moPheu(gd, list) {
  moDs('dh_pheu_list', $('pheu_' + gd),
    list.map(b => `<div class="dh-row-tac"><b>${escH(b.ma_don)}</b><span>${escH(b.ten_khach)}</span><span>${escH((b.mon_ten || '—'))}${b.so_mon > 1 ? ' +' + (b.so_mon - 1) : ''}</span><span class="hint">${fmt(b.tien)} đ</span></div>`))
}
function veDai(dai) {
  const NG = dai.nguong_tam || 30, pctS = v => v == null ? '—' : (Math.round(v * 1000) / 10).toString().replace('.', ',') + '%'
  const tam = n => n < NG ? `<span class="dh-tam" title="Mẫu nhỏ (${n} đơn) — chưa đủ kết luận">TẠM · n=${n}</span>` : ''
  const o = (lbl, val, n, sub) => `<div class="dh-o"><div class="lbl">${escH(lbl)}</div><div class="big" style="${n < NG ? 'color:#98A2B3' : ''}">${val}</div>${sub ? '<div class="sub">' + escH(sub) + '</div>' : ''}${tam(n)}</div>`
  const s1 = dai.so1_thua_gia, s2 = dai.so2_hoi_den_gia, s3 = dai.so3_chot_theo_treo, s4 = dai.so4_vong_sua, s5 = dai.so5_chot_tu_dung, s6 = dai.so6_theo_sale || []
  const top = s6[0]
  return '<div class="dh-stats">'
    + o('① Thua vì giá', s1 && s1.ti_le != null ? pctS(s1.ti_le) : '—', s1 ? s1.n : 0, s1 ? s1.thua_gia + '/' + s1.tong_thua + ' đơn thua' : '')
    + o('② Hỏi → thấy giá', s2 && s2.trung_vi_ngay != null ? (String(s2.trung_vi_ngay).replace('.', ',') + ' ngày') : '—', s2 ? s2.n : 0, 'trung vị')
    + o('③ Chốt 7·14·25 ngày', s3 ? (pctS(s3.d7) + '·' + pctS(s3.d14) + '·' + pctS(s3.d25)) : '—', s3 ? s3.n : 0, '')
    + o('④ Vòng sửa (có/không NC)', s4 ? ((s4.co_nhu_cau.tb == null ? '—' : s4.co_nhu_cau.tb) + ' / ' + (s4.khong.tb == null ? '—' : s4.khong.tb)) : '—', s4 ? s4.co_nhu_cau.n + s4.khong.n : 0, 'có ghi / không')
    + o('⑤ Chốt tự-dựng/giao-TK', s5 ? (pctS(s5.tu_dung.ti_le) + ' / ' + pctS(s5.giao_tk.ti_le)) : '—', s5 ? s5.tu_dung.n + s5.giao_tk.n : 0, '')
    + o('⑥ Theo sale', top ? (escH(top.sale) + ': ' + pctS(top.ti_le_chot)) : '—', top ? top.n : 0, s6.length > 1 ? '+' + (s6.length - 1) + ' sale' : '')
    + '</div>'
}

// ── QUẢN LÝ TÀI KHOẢN (chỉ ceo — RPC guard fail-đóng; ghi THẲNG DB) ──
const VAI9 = ['sale', 'tk_ban_hang', 'thiet_ke', 'truong_nhom_sale', 'xuong', 'tho', 'kho', 'ke_toan', 'ceo']
const escTk = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
async function taiTaiKhoan() {
  const tb = $('tk_ds'); if (!tb) return
  const { data, error } = await sb.rpc('qly_ds_nguoi_dung')
  if (error) { tb.innerHTML = '<tr><td colspan="5">Lỗi: ' + escTk(error.message) + '</td></tr>'; return }
  tb.innerHTML = (data || []).map(u => {
    const opts = VAI9.map(v => '<option' + (v === u.vai_tro ? ' selected' : '') + '>' + v + '</option>').join('')
    return '<tr' + (u.dang_hoat_dong ? '' : ' style="opacity:.5"') + '>'
      + '<td>' + escTk(u.ho_ten) + '</td><td>' + escTk(u.email) + '</td>'
      + '<td><select data-id="' + u.id + '" class="tk_vai_sel">' + opts + '</select></td>'
      + '<td>' + (u.dang_hoat_dong ? 'Đang hoạt động' : 'Đã tắt') + '</td>'
      + '<td style="white-space:nowrap"><button class="btn ghost tk_bat" data-id="' + u.id + '" data-on="' + (u.dang_hoat_dong ? '0' : '1') + '">' + (u.dang_hoat_dong ? 'Tắt' : 'Bật') + '</button> '
      + '<button class="btn ghost tk_mk" data-id="' + u.id + '">Đặt lại MK</button></td></tr>'
  }).join('') || '<tr><td colspan="5">Chưa có người dùng.</td></tr>'
  document.querySelectorAll('.tk_vai_sel').forEach(s => s.onchange = () => doiVai(s.dataset.id, s.value))
  document.querySelectorAll('.tk_bat').forEach(b => b.onclick = () => batTat(b.dataset.id, b.dataset.on === '1'))
  document.querySelectorAll('.tk_mk').forEach(b => b.onclick = () => datMatKhau(b.dataset.id))
}
async function themNguoi() {
  $('tk_msg').textContent = 'Đang thêm…'
  const { error } = await sb.rpc('qly_them_nguoi', { p_email: $('tk_email').value.trim(), p_ho_ten: $('tk_ten').value.trim(), p_vai: $('tk_vai').value, p_mat_khau: $('tk_mk').value })
  if (error) { $('tk_msg').textContent = 'Lỗi: ' + error.message; return }
  $('tk_msg').textContent = 'Đã thêm ' + $('tk_email').value.trim()
  $('tk_email').value = ''; $('tk_ten').value = ''; $('tk_mk').value = ''
  taiTaiKhoan()
}
async function doiVai(id, vai) {
  const { error } = await sb.rpc('qly_doi_vai', { p_ns_id: id, p_vai: vai })
  $('tk_msg').textContent = error ? ('Lỗi: ' + error.message) : ('Đã đổi vai → ' + vai); if (!error) taiTaiKhoan()
}
async function batTat(id, on) {
  const { error } = await sb.rpc('qly_bat_tat', { p_ns_id: id, p_on: on })
  $('tk_msg').textContent = error ? ('Lỗi: ' + error.message) : (on ? 'Đã bật hoạt động' : 'Đã tắt hoạt động'); if (!error) taiTaiKhoan()
}
async function datMatKhau(id) {
  const mk = prompt('Mật khẩu mới (tối thiểu 6 ký tự):'); if (!mk) return
  const { error } = await sb.rpc('qly_dat_mat_khau', { p_ns_id: id, p_mat_khau: mk })
  $('tk_msg').textContent = error ? ('Lỗi: ' + error.message) : 'Đã đặt lại mật khẩu'
}

// ── Giá vốn theo đơn (nhập tay cho đơn plugin không dựng được) ──
// L-65: gia_von_don_ds nay TRẢ {tong, ds} có PHÂN TRANG (50/trang) — trước quét cả nghìn đơn không limit (nợ L-29).
let GV_TRANG = 0; const GV_CO = 50
async function taiGiaVonDon() {
  const tb = $('gv_ds'), sel = $('gv_don'), pg = $('gv_pager')
  // WP-03: đây là màn NHẬP giá vốn (không phải báo cáo) → gom cả đơn demo để nhập được giá vốn cho đơn DEMO.
  //   5 RPC BÁO CÁO (cm_don_ky, pl_ky…) vẫn giữ lọc demo mặc định (p_gom_demo=false).
  const { data, error } = await sb.rpc('gia_von_don_ds', { p_gioi_han: GV_CO, p_offset: GV_TRANG * GV_CO, p_gom_demo: true })
  if (error) { tb.innerHTML = `<tr><td colspan="8">Lỗi: ${error.message}</td></tr>`; if (pg) pg.innerHTML = ''; return }
  const rows = (data && data.ds) || [], tong = (data && data.tong) || 0
  const nguonNhan = r => r.co_gia_von ? (r.nguon === 'nhap_tay' ? '<b style="color:var(--pri,#C8202E)">[NHẬP TAY]</b>' : 'plugin') : '<span class="hint">chưa có</span>'
  tb.innerHTML = rows.map(r => `<tr${r.co_gia_von ? '' : ' style="background:#FFF7F7"'}><td class="n"><b>${r.ma_don}</b></td><td>${r.trang_thai}</td><td>${nguonNhan(r)}</td><td class="r n">${fmt(r.khoi_1)}</td><td class="r n">${fmt(r.khoi_2)}</td><td class="r n">${fmt(r.khoi_3)}</td><td class="r n"><b>${fmt(r.gia_chuyen_giao)}</b></td><td class="hint">${r.co_gia_von ? [r.nguoi_ten || '', r.cap_nhat_luc ? new Date(r.cap_nhat_luc).toLocaleDateString('vi-VN') : '', r.ly_do || ''].filter(Boolean).join(' · ') : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="hint">Chưa có đơn.</td></tr>'
  // đơn CHƯA có giá vốn -> dropdown nhập tay
  const chua = rows.filter(r => !r.co_gia_von)
  sel.innerHTML = '<option value="">— chọn đơn chưa có giá vốn —</option>' + chua.map(r => `<option>${r.ma_don}</option>`).join('')
  // phân trang (đơn chưa có giá vốn LÊN ĐẦU nên dropdown nhập tay nằm trọn trang 1)
  if (pg) {
    const soTrang = Math.max(1, Math.ceil(tong / GV_CO))
    const tuSo = tong ? GV_TRANG * GV_CO + 1 : 0, denSo = Math.min(tong, (GV_TRANG + 1) * GV_CO)
    pg.innerHTML = `<button id="gv_prev"${GV_TRANG <= 0 ? ' disabled' : ''}>← Trước</button>`
      + `<span>Trang <b>${GV_TRANG + 1}</b>/${soTrang} · dòng ${tuSo}–${denSo} / tổng <b>${tong}</b></span>`
      + `<button id="gv_next"${(GV_TRANG + 1) >= soTrang ? ' disabled' : ''}>Sau →</button>`
    const pv = $('gv_prev'), nx = $('gv_next')
    if (pv) pv.onclick = () => { if (GV_TRANG > 0) { GV_TRANG--; taiGiaVonDon() } }
    if (nx) nx.onclick = () => { if ((GV_TRANG + 1) < soTrang) { GV_TRANG++; taiGiaVonDon() } }
  }
}
async function nhapGiaVonTay() {
  const maDon = $('gv_don').value, ly_do = $('gv_lydo').value.trim()
  const money = id => Number(($(id).value || '').replace(/\D/g, '')) || 0
  const msg = $('gv_msg')
  if (!maDon) { msg.textContent = 'Chọn đơn trước.'; return }
  if (!ly_do) { msg.textContent = 'Phải nhập lý do.'; return }
  msg.textContent = 'Đang ghi…'
  const { error } = await sb.rpc('ghi_gia_von_tay', { ma_don: maDon, khoi_1: money('gv_k1'), khoi_2: money('gv_k2'), khoi_3: money('gv_k3'), ly_do })
  if (error) { msg.textContent = 'Lỗi: ' + error.message; return }
  msg.textContent = '✓ Đã ghi giá vốn tay cho ' + maDon
  ;['gv_k1', 'gv_k2', 'gv_k3', 'gv_lydo'].forEach(id => $(id).value = '')
  taiGiaVonDon()
}

// ══════════ TAB P/L (L-43): pl_ky trả đủ 1 lần, dựng bảng từ dữ liệu RPP thật (không hardcode số) ══════════
async function taiPL() {
  if (!$('pl_tieude')) return
  $('pl_tieude').textContent = 'Kỳ ' + KY
  const body = $('pl_body')
  const { data: pl, error } = await sb.rpc('pl_ky', { p_ky: KY })
  if (error) { body.innerHTML = `<tr><td class="pl-lbl" colspan="11" style="color:#C8202E">${escH(error.message)}</td></tr>`; $('pl_canhbao').style.display = 'none'; $('pl_donlist').style.display = 'none'; return }
  const D = pl.dong, vat = Number(pl.vat)
  const showKhac = Number(D.doanh_thu_thuan.khac || 0) !== 0
  document.querySelectorAll('#tc .pl-colkhac').forEach(e => e.style.display = showKhac ? '' : 'none')
  const cols = ['toan_cty', 'le', 'combo', 'du_an'].concat(showKhac ? ['khac'] : [])
  const pctOf = (v, col) => { const dt = Number(D.doanh_thu_thuan[col]); if (!dt || v == null || isNaN(v)) return null; return v / dt * 100 }
  const pctTxt = x => x == null ? '—' : x.toFixed(1).replace('.', ',')
  const ROWS = [
    ['doanh_thu_thuan', `1. Doanh thu thuần <span class="hint">(đã bóc VAT ${vat}%)</span>`, '', false],
    ['bien_phi', '2. Biến phí', 'pl-hdr', false],
    ['k1', '2a. Giá vốn — vật tư (khối 1)', 'pl-sub2', false],
    ['k2', '2b. Giá vốn — hoạt động (khối 2)', 'pl-sub2', false],
    ['k3', '2c. Giá vốn — cấp đơn (khối 3)', 'pl-sub2', false],
    ['ship_lap', '2d. Ship + lắp thực trả', 'pl-sub2', false],
    ['hoa_hong', '2e. Hoa hồng (sale/quản lý/thiết kế)', 'pl-sub2', false],
    ['so_du_dam_phi', '3. SỐ DƯ ĐẢM PHÍ', 'pl-em', false],
    ['dinh_phi_truy', '4. Định phí truy được theo phân khúc', '', false],
    ['segment_margin', '5. SEGMENT MARGIN', 'pl-em2', false],
    ['dinh_phi_chung', '6. Định phí chung (không rải)', '', true],
    ['lai_thuan', '7. LÃI THUẦN HOẠT ĐỘNG', 'pl-final', true]
  ]
  body.innerHTML = ROWS.map(([k, lbl, cls, onlyToan]) => {
    let tds = `<td class="pl-lbl">${lbl}</td>`
    cols.forEach(col => {
      if (onlyToan && col !== 'toan_cty') { tds += `<td class="pl-num pl-grp pl-dash">—</td><td class="pl-pct pl-dash">—</td>`; return }
      const raw = D[k][col]
      const has = (raw !== undefined && raw !== null)
      const v = has ? Number(raw) : null
      const pv = (k === 'doanh_thu_thuan') ? 100 : pctOf(v, col)
      tds += `<td class="pl-num pl-grp">${has ? fmt(v) : '—'}</td><td class="pl-pct">${has ? pctTxt(pv) : '—'}</td>`
    })
    return `<tr class="${cls}">${tds}</tr>`
  }).join('')
  const n = pl.so_don_thieu_gia_von || 0, wb = $('pl_canhbao'), dl = $('pl_donlist')
  if (n > 0) {
    wb.style.display = 'block'
    wb.innerHTML = `⚠ Kỳ này có <b>${n} đơn đã giao chưa có dòng giá vốn</b> — số giá vốn đang THIẾU, biên lãi có thể cao ảo. <a href="#" id="pl_xemds">Xem danh sách</a>`
    dl.textContent = 'Đơn thiếu: ' + (pl.don_thieu || []).join(', ')
    $('pl_xemds').onclick = e => { e.preventDefault(); dl.style.display = dl.style.display === 'block' ? 'none' : 'block' }
  } else { wb.style.display = 'none'; dl.style.display = 'none' }
  await veNangLucPL()
}

// L-46: khối NĂNG LỰC XƯỞNG dưới bảng P/L (thước TIỀN, Garrison App.3A — số thông tin, KHÔNG trừ lãi)
async function veNangLucPL() {
  const box = $('pl_nangluc'); if (!box) return
  const { data: g, error } = await sb.rpc('lap_day_ky', { p_ky: KY })
  if (error || !g) { box.style.display = 'none'; return }
  box.style.display = 'block'
  const mau = Number(g.mau_so_dung) || 0, bt = Number(g.tien_bo_trong) || 0, boTrong = bt >= 0
  const ty = g.ty_le_lap_day == null ? null : Number(g.ty_le_lap_day) * 100
  const pctBoTrong = mau > 0 ? bt / mau * 100 : 0
  box.classList.toggle('pl-nl-do', boTrong && pctBoTrong > 20)
  box.innerHTML = `<div class="pl-nl-h">Năng lực xưởng${g.chua_chot_tham_so ? ' · <span style="color:var(--am)">chưa chốt tham số (dùng số suy từ lương tổ)</span>' : ''}</div>`
    + `<div class="pl-nl-3">`
    + `<div class="pl-nl-o"><div class="pl-nl-lbl">Chi phí năng lực kỳ</div><div class="pl-nl-big">${fmt(mau)}</div></div>`
    + `<div class="pl-nl-o"><div class="pl-nl-lbl">Lấp đầy</div><div class="pl-nl-big">${ty == null ? '—' : ty.toFixed(1).replace('.', ',') + '%'}</div></div>`
    + `<div class="pl-nl-o"><div class="pl-nl-lbl">${boTrong ? 'Năng lực bỏ trống' : 'Vượt năng lực chuẩn'}</div><div class="pl-nl-big ${boTrong ? '' : 'pl-nl-am'}">${boTrong ? fmt(bt) : '+' + fmt(-bt)}</div></div>`
    + `</div>`
    + `<div class="pl-nl-note">Garrison App.3A — số THÔNG TIN, <b>không trừ vào lãi thuần</b> (lương tổ đã nằm trong giá vốn khối ②, trừ nữa là trùng). Mẫu số = chi phí năng lực kỳ (Sổ tham số); để trống thì suy từ lương tổ.</div>`
}

// L-46: số suy + cảnh báo mềm lệch >10% cho ô chi_phi_nang_luc (Sổ tham số)
async function refreshSuyNangLuc() {
  if (!$('cpnl_suy')) return
  const { data: g, error } = await sb.rpc('lap_day_ky', { p_ky: KY })
  if (error || !g) return
  window.__suyNL = Number(g.so_suy_tu_luong_to) || 0
  $('cpnl_suy').textContent = 'Suy từ lương tổ: ' + fmt(window.__suyNL) + ' đ'
  capNhatCanhBaoNL()
}
function capNhatCanhBaoNL() {
  const el = $('cpnl_canhbao'); if (!el) return
  const suy = window.__suyNL || 0, v = Number(($('cpnl').value || '').replace(/\D/g, '')) || 0
  if (!v || !suy) { el.textContent = ''; return }
  const lech = Math.abs(v - suy) / suy * 100
  if (lech > 10) { el.style.color = 'var(--am)'; el.textContent = `⚠ lệch ${lech.toFixed(0)}% so số suy (${fmt(suy)} đ) — kiểm lại` }
  else { el.style.color = 'var(--gn)'; el.textContent = '≈ khớp số suy' }
}
// L-46: ô "Lấp đầy xưởng" trên tab Điều hành (thêm vào khối Xưởng)
async function veLapDayDH() {
  const box = $('dh_xuong'); if (!box) return
  const { data: g, error } = await sb.rpc('lap_day_ky', { p_ky: KY })
  if (error || !g) return
  const ty = g.ty_le_lap_day == null ? null : Number(g.ty_le_lap_day) * 100
  const bt = Number(g.tien_bo_trong) || 0, boTrong = bt >= 0
  const div = document.createElement('div')
  div.className = 'dh-lapday'
  div.innerHTML = `<div><div class="dh-ld-lbl">Lấp đầy xưởng${g.chua_chot_tham_so ? ' (suy)' : ''}</div><div class="dh-ld-big">${ty == null ? '—' : ty.toFixed(1).replace('.', ',') + '%'}</div></div>`
    + `<div><div class="dh-ld-lbl">${boTrong ? 'Năng lực bỏ trống' : 'Vượt năng lực'}</div><div class="dh-ld-big" style="${boTrong ? '' : 'color:var(--pri)'}">${boTrong ? fmt(bt) : '+' + fmt(-bt)} đ</div></div>`
  box.appendChild(div)
}

// ══════════ TAB CHI PHÍ KỲ (L-43): sổ actuals, tính tổng+tách CHUNG/truy-được sống theo dữ liệu đang nhập ══════════
const CPK_LOAI = [['luong_vp', 'Lương văn phòng'], ['luong_sale', 'Lương sale'], ['marketing_ads', 'Marketing / Ads'],
  ['thue_mat_bang', 'Thuê mặt bằng'], ['khau_hao', 'Khấu hao'], ['dien_nuoc_vh', 'Điện nước / vận hành'], ['khac', 'Khác']]
const CPK_PK = [['', 'CHUNG'], ['le', 'Lẻ'], ['combo', 'Combo'], ['du_an', 'Dự án']]
const escA = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
async function taiChiPhiKy() {
  const tb = $('cpk_rows'); if (!tb) return
  const { data, error } = await sb.rpc('cpk_ds', { p_ky: KY })
  tb.innerHTML = ''
  if (error) { $('cpk_msg').style.color = '#C8202E'; $('cpk_msg').textContent = 'Lỗi: ' + error.message; cpkRecalc(); return }
  $('cpk_msg').textContent = ''
  ;((data && data.ds) || []).forEach(r => cpkAddRow(r))
  cpkRecalc()
}
function cpkAddRow(seed) {
  const tb = $('cpk_rows'); if (!tb) return
  const tr = document.createElement('tr')
  const loaiOpts = CPK_LOAI.map(x => `<option value="${x[0]}"${seed && seed.loai === x[0] ? ' selected' : ''}>${x[1]}</option>`).join('')
  const pkVal = seed ? (seed.phan_khuc || '') : ''
  const pkOpts = CPK_PK.map(p => `<option value="${p[0]}"${p[0] === pkVal ? ' selected' : ''}>${p[1]}</option>`).join('')
  tr.innerHTML = `<td><select class="cpk-loai">${loaiOpts}</select></td>`
    + `<td><input class="cpk-money" inputmode="numeric" placeholder="đ · CHƯA VAT nếu có HĐ" value="${seed ? fmt(seed.so_tien) : ''}"></td>`
    + `<td><select class="cpk-pk">${pkOpts}</select></td>`
    + `<td><input class="cpk-ghichu" value="${seed ? escA(seed.ghi_chu) : ''}"></td>`
    + `<td><input class="cpk-nguoi" value="${seed ? escA(seed.nguoi_nhap) : ''}"></td>`
    + `<td><button class="cpk-del" title="Xoá dòng">×</button></td>`
  tb.appendChild(tr)
  tr.querySelector('.cpk-loai').onchange = cpkRecalc
  tr.querySelector('.cpk-pk').onchange = cpkRecalc
  const mo = tr.querySelector('.cpk-money'); mo.addEventListener('input', () => { fmtMoneyEl(mo); cpkRecalc() })
  tr.querySelector('.cpk-del').onclick = () => { tr.remove(); cpkRecalc() }
}
const cpkTien = tr => Number((tr.querySelector('.cpk-money').value || '').replace(/\D/g, '')) || 0
function cpkRecalc() {
  const rows = [...$('cpk_rows').querySelectorAll('tr')]
  const byLoai = {}; let chung = 0, pk = 0, tot = 0
  rows.forEach(tr => {
    const loai = tr.querySelector('.cpk-loai').value, tien = cpkTien(tr), pkv = tr.querySelector('.cpk-pk').value
    tot += tien; byLoai[loai] = (byLoai[loai] || 0) + tien
    if (pkv === '') chung += tien; else pk += tien
  })
  $('cpk_tot').textContent = fmt(tot); $('cpk_tot2').textContent = fmt(tot); $('cpk_tot3').textContent = fmt(tot)
  $('cpk_byloai').innerHTML = CPK_LOAI.filter(x => byLoai[x[0]]).map(x => `<tr><td class="ten">${x[1]}</td><td class="cpk-n">${fmt(byLoai[x[0]])}</td></tr>`).join('') || '<tr><td class="ten hint">Chưa có dòng</td><td class="cpk-n">0</td></tr>'
  $('cpk_split').innerHTML = `<tr><td class="ten"><span class="cpk-chip chung">CHUNG</span> Định phí chung</td><td class="cpk-n">${fmt(chung)}</td></tr>`
    + `<tr><td class="ten"><span class="cpk-chip pk">PHÂN KHÚC</span> Định phí truy được</td><td class="cpk-n">${fmt(pk)}</td></tr>`
}
async function cpkLuu() {
  const rows = [...$('cpk_rows').querySelectorAll('tr')].map(tr => ({
    loai: tr.querySelector('.cpk-loai').value, so_tien: String(cpkTien(tr)),
    phan_khuc: tr.querySelector('.cpk-pk').value || null,
    ghi_chu: tr.querySelector('.cpk-ghichu').value.trim(), nguoi_nhap: tr.querySelector('.cpk-nguoi').value.trim()
  }))
  $('cpk_msg').style.color = 'var(--mut)'; $('cpk_msg').textContent = 'Đang lưu…'
  const { data, error } = await sb.rpc('cpk_ghi', { p_ky: KY, p_dong: rows })
  if (error) { $('cpk_msg').style.color = '#C8202E'; $('cpk_msg').textContent = 'Lỗi: ' + error.message; return }
  $('cpk_msg').style.color = 'var(--gn)'; $('cpk_msg').textContent = `✓ Đã lưu ${data.so_dong} dòng cho kỳ ${KY}`
}
async function cpkChepKyTruoc() {
  $('cpk_msg').style.color = 'var(--mut)'; $('cpk_msg').textContent = 'Đang chép…'
  const { data, error } = await sb.rpc('cpk_chep_ky_truoc', { p_ky: KY })
  if (error) { $('cpk_msg').style.color = '#C8202E'; $('cpk_msg').textContent = 'Lỗi: ' + error.message; return }
  if (!data.ok) { $('cpk_msg').style.color = 'var(--am)'; $('cpk_msg').textContent = data.msg || 'Không chép được'; return }
  $('cpk_msg').style.color = 'var(--gn)'; $('cpk_msg').textContent = `✓ Chép ${data.so_dong} dòng từ kỳ ${data.ma_ky_truoc}`
  await taiChiPhiKy()
}

// ══════════ TAB LÃI THEO ĐƠN (CM/đơn, L-47b): dữ liệu từ cm_don_ky; KHÔNG tính lại ở client ══════════
let CM_SAP = 'cm_pct.asc', CM_TRANG = 0, CM_MO = -1, CM_DATA = null
const CM_DONG = { le: 'Lẻ', combo: 'Combo', du_an: 'Dự án', khac: 'Khác' }
const CM_NGUON = { quang_cao: 'Quảng cáo', gioi_thieu: 'Giới thiệu', cua_hang: 'Cửa hàng', san_tmdt: 'Sàn TMĐT', khach_cu: 'Khách cũ', khac: 'Khác' }
const cmPct = v => v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + '%'
async function taiCM() {
  if (!$('cmd_tieude')) return
  $('cmd_tieude').textContent = 'Kỳ ' + KY
  const body = $('cmd_body'), foot = $('cmd_foot'), pg = $('cmd_pager')
  const { data: g, error } = await sb.rpc('cm_don_ky', { p_ky: KY, p_trang: CM_TRANG, p_sap: CM_SAP })
  if (error) { body.innerHTML = `<tr><td class="ten" colspan="9" style="color:#C8202E">${escH(error.message)}</td></tr>`; foot.innerHTML = ''; pg.innerHTML = ''; $('cmd_batbien').textContent = ''; $('cmd_tongcm').textContent = '—'; $('cmd_cmtb').textContent = '—'; $('cmd_sodon').textContent = '—'; return }
  CM_DATA = g
  const t = g.tong, hhPct = (Number(g.hh) * 100).toFixed(1).replace(/\.0$/, '').replace('.', ',')
  $('cmd_tongcm').textContent = fmt(t.cm); $('cmd_tongcm').classList.toggle('cmd-am', Number(t.cm) < 0)
  $('cmd_cmtb').textContent = cmPct(t.cm_pct_tb)
  $('cmd_sodon').textContent = t.so_don + (t.so_thieu > 0 ? ' · ' + t.so_thieu + ' chưa trọn' : '')
  const ds = g.ds || []
  if (!ds.length) {
    body.innerHTML = '<tr><td colspan="9"><div class="cmd-trong"><b>Kỳ này chưa có đơn đã giao</b>Đơn vào trạng thái ĐÃ GIAO trong kỳ mới xuất hiện ở đây.</div></td></tr>'
    foot.innerHTML = ''; pg.innerHTML = ''; $('cmd_batbien').textContent = ''; return
  }
  const mtico = c => CM_SAP.split('.')[0] === c ? (CM_SAP.split('.')[1] === 'asc' ? ' ▲' : ' ▼') : ''
  document.querySelectorAll('#tc .cmd-sap').forEach(th => th.textContent = th.textContent.replace(/ [▲▼]$/, '') + mtico(th.dataset.sap))
  body.innerHTML = ds.map((r, i) => {
    const thieu = (r.thieu || []).map(x => `<span class="cmd-nhan-thieu">thiếu ${x}</span>`).join('')
    const amCM = Number(r.cm) < 0 ? ' cmd-am' : ''
    let h = `<tr class="cmd-dong${(r.thieu && r.thieu.length) ? ' cmd-thieu' : ''}" data-i="${i}">`
      + `<td class="cmd-lbl"><span class="cmd-ma">${escH(r.ma_don)}</span>${thieu}<br><span class="cmd-khach">${escH(r.khach || '')}</span></td>`
      + `<td class="cmd-lbl">${CM_DONG[r.dong] || r.dong || '—'}</td>`
      + `<td class="cmd-lbl" style="font-size:12px;color:var(--mut)">${CM_NGUON[r.nguon_khach] || '—'}</td>`
      + `<td class="cmd-num">${fmt(r.dt_thuan)}</td><td class="cmd-num">${fmt(r.gv)}</td>`
      + `<td class="cmd-num">${fmt(r.ship_lap)}</td><td class="cmd-num">${fmt(r.hoa_hong)}</td>`
      + `<td class="cmd-num${amCM}">${fmt(r.cm)}</td><td class="cmd-num${amCM}">${cmPct(r.cm_pct)}</td></tr>`
    if (CM_MO === i) {
      const coGV = !(r.thieu || []).includes('giá vốn'), coSL = !(r.thieu || []).includes('ship/lắp')
      h += `<tr class="cmd-ct"><td colspan="9"><div class="cmd-ct-bang">`
        + `<div class="cmd-r"><span>Giá chốt (gồm VAT ${g.vat}%)</span><span>${fmt(r.gia_chot)}</span></div>`
        + `<div class="cmd-r"><span>Doanh thu thuần (÷ ${(1 + Number(g.vat) / 100).toFixed(2).replace('.', ',')})</span><span>${fmt(r.dt_thuan)}</span></div>`
        + `<div class="cmd-r"><span>− Giá vốn vật tư (k1)</span><span class="cmd-am">${coGV ? fmt(r.k1) : '— thiếu'}</span></div>`
        + `<div class="cmd-r"><span>− Giá vốn hoạt động (k2)</span><span class="cmd-am">${coGV ? fmt(r.k2) : '— thiếu'}</span></div>`
        + `<div class="cmd-r"><span>− Giá vốn cấp đơn (k3)</span><span class="cmd-am">${coGV ? fmt(r.k3) : '— thiếu'}</span></div>`
        + `<div class="cmd-r"><span>− Ship + lắp thực trả</span><span class="cmd-am">${coSL ? fmt(r.ship_lap) : '— thiếu'}</span></div>`
        + `<div class="cmd-r"><span>− Hoa hồng ${hhPct}% × DT thuần</span><span class="cmd-am">${fmt(r.hoa_hong)}</span></div>`
        + `<div class="cmd-r cmd-tong"><span>= CM đơn${(r.thieu && r.thieu.length) ? ' (chưa trọn)' : ''}</span><span class="${Number(r.cm) < 0 ? 'cmd-am' : ''}">${fmt(r.cm)} · ${cmPct(r.cm_pct)}</span></div>`
        + `</div></td></tr>`
    }
    return h
  }).join('')
  foot.innerHTML = `<tr><td class="ten" colspan="3">TỔNG KỲ (${t.so_don} đơn${t.so_thieu > 0 ? ' · ' + t.so_thieu + ' chưa trọn' : ''})</td>`
    + `<td class="cmd-num">${fmt(t.dt)}</td><td class="cmd-num">${fmt(t.gv)}</td><td class="cmd-num">${fmt(t.ship_lap)}</td><td class="cmd-num">${fmt(t.hoa_hong)}</td>`
    + `<td class="cmd-num${Number(t.cm) < 0 ? ' cmd-am' : ''}">${fmt(t.cm)}</td><td class="cmd-num">${cmPct(Number(t.dt) > 0 ? Number(t.cm) / Number(t.dt) * 100 : null)}</td></tr>`
  $('cmd_batbien').innerHTML = `BẤT BIẾN: Σ CM kỳ (${fmt(t.cm)}) <b>= dòng SỐ DƯ ĐẢM PHÍ</b> của P/L kỳ ${KY} (sai số &lt; 1đ) — hai màn một nguồn số.`
  // phân trang
  const soTrang = g.so_trang || 1
  pg.innerHTML = `<button id="cmd_prev"${CM_TRANG <= 0 ? ' disabled' : ''}>← Trước</button>`
    + `<span>Trang <b>${CM_TRANG + 1}</b>/${soTrang} · ${t.so_don} đơn</span>`
    + `<button id="cmd_next"${(CM_TRANG + 1) >= soTrang ? ' disabled' : ''}>Sau →</button>`
  if ($('cmd_prev')) $('cmd_prev').onclick = () => { if (CM_TRANG > 0) { CM_TRANG--; CM_MO = -1; taiCM() } }
  if ($('cmd_next')) $('cmd_next').onclick = () => { if ((CM_TRANG + 1) < soTrang) { CM_TRANG++; CM_MO = -1; taiCM() } }
  body.querySelectorAll('tr.cmd-dong').forEach(tr => tr.onclick = () => { const i = +tr.dataset.i; CM_MO = (CM_MO === i ? -1 : i); taiCM() })
  document.querySelectorAll('#tc .cmd-sap').forEach(th => th.onclick = () => {
    const c = th.dataset.sap, cur = CM_SAP.split('.')
    CM_SAP = (cur[0] === c) ? c + '.' + (cur[1] === 'asc' ? 'desc' : 'asc') : c + '.asc'
    CM_TRANG = 0; CM_MO = -1; taiCM()
  })
}

// ══════════ TAB KÊNH & CAC (L-48): dữ liệu từ kenh_cac_ky; form ads gồm VAT, "thật" bóc theo vat kỳ ══════════
let KC_BRAND = 'all', KC_VAT = 10, KC_BRANDS = {}   // ma→ten brand bật
const KC_KENH = [['quang_cao', 'Quảng cáo'], ['gioi_thieu', 'Giới thiệu'], ['cua_hang', 'Cửa hàng'], ['san_tmdt', 'Sàn TMĐT'], ['khach_cu', 'Khách cũ'], ['khac', 'Khác']]
const KC_KMAP = Object.fromEntries(KC_KENH.concat([['(chưa ghi nguồn)', 'Chưa ghi nguồn']]))
const tenBrand = ma => KC_BRANDS[ma] || (ma === '(chưa ghi TH)' ? '(Chưa ghi thương hiệu)' : ma)
async function napBrandsKC() {
  if (Object.keys(KC_BRANDS).length) return
  const { data } = await sb.from('thuong_hieu_ban').select('ma,ten')
  KC_BRANDS = Object.fromEntries((data || []).map(b => [b.ma, b.ten]))
}
async function taiKenhCac() {
  if (!$('kc_body')) return
  await napBrandsKC()
  const { data: g, error } = await sb.rpc('kenh_cac_ky', { p_ky: KY, p_brand: null })
  const body = $('kc_body'), foot = $('kc_foot')
  if (error) { body.innerHTML = `<tr><td class="kc-lbl" colspan="8" style="color:#C8202E">${escH(error.message)}</td></tr>`; foot.innerHTML = ''; $('kc_brand').innerHTML = ''; $('kc_tongads').textContent = '—'; $('kc_khachmoi').textContent = '—'; $('kc_sauads').textContent = '—'; return }
  KC_VAT = Number(g.vat) || 10
  const all = g.dong || []
  // nút brand + tổng ads thật mỗi brand
  const adsB = {}; all.forEach(r => { adsB[r.brand] = (adsB[r.brand] || 0) + (Number(r.chi_ads_that) || 0) })
  const brandMa = [...new Set(all.map(r => r.brand))].filter(b => b !== '(chưa ghi TH)')
  let hb = `<button class="${KC_BRAND === 'all' ? 'kc-chon' : ''}" data-b="all">Tất cả</button>`
  brandMa.forEach(b => hb += `<button class="${KC_BRAND === b ? 'kc-chon' : ''}" data-b="${b}">${escH(tenBrand(b))}<span class="kc-n">${fmt(adsB[b] || 0)}</span></button>`)
  $('kc_brand').innerHTML = hb
  $('kc_brand').querySelectorAll('button').forEach(bt => bt.onclick = () => { KC_BRAND = bt.dataset.b; taiKenhCac() })
  $('kc_tieude').textContent = 'Hiệu quả kênh — ' + (KC_BRAND === 'all' ? 'Tất cả thương hiệu' : tenBrand(KC_BRAND))
  // lọc theo brand
  const loc = KC_BRAND === 'all' ? all : all.filter(r => r.brand === KC_BRAND)
  const hangKenh = r => {
    const ads = Number(r.chi_ads_that) || 0
    const cacTxt = r.cac == null ? (r.vo_han ? '∞' : '—') : fmt(r.cac) + (r.mau_mong ? ' *' : '')
    const sauCls = Number(r.cm_sau_ads) < 0 ? 'kc-xau' : (ads > 0 ? 'kc-tot' : '')
    return `<tr><td class="kc-lbl">${KC_KMAP[r.kenh] || r.kenh}${ads > 0 ? '' : '<span class="kc-phu">khách tự đến</span>'}</td>`
      + `<td class="kc-num">${r.don_giao}</td><td class="kc-num">${r.khach_moi_brand}</td>`
      + `<td class="kc-num kc-ads">${ads ? fmt(ads) : '—'}</td>`
      + `<td class="kc-num kc-ads${r.mau_mong ? ' kc-im' : ''}">${cacTxt}</td>`
      + `<td class="kc-num">${fmt(r.dt_thuan)}</td><td class="kc-num">${fmt(r.cm_kenh)}</td>`
      + `<td class="kc-num ${sauCls}">${fmt(r.cm_sau_ads)}</td></tr>`
  }
  let h = ''
  if (!loc.length) h = '<tr><td colspan="8" class="hint" style="padding:36px;text-align:center">Kỳ này chưa có đơn giao / chi ads.</td></tr>'
  else if (KC_BRAND === 'all') {
    [...new Set(loc.map(r => r.brand))].forEach(b => {
      h += `<tr class="kc-nhom"><td colspan="8">${escH(tenBrand(b).toUpperCase())}</td></tr>`
      loc.filter(r => r.brand === b).forEach(r => h += hangKenh(r))
    })
  } else loc.forEach(r => h += hangKenh(r))
  body.innerHTML = h
  // tổng theo lọc
  const T = loc.reduce((a, r) => ({ ads: a.ads + (Number(r.chi_ads_that) || 0), moi: a.moi + r.khach_moi_brand, don: a.don + r.don_giao, dt: a.dt + Number(r.dt_thuan), cm: a.cm + Number(r.cm_kenh), sau: a.sau + Number(r.cm_sau_ads) }), { ads: 0, moi: 0, don: 0, dt: 0, cm: 0, sau: 0 })
  foot.innerHTML = loc.length ? `<tr><td class="kc-lbl">TỔNG${KC_BRAND !== 'all' ? '' : ' (tất cả)'}</td><td class="kc-num">${T.don}</td><td class="kc-num">${T.moi}</td><td class="kc-num kc-ads">${fmt(T.ads)}</td><td class="kc-num kc-ads">—</td><td class="kc-num">${fmt(T.dt)}</td><td class="kc-num">${fmt(T.cm)}</td><td class="kc-num ${T.sau < 0 ? 'kc-xau' : ''}">${fmt(T.sau)}</td></tr>` : ''
  $('kc_tongads').textContent = fmt(T.ads); $('kc_khachmoi').textContent = T.moi
  $('kc_sauads').textContent = fmt(T.sau); $('kc_sauads').style.color = T.sau < 0 ? 'var(--pri)' : ''
  await taiAdsForm()
}
async function taiAdsForm() {
  const box = $('kc_rows'); if (!box) return
  const { data, error } = await sb.rpc('ads_ds', { p_ky: KY })
  box.innerHTML = ''
  if (error) { $('kc_msg').style.color = '#C8202E'; $('kc_msg').textContent = 'Lỗi: ' + error.message; return }
  $('kc_msg').textContent = ''
  ;((data && data.ds) || []).forEach(r => kcAddRow(r))
}
function kcAddRow(seed) {
  const box = $('kc_rows'); if (!box) return
  const div = document.createElement('div'); div.className = 'kc-form-hang'
  const bOpts = Object.entries(KC_BRANDS).map(([m, t]) => `<option value="${m}"${seed && seed.thuong_hieu === m ? ' selected' : ''}>${escH(t)}</option>`).join('')
  const kOpts = KC_KENH.map(([m, t]) => `<option value="${m}"${seed && seed.kenh === m ? ' selected' : ''}>${t}</option>`).join('')
  div.innerHTML = `<select class="kc-th">${bOpts}</select><select class="kc-k">${kOpts}</select>`
    + `<div><input class="kc-tien money" inputmode="numeric" min="0" placeholder="đ · GỒM VAT" value="${seed ? fmt(seed.so_tien_nhap) : ''}"><div class="kc-that"></div></div>`
    + `<input class="kc-ghi" value="${seed ? escA(seed.ghi_chu) : ''}"><input class="kc-ng" value="${seed ? escA(seed.nguoi_nhap) : ''}">`
    + `<button class="kc-del" title="Xoá">×</button>`
  box.appendChild(div)
  const mo = div.querySelector('.kc-tien'); const veThat = () => { const v = Number((mo.value || '').replace(/\D/g, '')) || 0; div.querySelector('.kc-that').textContent = v ? 'thật: ' + fmt(v / (1 + KC_VAT / 100)) : '' }
  mo.addEventListener('input', () => { fmtMoneyEl(mo); veThat() }); veThat()
  div.querySelector('.kc-del').onclick = () => div.remove()
}
async function kcLuu() {
  const rows = [...$('kc_rows').querySelectorAll('.kc-form-hang')].filter(d => d.querySelector('.kc-th')).map(d => ({
    thuong_hieu: d.querySelector('.kc-th').value, kenh: d.querySelector('.kc-k').value,
    so_tien_nhap: String(Number((d.querySelector('.kc-tien').value || '').replace(/\D/g, '')) || 0),
    ghi_chu: d.querySelector('.kc-ghi').value.trim(), nguoi_nhap: d.querySelector('.kc-ng').value.trim()
  }))
  $('kc_msg').style.color = 'var(--mut)'; $('kc_msg').textContent = 'Đang lưu…'
  const { data, error } = await sb.rpc('ads_ghi', { p_ky: KY, p_dong: rows })
  if (error) { $('kc_msg').style.color = '#C8202E'; $('kc_msg').textContent = 'Lỗi: ' + error.message; return }
  $('kc_msg').style.color = 'var(--gn)'; $('kc_msg').textContent = `✓ Đã lưu ${data.so_dong} dòng ads cho kỳ ${KY}`
  await taiKenhCac()
}

// ══════════ TAB DÒNG TIỀN (L-49): dong_tien_ky + con_phai_thu; forms phiếu thu/COD/vốn/quỹ ══════════
let DT_TRANG = 1, DT_SOTRANG = 1
const DT_THU_L = [['coc', 'Cọc đơn mới chốt', 'tiền về trước khi sản xuất'], ['thu_khi_giao', 'Thu khi giao', 'phần còn lại lúc lắp xong'],
  ['doi_soat_cod', 'Đối soát COD về', 'nhà vận chuyển trả đợt trong kỳ'], ['thu_no', 'Thu nợ kỳ trước', 'đơn đã giao các kỳ trước']]
const DT_CHI_L = [['chi_phi_ky', 'Chi phí kỳ', 'sổ chi_phi_ky: lương VP, thuê, điện nước…'], ['chi_ads', 'Chi quảng cáo', 'sổ chi_ads (số gồm VAT — tiền thật chi ra)'],
  ['luong_to', 'Lương tổ sản xuất', 'sổ luong_to (lương + BH, chưa gồm overhead)']]
const DT_VON_L = { vay_moi: 'Vay ngân hàng mới', tra_goc_vay: 'Trả gốc vay', mua_tai_san: 'Mua tài sản', ban_tai_san: 'Bán tài sản', gop_von: 'Góp vốn', rut_von: 'Rút vốn' }
const dmy = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '—'
async function taiDongTien() {
  // L-52: prefill ngày hôm nay cho các ô date còn trống (đỡ quên) — không đè ô người đã nhập
  const hnay = new Date().toISOString().slice(0, 10)
  ;['pt_ngay', 'cg_ngay', 'ch_ngay', 'vn_ngay'].forEach(id => { const e = $(id); if (e && !e.value) e.value = hnay })
  const { data: g, error } = await sb.rpc('dong_tien_ky', { p_ky: KY })
  if (error) { $('dt_thu_body').innerHTML = `<tr><td class="dt-l" style="color:#C8202E">Lỗi: ${escH(error.message)}</td></tr>`; return }
  const n = (x) => Number(x) || 0
  // tóm tắt
  $('dt_thu').textContent = fmt(g.thu.tong); $('dt_chi').textContent = fmt(g.chi.tong)
  const rong = n(g.rong_kd); $('dt_rong').textContent = (rong >= 0 ? '+' : '') + fmt(rong); $('dt_rong').style.color = rong >= 0 ? 'var(--gn)' : 'var(--pri)'
  $('dt_ncvc').textContent = fmt(g.o_nha_vc.tong)
  // KHỐI 1 — thu
  let sp = 0
  $('dt_thu_body').innerHTML = DT_THU_L.map(([k, ten, phu]) => {
    const r = (g.thu.theo_loai || {})[k]; const cnt = r ? n(r.so_phieu) : 0; sp += cnt
    const sc = (k === 'doi_soat_cod' && r) ? `${n(r.so_dot)} đợt · ${n(r.so_don)} đơn` : cnt
    return `<tr><td class="dt-l">${ten}<span class="dt-phu">${phu}</span></td><td>${sc}</td><td>${fmt(r ? r.so_tien : 0)}</td></tr>`
  }).join('')
  $('dt_thu_foot').innerHTML = `<tr><td class="dt-l">TỔNG THU</td><td>${sp}</td><td>${fmt(g.thu.tong)}</td></tr>`
  $('dt_thu_cb').innerHTML = g.canh_bao.so_don > 0
    ? `<div class="dt-canhbao">⚠ ${g.canh_bao.so_don} đơn đã giao trong kỳ <b>chưa có phiếu thu nào</b> — quên ghi hay chưa đòi được?</div>` : ''
  // KHỐI 2 — chi
  $('dt_chi_body').innerHTML = DT_CHI_L.map(([k, ten, phu]) => `<tr><td class="dt-l">${ten}<span class="dt-phu">${phu}</span></td><td>${fmt(g.chi.theo_so[k])}</td></tr>`).join('')
  $('dt_chi_foot').innerHTML = `<tr><td class="dt-l">TỔNG CHI</td><td>${fmt(g.chi.tong)}</td></tr>`
  // KHỐI 3 — ở nhà VC
  $('dt_vc_tieude').textContent = `Tiền ở nhà vận chuyển — ${fmt(g.o_nha_vc.tong)} đ (${g.o_nha_vc.so_don} đơn đang giao)`
  const vc = g.o_nha_vc.ds || []
  $('dt_vc_body').innerHTML = vc.length ? vc.map(x => `<tr><td class="dt-l"><b>${escH(x.ma_don)}</b><span class="dt-phu">${escH(x.khach || '')}${x.dong ? ' · ' + escH(x.dong) : ''}</span></td>`
    + `<td class="dt-l">${escH(x.don_vi_vc || '—')}</td><td>${fmt(x.so_tien_thu_ho)}</td><td>${dmy(x.ngay_xuat)}</td>`
    + `<td${x.qua_14 ? ' class="dt-do"' : ''}>${x.tuoi} ngày${x.qua_14 ? ' ⚠' : ''}</td></tr>`).join('')
    : '<tr><td class="dt-l" style="color:var(--mut)">Không có đơn COD đang giao</td></tr>'
  $('dt_vc_hoan').innerHTML = g.o_nha_vc.hoan.so_don > 0
    ? `<div class="dt-canhbao">⚠ Hoàn trong kỳ: <b>${g.o_nha_vc.hoan.so_don} đơn · ${fmt(g.o_nha_vc.hoan.so_tien)} không về</b> — hàng quay lại xưởng, phí ship đã trừ vào đối soát.</div>` : ''
  // KHỐI 6 — vốn
  const von = g.ngoai_kd.ds || []
  $('dt_von_body').innerHTML = von.length ? von.map(x => `<tr><td class="dt-l">${escH(DT_VON_L[x.loai] || x.loai)}${x.ghi_chu ? '<span class="dt-phu">' + escH(x.ghi_chu) + '</span>' : ''}</td>`
    + `<td>${dmy(x.ngay)}</td><td>${n(x.vao) ? fmt(x.vao) : '—'}</td><td>${n(x.ra) ? fmt(x.ra) : '—'}</td>`
    + `<td><button class="cpk-del" data-von="${x.id}" title="Xoá">×</button></td></tr>`).join('')
    : '<tr><td class="dt-l" style="color:var(--mut)">Chưa có giao dịch vốn trong kỳ</td></tr>'
  const rn = n(g.ngoai_kd.rong)
  $('dt_von_foot').innerHTML = `<tr><td class="dt-l">RÒNG NGOÀI KINH DOANH</td><td colspan="3">${(rn >= 0 ? '+' : '') + fmt(rn)}</td><td></td></tr>`
  $('dt_von_body').querySelectorAll('button[data-von]').forEach(b => b.onclick = () => vonXoa(b.dataset.von))
  // KHỐI 7 — quỹ
  const qy = g.quy
  $('dt_quy').innerHTML = `<div class="dt-qb">Quỹ đầu kỳ<br><b>${fmt(qy.dau_ky)}</b></div>`
    + `<div class="dt-qo">+ ròng KD <b style="color:${n(qy.rong_kd) >= 0 ? 'var(--gn)' : 'var(--pri)'}">${fmt(qy.rong_kd)}</b></div>`
    + `<div class="dt-qo">+ ròng ngoài KD <b>${fmt(qy.rong_ngoai)}</b></div>`
    + `<div class="dt-qe">= Quỹ cuối kỳ<br><b>${fmt(qy.cuoi_ky)}</b></div>`
  $('dt_quy_note').innerHTML = qy.da_luu
    ? `Quỹ đầu kỳ đã nhập tay. Gợi ý từ kỳ trước: ${fmt(qy.goi_y)} đ. Sửa được — sửa là phải ghi lý do.`
    : `Quỹ đầu kỳ CHƯA nhập — đang dùng gợi ý = quỹ cuối kỳ trước (${fmt(qy.goi_y)} đ). Nhập tay để chốt (ô "Quỹ đầu kỳ" bên dưới).`
  $('qy_tien').value = qy.da_luu ? fmt(qy.dau_ky) : ''
  DT_TRANG = 1; await taiConPhaiThu()
}
async function taiConPhaiThu() {
  const { data: g, error } = await sb.rpc('con_phai_thu', { p_trang: DT_TRANG })
  if (error) { $('dt_no_body').innerHTML = `<tr><td class="dt-l" style="color:#C8202E">Lỗi: ${escH(error.message)}</td></tr>`; return }
  DT_SOTRANG = g.so_trang
  $('dt_no_tieude').textContent = `Còn phải thu (khách nợ thật) — ${fmt(g.tong)} đ (${g.so_don} đơn)`
  const b = g.bac, w = x => Math.max(Number(x.tien) || 0, 1)
  $('dt_no_tuoi').innerHTML = `<div style="flex:${w(b.bac1)};background:#4E9E6E">${b.bac1.nhan}<span class="dt-s">${fmt(b.bac1.tien)} · ${b.bac1.so_don} đơn</span></div>`
    + `<div style="flex:${w(b.bac2)};background:#C99A3B">${b.bac2.nhan}<span class="dt-s">${fmt(b.bac2.tien)} · ${b.bac2.so_don} đơn</span></div>`
    + `<div style="flex:${w(b.bac3)};background:#C8202E">${b.bac3.nhan}<span class="dt-s">${fmt(b.bac3.tien)} · ${b.bac3.so_don} đơn</span></div>`
  const ds = g.dong || []
  $('dt_no_body').innerHTML = ds.length ? ds.map(x => `<tr><td class="dt-l"><b>${escH(x.ma_don)}</b><span class="dt-phu">${escH(x.khach || '')}${x.dong ? ' · ' + escH(x.dong) : ''}</span></td>`
    + `<td>${fmt(x.gia)}</td><td>${fmt(x.da_thu)}</td><td>${fmt(x.con_lai)}</td>`
    + `<td${x.tuoi > 60 ? ' class="dt-do"' : ''}>${x.tuoi} ngày</td></tr>`).join('')
    : '<tr><td class="dt-l" style="color:var(--mut)">Không có khách nợ</td></tr>'
  $('dt_no_trang').textContent = `Trang ${g.trang}/${DT_SOTRANG}`
}
const dtNum = id => String(Number(($(id).value || '').replace(/\D/g, '')) || 0)
async function dtRpc(msgId, fn, args, reload = true) {
  $(msgId).style.color = 'var(--mut)'; $(msgId).textContent = 'Đang ghi…'
  const { error } = await sb.rpc(fn, args)
  if (error) { $(msgId).style.color = '#C8202E'; $(msgId).textContent = 'Lỗi: ' + error.message; return false }
  $(msgId).style.color = 'var(--gn)'; $(msgId).textContent = '✓ Đã ghi'
  if (reload) await taiDongTien()
  return true
}
async function ptLuu() {
  const ma = $('pt_ma').value.trim(); if (!ma) { $('pt_msg').style.color = '#C8202E'; $('pt_msg').textContent = 'Thiếu mã đơn'; return }
  const okr = await dtRpc('pt_msg', 'pt_ghi', { p_phieu: { ma_don: ma, ngay: $('pt_ngay').value || null, so_tien: dtNum('pt_tien'), loai: $('pt_loai').value, ghi_chu: $('pt_gc').value.trim() } })
  if (okr) { $('pt_ma').value = ''; $('pt_tien').value = ''; $('pt_gc').value = '' }
}
async function cgLuu() {
  const ma = $('cg_ma').value.trim(); if (!ma) { $('cg_msg').style.color = '#C8202E'; $('cg_msg').textContent = 'Thiếu mã đơn'; return }
  const okr = await dtRpc('cg_msg', 'cod_ghi', { p_dong: { ma_don: ma, ngay_xuat: $('cg_ngay').value || null, so_tien_thu_ho: dtNum('cg_tien'), don_vi_vc: $('cg_vc').value.trim() } })
  if (okr) { $('cg_ma').value = ''; $('cg_tien').value = ''; $('cg_vc').value = '' }
}
async function chLuu() {
  const ma = $('ch_ma').value.trim(); if (!ma) { $('ch_msg').style.color = '#C8202E'; $('ch_msg').textContent = 'Thiếu mã đơn'; return }
  const okr = await dtRpc('ch_msg', 'cod_hoan', { p_don: ma, p_ngay: $('ch_ngay').value || null, p_ghi_chu: $('ch_gc').value.trim() || null })
  if (okr) { $('ch_ma').value = ''; $('ch_gc').value = '' }
}
async function csLuu() {
  const dot = $('cs_txt').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const p = l.split(/[,;\t]/).map(s => s.trim())
    return { ma_don: p[0], so_tien: String(Number((p[1] || '').replace(/\D/g, '')) || 0), ngay: p[2] || null }
  })
  if (!dot.length) { $('cs_msg').style.color = '#C8202E'; $('cs_msg').textContent = 'Chưa dán dòng nào'; return }
  const okr = await dtRpc('cs_msg', 'cod_doi_soat', { p_dot: dot })
  if (okr) { $('cs_msg').textContent = `✓ Đối soát ${dot.length} đơn`; $('cs_txt').value = '' }
}
async function vnLuu() {
  const okr = await dtRpc('vn_msg', 'von_ghi', { p_gd: { ngay: $('vn_ngay').value || null, loai: $('vn_loai').value, so_tien: dtNum('vn_tien'), ghi_chu: $('vn_gc').value.trim() } })
  if (okr) { $('vn_tien').value = ''; $('vn_gc').value = '' }
}
async function vonXoa(id) { await sb.rpc('von_xoa', { p_id: Number(id) }); await taiDongTien() }
async function qyLuu() {
  await dtRpc('qy_msg', 'quy_ghi', { p_ky: KY, p_so_tien: dtNum('qy_tien'), p_ly_do: $('qy_gc').value.trim() || null })
}

// ══════════ TAB NHẬN XÉT THEO LUẬT (L-50): nhan_xet_ky (meta-màn, Σ 6 RPC nguồn); bảng ngưỡng sửa tại chỗ ══════════
const NX_MUC = { canh_bao: ['CẢNH BÁO', 'canh'], dang_soi: ['ĐÁNG SOI', 'soi'], on: ['ỔN', 'tot'] }
// mỗi dòng ngưỡng: [luật, mô tả, [ô giá trị], [ô mẫu tối thiểu]] · ô = {key, suffix}
const NX_NGUONG = [
  ['2 · k3 ăn dòng lẻ', 'k3 / DT lẻ vượt', [{ k: 'nguong_k3_le', s: '%' }], [{ k: 'mau_toi_thieu_don', s: 'đơn trọn' }]],
  ['3 · kênh yếu', 'CM% kênh thấp hơn TB', [{ k: 'nguong_kenh_yeu', s: 'điểm %' }], [{ k: 'mau_toi_thieu_khach', s: 'khách mới' }]],
  ['5 · xưởng trống / kín', 'lấp đầy ngoài dải', [{ k: 'nguong_lap_day_thap', s: '' }, { k: 'nguong_lap_day_cao', s: '%' }], []],
  ['6 · nợ già', 'nợ >60ng / DT kỳ vượt', [{ k: 'nguong_no_gia', s: '%' }], []],
  ['8 · lãi mà hụt tiền', 'ròng âm vượt', [{ k: 'nguong_lai_hut_tien', s: 'tr' }], []]
]
async function taiNhanXet() {
  const box = $('nx_list'); if (!box) return
  const { data: g, error } = await sb.rpc('nhan_xet_ky', { p_ky: KY })
  if (error) { box.innerHTML = `<div class="hint" style="color:#C8202E">Lỗi: ${escH(error.message)}</div>`; return }
  $('nx_canh').textContent = g.dem.canh_bao; $('nx_soi').textContent = g.dem.dang_soi; $('nx_im').textContent = g.dem.im_lang
  const items = g.nhan_xet || []
  box.innerHTML = items.length ? items.map(x => {
    const [nhan, cls] = NX_MUC[x.muc] || ['', '']
    return `<div class="nx-item ${cls}"><div class="nx-dau"><span class="nx-bam">${nhan}</span>`
      + `<div class="nx-cau">${escH(x.cau)}${x.cau_hoi ? `<span class="nx-hoi">${escH(x.cau_hoi)}</span>` : ''}</div></div>`
      + (x.bang_chung ? `<div class="nx-bang-chung">${escH(x.bang_chung)}</div>` : '')
      + `<div class="nx-can-cu"${x.bang_chung ? '' : ' style="padding-top:6px"'}>${escH(x.can_cu)}</div></div>`
  }).join('') : '<div class="nx-item tot"><div class="nx-dau"><span class="nx-bam">ỔN</span><div class="nx-cau">Không luật nào chạm ngưỡng kỳ này.</div></div></div>'
  // khối im lặng
  const ims = g.im_lang || []
  $('nx_imbox').innerHTML = ims.length
    ? `<div class="nx-im">🤫 <b>Im lặng vì mẫu mỏng / chưa đủ số</b> — ${ims.map(x => `Luật ${escH(x.luat.replace('L', ''))}: ${escH(x.ly_do)}`).join(' · ')} Mẫu mỏng nói bừa còn hại hơn im — luật tự câm cho tới khi đủ số.</div>`
    : ''
  // bảng ngưỡng
  const md = new Set(g.nguong_mac_dinh || [])
  const inp = o => `<input data-k="${o.k}" inputmode="numeric" min="0" placeholder="${g.nguong[o.k] ?? ''}" title="Để trống = dùng mặc định (${g.nguong[o.k] ?? ''} ${o.s})" value="${md.has(o.k) ? '' : (g.nguong[o.k] ?? '')}">${md.has(o.k) ? '<span class="nx-ng-md" title="đang dùng mặc định">◆</span>' : ''} ${o.s}`
  $('nx_ng_body').innerHTML = NX_NGUONG.map(([ten, mota, vals, maus]) =>
    `<tr><td>${escH(ten)}</td><td class="hint">${escH(mota)}</td>`
    + `<td class="nx-r">${vals.map((o, i) => (i ? '– ' : '') + inp(o)).join('')}</td>`
    + `<td class="nx-r">${maus.length ? maus.map(inp).join('') : '—'}</td></tr>`).join('')
}
async function nxNguongLuu() {
  const body = {}; $('nx_ng_body').querySelectorAll('input[data-k]').forEach(i => { const v = i.value.trim(); if (v !== '') body[i.dataset.k] = v })
  $('nx_ng_msg').style.color = 'var(--mut)'; $('nx_ng_msg').textContent = 'Đang lưu…'
  const { error } = await sb.rpc('nguong_ghi', { p_ky: KY, p_nguong: body })
  if (error) { $('nx_ng_msg').style.color = '#C8202E'; $('nx_ng_msg').textContent = 'Lỗi: ' + error.message; return }
  $('nx_ng_msg').style.color = 'var(--gn)'; $('nx_ng_msg').textContent = `✓ Đã lưu ngưỡng cho kỳ ${KY} (áp từ kỳ này, kỳ cũ giữ nguyên)`
  await taiNhanXet()
}

// ══════════ TAB HƯỚNG DẪN (L-52): render docs/huong_dan_taichinh.md (mini-markdown, mọi vai đọc) ══════════
let HD_DONE = false
const hdInline = s => escH(s)   // escape TRƯỚC
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
function taiHuongDan() {
  if (HD_DONE) return   // tài liệu tĩnh — render 1 lần
  const box = $('hd_doc'); if (!box) return
  const lines = HD_MD.split('\n'); let html = '', i = 0, para = []
  const flushP = () => { if (para.length) { html += `<p>${para.join(' ')}</p>`; para = [] } }
  const cell = c => c.trim().replace(/^:?-+:?$/, '')   // bỏ dòng phân cách bảng
  while (i < lines.length) {
    const ln = lines[i]
    if (/^\s*#{1,3}\s/.test(ln)) { flushP(); const lv = ln.match(/^#+/)[0].length; html += `<h${lv}>${hdInline(ln.replace(/^#+\s*/, ''))}</h${lv}>` }
    else if (/^\s*>/.test(ln)) { flushP(); let bq = []; while (i < lines.length && /^\s*>/.test(lines[i])) { bq.push(hdInline(lines[i].replace(/^\s*>\s?/, ''))); i++ } html += `<blockquote>${bq.join('<br>')}</blockquote>`; continue }
    else if (/^\s*\|.*\|/.test(ln)) {   // bảng: dòng | ... |
      flushP(); const rows = []; while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) { rows.push(lines[i]); i++ }
      const parse = r => r.trim().replace(/^\||\|$/g, '').split('|').map(cell)
      const head = parse(rows[0]); const body = rows.slice(rows[1] && /^[\s|:-]+$/.test(rows[1]) ? 2 : 1)
      html += `<div class="hd-tbl-wrap"><table><thead><tr>${head.map(h => `<th>${hdInline(h)}</th>`).join('')}</tr></thead><tbody>`
        + body.map(r => `<tr>${parse(r).map(c => `<td>${hdInline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>'
      continue
    }
    else if (/^\s*[-*]\s/.test(ln)) { flushP(); let items = []; while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) { items.push(`<li>${hdInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`); i++ } html += `<ul>${items.join('')}</ul>`; continue }
    else if (/^\s*---+\s*$/.test(ln)) { flushP(); html += '<hr>' }
    else if (/^\s*$/.test(ln)) { flushP() }
    else para.push(hdInline(ln.trim()))
    i++
  }
  flushP(); box.innerHTML = html; HD_DONE = true
}

// ── Badge TẠM/ĐÃ CHỐT theo TỪNG tham số (bảng trang_thai_tham_so) ──
let BADGE = {}   // ten_tham_so -> trang_thai
async function taiBadges() {
  const { data } = await sb.from('trang_thai_tham_so').select('ten_tham_so,trang_thai').eq('ma_ky', KY)
  BADGE = {}; (data || []).forEach(r => BADGE[r.ten_tham_so] = r.trang_thai)
  document.querySelectorAll('#tc .tag[data-param]').forEach(el => veBadge(el, BADGE[el.dataset.param] || 'tam'))
}
function veBadge(el, tt) {
  el.textContent = tt === 'da_chot' ? 'ĐÃ CHỐT' : 'TẠM'
  el.className = 'tag ' + (tt === 'da_chot' ? 'chot' : 'tam')
  el.title = 'Bấm để chuyển ' + (tt === 'da_chot' ? '→ TẠM' : '→ ĐÃ CHỐT')
}
async function toggleBadge(param) {
  const moi = (BADGE[param] === 'da_chot') ? 'tam' : 'da_chot'
  const el = document.querySelector(`#tc .tag[data-param="${param}"]`)
  const { error } = await sb.rpc('dat_trang_thai_tham_so', { p_ma_ky: KY, p_ten: param, p_trang_thai: moi })
  if (error) { if (el) el.title = 'Lỗi: ' + error.message; return }
  BADGE[param] = moi; if (el) veBadge(el, moi)
}

async function loadKy() {
  KY = $('ky').value; $('ky_chot').textContent = KY
  const { data } = await sb.from('tham_so_tai_chinh').select('*').eq('ma_ky', KY).maybeSingle()
  const t = data || {}
  setMoney('dt', t.dt_muc_tieu); $('sodon').value = t.so_don_ke_hoach ?? ''
  $('vat').value = t.vat ?? ''; $('hhs').value = t.hh_sale ?? ''; $('hhq').value = t.hh_quan_ly ?? ''; $('hht').value = t.hh_thiet_ke ?? ''
  setMoney('phile', t.phi_don_le); setMoney('phicombo', t.phi_don_combo); setMoney('phitk', t.phi_don_thiet_ke)
  setMoney('cpnl', t.chi_phi_nang_luc)   // L-46: chi phí năng lực xưởng (để trống = dùng số suy)
  $('transale').value = t.tran_sale ?? ''; $('trantn').value = t.tran_truong_nhom ?? ''; $('ghichu').value = t.ghi_chu ?? ''
  await taiBadges()   // badge TẠM/ĐÃ CHỐT theo từng tham số (thay 1 cột ghi_chu chung)
  await refreshHeSoM(); await refreshBang(); await refreshQuick(); await refreshChotInfo()
  await taiS6().catch(e => { const m = $('s6_msg'); if (m) { m.style.color = '#C8202E'; m.textContent = 'Lỗi tải màn C: ' + (e.message || e) } })  // xưởng hỏng KHÔNG kéo màn cũ
  await refreshSuyNangLuc().catch(() => {})   // L-46: số suy năng lực cho ô tham số
  // L-43: đổi kỳ → nạp lại P/L + Chi phí kỳ NẾU tab đang mở (đổi kỳ = đổi ngữ cảnh, bỏ chỉnh sửa chi phí chưa lưu)
  if ($('tab-pl') && $('tab-pl').classList.contains('on')) await taiPL()
  if ($('tab-cmdon') && $('tab-cmdon').classList.contains('on')) { CM_TRANG = 0; CM_MO = -1; await taiCM() }
  if ($('tab-kenhcac') && $('tab-kenhcac').classList.contains('on')) { KC_BRAND = 'all'; await taiKenhCac() }
  if ($('tab-dongtien') && $('tab-dongtien').classList.contains('on')) { DT_TRANG = 1; await taiDongTien() }
  if ($('tab-nhanxet') && $('tab-nhanxet').classList.contains('on')) await taiNhanXet()
  if ($('tab-chiphi') && $('tab-chiphi').classList.contains('on')) await taiChiPhiKy()
}

// ① Lưu
async function luuKy() {
  const row = {
    dt_muc_tieu: money('dt'), so_don_ke_hoach: numv('sodon'), vat: numv('vat'),
    hh_sale: numv('hhs'), hh_quan_ly: numv('hhq'), hh_thiet_ke: numv('hht'),
    phi_don_le: money('phile'), phi_don_combo: money('phicombo'), phi_don_thiet_ke: money('phitk'),
    chi_phi_nang_luc: (($('cpnl').value || '').replace(/\D/g, '') || null) && Number($('cpnl').value.replace(/\D/g, '')),   // L-46: trống = NULL (dùng số suy)
    tran_sale: numv('transale'), tran_truong_nhom: numv('trantn'), ghi_chu: $('ghichu').value
  }
  const { error } = await sb.from('tham_so_tai_chinh').update(row).eq('ma_ky', KY)
  $('luu_msg').textContent = error ? ('❌ ' + error.message) : '✅ đã lưu — hệ số & bảng giá tính lại theo số mới'
  if (!error) { await refreshHeSoM(); await refreshBang(); await refreshQuick() }
}

// ② he_so_m
async function refreshHeSoM() {
  const { data, error } = await sb.rpc('tinh_he_so_m', { p_ma_ky: KY })
  const box = $('thieu_box'), brk = $('hesom_break'), line = $('hesom_line')
  if (error) { if (line) line.style.display = 'none'; $('hesom_words').textContent = ''; brk.style.display = 'none'; box.style.display = 'block'; box.textContent = 'Lỗi: ' + error.message; return }
  if (data == null) {
    // [item 6] KHÔNG để dấu gạch "= —" trống — ẩn hẳn dòng số, nói rõ THIẾU CÁI GÌ.
    if (line) line.style.display = 'none'; $('hesom_words').textContent = ''; brk.style.display = 'none'
    const thieu = await thieuGi()
    box.style.display = 'block'
    box.innerHTML = '<b>Chưa tính được hệ số nhân — THIẾU:</b><br>' + thieu.map(x => '• ' + x).join('<br>') +
      '<br><span style="color:var(--gn)">Nhập đủ + có đơn của kỳ rồi bấm “Tính lại”. (Không hiện 0, không để trống.)</span>'
    return
  }
  if (line) line.style.display = ''
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

// ══════════ ⑤ SỔ THAM SỐ XƯỞNG ══════════
// Cấu trúc CỐ ĐỊNH (7 tổ · 12 hoạt động · tổ nào làm việc nào · % mặc định [TẠM]). Lương + % đã lưu ghi đè.
const S6_TO = [['cnc','CNC'],['dan_canh','Dán cạnh'],['cha_lot','Chà lót'],['son_pu','Sơn PU'],
  ['lap_rap','Lắp ráp'],['dong_goi','Đóng gói'],['giuong','Giường']]
const S6_HD = [
  ['cat','Cắt CNC','cnc',100,false], ['dan','Dán cạnh','dan_canh',70,false], ['cam','Khoan cam/chốt','dan_canh',30,false],
  ['lot','Chà nhám + lót','cha_lot',100,false], ['pu','Sơn PU (mặt)','son_pu',70,false], ['son_canh','Sơn cạnh (mặt lộ)','son_pu',30,false],
  ['cup','Khoan cup bản lề','lap_rap',15,false], ['thung','Lắp ráp thùng','lap_rap',45,false],
  ['ray','Lắp ray ngăn kéo','lap_rap',25,true], ['canh','Căn chỉnh cánh','lap_rap',15,true],
  ['goi','Đóng gói','dong_goi',100,false], ['giuong_lap','Lắp ráp giường','giuong',100,false]]
const S6_TEN_TO = Object.fromEntries(S6_TO)
const ngCls = t => t === 'từ tem' ? 'b-tem' : t === 'từ kho' ? 'b-kho' : t === 'từ phiếu đếm' ? 'b-dem'
  : t === 'từ plugin (dự tính)' ? 'b-plugin' : 'b-thieu'
let S6 = {}   // hoat_dong -> {mau_so, nguon_mau_so, don_gia_dang_dung, so_ngay, trang_thai}

async function taiS6() {
  $('s6_ky').textContent = KY
  const { data: lt } = await sb.from('luong_to').select('*').eq('ma_ky', KY)
  const { data: pb } = await sb.from('phan_bo_hoat_dong').select('*').eq('ma_ky', KY)
  const ltMap = {}; (lt || []).forEach(r => ltMap[r.ma_to] = r)
  const pbMap = {}; (pb || []).forEach(r => pbMap[r.ma_to + '|' + r.hoat_dong] = r)
  // mẫu số + nguồn (ket_qua) · baseline + so_ngay (so_sanh)
  const [{ data: kq }, { data: ss }] = await Promise.all([
    sb.rpc('ket_qua_don_gia', { p_ma_ky: KY }), sb.rpc('so_sanh_don_gia', { p_ma_ky: KY })])
  S6 = {}
  ;(kq || []).forEach(r => S6[r.hoat_dong] = { mau_so: r.mau_so, nguon_mau_so: r.nguon_mau_so, trang_thai: r.trang_thai })
  ;(ss || []).forEach(r => { const s = S6[r.hoat_dong] || (S6[r.hoat_dong] = {}); s.don_gia_dang_dung = r.don_gia_dang_dung; s.so_ngay = r.so_ngay_co_du_lieu })
  veS6Luong(ltMap); veS6Pct(pbMap); capNhatS6()
}

function veS6Luong(ltMap) {
  $('s6_luong').innerHTML = S6_TO.map(([ma, ten]) => {
    const r = ltMap[ma] || {}
    const mi = (f, v) => `<input class="money s6m" data-s6to="${ma}" data-f="${f}" value="${v == null ? '' : Number(v).toLocaleString('vi-VN')}">`
    return `<tr><td class="ten">${ten}</td>` +
      `<td><input data-s6to="${ma}" data-f="nguoi" value="${r.so_nguoi ?? ''}" style="width:70px"></td>` +
      `<td>${mi('luong', r.luong_to)}</td><td>${mi('oh', r.overhead_phan_bo)}</td><td>${mi('bh', r.bao_hiem)}</td>` +
      `<td class="tsum" id="s6tong-${ma}">—</td></tr>`
  }).join('')
  document.querySelectorAll('#s6_luong input.s6m').forEach(el => el.addEventListener('input', () => { fmtMoneyEl(el); capNhatS6() }))
  document.querySelectorAll('#s6_luong input[data-f=nguoi]').forEach(el => el.addEventListener('input', capNhatS6))
}
function veS6Pct(pbMap) {
  let h = ''
  S6_TO.forEach(([ma, ten]) => {
    const acts = S6_HD.filter(x => x[2] === ma)
    h += `<tr class="to-row"><td class="ten" colspan="2">${ten}${acts.length > 1 ? '' : ' <span style="font-weight:400;color:#7A8">(1 việc)</span>'}</td><td class="tsum ok" id="s6psum-${ma}">—</td></tr>`
    acts.forEach(([hd, tenhd, , def, tam]) => {
      const saved = pbMap[ma + '|' + hd]
      const v = saved ? saved.phan_tram_thoi_gian : def
      h += `<tr><td class="ten" style="padding-left:24px">${tenhd}${tam ? '<span class="badge b-tam">TẠM</span>' : ''}</td>` +
        `<td><input class="pct" data-s6hd="${hd}" value="${v}">%</td><td></td></tr>`
    })
  })
  $('s6_pct').innerHTML = h
  document.querySelectorAll('#s6_pct input.pct').forEach(el => el.addEventListener('input', capNhatS6))
}
const s6el = (to, f) => document.querySelector(`#s6_luong input[data-s6to="${to}"][data-f="${f}"]`)
const s6money = (to, f) => Number((s6el(to, f)?.value || '').replace(/\D/g, '')) || 0
const s6int = (to, f) => { const v = parseInt((s6el(to, f)?.value || '').replace(/\D/g, '')); return isNaN(v) ? null : v }
const s6pct = hd => { const el = document.querySelector(`#s6_pct input[data-s6hd="${hd}"]`); return el ? (parseFloat(el.value) || 0) : 0 }
const s6tongTo = to => s6money(to, 'luong') + s6money(to, 'oh') + s6money(to, 'bh')

function capNhatS6() {
  // ① tổng chi phí tổ + ② tổng % (đỏ nếu ≠100)
  S6_TO.forEach(([ma]) => {
    $('s6tong-' + ma).textContent = fmt(s6tongTo(ma))
    const s = S6_HD.filter(x => x[2] === ma).reduce((a, x) => a + s6pct(x[0]), 0)
    const el = $('s6psum-' + ma); el.textContent = (Math.round(s * 10) / 10) + '%'
    el.className = 'tsum ' + (Math.abs(s - 100) < 1e-9 ? 'ok' : 'bad')
  })
  // ③ 12 dòng — đơn giá tính LIVE = (lương+oh+bh)×% ÷ mẫu số (mẫu số/nguồn/baseline từ DB)
  $('s6_kq').innerHTML = S6_HD.map(([hd, ten, to]) => {
    const s = S6[hd] || {}, pct = s6pct(hd), lpb = s6tongTo(to) * pct / 100
    let mauCell = '—', ngCell = '<span class="badge b-thieu">THIẾU</span>', dgCell, lechCell = '—'
    if (s.mau_so != null) {
      mauCell = fmt(s.mau_so); ngCell = `<span class="badge ${ngCls(s.nguon_mau_so)}">${s.nguon_mau_so}</span>`
      const dg = lpb / Number(s.mau_so); dgCell = `<span class="dgcell">${fmt(dg)}</span>`
      if (s.don_gia_dang_dung) {
        const lech = (dg - Number(s.don_gia_dang_dung)) / Number(s.don_gia_dang_dung) * 100
        lechCell = `<span class="${lech >= 0 ? 'lech-up' : 'lech-dn'}">${lech >= 0 ? '+' : ''}${pct1(lech)}%</span> <span class="s6days">(dùng ${fmt(s.don_gia_dang_dung)}${s.so_ngay != null ? ' · ' + s.so_ngay + ' ngày' : ''})</span>`
      }
    } else {
      const thieu = (s.trang_thai || 'THIẾU mẫu số').replace(/^THIẾU\s*/, '')
      dgCell = `<span class="thieu-txt">THIẾU ${thieu} — không có tem/kho/phiếu đếm</span>`
    }
    return `<tr><td class="ten">${ten}</td><td class="ten">${S6_TEN_TO[to]}</td><td>${Math.round(pct * 10) / 10}%</td>` +
      `<td>${fmt(lpb)}</td><td>${mauCell}</td><td class="ten">${ngCell}</td><td>${dgCell}</td><td>${lechCell}</td></tr>`
  }).join('')
}
const pct1 = n => (Math.round(Number(n) * 10) / 10).toLocaleString('vi-VN')

async function luuS6() {
  const bad = S6_TO.filter(([ma]) => Math.abs(S6_HD.filter(x => x[2] === ma).reduce((a, x) => a + s6pct(x[0]), 0) - 100) > 1e-9)
  if (bad.length) { $('s6_msg').style.color = '#C8202E'; $('s6_msg').textContent = '⚠ Chưa lưu — tổ ' + bad.map(([, t]) => t).join(', ') + ' tổng % ≠ 100%.'; return }
  const luong = S6_TO.map(([ma]) => ({ ma_to: ma, so_nguoi: s6int(ma, 'nguoi'), luong_to: s6money(ma, 'luong'), overhead_phan_bo: s6money(ma, 'oh'), bao_hiem: s6money(ma, 'bh') }))
  const phan_bo = S6_HD.map(([hd, , to]) => ({ ma_to: to, hoat_dong: hd, phan_tram_thoi_gian: s6pct(hd) }))
  const { error } = await sb.rpc('ghi_so_tham_so_xuong', { p_ma_ky: KY, p_luong: luong, p_phan_bo: phan_bo })
  if (error) { $('s6_msg').style.color = '#C8202E'; $('s6_msg').textContent = '❌ ' + error.message; return }
  $('s6_msg').style.color = '#175E24'; $('s6_msg').textContent = '✅ Đã lưu — ③ là đơn giá tính từ số vừa lưu.'
  await taiS6()
}

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// ── khởi động ──
sb.auth.getSession().then(({ data }) => { if (data.session) laySauDangNhap(data.session.user); else manDangNhap() })
