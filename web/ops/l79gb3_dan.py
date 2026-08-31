#!/usr/bin/env python3
# L-79g-B3 muc D — may TU DAN ban min vao GTM. Chrome KHONG headless, giu phien user_data_dir rieng.
#   Luat 00: KHONG tu nhap mat khau, KHONG doc/luu mat khau. CEO dang nhap Google BANG TAY.
#   Luong: mo browser -> ghi status OPENED -> CHO file 'loggedin' (CEO go 'da dang nhap' -> Claude touch file)
#     -> tu mo the WP-79 ref nut chat -> dan de ma -> Luu -> Gui -> doc loi. CON loi: DUNG, khong Xuat ban.
#     HET loi: Xuat ban, ghi gio. Google chan buoc nao -> ghi status BLOCKED buoc do, tra CEO lam tay.
import time, pathlib, json
from playwright.sync_api import sync_playwright

DIR = pathlib.Path.home() / "Downloads" / "l79_chrome"; DIR.mkdir(parents=True, exist_ok=True)
SHOT = pathlib.Path.home() / "Downloads" / "l79f"; SHOT.mkdir(parents=True, exist_ok=True)
CODE = (pathlib.Path.home() / "Downloads" / "wp79_gtm_dan.txt").read_text()  # <script>..</script>
CODE_INNER = (pathlib.Path(__file__).resolve().parent / "gtm_ref_chat.min.js").read_text().strip()
STATUS = DIR / "status.txt"; SIG = DIR / "loggedin"; OUT = DIR / "ketqua.json"
def st(s): STATUS.write_text(s); print("STATUS:", s, flush=True)
def out(d): OUT.write_text(json.dumps(d, ensure_ascii=False, indent=2)); print("KETQUA:", json.dumps(d, ensure_ascii=False), flush=True)

if SIG.exists(): SIG.unlink()
res = {"buoc": [], "loi": None, "gio_xuat_ban": None, "blocked": None}

with sync_playwright() as p:
    try:
        ctx = p.chromium.launch_persistent_context(str(DIR), headless=False, channel="chrome",
                                                    viewport={"width": 1400, "height": 900}, args=["--no-first-run"])
    except Exception:
        ctx = p.chromium.launch_persistent_context(str(DIR), headless=False,
                                                    viewport={"width": 1400, "height": 900})
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto("https://tagmanager.google.com/", wait_until="domcontentloaded", timeout=60000)
    st("OPENED — cho CEO dang nhap Google roi go 'da dang nhap'")

    # cho tin hieu loggedin (toi da ~40 phut)
    for _ in range(800):
        if SIG.exists(): break
        time.sleep(3)
    if not SIG.exists():
        st("HET GIO cho dang nhap"); res["blocked"] = "het-gio-dang-nhap"; out(res)
    else:
        st("CO tin hieu dang nhap — bat dau tu dong")
        try:
            # B1: vao container. Thu bam vao ten container/GTM-MK3D4V68 neu thay
            time.sleep(2); pg.screenshot(path=str(SHOT / "GB3_1_sau_login.png"))
            try:
                pg.get_by_text("GTM-MK3D4V68").first.click(timeout=8000); res["buoc"].append("vao-container")
            except Exception:
                res["buoc"].append("khong-thay-container-text(co the da o trong)")
            time.sleep(3)
            # B2: mo the WP-79 ref nut chat
            try:
                tg = pg.get_by_text("Thẻ").first
                if tg.count(): tg.click(timeout=5000); time.sleep(2)
            except Exception: pass
            try:
                pg.get_by_text("WP-79 ref nut chat").first.click(timeout=8000); res["buoc"].append("mo-the")
            except Exception as e:
                res["blocked"] = "khong-mo-duoc-the WP-79 ref nut chat"; res["err"] = str(e)[:120]
                pg.screenshot(path=str(SHOT / "GB3_2_khong-thay-the.png")); out(res); raise SystemExit
            time.sleep(3); pg.screenshot(path=str(SHOT / "GB3_3_the-mo.png"))
            # B3: dan de vao o ma (CodeMirror). Click vung ma, chon het, xoa, chen.
            try:
                cm = pg.locator(".CodeMirror, textarea").first
                cm.click(timeout=5000); time.sleep(1)
                pg.keyboard.press("Meta+A"); time.sleep(0.3); pg.keyboard.press("Delete"); time.sleep(0.3)
                pg.keyboard.insert_text(CODE)   # ban .txt co <script>..</script>
                res["buoc"].append("dan-ma")
            except Exception as e:
                res["blocked"] = "khong-dan-duoc-ma"; res["err"] = str(e)[:120]
                pg.screenshot(path=str(SHOT / "GB3_4_khong-dan.png")); out(res); raise SystemExit
            time.sleep(1); pg.screenshot(path=str(SHOT / "GB3_5_da-dan.png"))
            # B4: Luu
            try:
                pg.get_by_role("button", name="Lưu").first.click(timeout=6000); res["buoc"].append("luu"); time.sleep(3)
            except Exception:
                try: pg.get_by_text("Lưu").first.click(timeout=4000); res["buoc"].append("luu(text)"); time.sleep(3)
                except Exception as e: res["blocked"]="khong-bam-duoc-Luu"; res["err"]=str(e)[:120]; out(res); raise SystemExit
            # B5: Gui
            pg.screenshot(path=str(SHOT / "GB3_6_da-luu.png"))
            try:
                pg.get_by_text("Gửi").first.click(timeout=8000); res["buoc"].append("gui"); time.sleep(4)
            except Exception as e:
                res["blocked"]="khong-bam-duoc-Gui"; res["err"]=str(e)[:120]; out(res); raise SystemExit
            time.sleep(2); pg.screenshot(path=str(SHOT / "GB3_7_sau-gui.png"))
            # B6: doc loi "Xac thuc vung chua" / parse error
            body = pg.inner_text("body")
            loi = None
            for kw in ["Parse error", "Lỗi phân tích", "Xác thực vùng chứa", "Container validation", "không hợp lệ"]:
                if kw.lower() in body.lower(): loi = kw; break
            if loi:
                res["loi"] = loi; st("CON LOI: "+loi+" — KHONG xuat ban")
                pg.screenshot(path=str(SHOT / "GB3_8_CON-LOI.png")); out(res)
            else:
                res["buoc"].append("khong-thay-loi")
                # Xuat ban
                try:
                    pg.get_by_text("Xuất bản").first.click(timeout=8000); time.sleep(4)
                    res["gio_xuat_ban"] = time.strftime("%H:%M:%S %d/%m/%Y")
                    res["buoc"].append("XUAT-BAN"); st("XUAT BAN OK luc "+res["gio_xuat_ban"])
                    pg.screenshot(path=str(SHOT / "GB3_9_XUAT-BAN.png"))
                except Exception as e:
                    res["blocked"]="da-Gui-nhung-khong-bam-duoc-Xuat-ban"; res["err"]=str(e)[:120]
                    pg.screenshot(path=str(SHOT / "GB3_9_khong-xuatban.png"))
                out(res)
        except SystemExit:
            pass
        except Exception as e:
            res["blocked"] = "loi-tu-dong-hoa"; res["err"] = str(e)[:200]; out(res)
    # GIU browser mo them cho CEO tiep quan neu can (khong close)
    print("XONG PHAN TU DONG — giu cua so Chrome 20 phut cho CEO.", flush=True)
    time.sleep(1200)
    ctx.close()
