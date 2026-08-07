# -*- coding: utf-8 -*-
# Sau khi BỎ đường vào của thợ: app chỉ còn CEO / Thủ kho đăng nhập bằng EMAIL.
#   c. Màn đăng nhập KHÔNG còn ô mã cá nhân / tab thợ / chữ thợ-PIN.
#   d. ceo vào được, Tồn kho đủ 199 mã, 4 ô lớn ra số.
#   e. Thẻ kho BL-03 vẫn ra tồn 10.
#   f. Đăng xuất rồi đăng nhập lại ceo vẫn vào (không tự khoá vòng).
# Gõ phím thật qua trình duyệt. KHÔNG gọi hàm JS của app. KHÔNG tạo phiếu, KHÔNG Ghi sổ.
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... python3 tests/test_rls_vai_tro.py

import os
import re
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
digits = lambda s: re.sub(r"\D", "", s or "")
loi = []


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG.")
        sys.exit(2)

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()

        def login_ceo():
            page.goto(URL, wait_until="networkidle")
            page.fill("#lg-email", EMAIL)
            page.fill("#lg-pass", PASS)
            page.click("#lg-btn")
            page.wait_for_selector("#login", state="hidden", timeout=15000)
            # chờ Tồn kho vẽ xong (k-ma = 199) mới đọc — tránh bắt giá trị mặc định sớm
            page.wait_for_function(
                "() => { const e = document.querySelector('#k-ma'); return e && e.textContent.replace(/\\D/g,'') === '199' }",
                timeout=12000,
            )

        # ── (c) màn đăng nhập KHÔNG còn đường vào của thợ ──
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector("#login.on", timeout=8000)
        no_pin = page.locator("#lg-pin").count() == 0
        no_tab = page.locator("#tab-pin").count() == 0
        txt = page.locator("#login").inner_text()
        no_text = not any(k in txt for k in ["Mã cá nhân", "PIN", "Thợ", "thợ", "mã cá nhân"])
        bao("c. đăng nhập không còn ô mã cá nhân / tab thợ", no_pin and no_tab and no_text,
            f"lg-pin={not no_pin} tab-pin={not no_tab}")
        if not (no_pin and no_tab and no_text):
            raise AssertionError("c: vẫn còn đường vào kiểu thợ trên màn đăng nhập")

        # ── (d) ceo vào + 199 mã + 4 ô số ──
        login_ceo()
        kma = digits(page.locator("#k-ma").inner_text())
        boxes = {x: page.locator(f"#{x}").inner_text() for x in ["k-ma", "k-duoi", "k-thieu", "k-tien"]}
        so_o = all(digits(v) != "" for v in boxes.values())
        bao("d. ceo Tồn kho 199 mã + 4 ô ra số", kma == "199" and so_o, str(boxes))
        if not (kma == "199" and so_o):
            raise AssertionError("d: ceo không thấy đủ Tồn kho")

        # ── (e) thẻ BL-03 tồn 10 ──
        page.fill("#tim", "BL-03")
        row = '#bang tr:has(td.ma:text-is("BL-03"))'
        page.wait_for_selector(row, timeout=8000)
        page.click(row)
        page.wait_for_selector("#the.on .the-so", timeout=8000)
        ton = digits(page.locator("#the .the-so > div").first.locator("b").text_content())
        bao("e. thẻ BL-03 Tồn hiện tại = 10", ton == "10", f"={ton}")
        if ton != "10":
            raise AssertionError("e: BL-03 tồn không phải 10")

        # ── (f) đăng xuất → đăng nhập lại ceo (không tự khoá) ──
        page.keyboard.press("Escape")
        page.wait_for_selector("#the.on", state="hidden", timeout=5000)
        page.click("#btn-out")
        page.wait_for_selector("#login.on", timeout=10000)
        try:
            login_ceo()
        except PWTimeout:
            bao("f. đăng nhập lại ceo", False, "bị khoá")
            raise AssertionError("f: ceo bị tự khoá vòng")
        bao("f. ceo đăng nhập lại bình thường (199 mã)", digits(page.locator("#k-ma").inner_text()) == "199")

        b.close()

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}")
        sys.exit(1)
    print("✅ TẤT CẢ PASS — không còn đường vào thợ; ceo đủ; không tự khoá vòng.")


if __name__ == "__main__":
    main()
