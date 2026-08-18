#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# BỘ BẤM THẬT màn Báo giá (app sale) — kiểm trên TRANG DEPLOY THẬT, đăng nhập thật.
#
# LUẬT (00_LUAT_LAM_VIEC.md): CẤM nghiệm thu giao diện bằng bản tự render/shim —
#   mọi kiểm chứng phải trên trang deploy thật hoặc bundle thật. Bộ này mô phỏng
#   NGƯỜI DÙNG (click + gõ) bằng Playwright, KHÔNG đọc code, KHÔNG shim.
#
# CHẠY:
#   cd web && python3 ops/ui_test_sale.py                 # smoke read-only (mặc định, KHÔNG tạo đơn)
#   cd web && python3 ops/ui_test_sale.py --url <url>     # kiểm 1 deploy cụ thể (mặc định production)
#
# CẦN: web/.env.test (KHÔNG commit — .gitignore chặn) với 2 dòng:
#   TEST_SALE_USER=<email tài khoản sale kiểm>
#   TEST_SALE_PASS=<mật khẩu>
#   (tài khoản kiểm test_sale_kiem — xem so_no.md; tạo qua RPC qly_them_nguoi, giữ lâu dài)
#
# Playwright Python: pip install --user playwright && python3 -m playwright install chromium
# ─────────────────────────────────────────────────────────────────────────────
import re, sys, json
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Thiếu Playwright. Cài: pip install --user playwright && python3 -m playwright install chromium")
    sys.exit(2)

ENVP = Path(__file__).resolve().parent.parent / ".env.test"
if not ENVP.exists():
    print("Thiếu web/.env.test (TEST_SALE_USER / TEST_SALE_PASS). Dừng.")
    sys.exit(2)
ENV = {}
for line in ENVP.read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); ENV[k.strip()] = v.strip()

URL = "https://togihome-sale.pages.dev"
if "--url" in sys.argv:
    URL = sys.argv[sys.argv.index("--url") + 1]

R = {"pass": 0, "fail": 0, "notes": []}
def ok(name, cond, extra=""):
    print(("✅ " if cond else "❌ ") + name + (("  — " + extra) if (extra and not cond) else ""))
    R["pass" if cond else "fail"] += 1

