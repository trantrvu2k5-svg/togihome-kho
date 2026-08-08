# -*- coding: utf-8 -*-
# Thêm/xoá ứng viên mã kho vào mô tả (VIỆC 1·2·3). Đăng nhập ceo thật, chạm giao diện thật.
# Snapshot quy_doi lúc đầu -> restore trước mỗi kích thước + cuối (try/finally). 1280 + 390.
#   a. mỗi khối có nút "Thêm mã kho khác" · b. thêm 1 mã -> DB dòng mới CHUA_DUYET, la_mac_dinh false
#   c. thêm trùng -> báo, không tạo dòng · d. chọn ứng viên vừa thêm làm mặc định -> cờ chuyển
#   f. xoá khi đang mặc định -> chặn · e. bỏ chọn + xoá -> dòng biến mất
#   g. dải chưa-ghép: Ghép vào 1 mã cho 1 mô tả -> thêm + số dải -1
#   h. 390: không cuộn ngang, chữ>=14, vùng bấm>=48 · i. dọn sạch -> 96/6
import json
import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loi = []
BLOCK = "ban_le_gc_110"     # mô tả để thử (ứng viên sẵn: BL-01 default, BL-02)
MA = "BL-05"                # mã kho thật, KHÔNG phải ứng viên của BLOCK


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def dbjs(body):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           "const q=async(s,a=[])=>(await c.query(s,a)).rows;"
           f"{body} await c.end(); process.exit(0);")
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB)
    if out.returncode != 0:
        print("LỖI DB:", out.stderr.strip()[:400]); sys.exit(2)
    return json.loads(out.stdout.strip().splitlines()[-1])


def snapshot():
    return dbjs("const r=await q(`select id,ma_kho,he_so_quy_doi,muc_tin_cay,la_mac_dinh,trang_thai,ghi_chu,nguoi_duyet,duyet_luc from kho.quy_doi`); console.log(JSON.stringify(r));")


def restore(snap):
    ids = json.dumps([r["id"] for r in snap])
    body = ("const S=" + json.dumps(snap) + ";"
            "await c.query(`delete from kho.quy_doi where id <> all($1::uuid[])`, [" + ids + "]);"  # xoá dòng TEST thêm
            "for (const r of S){ await c.query(`update kho.quy_doi set ma_kho=$2,he_so_quy_doi=$3,muc_tin_cay=$4,la_mac_dinh=$5,trang_thai=$6,ghi_chu=$7,nguoi_duyet=$8,duyet_luc=$9 where id=$1`,"
            "[r.id,r.ma_kho,r.he_so_quy_doi,r.muc_tin_cay,r.la_mac_dinh,r.trang_thai,r.ghi_chu,r.nguoi_duyet,r.duyet_luc]); }"
            "console.log(JSON.stringify('OK'));")
    dbjs(body)


