#!/usr/bin/env python3
# WP-109 vế (1) — ĐO + PHÂN LOẠI request của MỘT cú Lưu đơn (KHÔNG sửa app). CDP thật, profile SẠCH (0 tiện ích),
#   tài khoản robot test_sale (.env.robot). Đơn DEMO (ten_khach 'DEMO WP109…' → la_demo tự bật). Dọn bằng xoa_demo + reload.
import pathlib, time, json, os, sys, hashlib, re
from playwright.sync_api import sync_playwright, TimeoutError as PWT

WEB = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / "Downloads"
APEX = "https://togihome-sale.pages.dev"
# .env.robot → TEST_SALE_EMAIL/PASS
for ln in (WEB / 'ops' / '.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); os.environ.setdefault(k.strip(), v.strip())
EMAIL = os.environ.get('TEST_SALE_EMAIL', ''); PWD = os.environ.get('TEST_SALE_PASS', '')
assert EMAIL and PWD, "Thiếu TEST_SALE_EMAIL/PASS trong .env.robot"

def rutgon(method, url, post):
    u = url.split('?')[0]
    m = re.search(r'/rest/v1/rpc/([a-z0-9_]+)', u)
    if m: return f"rpc:{m.group(1)}"
    m = re.search(r'/rest/v1/([a-z0-9_]+)', u)
    if m:
        q = url.split('?', 1)[1] if '?' in url else ''
        sel = re.search(r'select=([^&]+)', q); flt = [p for p in q.split('&') if p.split('=')[0] not in ('select',)]
        tag = m.group(1)
        if sel: tag += "[sel " + sel.group(1)[:22] + "]"
        if flt: tag += " " + "&".join(flt)[:26]
        return tag
    if '/auth/v1/token' in u: return "auth:token"
    if '/auth/v1/user' in u: return "auth:user"
    if '/auth/v1/' in u: return "auth:" + u.split('/auth/v1/')[1][:12]
    return u.split('/')[-1][:24] or u

def nhom(method, path):
    if path.startswith('auth:'): return 'auth-token'
    if method in ('POST', 'PATCH', 'PUT', 'DELETE'): return 'ghi'
    if method == 'GET':
        if path.startswith('rpc:cau_hinh') or path.startswith('san_pham') or path.startswith('mau_sac') or path.startswith('vat_lieu') or path.startswith('don_vi_van') or path.startswith('thuong_hieu') or path.startswith('khong_gian') or path.startswith('tho') or path.startswith('nguoi_dung'):
            return 'đọc-nền'
        return 'đọc-lại-sau-ghi'
    return 'khác'

def login(pg):
    pg.goto(APEX, wait_until="domcontentloaded"); time.sleep(2)
    if pg.locator('#p').is_visible():
        pg.fill('#e', EMAIL); pg.fill('#p', PWD); pg.locator('#b').click()
        for _ in range(40):
            time.sleep(0.3)
            if not pg.locator('#p').is_visible(): break
        else: raise RuntimeError("[HARNESS] đăng nhập test_sale treo/thất bại")
    pg.get_by_text("Sổ đơn hàng", exact=True).first.wait_for(timeout=20000)

def mo_form_dien(pg):
    "đi ĐÚNG màn thật: Sổ đơn hàng → + Lên đơn → assert nút Lưu → điền trường bắt buộc"
    try: pg.get_by_text("Sổ đơn hàng", exact=True).first.click(timeout=4000); time.sleep(1)
    except PWT: pass
    pg.get_by_role("button", name="+ Lên đơn", exact=True).click(timeout=6000)
    pg.get_by_placeholder("0903 792 333").wait_for(timeout=6000)
    pg.get_by_placeholder("Chị Lan").fill("DEMO WP109")
    pg.get_by_placeholder("0903 792 333").fill("0900109001")
    pg.get_by_placeholder("Số nhà, đường, phường, quận").fill("DEMO WP109 đo request")
    pg.get_by_placeholder("Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm").first.fill("Tủ áo 2 cánh (DEMO WP109)")
    pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill("9000000")
    for _r in range(2):
        sels = pg.locator('select')
        for i in range(sels.count()):
            s = sels.nth(i)
            try:
                if s.is_visible() and (s.input_value() or "") == "": s.select_option(index=1); time.sleep(0.2)
            except Exception: pass
    # ASSERT thấy nút Lưu THẬT trước khi bấm (luật robot 00)
    assert pg.get_by_role("button", name="Lưu đơn", exact=True).is_visible(), "[HARNESS] không thấy nút 'Lưu đơn' trên màn"

def do_ca(pw, ten, throttle):
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-extensions"])
    ctx = b.new_context(viewport={"width": 420, "height": 900})   # context SẠCH: 0 tiện ích, 0 phiên → login test_sale
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); cdp.send("Network.enable")
    R = {}
    cdp.on("Network.requestWillBeSent", lambda p: R.__setitem__(p["requestId"], {"method": p["request"]["method"], "url": p["request"]["url"], "post": p["request"].get("postData", "") or "", "t0": p["timestamp"]}))
    cdp.on("Network.responseReceived", lambda p: R[p["requestId"]].__setitem__("status", p["response"]["status"]) if p["requestId"] in R else None)
    def fin(p):
        if p["requestId"] in R: R[p["requestId"]]["t1"] = p["timestamp"]; R[p["requestId"]]["rs"] = int(p.get("encodedDataLength", 0))
    cdp.on("Network.loadingFinished", fin)
    cdp.on("Network.loadingFailed", lambda p: R[p["requestId"]].update(t1=p["timestamp"], rs=0, status="FAIL") if p["requestId"] in R else None)
    login(pg)
    if throttle:
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 2000, "downloadThroughput": int(780 * 1024 / 8), "uploadThroughput": int(330 * 1024 / 8)})
    mo_form_dien(pg)
    R.clear()                                  # MỐC ĐO: chỉ giữ request SAU cú bấm
    last_act = [time.monotonic()]   # cập nhật trên MỌI sự kiện mạng (gửi/nhận/xong) → dưới 3G có sự kiện mỗi ~2s, không cắt giữa chuỗi
    for _ev in ("Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished"):
        cdp.on(_ev, lambda p: last_act.__setitem__(0, time.monotonic()))
    pg.get_by_role("button", name="Lưu đơn", exact=True).click()
    cap = 70 if throttle else 15
    idle = 5 if throttle else 3   # "im mạng 3s"; 3G rộng hơn vì 1 request có thể ~2-3s
    t_click = time.monotonic()
    # QUAN TRỌNG (Playwright SYNC): time.sleep KHÔNG bơm sự kiện CDP → phải wait_for_timeout để handler last_act chạy,
    #   nếu không vòng lặp dừng sau `idle`s KỂ TỪ LÚC BẤM (không phải từ hoạt động mạng cuối) và cắt giữa chuỗi ghi.
    while time.monotonic() - last_act[0] < idle and time.monotonic() - t_click < cap:
        pg.wait_for_timeout(300)
    time.sleep(0.5)
    ts = int(time.time())
    pg.screenshot(path=str(OUT / f"wp109_{ten}_{ts}.png"))
    # build bảng
    recs = [r for r in R.values() if "t0" in r and ("supabase" in r["url"] or "/rest/" in r["url"] or "/auth/" in r["url"] or "/functions/" in r["url"])]
    recs.sort(key=lambda r: r["t0"])
    if recs:
        base = recs[0]["t0"]
        for r in recs:
            r["path"] = rutgon(r["method"], r["url"], r["post"])
            r["ms0"] = round((r["t0"] - base) * 1000)
            r["ms1"] = round((r.get("t1", r["t0"]) - base) * 1000)
            r["nhom"] = nhom(r["method"], r["path"])
            r["h"] = hashlib.md5((r["method"] + "|" + r["path"] + "|" + r["post"]).encode()).hexdigest()[:8]
    # TRÙNG
    from collections import Counter
    cnt = Counter(r["h"] for r in recs)
    for r in recs: r["trung"] = cnt[r["h"]]
    # NỐI TIẾP: bắt đầu sau khi req LIỀN TRƯỚC (theo t0) đã kết thúc
    for i, r in enumerate(recs):
        r["noi_tiep"] = (i > 0 and r["t0"] >= recs[i - 1].get("t1", recs[i - 1]["t0"]))
    tong_ms = round((max((r.get("t1", r["t0"]) for r in recs), default=base) - base) * 1000) if recs else 0
    # đơn DEMO tạo ra ở ca này (dọn ở main bằng CEO — test_sale KHÔNG xoa_demo được, "chỉ CEO")
    created = pg.evaluate("async()=>{const{data}=await window.__sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO WP109%');return (data||[]).map(x=>x.ma_don);}")
    ctx.close(); b.close()
    return recs, tong_ms, created, ts

