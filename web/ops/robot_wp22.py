#!/usr/bin/env python3
# ROBOT WP-22b (prod) — ảnh (a) form khớp DM-2026-0003 THẬT chưa ghi · (c) demo đơn ghi HĐ rồi nuke. KHÔNG bịa số lên đơn thật.
import os, sys, json, time, subprocess, pathlib
from playwright.sync_api import sync_playwright
OPS = pathlib.Path(__file__).parent
OUT = pathlib.Path.home() / "Downloads" / "wp22_shots"; OUT.mkdir(parents=True, exist_ok=True)
KHO = "https://togihome-kho.pages.dev"
DM3 = "a65ad880-89ae-4020-8b26-733f577077f2"   # DM-2026-0003 (da_nhan)
for ln in (OPS / ".env.robot").read_text().splitlines():
    if "=" in ln and not ln.strip().startswith("#"):
        k, v = ln.split("=", 1); os.environ[k.strip()] = v.strip()
E, P = os.environ["TEST_CEO_EMAIL"], os.environ["TEST_CEO_PASS"]
def node(js, *a):
    r = subprocess.run(["node", str(OPS / js), *a], cwd=str(OPS.parent), capture_output=True, text=True)
    print(f"  [{js}]", (r.stdout + r.stderr).strip()[:180]); return r.stdout.strip()
N = {"i": 0}
def shot(pg, name):
    N["i"] += 1; f = OUT / f"{N['i']}_{name}.png"; pg.screenshot(path=str(f), full_page=True); print("  📸", f.name)
demoId = None
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        pg = br.new_context(viewport={"width": 1360, "height": 1000}).new_page()
        pg.on("console", lambda m: print("  [err]", m.text[:140]) if m.type == "error" else None)
        pg.goto(KHO, wait_until="domcontentloaded"); time.sleep(2.5)
        if pg.locator('#lg-pass').is_visible():
            pg.fill('#lg-email', E); pg.fill('#lg-pass', P); pg.locator('#lg-btn').click()
            for _ in range(50):
                time.sleep(0.3)
                if not pg.locator('#lg-pass').is_visible(): break
        time.sleep(2)
        pg.locator('nav button[data-m="dm"]').click(); time.sleep(2)
        # (a) form khớp DM-2026-0003 THẬT, chưa ghi
        pg.evaluate("id => window.dmKhopForm(id)", DM3); time.sleep(2.5)
        shot(pg, "a_form_khop_DM0003_that")
        # (c) demo đơn: seed → ghi HĐ demo → chụp danh sách HĐ → nuke
        seed = json.loads([l for l in node("_wp22_seed.mjs").splitlines() if l.startswith("{")][0])
        demoId = seed["id"]; print("  seed demo:", seed)
        pg.evaluate("id => window.dmKhopForm(id)", demoId); time.sleep(2.5)
        pg.fill('#k-sohd', 'DEMO-HD-001'); time.sleep(0.5)
        pg.locator('#k-ghi-btn').click(); time.sleep(3)   # → dmXem hiện lại + danh sách HĐ + trạng thái mới
        shot(pg, "c_sau_ghi_HD_demo")
        br.close()
finally:
    if demoId: node("_wp22_clean.mjs", demoId)
    print("Ảnh:", OUT)
