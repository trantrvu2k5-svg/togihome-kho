#!/usr/bin/env python3
# WP-13b L-4 · robot PROD app Tài chính "Tham số vận hành" (7 tham số · CEO).
#   C1 vá số trôi: gõ 1.500.000 vào n_cac + 100.000.000 vào n_no qua MÀN → Lưu → SELECT đúng.
#   C4 luật nút: ghi_de 7→8, Lưu, F5, MÀN đọc 8 + SELECT 8, rồi trả về 7 + kiểm về 7.
#   C2 vai: ke_toan mở app KHÔNG thấy khối + ép RPC → từ chối nguyên văn.
#   3 ảnh. test_ceo + test_tc_kiem (ke_toan). Trả mọi số về nguyên trước khi kết thúc.
import sys, time, subprocess, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
tenv = {}
for ln in (pathlib.Path(__file__).resolve().parent.parent / '.env.test').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); tenv[k.strip()] = v.strip()
KTU, KTPW = tenv['TEST_TC_USER'], tenv['TEST_TC_PASS']   # test_tc_kiem = ke_toan
TC = 'https://togihome-taichinh.pages.dev'; KY = '2026-09'; DL = pathlib.Path.home() / 'Downloads'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note else '')); return v
# Điều hướng bằng NÚT THẬT (doiTab('ban')); chờ init settle trước, tự-xác-minh tab-ban ON (chống race doiTab init).
BAN = "()=>{const b=document.querySelector('#tc .navi[data-tab=\"ban\"]'); if(b) b.click();}"
def cho_init(pg):  # chờ init doiTab(mặc định) đã fire (ceo→dieuhanh, ke_toan→dongtien) để toban sau KHÔNG bị đè
    pg.wait_for_function("()=>document.querySelector('#tc .tabp.on')", timeout=15000)
def toban(pg):
    for _ in range(4):
        pg.evaluate(BAN); pg.wait_for_timeout(500)
        if pg.evaluate("()=>{const b=document.getElementById('tab-ban');return !!(b&&b.classList.contains('on'))}"): return
    raise RuntimeError('toban: không chuyển được sang tab Định giá bán')
def sel(pg):   # SELECT n_cac/n_no/ghi_de từ DB qua client (có SELECT grant)
    return pg.evaluate("async (ky)=>{const{data}=await window.__sb.from('tham_so_tai_chinh').select('n_cac,n_no,ghi_de,gio_mo_cua').eq('ma_ky',ky).single();return data;}", KY)
def o_dung_man(pg):  # XÁC NHẬN đang ở màn Định giá bán + khối tsv hiện (luật robot-nav WP-14b)
    return pg.evaluate("()=>{const b=document.getElementById('tsv_wrap');return !!(b&&b.offsetParent!==null)&&document.getElementById('tab-ban').classList.contains('on');}")
def snap(pg, out):  # ẢNH NỘI DUNG: Playwright screenshot bắt ĐÚNG DOM (miễn nhiễm tranh focus cửa sổ)
    toban(pg); pg.evaluate("()=>document.getElementById('tsv_wrap').scrollIntoView({block:'start'})"); pg.wait_for_timeout(500)
    assert o_dung_man(pg), 'CHƯA ở màn Định giá bán — không chụp'
    pg.screenshot(path=str(out)); print('  ẢNH:', out)
