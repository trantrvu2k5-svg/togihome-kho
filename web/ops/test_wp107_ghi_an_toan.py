#!/usr/bin/env python3
# WP-107 · cổng hồi quy khuôn ghiAnToan — chạy trên BẢN LOCAL đã build (dist-*). KHÔNG login thật, KHÔNG ghi prod:
#   inject session giả + CHẶN toàn bộ mạng Supabase (mock/đếm). Đa-app: taichinh · kho · xuong · sale · sanpham.
import http.server, socketserver, threading, functools, json, time, sys, re, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]   # web/
REF  = 'ugebruuxkslsnbramils'
UID  = '487c6fb3-5075-4e9e-a66d-8ffbe14737c3'
USER = {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'email': 'kt@t.local', 'app_metadata': {}, 'user_metadata': {}}
ND   = {'id': 'a8dfb596-3347-42f9-b19b-70c2893b569e', 'auth_uid': UID, 'ho_ten': 'test (ceo)', 'vai_tro': 'ceo', 'dang_hoat_dong': True}   # ceo qua MỌI cổng app
KY   = {'ma_ky': '2026-09', 'vat': 10, 'dt_muc_tieu': 7000000000, 'so_don_ke_hoach': 100, 'hh_sale': 5, 'hh_quan_ly': 2,
        'hh_thiet_ke': 3, 'phi_don_le': 50000, 'phi_don_combo': 80000, 'phi_don_thiet_ke': 0, 'chi_phi_nang_luc': None,
        'tran_sale': 10, 'tran_truong_nhom': 5, 'ghi_chu': '', 'n_cac': 0, 'n_no': 0}
SESS = {'access_token': 'FAKE', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': 4102444800, 'refresh_token': 'FAKE', 'user': USER}

PASS, FAIL = [], []
def ok(t, c, chi=''):
    (PASS if c else FAIL).append(t); print(('  ✓ ' if c else '  ✗ FAIL ') + t + ('' if c else '  → ' + chi))

def serve(dist, port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / dist))
    class Q(socketserver.TCPServer): allow_reuse_address = True
    s = Q(('127.0.0.1', port), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

def open_app(pw, dist, port, get_mocks=None):
    server = serve(dist, port)
    b = pw.chromium.launch(channel='chrome', headless=True); ctx = b.new_context()
    ctx.add_init_script(f"try{{localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(SESS))})}}catch(e){{}}")
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print(f"  ⚠ PAGEERR[{dist}]:", str(e)[:130]))
    st = {'CNT': {}, 'DELAY': {}, 'ERR': set(), 'GET': dict(get_mocks or {}), 'RPC': {}, 'POST': {}, 'WORKER': 200}
    st['ABORT'] = set()
    def route(r):
        u = r.request.url; meth = r.request.method
        for a in st['ABORT']:
            if a in u: return r.abort()   # mô phỏng RPC NÉM (mất mạng) → sb.rpc reject → ghiAnToan catch + finally
        for e in st['ERR']:
            if e in u: return r.fulfill(status=400, content_type='application/json', body=json.dumps({'message': 'GIẢ LỖI: ' + e, 'code': 'X'}))
        if '/auth/v1/user' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(USER))
        if '/auth/v1/' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(SESS))
        if '/rest/v1/nguoi_dung' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps([ND]))
        for path, body in st['GET'].items():
            if path in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(body))
        m = re.search(r'/rest/v1/rpc/([a-z0-9_]+)', u)
        if m:
            fn = m.group(1); st['CNT'][fn] = st['CNT'].get(fn, 0) + 1
            if st['DELAY'].get(fn): time.sleep(st['DELAY'][fn])
            body = st['RPC'].get(fn, '[]')
            return r.fulfill(status=200, content_type='application/json', body=body if isinstance(body, str) else json.dumps(body))
        # đếm INSERT (POST bảng REST) để soi "ghi trùng"
        tb = re.search(r'/rest/v1/([a-z0-9_]+)\b', u)
        if tb and meth == 'POST': st['POST'][tb.group(1)] = st['POST'].get(tb.group(1), 0) + 1
        # GET bảng: mặc định [] ; nếu bật GET_DEFAULT (form sale cần select có option) → trả 1 hàng generic
        if meth == 'GET' and st.get('GET_DEFAULT'): return r.fulfill(status=200, content_type='application/json', body=json.dumps(st['GET_DEFAULT']))
        return r.fulfill(status=200, content_type='application/json', body='[]')
    pg.route(f'**{REF}.supabase.co/**', route)
    # route worker Cloudflare (keoNgay) — trạng thái đổi qua st['WORKER']
    def wroute(r): return r.fulfill(status=st['WORKER'], content_type='application/json', body='{}' if st['WORKER'] < 400 else 'loi')
    pg.route('**workers.dev/**', wroute)
    pg.goto(f'http://127.0.0.1:{port}/', wait_until='domcontentloaded')
    return pg, st, (lambda: (b.close(), server.shutdown()))

