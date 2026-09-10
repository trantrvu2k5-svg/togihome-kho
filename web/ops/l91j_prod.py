#!/usr/bin/env python3
# L-91j prod — chụp khối "Chi quảng cáo theo thương hiệu" tab Kênh & CAC (app Tài chính), vai ceo, profile SẠCH.
#   ảnh 1: trạng thái THẬT hôm nay (dải xanh, tổng 306.688.506đ). ảnh 2: vế ĐỎ dựng bằng ROUTE-OVERRIDE phản hồi RPC
#   (dữ liệu prod NGUYÊN VẸN — app đọc REST commit-only nên tx-rollback không hiện; đây là cách trung thực thay thế).
import os, sys, json, tempfile, pathlib
from playwright.sync_api import sync_playwright

OPS = pathlib.Path(__file__).resolve().parent
URL = sys.argv[1] if len(sys.argv) > 1 else "https://togihome-taichinh.pages.dev"
OUT = pathlib.Path.home() / "Downloads"
def nap_env():
    for ln in (OPS / ".env.robot").read_text().splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
nap_env()
E, P = os.environ["TEST_CEO_EMAIL"], os.environ["TEST_CEO_PASS"]

# payload ĐỎ (stub) — số trước L-91i: chưa gán 4.351.354đ / 2 fanpage. Σbrand+chưa=tổng.
DO_PAYLOAD = {
    "tu": "2026-06-01", "den": "2026-09-09", "tong": 306688506,
    "do_phu_n": 2, "do_phu_mau": 9,
    "brands": [
        {"ma": "sconcept", "ten": "Sophia Concept", "an": False, "so_mau": 44, "tien": 172688820},
        {"ma": "openliving", "ten": "Open Living", "an": False, "so_mau": 17, "tien": 129648332},
    ],
    "chua_gan": {"tien": 4351354, "so_tk": 2, "fanpages": [
        {"page_id": "1189129987617712", "tien": 3909083, "so_tk": 1},
        {"page_id": "100276159846147", "tien": 442271, "so_tk": 1},
    ]},
}

logs, errs = [], []
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=tempfile.mkdtemp(prefix="l91j-"), channel="chrome",
        headless=True, args=["--disable-extensions"], viewport={"width": 1200, "height": 1400})
    pg = ctx.new_page()
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.fill("#e", E); pg.fill("#p", P); pg.click("#b")
    pg.wait_for_selector("button[data-tab='kenhcac']", timeout=20000)
    pg.click("button[data-tab='kenhcac']")
    pg.wait_for_selector("#tc_phu_root .tc-phu-card, #tc_phu_root .tc-phu-cover", timeout=20000)
    pg.wait_for_timeout(1200)
    el = pg.query_selector("#tc_phu_root")
    el.screenshot(path=str(OUT / "l91j_1_xanh.png"))
    tong_txt = pg.eval_on_selector("#tc_phu_root .tc-phu-tong", "e=>e.textContent") if pg.query_selector("#tc_phu_root .tc-phu-tong") else "(?)"
    cover1 = pg.eval_on_selector("#tc_phu_root .tc-phu-cover", "e=>e.className") if pg.query_selector("#tc_phu_root .tc-phu-cover") else "(?)"
    print(f"ẢNH 1 (xanh): tổng hiển thị = {tong_txt} · dải = {cover1}")

    # ── ẢNH 2: route-override RPC → vế ĐỎ (prod DB không đụng) ──
    pg.route("**/rest/v1/rpc/ads_chi_theo_brand*", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(DO_PAYLOAD)))
    pg.click("button[data-tab='dieuhanh']"); pg.wait_for_timeout(400)
    pg.click("button[data-tab='kenhcac']")
    pg.wait_for_selector("#tc_phu_root .tc-phu-cover-do", timeout=20000)
    pg.wait_for_timeout(800)
    pg.query_selector("#tc_phu_root").screenshot(path=str(OUT / "l91j_2_do.png"))
    cover2 = pg.eval_on_selector("#tc_phu_root .tc-phu-cover", "e=>e.className")
    print(f"ẢNH 2 (đỏ · stub route): dải = {cover2}")
    ctx.close()

err_console = [l for l in logs if l.startswith("error")]
print(f"\nconsole: {len(logs)} dòng · lỗi console: {len(err_console)} · pageerror: {len(errs)}")
for l in err_console[:8]: print("  ⛔", l)
for e in errs[:8]: print("  💥", e)
print(f"ảnh: {OUT}/l91j_1_xanh.png · {OUT}/l91j_2_do.png")
print("SẠCH" if not err_console and not errs else "CÓ LỖI CONSOLE")
