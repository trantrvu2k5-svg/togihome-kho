# -*- coding: utf-8 -*-
# App đọc ảnh: (1) anh_file -> bucket · (2) anh_ma -> Drive dự phòng · (3) không -> ô trống.
#   a. 154 ảnh tải được trên trang Tồn kho.
#   b. BL-03 (có anh_file) src trỏ bucket, KHÔNG phải drive.
#   c. mã chỉ-bucket (AA-NAU-18) có ảnh hiện ra.
#   d. mã chỉ-Drive (tự tìm từ DB) src trỏ drive.google.com.
#   e. mã không có cả hai (tự tìm từ DB) hiện ô trống, KHÔNG phải img hỏng.
#   f. source main.js không viết cứng địa chỉ dự án Supabase.
# Gõ phím thật. KHÔNG gọi hàm JS của app. KHÔNG tạo phiếu, KHÔNG Ghi sổ.
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... DB_HOST=... DB_USER=... DB_PASS=... python3 tests/test_anh.py

import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loi = []


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def db_one(sql):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           f"const r=await c.query(`{sql}`); console.log(r.rows[0] ? String(Object.values(r.rows[0])[0]) : '');"
           "await c.end(); process.exit(0);")
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB_DIR)
    if out.returncode != 0:
        print("LỖI SELECT DB:", out.stderr.strip()); sys.exit(2)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)

    # tự tìm mã từ DB (cấm viết cứng)
    ma_drive = db_one("select ma from kho.vat_tu where anh_ma is not null and anh_file is null order by ma limit 1")
    ma_trong = db_one("select ma from kho.vat_tu where anh_ma is null and anh_file is null order by ma limit 1")
    print(f"  (DB) mã chỉ-Drive = {ma_drive} · mã trống-cả-hai = {ma_trong}")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()
        page.goto(URL, wait_until="networkidle")
        page.fill("#lg-email", EMAIL)
        page.fill("#lg-pass", PASS)
        page.click("#lg-btn")
        page.wait_for_selector("#login", state="hidden", timeout=15000)
        page.wait_for_function(
            "() => { const e=document.querySelector('#k-ma'); return e && e.textContent.replace(/\\D/g,'')==='199' }",
            timeout=12000)

        # ── (a) đợi mọi ảnh settle, đếm ảnh tải được = 154 ──
        page.wait_for_function(
            "() => { const im=[...document.querySelectorAll('#bang img')]; return im.length>0 && im.every(i=>i.complete) }",
            timeout=90000)
        loaded = page.eval_on_selector_all("#bang img", "els => els.filter(e => e.naturalWidth > 0).length")
        bao("a. số ảnh tải được = 154", loaded == 154, f"đếm được {loaded}")
        if loaded != 154:
            raise AssertionError(f"a: ảnh tải được {loaded} != 154")

        # helper: lọc 1 mã rồi lấy src ảnh (hoặc None nếu ô trống)
        def src_cua(ma):
            page.fill("#tim", ma)
            row = f'#bang tr:has(td.ma:text-is("{ma}"))'
            page.wait_for_selector(row, timeout=8000)
            img = page.locator(row).locator("img")
            return img.get_attribute("src") if img.count() else None

        # ── (b) BL-03 trỏ bucket ──
        s = src_cua("BL-03")
        ok_b = s is not None and "/storage/v1/object/public/kho-images/" in s and "drive.google.com" not in s
        bao("b. BL-03 src trỏ bucket (không drive)", ok_b, str(s))
        if not ok_b:
            raise AssertionError("b: BL-03 không trỏ bucket")

        # ── (c) mã chỉ-bucket AA-NAU-18 có ảnh ──
        page.fill("#tim", "AA-NAU-18")
        rowc = '#bang tr:has(td.ma:text-is("AA-NAU-18"))'
        page.wait_for_selector(rowc, timeout=8000)
        imgc = page.locator(rowc).locator("img")
        ok_c = imgc.count() > 0 and imgc.evaluate("e => e.naturalWidth > 0")
        bao("c. AA-NAU-18 (chỉ bucket) có ảnh", ok_c)
        if not ok_c:
            raise AssertionError("29 MÃ VẪN TRỐNG")

        # ── (d) mã chỉ-Drive trỏ drive.google.com ──
        sd = src_cua(ma_drive)
        ok_d = sd is not None and "drive.google.com" in sd
        bao(f"d. {ma_drive} (chỉ Drive) src trỏ drive", ok_d, str(sd))
        if not ok_d:
            raise AssertionError("d: mã chỉ-Drive không trỏ drive")

        # ── (e) mã trống cả hai: ô trống, KHÔNG img hỏng ──
        page.fill("#tim", ma_trong)
        rowe = f'#bang tr:has(td.ma:text-is("{ma_trong}"))'
        page.wait_for_selector(rowe, timeout=8000)
        n_img = page.locator(rowe).locator("img").count()
        cell = page.locator(rowe).locator("td .anh").first.inner_text()
        ok_e = n_img == 0 and ("ẢNH" in cell) and ("HỎNG" not in cell)
        bao(f"e. {ma_trong} (trống) ô trống, không img hỏng", ok_e, f"img={n_img} cell={cell!r}")
        if not ok_e:
            raise AssertionError("e: mã trống không hiện ô trống đúng")

        b.close()

    # ── (f) source không viết cứng địa chỉ dự án Supabase ──
    src_code = open(os.path.join(WEB_DIR, "src", "main.js"), encoding="utf-8").read()
    hard = re.search(r"https?://[a-z0-9]+\.supabase\.co", src_code)
    bao("f. source không viết cứng địa chỉ Supabase", hard is None, hard.group(0) if hard else "")
    if hard:
        raise AssertionError("f: có địa chỉ Supabase viết cứng trong source")

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}"); sys.exit(1)
    print("✅ TẤT CẢ PASS — bucket ưu tiên, Drive dự phòng, ô trống/hỏng phân biệt, không viết cứng.")


if __name__ == "__main__":
    main()