# ═══════════════ TAICHINH — ca 1..5 (đã có từ L-107.2) ═══════════════
def app_taichinh(pw):
    print("── APP TÀI CHÍNH ──")
    pg, st, close = open_app(pw, 'dist-taichinh', 8791, {'/rest/v1/tham_so_tai_chinh': [KY]})
    try:
        pg.wait_for_selector('#ky', state='attached', timeout=15000)
        pg.wait_for_function("window.luuKy && document.getElementById('btn_luu')", timeout=8000)
        pg.wait_for_function("!document.getElementById('btn_luu').disabled", timeout=8000)
        try: pg.locator('#tab-dongtien').click(timeout=4000)
        except Exception: pass
        pg.wait_for_selector('#pc_luu', state='attached', timeout=8000)
        time.sleep(2)
        chuCu = pg.evaluate("document.getElementById('pc_luu').textContent")
        # CA1 double-click phiếu chi → 1 pc_ghi
        st['CNT']['pc_ghi'] = 0
        pg.evaluate("""() => { const s=document.getElementById('pc_ncc'); if(!s.options.length)s.add(new Option('t','t1')); s.value=s.options[s.options.length-1].value; document.getElementById('pc_tien').value='100000'; const b=document.getElementById('pc_luu'); b.click(); b.click(); }""")
        pg.wait_for_function("!document.getElementById('pc_luu').disabled", timeout=12000); time.sleep(0.4)
        ok('CA1 bấm đúp phiếu chi → 1 lần pc_ghi', st['CNT'].get('pc_ghi', 0) == 1, f"{st['CNT'].get('pc_ghi',0)}")
        # CA5 khoá lúc gửi + trả chữ
        giua = pg.evaluate("""() => { const s=document.getElementById('pc_ncc'); if(!s.options.length)s.add(new Option('t','t1')); s.value=s.options[s.options.length-1].value; document.getElementById('pc_tien').value='50000'; const b=document.getElementById('pc_luu'); b.click(); return {d:b.disabled,t:b.textContent}; }""")
        ok('CA5 đang gửi: nút KHOÁ + "Đang lưu…"', giua['d'] and 'Đang lưu' in (giua['t'] or ''), str(giua))
        pg.wait_for_function("!document.getElementById('pc_luu').disabled", timeout=12000)
        ok('CA5 xong: mở lại + trả chữ cũ', pg.evaluate("document.getElementById('pc_luu').textContent") == chuCu)
        # CA4 von_xoa lỗi → banner
        st['ERR'].add('/rest/v1/rpc/von_xoa')
        pg.evaluate("() => window.vonXoa('x', document.createElement('button'))"); time.sleep(1)
        ok('CA4 von_xoa lỗi → banner NGUYÊN VĂN', pg.evaluate("(document.getElementById('__ghiAnToanBanner')||{}).textContent||''").find('GIẢ LỖI') >= 0)
        st['ERR'].discard('/rest/v1/rpc/von_xoa')
        # CA2+3 kỳ chưa nạp → khoá + gọi thẳng không ghi
        st['DELAY']['__none'] = 0; st['GET']['/rest/v1/tham_so_tai_chinh'] = [KY]
        st['ERR'].add('/rest/v1/tham_so_tai_chinh')   # loadKy lỗi → KY_NAP_XONG không bật
        st['CNT']['luu_tham_so_ban_hang'] = 0
        pg.reload(wait_until='domcontentloaded'); pg.wait_for_selector('#btn_luu', state='attached', timeout=15000); time.sleep(1.5)
        ok('CA2 kỳ chưa nạp → nút Lưu kỳ KHOÁ', pg.evaluate("document.getElementById('btn_luu').disabled") is True)
        pg.evaluate("() => window.luuKy && window.luuKy()"); time.sleep(0.8)
        ok('CA3 gọi thẳng luuKy → 0 lần ghi', st['CNT'].get('luu_tham_so_ban_hang', 0) == 0, f"{st['CNT'].get('luu_tham_so_ban_hang',0)}")
        ok('CA3 báo "Chưa nạp xong kỳ"', 'Chưa nạp xong' in pg.evaluate("(document.getElementById('__ghiAnToanBanner')||{}).textContent||''"))
        # CA13 RPC NÉM giữa chừng → finally mở khoá nút lại (không kẹt "Đang lưu…")
        st['ERR'].discard('/rest/v1/tham_so_tai_chinh'); pg.reload(wait_until='domcontentloaded')
        pg.wait_for_selector('#pc_luu', state='attached', timeout=15000)   # phiếu chi độc lập loadKy
        try: pg.locator('#tab-dongtien').click(timeout=4000)
        except Exception: pass
        time.sleep(2)
        st['ABORT'].add('/rest/v1/rpc/pc_ghi')
        pg.evaluate("""() => { const s=document.getElementById('pc_ncc'); if(!s.options.length)s.add(new Option('t','t1')); s.value=s.options[s.options.length-1].value; document.getElementById('pc_tien').value='100000'; document.getElementById('pc_luu').click(); }""")
        pg.wait_for_function("!document.getElementById('pc_luu').disabled", timeout=12000)
        ok('CA13 RPC ném → finally mở nút lại (không kẹt "Đang lưu…")', pg.evaluate("document.getElementById('pc_luu').textContent") != 'Đang lưu…')
        st['ABORT'].discard('/rest/v1/rpc/pc_ghi')
        # CA18 bản build TEST (VITE_WP107_TEST) → seam CÓ (cổng hồi quy gọi được)
        ok('CA18 build TEST: seam có (window.luuKy = function)', pg.evaluate("typeof window.luuKy") == 'function', pg.evaluate("typeof window.luuKy"))
    finally: close()

