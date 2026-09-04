#!/usr/bin/env python3
# WP-13b L-6 D3 · 2 ảnh prod app Tài chính "Định giá bán": dòng "Kỳ đang áp giá" + DevTools Console.
import sys, time, subprocess, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']; TC = 'https://togihome-taichinh.pages.dev'; DL = pathlib.Path.home() / 'Downloads'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note else '')); return v
BAN = "()=>{const b=document.querySelector('#tc .navi[data-tab=\"ban\"]'); if(b) b.click();}"
def cho_init(pg): pg.wait_for_function("()=>document.querySelector('#tc .tabp.on')", timeout=15000)
def toban(pg):
    for _ in range(4):
        pg.evaluate(BAN); pg.wait_for_timeout(500)
        if pg.evaluate("()=>{const b=document.getElementById('tab-ban');return !!(b&&b.classList.contains('on'))}"): return
    raise RuntimeError('toban fail')
def odung(pg): return pg.evaluate("()=>{const e=document.getElementById('tsk_apgia');return !!(e&&e.offsetParent!==null)&&document.getElementById('tab-ban').classList.contains('on');}")
def snap(pg, out):  # macOS capture; toban LẠI ngay sau activate (init taiDieuHanh có thể lật tab) rồi chụp ngay
    toban(pg); pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    toban(pg); assert odung(pg), 'chưa ở màn Định giá bán'; time.sleep(0.4)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)
def snap_dt(pg, out):
    toban(pg); assert odung(pg), 'chưa ở màn'
    pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(2.0)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1500,950', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1500, 'height': 850}).new_page()
    ce = []
    pg.on('console', lambda m: ce.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.on('pageerror', lambda e: ce.append('pageerror:' + str(e)))
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(1500)
    n0 = len(ce)
    cho_init(pg); toban(pg); pg.wait_for_selector('#tsk_apgia', state='attached', timeout=15000); pg.wait_for_timeout(1000)
    st = pg.evaluate("()=>({ky:document.getElementById('ky').value, apgia:(document.getElementById('tsk_apgia')||{}).textContent, cls:(document.getElementById('tsk_apgia')||{}).className})")
    print('  màn:', json.dumps(st, ensure_ascii=False))
    chk('1 kỳ đang xem=2026-09 + dòng "Kỳ đang áp giá: 2026-09" (3 kỳ chưa xác nhận → không lệch)',
        st['ky'] == '2026-09' and 'Kỳ đang áp giá: 2026-09' in (st['apgia'] or '') and 'tsk-loi' not in (st['cls'] or ''))
    snap(pg, DL / 'wp13b_l6_1_apgia.png')
    snap_dt(pg, DL / 'wp13b_l6_2_console.png')
    err = ce[n0:]
    chk('2 console 0 lỗi', len(err) == 0, json.dumps(err[:3], ensure_ascii=False))
    print('  CONSOLE lỗi:', len(err), json.dumps(err[:3], ensure_ascii=False))
    b.close()

okall = all(res.values())
print(f'\n═══ robot_wp13b_l6: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
