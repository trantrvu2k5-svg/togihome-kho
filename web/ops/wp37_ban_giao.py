#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# ROBOT WP-37 tầng 4 (prod) — đưa đơn BÁO GIÁ T8-001 (đã có BOM du_kien) đi TRỌN qua UI thật:
#   Sale CHỐT (bao_gia→moi_len_don) → Thiết kế GIAO VIỆC → gán quy trình + số + file cắt → BÀN GIAO XƯỞNG.
#   Mục đích: chứng minh BOM du_kien → 'chuan' Ở BÀN GIAO mà KHÔNG đẩy lại từ plugin.
#
# LUẬT: đi ĐÚNG app, KHÔNG GUC, KHÔNG INSERT tắt. Kẹt ở chốt nào → DỪNG, in rõ chốt đó.
#   Tài khoản test_* (.env.robot). Đơn T8-001 là DEMO (la_demo) — xoá bằng xoa_demo sau nghiệm thu.
# ─────────────────────────────────────────────────────────────────────────────
import os, sys, time, json, re, pathlib
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

OPS = pathlib.Path(__file__).resolve().parent
MA = "T8-001"
URLS = {"sale": "https://togihome-sale.pages.dev", "thietke": "https://togihome-thietke.pages.dev"}
PROFILE = str(pathlib.Path.home() / ".togihome-wp37-profile")

def nap_env():
    p = OPS / ".env.robot"
    for ln in p.read_text().splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
nap_env()
E, P = os.environ["TEST_CEO_EMAIL"], os.environ["TEST_CEO_PASS"]   # ceo: vào được cả thiết kế + bàn giao (không cần "cầm" đơn)
SE, SP = os.environ["TEST_SALE_EMAIL"], os.environ["TEST_SALE_PASS"]   # sale THẬT: chốt đơn qua cửa WP-06 (chot_don) với JWT vai 'sale'

REQ = {"n": 0}
def hook(pg): pg.on("request", lambda r: REQ.__setitem__("n", REQ["n"] + 1))
def snap(pg):
    try: return REQ["n"], pg.evaluate("document.body.innerText.length")
    except Exception: return REQ["n"], 0
def acted(pg, r0, d0):
    for _ in range(20):
        time.sleep(0.1)
        if REQ["n"] > r0: return True
        try:
            if pg.evaluate("document.body.innerText.length") != d0: return True
        except Exception: return True
    return False
def sbjs(pg, code): return pg.evaluate("async () => { const sb = window.__sb; " + code + " }")
def tt(pg): return sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('trang_thai').eq('ma_don','{MA}').limit(1); return (data&&data[0])?data[0].trang_thai:null;")
def poll_tt(pg, wants, secs=8):
    for _ in range(secs * 2):
        if tt(pg) in wants: return tt(pg)
        time.sleep(0.5)
    return tt(pg)

def login(pg, app, e=None, p=None):
    e = e or E; p = p or P
    pg.goto(URLS[app], wait_until="domcontentloaded"); time.sleep(2.5)
    if not pg.locator('#p').is_visible():
        print(f"  ✔ [{app}] phiên sẵn"); return
    pg.fill('#e', e); pg.fill('#p', p); pg.locator('#b').click()
    for _ in range(40):
        time.sleep(0.3)
        if not pg.locator('#p').is_visible(): print(f"  ✔ [{app}] đăng nhập"); return
    raise RuntimeError(f"[{app}] đăng nhập treo")