with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    pg = br.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    dialogs = []   # L-45: bắt window.alert (gác nguồn khách) — tự accept để không treo
    pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    def dong_modal():
        for _ in range(3):
            if pg.locator(".ovl").count() == 0:
                return
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            if pg.locator(".ovl").count():
                try: pg.mouse.click(6, 6)
                except Exception: pass
                pg.wait_for_timeout(300)

    def go_bg():
        if pg.locator(".ovl").count(): dong_modal()
        pg.get_by_role("button", name="Báo giá").first.click()
        pg.wait_for_selector("text=Danh sách báo giá", timeout=15000)

    # ── LOGIN ──
    pg.goto(URL, wait_until="networkidle")
    pg.fill("#e", ENV["TEST_SALE_USER"]); pg.fill("#p", ENV["TEST_SALE_PASS"]); pg.click("#b")
    pg.wait_for_selector("text=Sổ đơn hàng", timeout=20000)
    ok("Đăng nhập sale trên deploy thật", True)
    go_bg()
    ok("Vào màn Báo giá (v5 · vỏ .bg-man)", pg.locator(".bg-man").count() > 0)

    # ── FORM BÁO GIÁ: mở được, KHÔNG đòi cọc/địa chỉ (giai đoạn 1) ──
    pg.click("button.bg-nut-them"); pg.wait_for_selector(".ovl", timeout=10000)
    ok('"+ Báo giá mới" mở form BÁO GIÁ (header "Báo giá mới")', pg.locator('.ovl h4:has-text("Báo giá mới")').count() > 0)
    coc = pg.locator('.ovl label:has-text("Tài khoản cọc")').count()
    dc = pg.locator('.ovl label:has-text("Địa chỉ giao")').count()
    ok("Form báo giá KHÔNG đòi cọc/địa chỉ giao", coc == 0 and dc == 0, f"coc={coc} dc={dc}")
    ok('Form báo giá có nút "Lưu báo giá"', pg.locator('.ovl button:has-text("Lưu báo giá")').count() > 0)
    dong_modal()

    # ── FORM LÊN ĐƠN: 1 nút "Lưu đơn", KHÔNG còn "Lưu báo giá" (đã cắt tàn dư) ──
    pg.get_by_role("button", name="Sổ đơn hàng").first.click()
    pg.wait_for_selector("text=Lên đơn", timeout=15000)
    pg.get_by_role("button", name="+ Lên đơn").first.click()
    pg.wait_for_selector(".ovl", timeout=10000)
    ok('"+ Lên đơn" mở form LÊN ĐƠN (header "Lên đơn mới")', pg.locator('.ovl h4:has-text("Lên đơn mới")').count() > 0)
    ok('Form lên đơn CHỈ có "Lưu đơn", KHÔNG "Lưu báo giá"',
       pg.locator('.ovl button:has-text("Lưu báo giá")').count() == 0 and pg.locator('.ovl button:has-text("Lưu đơn")').count() > 0)
    # ── L-45: cue "* bắt buộc" cho nguồn khách trên form (nhắc thị giác của gác chốt) ──
    ok('Form lên đơn: ô nguồn khách có cue "* bắt buộc để chốt"',
       pg.locator('.ovl:has-text("Khách biết mình qua đâu") :text("bắt buộc để chốt")').count() > 0)
    dong_modal()

    # ── NÚT SỐNG trên màn Báo giá: mỗi ô đếm lọc, số khớp danh sách (ô == list) ──
    go_bg()
    lech = 0
    for i in range(pg.locator(".bg-o").count()):
        o = pg.locator(".bg-o").nth(i)
        cnt = int(re.sub(r"\D", "", o.locator("b").first.inner_text()) or "0")
        o.click(); pg.wait_for_timeout(300)
        m = re.search(r"(\d+)", pg.locator(".bg-the-dau p").first.inner_text())
        if not m or int(m.group(1)) != cnt: lech += 1
    ok("Mỗi ô đếm bấm được, số khớp danh sách (ô == list)", lech == 0, f"{lech} ô lệch")

    # ── TOGGLE Danh sách ⇄ Cột ──
    pg.get_by_role("button", name="Cột", exact=True).click(); pg.wait_for_timeout(500)
    ok('Toggle "Cột" → hiện dạng cột', pg.locator(".bg-cot").count() > 0)
    pg.get_by_role("button", name="Danh sách", exact=True).click(); pg.wait_for_timeout(400)
    ok('Toggle "Danh sách" → về danh sách', pg.locator(".bg-the-ct").count() > 0)

    # ── MỞ chi tiết 1 đơn (nếu có) → không vỡ ──
    mo = pg.locator('.bg-dong button:has-text("Mở đơn")')
    if mo.count():
        mo.first.click(); pg.wait_for_selector(".ovl", timeout=8000)
        ok('"Mở đơn" mở chi tiết (modal)', pg.locator(".ovl").count() > 0)
        dong_modal()
    else:
        R["notes"].append("không có đơn 'Mở đơn' để kiểm chi tiết (data trống)")

    # ── L-45: GÁC nguồn khách khi CHỐT — chốt đơn bao_gia KHÔNG có nguồn → BỊ CHẶN đúng thông báo ──
    #   (block CỨNG đã chứng minh ở test_109 #2 tầng DB; đây kiểm tầng UI khi có đơn chốt-được)
    go_bg()
    chot_btn = pg.get_by_role("button", name=re.compile("Chuyển thành đơn|Chốt giá, lên đơn"))
    if chot_btn.count():
        dialogs.clear()
        chot_btn.first.click()
        pg.wait_for_selector(".ovl", timeout=10000)
        sel = pg.locator('.ovl select:has(option:has-text("chưa rõ"))')  # ép nguồn TRỐNG để chắc chắn kích gác
        if sel.count():
            sel.first.select_option("")
        pg.locator('.ovl button:has-text("Chốt, lên đơn")').first.click()
        pg.wait_for_timeout(900)
        blocked = any("nguồn khách" in m.lower() for m in dialogs)
        ok("Chốt đơn KHÔNG có nguồn khách → BỊ CHẶN đúng thông báo (gác client)",
           blocked, "dialogs=" + (" | ".join(dialogs)[:160] or "(không có dialog)"))
        dong_modal()
    else:
        R["notes"].append("không có đơn CHỐT-được cho tài khoản kiểm (data trống) — case chốt-chặn UI SKIP; block CỨNG đã chứng minh ở test_109 #2 (DB)")

    ok("Không có pageerror MỚI ngoài nợ oneOfType có sẵn",
       all("oneOfType" in e for e in errs), " · ".join(e for e in errs if "oneOfType" not in e)[:120])

    br.close()

print(f"\n{'🟢' if R['fail'] == 0 else '🔴'} ui_test_sale: {R['pass']} pass / {R['fail']} fail"
      + (("  · ghi chú: " + "; ".join(R["notes"])) if R["notes"] else ""))
sys.exit(0 if R["fail"] == 0 else 1)
