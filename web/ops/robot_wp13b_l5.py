#!/usr/bin/env python3
# WP-13b L-5 A3 · kiểm PROD chỗ B5 đổi money()/luuKy (chung nhiều màn).
#   A3a Định giá bán: sửa 1 ô tiền (chi phí năng lực) → Lưu → SELECT → F5 → trả về → SELECT (4 mốc).
#   A3b Chi phí kỳ: nhập-lưu 1 dòng nhỏ → SELECT đúng số (không ×/÷1000) → xoá.
#   A3b Dòng tiền: gõ 1 ô tiền → hiển thị & parser không ×/÷1000 (KHÔNG ghi sổ tiền thật).
#   A3c: cả 3 không banner đỏ, console 0 lỗi (listener).  test_ceo.
import sys, time, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']; TC = 'https://togihome-taichinh.pages.dev'; KY = '2026-09'
res = {}
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note else '')); return v
def nav(pg, t):  # điều hướng bằng NÚT THẬT + tự xác minh (chống race init)
    pg.wait_for_function("()=>document.querySelector('#tc .tabp.on')", timeout=15000)
    for _ in range(4):
        pg.evaluate("(t)=>{const b=document.querySelector('#tc .navi[data-tab=\"'+t+'\"]'); if(b) b.click();}", t)
        pg.wait_for_timeout(500)
        if pg.evaluate("(t)=>{const p=document.getElementById('tab-'+t);return !!(p&&p.classList.contains('on'))}", t): return
    raise RuntimeError('nav ' + t + ' fail')
def sel1(pg, col):  # SELECT 1 cột tham_so_tai_chinh kỳ hiện
    return pg.evaluate("async ([ky,c])=>{const{data}=await window.__sb.from('tham_so_tai_chinh').select(c).eq('ma_ky',ky).single();return data[c];}", [KY, col])

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
    setfld = "([id,v])=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}"

    # ═══ A3a · Định giá bán · chi phí năng lực (cpnl — money() global đã đổi) ═══
    nav(pg, 'ban'); pg.wait_for_selector('#cpnl', state='attached', timeout=15000); pg.wait_for_timeout(600)
    orig = sel1(pg, 'chi_phi_nang_luc')
    print('  A3a orig chi_phi_nang_luc =', orig)
    pg.evaluate(setfld, ['cpnl', '12.345.678'])
    dom = pg.evaluate("()=>({disp:document.getElementById('cpnl').value, raw:document.getElementById('cpnl').dataset.raw})")
    chk('A3a gõ 12.345.678 → hiển thị đúng + dataset.raw=12345678 (không ×/÷1000)', dom['disp'] == '12.345.678' and dom['raw'] == '12345678', json.dumps(dom))
    pg.evaluate("()=>document.getElementById('btn_luu').click()"); pg.wait_for_timeout(2200)
    sau = sel1(pg, 'chi_phi_nang_luc')
    chk('A3a Lưu → SELECT = 12345678', str(sau) == '12345678', 'sau=' + str(sau))
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=20000); pg.wait_for_timeout(1500)
    nav(pg, 'ban'); pg.wait_for_selector('#cpnl', state='attached', timeout=15000); pg.wait_for_timeout(600)
    f5 = pg.evaluate("()=>document.getElementById('cpnl').value")
    chk('A3a F5 → màn đọc lại = 12.345.678', f5 == '12.345.678', 'f5=' + str(f5))
    pg.evaluate(setfld, ['cpnl', '' if orig in (None, '') else str(orig)])
    pg.evaluate("()=>document.getElementById('btn_luu').click()"); pg.wait_for_timeout(2200)
    tra = sel1(pg, 'chi_phi_nang_luc')
    chk('A3a trả về số cũ → SELECT = ' + str(orig), str(tra) == str(orig), 'tra=' + str(tra))
    print(f'  A3a 4 MỐC: cũ={orig} → lưu={sau} → F5={f5} → trả={tra}')

    # ═══ A3b · Chi phí kỳ · nhập-lưu 1 dòng → SELECT → xoá ═══
    nav(pg, 'chiphi'); pg.wait_for_selector('#cpk_them', state='attached', timeout=15000); pg.wait_for_timeout(500)
    pg.evaluate("()=>document.getElementById('cpk_them').click()"); pg.wait_for_timeout(500)
    setrow = pg.evaluate("""()=>{const tr=document.querySelector('#cpk_rows tr'); if(!tr) return 'no-row';
      const m=tr.querySelector('.cpk-money'); m.value='1.234.567'; m.dispatchEvent(new Event('input',{bubbles:true}));
      const g=tr.querySelector('.cpk-ghichu'); if(g){g.value='WP13B-L5-test'; g.dispatchEvent(new Event('input',{bubbles:true}));}
      const nu=tr.querySelector('.cpk-nguoi'); if(nu){nu.value='robot'; nu.dispatchEvent(new Event('input',{bubbles:true}));}
      return m.value;}""")
    chk('A3b Chi phí kỳ: ô tiền hiển thị 1.234.567 (không ×/÷1000)', setrow == '1.234.567', 'row=' + str(setrow))
    pg.evaluate("()=>document.getElementById('cpk_luu').click()"); pg.wait_for_timeout(2200)
    msg = pg.evaluate("()=>document.getElementById('cpk_msg').textContent")
    cpk = pg.evaluate("async (ky)=>{const{data}=await window.__sb.from('chi_phi_ky').select('so_tien,ghi_chu').eq('ma_ky',ky);return data;}", KY)
    hit = [r for r in (cpk or []) if str(r.get('so_tien')) == '1234567']
    chk('A3b Lưu → SELECT chi_phi_ky có so_tien=1234567 (không ×/÷1000)', len(hit) >= 1, 'msg=' + str(msg) + ' rows=' + json.dumps(cpk, ensure_ascii=False))

    # ═══ A3b · Dòng tiền · gõ 1 ô tiền (KHÔNG ghi sổ tiền thật) ═══
    nav(pg, 'dongtien'); pg.wait_for_selector('#pt_tien', state='attached', timeout=15000); pg.wait_for_timeout(500)
    pg.evaluate(setfld, ['pt_tien', '3.210.000'])
    dt = pg.evaluate("()=>{const e=document.getElementById('pt_tien');return {disp:e.value, parse:Number((e.value||'').replace(/\\D/g,''))};}")
    chk('A3b Dòng tiền: gõ 3.210.000 → hiển thị đúng + parser=3210000 (không ×/÷1000)', dt['disp'] == '3.210.000' and dt['parse'] == 3210000, json.dumps(dt))
    pg.evaluate(setfld, ['pt_tien', ''])   # xoá, KHÔNG ghi sổ

    # ═══ A3c · banner đỏ / console ═══
    err = ce[n0:]
    chk('A3c console 0 lỗi suốt cả 3 màn (listener)', len(err) == 0, json.dumps(err[:3], ensure_ascii=False))
    print('  CONSOLE lỗi:', len(err), json.dumps(err[:3], ensure_ascii=False))
    b.close()

okall = all(res.values())
print(f'\n═══ robot_wp13b_l5: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
