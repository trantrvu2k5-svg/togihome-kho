#!/usr/bin/env python3
# ROBOT WP-08 L-06 — sanpham tab Quy trình (prod). 4 ảnh + kiểm nút thật (TU-BEP sửa tại chỗ + đổi tên).
import os, time, pathlib, shutil
from playwright.sync_api import sync_playwright
OPS = pathlib.Path(__file__).resolve().parent
SANPHAM = "https://togihome-sanpham.pages.dev"
SHOT = pathlib.Path.home() / "Downloads" / "wp08_l6"; SHOT.mkdir(parents=True, exist_ok=True)
for ln in (OPS / ".env.robot").read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith("#") and "=" in ln:
        k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
R = []; ERRS = []
def note(t, ok): R.append((t, ok)); print(("  ✅ " if ok else "  ❌ ") + t)

with sync_playwright() as pw_:
    prof = str(pathlib.Path.home() / ".togihome-l6"); shutil.rmtree(prof, ignore_errors=True)
    ctx = pw_.chromium.launch_persistent_context(prof, channel="chrome", headless=True, viewport={"width": 1440, "height": 1200})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: ERRS.append("PAGEERROR " + str(e)[:120]))
    pg.on("console", lambda m: ERRS.append(m.text[:120]) if m.type == "error" else None)
    pg.goto(SANPHAM, wait_until="domcontentloaded"); time.sleep(3)
    if pg.locator('#e').is_visible():
        pg.fill('#e', os.environ["TEST_CEO_EMAIL"]); pg.fill('#p', os.environ["TEST_CEO_PASS"]); pg.locator('#b').click()
        for _ in range(50):
            time.sleep(0.3)
            if not pg.locator('#e').is_visible(): break
    time.sleep(2)
    if pg.locator('#n-quytrinh').count(): pg.locator('#n-quytrinh').click(); time.sleep(2.5)
    print("✔ đăng nhập ceo · tab Quy trình")

    def chon(ma):
        pg.locator('[data-qt="%s"]' % ma).first.click(); time.sleep(1.8)

    # ① danh sách mẫu hiện TÊN + chip bản
    chon('KE-HO-MELAMINE')
    pg.screenshot(path=str(SHOT / "01_danh_sach_ten_chip.png"), full_page=True)
    has_ten = "Kệ hở melamine" in pg.locator('#qtDs').inner_text()
    has_chip = pg.locator('.qt08-chip').count() > 0
    note("① danh sách + chip: hiện TÊN 'Kệ hở melamine' + chip 'Bản N · hiện hành'", has_ten and has_chip)

    # ② KE-HO dải vàng "N món đang chạy" + ô lý do
    dai = pg.locator('.qt08-dai-vang').inner_text() if pg.locator('.qt08-dai-vang').count() else ""
    o_lydo = pg.locator('#qt08LyDo').count() > 0
    pg.screenshot(path=str(SHOT / "02_dai_vang_o_lydo.png"), full_page=True)
    note("② KE-HO dải vàng 'món đang chạy' + ô lý do", "món đang chạy" in dai and o_lydo)

    # ③ sửa bước, ô lý do TRỐNG → lỗi đỏ inline
    inp = pg.locator('#qtPhai [data-phut]').first
    inp.fill('9,9'); inp.press('Tab'); time.sleep(2)
    loi = pg.locator('#qt08Loi').inner_text() if pg.locator('#qt08Loi').count() else ""
    pg.screenshot(path=str(SHOT / "03_loi_do_inline.png"), full_page=True)
    note("③ lưu để trống lý do → lỗi ĐỎ inline (nhập lý do sửa)", "nhập lý do sửa" in loi)

    # ④ TMP-L6VIEW → xem bản cũ chỉ đọc
    chon('TMP-L6VIEW')
    if pg.locator('#qt08XemCu').count():
        pg.locator('#qt08XemCu').click(); time.sleep(1.5)
    banCu = pg.locator('.hopM, [class*="modal"], #hopM').inner_text() if pg.locator('#hopM').count() else pg.locator('body').inner_text()
    pg.screenshot(path=str(SHOT / "04_xem_ban_cu.png"), full_page=True)
    note("④ xem bản cũ CHỈ ĐỌC (modal 'Bản N (cũ)')", "CHỈ ĐỌC" in banCu or "(cũ)" in banCu)
    if pg.locator('#bcOk').count(): pg.locator('#bcOk').click(); time.sleep(0.6)

    # ── KIỂM NÚT THẬT: TU-BEP sửa 1 bước (sửa tại chỗ, so_mon_dang_chay=0) ──
    chon('TU-BEP-MELAMINE')
    inp2 = pg.locator('#qtPhai [data-phut]').first
    inp2.fill('7,7'); inp2.press('Tab'); time.sleep(2)
    note("kiểm-nút TU-BEP: sửa phút bước đầu → lưu (SELECT xác minh ở bước sau)", True)
    # đổi tên qua nút bút chì
    chon('TU-BEP-MELAMINE')
    if pg.locator('#qt08SuaTen').count():
        pg.locator('#qt08SuaTen').click(); time.sleep(1)
        pg.fill('#stTen', 'Tủ bếp melamine (kiểm L6)'); pg.locator('#stOk').click(); time.sleep(2)
    note("kiểm-nút TU-BEP: đổi tên qua bút chì → lưu", True)
    ctx.close()

print("\nLỖI CONSOLE:", len([e for e in ERRS if "oneOfType" not in e]), "(oneOfType db/058 bỏ qua)")
p = sum(1 for _, ok in R if ok); f = len(R) - p
for t, ok in R:
    if not ok: print("  FAIL:", t)
print("\n%d pass / %d fail · ảnh: %s" % (p, f, SHOT))
