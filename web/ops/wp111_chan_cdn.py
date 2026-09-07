#!/usr/bin/env python3
# WP-111 cổng quyết định — CHẶN mọi request cdnjs trên PROD, app Sale VẪN BOOT.
#   Bằng chứng "cdnjs hỏng app vẫn sống". Phiên test_ceo (profile). KHÔNG deploy, KHÔNG ghi.
import pathlib, time, sys
from playwright.sync_api import sync_playwright

PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
APEX = "https://togihome-sale.pages.dev"
OUT = pathlib.Path.home() / "Downloads" / "wp111_chan_cdn.png"

def main(pw):
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1440, "height": 880})
    pg = ctx.new_page()
    aborted = []
    pg.route("**/*", lambda r: (aborted.append(r.request.url), r.abort()) if "cdnjs" in r.request.url.lower() else r.continue_())
    pe = []; ce = []
    pg.on("pageerror", lambda e: pe.append(str(e)))
    pg.on("console", lambda m: ce.append(m.text) if m.type == "console" and False else (ce.append(m.text) if m.type == "error" else None))
    pg.goto(APEX, wait_until="load")
    pg.get_by_text("Sổ đơn hàng").first.wait_for(timeout=25000); time.sleep(2)
    # sang Sổ đơn hàng để thấy danh sách đơn thật
    try:
        el = [e for e in pg.get_by_text("Sổ đơn hàng").all() if e.is_visible()]
        if el: el[0].click(); time.sleep(2)
    except Exception: pass
    pg.screenshot(path=str(OUT))
    react_ok = pg.evaluate("typeof window.React === 'object' && typeof (window.ReactDOM && window.ReactDOM.createRoot) === 'function'")
    root = pg.evaluate("(document.getElementById('root')||{}).innerText || ''")
    tabs = [t for t in ['Báo giá', 'Sổ đơn hàng', 'Đợt đến hạn', 'Nhóm', 'Đăng xuất'] if t in root]
    mounted = len(tabs) >= 4 and len(root.strip()) > 40
    ok = [
        ("① 0 request cdnjs bị abort (app KHÔNG gọi cdnjs)", len(aborted) == 0, f"{len(aborted)} request: {aborted[:3]}"),
        ("② window.React=object · ReactDOM.createRoot=function", react_ok, ""),
        ("③ React MOUNT + danh sách/tab đơn THẬT hiện", mounted, f"tabs={tabs}"),
        ("④ 0 pageerror · 0 console.error", len(pe) == 0 and len(ce) == 0, f"pe={pe[:2]} ce={ce[:2]}"),
    ]
    for t, c, chi in ok:
        print(("  ✓ " if c else "  ✗ KHÔNG ") + t + ("" if c else "  → " + chi))
    ctx.close()
    return all(c for _, c, _ in ok), len(aborted), aborted

with sync_playwright() as pw:
    allok, nab, ab = main(pw)
print(f"\n  ẢNH: {OUT}")
print(f"═══ WP-111 chặn cdnjs: {'ĐẠT — cdnjs hỏng app VẪN BOOT' if allok else 'KHÔNG ĐẠT'} ═══")
if nab > 0:
    print("  DỪNG: app CÓ gọi cdnjs (bị abort) — URL:", ab)
sys.exit(0 if allok else 1)
