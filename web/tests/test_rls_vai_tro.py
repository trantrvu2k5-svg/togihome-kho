# -*- coding: utf-8 -*-
# Sau khi siết 11 policy đọc sang vai trò: chứng minh qua trình duyệt THẬT rằng
#   - ceo vẫn thấy đủ (199 mã, 4 ô số, thẻ BL-03 tồn 10),
#   - thợ vào được màn của thợ và KHÔNG thấy giá vốn / giá tham khảo,
#   - đăng xuất rồi đăng nhập lại ceo vẫn vào bình thường (KHÔNG tự khoá vòng).
#
# Gõ phím thật. KHÔNG gọi hàm JS của app (chỉ đọc DOM/điều hướng qua UI). KHÔNG tạo phiếu, KHÔNG Ghi sổ.
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... THU_MA=thu-xxxx python3 tests/test_rls_vai_tro.py

import os
import re
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
THU_MA = os.environ.get("THU_MA", "")
digits = lambda s: re.sub(r"\D", "", s or "")
loi = []


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def main():
    if not PASS or not THU_MA:
        print("THIẾU CEO_PASS hoặc THU_MA — DỪNG.")
        sys.exit(2)

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()

        def login_ceo():
            page.goto(URL, wait_until="networkidle")
            page.click("#tab-email")
            page.fill("#lg-email", EMAIL)
            page.fill("#lg-pass", PASS)
            page.click("#lg-btn")
            page.wait_for_selector("#login", state="hidden", timeout=15000)

        # ── (a) ceo: 199 mã + 4 ô số ──
        login_ceo()
        page.wait_for_selector('#bang tr:has(td.ma)', timeout=10000)
        kma = digits(page.locator("#k-ma").inner_text())
        boxes = {b_: page.locator(f"#{b_}").inner_text() for b_ in ["k-ma", "k-duoi", "k-thieu", "k-tien"]}
        bao("a. ceo Tồn kho = 199 mã", kma == "199", f"#k-ma={kma}")
        so_o = all(digits(v) != "" for v in boxes.values())
        bao("a. 4 ô lớn đều ra số", so_o, str(boxes))
        if kma != "199" or not so_o:
            raise AssertionError("a: ceo không thấy đủ Tồn kho")

        # ── (b) thẻ BL-03 tồn 10 ──
        page.fill("#tim", "BL-03")
        row = '#bang tr:has(td.ma:text-is("BL-03"))'
        page.wait_for_selector(row, timeout=8000)
        page.click(row)
        page.wait_for_selector("#the.on .the-so", timeout=8000)
        ton = digits(page.locator("#the .the-so > div").first.locator("b").text_content())
        bao("b. thẻ BL-03 Tồn hiện tại = 10", ton == "10", f"={ton}")
        if ton != "10":
            raise AssertionError("b: BL-03 tồn không phải 10")

        # ── (c) đăng xuất, đăng nhập thợ thu ──
        page.keyboard.press("Escape")                       # đóng panel thẻ (đang che nút Đăng xuất)
        page.wait_for_selector("#the.on", state="hidden", timeout=5000)
        page.click("#btn-out")
        page.wait_for_selector("#login.on", timeout=10000)
        page.click("#tab-pin")
        page.fill("#lg-pin", THU_MA)
        page.click("#lg-btn")
        try:
            page.wait_for_selector("#login", state="hidden", timeout=15000)
        except PWTimeout:
            bao("c. thợ đăng nhập được", False, "không vào được")
            raise AssertionError("c: thợ không đăng nhập được")
        ai = page.locator("#ai").inner_text()
        quet_hien = page.locator('nav button[data-m="quet"]').is_visible()
        ton_an = not page.locator('nav button[data-m="ton"]').is_visible()
        bao("c. thợ vào + thấy màn thợ (Quét mã)", ("THO" in ai) and quet_hien and ton_an, f"#ai='{ai}'")
        if "THO" not in ai:
            raise AssertionError("c: không phải phiên thợ")

        # ── (d) thợ KHÔNG thấy giá vốn / giá tham khảo ──
        # các ô tiền trên trang Tồn (ẩn với thợ) phải là '·', KHÔNG phải số; nav tới các trang giá bị ẩn.
        ktien = page.locator("#k-tien").inner_text().strip()
        kthieu = page.locator("#k-thieu").inner_text().strip()
        nav_an = all(not page.locator(f'nav button[data-m="{m}"]').is_visible() for m in ["ton", "dat", "nhap", "xuat", "ncc"])
        khong_gia = (ktien == "·") and (kthieu == "·")
        bao("d. thợ không thấy giá (ô tiền = '·', trang giá bị ẩn)", khong_gia and nav_an, f"k-tien='{ktien}' k-thieu='{kthieu}'")
        if not (khong_gia and nav_an):
            raise AssertionError("d: thợ thấy giá vốn / giá tham khảo")

        # ── (e) đăng xuất, đăng nhập lại ceo -> vẫn vào (không tự khoá) ──
        page.click("#btn-out")
        page.wait_for_selector("#login.on", timeout=10000)
        try:
            login_ceo()
        except PWTimeout:
            bao("e. đăng nhập lại ceo", False, "bị khoá")
            raise AssertionError("e: ceo bị tự khoá vòng")
        page.wait_for_selector('#bang tr:has(td.ma)', timeout=10000)
        kma2 = digits(page.locator("#k-ma").inner_text())
        bao("e. ceo đăng nhập lại bình thường (199 mã)", kma2 == "199", f"#k-ma={kma2}")
        if kma2 != "199":
            raise AssertionError("e: ceo đăng nhập lại không thấy đủ")

        b.close()

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}")
        sys.exit(1)
    print("✅ TẤT CẢ PASS — ceo đủ, thợ không thấy giá, không tự khoá vòng.")


if __name__ == "__main__":
    main()