def rows_of(mo_ta, ma):
    return dbjs(f"const r=await q(`select id,trang_thai,la_mac_dinh from kho.quy_doi where mo_ta_thiet_ke='{mo_ta}' and ma_kho='{ma}'`); console.log(JSON.stringify(r));")


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    snap = snapshot()
    truoc = dbjs("const r=await q(`select (select count(*)::int from kho.quy_doi) n,(select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') d`); console.log(JSON.stringify(r[0]));")
    try:
      with sync_playwright() as p:
        b = p.chromium.launch()
        for W in (1280, 390):
            hep = W < 820
            print(f"── {W}px ──")
            restore(snap)
            pg = b.new_page(viewport={"width": W, "height": 1100})

            def login():
                pg.goto(URL, wait_until="networkidle")
                pg.fill("#lg-email", EMAIL); pg.fill("#lg-pass", PASS); pg.click("#lg-btn")
                pg.wait_for_selector("#login", state="hidden", timeout=15000)
                pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='199'}", timeout=12000)

            def di_ghep():
                if hep:
                    pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000)
                pg.click('nav button[data-m="ghep"]'); pg.wait_for_selector("#m-ghep.on", timeout=8000)
                if hep:
                    pg.wait_for_selector("nav:not(.mo)", timeout=4000)
                pg.wait_for_function("()=>document.querySelectorAll('#gm-ds .khoi').length>0", timeout=12000)

            login()
            pg.evaluate("()=>localStorage.removeItem('gm_bo_qua')")
            di_ghep()

            # a. mọi khối có nút Thêm mã kho khác
            n_khoi = pg.locator("#gm-ds .khoi").count()
            n_them = pg.locator('#gm-ds .khoi button:has-text("Thêm mã kho khác")').count()
            bao(f"a.{W} mỗi khối có nút Thêm mã kho khác", n_them == n_khoi, f"{n_them}/{n_khoi}")
            if n_them != n_khoi:
                raise AssertionError(f"a @{W}: {n_them} nút != {n_khoi} khối")

            def them_ma(mo_ta, ma):
                pg.click(f'#gm-k-{mo_ta} button:has-text("Thêm mã kho khác")')
                pg.wait_for_selector(f'#gm-them-{mo_ta} .gm-them-tim', timeout=6000)
                pg.fill(f'#gm-them-{mo_ta} .gm-them-tim', ma)
                row = f'#gm-them-{mo_ta} .gm-them-row:has(.u-ma:text-is("{ma}")) button.nut'
                pg.wait_for_selector(row, timeout=6000); pg.click(row)

            # b. thêm BL-05 vào BLOCK
            them_ma(BLOCK, MA)
            pg.wait_for_function(f'()=>{{const e=document.querySelector("#gm-k-{BLOCK}");return e && e.textContent.includes("{MA}")}}', timeout=8000)
            r = rows_of(BLOCK, MA)
            okb = len(r) == 1 and r[0]["trang_thai"] == "CHUA_DUYET" and (not r[0]["la_mac_dinh"])
            bao(f"b.{W} thêm {MA} -> DB CHUA_DUYET, la_mac_dinh false", okb, str(r))
            if not okb:
                raise AssertionError(f"b @{W}: {r}")

            # c. thêm trùng -> không tạo dòng
            them_ma(BLOCK, MA)
            pg.wait_for_timeout(500)
            toast = pg.inner_text("#toast") if pg.locator("#toast").count() else ""
            r2 = rows_of(BLOCK, MA)
            okc = len(r2) == 1 and ("trùng" in toast.lower() or "ĐÃ là" in toast)
            bao(f"c.{W} thêm trùng -> báo + không tạo dòng mới", okc, f"#dòng={len(r2)} toast={toast!r}")
            if len(r2) != 1:
                raise AssertionError("THÊM TRÙNG")

            # d. chọn BL-05 làm mặc định
            pg.click(f'#gm-k-{BLOCK} .uv:has(.u-ma:text-is("{MA}")) button[onclick^="gmChon"]')
            pg.wait_for_function(f'()=>{{const e=document.querySelector("#gm-k-{BLOCK}");return e && /ĐÃ DUYỆT/.test(e.textContent)}}', timeout=8000)
            rd = dbjs(f"const r=await q(`select ma_kho,la_mac_dinh,trang_thai from kho.quy_doi where mo_ta_thiet_ke='{BLOCK}'`); console.log(JSON.stringify(r));")
            bl05 = next(x for x in rd if x["ma_kho"] == MA)
            n_def = sum(1 for x in rd if x["la_mac_dinh"])
            okd = bl05["la_mac_dinh"] and bl05["trang_thai"] == "DA_DUYET" and n_def == 1
            bao(f"d.{W} chọn {MA} mặc định (đúng 1 mặc định)", okd, f"{MA}={bl05} #default={n_def}")
            if not okd:
                raise AssertionError(f"d @{W}: {rd}")

            # f. xoá khi đang mặc định -> chặn
            pg.click(f'#gm-k-{BLOCK} .uv:has(.u-ma:text-is("{MA}")) button.gm-xoa')
            pg.wait_for_timeout(400)
            tf = pg.inner_text("#toast") if pg.locator("#toast").count() else ""
            rf = rows_of(BLOCK, MA)
            okf = len(rf) == 1 and ("mặc định" in tf.lower() or "bỏ chọn" in tf.lower())
            bao(f"f.{W} xoá ứng viên đang mặc định -> chặn + báo", okf, f"#dòng={len(rf)} toast={tf!r}")
            if len(rf) != 1:
                raise AssertionError("XOÁ ĐƯỢC ỨNG VIÊN MẶC ĐỊNH")

            # e. bỏ chọn (bấm lại) rồi xoá
            pg.click(f'#gm-k-{BLOCK} .uv:has(.u-ma:text-is("{MA}")) button[onclick^="gmChon"]')  # toggle bỏ chọn
            pg.wait_for_function(f'()=>{{const uv=[...document.querySelectorAll("#gm-k-{BLOCK} .uv")].find(u=>u.querySelector(".u-ma")&&u.querySelector(".u-ma").textContent.trim()==="{MA}");return uv && !uv.classList.contains("chon")}}', timeout=8000)
            pg.click(f'#gm-k-{BLOCK} .uv:has(.u-ma:text-is("{MA}")) button.gm-xoa')
            pg.wait_for_selector("#gm-modal", state="visible", timeout=6000)
            pg.click("#gm-modal-ok")
            pg.wait_for_function(f'()=>{{const e=document.querySelector("#gm-k-{BLOCK}");return e && !e.textContent.includes("{MA}")}}', timeout=8000)
            re_ = rows_of(BLOCK, MA)
            bao(f"e.{W} bỏ chọn + xoá -> dòng biến mất", len(re_) == 0, f"#dòng={len(re_)}")
            if len(re_) != 0:
                raise AssertionError(f"e @{W}: còn {re_}")

            # g. dải chưa-ghép: Ghép vào 1 mã cho 1 mô tả -> số dải -1
            if pg.locator("#gm-canhbao").is_visible():
                so0 = int(re.sub(r"\D", "", pg.locator("#gm-canhbao b").first.inner_text()))
                pg.click("#gm-canhbao"); pg.wait_for_selector("#gm-chuaghep .gm-chua-row", timeout=6000)
                ma_g = pg.locator("#gm-chuaghep .gm-chua-row").first.locator(".u-ma").inner_text().strip()
                pg.locator("#gm-chuaghep .gm-chua-row").first.locator('button:has-text("Ghép vào")').click()
                pg.wait_for_selector(f'#gm-ghep-{ma_g} .gm-ghep-tim', timeout=6000)
                pg.fill(f'#gm-ghep-{ma_g} .gm-ghep-tim', "chan_go_tron")
                grow = f'#gm-ghep-{ma_g} .gm-them-row:has(.u-ma:text-is("chan_go_tron")) button.nut'
                pg.wait_for_selector(grow, timeout=6000); pg.click(grow)
                pg.wait_for_function("(n)=>{const e=document.querySelector('#gm-canhbao b');return e && parseInt(e.textContent.replace(/\\D/g,''))===n}", arg=so0 - 1, timeout=8000)
                rg = rows_of("chan_go_tron", ma_g)
                so1 = int(re.sub(r"\D", "", pg.locator("#gm-canhbao b").first.inner_text()))
                okg = len(rg) == 1 and rg[0]["trang_thai"] == "CHUA_DUYET" and so1 == so0 - 1
                bao(f"g.{W} Ghép {ma_g}->chan_go_tron, dải {so0}->{so1}", okg, str(rg))
                if not okg:
                    raise AssertionError(f"g @{W}: rg={rg} dải {so0}->{so1}")

            # h. layout 390
            if hep:
                sc = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
                bao(f"h.{W} không cuộn ngang", sc <= cw, f"{sc}<= {cw}")
                if sc > cw:
                    raise AssertionError(f"h: cuộn ngang {sc}>{cw}")
                nho_b = pg.evaluate("""()=>{const o=[];for(const el of document.querySelectorAll('#m-ghep button,#m-ghep .gm-chip,#m-ghep input')){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')continue;const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;if(r.height<48-0.01)o.push((el.id||el.textContent||el.className).trim().slice(0,18)+'='+Math.round(r.height))}return o}""")
                nho_c = pg.evaluate("""()=>{const o=[];for(const el of document.querySelectorAll('#m-ghep *')){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')continue;let h=false;for(const nd of el.childNodes){if(nd.nodeType===3&&nd.textContent.trim()!==''){h=true;break}}if(!h)continue;if(parseFloat(s.fontSize)<14-0.01)o.push((el.className||el.tagName)+'='+s.fontSize)}return o}""")
                bao(f"h.{W} chữ>=14 & vùng bấm>=48", len(nho_b) == 0 and len(nho_c) == 0, f"nút={nho_b[:4]} chữ={nho_c[:4]}")
                if nho_b or nho_c:
                    raise AssertionError(f"h @{W}: nút<48 {nho_b} chữ<14 {nho_c}")

            pg.close()
    finally:
        restore(snap)

    fin = dbjs("const r=await q(`select (select count(*)::int from kho.quy_doi) n,(select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') d`); console.log(JSON.stringify(r[0]));")
    oki = fin == truoc and fin["n"] == 96 and fin["d"] == 6
    bao(f"i. dọn sạch: {fin} (cần 96/6)", oki, f"trước {truoc}")
    if not oki:
        raise AssertionError(f"i: quy_doi lệch {fin}")

    print("\n" + ("✅ TẤT CẢ PASS" if not loi else "❌ FAIL: " + ", ".join(loi)))
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
