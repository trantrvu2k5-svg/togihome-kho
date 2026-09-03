#!/usr/bin/env python3
# WP-11d [B] · robot 2 màn nhập tham_so_tai_chinh (Tài chính "Định giá bán" + Sale cấu hình c2:cfg).
#   Dùng 2 vòng: trước revoke (vong1) và sau revoke (vong2). Mỗi màn: đổi 1 ô ÍT NGHĨA TIỀN → Lưu →
#   SELECT thấy đổi → trả lại giá trị cũ → SELECT về nguyên. 3 vé: banner · console THẬT · F5 khớp.
#   test_ceo (.env.robot). Đổi rồi TRẢ LẠI → md5 giữ nguyên.
import sys, time, subprocess, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
NHAN = sys.argv[1] if len(sys.argv) > 1 else 'vong'
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
TC = 'https://togihome-taichinh.pages.dev'; SALE = 'https://togihome-sale.pages.dev'
KY = '2026-08'; DL = pathlib.Path.home() / 'Downloads'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note and not v else '')); return v
def devtools(pg, out):
    pg.bring_to_front(); time.sleep(0.4)
    subprocess.run(['osascript', '-e', 'tell application "Google Chrome for Testing" to activate']); time.sleep(0.9)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "i" using {command down, option down}']); time.sleep(1.1)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "j" using {command down, option down}']); time.sleep(1.6)
    subprocess.run(['screencapture', '-x', str(out)]); print('  ẢNH:', out)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1600,1000', '--window-position=0,0', '--disable-notifications', '--auto-open-devtools-for-tabs'])

    # ═══════════ APP TÀI CHÍNH · tab Định giá bán · ô ghi_chu ═══════════
    ctx = b.new_context(viewport={'width': 1600, 'height': 720}); pg = ctx.new_page()
    ce = []
    pg.on('console', lambda m: ce.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(TC, wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
    pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on',p.id==='tab-ban'));document.querySelectorAll('#tc .navi').forEach(x=>x.classList.toggle('on',x.dataset.tab==='ban'));}")
    pg.wait_for_selector('#ghichu', state='attached', timeout=20000); pg.wait_for_timeout(1000)
    seldb = "async (ky)=>{const{data}=await window.__sb.from('tham_so_tai_chinh').select('ghi_chu').eq('ma_ky',ky).single();return data.ghi_chu;}"
    setgc = "(v)=>{const e=document.getElementById('ghichu'); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}"
    luu = "()=>document.getElementById('btn_luu').click()"
    old_gc = pg.eval_on_selector('#ghichu', 'el=>el.value')
    marker = 'WP11D-' + NHAN + ' ' + time.strftime('%H:%M:%S')
    n0 = len(ce)
    pg.evaluate(setgc, marker); pg.evaluate(luu); pg.wait_for_timeout(2200)
    msg = pg.locator('#luu_msg').inner_text().strip()
    db_new = pg.evaluate(seldb, KY)
    chk(f'TC[{NHAN}] Lưu ghi_chu → "đã lưu" + SELECT thấy ĐỔI', ('đã lưu' in msg and '❌' not in msg) and db_new == marker, 'msg=' + msg + ' db=' + str(db_new))
    chk(f'TC[{NHAN}] 3vé: (i)không banner ❌ (ii)console THẬT 0 lỗi khi Lưu', ('❌' not in msg) and len(ce[n0:]) == 0, 'console=' + json.dumps(ce[n0:][:2], ensure_ascii=False))
    # trả lại giá trị cũ
    pg.evaluate(setgc, old_gc or ''); pg.evaluate(luu); pg.wait_for_timeout(2200)
    db_res = pg.evaluate(seldb, KY)
    chk(f'TC[{NHAN}] trả lại giá trị cũ → SELECT về nguyên', db_res == old_gc, 'cũ=' + str(old_gc) + ' nay=' + str(db_res))
    # F5 vé
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
    pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on',p.id==='tab-ban'));document.querySelectorAll('#tc .navi').forEach(x=>x.classList.toggle('on',x.dataset.tab==='ban'));}")
    pg.wait_for_selector('#ghichu', state='attached', timeout=20000); pg.wait_for_timeout(800)
    f5 = pg.eval_on_selector('#ghichu', 'el=>el.value')
    chk(f'TC[{NHAN}] (iii) F5 màn đọc lại khớp giá trị cũ', f5 == (old_gc or ''), 'f5=' + str(f5))
    print(f'  TC cũ→mới→trả: {old_gc!r} → {marker!r} → {db_res!r}')
    if NHAN == 'vong2':
        pg.evaluate("()=>{document.querySelectorAll('#tc .tabp').forEach(p=>p.classList.toggle('on',p.id==='tab-ban'));document.querySelectorAll('#tc .navi').forEach(x=>x.classList.toggle('on',x.dataset.tab==='ban'));document.getElementById('btn_luu')?.scrollIntoView({block:'center'});}")
        devtools(pg, DL / 'wp11d_taichinh_dinhgiaban.png')
    ctx.close()

    # ═══════════ APP SALE · cấu hình c2:cfg · ô gio_mo_cua (giờ, ít nghĩa tiền nhất) ═══════════
    ctx2 = b.new_context(viewport={'width': 1600, 'height': 720}); pg2 = ctx2.new_page()
    ce2 = []
    pg2.on('console', lambda m: ce2.append(m.text) if m.type == 'error' and 'chrome-extension' not in (m.location or {}).get('url', '') else None)
    pg2.goto(SALE, wait_until='domcontentloaded'); pg2.wait_for_timeout(1200)
    pg2.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg2.goto(SALE, wait_until='domcontentloaded'); pg2.wait_for_function("()=>window.storage&&window.__sb", timeout=25000); pg2.wait_for_timeout(1000)
    # PHÁT SINH: cả 2 kỳ cùng ngay_ap_dung=2026-07-01 → sale.js:319 chọn kỳ BẤT ĐỊNH. Robot dò kỳ THỰC bị đổi.
    two = "async ()=>{const{data}=await window.__sb.from('tham_so_tai_chinh').select('ma_ky,gio_mo_cua').order('ma_ky');return data.map(r=>[r.ma_ky,JSON.stringify(r.gio_mo_cua)]);}"
    before = dict(pg2.evaluate(two))
    # SAVE qua ĐÚNG đường app (window.storage.set), gio ARRAY
    saveres = pg2.evaluate("""async ()=>{
        const {data:r}=await window.__sb.rpc('cau_hinh_sale'); const c=r||{};
        const payload={vat:c.vat, gio:["02:00","14:00"], ghiDe:c.ghi_de, nAds:c.n_ads, nCac:c.n_cac, nKg:c.n_kg, nNo:c.n_no, nGiam:c.n_giam};
        try{ await window.storage.set('c2:cfg', JSON.stringify(payload)); return 'OK'; }catch(e){ return 'ERR:'+(e.message||e); }
    }""")
    pg2.wait_for_timeout(1200)
    n2 = len(ce2)
    after = dict(pg2.evaluate(two))
    target = next((k for k in after if after[k] == '["02:00","14:00"]' and before[k] != '["02:00","14:00"]'), None)
    chk(f'SALE[{NHAN}] set c2:cfg (gio) qua window.storage → 1 kỳ ĐỔI thành ["02:00","14:00"]', saveres == 'OK' and target is not None, 'save=' + str(saveres) + ' after=' + json.dumps(after))
    chk(f'SALE[{NHAN}] 3vé: (i)không lỗi save (ii)console THẬT 0 lỗi khi set', saveres == 'OK' and len(ce2[n2:]) == 0, 'console=' + json.dumps(ce2[n2:][:2], ensure_ascii=False))
    # trả lại ĐÚNG kỳ đó qua RPC trực tiếp (bỏ qua tie), gio cũ của chính kỳ đó
    old_gio = before.get(target, '["01:00","13:00"]')
    restore = pg2.evaluate("""async ([mk, gioCu])=>{
        const {data:r}=await window.__sb.rpc('cau_hinh_sale'); const c=r||{};
        const {error}=await window.__sb.rpc('luu_cau_hinh_van_hanh', {p_ma_ky:mk, p_vat:c.vat, p_gio_mo_cua:JSON.parse(gioCu), p_ghi_de:c.ghi_de, p_n_ads:c.n_ads, p_n_cac:c.n_cac, p_n_kg:c.n_kg, p_n_no:c.n_no, p_n_giam:c.n_giam});
        return error?('ERR:'+error.message):'OK';
    }""", [target, old_gio])
    pg2.wait_for_timeout(800)
    gio_res = dict(pg2.evaluate(two)).get(target)
    chk(f'SALE[{NHAN}] trả lại giờ cũ (kỳ {target}) → SELECT về nguyên', restore == 'OK' and gio_res == old_gio, 'cũ=' + str(old_gio) + ' nay=' + str(gio_res))
    print(f'  SALE kỳ {target} cũ→mới→trả: {old_gio} → ["02:00","14:00"] → {gio_res}')
    if NHAN == 'vong2':
        devtools(pg2, DL / 'wp11d_sale_cauhinh.png')
    ctx2.close(); b.close()

okall = all(res.values())
print(f'\n═══ kiem_tham_so_ui[{NHAN}]: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
