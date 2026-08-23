#!/usr/bin/env python3
# ROBOT WP-22c (prod, app Tài chính) — ảnh: (a) Dòng tiền có khối Trả NCC (thật) · (b) Điều hành công nợ NCC (thật)
#   · (c) demo: seed đơn+HĐ → ROBOT ghi phiếu chi qua MÀN → Trả NCC tăng + công nợ giảm → chụp → nuke. KHÔNG bịa số thật.
import os, sys, json, time, subprocess, pathlib
from playwright.sync_api import sync_playwright
OPS = pathlib.Path(__file__).parent
OUT = pathlib.Path.home() / "Downloads" / "wp22_tc_shots"; OUT.mkdir(parents=True, exist_ok=True)
TC = "https://togihome-taichinh.pages.dev"; KY = "2026-08"
for ln in (OPS / ".env.robot").read_text().splitlines():
    if "=" in ln and not ln.strip().startswith("#"):
        k, v = ln.split("=", 1); os.environ[k.strip()] = v.strip()
E, P = os.environ["TEST_CEO_EMAIL"], os.environ["TEST_CEO_PASS"]
def node(js, *a):
    r = subprocess.run(["node", str(OPS / js), *a], cwd=str(OPS.parent), capture_output=True, text=True)
    print(f"  [{js}]", (r.stdout + r.stderr).strip()[:180]); return r.stdout.strip()
R = {"pass": 0, "fail": 0}
def ok(n, v, note=""): print(("✅" if v else "❌") + " " + n + (("  — " + note) if note and not v else "")); R["pass" if v else "fail"] += 1
N = {"i": 0}
def shot(pg, name):
    N["i"] += 1; f = OUT / f"{N['i']}_{name}.png"; pg.screenshot(path=str(f), full_page=True); print("  📸", f.name)
def tab(pg, t): pg.evaluate("t=>document.querySelector(`.navi[data-tab=${JSON.stringify(t)}]`).click()", t); time.sleep(2.5)
demoId = None
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        pg = br.new_context(viewport={"width": 1360, "height": 1100}).new_page()
        pg.on("console", lambda m: print("  [err]", m.text[:140]) if m.type == "error" else None)
        pg.goto(TC, wait_until="domcontentloaded"); time.sleep(2.5)
        if pg.locator('#p').is_visible():
            pg.fill('#e', E); pg.fill('#p', P); pg.locator('#b').click()
            for _ in range(50):
                time.sleep(0.3)
                if not pg.locator('#p').is_visible(): break
        time.sleep(2.5)
        try: pg.select_option('#ky', KY); time.sleep(2)
        except Exception as e: print("  ⚠ chọn kỳ:", str(e)[:60])
        # (a) Dòng tiền THẬT (Trả NCC hiện 0 nếu chưa có phiếu chi — đúng)
        tab(pg, "dongtien"); shot(pg, "a_dongtien_traNCC_that")
        # (b) Điều hành THẬT (công nợ NCC rỗng/thật)
        tab(pg, "dieuhanh"); shot(pg, "b_dieuhanh_congno_that")
        # (c) demo: seed đơn+HĐ → ghi phiếu chi QUA MÀN
        seed = json.loads([l for l in node("_wp22b_seed.mjs").splitlines() if l.startswith("{")][0])
        demoId = seed["id"]; print("  seed:", seed)
        tab(pg, "dongtien"); time.sleep(1)
        # đọc Trả NCC trước khi ghi
        chi0 = pg.evaluate("()=>[...document.querySelectorAll('#dt_chi_body tr')].find(r=>r.innerText.includes('Trả NCC'))?.querySelector('td:last-child')?.innerText||''")
        pg.select_option('#pc_ncc', label=seed["ncc"]); time.sleep(1.5)   # → nạp HĐ còn nợ
        # chọn HĐ demo (option chứa DEMO-HD-B01)
        pg.evaluate("()=>{const s=document.querySelector('#pc_hd');const o=[...s.options].find(o=>o.textContent.includes('DEMO-HD-B01'));if(o)s.value=o.value}")
        pg.fill('#pc_tien', '2.000.000'); pg.locator('#pc_luu').click(); time.sleep(3.5)
        msg = pg.locator('#pc_msg').inner_text()
        ok("WP22 · ghi phiếu chi qua màn OK", '✓' in msg or 'Đã ghi' in msg, msg[:80])
        chi1 = pg.evaluate("()=>[...document.querySelectorAll('#dt_chi_body tr')].find(r=>r.innerText.includes('Trả NCC'))?.querySelector('td:last-child')?.innerText||''")
        ok("WP22 · khối Trả NCC tăng sau ghi", chi1 != chi0 and '2.000.000' in chi1, f"{chi0} → {chi1}")
        pcrow = pg.evaluate("()=>document.querySelector('#pc_body')?.innerText||''")
        ok("WP22 · sổ phiếu chi có dòng vừa ghi", 'DEMO-HD-B01' in pcrow, pcrow[:60])
        shot(pg, "c_dongtien_traNCC_co_so")
        tab(pg, "dieuhanh"); time.sleep(1)
        cnt = pg.evaluate("()=>document.querySelector('#dh_ncc')?.innerText||''")
        ok("WP22 · Điều hành có dòng công nợ NCC (còn nợ 1.300.000)", '1.300.000' in cnt, cnt[:80])
        shot(pg, "c_dieuhanh_congno_co_so")
        print(f"\n⏱ robot Tài chính: {R['pass']} pass / {R['fail']} fail")
        br.close()
finally:
    if demoId: node("_wp22_clean.mjs", demoId)
    print("Ảnh:", OUT)
