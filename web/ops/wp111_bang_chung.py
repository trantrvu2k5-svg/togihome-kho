#!/usr/bin/env python3
# WP-111 — BẰNG CHỨNG TỰ ĐỘNG (thay việc CEO mở DevTools chụp). Playwright không chụp được panel DevTools,
#   nhưng CDP đọc ĐÚNG dữ liệu panel đó (danh sách request đầy đủ). Profile SẠCH (--disable-extensions: bỏ
#   Futoo/Pinterest/Fatkun chèn request+console rác), phiên test_ceo, 400x836 như CEO xem.
#   Xuất ~/Downloads/: bang_chung_network.txt · _console.txt · _react.txt · wp111_prod_man.png · wp111_bang_chung.png
import pathlib, time, json, sys
from playwright.sync_api import sync_playwright

PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
OUT = pathlib.Path.home() / "Downloads"
APEX = "https://togihome-sale.pages.dev"
VP = {"width": 400, "height": 836}
ARGS = ["--disable-extensions", "--disable-component-extensions-with-background-pages"]

def do(pw, abort_cdnjs=False):
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport=VP, args=ARGS)
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); cdp.send("Network.enable")
    R = {}
    cdp.on("Network.requestWillBeSent", lambda p: R.setdefault(p["requestId"], {}).update(url=p["request"]["url"], type=p.get("type", "")))
    cdp.on("Network.responseReceived", lambda p: R.setdefault(p["requestId"], {}).update(status=p["response"]["status"], type=p.get("type", "")))
    cdp.on("Network.loadingFinished", lambda p: R.setdefault(p["requestId"], {}).update(size=int(p.get("encodedDataLength", 0))))
    console = []; pe = []; aborted = []
    pg.on("console", lambda m: console.append((m.type, m.text)))
    pg.on("pageerror", lambda e: pe.append(str(e)))
    if abort_cdnjs:
        pg.route("**/*", lambda r: (aborted.append(r.request.url), r.abort()) if "cdnjs" in r.request.url.lower() else r.continue_())
    pg.goto(APEX, wait_until="load")
    pg.get_by_text("Sổ đơn hàng").first.wait_for(timeout=25000); time.sleep(2.5)
    react = {
        "React": pg.evaluate("typeof window.React"),
        "createRoot": pg.evaluate("typeof (window.ReactDOM && window.ReactDOM.createRoot)"),
        "root_len": pg.evaluate("((document.getElementById('root')||{}).innerText||'').trim().length"),
        "tabs": pg.evaluate("['Báo giá','Sổ đơn hàng','Đợt đến hạn','Nhóm','Đăng xuất'].filter(t=>((document.getElementById('root')||{}).innerText||'').includes(t)).length"),
    }
    if not abort_cdnjs:
        pg.screenshot(path=str(OUT / "wp111_prod_man.png"))
    reqs = [v for v in R.values() if v.get("url")]
    ctx.close()
    return reqs, console, pe, react, aborted

with sync_playwright() as pw:
    reqs, console, pe, react, _ = do(pw)
    _, _, _, _, aborted = do(pw, abort_cdnjs=True)

def host(u):
    try: return u.split("/")[2]
    except Exception: return "?"
ngoai = sorted(set(host(r["url"]) for r in reqs if r["url"].startswith("http") and "togihome-sale.pages.dev" not in r["url"]))
cdnjs_n = sum(1 for r in reqs if "cdnjs" in r["url"].lower())
fonts = [h for h in ngoai if "fonts.g" in h]
supa = [h for h in ngoai if "supabase" in h]
ce = sum(1 for t, _ in console if t == "error")

# (a) network.txt
lines = [f"{r.get('status','-'):>4} | {r.get('type','-'):<10} | {r.get('size','-'):>8} | {r['url']}" for r in reqs]
net = ["=== WP-111 BẰNG CHỨNG · NETWORK (CDP thật, profile sạch --disable-extensions, 400x836) ===", ""] + lines + [
    "", f"TỔNG REQUEST: {len(reqs)}",
    f"REQUEST TỚI cdnjs: {cdnjs_n}  (phải 0)",
    f"HOST NGOÀI DOMAIN: {ngoai}  → fonts={fonts} · supabase(API nhà mình)={supa}",
    "", "--- VẾ NGƯỢC (route ABORT mọi cdnjs) ---",
    f"số request cdnjs bị abort: {len(aborted)}  (phải 0 — app KHÔNG gọi cdnjs)  {aborted[:3]}",
]
(OUT / "bang_chung_network.txt").write_text("\n".join(net))
# (b) console.txt
con = ["=== WP-111 BẰNG CHỨNG · CONSOLE + PAGEERROR ===", ""] + [f"[{t}] {x}" for t, x in console] + \
      ["", "--- PAGEERROR ---"] + (pe if pe else ["(0)"]) + ["", f"console.error: {ce}  (phải 0)", f"pageerror: {len(pe)}  (phải 0)"]