def do_ca_c(pw, ten, delay):
    "CA C: bịt LỖ cửa sổ gộp. Lưu đơn → trong cửa sổ 4s ĐIỀU HƯỚNG (bấm thật) sang màn Báo giá (baoGiaDs) → refresh do NAV PHẢI đi thẳng."
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-extensions"])
    ctx = b.new_context(viewport={"width": 420, "height": 900}); pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); cdp.send("Network.enable")
    goi = {}                     # đếm rpc GỌI trong cửa sổ đo (sau cú bấm nav)
    dem = [False]; bg_log = []; t0 = [None]
    def onsend(p):
        url = p["request"]["url"]
        m = re.search(r'/rest/v1/rpc/([a-z0-9_]+)', url)
        if not m: return
        if m.group(1) == 'sale_bao_gia_ds' and t0[0] is not None:
            gh = (p["request"].get("postData", "") or "")[:40]
            bg_log.append((round((time.monotonic() - t0[0]) * 1000), gh))
        if dem[0]: goi[m.group(1)] = goi.get(m.group(1), 0) + 1
    cdp.on("Network.requestWillBeSent", onsend)
    login(pg)                    # mặc định tab Báo giá (bg)
    t0[0] = time.monotonic()     # mốc log baoGiaDs (từ sau login)
    mo_form_dien(pg)             # sang Sổ đơn + mở form + điền
    t_click = time.monotonic()
    pg.get_by_role("button", name="Lưu đơn", exact=True).click()
    while time.monotonic() - t_click < delay: pg.wait_for_timeout(150)   # trong CỬA SỔ 4s
    dem[0] = True; t_nav = time.monotonic()
    # ĐIỀU HƯỚNG THẬT sang tab Nhóm (NhomMan mount → baoGiaDs(2000)) — bấm nav <a role=button> "Nhóm"
    try: pg.get_by_role("button", name="Nhóm", exact=True).first.click(timeout=5000)
    except Exception:
        pg.evaluate("() => { const b=[...document.querySelectorAll('a[role=\"button\"]')].find(e=>(e.textContent||'').trim()==='Nhóm'); if(b) b.click(); }")
    # chờ màn Nhóm mount xong (tối đa 12s) rồi mới chốt đo — NhomMan fetch baoGiaDs khi mount
    try: pg.locator('.nh-man').wait_for(timeout=12000)
    except Exception: pass
    while time.monotonic() - t_nav < 13: pg.wait_for_timeout(150)
    dem[0] = False
    # (i) màn Nhóm render + hiện dữ liệu báo giá (NhomMan dùng baoGiaDs). SELECT đối chiếu tong.
    has_bg = pg.evaluate("!!document.querySelector('.nh-man')")
    dom = pg.evaluate("!!document.querySelector('.nh-man') && !/Đang tải/.test(document.querySelector('.nh-man').innerText||'') ? 1 : 0")
    sel = pg.evaluate("async()=>{const r=await window.__sb.rpc('sale_bao_gia_ds',{p_gioi_han:2000});return r.data?(r.data.tong):null;}")
    b.close()
    tcl = round((t_click - t0[0]) * 1000); tnv = round((t_nav - t0[0]) * 1000)
    return {"goi": goi, "dom": dom, "sel": sel, "has_bg": has_bg, "delay": delay, "bg_log": bg_log, "t_click_ms": tcl, "t_nav_ms": tnv}

