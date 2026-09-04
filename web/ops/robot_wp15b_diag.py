#!/usr/bin/env python3
# WP-15b (1) · CHẨN ĐOÁN harness demo_phong_hop bước 1 (Sale lên đơn). CHỈ chạy + bắt lỗi, KHÔNG sửa app.
#   Lặp lại flow bước 1 của demo_phong_hop, BẮT: console · pageerror · MỌI response 4xx/5xx (status+url+body nguyên văn).
#   test_ceo (.env.robot) — như demo_phong_hop. Kết luận HARNESS vs APP theo response thật.
import sys, time, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']
SALE = 'https://togihome-sale.pages.dev'; DL = pathlib.Path.home() / 'Downloads'
NET = []   # (status, method, url, body)
CON = []

def on_resp(r):
    try:
        if r.status >= 400 and ('/rest/' in r.url or '/rpc/' in r.url or '/auth/' in r.url):
            body = ''
            try: body = r.text()[:600]
            except Exception: body = '(không đọc được body)'
            NET.append((r.status, r.request.method, r.url.split('togihome-sale.pages.dev')[-1] if 'sale' in r.url else r.url, body))
    except Exception: pass

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1500,950', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1500, 'height': 850}).new_page()
    pg.on('response', on_resp)
    pg.on('console', lambda m: CON.append((m.type, m.text[:180])) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: CON.append(('pageerror', str(e)[:180])))
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(2000)

    pre = pg.evaluate("async ()=>{const {data}=await window.__sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO%'); return (data||[]).map(x=>x.ma_don);}")
    demo_pre = set(pre or [])
    print(f'đơn DEMO đang có (trước): {len(demo_pre)}')
    NET.clear()  # chỉ giữ lỗi TỪ lúc bấm

    ok_created = False; err_flow = ''
    try:
        try: pg.get_by_text('Sổ đơn hàng', exact=True).first.click(timeout=4000); time.sleep(1)
        except PWTimeout: print("  ⚠ không thấy nav 'Sổ đơn hàng'")
        pg.get_by_role('button', name='+ Lên đơn', exact=True).click(timeout=6000)
        pg.get_by_placeholder('0903 792 333').wait_for(timeout=6000)
        pg.get_by_placeholder('Chị Lan').fill('DEMO Phòng họp WP15b')
        pg.get_by_placeholder('0903 792 333').fill('0900000009')
        pg.get_by_placeholder('Số nhà, đường, phường, quận').fill('DEMO — chẩn đoán WP15b')
        pg.get_by_placeholder('Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm').first.fill('Tủ áo 2 cánh 1200 (DEMO WP15b)')
        pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill('9000000')
        for _round in range(2):
            sels = pg.locator('select'); n = sels.count()
            for i in range(n):
                s = sels.nth(i)
                try:
                    if s.is_visible() and (s.input_value() or '') == '': s.select_option(index=1); time.sleep(0.2)
                except Exception: pass
        mon_dump = pg.evaluate("""() => { const m=document.querySelector('.mon'); if(!m) return 'KHÔNG .mon';
            return [...m.querySelectorAll('input,select')].map(e=>e.tagName.toLowerCase()+'['+(e.getAttribute('placeholder')||e.getAttribute('inputmode')||e.type||'')+']="'+(e.value||'').slice(0,18)+'"').join('  '); }""")
        print('  .mon ô:', mon_dump)
        print('  → bấm "Lưu đơn"…')
        pg.get_by_role('button', name='Lưu đơn', exact=True).click(timeout=6000)
        time.sleep(2)
        thieu = ''
        try:
            if pg.get_by_text('Còn thiếu:', exact=False).count(): thieu = pg.get_by_text('Còn thiếu:', exact=False).first.inner_text()[:150]
        except Exception: pass
        found = None
        for _ in range(24):
            now = pg.evaluate("async ()=>{const {data}=await window.__sb.from('don_hang').select('ma_don,la_demo,id').ilike('ten_khach','DEMO%').order('tao_luc',{ascending:false}); return data||[];}")
            for row in (now or []):
                if row['ma_don'] not in demo_pre: found = row; break
            if found: break
            time.sleep(0.5)
        pg.screenshot(path=str(DL / 'wp15b_diag_ket.png'))
        if found:
            ok_created = True
            print(f'  ✅ TẠO ĐƯỢC đơn DEMO mới: {found["ma_don"]} (la_demo={found["la_demo"]})')
            # dọn đơn mình vừa tạo (không để rác)
            try:
                r = pg.evaluate("async (id)=>{const {error}=await window.__sb.rpc('xoa_demo'); return error?error.message:'ok';}")
                print('  dọn xoa_demo:', r)
            except Exception as e: print('  ⚠ dọn:', str(e)[:80])
        else:
            print(f'  ❌ KHÔNG tạo được đơn DEMO. App báo thiếu: {thieu or "(không banner)"}')
    except Exception as e:
        err_flow = f'{type(e).__name__}: {str(e)[:160]}'
        print('  ❌ FLOW LỖI:', err_flow)
        try: pg.screenshot(path=str(DL / 'wp15b_diag_ket.png'))
        except Exception: pass

    print('\n═══ HTTP 4xx/5xx TỪ LÚC BẤM (nguyên văn) ═══')
    if not NET: print('  (không có response 4xx/5xx)')
    for st, mth, url, body in NET:
        print(f'  [{st} {mth}] {url}')
        print(f'     body: {body}')
    print('\n═══ CONSOLE (error/warning/pageerror) ═══')
    for t, tx in CON[:12]: print(f'  [{t}] {tx}')
    print(f'\n═══ KẾT: {"TẠO ĐƯỢC (harness cần soi selector/flow)" if ok_created else "KHÔNG tạo được"} · flow_err={err_flow or "none"} ═══')
    b.close()
