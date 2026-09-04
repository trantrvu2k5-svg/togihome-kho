#!/usr/bin/env python3
# WP-15b (2) L-11 · robot PROD app Sale màn Báo giá: nhãn quá hạn + nút "Báo lại theo kỳ" (màn thật).
#   Dựng dữ liệu: DEMO-BGL01 (quá hạn) + DEMO-BGL02 (còn hạn) đã tạo SQL owner (nói rõ ở báo cáo).
import sys, time, pathlib, json
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
env = {}
for ln in pathlib.Path(__file__).with_name('.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and '=' in ln and not ln.startswith('#'):
        k, v = ln.split('=', 1); env[k.strip()] = v.strip()
U, PW = env['TEST_CEO_EMAIL'], env['TEST_CEO_PASS']; SALE = 'https://togihome-sale.pages.dev'; DL = pathlib.Path.home() / 'Downloads'
res = {}; CON = []
def chk(n, v, note=''):
    res[n] = bool(v); print(('  ✅ ' if v else '  ❌ ') + n + (('  — ' + note) if note else '')); return v
def selDB(pg, ma):
    return pg.evaluate("async (ma)=>{const {data}=await window.__sb.from('don_hang').select('gia_chot,ma_ky_bao_gia,to_char:trang_thai').eq('ma_don',ma).single().then(r=>({data:r.data})); return data;}", ma)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--window-size=1600,1000', '--disable-notifications'])
    pg = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
    pg.on('console', lambda m: CON.append((m.type, m.text[:150])) if m.type == 'error' and 'oneOfType' not in m.text else None)
    pg.on('pageerror', lambda e: CON.append(('pageerror', str(e)[:150])) if 'oneOfType' not in str(e) else None)
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_timeout(1200)
    pg.evaluate("async ([u,p])=>{const{error}=await window.__sb.auth.signInWithPassword({email:u,password:p});if(error)throw error}", [U, PW])
    pg.goto(SALE, wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=25000); pg.wait_for_timeout(2000)
    n0 = len(CON)
    sel = lambda ma: pg.evaluate("async (ma)=>{const {data}=await window.__sb.from('don_hang').select('gia_chot,ma_ky_bao_gia').eq('ma_don',ma).single(); const {data:d2}=await window.__sb.from('don_hang').select('han_tra_loi').eq('ma_don',ma).single(); return {gia_chot:data.gia_chot,ma_ky_bao_gia:data.ma_ky_bao_gia,han:d2.han_tra_loi};}", ma)

    # nav Báo giá
    try: pg.get_by_text('Báo giá', exact=True).first.click(timeout=6000); time.sleep(1.5)
    except PWTimeout: print('  ⚠ không thấy nav Báo giá')
    # lọc Quá hạn
    try: pg.get_by_text('Quá hạn', exact=True).first.click(timeout=5000); time.sleep(1)
    except PWTimeout: print('  ⚠ không thấy chip Quá hạn')
    # tìm DEMO-BGL01
    try: pg.get_by_placeholder('Tìm mã đơn, khách, số đ').fill('DEMO-BGL01'); time.sleep(1.2)
    except Exception as e: print('  ⚠ ô tìm:', str(e)[:50])

    # C3: thấy nhãn + nút
    seen = pg.evaluate("""()=>{const t=document.body.innerText;
      return {nhan: /Quá hạn 4 ngày · báo giá theo kỳ 2026-09/.test(t), nut: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Báo lại theo kỳ')};}""")
    print('  màn:', json.dumps(seen, ensure_ascii=False))
    chk('C3a thấy nhãn "Quá hạn 4 ngày · báo giá theo kỳ 2026-09" + nút "Báo lại theo kỳ"', seen['nhan'] and seen['nut'])
    before = sel('DEMO-BGL01'); print('  DB trước:', json.dumps(before, ensure_ascii=False))
    pg.screenshot(path=str(DL / 'wp15b_l11_1_nhan_nut.png')); print('  ẢNH1:', DL / 'wp15b_l11_1_nhan_nut.png')

    # bấm "Báo lại theo kỳ" (màn thật) → "Đồng ý"
    pg.get_by_role('button', name='Báo lại theo kỳ', exact=True).first.click(timeout=6000); time.sleep(1)
    pg.get_by_role('button', name='Đồng ý', exact=True).first.click(timeout=6000); time.sleep(2.5)
    # đọc panel kết quả
    kq_txt = pg.evaluate("()=>{const e=[...document.querySelectorAll('.bgl-kq')][0]; return e?e.innerText:'';}")
    print('  panel kết quả:', kq_txt.replace(chr(10), ' | '))
    after = sel('DEMO-BGL01'); print('  DB sau:', json.dumps(after, ensure_ascii=False))
    chk('C3b bấm màn thật → DB đổi: gia_chot & ma_ky_bao_gia & han_tra_loi thay đổi',
        str(after['gia_chot']) != str(before['gia_chot']) and after['ma_ky_bao_gia'] is not None and str(after['han']) != str(before['han']),
        'trước=' + json.dumps(before) + ' sau=' + json.dumps(after))
    chk('C3b panel hiện CHÊNH LỆCH (đ + %) + kỳ mới + hạn mới', ('%' in kq_txt and 'kỳ' in kq_txt and 'hạn mới' in kq_txt), kq_txt[:120])
    pg.screenshot(path=str(DL / 'wp15b_l11_2_ketqua.png')); print('  ẢNH2:', DL / 'wp15b_l11_2_ketqua.png')

    # F5 đọc lại khớp SELECT (đơn nay còn hạn +7 → hết nút)
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_function("()=>window.__sb", timeout=20000); pg.wait_for_timeout(2000)
    f5 = sel('DEMO-BGL01')
    chk('C3c F5 → SELECT khớp (gia_chot/ma_ky_bao_gia sau báo lại giữ nguyên)',
        str(f5['gia_chot']) == str(after['gia_chot']) and f5['ma_ky_bao_gia'] == after['ma_ky_bao_gia'], json.dumps(f5))

    # C4-3: đơn CÒN HẠN (DEMO-BGL02) KHÔNG có nút
    try: pg.get_by_text('Báo giá', exact=True).first.click(timeout=5000); time.sleep(1)
    except PWTimeout: pass
    try: pg.get_by_text('Tất cả', exact=True).first.click(timeout=4000); time.sleep(0.8)
    except PWTimeout: pass
    try: pg.get_by_placeholder('Tìm mã đơn, khách, số đ').fill('DEMO-BGL02'); time.sleep(1.2)
    except Exception: pass
    conhan = pg.evaluate("""()=>{const t=document.body.innerText;
      return {conhan_hien: /DEMO Còn hạn|DEMO-BGL02/.test(t), co_nut: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Báo lại theo kỳ')};}""")
    chk('C4-3 đơn CÒN HẠN (BGL02) hiện + KHÔNG có nút "Báo lại theo kỳ"', conhan['conhan_hien'] and conhan['co_nut'] is False, json.dumps(conhan))
    pg.screenshot(path=str(DL / 'wp15b_l11_3_conhan_khong_nut.png')); print('  ẢNH3:', DL / 'wp15b_l11_3_conhan_khong_nut.png')

    err = CON[n0:]
    chk('C3 console 0 lỗi (ngoài oneOfType WP-91)', len(err) == 0, json.dumps(err[:3], ensure_ascii=False))
    print('  console lỗi:', len(err))
    b.close()

okall = all(res.values())
print(f'\n═══ robot_wp15b_l11: {sum(res.values())}/{len(res)}' + (' ĐẠT' if okall else ' CÓ LỖI') + ' ═══')
sys.exit(0 if okall else 1)
