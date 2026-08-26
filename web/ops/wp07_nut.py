#!/usr/bin/env python3
# ROBOT WP-07 L-133 — KIỂM NÚT THẬT trên prod app Sale: 3 nút tạo đơn đi qua RPC tao_don.
#   a) "+ Báo giá mới" -> "Lưu báo giá"  -> tao_don(p_chot=false) -> bao_gia
#   b) "+ Lên đơn"     -> "Lưu đơn"       -> tao_don(p_chot=true)  -> moi_len_don
#   c) "+ Lên đơn" THIẾU nguồn khách -> gate client chặn (alert đặc-tả) -> 0 đơn cụt
#   Vai test_sale THẬT. Mã đơn app tự sinh (T..); khách "DEMO WP07 x" để nhận diện; xoá theo id sau.
import os, sys, time, pathlib, re
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
OPS = pathlib.Path(__file__).resolve().parent
URL = "https://togihome-sale.pages.dev"
PROFILE = str(pathlib.Path.home() / ".togihome-wp07-profile")
SHOT = pathlib.Path.home() / "Downloads" / "wp07_l133"; SHOT.mkdir(parents=True, exist_ok=True)
for ln in (OPS / ".env.robot").read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith("#") and "=" in ln:
        k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
SE, SP = os.environ["TEST_SALE_EMAIL"], os.environ["TEST_SALE_PASS"]
dialogs = []

def firstsel(pg, sel_loc, prefer=None):
    # chọn option: ưu tiên value 'prefer' nếu có, else option đầu có value
    v = pg.evaluate("""([el, want]) => { for (const o of el.options){ if(want && o.value===want) return o.value } for (const o of el.options){ if(o.value) return o.value } return '' }""", [sel_loc.element_handle(), prefer])
    if v: sel_loc.select_option(v)
    return v

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1400, "height": 950})
    pg = ctx.new_page()
    pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    # login
    pg.goto(URL, wait_until="domcontentloaded"); time.sleep(3)
    if pg.locator('#p').is_visible():
        pg.fill('#e', SE); pg.fill('#p', SP); pg.locator('#b').click()
        for _ in range(40):
            time.sleep(0.3)
            if not pg.locator('#p').is_visible(): break
    time.sleep(2)
    print("✔ đăng nhập test_sale")

    def modal(): return pg.locator('.mdl').last

    # ═══ CA A: Báo giá mới -> Lưu báo giá ═══
    print("\n── CA a: Báo giá mới ──")
    pg.get_by_role("button", name=re.compile("Báo giá mới")).first.click(); time.sleep(1.2)
    m = modal()
    firstsel(pg, m.locator('select').first)                       # thương hiệu (option đầu có value)
    m.get_by_placeholder("0903 792 333").fill("0900000701")
    m.get_by_placeholder("Chị Lan").fill("DEMO WP07 A")
    m.get_by_placeholder(re.compile("Tủ áo 3 cánh")).first.fill("Món demo A")
    pg.screenshot(path=str(SHOT / "a1_form_bao_gia.png"))
    pg.get_by_role("button", name="Lưu báo giá").click(); time.sleep(2.5)
    pg.screenshot(path=str(SHOT / "a2_sau_bao_gia.png"))

    # ═══ CA B: + Lên đơn -> Lưu đơn (đủ nguồn + thương hiệu + món màu giá) ═══
    print("── CA b: + Lên đơn (đủ) ──")
    pg.get_by_role("button", name=re.compile(r"^\+ Lên đơn")).first.click(); time.sleep(1.2)
    m = modal()
    # selects: thương hiệu, tài khoản cọc, nguồn khách — chọn theo value hợp lệ
    sels = m.locator('select')
    n = sels.count()
    for i in range(n):
        s = sels.nth(i)
        lbl = pg.evaluate("el => (el.previousElementSibling && el.previousElementSibling.textContent) || (el.closest('.fld') && el.closest('.fld').textContent) || ''", s.element_handle())
        if "cọc" in lbl.lower(): firstsel(pg, s, "hkd_khanh")
        elif "qua đâu" in lbl.lower() or "nguồn" in lbl.lower(): firstsel(pg, s, "gioi_thieu")
        elif "màu" in lbl.lower(): firstsel(pg, s, "T01")
        elif "thương hiệu" in lbl.lower() or "cửa hàng" in lbl.lower(): firstsel(pg, s)
    m.get_by_placeholder("0903 792 333").fill("0900000702")
    m.get_by_placeholder("Chị Lan").fill("DEMO WP07 B")
    m.get_by_placeholder(re.compile("Số nhà")).fill("Số 2 ngõ Demo, Hà Nội")
    m.get_by_placeholder(re.compile("Bàn học|Bàn làm việc")).first.fill("Món demo B")
    m.locator('input[placeholder="0"]').first.fill("5000000")     # đơn giá món (ô '0' đầu tiên = đơn giá)
    time.sleep(0.3); pg.screenshot(path=str(SHOT / "b1_form_len_don.png"))
    pg.get_by_role("button", name="Lưu đơn").click(); time.sleep(3)
    pg.screenshot(path=str(SHOT / "b2_sau_len_don.png"))

    # ═══ CA C: + Lên đơn THIẾU nguồn khách ═══
    print("── CA c: + Lên đơn THIẾU nguồn ──")
    dialogs.clear()
    pg.get_by_role("button", name=re.compile(r"^\+ Lên đơn")).first.click(); time.sleep(1.2)
    m = modal()
    sels = m.locator('select'); n = sels.count()
    for i in range(n):
        s = sels.nth(i)
        lbl = pg.evaluate("el => (el.closest('.fld') && el.closest('.fld').textContent) || ''", s.element_handle())
        if "cọc" in lbl.lower(): firstsel(pg, s, "hkd_khanh")
        elif "màu" in lbl.lower(): firstsel(pg, s, "T01")
        elif "qua đâu" in lbl.lower() or "nguồn" in lbl.lower(): pass   # CỐ Ý bỏ trống nguồn
        elif "thương hiệu" in lbl.lower() or "cửa hàng" in lbl.lower(): firstsel(pg, s)
    m.get_by_placeholder("0903 792 333").fill("0900000703")
    m.get_by_placeholder("Chị Lan").fill("DEMO WP07 C")
    m.get_by_placeholder(re.compile("Số nhà")).fill("Số 3 ngõ Demo, Hà Nội")
    m.get_by_placeholder(re.compile("Bàn học|Bàn làm việc")).first.fill("Món demo C")
    m.locator('input[placeholder="0"]').first.fill("5000000")
    pg.get_by_role("button", name="Lưu đơn").click(); time.sleep(2)
    pg.screenshot(path=str(SHOT / "c1_thieu_nguon.png"))
    print("   dialog bắt được:", dialogs)

    print("\n=DONE=  ảnh ở", SHOT)
    ctx.close()
