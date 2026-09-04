#!/usr/bin/env python3
# WP-15b (1) · B1 · CHẠY THỬ DRIVE-ĐÚNG (khác repro): chỉ chọn select TRONG modal "+ Lên đơn",
#   KHÔNG đụng select nền (list đơn) — kiểm giả thuyết HARNESS (demo:210-217 chọn index=1 cả trang).
#   Được → HARNESS. Không được → APP. test_ceo. Dọn đơn mình tạo.
import sys, time, pathlib
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
SALE = 'https://togihome-sale.pages.dev'; DL = pathlib.Path.home() / 'Downloads'
NET = []
def on_resp(r):
    try:
        if r.status >= 400 and ('/rest/' in r.url or '/rpc/' in r.url):
            body = ''
            try: body = r.text()[:400]
            except Exception: body = '?'
            NET.append((r.status, r.url.split('/rpc/')[-1].split('?')[0] if '/rpc/' in r.url else r.url.split('/rest/v1/')[-1][:40], body))
    except Exception: pass

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1500,950', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1500, 'height': 850}).new_page()
    pg.on('response', on_resp)
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(2000)
    pre = pg.evaluate("async ()=>{const {data}=await window.__sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO%'); return (data||[]).map(x=>x.ma_don);}")
    demo_pre = set(pre or [])
    print(f'đơn DEMO trước: {len(demo_pre)}')
    NET.clear()
    try:
        try: pg.get_by_text('Sổ đơn hàng', exact=True).first.click(timeout=4000); time.sleep(1)
        except PWTimeout: pass
        pg.get_by_role('button', name='+ Lên đơn', exact=True).click(timeout=6000)
        pg.get_by_placeholder('0903 792 333').wait_for(timeout=6000)
        pg.get_by_placeholder('Chị Lan').fill('DEMO Phòng họp W15b2')
        pg.get_by_placeholder('0903 792 333').fill('0900000008')
        pg.get_by_placeholder('Số nhà, đường, phường, quận').fill('DEMO drive-đúng')
        pg.get_by_placeholder('Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm').first.fill('Tủ áo 2 cánh 1200 (DEMO W15b2)')
        pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill('9000000')
        # SCOPE: chỉ select TRONG modal (ancestor chứa nút "Lưu đơn" + input điện thoại) — KHÔNG đụng list nền
        modal = pg.get_by_role('button', name='Lưu đơn', exact=True).locator(
            "xpath=ancestor::div[.//input[@placeholder='0903 792 333']][1]")
        for _round in range(2):
            sels = modal.locator('select'); n = sels.count()
            print(f'  select TRONG modal: {n}')
            for i in range(n):
                s = sels.nth(i)
                try:
                    if s.is_visible() and (s.input_value() or '') == '': s.select_option(index=1); time.sleep(0.2)
                except Exception: pass
        print('  → bấm "Lưu đơn"…')
        pg.get_by_role('button', name='Lưu đơn', exact=True).click(timeout=6000)
        time.sleep(2)
        found = None
        for _ in range(24):
            now = pg.evaluate("async ()=>{const {data}=await window.__sb.from('don_hang').select('ma_don,id,trang_thai').ilike('ten_khach','DEMO%').order('tao_luc',{ascending:false}); return data||[];}")
            for row in (now or []):
                if row['ma_don'] not in demo_pre: found = row; break
            if found: break
            time.sleep(0.5)
        pg.screenshot(path=str(DL / 'wp15b_diag2.png'))
        if found:
            print(f'  ✅ TẠO ĐƯỢC: {found["ma_don"]} · trang_thai={found["trang_thai"]}')
            # dọn: xoá đơn mình vừa tạo
            d = pg.evaluate("async (id)=>{const {error}=await window.__sb.from('don_hang').delete().eq('id',id); return error?error.message:'ok';}", found['id'])
            print('  dọn đơn test:', d)
        else:
            print('  ❌ KHÔNG tạo được (drive-đúng vẫn fail)')
    except Exception as e:
        print('  ❌ FLOW LỖI:', f'{type(e).__name__}: {str(e)[:140]}')
        try: pg.screenshot(path=str(DL / 'wp15b_diag2.png'))
        except Exception: pass
    print('\n═══ HTTP 4xx/5xx ═══')
    for st, ep, body in NET: print(f'  [{st}] {ep} · {body}')
    if not NET: print('  (không có 4xx/5xx)')
    b.close()
