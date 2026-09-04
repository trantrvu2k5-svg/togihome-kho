#!/usr/bin/env python3
# WP-15b (1) · C4 ảnh: T9-010 (mã fix sinh ra, không trùng) trên màn Sale + DevTools Console. READ-ONLY.
import sys, time, subprocess, pathlib
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']; SALE = 'https://togihome-sale.pages.dev'; DL = pathlib.Path.home() / 'Downloads'
CON = []
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1500,950', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1500, 'height': 850}).new_page()
    pg.on('console', lambda m: CON.append((m.type, m.text[:120])) if m.type == 'error' else None)
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(2000)
    try: pg.get_by_text('Sổ đơn hàng', exact=True).first.click(timeout=4000); time.sleep(1)
    except PWTimeout: pass
    # tìm T9-010
    try:
        pg.get_by_placeholder('Tìm mã đơn, khách, số đ').fill('T9-010'); time.sleep(1.5)
    except Exception as e: print('  ⚠ ô tìm:', str(e)[:60])
    got = pg.evaluate("async ()=>{const {data}=await window.__sb.from('don_hang').select('ma_don,trang_thai,la_demo').eq('ma_don','T9-010'); return data&&data[0]||null;}")
    print('  T9-010 DB:', got)
    pg.screenshot(path=str(DL / 'wp15b_l9_1_T9010.png')); print('  ẢNH1:', DL / 'wp15b_l9_1_T9010.png')
    # DevTools Console
    pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(2.0)
    subprocess.run(['screencapture', '-x', str(DL / 'wp15b_l9_3_console.png')]); print('  ẢNH3:', DL / 'wp15b_l9_3_console.png')
    print('  console error (ngoài oneOfType WP-91):', [c for c in CON if 'oneOfType' not in c[1]][:3] or '0')
    b.close()
