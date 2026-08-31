#!/usr/bin/env python3
# L-79f mục A — SOI DOM cụm nút chat sconcept.vn (cổng chặn: không đoán). Chỉ đọc, không đăng nhập.
import time, pathlib
from playwright.sync_api import sync_playwright

URL = "https://sconcept.vn/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27"
SHOT = pathlib.Path.home() / "Downloads" / "l79f"; SHOT.mkdir(parents=True, exist_ok=True)

JS_KHAO = """() => {
  const out = {links: [], shadowHosts: 0, iframes: 0};
  document.querySelectorAll('iframe').forEach(()=>out.iframes++);
  const walk = (root) => {
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { out.shadowHosts++; walk(el.shadowRoot); } });
    root.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href') || '';
      if (/zalo\\.me|m\\.me|messenger\\.com|ig\\.me|tel:/.test(h))
        out.links.push({tag: a.tagName, href: h, cls: a.className, html: a.outerHTML.slice(0,300)});
    });
    // cả div/button bắt onclick mang dấu hiệu chat (không phải thẻ a)
    root.querySelectorAll('div,button,span').forEach(el => {
      const oc = el.getAttribute('onclick') || '';
      const dl = (el.getAttribute('data-link')||'') + (el.getAttribute('data-href')||'');
      if (/zalo|messenger|m\\.me|ig\\.me/i.test(oc+dl))
        out.links.push({tag: el.tagName, href: '(onclick/data) '+(oc||dl), cls: el.className, html: el.outerHTML.slice(0,300)});
    });
  };
  walk(document);
  return out;
}"""

def khao(pg): return pg.evaluate(JS_KHAO)

def in_ket(nhan, s):
    print(f"\n=== {nhan} ===")
    print(f"  iframe: {s['iframes']} · shadow host: {s['shadowHosts']} · số link chat/tel: {len(s['links'])}")
    for L in s["links"]:
        print(f"    <{L['tag']}> href={L['href']}  class={str(L['cls'])[:40]}")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 860})
    pg.goto(URL, wait_until="networkidle", timeout=60000)
    time.sleep(3)
    pg.screenshot(path=str(SHOT / "A0_trang.png"))

    in_ket("TRƯỚC khi bấm FAB", khao(pg))

    clicked = False
    for sel in ["text=Bạn cần tư vấn", "[class*=support]", "[class*=contact]", "[class*=float]", "[class*=fab]", "[class*=fixed]"]:
        try:
            loc = pg.locator(sel).first
            if loc.count() and loc.is_visible():
                loc.click(timeout=3000); clicked = True; print(f"\n  → bấm FAB qua selector: {sel}"); break
        except Exception:
            pass
    if not clicked:
        try: pg.mouse.click(390, 820); clicked = True; print("\n  → bấm FAB theo toạ độ góc phải-dưới (390,820)")
        except Exception: pass
    time.sleep(2)
    pg.screenshot(path=str(SHOT / "A1_bung_cum.png"))

    s2 = khao(pg)
    in_ket("SAU khi bấm FAB", s2)

    zalo = [L for L in s2["links"] if "zalo.me" in L["href"]]
    mess = [L for L in s2["links"] if "m.me" in L["href"] or "messenger.com" in L["href"]]
    tel  = [L for L in s2["links"] if L["href"].startswith("tel:")]
    print("\n── outerHTML từng nút ──")
    for nhan, arr in [("Zalo", zalo), ("Messenger/Tùy chỉnh", mess), ("Điện thoại", tel)]:
        print(f"  [{nhan}]")
        for L in arr: print("    " + L["html"])
        if not arr: print("    (không thấy)")

    all_chat = zalo + mess
    la_a = bool(all_chat) and all(L["tag"] == "A" for L in all_chat)
    print("\n── 3 CÂU DỨT KHOÁT ──")
    print(f"  1. Nút là <a href>?  {'ĐÚNG — mọi nút chat là thẻ <a>' if la_a else 'KHÔNG — có div/button bắt onclick'}  (tags={[L['tag'] for L in all_chat]})")
    print(f"  2. Href Zalo: {zalo[0]['href'] if zalo else '(không thấy)'}")
    print(f"     Href Tùy chỉnh/Messenger: {mess[0]['href'] if mess else '(không thấy)'}")
    print(f"  3. iframe/shadow DOM? iframe={s2['iframes']} shadowHost={s2['shadowHosts']} → {'CÓ (DỪNG)' if (s2['iframes'] or s2['shadowHosts']) else 'KHÔNG'}")
    print(f"\n  CỔNG: {'✅ QUA — dựng được bằng đổi href' if (la_a and not s2['shadowHosts']) else '⛔ DỪNG — báo CEO'}")
    b.close()
