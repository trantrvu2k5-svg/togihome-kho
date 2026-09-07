#!/usr/bin/env python3
# WP-110 D-1 — taichinh guard DỮ LIỆU RỖNG. Hai vế: (a) kỳ RỖNG (RPC render → []) · (b) kỳ CÓ (fixture thật).
#   Serve dist-taichinh (LOCAL), phiên giả + nguoi_dung=ceo, mock RPC. Mở 5 tab render → đếm pageerror + đặt placeholder.
#   VẾ (a) phải ĐỎ TRƯỚC KHI VÁ (crash "reading 'tong'"…). Sau vá: (a) 0 pageerror + có "chưa có số"; (b) 0 pageerror + KHÔNG placeholder.
import http.server, socketserver, threading, functools, json, pathlib, time, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIX = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path('/private/tmp/claude-501/-Users-vuquanghai-Documents-togihome-plugin/8bb3d8f3-a1d5-4208-9dd5-c9024898b694/scratchpad/fix110')
REF = 'ugebruuxkslsnbramils'; UID = '487c6fb3-5075-4e9e-a66d-8ffbe14737c3'
USER = {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'email': 'kt@t.local', 'app_metadata': {}, 'user_metadata': {}}
ND = {'id': 'a8', 'auth_uid': UID, 'ho_ten': 'test ceo', 'vai_tro': 'ceo', 'dang_hoat_dong': True}
KY = {'ma_ky': '2026-09', 'vat': 10, 'dt_muc_tieu': 7e9, 'so_don_ke_hoach': 100, 'hh_sale': 5, 'hh_quan_ly': 2, 'hh_thiet_ke': 3,
      'phi_don_le': 50000, 'phi_don_combo': 80000, 'phi_don_thiet_ke': 0, 'chi_phi_nang_luc': None, 'tran_sale': 10, 'tran_truong_nhom': 5,
      'ghi_chu': '', 'n_cac': 0, 'n_no': 0, 'ngay_ap_dung': '2026-09-01', 'trang_thai': {}}
RENDER_RPCS = ['dong_tien_ky', 'pl_ky', 'cm_don_ky', 'cac_theo_luong_loai', 'con_phai_thu', 'nhan_xet_ky', 'pc_ds', 'con_phai_tra']
TABS = ['pl', 'cmdon', 'kenhcac', 'dongtien', 'nhanxet']
fixtures = {fn: (FIX / f'{fn}.json').read_text() for fn in RENDER_RPCS if (FIX / f'{fn}.json').exists()}

def serve(dist, port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / dist))
    class Q(socketserver.TCPServer): allow_reuse_address = True
    s = Q(('127.0.0.1', port), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

def run_case(pw, mode, port):
    "mode 'rong' → render RPC trả []; mode 'co' → trả fixture thật"
    b = pw.chromium.launch(channel='chrome', headless=True); ctx = b.new_context()
    ctx.add_init_script(f"try{{localStorage.setItem('sb-{REF}-auth-token',{json.dumps(json.dumps({'access_token':'F','token_type':'bearer','expires_in':3600,'expires_at':4102444800,'refresh_token':'F','user':USER}))})}}catch(e){{}}")
    # BẮT ĐỦ: render là async gọi KHÔNG await → crash thành unhandledrejection, không chỉ pageerror.
    ctx.add_init_script("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(String(e.message||e.error))); window.addEventListener('unhandledrejection',e=>window.__errs.push(String(e.reason&&e.reason.message||e.reason)));")
    def route(r):
        u = r.request.url
        if '/auth/v1/user' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(USER))
        if '/auth/v1/' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'access_token': 'F', 'user': USER}))
        if '/rest/v1/nguoi_dung' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps([ND]))
        if '/rest/v1/tham_so_tai_chinh' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps([KY]))
        import re
        m = re.search(r'/rest/v1/rpc/([a-z0-9_]+)', u)
        if m:
            fn = m.group(1)
            if fn in RENDER_RPCS:
                body = '[]' if mode == 'rong' else fixtures.get(fn, '[]')
                return r.fulfill(status=200, content_type='application/json', body=body)
            return r.fulfill(status=200, content_type='application/json', body='[]')
        if '/rest/v1/' in u or '/functions/' in u: return r.fulfill(status=200, content_type='application/json', body='[]')
        return r.continue_()
    ctx.route('**/*', route)
    pg = ctx.new_page(); pe = []; ce = []
    pg.on('pageerror', lambda e: pe.append(str(e)))
    pg.on('console', lambda m: ce.append(m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{port}/', wait_until='load'); time.sleep(3)
    per = {}
    for t in TABS:
        n0 = pg.evaluate("window.__errs.length")
        pg.evaluate("(t)=>{const b=document.querySelector('.navi[data-tab=\"'+t+'\"]'); if(b) b.click();}", t)
        time.sleep(1.5)
        per[t] = pg.evaluate("window.__errs.length") - n0
    errs = pg.evaluate("window.__errs")
    # placeholder = MARKER RIÊNG '.ky-rong' (không dò chữ — tránh trùng "quỹ cuối kỳ trước… kỳ CHƯA nhập" của app)
    place = pg.evaluate("!!document.querySelector('.ky-rong')")
    ctx.close(); b.close()
    return errs, ce, per, place

def main(pw):
    srv = serve('dist-taichinh', 8861)
    print("VẾ (a) KỲ RỖNG — render RPC trả []:")
    pe_a, ce_a, per_a, place_a = run_case(pw, 'rong', 8861)
    print(f"  pageerror={len(pe_a)} · console.error={len(ce_a)} · theo tab={per_a} · placeholder-hiện={place_a}")
    if pe_a: print("  lỗi (nguyên văn, 3 đầu):");  [print("     ", x[:80]) for x in pe_a[:3]]
    print("VẾ (b) KỲ CÓ DỮ LIỆU — fixture thật:")
    pe_b, ce_b, per_b, place_b = run_case(pw, 'co', 8861)
    print(f"  pageerror={len(pe_b)} · console.error={len(ce_b)} · theo tab={per_b} · placeholder-hiện={place_b}")
    if pe_b: [print("     ", x[:80]) for x in pe_b[:3]]
    srv.shutdown()
    a_ok = len(pe_a) == 0 and place_a          # sau vá: rỗng KHÔNG nổ + CÓ báo "chưa có số"
    b_ok = len(pe_b) == 0 and not place_b       # có dữ liệu: KHÔNG nổ + KHÔNG placeholder
    print(f"\n  VẾ (a) ĐẠT (0 pageerror & có placeholder): {a_ok}")
    print(f"  VẾ (b) ĐẠT (0 pageerror & không placeholder): {b_ok}")
    print(f"═══ WP-110 taichinh rỗng: {'2/2 XANH' if a_ok and b_ok else 'CHƯA ĐẠT'} ═══")
    return a_ok and b_ok

with sync_playwright() as pw:
    okall = main(pw)
sys.exit(0 if okall else 1)
