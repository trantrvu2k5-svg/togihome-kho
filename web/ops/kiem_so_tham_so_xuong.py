#!/usr/bin/env python3
# WP-11d [A] · CỔNG KIỂM CUỐI: app Tài chính → tab Sổ tham số xưởng → Lưu ĐÚNG số đang hiện (RPC ghi_so_tham_so_xuong).
#   Sau khi revoke luong_to (db/215), đường ghi client = RPC. Robot bấm Lưu THẬT, 3 vé: banner · console THẬT · F5 khớp.
#   Tài khoản test_ceo (.env.robot, QD-51) — CẤM đổi mật khẩu. Lưu chính nó → KHÔNG đổi số (md5 giữ nguyên).
import sys, time, subprocess, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
APP = 'https://togihome-taichinh.pages.dev'
OUT = pathlib.Path.home() / 'Downloads' / 'wp11d_so_tham_so_xuong.png'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note and not v else '')); return v

snap = "() => Array.from(document.querySelectorAll('#s6_luong input, #s6_pct input')).map(e => e.value).join('|')"

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1600,1000', '--window-position=0,0', '--disable-notifications', '--auto-open-devtools-for-tabs'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 720})
    pg = ctx.new_page()
    cerr = []
    pg.on('console', lambda m: cerr.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.goto(APP, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(APP, wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
    # tới tab Sổ tham số xưởng (click nav qua JS cho chắc handler)
    pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on', p.id==='tab-xuong'));document.querySelectorAll('#tc .navi').forEach(b=>b.classList.toggle('on', b.dataset.tab==='xuong'));}")
    pg.wait_for_selector('#s6_luong input', state='attached', timeout=20000); pg.wait_for_timeout(1200)
    pg.evaluate("()=>document.getElementById('s6_luu')?.scrollIntoView({block:'center'})")
    vis = pg.locator('#s6_luu').is_visible()
    print('  tab Xưởng hiện (s6_luu visible):', vis)
    before = pg.evaluate(snap)
    ky = pg.evaluate("()=>document.getElementById('s6_ky')?.textContent||''")
    print('  kỳ đang hiện:', ky, '· số ô S6:', len(before.split('|')))
    n0 = len(cerr)
    # bấm Lưu (ĐÚNG số đang hiện → lưu lại chính nó) — JS click bỏ qua strict-visible
    pg.evaluate("()=>document.getElementById('s6_luu').click()"); pg.wait_for_timeout(2800)
    msg = pg.locator('#s6_msg').inner_text().strip()
    print('  s6_msg:', msg)
    chk('B1 Lưu → "Đã lưu" (RPC ghi_so_tham_so_xuong chạy qua UI)', 'Đã lưu' in msg and '❌' not in msg and '⚠' not in msg, msg)
    apperr = cerr[n0:]
    chk('B2 (i) không banner đỏ + (ii) console THẬT 0 lỗi đỏ khi Lưu', ('❌' not in msg) and len(apperr) == 0, 'console=' + json.dumps(apperr[:2], ensure_ascii=False))
    # F5, quay lại tab, đọc lại
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
    pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on', p.id==='tab-xuong'));document.querySelectorAll('#tc .navi').forEach(b=>b.classList.toggle('on', b.dataset.tab==='xuong'));}")
    pg.wait_for_selector('#s6_luong input', state='attached', timeout=20000); pg.wait_for_timeout(1200)
    pg.evaluate("()=>document.getElementById('s6_luu')?.scrollIntoView({block:'center'})")
    after = pg.evaluate(snap)
    chk('B3 (iii) F5 đọc lại từ màn KHỚP số trước khi Lưu', after == before, 'trước≠sau')
    # DevTools THẬT tab Console TRƯỚC (osascript focus có thể reset tab app)
    pg.bring_to_front(); time.sleep(0.5)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(1.0)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "i" using {command down, option down}']); time.sleep(1.2)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(1.5)
    # toggle sang tab Xưởng NGAY TRƯỚC chụp (sau khi focus đã ổn định)
    pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on', p.id==='tab-xuong'));document.querySelectorAll('#tc .navi').forEach(b=>b.classList.toggle('on', b.dataset.tab==='xuong'));document.getElementById('s6_luu')?.scrollIntoView({block:'center'});}")
    time.sleep(1.0)
    visf = pg.locator('#s6_luu').is_visible(); print('  tab Xưởng hiện lúc chụp:', visf)
    subprocess.run(['screencapture', '-x', str(OUT)])
    print('  CONSOLE app (error, cả phiên):', len(cerr), cerr[:3])
    print('  ẢNH:', OUT, OUT.exists())
    ctx.close(); b.close()
ok = all(res.values())
print('\n═══ kiem_so_tham_so_xuong: ' + str(sum(res.values())) + '/' + str(len(res)) + (' ĐẠT' if ok else ' CÓ LỖI') + ' ═══')
sys.exit(0 if ok else 1)
