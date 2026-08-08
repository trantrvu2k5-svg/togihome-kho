# -*- coding: utf-8 -*-
# Sinh bộ hướng dẫn có ảnh, TỰ ĐỘNG. Ảnh xếp DỌC (điện thoại trên, máy tính dưới, đủ to).
# Mỗi bước: KHUNG ĐỎ chỉ vào phần tử đang nói (hoặc VÒNG TRÒN SỐ 1·2·3 cho bước nhiều thao tác).
# Toạ độ khung/số LẤY TỪ TRÌNH DUYỆT lúc chụp (element.bounding_box) -> giao diện đổi thì khung tự dịch.
# CHỈ ĐỌC app. KHÔNG tạo phiếu / Ghi sổ / tải ảnh / sửa dữ liệu (điền phiếu chỉ là nháp trình duyệt).
# Bất kỳ bước nào hỏng -> DỪNG, KHÔNG sinh trang thiếu. Chạy lại: ghi đè đúng 30 ảnh, không nhân file.
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... python3 ops/sinh_huong_dan.py
import json
import os
import subprocess
import sys
from datetime import datetime
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HD = os.path.join(WEB, "public", "hd")
VH = {390: 1400, 1280: 1000}   # chiều cao viewport khi chụp (đủ chứa nội dung + phần tử được chỉ)

STEPS = [
    (1, "Màn hình đăng nhập", "Mở phần mềm lên, màn hình đầu tiên hỏi email và mật khẩu.", "Đăng nhập"),
    (2, "Trang Tồn kho", "Gõ đúng email, mật khẩu rồi bấm Đăng nhập. Vào là thấy trang Tồn kho — bốn ô số tóm tắt và danh sách hàng.", "Đăng nhập"),
    (3, "Tìm một món hàng", "Muốn tìm nhanh, gõ mã hoặc tên vào ô tìm kiếm. Danh sách tự rút gọn còn món khớp.", "Tra cứu"),
    (4, "Mở bộ lọc nhóm", "Bấm nút Lọc để hiện các nhóm hàng (bản lề, ray, ván…).", "Tra cứu"),
    (5, "Lọc theo nhóm", "Bấm vào một nhóm, danh sách chỉ còn hàng thuộc nhóm đó.", "Tra cứu"),
    (6, "Xem chi tiết một món", "Bấm vào một dòng hàng để xem: còn bao nhiêu trong kho và lịch sử nhập xuất của riêng món đó.", "Tra cứu"),
    (7, "Mở phiếu nhập kho", "Khi có hàng về thì vào mục Phiếu nhập kho. Mỗi lần hàng về là một phiếu.", "Nhập kho"),
    (8, "Chọn nhà cung cấp, thêm dòng", "Làm theo thứ tự: chọn nơi giao hàng, rồi bấm Thêm dòng cho mỗi món nhận về.", "Nhập kho"),
    (9, "Điền số lượng và giá", "Gõ số lượng nhận và giá mua mỗi món. Phần mềm tự tính thành tiền.", "Nhập kho"),
    (10, "Bấm Ghi sổ để lưu", "Kiểm lại cho đúng rồi bấm Ghi sổ. Ghi sổ xong là tồn kho cập nhật ngay.", "Nhập kho"),
    (11, "Phiếu xuất kho", "Khi lấy hàng ra dùng thì làm Phiếu xuất kho, cũng điền từng dòng rồi Ghi sổ.", "Xuất kho"),
    (12, "Thêm ảnh cho món hàng", "Món nào chưa có ảnh, mở chi tiết rồi bấm Thêm ảnh, chụp bằng điện thoại là xong.", "Ảnh"),
    (13, "Trang Cần đặt hàng", "Mục Cần đặt hàng gợi ý những món sắp hết, dưới mức tối thiểu.", "Trang khác"),
    (14, "Trang Nhà cung cấp", "Mục Nhà cung cấp để lưu tên và số điện thoại nơi mình hay mua hàng.", "Trang khác"),
    (15, "Mở menu trên điện thoại", "Trên điện thoại, bấm nút ba gạch ở góc trái để mở danh sách các mục.", "Trang khác"),
]
NHOM = ["Đăng nhập", "Tra cứu", "Nhập kho", "Xuất kho", "Ảnh", "Trang khác"]
# mô tả từng số cho bước có đánh số (hiện dưới ảnh)
DANH_SO = {
    8: ["Chọn nhà cung cấp", "Bấm + Thêm dòng"],
    9: ["Gõ số lượng nhận", "Gõ đơn giá mua", "Thành tiền tự hiện"],
    11: ["Gõ số lượng lấy ra", "Bấm Ghi sổ khi đã chắc"],
    12: ["Bấm Thêm ảnh rồi chụp/chọn ảnh"],
}