def DUNG(chot, ly_do):
    print(f"\n⛔ KẸT ở chốt [{chot}]: {ly_do}")
    print("   → DỪNG (không lách bằng GUC/INSERT). Báo CEO chốt này.")
    sys.exit(3)

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1400, "height": 950})
    pg = ctx.new_page(); hook(pg)
    pg.on("dialog", lambda d: d.accept())   # happy-path không có dialog; nếu lỡ có, chấp nhận để robot không treo
    SHOTDIR = pathlib.Path.home() / "Downloads" / "wp06_l06e"; SHOTDIR.mkdir(parents=True, exist_ok=True)
    def shot(name):
        try: pg.screenshot(path=str(SHOTDIR / f"{name}.png"))
        except Exception as ex: print(f"  (ảnh {name} lỗi: {ex})")

    # ── B/1 · SALE (test_sale THẬT): CHỐT bao_gia → moi_len_don qua cửa WP-06 ──
    login(pg, "sale", SE, SP)
    print(f"\n── SALE(test_sale): chốt {MA} (bao_gia → moi_len_don) ──")
    tt0 = tt(pg); print(f"  trang_thai trước: {tt0}"); shot("s1_sale_home")
    if tt0 != "bao_gia":
        print(f"  (đơn đã ở {tt0} — bỏ qua bước chốt)")
    else:
        # mở màn Báo giá
        try:
            pg.get_by_role("button", name="Báo giá").first.click(); time.sleep(1.5)
        except PWTimeout: pass
        # lọc đúng T8-001 (ô tìm 'Tìm mã, khách, món')
        try:
            box = pg.get_by_placeholder("Tìm mã, khách, món")
            if box.count(): box.first.fill(MA); time.sleep(1.2)
        except Exception: pass
        shot("s2_bao_gia_loc")
        # tới DonModal(don=T8-001, bao_gia): "Chuyển thành đơn"/"Chốt giá" mở thẳng, hoặc "Mở đơn"→"Sửa đơn".
        # CẢ HAI đều setMo({don}) trên CÙNG đơn (mã 4558) → chốt TẠI CHỖ, không nhân đôi.
        direct = pg.get_by_role("button", name=re.compile("Chuyển thành đơn|Chốt giá, lên đơn"))
        if direct.count():
            direct.first.click(); time.sleep(1.2)
        else:
            mo = pg.get_by_role("button", name="Mở đơn")
            if mo.count() == 0: DUNG("Sale·mo", f"màn Báo giá không có nút mở/chuyển cho {MA} (xem s2)")
            mo.first.click(); time.sleep(1.2); shot("s3_xem_don")
            sua = pg.get_by_role("button", name="Sửa đơn")
            if sua.count() == 0: DUNG("Sale·sua", "chi tiết đơn không có 'Sửa đơn'")
            sua.first.click(); time.sleep(1.0)
        pg.wait_for_selector(".ovl", timeout=8000); time.sleep(0.6); shot("s4_form_chot")
        chot = pg.get_by_role("button", name="Chốt, lên đơn")
        if chot.count() == 0:
            DUNG("Sale·chot", "không thấy nút 'Chốt, lên đơn' (đơn chưa đủ điều kiện? xem s4)")
        r0, d0 = snap(pg); chot.first.click(); acted(pg, r0, d0); time.sleep(2); shot("s5_sau_chot")
        t = poll_tt(pg, ["moi_len_don"], 12)
        if t != "moi_len_don":
            DUNG("Sale·chot", f"sau chốt trang_thai={t} (mong moi_len_don)")
        print(f"  ✔ chốt xong → trang_thai={t}")

    # ── B/2 · THIẾT KẾ: GIAO VIỆC (ceo giao cho 1 người SX) ─────────
    login(pg, "thietke")
    print(f"\n── THIẾT KẾ: giao việc {MA} ──")
    asg = sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('ma_ns_thiet_ke').eq('ma_don','{MA}').limit(1); return (data&&data[0])?data[0].ma_ns_thiet_ke:null;")
    if asg:
        print(f"  (đã có người cầm: {str(asg)[:8]}…)")
    else:
        g = pg.locator(f'#dsChoNhan button[data-giao="{MA}"], #dsChoNhan [data-nhan="{MA}"]')
        if g.count() == 0:
            time.sleep(2); g = pg.locator(f'#dsChoNhan button[data-giao="{MA}"], #dsChoNhan [data-nhan="{MA}"]')
        if g.count() == 0: DUNG("ThietKe·giao", f"không thấy nút giao/nhận cho {MA} ở #dsChoNhan")
        el = g.first
        if el.get_attribute("data-nhan") == MA:
            r0, d0 = snap(pg); el.click(timeout=5000); acted(pg, r0, d0)
        else:
            el.click(timeout=5000); pg.locator('#hopM.hien #giaoAi').wait_for(timeout=6000)
            val = pg.eval_on_selector('#giaoAi', "el => { for(const o of el.options){ if(o.value && /sản xuất/i.test(o.textContent)) return o.value } return el.options[0] && el.options[0].value; }")
            if val: pg.select_option('#giaoAi', val)
            pg.fill('#giaoLy', "WP-37 nghiệm thu — harness")
            r0, d0 = snap(pg); pg.locator('#giaoOk').click(timeout=5000); acted(pg, r0, d0); time.sleep(1.5)
        asg = sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('ma_ns_thiet_ke').eq('ma_don','{MA}').limit(1); return (data&&data[0])?data[0].ma_ns_thiet_ke:null;")
        if not asg: DUNG("ThietKe·giao", "sau giao việc vẫn chưa có ma_ns_thiet_ke")
        print(f"  ✔ giao việc xong (ma_ns={str(asg)[:8]}…)"); shot("s6_giao_viec")

    # ── B/3 · gán quy trình + số + file cắt + BÀN GIAO ──────────────
    print(f"\n── THIẾT KẾ: gán quy trình + số + BÀN GIAO {MA} ──")
    pg.goto(f"{URLS['thietke']}/thietke.html?don={MA}", wait_until="domcontentloaded"); time.sleep(2.5)
    pg.locator('#nsMonDs').wait_for(timeout=10000)
    mon_ids = pg.eval_on_selector_all('#nsMonDs button.mon[data-mon]', "els => els.map(e => e.dataset.mon)")
    if not mon_ids: DUNG("ThietKe·quy_trinh", "không thấy món nào ở #nsMonDs")
    print(f"  {len(mon_ids)} món")
    for mid in mon_ids:
        pg.locator(f'#nsMonDs button.mon[data-mon="{mid}"]').click(timeout=5000); time.sleep(1)
        if pg.locator('#nsPhai .dong-nhom[data-hd]').count() == 0 and pg.locator('#nsQt').count():
            qt = pg.eval_on_selector('#nsQt', "el => { for(const o of el.options){ if(o.value) return o.value } return '' }")
            if not qt: DUNG("ThietKe·quy_trinh", f"món {mid[:8]}: #nsQt không có quy trình để gán")
            pg.select_option('#nsQt', qt); time.sleep(1.8)
        for _ in range(24):
            empties = pg.locator('#nsPhai .dong-nhom[data-hd] .o-nhap input.trong')
            if empties.count() == 0: break
            h = empties.first; h.fill("1")
            try: h.dispatch_event('change')
            except Exception: pass
            time.sleep(1.1)
        con = pg.locator('#nsPhai .dong-nhom[data-hd] .o-nhap input.trong').count()
        print(f"  món {mid[:8]}: còn {con} ô trống")
    # file cắt
    if pg.locator('#nsInpFile').count():
        cut = OPS / "_wp37_cat.dxf"; cut.write_text("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")
        pg.locator('#nsInpFile').set_input_files(str(cut)); time.sleep(2)
    nut = pg.locator('#nsNutDay'); txt = nut.inner_text()[:90]
    print(f"  nhãn #nsNutDay: '{txt}'"); shot("s7_truoc_ban_giao")
    if nut.is_disabled():
        DUNG("BanGiao", f"nút bàn giao KHÓA — nhãn: '{txt}' (đọc đuôi để biết thiếu chốt nào)")
    r0, d0 = snap(pg); nut.click(timeout=6000)
    if not acted(pg, r0, d0): DUNG("BanGiao", "bấm bàn giao không gọi network")
    time.sleep(2)
    t = poll_tt(pg, ["cho_cat", "da_cat", "dang_lam"], 10)
    print(f"  trang_thai sau bàn giao: {t}"); shot("s8_sau_ban_giao")
    if t not in ("cho_cat", "da_cat", "dang_lam"):
        DUNG("BanGiao", f"sau bàn giao trang_thai={t} (mong cho_cat)")
    print(f"\n🟢 BÀN GIAO XONG — {MA} → {t}")
    ctx.close()
