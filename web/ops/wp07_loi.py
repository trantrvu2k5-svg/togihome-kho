#!/usr/bin/env python3
# ROBOT WP-07 L-136 — ép LỖI RPC qua nút thật, xác nhận banner hiện NGUYÊN VĂN message server.
#   "+ Báo giá mới" với NGÂN SÁCH = -5 → tao_don INSERT vi phạm CHECK ngan_sach_trieu>=0 → RPC RAISE
#   → up() (đã sửa L-136) hiện message server nguyên văn ở banner .note.rd (không còn "bộ nhớ đầy").
import os, time, pathlib, re
from playwright.sync_api import sync_playwright
OPS = pathlib.Path(__file__).resolve().parent
URL = "https://togihome-sale.pages.dev"
PROFILE = str(pathlib.Path.home() / ".togihome-wp07l136-profile")
SHOT = pathlib.Path.home() / "Downloads" / "wp07_l136"; SHOT.mkdir(parents=True, exist_ok=True)
for ln in (OPS / ".env.robot").read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith("#") and "=" in ln:
        k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
SE, SP = os.environ["TEST_SALE_EMAIL"], os.environ["TEST_SALE_PASS"]
dialogs = []
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1400, "height": 950})
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:200]))
    pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {str(e)}"[:200]))
    reqs = []
    pg.on("response", lambda r: reqs.append(f"{r.status} {r.url.split('/rest/v1/')[-1][:60]}") if '/rest/v1/' in r.url else None)
    pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(URL, wait_until="domcontentloaded"); time.sleep(3)
    if pg.locator('#p').is_visible():
        pg.fill('#e', SE); pg.fill('#p', SP); pg.locator('#b').click(); time.sleep(3)
    print("✔ đăng nhập test_sale")
    # + Báo giá mới
    pg.get_by_role("button", name=re.compile("Báo giá mới")).first.click(); time.sleep(1.2)
    m = pg.locator('.mdl').last
    # thương hiệu = option đầu có value
    s = m.locator('select').first
    v = pg.evaluate("el => { for (const o of el.options){ if(o.value) return o.value } return '' }", s.element_handle())
    if v: s.select_option(v)
    m.get_by_placeholder("0903 792 333").fill("0900000936")
    m.get_by_placeholder("Chị Lan").fill("DEMO WP07 loi")
    m.get_by_placeholder(re.compile("Tủ áo 3 cánh")).first.fill("Món demo lỗi")
    m.get_by_placeholder(re.compile("vd 30")).fill("-5")   # NGÂN SÁCH ÂM → CHECK vi phạm ở tao_don
    time.sleep(0.3); pg.screenshot(path=str(SHOT / "1_form_truoc_luu.png"))
    pg.get_by_role("button", name="Lưu báo giá").click(); time.sleep(3)
    # đọc banner lỗi
    banner = ""
    try:
        b = pg.locator('.note.rd')
        if b.count(): banner = b.first.inner_text()
    except Exception as ex: banner = f"(đọc banner lỗi: {ex})"
    pg.screenshot(path=str(SHOT / "2_banner_loi_nguyen_van.png"), full_page=True)
    print("── BANNER .note.rd trên màn ──")
    print(banner or "(KHÔNG thấy banner .note.rd)")
    print("── dialog (nếu có) ──", dialogs)
    print("── console/pageerror (lọc lỗi) ──")
    for l in logs[-12:]:
        if any(k in l.lower() for k in ["error", "loi", "ngan", "check", "rpc", "tao_don", "permission"]): print("  ", l)
    print("── responses REST (cuối) ──")
    for r in reqs[-8:]: print("  ", r)
    print("=DONE=")
    ctx.close()
