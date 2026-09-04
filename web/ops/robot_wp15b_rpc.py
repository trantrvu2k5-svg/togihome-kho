#!/usr/bin/env python3
# WP-15b (1) · INSTRUMENT (không repro mù): bắt postData tao_don/chot_don/doi_trang_thai_don khi "Lưu đơn".
import sys, time, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
SALE = 'https://togihome-sale.pages.dev'
RPC = []
def on_req(r):
    try:
        if '/rpc/' in r.url:
            fn = r.url.split('/rpc/')[-1].split('?')[0]
            if fn in ('tao_don', 'chot_don', 'doi_trang_thai_don'):
                pd = r.post_data or ''
                RPC.append((fn, pd[:300]))
    except Exception: pass
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1400,900', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1400, 'height': 820}).new_page()
    pg.on('request', on_req)
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(2000)
    RPC.clear()
    try:
        try: pg.get_by_text('Sổ đơn hàng', exact=True).first.click(timeout=4000); time.sleep(1)
        except PWTimeout: pass
        pg.get_by_role('button', name='+ Lên đơn', exact=True).click(timeout=6000)
        pg.get_by_placeholder('0903 792 333').wait_for(timeout=6000)
        pg.get_by_placeholder('Chị Lan').fill('DEMO Phòng họp W15rpc')
        pg.get_by_placeholder('0903 792 333').fill('0900000007')
        pg.get_by_placeholder('Số nhà, đường, phường, quận').fill('DEMO rpc')
        pg.get_by_placeholder('Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm').first.fill('Tủ áo (DEMO rpc)')
        pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill('9000000')
        modal = pg.get_by_role('button', name='Lưu đơn', exact=True).locator("xpath=ancestor::div[.//input[@placeholder='0903 792 333']][1]")
        for _round in range(2):
            sels = modal.locator('select'); n = sels.count()
            for i in range(n):
                s = sels.nth(i)
                try:
                    if s.is_visible() and (s.input_value() or '') == '': s.select_option(index=1); time.sleep(0.2)
                except Exception: pass
        pg.get_by_role('button', name='Lưu đơn', exact=True).click(timeout=6000)
        time.sleep(3)
    except Exception as e:
        print('  flow lỗi:', str(e)[:120])
    print('═══ RPC gọi khi "Lưu đơn" (thứ tự) ═══')
    for fn, pd in RPC: print(f'  {fn}: {pd}')
    if not RPC: print('  (không RPC nào — có thể chặn ở client trước khi gọi)')
    b.close()
