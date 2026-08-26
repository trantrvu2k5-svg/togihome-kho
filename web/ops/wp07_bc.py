#!/usr/bin/env python3
# ROBOT WP-07 L-133 ca b/c — tab "Sổ đơn hàng" -> "+ Lên đơn". (ca a đã xong ở wp07_nut.py)
import os, time, pathlib, re
from playwright.sync_api import sync_playwright
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

def pick(pg, s, prefer=None):
    v = pg.evaluate("""([el, want]) => { for (const o of el.options){ if(want && o.value===want) return o.value } for (const o of el.options){ if(o.value) return o.value } return '' }""", [s.element_handle(), prefer])
    if v: s.select_option(v)
    return v

def fill_len_don(pg, m, sdt, ten, dc, mon, gia, with_nguon):
    sels = m.locator('select'); n = sels.count()
    for i in range(n):
        s = sels.nth(i)
        lbl = (pg.evaluate("el => (el.closest('.fld') && el.closest('.fld').textContent) || ''", s.element_handle()) or "").lower()
        if "cọc" in lbl: pick(pg, s, "hkd_khanh")
        elif "màu" in lbl: pick(pg, s, "T01")
        elif "qua đâu" in lbl or "nguồn" in lbl:
            if with_nguon: pick(pg, s, "gioi_thieu")
        elif "thương hiệu" in lbl or "cửa hàng" in lbl: pick(pg, s)
    m.get_by_placeholder("0903 792 333").fill(sdt)
    m.get_by_placeholder("Chị Lan").fill(ten)
    m.get_by_placeholder(re.compile("Số nhà")).fill(dc)
    m.get_by_placeholder(re.compile("Bàn học|Bàn làm việc")).first.fill(mon)
    m.locator('input[placeholder="0"]').first.fill(str(gia))

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1400, "height": 950})
    pg = ctx.new_page()
    pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(URL, wait_until="domcontentloaded"); time.sleep(3)
    if pg.locator('#p').is_visible():
        pg.fill('#e', SE); pg.fill('#p', SP); pg.locator('#b').click(); time.sleep(3)
    # sang tab Sổ đơn hàng
    pg.get_by_role("button", name=re.compile("Sổ đơn")).first.click(); time.sleep(1.5)
    modal = lambda: pg.locator('.mdl').last

    # ── CA B: + Lên đơn (đủ) ──
    print("── CA b ──")
    pg.get_by_role("button", name=re.compile(r"^\+ Lên đơn$")).first.click(); time.sleep(1.2)
    fill_len_don(pg, modal(), "0900000702", "DEMO WP07 B", "Số 2 ngõ Demo, Hà Nội", "Món demo B", 5000000, True)
    time.sleep(0.3); pg.screenshot(path=str(SHOT / "b1_form_len_don.png"))
    pg.get_by_role("button", name="Lưu đơn").click(); time.sleep(3)
    pg.screenshot(path=str(SHOT / "b2_sau_len_don.png"))
    print("   dialogs sau b:", dialogs)

    # ── CA C: + Lên đơn THIẾU nguồn ──
    print("── CA c ──"); dialogs.clear()
    pg.get_by_role("button", name=re.compile(r"^\+ Lên đơn$")).first.click(); time.sleep(1.2)
    fill_len_don(pg, modal(), "0900000703", "DEMO WP07 C", "Số 3 ngõ Demo, Hà Nội", "Món demo C", 5000000, False)
    pg.get_by_role("button", name="Lưu đơn").click(); time.sleep(2)
    pg.screenshot(path=str(SHOT / "c1_thieu_nguon.png"))
    print("   dialog ca c:", dialogs)
    print("=DONE=")
    ctx.close()
