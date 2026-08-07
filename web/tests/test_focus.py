# -*- coding: utf-8 -*-
# Test THẬT bằng bàn phím: chứng minh ô nhập số lượng / đơn giá KHÔNG mất focus khi gõ,
# đơn giá chỉ định dạng dấu chấm khi BLUR, và nút "Lưu nháp" đã bị gỡ hẳn.
#
# Không gọi hàm JS trực tiếp, không truyền tham số tay — chỉ gõ phím thật qua page.keyboard.
# TUYỆT ĐỐI KHÔNG bấm "Ghi sổ" (không đẩy dữ liệu rác lên kho).
#
# Chạy:  cd web && DEV_URL=http://localhost:5180/ CEO_EMAIL=... CEO_PASS=... python3 tests/test_focus.py
# Mặc định URL http://localhost:5180/ . Email/mật khẩu CEO lấy từ biến môi trường.

import os
import re
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")

digits = lambda s: re.sub(r"\D", "", s or "")
loi = []


def bao(ten, dieu_kien, chi_tiet=""):
    trang_thai = "PASS" if dieu_kien else "FAIL"
    print(f"  [{trang_thai}] {ten}{(' — ' + chi_tiet) if chi_tiet else ''}")
    if not dieu_kien:
        loi.append(ten)


def go_tung_phim(page, o_handle, chuoi, ten_o):
    """Focus 1 lần rồi gõ từng phím qua keyboard. Sau MỖI phím: activeElement phải VẪN là ô đó."""
    o_handle.click()
    page.keyboard.press("Meta+A")
    page.keyboard.press("Delete")
    giu_focus = True
    for ch in chuoi:
        page.keyboard.press(ch)
        con_focus = page.evaluate("el => document.activeElement === el", o_handle)
        if not con_focus:
            giu_focus = False
    bao(f"{ten_o}: focus giữ nguyên sau từng phím ({len(chuoi)} phím)", giu_focus)
    return o_handle.evaluate("el => el.value")


def main():
    if not PASS:
        print("THIẾU CEO_PASS (mật khẩu CEO) trong biến môi trường — DỪNG.")
        sys.exit(2)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(URL, wait_until="networkidle")

        # ── Đăng nhập CEO (đăng nhập THẬT, có phiên JWT) ──
        page.fill("#lg-email", EMAIL)
        page.fill("#lg-pass", PASS)
        page.click("#lg-btn")
        try:
            # Đăng nhập xong: overlay #login bị gỡ .on -> display:none. Chờ nó ẨN (không phải "visible").
            page.wait_for_selector("#login", state="hidden", timeout=15000)
        except Exception:
            err = page.eval_on_selector("#lg-err", "e => e.textContent") if page.query_selector("#lg-err") else ""
            print(f"  [FAIL] Đăng nhập CEO — không vào được app. Lỗi form: {err!r}")
            browser.close()
            sys.exit(1)

        # ── Vào màn Phiếu nhập kho ──
        page.click('nav button[data-m="nhap"]')
        page.wait_for_selector("#ph-nhap table tbody tr", timeout=8000)

        row = page.locator("#ph-nhap table tbody tr").first
        o_sl = row.locator('input[type="number"]').element_handle()
        o_gia = row.locator('input:not([type="number"])').element_handle()

        # ── (a)+(b) ĐƠN GIÁ: gõ 5 phím "10000", focus giữ, trong lúc gõ CHƯA định dạng ──
        val_gia = go_tung_phim(page, o_gia, "10000", "Đơn giá")
        bao("Đơn giá: sau 5 phím đọc ra đúng số 10000", digits(val_gia) == "10000", f"value={val_gia!r}")
        bao("Đơn giá: trong lúc gõ CHƯA có dấu phân cách", "." not in val_gia, f"value={val_gia!r}")

        # ── (c) SỐ LƯỢNG: gõ "12", focus giữ (thao tác này cũng làm ô đơn giá blur) ──
        val_sl = go_tung_phim(page, o_sl, "12", "Số lượng")
        bao("Số lượng: sau khi gõ đọc ra đúng 12", digits(val_sl) == "12", f"value={val_sl!r}")

        # ── (d) ĐƠN GIÁ sau BLUR: đã có dấu chấm phân cách ──
        val_gia_blur = o_gia.evaluate("el => el.value")
        bao("Đơn giá: sau khi mất focus HIỆN dấu phân cách", "." in val_gia_blur, f"value={val_gia_blur!r}")

        # ── (e) THÀNH TIỀN + TỔNG TIỀN = 12 × 10000 = 120000 ──
        tt_dong = page.locator("#ct-nhap-0").text_content()
        tt_tong = page.locator("#tt-nhap").text_content()
        bao("Thành tiền dòng = 120.000", digits(tt_dong) == "120000", f"='{tt_dong}'")
        bao("Tổng tiền phiếu = 120.000", digits(tt_tong) == "120000", f"='{tt_tong}'")

        # ── (f) Không còn nút / chữ "Lưu nháp"; có dòng nhắc nháp ──
        noi_dung = page.content()
        bao("Đã gỡ hẳn 'Lưu nháp' khỏi trang", "Lưu nháp" not in noi_dung)
        bao("Có dòng nhắc phiếu chưa ghi sổ", "Phiếu chưa ghi sổ sẽ mất nếu tải lại trang" in noi_dung)

        browser.close()

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}")
        sys.exit(1)
    print("✅ TẤT CẢ PASS — không mất focus, đơn giá blur mới định dạng, 'Lưu nháp' đã gỡ.")


if __name__ == "__main__":
    main()
