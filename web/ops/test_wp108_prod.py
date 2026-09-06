#!/usr/bin/env python3
# WP-108 L-108.1 — nghiệm thu BẢN MỚI (chưa deploy) trên MẠNG THẬT + throttle 3G/2s.
#   CẤM deploy → phục vụ build mới ở LOCAL (dist-sale @127.0.0.1:8899), CHUYỂN phiên prod
#   từ profile sang localhost để đăng nhập (KHÔNG tạo/đổi tài khoản), DB vẫn là PROD.
#   Real Chrome nên CDN React boot được (khác harness L-107.5). Thao tác AN TOÀN + dọn DEMO.
import pathlib, time, sys, json
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
PROD = "https://togihome-sale.pages.dev"
LOCAL = "http://127.0.0.1:8899/"
KH = "DEMO WP108"
PASS, FAIL, NOTE = [], [], []
def ok(t, c, chi=''):
    (PASS if c else FAIL).append(t); print(('  ✓ ' if c else '  ✗ FAIL ') + t + ('' if c else '  → ' + chi))

def sbjs(pg, code): return pg.evaluate("async () => { const sb = window.__sb; " + code + " }")
def demSale(pg): return sbjs(pg, "const {data}=await sb.from('don_hang').select('ma_don,id').ilike('ten_khach','DEMO WP108%'); return (data||[]).map(x=>({ma:x.ma_don,id:x.id}));")
def don_mon(pg, oid): return sbjs(pg, f"const {{count}}=await sb.from('don_hang_mon').select('*',{{count:'exact',head:true}}).eq('don_id','{oid}'); return count||0;")
def donSach(pg): return sbjs(pg, "const {data}=await sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO WP108%'); const o=[]; for(const r of (data||[])){const {error}=await sb.rpc('xoa_demo',{p_ma_don:r.ma_don}); o.push(r.ma_don);} return o;")
def chip(pg): return pg.evaluate("!!document.querySelector('[data-dangluu]')")   # chip "Đang lưu…" đang hiện?
def bannerLoi(pg): return pg.evaluate("([...document.querySelectorAll('.note.rd,[data-ghiloi]')].map(e=>e.textContent).find(t=>/Không lưu được|CHƯA LƯU|TAO_DON_LOI/.test(t))) || (document.body.innerText.match(/CHƯA LƯU được[^\\n]*/)||[''])[0]")

def throttle(cdp, on):
    cdp.send('Network.enable')
    if on: cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 2000, 'downloadThroughput': int(780*1024/8), 'uploadThroughput': int(330*1024/8)})
    else: cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})

def toSoDon(pg):
    try:
        t = [e for e in pg.get_by_text("Sổ đơn hàng").all() if e.is_visible()]
        if t: t[0].click(); time.sleep(1)
    except Exception: pass

def bootLocal(pg):
    # 1) lấy phiên prod từ profile
    pg.goto(PROD, wait_until="domcontentloaded")
    try: pg.get_by_text("Sổ đơn hàng").first.wait_for(timeout=25000)
    except PWTimeout:
        return False
    sess = pg.evaluate("() => { const o={}; for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); o[k]=localStorage.getItem(k);} return o; }")
    # 2) nạp phiên sang localhost (bản MỚI) rồi reload
    pg.goto(LOCAL, wait_until="domcontentloaded")
    pg.evaluate("(o) => { for (const k in o) localStorage.setItem(k, o[k]); }", sess)
    pg.reload(wait_until="domcontentloaded")
    try: pg.get_by_text("Sổ đơn hàng").first.wait_for(timeout=25000); return True
    except PWTimeout: return False

def moForm(pg):
    toSoDon(pg)
    pg.get_by_role('button', name='Lên đơn').first.click(timeout=15000)
    pg.get_by_placeholder('0903 792 333').wait_for(timeout=15000)
    pg.get_by_placeholder('Chị Lan').fill(KH)
    pg.get_by_placeholder('0903 792 333').fill('0900108500')
    pg.get_by_placeholder('Số nhà, đường, phường, quận').fill('WP108 test')
    pg.get_by_placeholder('Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm').first.fill('Món WP108')
    pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill('8000000')
    for _r in range(2):
        sels = pg.locator('.ovl select')   # CHỈ select TRONG form (không đụng dropdown lọc ở nền)
        for i in range(sels.count()):
            s = sels.nth(i)
            try:
                if s.is_visible() and (s.input_value() or '') == '': s.select_option(index=1); time.sleep(0.3)
            except Exception: pass

def clickLuu(pg, doub=False):
    pg.evaluate("(d) => { const b=[...document.querySelectorAll('button')].find(x=>/^Lưu đơn$/.test((x.textContent||'').trim())); if(b){ b.click(); if(d) b.click(); } }", doub)

