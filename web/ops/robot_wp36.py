#!/usr/bin/env python3
# ROBOT WP-36 (prod) — 4 ảnh: (1) tab thiếu hệ số, (2) chi tiết sau lưu (xuất 5 tấm), (3) toast XANH, (4) toast VÀNG.
#   Kho: thao tác MÀN thật. Xưởng: gọi tram_quet THẬT qua __sb (vai tho) rồi render veBfToast (component đã deploy). KHÔNG commit.
import os, sys, json, time, subprocess, pathlib
from playwright.sync_api import sync_playwright

OPS = pathlib.Path(__file__).parent
OUT = pathlib.Path.home() / "Downloads" / "wp36_shots"; OUT.mkdir(parents=True, exist_ok=True)
KHO, XUONG = "https://togihome-kho.pages.dev", "https://togihome-xuong.pages.dev"

def nap_env():
    for ln in (OPS / ".env.robot").read_text().splitlines():
        if "=" in ln and not ln.strip().startswith("#"):
            k, v = ln.split("=", 1); os.environ[k.strip()] = v.strip()
nap_env()
KHO_E, KHO_P = os.environ["TEST_KHO_EMAIL"], os.environ["TEST_KHO_PASS"]
XU_E, XU_P = os.environ["TEST_CEO_EMAIL"], os.environ["TEST_CEO_PASS"]   # ceo: có quyền quét (allow-list tram_gac_vai) + đăng nhập được xưởng

def node(js):
    r = subprocess.run(["node", str(OPS / js)], cwd=str(OPS.parent), capture_output=True, text=True)
    print(f"  [{js}]", (r.stdout + r.stderr).strip()[:200]); return r.stdout.strip()

seed = json.loads([l for l in node("_wp36_seed.mjs").splitlines() if l.startswith("{")][0])
MA, VAN, TEMS = seed["ma_don"], seed["van"], seed["tems"]
print("SEED:", MA, "ván", VAN, "tems", TEMS)
N = {"i": 0}
def shot(pg, name):
    N["i"] += 1; f = OUT / f"{N['i']}_{name}.png"; pg.screenshot(path=str(f)); print("  📸", f.name)

def login(pg, url, email, pwd, tram=None):
    pg.goto(url + ("/?tram=" + tram if tram else ""), wait_until="domcontentloaded"); time.sleep(2.5)
    if pg.locator('#lg-pass').is_visible():
        pg.fill('#lg-email', email); pg.fill('#lg-pass', pwd); pg.locator('#lg-btn').click()
        for _ in range(50):
            time.sleep(0.3)
            if not pg.locator('#lg-pass').is_visible(): break
    time.sleep(2.5)

def scan_toast(px, tem):   # gọi tram_quet THẬT (vai tho) rồi render toast đã deploy
    return px.evaluate("""async ([tem,tram]) => {
        const r = await window.__sb.rpc('tram_quet', {p_tem:tem, p_tram:tram});
        if (r.error) return {err:r.error.message};
        window.veBfToast(r.data); return r.data;
    }""", [tem, "TRAM-CAT-01"])

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        ck = br.new_context(viewport={"width": 1280, "height": 900}); pk = ck.new_page()
        pk.on("console", lambda m: print("  [kho.err]", m.text[:120]) if m.type == "error" else None)
        cx = br.new_context(viewport={"width": 412, "height": 850}, is_mobile=True, device_scale_factor=2); px = cx.new_page()
        px.on("console", lambda m: print("  [xuong.err]", m.text[:120]) if m.type == "error" else None)

        # (1) Kho tab thiếu hệ số
        login(pk, KHO, KHO_E, KHO_P)
        pk.locator('nav button[data-m="tsvt"]').click(); time.sleep(2.5)
        try: pk.locator('#tsvt-chithieu').check(); time.sleep(1)
        except Exception: pass
        shot(pk, "kho_tab_thieu_he_so")

        # Xưởng: nạp trang rồi xác thực __sb TRỰC TIẾP (đảm bảo JWT gắn vào rpc; form login để anon)
        px.goto(XUONG + "/?tram=TRAM-CAT-01", wait_until="domcontentloaded"); time.sleep(2.5)
        au = px.evaluate("""async ([e,p]) => { const r = await window.__sb.auth.signInWithPassword({email:e,password:p});
            return r.error ? {err:r.error.message} : {ok:(await window.__sb.auth.getUser()).data.user.email}; }""", [XU_E, XU_P])
        print("  xuong auth:", au)
        px.reload(wait_until="domcontentloaded"); time.sleep(3)   # app nhận phiên → hiện màn quét (ca đã seed) làm nền

        # (4) toast VÀNG — quét món1 khi CHƯA hệ số
        r4 = scan_toast(px, TEMS[0]); print("  scan1:", json.dumps(r4, ensure_ascii=False)[:160])
        px.wait_for_timeout(1200)
        try: px.locator('.tq-bf.canh.hien').wait_for(timeout=4000)
        except Exception as e: print("  ⚠ vàng:", str(e)[:70])
        shot(px, "xuong_toast_vang")

        # (2) Kho: chọn ván → khổ+hao → Lưu → chọn lại → chi tiết sau lưu (xuất 5 tấm)
        pk.locator('#tsvt-ds li', has_text=VAN).first.click(); time.sleep(2)
        pk.fill('#ts-dai', '1220'); pk.fill('#ts-rong', '2440'); pk.fill('#ts-hao', '10')
        pk.locator('#ts-dai').dispatch_event('input'); time.sleep(0.4)
        pk.locator('#tsvt-ct .tsvt-nut .chinh').click(); time.sleep(3)
        try:
            pk.locator('#tsvt-chithieu').uncheck()  # sau lưu ván không còn "thiếu" → bỏ lọc để thấy lại
            time.sleep(1); pk.locator('#tsvt-ds li', has_text=VAN).first.click(); time.sleep(2.5)
        except Exception as e: print("  ⚠ reselect:", str(e)[:70])
        shot(pk, "kho_chi_tiet_sau_luu")

        # (3) toast XANH — quét món2 SAU hệ số
        r3 = scan_toast(px, TEMS[1]); print("  scan2:", json.dumps(r3, ensure_ascii=False)[:160])
        px.wait_for_timeout(1200)
        try: px.locator('.tq-bf.hien').wait_for(timeout=4000)
        except Exception as e: print("  ⚠ xanh:", str(e)[:70])
        shot(px, "xuong_toast_xanh")

        br.close()
finally:
    node("_wp36_clean.mjs"); print("Ảnh:", OUT)
