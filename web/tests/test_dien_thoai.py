# -*- coding: utf-8 -*-
# Bố cục ĐIỆN THOẠI (<820px) nối vào app thật. Chạy ở 360/390/430px, đăng nhập ceo thật.
#   a. không cuộn ngang trên MỌI trang · b. ☰ mở/đóng nav · c. Lọc mở/thu chip
#   d. mở panel, tồn ĐÚNG DB · e. vùng bấm ≥44px · f. không phần tử tràn ngang
#   g. phiếu nhập: gõ 5 phím đơn giá không mất focus · h. danh sách tồn đủ 199 dòng
# Gõ phím thật. KHÔNG gọi hàm JS của app (chỉ đọc DOM). KHÔNG tạo phiếu, KHÔNG Ghi sổ.

import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = [("ton", "Tồn kho"), ("dat", "Cần đặt hàng"), ("nhap", "Phiếu nhập kho"),
         ("xuat", "Phiếu xuất kho"), ("ncc", "Nhà cung cấp")]
loi = []


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def db_one(sql):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           f"const r=await c.query(`{sql}`); console.log(r.rows[0]?String(Object.values(r.rows[0])[0]):''); "
           "await c.end(); process.exit(0);")
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB_DIR)
    if out.returncode != 0:
        print("LỖI DB:", out.stderr.strip()); sys.exit(2)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    ton_bl03 = str(int(float(db_one("select so_luong from kho.ton t join kho.vat_tu v on v.id=t.vat_tu_id where v.ma='BL-03'"))))
    print(f"  (DB) BL-03 tồn = {ton_bl03}")

    with sync_playwright() as p:
        b = p.chromium.launch()
        for W in (360, 390, 430):
            print(f"── {W}px ──")
            pg = b.new_page(viewport={"width": W, "height": 820})

            def login():
                pg.goto(URL, wait_until="networkidle")
                pg.fill("#lg-email", EMAIL); pg.fill("#lg-pass", PASS); pg.click("#lg-btn")
                pg.wait_for_selector("#login", state="hidden", timeout=15000)
                pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='199'}", timeout=12000)
            login()

            def di_toi(m):
                pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000)
                pg.click(f'nav button[data-m="{m}"]'); pg.wait_for_selector(f"#m-{m}.on", timeout=8000)
                pg.wait_for_selector("nav:not(.mo)", timeout=4000); pg.wait_for_timeout(350)

            # a. không cuộn ngang trên mọi trang
            for m, ten in PAGES:
                di_toi(m)
                sc = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
                bao(f"a.{W} {ten} không cuộn ngang", sc <= cw, f"scrollW={sc} clientW={cw}")
                if sc > cw:
                    raise AssertionError(f"a: {ten} @{W}px cuộn ngang (scrollW={sc}>{cw})")

            di_toi("ton")
            # h. danh sách tồn 199 dòng
            nrow = pg.locator("#bang tr").count()
            bao(f"h.{W} danh sách tồn 199 dòng", nrow == 199, f"đếm {nrow}")
            if nrow != 199:
                raise AssertionError(f"h: {nrow} dòng != 199")

            # f. không phần tử tràn ngoài chiều rộng (panel/chip đang đóng)
            tran = pg.evaluate(f"""() => {{
              const W={W}; const out=[];
              for(const el of document.querySelectorAll('body *')){{
                const s=getComputedStyle(el); if(s.position==='fixed'||s.display==='none') continue;
                const r=el.getBoundingClientRect();
                if(r.width>0 && r.right>W+1) out.push((el.id||el.className||el.tagName)+' r='+Math.round(r.right));
              }} return out.slice(0,6);
            }}""")
            bao(f"f.{W} không phần tử tràn ngang", len(tran) == 0, ', '.join(tran))
            if tran:
                raise AssertionError(f"f: tràn @{W}: {tran}")

            # e. vùng bấm được ≥44px (đang ở trang tồn, panel/chip đóng)
            nho = pg.evaluate("""() => {
              const out=[];
              for(const el of document.querySelectorAll('button, a, input, [onclick]')){
                const s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden') continue;
                const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
                if(r.height<44) out.push((el.id||el.textContent||el.className||el.tagName).trim().slice(0,18)+'='+Math.round(r.height));
              } return out;
            }""")
            bao(f"e.{W} vùng bấm ≥44px", len(nho) == 0, ', '.join(nho[:8]))
            if nho:
                raise AssertionError(f"e: nút nhỏ @{W}: {nho}")

            # b. ☰ mở & đóng nav
            pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000)
            o1 = pg.locator("nav").evaluate("e=>e.classList.contains('mo')")
            pg.click("nav .nav-x"); pg.wait_for_selector("nav:not(.mo)", timeout=4000); pg.wait_for_timeout(350)
            o2 = pg.locator("nav").evaluate("e=>e.classList.contains('mo')")
            bao(f"b.{W} ☰ mở & đóng nav", o1 and not o2)
            if not (o1 and not o2):
                raise AssertionError("b: nav không mở/đóng")

            # c. Lọc mở & thu chip
            pg.click(".mb-loc"); c1 = pg.locator("#chips-row").evaluate("e=>e.classList.contains('mo')")
            pg.click(".mb-loc"); c2 = pg.locator("#chips-row").evaluate("e=>e.classList.contains('mo')")
            bao(f"c.{W} Lọc mở & thu chip", c1 and not c2)
            if not (c1 and not c2):
                raise AssertionError("c: chip không mở/thu")

            # d. mở panel BL-03, tồn đúng DB
            pg.fill("#tim", "BL-03")
            row = '#bang tr:has(td.ma:text-is("BL-03"))'
            pg.wait_for_selector(row, timeout=8000); pg.click(row)
            pg.wait_for_selector("#the.on .the-so", timeout=8000)
            tp = re.sub(r"\D", "", pg.locator("#the .the-so > div").first.locator("b").text_content())
            bao(f"d.{W} panel BL-03 tồn = DB ({ton_bl03})", tp == ton_bl03, f"panel={tp}")
            if tp != ton_bl03:
                raise AssertionError(f"d: panel tồn {tp} != DB {ton_bl03}")
            pg.keyboard.press("Escape")
            pg.wait_for_selector("#the.on", state="hidden", timeout=5000)

            # g. phiếu nhập: gõ 5 phím đơn giá không mất focus
            di_toi("nhap")
            pg.wait_for_selector("#ph-nhap table tbody tr", timeout=8000)
            gia = pg.locator("#ph-nhap tbody tr").first.locator('input:not([type="number"])').element_handle()
            gia.click(); pg.keyboard.press("Meta+A"); pg.keyboard.press("Delete")
            giu = True
            for ch in "10000":
                pg.keyboard.press(ch)
                if not pg.evaluate("el => document.activeElement === el", gia):
                    giu = False
            val = gia.evaluate("el => el.value")
            bao(f"g.{W} đơn giá gõ 5 phím giữ focus", giu and re.sub(r'\D', '', val) == "10000", f"focus={giu} val={val!r}")
            if not (giu and re.sub(r'\D', '', val) == "10000"):
                raise AssertionError("g: đơn giá mất focus hoặc sai giá trị")

            pg.close()
        b.close()

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}"); sys.exit(1)
    print("✅ TẤT CẢ PASS — bố cục điện thoại chạy đúng ở 360/390/430px.")


if __name__ == "__main__":
    main()