def login(pg):
    pg.goto(URL, wait_until="networkidle")
    pg.fill("#lg-email", EMAIL); pg.fill("#lg-pass", PASS); pg.click("#lg-btn")
    pg.wait_for_selector("#login", state="hidden", timeout=15000)
    pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='199'}", timeout=12000)


def di(pg, m, mob):
    if mob:
        pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000)
        pg.click(f'nav button[data-m="{m}"]'); pg.wait_for_selector(f"#m-{m}.on", timeout=8000)
        pg.wait_for_selector("nav:not(.mo)", timeout=4000); pg.wait_for_timeout(350)
    else:
        pg.click(f'nav button[data-m="{m}"]'); pg.wait_for_selector(f"#m-{m}.on", timeout=8000); pg.wait_for_timeout(200)


def mo_panel(pg, ma):
    pg.fill("#tim", ma); row = f'#bang tr:has(td.ma:text-is("{ma}"))'
    pg.wait_for_selector(row, timeout=8000); pg.click(row)
    pg.wait_for_selector("#the.on .the-so", timeout=8000); pg.wait_for_timeout(400)


def dong_panel(pg):
    pg.keyboard.press("Escape"); pg.wait_for_selector("#the.on", state="hidden", timeout=5000)


def hop(pg, loc, w, h, num=None):
    """Trả %-box của phần tử trong ảnh (viewport wxh). None nếu không thấy."""
    try:
        bb = loc.bounding_box()
    except Exception:
        return None
    if not bb or bb["width"] <= 0:
        return None
    o = {"l": bb["x"] / w * 100, "t": bb["y"] / h * 100, "w": bb["width"] / w * 100, "h": bb["height"] / h * 100}
    if num is not None:
        o["num"] = num
    # phải nằm trong ảnh
    if o["l"] < -0.5 or o["t"] < -0.5 or o["l"] + o["w"] > 100.5 or o["t"] + o["h"] > 100.5:
        return "OUT"
    return o