def snap_dt(pg, out):  # ẢNH DevTools THẬT (đúng snap_devtools L-3 đã chạy được): toban → activate → Cmd+Opt+I/J → chụp
    toban(pg); assert o_dung_man(pg), 'CHƯA ở màn Định giá bán — không chụp devtools'
    pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(2.0)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1600,1000', '--window-position=0,0', '--disable-notifications'])

    # ═══ VÒNG CEO ═══
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}); pg = ctx.new_page()
    ce = []
    pg.on('console', lambda m: ce.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(1500)
    cho_init(pg); toban(pg); pg.wait_for_selector('#tsv_wrap', state='attached', timeout=20000); pg.wait_for_timeout(800)

    # đúng màn: khối 7 tham số hiện (CEO) + kỳ 2026-09 + số thật đã nạp
    vis = pg.evaluate("()=>{const b=document.getElementById('tsv_wrap');return {hien:b&&b.offsetParent!==null, ky:(document.getElementById('tsv_ky')||{}).textContent, ncac:(document.getElementById('tsv_ncac')||{}).value, nno:(document.getElementById('tsv_nno')||{}).value, ghide:(document.getElementById('tsv_ghide')||{}).value, giomo:(document.getElementById('tsv_gio_mo')||{}).value};}")
    print('  màn CEO:', json.dumps(vis, ensure_ascii=False))
    chk('C5-1 khối 7 tham số HIỆN (CEO) · kỳ 2026-09 · số thật đã nạp', vis['hien'] and vis['ky'] == KY and vis['ncac'] not in ('', None) and vis['ghide'] not in ('', None))
    db0 = sel(pg); print('  DB trước:', json.dumps(db0, ensure_ascii=False))
    snap(pg, DL / 'wp13b_l4_1_khoi.png')

    # ── C1 (vá số trôi) + C4 (ghi_de 7→8): gõ qua MÀN rồi bấm Lưu (luật nút: thấy selector nút Lưu rồi mới bấm) ──
    orig_cac, orig_no, orig_ghide = db0['n_cac'], db0['n_no'], db0['ghi_de']
    toban(pg); pg.wait_for_timeout(300)
    chk('C4 thấy nút Lưu hiện trên MÀN trước khi bấm (luật nút)',
        pg.evaluate("()=>{const e=document.getElementById('tsv_luu');return !!(e&&e.offsetParent!==null);}"))
    # gõ THẬT: set value + dispatch input (fmtMoneyEl chạy → dataset.raw)
    setfld = "([id,v])=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}"
    pg.evaluate(setfld, ['tsv_ncac', '1.500.000'])
    pg.evaluate(setfld, ['tsv_nno', '100.000.000'])
    pg.evaluate(setfld, ['tsv_ghide', '8'])
    n0 = len(ce)
    pg.evaluate("()=>document.getElementById('tsv_luu').click()"); pg.wait_for_timeout(2600)
    loi = pg.evaluate("()=>({loi:(document.getElementById('tsv_loi')||{}).textContent, vet:(document.getElementById('tsv_vet')||{}).textContent});")
    db1 = sel(pg); print('  DB sau Lưu:', json.dumps(db1, ensure_ascii=False), '· msg:', json.dumps(loi, ensure_ascii=False))
    chk('C1 n_cac=1.500.000 gõ MÀN → SELECT = 1500000 (không 15, không 1500000000)', str(db1['n_cac']) == '1500000', 'n_cac=' + str(db1['n_cac']))
    chk('C1 n_no=100.000.000 gõ MÀN → SELECT = 100000000', str(db1['n_no']) == '100000000', 'n_no=' + str(db1['n_no']))
    chk('C4 ghi_de 7→8: SELECT = 8', str(db1['ghi_de']) == '8', 'ghi_de=' + str(db1['ghi_de']))
    chk('C4 không banner đỏ khi Lưu (tsv_loi không ❌)', '❌' not in (loi['loi'] or ''), 'loi=' + str(loi['loi']))
    chk('C5-2 dòng vết sửa hiện ai/lúc nào sau Lưu', bool(loi['vet'] and 'Sửa gần nhất' in loi['vet']), 'vet=' + str(loi['vet']))
    snap(pg, DL / 'wp13b_l4_2_vet.png')

    # ── C4 F5: đọc lại từ MÀN thấy 8 ──
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=20000); pg.wait_for_timeout(1500)
    cho_init(pg); toban(pg); pg.wait_for_selector('#tsv_ghide', state='attached', timeout=15000); pg.wait_for_timeout(800)
    ghide_f5 = pg.evaluate("()=>document.getElementById('tsv_ghide').value")
    chk('C4 F5 → MÀN đọc lại ghi_de = 8', str(ghide_f5) == '8', 'f5=' + str(ghide_f5))

    # ── Trả về nguyên (ghi_de→7, n_cac/n_no→orig) qua MÀN + Lưu ──
    pg.evaluate(setfld, ['tsv_ghide', str(orig_ghide)])
    pg.evaluate(setfld, ['tsv_ncac', str(orig_cac)])
    pg.evaluate(setfld, ['tsv_nno', str(orig_no)])
    pg.evaluate("()=>document.getElementById('tsv_luu').click()"); pg.wait_for_timeout(2500)
    db2 = sel(pg); print('  DB sau trả:', json.dumps(db2, ensure_ascii=False))
    chk('C4 trả về: ghi_de=' + str(orig_ghide) + ' · n_cac/n_no về nguyên',
        str(db2['ghi_de']) == str(orig_ghide) and str(db2['n_cac']) == str(orig_cac) and str(db2['n_no']) == str(orig_no),
        json.dumps(db2, ensure_ascii=False))

    snap_dt(pg, DL / 'wp13b_l4_3_console.png')
    loi_console = ce[n0:]
    chk('C4 console 0 lỗi suốt Lưu/F5/trả', len(loi_console) == 0, json.dumps(loi_console[:3], ensure_ascii=False))
    print('  CONSOLE lỗi tổng:', len(loi_console), json.dumps(loi_console[:3], ensure_ascii=False))
    ctx.close()

    # ═══ VÒNG KE_TOAN (C2) ═══
    ctx2 = b.new_context(viewport={'width': 1400, 'height': 800}); pg2 = ctx2.new_page()
    pg2.goto(TC, wait_until='domcontentloaded'); pg2.wait_for_timeout(1200)
    pg2.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [KTU, KTPW])
    pg2.goto(TC, wait_until='domcontentloaded'); pg2.wait_for_function("()=>window.__sb", timeout=25000); pg2.wait_for_timeout(1500)
    cho_init(pg2); toban(pg2); pg2.wait_for_timeout(1000)
    hien_kt = pg2.evaluate("()=>{const b=document.getElementById('tsv_wrap');return !!(b&&b.offsetParent!==null);}")
    chk('C2 ke_toan mở app → KHÔNG thấy khối 7 tham số', hien_kt is False, 'hien=' + str(hien_kt))
    rpc_kt = pg2.evaluate("""async ()=>{const{error}=await window.__sb.rpc('luu_cau_hinh_van_hanh',{p_ma_ky:'2026-09',p_vat:10,p_gio_mo_cua:['01:00','13:00'],p_ghi_de:7,p_n_ads:22,p_n_cac:1500000,p_n_kg:16,p_n_no:100000000,p_n_giam:8});return error?error.message:'LỌT!';}""")
    chk('C2 ke_toan ép gọi RPC → từ chối nguyên văn (chỉ CEO)', 'CEO' in (rpc_kt or ''), 'rpc=' + str(rpc_kt))
    ctx2.close(); b.close()

okall = all(res.values())
print(f'\n═══ robot_wp13b_l4: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
