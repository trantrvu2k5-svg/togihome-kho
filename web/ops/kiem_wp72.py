#!/usr/bin/env python3
# WP-72 L-72c — ROBOT TỰ KIỂM MẮT trên PROD (Playwright). Mỗi bước ASSERT rồi chụp; assert fail vẫn chụp + đi tiếp.
#   Tài khoản test_ (QD-51) từ .env.robot — CẤM đặt lại mật khẩu. Đơn demo qua ĐÚNG đường app (tao_don). Số/ngày là số THẬT.
import os, sys, json, pathlib, datetime
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright

env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_SALE_EMAIL'], env['TEST_SALE_PASS']
URL = 'https://togihome-sale.pages.dev'
OUT = pathlib.Path.home() / 'Downloads'
today = datetime.date.today()
def dd(n): return (today + datetime.timedelta(days=n)).isoformat()
# 3 đơn đèn: A quá hạn (-8) · B sắp ≤3 (+2) · C còn nhiều (+18) ; D cho cửa thua
ORD = {'WP72C-A': dd(-8), 'WP72C-B': dd(2), 'WP72C-C': dd(18)}
res = {}
def chk(name, cond, note=''):
    res[name] = bool(cond); print(('  ✅ ' if cond else '  ❌ ') + name + (('  — ' + note) if note and not cond else ''))
    return cond
# BỊT LỖ ASSERT (L-72d): sau MỌI ghi → KHÔNG banner đỏ (#loi-luu) VÀ KHÔNG console.error app kể từ mốc n0.
def sach(pg, step, capp, n0):
    banner = pg.locator('#loi-luu')
    bvis = banner.count() > 0 and banner.is_visible() and banner.inner_text().strip() != ''
    apperr = list(capp[n0:])
    return chk(step, (not bvis) and len(apperr) == 0, 'banner=' + (banner.inner_text()[:70] if bvis else 'none') + ' console=' + json.dumps(apperr[:2], ensure_ascii=False))

def mk(pg, ma):
    r = pg.evaluate("""async (ma) => { const {data,error}=await window.__sb.rpc('tao_don',{p_don:{ma_don:ma,dong:'le',ten_khach:'DEMO '+ma,gia_cong_thuc:5000000,gia_chot:5000000,nguon_khach:'khac'},p_chot:false,p_lead_id:null}); return error?('ERR:'+error.message):'OK'; }""", ma)
    assert r == 'OK', ma + ': ' + r
def wait_app(pg):
    pg.wait_for_function("() => window.saleApi && window.saleApi.baoGiaHanDem", timeout=25000); pg.wait_for_timeout(900)
def tatca(pg):
    try: pg.get_by_role('button', name='Tất cả').first.click(); pg.wait_for_timeout(700)
    except Exception: pass
