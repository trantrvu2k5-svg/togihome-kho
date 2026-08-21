#!/usr/bin/env python3
# CEO seed phiên app Kho vào PROFILE ROBOT (một lần). Cửa sổ Chrome mở → CEO đăng nhập vai ceo/kho.
#   Chờ bằng input() (KHÔNG page.pause) — Ctrl+C/Enter đều ngắt được → finally ĐÓNG SẠCH context+browser,
#   không để Chrome orphan giữ khoá profile robot. (page.pause chặn main thread, SIGINT không tới — tránh.)
import pathlib, subprocess
from playwright.sync_api import sync_playwright
PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=False, viewport={"width": 1400, "height": 950})
    try:
        pg = ctx.new_page(); pg.goto("https://togihome-kho.pages.dev/")
        input("→ Đăng nhập app Kho trên cửa sổ Chrome, XONG rồi nhấn ENTER ở đây (hoặc Ctrl+C để huỷ)… ")
        print("✔ đã lưu phiên vào profile robot.")
    except (KeyboardInterrupt, EOFError):
        print("\n⏹ huỷ — đóng sạch.")
    finally:
        try: ctx.close()          # đóng context (graceful)
        except Exception: pass
        # BẢO HIỂM: ctx.close() thường để lại Chrome orphan (persistent context trên macOS) → kill ĐÚNG process
        # của profile robot này (an toàn: đây là profile automation, không phải trình duyệt CEO đang dùng).
        subprocess.run(["pkill", "-TERM", "-f", f"user-data-dir={PROFILE}"], capture_output=True)
