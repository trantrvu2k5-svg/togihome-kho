#!/usr/bin/env python3
# WP-13b L-3 · robot PROD app Tài chính "Định giá bán": khối Mở kỳ mới + banner chưa-soát.
#   Bấm THẬT nút "Mở kỳ 2026-10" → kỳ đổi + banner vàng → bấm Xác nhận → banner mất. 4 ảnh prod.
#   Luật nút (bấm thật, thấy dữ liệu đổi) + luật ảnh (DevTools mở thật) + luật robot-nav (xác nhận ĐÚNG màn trước khi chụp).
#   test_ceo (.env.robot). KHÔNG dọn ở đây — dọn kỳ 2026-10 bằng script owner sau (C4).
import sys, time, subprocess, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
TC = 'https://togihome-taichinh.pages.dev'
DL = pathlib.Path.home() / 'Downloads'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note else '')); return v
BAN = "()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on',p.id==='tab-ban'));document.querySelectorAll('#tc .navi').forEach(x=>x.classList.toggle('on',x.dataset.tab==='ban'));}"
def toban(pg):  # về tab Định giá bán (doiTab nội bộ → toggle classList)
    pg.evaluate(BAN); pg.wait_for_timeout(400)
def snap(pg, out):  # chụp cửa sổ Chrome (không devtools)
    toban(pg); pg.bring_to_front(); time.sleep(0.5)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.8)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)
def snap_devtools(pg, out):  # DevTools MỞ THẬT tab Console
    toban(pg); pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "i" using {command down, option down}']); time.sleep(1.1)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(1.6)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1600,1000', '--window-position=0,0', '--disable-notifications'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 820}); pg = ctx.new_page()
    ce = []
    pg.on('console', lambda m: ce.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(1500)
    toban(pg); pg.wait_for_selector('#tsk_moky', state='attached', timeout=20000); pg.wait_for_timeout(800)

    # ── XÁC NHẬN ĐÚNG MÀN trước ảnh 1: khối Mở kỳ hiện + nút "Mở kỳ 2026-10" ──
    vis = pg.evaluate("()=>{const b=document.getElementById('tsk_moky');return {hien:b&&b.offsetParent!==null, nut:(document.getElementById('tsk_mo')||{}).textContent, moi:(document.getElementById('tsk_ky_moi')||{}).textContent, nguon:(document.getElementById('tsk_ky_nguon')||{}).textContent, tabban:document.getElementById('tab-ban').classList.contains('on')};}")
    print('  màn:', json.dumps(vis, ensure_ascii=False))
    chk('1 khối Mở kỳ hiện · kỳ liền sau=2026-10 · nguồn=2026-09 (đúng màn)',
        vis['hien'] and vis['tabban'] and vis['moi'] == '2026-10' and vis['nguon'] == '2026-09' and 'Mở kỳ 2026-10' in (vis['nut'] or ''))
    pg.evaluate("()=>document.getElementById('tsk_mo').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
    snap(pg, DL / 'wp13b_l3_1_truoc.png')

    # ── C2: ghi giờ, BẤM THẬT nút Mở kỳ 2026-10 (JS .click() = kích hoạt onclick thật, như robot mẫu) ──
    gio_mo = time.strftime('%Y-%m-%d %H:%M:%S')
    print('  ⏱ BẤM Mở kỳ lúc:', gio_mo)
    n0 = len(ce)
    pg.evaluate("()=>document.getElementById('tsk_mo').click()"); pg.wait_for_timeout(2600)
    # thấy dữ liệu đổi: #ky = 2026-10 + banner vàng "chưa ai soát"
    st = pg.evaluate("()=>{return {ky:document.getElementById('ky').value, loi:(document.getElementById('tsk_loi')||{}).textContent, banner:(document.getElementById('tsk_banner')||{}).style.display, btxt:(document.getElementById('tsk_banner_txt')||{}).textContent};}")
    print('  sau bấm:', json.dumps(st, ensure_ascii=False))
    chk('2 sau bấm: ô Kỳ = 2026-10 (giá nhảy sang kỳ mới)', st['ky'] == '2026-10', 'ky=' + str(st['ky']) + ' loi=' + str(st['loi']))
    chk('2 banner vàng chưa-soát hiện + đúng chữ', st['banner'] != 'none' and 'chưa ai soát' in (st['btxt'] or ''), 'banner=' + str(st['banner']) + ' txt=' + str(st['btxt']))
    snap_devtools(pg, DL / 'wp13b_l3_2_sau_mo.png')

    # ── BẤM THẬT Xác nhận → banner biến mất ngay (không F5) ──
    # đóng devtools để thao tác nút (tránh focus devtools)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "i" using {command down, option down}']); time.sleep(0.8)
    toban(pg); pg.wait_for_timeout(300)
    pg.evaluate("()=>document.getElementById('tsk_xacnhan').click()"); pg.wait_for_timeout(2200)
    st2 = pg.evaluate("()=>{return {banner:(document.getElementById('tsk_banner')||{}).style.display, xnloi:(document.getElementById('tsk_xn_loi')||{}).textContent, ky:document.getElementById('ky').value};}")
    print('  sau xác nhận:', json.dumps(st2, ensure_ascii=False))
    chk('3 sau Xác nhận: banner biến mất ngay (không F5)', st2['banner'] == 'none' and st2['ky'] == '2026-10', 'banner=' + str(st2['banner']) + ' xnloi=' + str(st2['xnloi']))
    snap(pg, DL / 'wp13b_l3_3_da_xac_nhan.png')

    # ── Ảnh 4: DevTools Console mở thật ──
    snap_devtools(pg, DL / 'wp13b_l3_4_console.png')
    loi_console = ce[n0:]
    chk('4 console 0 lỗi khi mở kỳ + xác nhận', len(loi_console) == 0, 'lỗi=' + json.dumps(loi_console[:3], ensure_ascii=False))

    print('  ⏱ giờ BẤM MỞ KỲ:', gio_mo)
    print('  CONSOLE lỗi tổng:', len(loi_console), json.dumps(loi_console[:3], ensure_ascii=False))
    ctx.close(); b.close()

okall = all(res.values())
print(f'\n═══ robot_wp13b_l3: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