def row(pg, ma): return pg.locator('.bg-dong').filter(has_text=ma).first

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
    pg = ctx.new_page()
    capp = []   # console.error app (bỏ noise chrome-extension)
    pg.on('console', lambda m: capp.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
    assert pg.evaluate("async ([u,p])=>{const {error}=await window.__sb.auth.signInWithPassword({email:u,password:p});return error?error.message:'OK'}", [U, PW]) == 'OK'
    pg.goto(URL, wait_until='domcontentloaded'); wait_app(pg)

    # ── B1 · khối đầu màn lúc chưa có báo giá thật ──
    pg.wait_for_selector('.bg72-trong, .bg72-khoi', timeout=15000); pg.wait_for_timeout(600)
    trong_txt = (pg.locator('.bg72-trong').first.inner_text() if pg.locator('.bg72-trong').count() else '')
    khoi_html = (pg.locator('.bg72-khoi').first.inner_text() if pg.locator('.bg72-khoi').count() else '')
    chk('B1 khối trống hiện "Chưa có báo giá nào"', 'Chưa có báo giá nào' in trong_txt, trong_txt[:60])
    chk('B1 KHÔNG có ba số 0 trong khối', pg.locator('.bg72-khoi').count() == 0 and '0' not in khoi_html, 'khoi=' + khoi_html[:40])
    pg.screenshot(path=str(OUT / 'wp72_01_trong.png'))

    # ── B2 · tạo 3 đơn demo + sửa hạn qua UI để ra 3 đèn ──
    for ma in ORD: mk(pg, ma)
    pg.reload(wait_until='domcontentloaded'); wait_app(pg); tatca(pg)
    n2 = len(capp)
    for ma, han in ORD.items():
        r = row(pg, ma); r.scroll_into_view_if_needed()
        r.locator('.bg72-han-sua', has_text='sửa').first.click(); pg.wait_for_timeout(300)
        r.locator('.bg72-han-in').first.fill(han)
        r.locator('.bg72-han-sua', has_text='Lưu').first.click(); pg.wait_for_timeout(900)
    sach(pg, 'B2 (i) KHÔNG banner/console đỏ sau khi sửa hạn', capp, n2)
    pg.reload(wait_until='domcontentloaded'); wait_app(pg); tatca(pg)
    den = {ma: (row(pg, ma).locator('.bg72-den-do').count() and 'do') or (row(pg, ma).locator('.bg72-den-am').count() and 'am') or (row(pg, ma).locator('.bg72-den-xanh').count() and 'xanh') or '?' for ma in ORD}
    chk('B2 ba đèn đúng màu (A=do,B=am,C=xanh)', den == {'WP72C-A': 'do', 'WP72C-B': 'am', 'WP72C-C': 'xanh'}, json.dumps(den))
    # giữ nguyên ngày sau reload: đọc text hạn dòng A
    hanA = row(pg, 'WP72C-A').locator('.bg72-han').first.inner_text()
    chk('B2 sửa hạn giữ nguyên sau tải lại (A quá hạn)', 'quá' in hanA, hanA[:50])
    pg.screenshot(path=str(OUT / 'wp72_02_ds_ba_den.png'), full_page=True)

    # ── B3 · khối đầu màn khớp số đơn B2 ──
    dem = pg.evaluate("async () => await window.saleApi.baoGiaHanDem()")
    chk('B3 khối đếm khớp (quá hạn 1 · sắp 1 · còn 1)', dem['qua_han']['so'] == 1 and dem['sap_het_han']['so'] == 1 and dem['con_han']['so'] == 1, json.dumps({k: dem[k]['so'] for k in ['qua_han', 'sap_het_han', 'con_han']}))
    pg.evaluate("() => window.scrollTo(0,0)"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / 'wp72_03_khoi_dau_man.png'))

    # ── B4 · chip lọc ──
    def loc_dem(nhan):
        pg.get_by_role('button', name=nhan, exact=True).first.click(); pg.wait_for_timeout(800)
        return pg.locator('.bg-dong').count()
    n_qh = loc_dem('Quá hạn'); pg.screenshot(path=str(OUT / 'wp72_04_loc_qua_han.png'))
    n_sh = loc_dem('Sắp hết hạn'); n_tr = loc_dem('Đang treo')
    chk('B4 lọc Quá hạn=1 · Sắp hết hạn=1 · Đang treo=0', n_qh == 1 and n_sh == 1 and n_tr == 0, f'qh={n_qh} sh={n_sh} tr={n_tr}')

    # ── B5 · cửa Đánh dấu thua (ĐIỀU KIỆN ĐÓNG WP) ──
    mk(pg, 'WP72C-D'); pg.reload(wait_until='domcontentloaded'); wait_app(pg); tatca(pg)
    row(pg, 'WP72C-D').get_by_role('button', name='Mở đơn').first.click(); pg.wait_for_timeout(1200)
    pg.get_by_role('button', name='Khách không lấy').first.click(); pg.wait_for_timeout(800)
    luu = pg.locator('.mdl button.pri').last
    chk('B5a nút Lưu KHOÁ khi chưa chọn lý do', luu.is_disabled())
    pg.screenshot(path=str(OUT / 'wp72_05_nut_khoa.png'))
    tt_truoc = pg.evaluate("async () => { const {data}=await window.__sb.from('don_hang').select('trang_thai').eq('ma_don','WP72C-D').single(); return data && data.trang_thai; }")
    luu.click(force=True); pg.wait_for_timeout(600)   # bấm thật lúc khoá
    tt_sau = pg.evaluate("async () => { const {data}=await window.__sb.from('don_hang').select('trang_thai').eq('ma_don','WP72C-D').single(); return data && data.trang_thai; }")
    chk('B5b bấm nút lúc khoá → KHÔNG đổi gì', tt_truoc == 'bao_gia' and tt_sau == 'bao_gia', f'{tt_truoc}->{tt_sau}')
    pg.locator('.mdl .chip').first.click(); pg.wait_for_timeout(400)   # chọn "Giá cao"
    chk('B5c chọn lý do → nút Lưu SÁNG', not luu.is_disabled())
    pg.screenshot(path=str(OUT / 'wp72_06_nut_sang.png'))
    n5 = len(capp)
    luu.click(); pg.wait_for_timeout(3500)
    st = pg.evaluate("async () => { const {data}=await window.__sb.from('don_hang').select('trang_thai,ly_do_thua').eq('ma_don','WP72C-D').single(); return data; }")
    chk('B5d Lưu → bao_gia_thua + ly_do_thua=gia_cao', st and st['trang_thai'] == 'bao_gia_thua' and st['ly_do_thua'] == 'gia_cao', json.dumps(st))
    sach(pg, 'B5e (i) KHÔNG banner/console đỏ sau khi Lưu thua', capp, n5)   # ← lỗ mà L-72c bỏ sót
    pg.screenshot(path=str(OUT / 'wp72_07b_da_thua.png'))
    # (ii) F5 rồi ĐỌC LẠI TỪ MÀN, khớp DB
    pg.reload(wait_until='domcontentloaded'); wait_app(pg); tatca(pg)
    scr = row(pg, 'WP72C-D').inner_text().replace('\n', ' ')
    db2 = pg.evaluate("async () => { const {data}=await window.__sb.from('don_hang').select('trang_thai,ly_do_thua').eq('ma_don','WP72C-D').single(); return data; }")
    chk('B5f (ii) sau F5: màn hiện THUA + "Giá cao" khớp DB', ('Giá cao' in scr) and db2 and db2['trang_thai'] == 'bao_gia_thua' and db2['ly_do_thua'] == 'gia_cao', 'scr=' + scr[:70])
    pg.screenshot(path=str(OUT / 'wp72_09_sau_reload.png'))
    ctx.close()

    # ── B6 · điện thoại 390×844 ──
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg2 = ctx2.new_page()
    pg2.goto(URL, wait_until='domcontentloaded'); pg2.wait_for_timeout(1500)
    pg2.evaluate("async ([u,p])=>{await window.__sb.auth.signInWithPassword({email:u,password:p})}", [U, PW])
    pg2.goto(URL, wait_until='domcontentloaded'); wait_app(pg2); tatca(pg2)
    dens = set()
    for cls in ['do', 'am', 'xanh']:
        if pg2.locator('.bg72-den-' + cls).count(): dens.add(cls)
    # cột hạn không cắt: mọi .bg72-han nằm trong bề rộng 390
    cut = pg2.evaluate("() => [...document.querySelectorAll('.bg72-han')].some(e => { const r=e.getBoundingClientRect(); return r.right > 391 || r.left < 0; })")
    chk('B6 phone: 3 đèn phân biệt + cột hạn không cắt', dens == {'do', 'am', 'xanh'} and not cut, 'den=' + str(sorted(dens)) + ' cut=' + str(cut))
    pg2.screenshot(path=str(OUT / 'wp72_08_dien_thoai.png'), full_page=True)
    ctx2.close(); b.close()

print('\n═══ BẢNG KIỂM WP-72 ═══')
for k, v in res.items(): print(('ĐẠT   ' if v else 'KHÔNG ') + k)
print(f'\n{sum(res.values())}/{len(res)} ĐẠT')
for f in ['01_trong', '02_ds_ba_den', '03_khoi_dau_man', '04_loc_qua_han', '05_nut_khoa', '06_nut_sang', '07b_da_thua', '09_sau_reload', '08_dien_thoai']:
    print('ẢNH:', OUT / ('wp72_' + f + '.png'))
sys.exit(0 if all(res.values()) else 1)