(OUT / "bang_chung_console.txt").write_text("\n".join(con))
# (c) react.txt
rea = ["=== WP-111 BẰNG CHỨNG · REACT (từ bundle, không CDN) ===", "",
       f"typeof window.React            : {react['React']}  (kỳ vọng object)",
       f"typeof window.ReactDOM.createRoot: {react['createRoot']}  (kỳ vọng function)",
       f"gốc app #root có nội dung (ký tự): {react['root_len']}  (>40 = đã mount)",
       f"số tab đọc được                 : {react['tabs']}  (đủ 5)"]
(OUT / "bang_chung_react.txt").write_text("\n".join(rea))

# (2b) render 3 file .txt → 1 ảnh
ok = cdnjs_n == 0 and ce == 0 and len(pe) == 0 and react["React"] == "object" and react["createRoot"] == "function" and react["tabs"] >= 5 and len(aborted) == 0
html = f"""<div style="font:14px/1.5 -apple-system,sans-serif;padding:22px;max-width:760px;color:#111">
<h2 style="margin:0 0 4px">WP-111 · BẰNG CHỨNG TỰ ĐỘNG <span style="color:{'#159a5b' if ok else '#c8202e'}">{'✓ ĐẠT' if ok else '✗'}</span></h2>
<div style="color:#666;margin-bottom:14px">prod togihome-sale.pages.dev · CDP thật · profile sạch (0 tiện ích) · 400×836</div>
<table style="border-collapse:collapse;width:100%;font-size:13.5px">
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">Tổng request</td><td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700">{len(reqs)}</td></tr>
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">Request tới <b>cdnjs</b></td><td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700;color:{'#159a5b' if cdnjs_n==0 else '#c8202e'}">{cdnjs_n} (phải 0)</td></tr>
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">Host ngoài domain</td><td style="padding:7px 10px;border-bottom:1px solid #eee">{', '.join(fonts)} <span style="color:#888">· supabase (API nhà mình)</span></td></tr>
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">console.error / pageerror</td><td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700;color:{'#159a5b' if ce==0 and len(pe)==0 else '#c8202e'}">{ce} / {len(pe)}</td></tr>
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">window.React · createRoot</td><td style="padding:7px 10px;border-bottom:1px solid #eee">{react['React']} · {react['createRoot']}</td></tr>
<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#555">React mount · số tab</td><td style="padding:7px 10px;border-bottom:1px solid #eee">{react['root_len']} ký tự · {react['tabs']} tab</td></tr>
<tr><td style="padding:7px 10px;color:#555">Chặn cdnjs → request bị abort</td><td style="padding:7px 10px;font-weight:700;color:{'#159a5b' if len(aborted)==0 else '#c8202e'}">{len(aborted)} (app không gọi cdnjs)</td></tr>
</table></div>"""
htmlf = OUT / "_bc.html"; htmlf.write_text(html)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True); p = b.new_context(viewport={"width": 800, "height": 460}).new_page()
    p.goto("file://" + str(htmlf)); time.sleep(0.5); p.screenshot(path=str(OUT / "wp111_bang_chung.png")); b.close()
htmlf.unlink()

# (4) 9 dòng terminal — asset lấy từ chính request đã bắt (CDP)
asset = next((r["url"].split("assets/")[1] for r in reqs if "/assets/sale-" in r["url"] and r["url"].endswith(".js")), "(không thấy)")
print("── 9 DÒNG KIỂM MẮT ──")
print(f"1. asset prod đang phục vụ : assets/{asset}")
print(f"2. tổng request            : {len(reqs)}")
print(f"3. request tới cdnjs        : {cdnjs_n}  (phải 0)")
print(f"4. host ngoài domain        : {fonts}  (+ supabase API nhà mình)")
print(f"5. console.error            : {ce}  (phải 0)")
print(f"6. pageerror                : {len(pe)}  (phải 0)")
print(f"7. window.React             : {react['React']}")
print(f"8. ReactDOM.createRoot      : {react['createRoot']}")
print(f"9. React mount (tab/ký tự)   : {react['tabs']} tab · {react['root_len']} ký tự  · chặn-cdnjs abort={len(aborted)}")
print(f"\nẢNH: {OUT/'wp111_prod_man.png'} · {OUT/'wp111_bang_chung.png'}")
print(f"TXT: {OUT/'bang_chung_network.txt'} · _console.txt · _react.txt")
sys.exit(0 if ok else 1)
