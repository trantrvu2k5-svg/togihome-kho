# -*- coding: utf-8 -*-
# Chứng minh đăng nhập thợ dùng MÃ CÁ NHÂN <tên>-<4 ký tự>, tên đăng nhập TÁCH khỏi mật khẩu.
#
# Gõ phím thật qua trình duyệt. KHÔNG gọi hàm JS. KHÔNG in mã đầy đủ ra log (đọc từ env THU_MA).
# KHÔNG tạo phiếu, KHÔNG bấm Ghi sổ.
#
# Chạy: cd web && DEV_URL=http://localhost:5180/ THU_MA=thu-xxxx python3 tests/test_dang_nhap_tho.py

import os
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
THU_MA = os.environ.get("THU_MA", "")           # mã đầy đủ của tài khoản "thu" — KHÔNG in ra
HO_TEN = "Thợ Thử Nghiệm"
loi = []


def bao(ten, ok, chi_tiet=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {ten}{(' — ' + chi_tiet) if chi_tiet else ''}")
    if not ok:
        loi.append(ten)


def main():
    if not THU_MA or "-" not in THU_MA:
        print("THIẾU THU_MA (mã cá nhân đầy đủ của 'thu') trong biến môi trường — DỪNG.")
        sys.exit(2)
    suffix = THU_MA.split("-", 1)[1]
    wrong = "zzzz" if suffix != "zzzz" else "zzzy"    # 4 ký tự sai, khác đuôi thật

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()

        def toi_dang_nhap_tho():
            page.goto(URL, wait_until="networkidle")
            page.click("#tab-pin")
            page.wait_for_selector("#lg-pin", state="visible", timeout=8000)

        def dang_nhap(code):
            page.fill("#lg-pin", code)
            page.click("#lg-btn")

        def phai_that_bai(code, ten_muc, raise_msg):
            dang_nhap(code)
            try:
                page.wait_for_selector("#login", state="hidden", timeout=4000)
                # ẩn = đã vào app = SAI
                bao(ten_muc, False, "vào được (đáng lẽ thất bại)")
                raise AssertionError(raise_msg)
            except PWTimeout:
                bao(ten_muc, True, "bị chặn ở màn đăng nhập")

        # ── màn đăng nhập thợ (chưa có phiên) ──
        toi_dang_nhap_tho()

        # (g) ô mã phải là type password
        t = page.locator("#lg-pin").get_attribute("type")
        bao("g. ô mã type=password", t == "password", f"type={t!r}")
        if t != "password":
            raise AssertionError("g: ô mã KHÔNG phải type password")

        # (h) không còn chữ "PIN" hiển thị cho thợ
        txt = page.locator("#login").inner_text()
        bao("h. không còn chữ 'PIN' cho thợ", "PIN" not in txt)
        if "PIN" in txt:
            raise AssertionError("h: vẫn còn chữ PIN")

        # (b) 1234 (kiểu PIN cũ) -> thất bại
        phai_that_bai("1234", "b. mã PIN cũ 1234", "PIN CŨ VẪN DÙNG ĐƯỢC")
        # (c) chỉ phần tên "thu" -> thất bại
        phai_that_bai("thu", "c. chỉ phần tên 'thu'", "TÊN KHÔNG KÈM MÃ VẪN VÀO ĐƯỢC")
        # (d) thu- + 4 ký tự sai -> thất bại
        phai_that_bai(f"thu-{wrong}", "d. thu-<4 ký tự sai>", "MÃ SAI VẪN VÀO ĐƯỢC")
        # (e) QUAN TRỌNG: "thu-thu" (lấy tên làm mật khẩu) -> thất bại
        phai_that_bai("thu-thu", "e. thu-thu (tên làm mật khẩu)", "MẬT KHẨU VẪN BẰNG TÊN ĐĂNG NHẬP")
        # (f) tài khoản Thợ Thử (tho1234) đã ngừng: 1234 -> thất bại
        phai_that_bai("1234", "f. tài khoản đã ngừng + 1234", "TÀI KHOẢN NGỪNG VẪN VÀO ĐƯỢC")

        # (a) mã cá nhân ĐÚNG -> vào được, hiện đúng họ tên (làm CUỐI vì tạo phiên)
        dang_nhap(THU_MA)
        try:
            page.wait_for_selector("#login", state="hidden", timeout=15000)
        except PWTimeout:
            bao("a. mã đúng đăng nhập được", False, "không vào được")
            raise AssertionError("a: mã cá nhân đúng KHÔNG đăng nhập được")
        ai = page.locator("#ai").inner_text()
        bao("a. mã đúng + hiện họ tên", HO_TEN in ai, f"#ai='{ai}'")
        if HO_TEN not in ai:
            raise AssertionError(f"a: header không hiện '{HO_TEN}'")

        b.close()

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}")
        sys.exit(1)
    print("✅ TẤT CẢ PASS — đăng nhập thợ bằng mã cá nhân, tên tách khỏi mật khẩu, PIN cũ chết.")


if __name__ == "__main__":
    main()