def lam(pg, w, meta):
    mob = w < 820
    H = VH[w]
    kq = []

    def chup(sid, targets):
        pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(120)
        boxes = []
        for loc, num in targets:
            b = hop(pg, loc, w, H, num)
            if b == "OUT":
                raise RuntimeError(f"bước {sid}: khung chỉ LỆCH RA NGOÀI ảnh")
            if b:
                boxes.append(b)
        pg.screenshot(path=os.path.join(HD, f"b{sid:02d}-{w}.png"))
        meta.setdefault(str(sid), {})[str(w)] = boxes
        kq.append((sid, len([b for b in boxes if "num" not in b]), len([b for b in boxes if "num" in b])))

    # 1
    pg.goto(URL, wait_until="networkidle"); pg.wait_for_selector("#login.on", timeout=8000); pg.wait_for_timeout(300)
    chup(1, [(pg.locator("#lg-btn"), None)])
    # 2
    login(pg); pg.wait_for_timeout(500)
    chup(2, [(pg.locator(".tk"), None)])
    # 3
    pg.fill("#tim", "BL-03"); pg.wait_for_selector('#bang tr:has(td.ma:text-is("BL-03"))', timeout=8000); pg.wait_for_timeout(300)
    chup(3, [(pg.locator("#tim"), None)])
    pg.fill("#tim", ""); pg.wait_for_timeout(300)
    # 4
    if mob:
        pg.click(".mb-loc"); pg.wait_for_selector("#chips-row.mo", timeout=4000)
    pg.wait_for_selector('#chips button[data-n]', timeout=8000); pg.wait_for_timeout(300)
    chup(4, [(pg.locator(".mb-loc" if mob else "#chips-row"), None)])
    # 5
    chip = pg.locator('#chips button[data-n]').first
    chip.click(); pg.wait_for_timeout(400)
    chup(5, [(chip, None)])
    pg.click('.chip[data-n="*"]'); pg.wait_for_timeout(300)
    # 6
    mo_panel(pg, "BL-03")
    chup(6, [(pg.locator("#the .the-so"), None)])
    dong_panel(pg); pg.fill("#tim", ""); pg.wait_for_timeout(200)
    # 7
    di(pg, "nhap", mob); pg.wait_for_selector("#ph-nhap table", timeout=8000); pg.wait_for_timeout(400)
    chup(7, [(pg.locator("#ph-nhap .ph-dau"), None)])
    # 8 (đánh số)
    pg.select_option("#p-ncc", index=0)
    pg.click('#ph-nhap button:has-text("Thêm dòng")'); pg.wait_for_timeout(300)
    chup(8, [(pg.locator("#p-ncc"), 1), (pg.locator('#ph-nhap button:has-text("Thêm dòng")'), 2)])
    # 9 (đánh số)
    r0 = pg.locator("#ph-nhap tbody tr").first
    r0.locator('input[type="number"]').fill("12")
    gia = r0.locator('input:not([type="number"])'); gia.click(); pg.keyboard.press("Meta+A"); pg.keyboard.press("Delete")
    for ch in "10000":
        pg.keyboard.press(ch)
    r0.locator('input[type="number"]').click(); pg.wait_for_timeout(300)
    chup(9, [(r0.locator('input[type="number"]'), 1), (gia, 2), (pg.locator("#ct-nhap-0"), 3)])
    # 10
    chup(10, [(pg.locator('#ph-nhap button.chinh'), None)])
    # 11 (đánh số)
    di(pg, "xuat", mob); pg.wait_for_selector("#ph-xuat table", timeout=8000)
    pg.locator("#ph-xuat tbody tr").first.locator('input[type="number"]').fill("5"); pg.wait_for_timeout(300)
    chup(11, [(pg.locator("#ph-xuat tbody tr").first.locator('input[type="number"]'), 1), (pg.locator("#ph-xuat button.chinh"), 2)])
    # 12 (đánh số)
    di(pg, "ton", mob); pg.wait_for_timeout(300)
    mo_panel(pg, "AA-NAUDAM-18")
    if pg.locator('#nut-anh').count() == 0:
        raise RuntimeError("bước 12: không thấy nút Thêm ảnh")
    chup(12, [(pg.locator("#nut-anh"), 1)])
    dong_panel(pg); pg.fill("#tim", ""); pg.wait_for_timeout(200)
    # 13
    di(pg, "dat", mob); pg.wait_for_selector("#m-dat.on", timeout=8000); pg.wait_for_timeout(400)
    dat_tg = pg.locator("#m-dat tbody tr").first if pg.locator("#m-dat tbody tr").count() else pg.locator(".muc button").first
    chup(13, [(dat_tg, None)])
    # 14
    di(pg, "ncc", mob); pg.wait_for_selector("#m-ncc.on", timeout=8000); pg.wait_for_timeout(400)
    chup(14, [(pg.locator("#m-ncc button.chinh"), None)])
    # 15
    di(pg, "ton", mob); pg.wait_for_timeout(300)
    if mob:
        pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000); pg.wait_for_timeout(350)
    chup(15, [(pg.locator(".mb-menu" if mob else 'nav button[data-m="ton"]'), None)])
    return kq