def _click_nav(pg, ten):
    try: pg.get_by_role("button", name=ten, exact=True).first.click(timeout=5000); return
    except Exception: pass
    pg.evaluate("(t) => { const b=[...document.querySelectorAll('a[role=\"button\"]')].find(e=>(e.textContent||'').trim()===t); if(b) b.click(); }", ten)

def do_ca_am(pw, ten):
    "CA C-am: LÀM ẤM NhomMan (mount 1 chậm, KHÔNG đo) → đo ở mount 2 (nhanh) rơi trong cửa sổ 4s sau Lưu."
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-extensions"])
    ctx = b.new_context(viewport={"width": 420, "height": 900}); pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); cdp.send("Network.enable")
    bg = []                       # (t_monotonic, gioiHan)
    def onsend(p):
        if '/rest/v1/rpc/sale_bao_gia_ds' in p["request"]["url"]:
            gh = p["request"].get("postData", "") or ""
            m = re.search(r'"p_gioi_han":(\d+)', gh); bg.append((time.monotonic(), int(m.group(1)) if m else -1))
    cdp.on("Network.requestWillBeSent", onsend)
    # test_sale KHÔNG có tab Nhóm → ca này đăng nhập vai CÓ tab Nhóm (test_ceo) — đây là vai DUY NHẤT gặp được kịch bản nuốt.
    pg.goto(APEX, wait_until="domcontentloaded"); time.sleep(2)
    if pg.locator('#p').is_visible():
        pg.fill('#e', os.environ.get('TEST_CEO_EMAIL', '')); pg.fill('#p', os.environ.get('TEST_CEO_PASS', '')); pg.locator('#b').click()
        for _ in range(40):
            pg.wait_for_timeout(300)
            if not pg.locator('#p').is_visible(): break
    pg.get_by_text("Sổ đơn hàng", exact=True).first.wait_for(timeout=20000)
    # 1) LÀM ẤM: sang Nhóm, chờ .nh-man render (mount 1, chậm)
    _click_nav(pg, "Nhóm")
    try: pg.locator('.nh-man').wait_for(timeout=20000)
    except Exception:
        b.close(); return {"warm": False}
    pg.wait_for_timeout(1500)
    # 2) quay lại màn lên đơn + im mạng 3s
    _click_nav(pg, "Sổ đơn hàng")
    last = [time.monotonic()]; cdp.on("Network.requestWillBeSent", lambda p: last.__setitem__(0, time.monotonic()))
    while time.monotonic() - last[0] < 3: pg.wait_for_timeout(150)
    # 3) mở form + điền + LƯU
    pg.get_by_role("button", name="+ Lên đơn", exact=True).click(timeout=6000); pg.get_by_placeholder("0903 792 333").wait_for(timeout=6000)
    pg.get_by_placeholder("Chị Lan").fill("DEMO WP109"); pg.get_by_placeholder("0903 792 333").fill("0900109009")
    pg.get_by_placeholder("Số nhà, đường, phường, quận").fill("C-am"); pg.get_by_placeholder("Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm").first.fill("Tủ áo C-am")
    pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill("9000000")
    for _r in range(2):
        for i in range(pg.locator('.ovl select').count()):
            s = pg.locator('.ovl select').nth(i)
            try:
                if s.is_visible() and (s.input_value() or "") == "": s.select_option(index=1); pg.wait_for_timeout(200)
            except Exception: pass
    t_luu = [None]; bg.clear()
    pg.get_by_role("button", name="Lưu đơn", exact=True).click(); t_luu[0] = time.monotonic()
    # 4) trong 1,5–2,5s: bấm THẬT sang Nhóm (mount 2, nhanh)
    while time.monotonic() - t_luu[0] < 1.8: pg.wait_for_timeout(100)
    t_nav = time.monotonic(); _click_nav(pg, "Nhóm")
    try: pg.locator('.nh-man').wait_for(timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(2500)
    # 5) assert (i) mạng: có baoGiaDs(2000) SAU nav VÀ trong 4s kể từ Lưu
    ms = lambda t: round((t - t_luu[0]) * 1000)
    hit2000 = [g for (t, g) in bg if g == 2000 and t > t_nav and (t - t_luu[0]) < 4.0]
    bg_ms = [(ms(t), g) for (t, g) in bg]
    # (ii) màn: DOM .nh-man vs SELECT gioiHan=2000
    sel2000 = pg.evaluate("async()=>{const r=await window.__sb.rpc('sale_bao_gia_ds',{p_gioi_han:2000});return r.data?r.data.tong:null;}")
    dom_n = pg.evaluate("() => { const box=document.querySelector('.nh-man'); if(!box) return null; const m=(box.innerText||'').match(/(\\d+)\\s*đơn/); return m?+m[1]:(/Đang tải/.test(box.innerText)?'tải':'render0'); }")
    b.close()
    return {"warm": True, "i": len(hit2000) >= 1, "t_luu_ms": 0, "t_nav_ms": ms(t_nav), "bg_ms": bg_ms, "sel2000": sel2000, "dom_n": dom_n}

def ceo_clean(pw):
    "xoa_demo cần CEO → phiên riêng test_ceo dọn HẾT DEMO WP109 (đúng đường app)"
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-extensions"]); pg = b.new_context().new_page()
    pg.goto(APEX, wait_until="domcontentloaded"); time.sleep(2)
    if pg.locator('#p').is_visible():
        pg.fill('#e', os.environ.get('TEST_CEO_EMAIL', '')); pg.fill('#p', os.environ.get('TEST_CEO_PASS', '')); pg.locator('#b').click()
        for _ in range(40):
            time.sleep(0.3)
            if not pg.locator('#p').is_visible(): break
    pg.get_by_text("Sổ đơn hàng", exact=True).first.wait_for(timeout=20000)
    o = pg.evaluate("async()=>{const{data}=await window.__sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO WP109%');const r=[];for(const x of(data||[])){const{error}=await window.__sb.rpc('xoa_demo',{p_ma_don:x.ma_don});r.push(x.ma_don+(error?':LỖI':':xoá'));}return r;}")
    b.close(); return o

def main(pw):
    print("dọn TRƯỚC (CEO):", ceo_clean(pw))
    print("== CA A (mạng không bóp) =="); recsA, msA, sachA, tsA = do_ca(pw, "caA", False)
    print("  CA A tạo đơn DEMO:", sachA, "→ CEO dọn:", ceo_clean(pw))
    print("== CA B (3G latency 2s/req) =="); recsB, msB, sachB, tsB = do_ca(pw, "caB", True)
    print("  CA B tạo đơn DEMO:", sachB, "→ CEO dọn:", ceo_clean(pw))
    (OUT / f"wp109_caA_{tsA}.json").write_text(json.dumps(recsA, ensure_ascii=False, indent=1))
    (OUT / f"wp109_caB_{tsB}.json").write_text(json.dumps(recsB, ensure_ascii=False, indent=1))

    def dump(ten, recs, tong):
        print(f"\n──────── {ten}: {len(recs)} request · tổng {tong} ms từ lúc bấm Lưu ────────")
        print(f"  {'#':>2} {'ms0':>6}{'ms1':>7}  {'md':<5} {'nhóm':<16} {'trùng':>5} {'nối':>4}  đường")
        for i, r in enumerate(recs, 1):
            print(f"  {i:>2} {r['ms0']:>6}{r['ms1']:>7}  {r['method']:<5} {r['nhom']:<16} {('x'+str(r['trung'])) if r['trung']>1 else '-':>5} {'NT' if r['noi_tiep'] else '-':>4}  {r['path']}")
        n_trung = sum(1 for r in recs if r["trung"] > 1)
        n_nt = sum(1 for r in recs if r["noi_tiep"])
        n_dls = sum(1 for r in recs if r["nhom"] == "đọc-lại-sau-ghi")
        print(f"  → TRÙNG (xuất hiện >1): {n_trung} request · NỐI TIẾP: {n_nt} · đọc-lại-sau-ghi: {n_dls}")
        return n_trung, n_nt, n_dls

    dump("CA A", recsA, msA); dump("CA B", recsB, msB)
    print(f"\n(a) TỔNG: caA {len(recsA)} req / caB {len(recsB)} req · thời gian caA {msA}ms · caB {msB}ms")
    print(f"    một cú Lưu tạo: caA {len(sachA)} đơn · caB {len(sachB)} đơn (mỗi ca đúng 1 = save không nhân)")
    # ── CA C: điều hướng TRONG cửa sổ gộp 4s → refresh do NAV phải đi thẳng ──
    print("\n== CA C (nav 2s trong cửa sổ) =="); c1 = do_ca_c(pw, "caC2s", 2.0); print("  CEO dọn:", ceo_clean(pw))
    print("== CA C (nav 3,5s sát mép) =="); c2 = do_ca_c(pw, "caC35s", 3.5); print("  CEO dọn:", ceo_clean(pw))
    for c in (c1, c2):
        bg = c["goi"].get("sale_bao_gia_ds", 0); bcg = c["goi"].get("sale_ban_cho_gui", 0)
        ii = bg >= 1
        i_ok = c["has_bg"] and c["dom"] == 1   # màn Nhóm render + đã có dữ liệu (không kẹt "Đang tải"/rỗng-vì-nuốt)
        print(f"  CA C nav@{c['delay']}s: (i) màn Nhóm render={c['has_bg']} · có dữ liệu={c['dom']==1} · SELECT tong={c['sel']} → {'ĐẠT' if i_ok else 'KHÔNG'}"
              f"  ·  (ii) sale_bao_gia_ds={bg} sale_ban_cho_gui={bcg} trong 6s → {'ĐẠT (≥1)' if ii else 'KHÔNG (bị NUỐT)'}")
        print(f"       [debug] t_click={c['t_click_ms']}ms t_nav={c['t_nav_ms']}ms · baoGiaDs bắn tại (ms,post): {c['bg_log']}")
    # ── CA C-am: LÀM ẤM rồi đo cú BẤM THẬT sang Nhóm rơi trong cửa sổ 4s ──
    for lan in (1, 2):
        print(f"\n== CA C-am lần {lan} =="); a = do_ca_am(pw, f"cam{lan}"); print("  CEO dọn:", ceo_clean(pw))
        if not a.get("warm"):
            print(f"  ⛔ HARNESS KẸT: tab Nhóm KHÔNG mount kịp (làm ấm thất bại) — ca bấm-thật CHƯA dựng được.")
            continue
        print(f"  (i) MẠNG: baoGiaDs(2000) đi thẳng SAU nav & trong 4s kể từ Lưu = {'ĐẠT' if a['i'] else 'KHÔNG'}"
              f"  ·  bấm Lưu=0ms · bấm nav={a['t_nav_ms']}ms · baoGiaDs bắn (ms,gh)={a['bg_ms']}")
        print(f"  (ii) MÀN: DOM .nh-man={a['dom_n']} vs SELECT tong(2000)={a['sel2000']}")
    conlai = ceo_clean(pw)
    print(f"\n✔ DEMO WP109 còn lại sau dọn cuối (CEO): {conlai if conlai else 'SẠCH 0'}")

with sync_playwright() as pw:
    main(pw)