# ═══════════════ CA17 — bản build PROD: seam KHÔNG có (gõ console ra undefined) ═══════════════
def app_prod_seam(pw):
    print("── BẢN PROD (gate seam) ──")
    pg, st, close = open_app(pw, 'dist-taichinh-prod', 8802, {'/rest/v1/tham_so_tai_chinh': [KY]})
    try:
        pg.wait_for_selector('#ky', state='attached', timeout=15000); time.sleep(1)
        u = pg.evaluate("[typeof window.luuKy, typeof window.vonXoa, typeof window.luuTSV]")
        ok('CA17 build PROD: window.luuKy/vonXoa/luuTSV đều undefined', all(x == 'undefined' for x in u), str(u))
    finally: close()

# ═══════════════ KHO — ca 6 (ghiSo double), ca 9 (dmKho lỗi → khoá form) ═══════════════
def app_kho(pw):
    print("── APP KHO ──")
    pg, st, close = open_app(pw, 'dist', 8795)
    try:
        pg.wait_for_function("window.ghiSo && window.moiPhieu && window.P", timeout=15000); time.sleep(2)
        # CA6 bấm đúp Ghi sổ → 1 ghi_so_phieu
        st['CNT']['ghi_so_phieu'] = 0
        err6 = pg.evaluate("""async () => {
            try {
                window.moiPhieu('nhap');                       // dựng phiếu + 1 dòng + render nút #btn-ghiso-nhap
                window.P['nhap'].dong[0].ma = 'VT-TEST';
                window.P['nhap'].dong[0].sl = 5;               // có số lượng → qua tiền-kiểm ghiSo
                // "bấm đúp" đồng thời: khuôn phải khoá nút #btn-ghiso-nhap sau lần 1 → lần 2 bo_qua
                await Promise.all([window.ghiSo('nhap'), window.ghiSo('nhap')]);
                return '';
            } catch (e) { return String(e && e.message || e); }
        }""")
        ok('CA6 bấm đúp Ghi sổ → 1 lần ghi_so_phieu (tồn không gấp đôi)', st['CNT'].get('ghi_so_phieu', 0) == 1, f"count={st['CNT'].get('ghi_so_phieu',0)} err='{err6}'")
        # CA9 danh sách kho lỗi → nút "+ Đơn mua mới" KHOÁ + banner, KHÔNG mở form trên nền rỗng
        st['ERR'].add('/rest/v1/kho?'); st['ERR'].add('/rest/v1/vat_tu?'); st['ERR'].add('/rest/v1/v_gia_tham_khao')
        st['CNT']['dm_tao'] = 0
        # mở màn có nút đơn mua mới (dmXem/veDatMua). Nút #dm-moi-btn nối ở taiDatMua.
        opened = pg.evaluate("""async () => {
            const nav = [...document.querySelectorAll('[data-nav],[data-man],button,a')].find(e => /đơn mua|đặt mua|mua/i.test(e.textContent||''));
            if (nav) nav.click(); await new Promise(r=>setTimeout(r,800));
            const btn = document.getElementById('dm-moi-btn'); if (btn) btn.click();
            await new Promise(r=>setTimeout(r,800));
            return !!document.getElementById('dm-moi-btn');
        }""")
        time.sleep(1)
        ban = pg.evaluate("(document.getElementById('__ghiAnToanBanner')||{}).textContent||''")
        disb = pg.evaluate("() => { const b=document.getElementById('dm-moi-btn'); return b ? b.disabled : null }")
        ok('CA9 danh sách kho lỗi → banner "Không nạp được…" (rỗng-vì-lỗi nói ra)', 'Không nạp được' in ban, f"banner='{ban}'")
        ok('CA9 → nút tạo đơn mua KHOÁ (không tạo đơn trên nền rỗng)', disb is True and st['CNT'].get('dm_tao', 0) == 0, f"disabled={disb} dm_tao={st['CNT'].get('dm_tao',0)}")
    finally: close()

