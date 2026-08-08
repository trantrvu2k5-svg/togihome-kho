# -*- coding: utf-8 -*-
# Nút XUẤT bảng quy đổi + dải CẢNH BÁO mã kho chưa ghép. Đăng nhập ceo thật, 1280 + 390.
#   a. có nút Xuất · b. modal hiện đúng số đã-chốt/chưa-chốt (khớp DB) · c. tải file được
#   d. CỔNG: file tải về == file ops/xuat_quy_doi.mjs (bỏ qua dấu thời gian) · e. dải cảnh báo đúng số
#   f. bấm dải mở danh sách · g. đánh dấu 1 mã không liên quan -> số -1, reload vẫn giữ · h. layout 390
#   i. dọn sạch: quy_doi vẫn 96/6, xoá localStorage
# Chỗ lưu "không liên quan": localStorage key gm_bo_qua (KHÔNG tạo bảng — cai_dat chỉ SELECT cho app).
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
OPS_OUT = os.path.join(WEB, "..", "scratch", "quy_doi_export.json")
loi = []


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


def norm_ts(s):   # bỏ giá trị dấu thời gian để so byte phần còn lại
    return re.sub(r'"thoi_gian_xuat":\s*"[^"]*"', '"thoi_gian_xuat": "X"', s)


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    truoc = dbjs("const r=await q(`select (select count(*)::int from kho.quy_doi) n,(select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') d`); console.log(JSON.stringify(r[0]));")

    with sync_playwright() as p:
        b = p.chromium.launch()
        for W in (1280, 390):
            hep = W < 820
            print(f"── {W}px ──")
            pg = b.new_page(viewport={"width": W, "height": 1000}, accept_downloads=True)

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
            pg.evaluate("()=>localStorage.removeItem('gm_bo_qua')")   # localStorage sạch trước mỗi kích thước
            di_ghep()

            # a. có nút Xuất
            has = pg.locator("#gm-btn-xuat").count() == 1
            bao(f"a.{W} có nút Xuất bảng quy đổi", has)
            if not has:
                raise AssertionError("a: không có nút Xuất")

            # b. modal hiện đúng số đã-chốt / chưa-chốt
            dd = dbjs("const r=await q(`select count(*)::int d from kho.quy_doi where trang_thai='DA_DUYET' and la_mac_dinh`); console.log(JSON.stringify(r[0].d));")
            sm = dbjs("const r=await q(`select count(distinct mo_ta_thiet_ke)::int n from kho.quy_doi`); console.log(JSON.stringify(r[0].n));")
            pg.click("#gm-btn-xuat")
            pg.wait_for_selector("#gm-modal", state="visible", timeout=6000)
            bolds = [re.sub(r"\D", "", t) for t in pg.locator("#gm-modal-msg b").all_inner_texts()]
            nums = [int(x) for x in bolds if x != ""]
            okb = len(nums) >= 2 and nums[0] == dd and nums[1] == (sm - dd)
            bao(f"b.{W} modal: đã chốt {dd}, còn {sm-dd}", okb, f"modal={nums} · DB dd={dd} conlai={sm-dd}")
            if not okb:
                raise AssertionError(f"b @{W}: modal {nums} vs DB {dd}/{sm-dd}")

            # c. xác nhận -> tải file
            with pg.expect_download(timeout=10000) as di:
                pg.click("#gm-modal-ok")
            dl = di.value
            content = open(dl.path(), encoding="utf-8").read()
            bao(f"c.{W} tải file được", len(content) > 20 and dl.suggested_filename.startswith("quy_doi_"), dl.suggested_filename)
            if not (len(content) > 20):
                raise AssertionError("c: không tải được file")

            # d. CỔNG: file trình duyệt == file ops (bỏ qua dấu thời gian)
            r = subprocess.run(["node", "ops/xuat_quy_doi.mjs"], capture_output=True, text=True, cwd=WEB)
            if r.returncode != 0:
                print("LỖI ops:", r.stderr.strip()[:300]); sys.exit(2)
            ops = open(OPS_OUT, encoding="utf-8").read()
            same = norm_ts(content) == norm_ts(ops)
            bao(f"d.{W} file browser == file ops (bỏ dấu thời gian)", same)
            if not same:
                a1, a2 = norm_ts(content).splitlines(), norm_ts(ops).splitlines()
                diff = [f"  browser: {x}\n  ops    : {y}" for x, y in zip(a1, a2) if x != y][:6]
                raise AssertionError("d @%d: KHÁC:\n%s\n(len b=%d ops=%d)" % (W, "\n".join(diff), len(a1), len(a2)))

            # e. dải cảnh báo đúng số
            exp_chua = dbjs("const r=await q(`select count(*)::int n from kho.vat_tu where ma not in (select ma_kho from kho.quy_doi where ma_kho is not null)`); console.log(JSON.stringify(r[0].n));")
            hien = pg.locator("#gm-canhbao").is_visible()
            dai_so = int(re.sub(r"\D", "", pg.locator("#gm-canhbao b").first.inner_text())) if hien else 0
            oke = (exp_chua == 0 and not hien) or (dai_so == exp_chua)
            bao(f"e.{W} dải cảnh báo = {exp_chua}", oke, f"dải={dai_so} (hiện={hien}) · DB={exp_chua}")
            if not oke:
                raise AssertionError(f"e @{W}: dải {dai_so} vs DB {exp_chua}")

            if exp_chua > 0:
                # f. bấm dải -> danh sách mở
                pg.click("#gm-canhbao")
                pg.wait_for_selector("#gm-chuaghep .gm-chua-row", timeout=6000)
                n_row = pg.locator("#gm-chuaghep .gm-chua-row").count()
                bao(f"f.{W} bấm dải mở danh sách ({n_row} dòng)", n_row == exp_chua, f"dòng {n_row} · cần {exp_chua}")
                if n_row != exp_chua:
                    raise AssertionError(f"f @{W}: {n_row} != {exp_chua}")

            # h. layout 390: không cuộn ngang · chữ >=14 · vùng bấm >=48 (dải+danh sách đang mở)
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

            # g. đánh dấu 1 mã không liên quan -> số -1; reload -> giữ nguyên
            if exp_chua > 0:
                if pg.locator("#gm-chuaghep .gm-chua-row").count() == 0:
                    pg.click("#gm-canhbao"); pg.wait_for_selector("#gm-chuaghep .gm-chua-row", timeout=6000)
                ma_bo = pg.locator("#gm-chuaghep .gm-chua-row").first.locator(".u-ma").inner_text().strip()
                pg.locator("#gm-chuaghep .gm-chua-row").first.locator("button.nut").click()
                pg.wait_for_function(f"(n)=>{{const e=document.querySelector('#gm-canhbao b');return e && parseInt(e.textContent.replace(/\\D/g,''))===n}}", arg=exp_chua - 1, timeout=6000)
                so_sau = int(re.sub(r"\D", "", pg.locator("#gm-canhbao b").first.inner_text()))
                # reload -> vào lại ghép -> số vẫn giảm (localStorage giữ)
                pg.reload(wait_until="networkidle")
                pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='199'}", timeout=12000)
                di_ghep()
                # chờ gmCanhBao (async) cập nhật dải sau reload — localStorage giữ mark thì số còn exp_chua-1
                pg.wait_for_function("(n)=>{const e=document.querySelector('#gm-canhbao b');return e && parseInt(e.textContent.replace(/\\D/g,''))===n}", arg=exp_chua - 1, timeout=8000)
                so_reload = int(re.sub(r"\D", "", pg.locator("#gm-canhbao b").first.inner_text()))
                okg = so_sau == exp_chua - 1 and so_reload == exp_chua - 1
                bao(f"g.{W} đánh dấu {ma_bo} -> {exp_chua}->{so_sau}, reload giữ {so_reload}", okg)
                if not okg:
                    raise AssertionError(f"g @{W}: sau={so_sau} reload={so_reload} (cần {exp_chua-1})")
                pg.evaluate("()=>localStorage.removeItem('gm_bo_qua')")   # dọn localStorage của kích thước này

            pg.close()
        b.close()

    # i. quy_doi không đổi
    sau = dbjs("const r=await q(`select (select count(*)::int from kho.quy_doi) n,(select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') d`); console.log(JSON.stringify(r[0]));")
    oki = sau == truoc and sau["n"] == 96 and sau["d"] == 6
    bao(f"i. quy_doi giữ nguyên {sau} (localStorage đã xoá)", oki, f"trước {truoc}")
    if not oki:
        raise AssertionError(f"i: quy_doi lệch {sau} vs {truoc}")

    print("\n" + ("✅ TẤT CẢ PASS" if not loi else "❌ FAIL: " + ", ".join(loi)))
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
