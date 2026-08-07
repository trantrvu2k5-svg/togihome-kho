# -*- coding: utf-8 -*-
# Chứng minh THẺ KHO + TRANG TỒN KHO luôn hiện tồn TƯƠI (đọc DB), không đọc số cũ trong bộ nhớ.
#
# Cổng quan trọng nhất (mục d): ghi đè cố ý biến KHO trong trình duyệt thành 999, mở lại thẻ kho
#   bằng CLICK THẬT — panel phải hiện số chuẩn từ DB, KHÔNG phải 999.
#
# Không gọi hàm JS để giả lập kết quả. page.evaluate CHỈ dùng đúng việc ghi đè bộ nhớ (mục c/f).
# TUYỆT ĐỐI không bấm Ghi sổ, không tạo phiếu, không ghi gì vào DB. Chạy lại nhiều lần y hệt.
#
# Chạy:
#   cd web
#   DEV_URL=http://localhost:5180/ CEO_EMAIL=ceo@togihome.local CEO_PASS=... \
#   DB_HOST=... DB_USER=... DB_PASS=... python3 tests/test_ton_tuoi.py

import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
MA = "BL-03"
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

digits = lambda s: re.sub(r"\D", "", s or "")


def ton_db(ma):
    """SELECT tồn thật của mã từ DB (chỉ đọc), qua node + ops/conn.mjs. Trả về int."""
    src = (
        "import pg from 'pg';"
        "import { docConfig } from './ops/conn.mjs';"
        "const c = new pg.Client(await docConfig()); await c.connect();"
        "const r = await c.query("
        "  \"select coalesce(sum(t.so_luong),0) s from kho.ton t join kho.vat_tu v on v.id=t.vat_tu_id where v.ma=$1\","
        "  [process.env.MA]);"
        "console.log(String(r.rows[0].s)); await c.end();"
    )
    out = subprocess.run(
        ["node", "--input-type=module"],
        input=src, capture_output=True, text=True,
        cwd=WEB_DIR, env={**os.environ, "MA": ma},
    )
    if out.returncode != 0:
        print("KHÔNG SELECT ĐƯỢC TỒN DB:\n", out.stderr.strip())
        sys.exit(2)
    return int(round(float(out.stdout.strip().splitlines()[-1])))


def main():
    if not PASS:
        print("THIẾU CEO_PASS trong biến môi trường — DỪNG.")
        sys.exit(2)

    # (a) số chuẩn từ DB
    chuan = ton_db(MA)
    print(f"a. Tồn chuẩn {MA} từ DB = {chuan}")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()
        page.goto(URL, wait_until="networkidle")

        # đăng nhập CEO thật
        page.fill("#lg-email", EMAIL)
        page.fill("#lg-pass", PASS)
        page.click("#lg-btn")
        page.wait_for_selector("#login", state="hidden", timeout=15000)

        # vào trang Tồn kho (kích hoạt nạp lại), lọc còn mỗi BL-03
        page.click('nav button[data-m="ton"]')
        page.fill("#tim", MA)
        row = f'#bang tr:has(td.ma:text-is("{MA}"))'
        page.wait_for_selector(row, timeout=10000)

        def mo_the():
            page.click(row)
            page.wait_for_selector("#the.on .the-so", timeout=8000)

        def ton_panel():
            return int(digits(page.locator("#the .the-so > div").first.locator("b").text_content()))

        def con_dau():
            return int(digits(page.locator("#the .the-than .dong-tk").first.locator(".du").text_content()))

        def ton_bang():
            return int(digits(page.locator(row).locator(".mt .v").text_content()))

        # (b) mở thẻ, tồn hiện tại = chuẩn
        mo_the()
        tp = ton_panel()
        print(f"b. Panel 'Tồn hiện tại' = {tp}", "PASS" if tp == chuan else "FAIL")
        if tp != chuan:
            raise AssertionError(f"b: panel {tp} != chuẩn {chuan}")

        # (c) đóng panel, GIẢ LẬP BỘ NHỚ CŨ: ghi đè KHO[BL-03].ton = 999
        page.click("#the .x")
        page.wait_for_selector("#the.on", state="hidden", timeout=5000)
        ok = page.evaluate(
            "ma => { const v = (window.KHO||[]).find(x => x.ma === ma); if (!v) return false; v.ton = 999; return true; }",
            MA,
        )
        if not ok:
            raise AssertionError("c: không ghi đè được window.KHO (không expose?)")
        print("c. Đã ghi đè KHO[BL-03].ton = 999 (giả bộ nhớ cũ)")

        # (d) mở lại thẻ bằng click thật -> phải là chuẩn, KHÔNG phải 999
        mo_the()
        tp2 = ton_panel()
        print(f"d. Panel sau khi mở lại = {tp2}", "PASS" if tp2 == chuan else "FAIL")
        if tp2 == 999:
            raise AssertionError("THẺ KHO VẪN ĐỌC BỘ NHỚ (hiện 999)")
        if tp2 != chuan:
            raise AssertionError(f"d: panel {tp2} != chuẩn {chuan}")

        # (e) dòng đầu cột 'còn' = chuẩn (không tính từ 999)
        cd = con_dau()
        print(f"e. Cột 'còn' dòng đầu = {cd}", "PASS" if cd == chuan else "FAIL")
        if cd != chuan:
            raise AssertionError(f"e: còn {cd} != chuẩn {chuan}")

        # (g) nút Làm mới tồn tại, bấm được
        btn = page.locator("#btn-lammoi")
        if btn.count() == 0 or not btn.is_enabled():
            raise AssertionError("g: KHÔNG có nút Làm mới bấm được")
        print("g. Nút 'Làm mới' tồn tại & bấm được  PASS")

        # (f) ghi đè 999 lần nữa rồi bấm Làm mới -> cột tồn bảng trở về chuẩn
        page.click("#the .x")
        page.evaluate("ma => { (window.KHO||[]).find(x => x.ma === ma).ton = 999 }", MA)
        btn.click()
        page.wait_for_function("() => document.querySelector('#btn-lammoi') && document.querySelector('#btn-lammoi').textContent.trim() === 'Làm mới'", timeout=10000)
        page.wait_for_selector(row, timeout=10000)
        tb = ton_bang()
        print(f"f. Cột tồn bảng sau Làm mới = {tb}", "PASS" if tb == chuan else "FAIL")
        if tb != chuan:
            raise AssertionError(f"f: bảng {tb} != chuẩn {chuan} (Làm mới không nạp lại)")

        b.close()

    print(f"\n✅ TẤT CẢ PASS — thẻ kho & bảng luôn hiện tồn tươi {chuan}, không đọc bộ nhớ 999.")


if __name__ == "__main__":
    main()