# ═══════════════ XƯỞNG — ca 7 (tien_mon double), ca 8 (xuong_tho_list lỗi → khoá ghi công) ═══════════════
def app_xuong(pw):
    print("── APP XƯỞNG ──")
    pg, st, close = open_app(pw, 'dist-xuong', 8798)
    try:
        pg.wait_for_function("window.moMon && window.xongBuoc", timeout=15000); time.sleep(2)
        # CA7: mở panel món (mock chi tiết trang_thai='cho_cat' → PANEL.ke='da_cat'), bấm đúp Xong-bước → 1 tien_mon
        st['RPC']['xuong_chi_tiet_mon'] = [{'mon_id': 'm1', 'id': 'm1', 'trang_thai': 'cho_cat', 'ten_mon': 'Món test', 'ten_rut_gon': 'Món test', 'ma_don': 'D1', 'ngay_hen_khach': None, 'so_luong': 1}]
        st['CNT']['tien_mon'] = 0
        err7 = pg.evaluate("""async () => {
            try {
                await window.moMon('m1', 'D1');               // vePanel set PANEL.ke='da_cat'
                await Promise.all([window.xongBuoc(), window.xongBuoc()]);   // đúp
                return '';
            } catch (e) { return String(e && e.message || e); }
        }""")
        ok('CA7 bấm đúp Xong-bước → 1 lần tien_mon (không vượt bước)', st['CNT'].get('tien_mon', 0) == 1, f"count={st['CNT'].get('tien_mon',0)} err='{err7}'")
        # CA8: xuong_tho_list lỗi → banner nói ra (THO_LOI khoá ghi công, không ghi nhầm chủ)
        st['ERR'].add('/rest/v1/rpc/xuong_tho_list')
        pg.reload(wait_until='domcontentloaded')
        ban = ''
        for _ in range(40):   # poll banner (auto-ẩn sau 6s)
            time.sleep(0.2)
            ban = pg.evaluate("(document.getElementById('__ghiAnToanBanner')||{}).textContent||''")
            if 'Không nạp được danh sách thợ' in ban: break
        ok('CA8 xuong_tho_list lỗi → banner "Không nạp được danh sách thợ" (rỗng-vì-lỗi nói ra)', 'danh sách thợ' in ban, f"banner='{ban}'")
        st['ERR'].discard('/rest/v1/rpc/xuong_tho_list')
    finally: close()

# ═══════════════ SALE — ca 10 (SELECT món lỗi → không insert), ca 11 (keoNgay 500 → ném) ═══════════════
def app_sale(pw):
    print("── APP SALE ──")
    pg, st, close = open_app(pw, 'dist-sale', 8799, {'/rest/v1/don_hang': [{'id': 'DID', 'ma_don': 'MA'}]})
    try:
        pg.wait_for_function("window.saleApi && window.storage", timeout=15000); time.sleep(1.5)
        # CA11 keoNgay HTTP 500 → ném (không báo xong)
        st['WORKER'] = 500
        r11 = pg.evaluate("async () => { try { await window.saleApi.keoNgay(); return 'KHÔNG NÉM (sai)'; } catch (e) { return 'ném: ' + (e.message||e); } }")
        ok('CA11 keoNgay HTTP 500 → NÉM lỗi (không báo xong)', r11.startswith('ném'), r11)
        st['WORKER'] = 200
        # CA10 SELECT don_hang_mon lỗi → _set c2:ct NÉM, KHÔNG insert trùng
        st['RPC']['cau_hinh_sale'] = {'vat': 10}       # getVat qua (object, không phải mảng)
        st['ERR'].add('/rest/v1/don_hang_mon')          # SELECT (và mọi method) lỗi
        st['POST']['don_hang_mon'] = 0
        r10 = pg.evaluate("""async () => {
            try {
                await window.storage.set('c2:ct', JSON.stringify([{ donId:'app1', id:'x1', ten:'Món A', sl:1, gia:1000000 }]));
                return 'KHÔNG NÉM (sai)';
            } catch (e) { return 'ném: ' + (e.message||e); }
        }""")
        time.sleep(0.5)
        ok('CA10 SELECT món lỗi → NÉM (không coi là "mới")', r10.startswith('ném'), r10)
        ok('CA10 → KHÔNG insert món nào (không ghi trùng)', st['POST'].get('don_hang_mon', 0) == 0, f"insert={st['POST'].get('don_hang_mon',0)}")
        st['ERR'].discard('/rest/v1/don_hang_mon')

        # ── ca14/15/16 (sale double-submit): app sale dùng React+Recharts từ CDN, KHÔNG boot được trong harness
        #   cô lập (PropTypes 'oneOfType' crash). Guard dangGui đã ở source (L3435/3512/3563) + build xanh.
        #   → 3 ca này VERIFY TRÊN PROD THẬT bằng trình duyệt (claude-in-chrome) sau deploy, ghi trong báo cáo.
        st['DELAY']['tao_don'] = 0
    finally: close()