def tao_html(app_tag, luc, so_buoc, tong, meta):
    def overlays(sid, w):
        out = ""
        for b in meta.get(str(sid), {}).get(str(w), []):
            if "num" in b:
                out += f'<span class="numc" style="left:{b["l"]:.2f}%;top:{b["t"]:.2f}%">{b["num"]}</span>'
            else:
                out += f'<span class="khung" style="left:{b["l"]:.2f}%;top:{b["t"]:.2f}%;width:{b["w"]:.2f}%;height:{b["h"]:.2f}%"></span>'
        return out

    def khoi(sid, tit, giai):
        ds = DANH_SO.get(sid)
        ds_html = ("<ol class=\"tt\">" + "".join(f"<li>{x}</li>" for x in ds) + "</ol>") if ds else ""
        return f"""<section class="buoc" id="b{sid}">
  <div class="dau"><span class="stt">{sid}</span><h3>{tit}</h3></div>
  <p class="giai">{giai}</p>
  {ds_html}
  <figure><figcaption>📱 Điện thoại</figcaption>
    <div class="anh-box dt" onclick="phong(this)"><img src="hd/b{sid:02d}-390.png" alt="Bước {sid} điện thoại">{overlays(sid,390)}</div></figure>
  <figure><figcaption>💻 Máy tính <span class="nhac">— bấm ảnh để phóng to</span></figcaption>
    <div class="anh-box mt" onclick="phong(this)"><img src="hd/b{sid:02d}-1280.png" alt="Bước {sid} máy tính">{overlays(sid,1280)}</div></figure>
</section>"""
    ml = []
    for i, nh in enumerate(NHOM, 1):
        cac = [s for s in STEPS if s[3] == nh]
        lis = "".join(f'<li><a href="#b{s[0]}">{s[0]}. {s[1]}</a></li>' for s in cac)
        ml.append(f'<div class="ml-nhom"><b>Nhóm {i} — {nh}</b><ul>{lis}</ul></div>')
    body = []; cur = None
    for sid, tit, giai, nh in STEPS:
        if nh != cur:
            cur = nh
            body.append(f'<h2 class="nhom-tit">Nhóm {NHOM.index(nh)+1} — {nh}</h2>')
        body.append(khoi(sid, tit, giai))
    day = "ĐỦ" if so_buoc == tong else "THIẾU"
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Togihome Kho — Hướng dẫn dùng</title>
<style>
:root{{--do:#C0392B;--ink:#23282E;--muted:#6E7681;--line:#D9D5CC;--paper:#EFEDE8}}
*{{box-sizing:border-box}} html,body{{margin:0;overflow-x:hidden;max-width:100%}}
body{{background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,Roboto,sans-serif}}
header.top{{background:var(--do);color:#fff;padding:18px 16px}}
header.top h1{{margin:0 0 4px;font-size:20px}} header.top .meta{{font-size:13px;color:#F3CFC9}}
header.top .dem{{margin-top:6px;font-size:13px;background:rgba(255,255,255,.15);display:inline-block;padding:3px 10px;border-radius:5px}}
.wrap{{max-width:920px;margin:0 auto;padding:16px 14px 60px}}
.mucluc{{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:22px}}
.mucluc h2{{margin:0 0 8px;font-size:15px}} .ml-nhom{{margin:8px 0}} .ml-nhom b{{font-size:13.5px}}
.mucluc ul{{margin:4px 0 0;padding-left:20px}} .mucluc li{{margin:2px 0}} .mucluc a{{color:var(--do);text-decoration:none}}
.nhom-tit{{font-size:17px;color:var(--do);border-bottom:2px solid #E7C9C3;padding-bottom:5px;margin:26px 0 14px}}
.buoc{{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px}}
.buoc .dau{{display:flex;align-items:center;gap:10px;margin-bottom:6px}}
.stt{{width:30px;height:30px;flex:none;background:var(--do);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700}}
.buoc h3{{margin:0;font-size:16px}} .giai{{margin:0 0 10px;color:#3A4048}}
ol.tt{{margin:0 0 12px;padding-left:22px}} ol.tt li{{margin:2px 0;color:#3A4048}}
figure{{margin:0 0 14px}} figcaption{{font-size:12.5px;color:var(--muted);margin-bottom:6px;font-weight:600}}
figcaption .nhac{{font-weight:400;color:#9AA0A6}}
.anh-box{{position:relative;display:block;width:100%;cursor:zoom-in;line-height:0}}
.anh-box img{{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px}}
.anh-box.mt img{{min-width:0}}
@media (min-width:940px){{ .anh-box.mt{{min-width:900px}} }}
.khung{{position:absolute;border:3px solid var(--do);border-radius:6px;box-shadow:0 0 0 3px rgba(192,57,43,.25);pointer-events:none}}
.numc{{position:absolute;transform:translate(-55%,-55%);width:26px;height:26px;background:var(--do);color:#fff;
 border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;
 box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none}}
/* lightbox */
#lb{{position:fixed;inset:0;background:rgba(10,12,16,.9);display:none;align-items:center;justify-content:center;z-index:90;cursor:zoom-out;padding:10px}}
#lb.on{{display:flex}} #lb img{{max-width:98vw;max-height:96vh;border-radius:6px;background:#fff}}
@media print{{
  body{{background:#fff}} header.top{{background:#fff;color:#000;border-bottom:2px solid #000}}
  header.top .meta,header.top .dem{{color:#333;background:none}} .mucluc{{display:none}}
  .buoc{{page-break-inside:avoid;border:1px solid #999}} .nhom-tit{{page-break-before:always}}
  .anh-box.mt{{min-width:0}} .khung,.numc{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  figcaption .nhac{{display:none}}
}}
</style></head><body>
<header class="top">
  <h1>Togihome Kho — Hướng dẫn dùng</h1>
  <div class="meta">Sinh tự động lúc {luc} · phiên bản app: {app_tag}</div>
  <div class="dem">Đã chụp {so_buoc}/{tong} bước ({day}) · khung đỏ & số lấy toạ độ thật từ trình duyệt</div>
</header>
<div class="wrap">
  <nav class="mucluc"><h2>Mục lục</h2>{''.join(ml)}</nav>
  {''.join(body)}
</div>
<div id="lb" onclick="this.classList.remove('on')"><img id="lb-img" alt=""></div>
<script>
function phong(box){{ const im=box.querySelector('img'); const lb=document.getElementById('lb');
  document.getElementById('lb-img').src=im.src; lb.classList.add('on'); }}
</script>
</body></html>"""


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    os.makedirs(HD, exist_ok=True)
    meta = {}
    tat_ca = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in (390, 1280):
            print(f"── chụp ở {w}px (viewport {w}x{VH[w]}) ──")
            pg = b.new_page(viewport={"width": w, "height": VH[w]})
            try:
                kq = lam(pg, w, meta)
            except Exception as e:
                print(f"  ❌ DỪNG ở {w}px: {e}"); pg.close(); b.close()
                print("KHÔNG sinh trang hướng dẫn (thiếu bước)."); sys.exit(1)
            for sid, na, ns in kq:
                print(f"  [OK] bước {sid} @{w}px · mũi tên:{'có' if na else 'không'} · đánh số:{ns if ns else 'không'}")
                tat_ca.append((w, sid))
            pg.close()
        b.close()

    so_buoc = len({sid for w, sid in tat_ca})
    tong = len(STEPS)
    if so_buoc != tong:
        print(f"❌ chỉ {so_buoc}/{tong} bước — KHÔNG sinh trang."); sys.exit(1)
    try:
        app_tag = subprocess.run(["git", "describe", "--tags", "--always"], cwd=WEB, capture_output=True, text=True).stdout.strip() or "?"
    except Exception:
        app_tag = "?"
    luc = datetime.now().strftime("%H:%M %d/%m/%Y")
    with open(os.path.join(WEB, "public", "huong-dan.html"), "w", encoding="utf-8") as f:
        f.write(tao_html(app_tag, luc, so_buoc, tong, meta))
    n_anh = len([x for x in os.listdir(HD) if x.endswith(".png")])
    print(f"\n✅ Sinh xong: {n_anh} ảnh · {so_buoc}/{tong} bước × 2 · app {app_tag} · {luc}")
    print("   đánh số ở bước: " + ", ".join(str(k) for k in sorted(DANH_SO)))


if __name__ == "__main__":
    main()