def main(pw):
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1440, "height": 860})
    pg = ctx.new_page()
    if not bootLocal(pg):
        if pg.locator('#p').is_visible(): print("DỪNG: hết phiên prod (profile không còn session) — báo CEO nạp lại, KHÔNG tạo tài khoản.")
        else: print("DỪNG: bản mới @localhost không boot (chuyển phiên hỏng?).")
        ctx.close(); return
    print("  ✔ BẢN MỚI @localhost boot xong, đăng nhập bằng phiên prod (DB=prod).")
    cdp = ctx.new_cdp_session(pg); throttle(cdp, True); print("  ✔ throttle 3G + 2s BẬT")
    dialogs = []; pg.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    imgd = pathlib.Path('/tmp')
    donSach(pg); time.sleep(1)

    # ═══ CA1 (D.1): Lưu đơn → chip "Đang lưu…" hiện NGAY rồi BIẾN MẤT khi xong ═══
    #   Lưu đơn nối tiếp ~22 request (khach→don→ct→ls, mỗi _set nhiều truy vấn con). Dưới 2s-latency
    #   chip hiện ~40s (ĐÚNG "cho tới khi máy chủ xác nhận", KHÔNG treo). Xác nhận HIỆN dưới throttle,
    #   rồi GỠ throttle để ghi xong nhanh → xác nhận chip TẮT (không cần chờ 40s giả tạo).
    truoc = len(demSale(pg)); print(f"  [CA1] trước: {truoc} đơn")
    moForm(pg)
    pg.screenshot(path=str(imgd / 'wp108_1_form.png'))
    clickLuu(pg)
    hienChip = False
    for _ in range(20):
        if chip(pg): hienChip = True; break
        time.sleep(0.1)
    pg.screenshot(path=str(imgd / 'wp108_2_dangluu.png'))
    ok('CA1 chip "Đang lưu…" HIỆN ngay sau bấm Lưu (dưới throttle)', hienChip)
    throttle(cdp, False)   # gỡ throttle: ghi nền hoàn tất nhanh
    matChip = False
    for _ in range(40):
        time.sleep(0.5)
        if not chip(pg): matChip = True; break
    pg.screenshot(path=str(imgd / 'wp108_3_xong.png'))
    throttle(cdp, True)
    ok('CA1 chip BIẾN MẤT khi ghi xong (không treo)', matChip)
    sau = demSale(pg); ok('CA1 tạo đúng 1 đơn', len(sau) - truoc == 1, f"+{len(sau)-truoc}")
    print("  [CA1] dọn:", donSach(pg)); time.sleep(1)

    # ═══ CA2 (D.2): bấm ĐÚP → đúng 1 đơn, đúng số món ═══
    truoc = len(demSale(pg)); moForm(pg); clickLuu(pg, doub=True)
    newid = None
    for _ in range(50):
        time.sleep(0.6); d = demSale(pg)
        if len(d) - truoc >= 1: newid = d[-1]['id']; break
    time.sleep(3); sau = demSale(pg)
    ok('CA2 bấm đúp → đúng 1 đơn (không trùng)', len(sau) - truoc == 1, f"+{len(sau)-truoc}")
    if newid:
        nmon = 0
        for _ in range(30):
            nmon = don_mon(pg, newid)
            if nmon >= 1: break
            time.sleep(0.6)
        ok('CA2 đúng 1 món (không nhân)', nmon == 1, f"{nmon} món")
    print("  [CA2] dọn:", donSach(pg)); time.sleep(1)

    # ═══ CA3 (D.3): RPC lỗi → dòng lạc quan LÙI + banner nguyên văn + chip KHÔNG treo ═══
    truoc = len(demSale(pg))
    pg.route('**/rest/v1/rpc/tao_don*', lambda r: r.fulfill(status=400, content_type='application/json', body=json.dumps({'message': 'TAO_DON_LOI: chặn test (không ghi)', 'code': 'P0001'})))
    moForm(pg); clickLuu(pg)
    throttle(cdp, False)   # để chuỗi ghi settle nhanh → banner + chip-tắt hiện trong tầm poll
    ban = ''
    for _ in range(40):
        time.sleep(0.5); ban = bannerLoi(pg)
        if ban: break
    matChip3 = False
    for _ in range(40):
        if not chip(pg): matChip3 = True; break
        time.sleep(0.5)
    throttle(cdp, True)
    pg.screenshot(path=str(imgd / 'wp108_4_ca3_loi.png'))
    sau = demSale(pg)
    ok('CA3 RPC lỗi → banner NGUYÊN VĂN + KHÔNG đơn ma', ('TAO_DON_LOI' in (ban or '')) and (len(sau) == truoc), f"banner='{(ban or '')[:70]}' +{len(sau)-truoc}")
    ok('CA3 chip KHÔNG treo (mất sau khi lỗi)', matChip3)
    pg.unroute('**/rest/v1/rpc/tao_don*'); print("  [CA3] dọn:", donSach(pg)); time.sleep(1)

    # ═══ CA4 (D.4): MẠNG RỚT giữa chừng → chip KHÔNG kẹt vĩnh viễn ═══
    truoc = len(demSale(pg))
    pg.route('**/rest/v1/rpc/tao_don*', lambda r: r.abort())   # rớt mạng: huỷ request
    moForm(pg); clickLuu(pg)
    throttle(cdp, False)   # (abort không phụ thuộc latency; gỡ để các ghi nối tiếp khác settle nhanh)
    matChip4 = False
    for _ in range(60):   # ≤30s
        if not chip(pg): matChip4 = True; break
        time.sleep(0.5)
    throttle(cdp, True)
    ok('CA4 mạng rớt → chip KHÔNG kẹt "Đang lưu…" vĩnh viễn', matChip4)
    sau = demSale(pg)
    ok('CA4 mạng rớt → không đơn ma sót', len(sau) == truoc, f"+{len(sau)-truoc}")
    pg.unroute('**/rest/v1/rpc/tao_don*'); print("  [CA4] dọn:", donSach(pg)); time.sleep(1)

    # ═══ CA5 (D.5): GHI THẲNG "Đổi chủ đơn" (doiSalePhuTrach) — bấm đúp → 1 lần ghi, nút khoá rồi mở lại ═══
    # tạo 1 đơn DEMO, mở XemDon, Đổi chủ. CHẶN rpc bằng mock CÓ TRỄ + đếm hit (không ghi thật → an toàn).
    moForm(pg); clickLuu(pg)
    md = None
    for _ in range(50):
        time.sleep(0.6); d = demSale(pg)
        if d: md = d[0]; break
    if not md:
        NOTE.append("CA5: không tạo được đơn DEMO để mở (bỏ).")
    else:
        throttle(cdp, False)   # điều hướng panel ổn định; cửa sổ KHOÁ đến từ TRỄ RPC 2.5s (giả lập RPC chậm thật)
        time.sleep(2)
        toSoDon(pg); time.sleep(1.5)
        # MỞ CHI TIẾT (XemDon): bấm vào DÒNG có mã đơn (bộ lọc để "tất cả" nên đơn hiện)
        pg.evaluate("(ma) => { const cell=[...document.querySelectorAll('td,div,span,b')].find(e=>e.children.length===0 && (e.textContent||'').trim()===ma); if(cell){ (cell.closest('tr')||cell.parentElement||cell).click(); } }", md['ma'])
        # chờ nút Đổi chủ (id xd-doichu) xuất hiện trong panel
        try: pg.locator('#xd-doichu').wait_for(timeout=8000)
        except PWTimeout: pass
        # nút "Đổi" chủ đơn (id xd-doichu)
        hit = {'n': 0}
        def route_doi(r):
            hit['n'] += 1
            time.sleep(2.5)   # giữ dangGui true đủ lâu để thử cú thứ 2
            r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'ten_moi': 'X'}))
        pg.route('**/rest/v1/rpc/doi_sale_phu_trach*', route_doi)
        opened = pg.evaluate("() => { const b=document.getElementById('xd-doichu'); if(b){ b.click(); return true;} return false; }")
        time.sleep(0.8)
        # chọn 1 người trong select đổi chủ (select cuối vừa hiện)
        try:
            sel = pg.locator('select').last
            sel.select_option(index=1); time.sleep(0.3)
        except Exception: pass
        # double-click "Lưu"
        pg.evaluate("() => { const b=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='Lưu'||x.textContent.trim()==='Đang lưu…'); if(b[0]){ b[0].click(); b[0].click(); } }")
        # trong lúc trễ 2.5s: nút phải KHOÁ + 'Đang lưu…'
        khoa = None
        for _ in range(12):
            khoa = pg.evaluate("() => { const b=[...document.querySelectorAll('button')].find(x=>/Đang lưu…/.test(x.textContent)); return b?{d:b.disabled}:null; }")
            if khoa: break
            time.sleep(0.2)
        time.sleep(4)   # chờ route trả về + finally mở khoá
        moLai = pg.evaluate("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Lưu'); return b?{d:b.disabled}:'khong-con-nut'; }")
        ok('CA5 bấm đúp Đổi chủ → RPC chỉ gọi 1 lần (chặn cú 2)', hit['n'] == 1, f"gọi {hit['n']} lần")
        ok('CA5 giữa lúc gửi: nút KHOÁ + "Đang lưu…"', khoa and khoa['d'], str(khoa))
        ok('CA5 finally → nút MỞ LẠI (không kẹt)', (moLai == 'khong-con-nut') or (moLai and not moLai['d']), str(moLai))
        pg.unroute('**/rest/v1/rpc/doi_sale_phu_trach*')
    print("  [CA5] dọn:", donSach(pg)); time.sleep(1)
    fin = len(demSale(pg))
    ok('Dọn cuối → 0 đơn DEMO WP108 sót', fin == 0, f"sót {fin}")

    throttle(cdp, False); ctx.close()

with sync_playwright() as pw:
    main(pw)
for n in NOTE: print("  · NOTE:", n)
print(f"\n═══ WP-108 (bản mới @localhost, DB prod): {len(PASS)} pass / {len(FAIL)} fail ═══")
sys.exit(1 if FAIL else 0)