# ═══════════════ SẢN PHẨM — ca 12 (luuSP double → 1 lõi) ═══════════════
def app_sanpham(pw):
    print("── APP SẢN PHẨM ──")
    pg, st, close = open_app(pw, 'dist-sanpham', 8800)
    try:
        pg.wait_for_function("typeof window.luuSP === 'function' && typeof window.__setSP === 'function'", timeout=15000); time.sleep(1.5)
        st['CNT']['sp_tao_loi_moi'] = 0
        err12 = pg.evaluate("""async () => {
            try {
                // tên theo format genTen: "<dd In-Hoa> - <loai> <chatlieu>, <phongcach> | <brand> - <ma>"
                // head (trước ' - ') In-Hoa mỗi từ, 'togihome' đúng 1 lần ở cuối; web 60–90, san 100–120.
                let head = 'Xoay Gap Gon Cao Cap';
                const mkWeb = h => h + ' - Ban Lam Viec Go Melamine, Hien Dai | togihome - X01';
                let web = mkWeb(head);
                while (web.length < 62) { head += ' Ben'; web = mkWeb(head); }   // pad head (giữ In-Hoa)
                let sanBase = 'Ban Lam Viec Xoay Gap Gon Go Cong Nghiep Melamine Cao Cap Ben Dep Hien Dai Cho Van Phong';
                while (sanBase.length < 88) sanBase += ' Moi';
                const san = sanBase + ' | togihome - X01';   // ~ +17 → 100–120
                window.__setSP({ dong:'BAN', ma:'X01', loai:'Ban', dacDiem:'Xoay Gap', dacDiemCT:'Xoay gap', chatLieu:'Melamine',
                    phongCach:'Hien dai', tenKyThuat:'ban-test', tenWeb: web, tenSan: san, buoc: 3,
                    bt:[{ten:'BT1', vl:'MEL', rong:'1200', dai:'600', cao:'750'}],
                    ny:[{brand:'togihome', gia:'1000000', quyTrinh:''}] });
                // luuSP dùng $('f_luu') để khoá — bảo đảm nút tồn tại trong DOM (form thật render nút này ở bước 3)
                if (!document.getElementById('f_luu')) document.body.insertAdjacentHTML('beforeend', '<button id="f_luu">Lưu sản phẩm</button>');
                await Promise.all([window.luuSP(), window.luuSP()]);   // đúp
                return 'web=' + web.length + ' san=' + san.length + ' toast=' + ((document.querySelector('.toast,.bao,[class*=toast]')||{}).textContent||'');
            } catch (e) { return String(e && e.message || e); }
        }""")
        # nếu selfCheck chặn, sp_tao_loi_moi=0 và có bao lỗi — in ra để chỉnh
        ok('CA12 bấm đúp luuSP → 1 lõi (sp_tao_loi_moi), không nhân đôi', st['CNT'].get('sp_tao_loi_moi', 0) == 1,
           f"count={st['CNT'].get('sp_tao_loi_moi',0)} err='{err12}'")
    finally: close()

with sync_playwright() as pw:
    app_taichinh(pw)
    app_kho(pw)
    app_xuong(pw)
    app_sale(pw)
    app_sanpham(pw)
    app_prod_seam(pw)
print(f"\n═══ WP-107 ghiAnToan: {len(PASS)} pass / {len(FAIL)} fail ═══")
sys.exit(1 if FAIL else 0)
