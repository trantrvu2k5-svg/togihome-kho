# -*- coding: utf-8 -*-
# Tải ảnh vật tư từ trong app (ceo): thu nhỏ -> lên bucket tên MỚI -> cập nhật anh_file -> hiện ngay.
# Dùng ảnh png TỰ SINH (không dùng ảnh thật công ty). DỌN SẠCH sau khi thử: xoá file thử + trả anh_file về cũ.
#
# Gõ/chọn file thật qua trình duyệt. KHÔNG gọi hàm JS của app. KHÔNG tạo phiếu, KHÔNG Ghi sổ.
# Cần env: DEV_URL, CEO_EMAIL, CEO_PASS, DB_HOST, DB_USER, DB_PASS. Chạy: cd web && ... python3 tests/test_tai_anh.py

import base64
import os
import re
import subprocess
import sys
import tempfile
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
MA = "AA-NAUDAM-18"                 # mã trống cả hai (không anh_ma, không bucket) -> mọi file MA_* là do test
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loi = []
# PNG 2x2 hợp lệ (tự sinh, không phải ảnh công ty)
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z/C/ngEIGGEMAF0EA/0Q3G0YAAAAAElFTkSuQmCC")


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def db_one(sql):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           f"const r=await c.query(`{sql}`); console.log(r.rows[0]?String(Object.values(r.rows[0])[0]):''); "
           "await c.end(); process.exit(0);")
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB_DIR)
    if out.returncode != 0:
        print("LỖI SELECT DB:", out.stderr.strip()); sys.exit(2)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""


def dem_bucket():
    return int(db_one("select count(*)::int from storage.objects where bucket_id='kho-images'"))


def dem_ma():
    return int(db_one(f"select count(*)::int from storage.objects where bucket_id='kho-images' and name like 'kho/{MA}\\_%'"))


def don_bucket():
    # Xoá ĐÚNG file thử (kho/MA_*) qua storage API (ceo) + trả anh_file về NULL. Đọc anon key từ web/.env.
    src = ("""
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]}))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { db:{schema:'kho'} })
await sb.auth.signInWithPassword({ email: process.env.CEO_EMAIL, password: process.env.CEO_PASS })
const { data: list } = await sb.storage.from('kho-images').list('kho', { limit: 2000 })
const paths = (list||[]).filter(f=>f.name.startsWith(process.env.MA+'_')).map(f=>'kho/'+f.name)
if (paths.length) { const { error } = await sb.storage.from('kho-images').remove(paths); if (error) { console.error(error.message); process.exit(3) } }
await sb.from('vat_tu').update({ anh_file: null }).eq('ma', process.env.MA)
console.log('removed', paths.length); process.exit(0)
""")
    env = {**os.environ, "MA": MA}
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB_DIR, env=env)
    if out.returncode != 0:
        print("LỖI DỌN BUCKET:", out.stderr.strip()); sys.exit(2)


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)

    # dọn trước (phòng lần trước sót) rồi chốt baseline
    don_bucket()
    base_count = dem_bucket()
    n_ma = db_one("select count(*)::int from kho.vat_tu")   # số mã đọc DB, thay số cứng
    print(f"  (bucket ban đầu = {base_count} file · anh_file[{MA}] ban đầu = NULL · số mã DB = {n_ma})")

    # ── (a) tự sinh ảnh png + file văn bản trong thư mục tạm ──
    d = tempfile.mkdtemp()
    png = os.path.join(d, "thu_nghiem.png"); open(png, "wb").write(PNG)
    txt = os.path.join(d, "thu_nghiem.txt"); open(txt, "w").write("day khong phai anh")
    bao("a. tự sinh ảnh png thử", os.path.getsize(png) > 0)

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()
        page.goto(URL, wait_until="networkidle")
        page.fill("#lg-email", EMAIL); page.fill("#lg-pass", PASS); page.click("#lg-btn")
        page.wait_for_selector("#login", state="hidden", timeout=15000)
        page.wait_for_function("() => { const e=document.querySelector('#k-ma'); return e && e.textContent.replace(/\\D/g,'')==='" + n_ma + "' }", timeout=12000)

        def mo_the(ma):
            page.fill("#tim", ma)
            row = f'#bang tr:has(td.ma:text-is("{ma}"))'
            page.wait_for_selector(row, timeout=8000)
            page.click(row)
            page.wait_for_selector("#the.on .the-so", timeout=8000)

        def cho_toast(chua):
            page.wait_for_function(
                "s => { const t=document.querySelector('#toast'); return t && t.style.display!=='none' && t.textContent.includes(s) }",
                arg=chua, timeout=20000)

        # ── (b) panel mã chưa ảnh có nút tải ──
        mo_the(MA)
        co_nut = page.locator("#nut-anh").count() > 0
        bao("b. panel có nút tải ảnh", co_nut)
        if not co_nut:
            raise AssertionError("b: không có nút tải ảnh")

        # ── (c) tải ảnh thử, đợi báo thành công ──
        page.locator("#nut-anh input[type=file]").set_input_files(png)
        cho_toast("Đã tải ảnh")
        bao("c. tải lên báo thành công", True)

        # ── (d) ảnh hiện ngay trên panel (src bucket) ──
        page.wait_for_selector("#the .the-dau .anh.co img", timeout=10000)
        src1 = page.locator("#the .the-dau .anh.co img").get_attribute("src")
        bao("d. ảnh hiện ngay, src bucket", bool(src1) and "/storage/v1/object/public/kho-images/" in src1, str(src1))
        if not (src1 and "kho-images" in src1):
            raise AssertionError("d: ảnh không hiện")

        # ── (e) anh_file mang tên mới đúng quy ước ──
        af1 = db_one(f"select anh_file from kho.vat_tu where ma='{MA}'")
        ok_e = bool(re.match(rf"^kho/{re.escape(MA)}_\d+\.jpg$", af1))
        bao("e. anh_file đúng quy ước", ok_e, af1)
        if not ok_e:
            raise AssertionError("e: anh_file sai quy ước")

        # ── (f) tải lần 2 -> file MỚI, file cũ VẪN còn (panel đã re-render sau lần 1, input ẩn dùng trực tiếp) ──
        page.locator("#nut-anh input[type=file]").set_input_files(png)
        cho_toast("Đã tải ảnh")
        af2 = db_one(f"select anh_file from kho.vat_tu where ma='{MA}'")
        so_ma = dem_ma()
        con_cu = int(db_one(f"select count(*)::int from storage.objects where bucket_id='kho-images' and name='{af1}'"))
        bao("f. lần 2 tạo file mới, file cũ còn", af2 != af1 and so_ma == 2 and con_cu == 1, f"af2={af2} so_ma={so_ma} cu_con={con_cu}")
        if con_cu != 1:
            raise AssertionError("ĐÃ XOÁ ẢNH CŨ")
        if not (af2 != af1 and so_ma == 2):
            raise AssertionError("f: lần 2 không tạo file mới đúng")

        # ── (g) tải file KHÔNG phải ảnh -> bị chặn, không đổi ──
        page.locator("#nut-anh input[type=file]").set_input_files(txt)
        cho_toast("Chỉ nhận ảnh")
        af3 = db_one(f"select anh_file from kho.vat_tu where ma='{MA}'")
        so_ma2 = dem_ma()
        bao("g. file văn bản bị chặn, không đổi", af3 == af2 and so_ma2 == 2, f"af3={af3} so_ma={so_ma2}")
        if not (af3 == af2 and so_ma2 == 2):
            raise AssertionError("g: file không phải ảnh vẫn lọt")

        b.close()

    # ── (h) DỌN SẠCH + đối chiếu số file ──
    don_bucket()
    sau = dem_bucket()
    af_cuoi = db_one(f"select coalesce(anh_file,'NULL') from kho.vat_tu where ma='{MA}'")
    bao("h. dọn sạch, bucket về baseline + anh_file về NULL", sau == base_count and af_cuoi == "NULL", f"sau={sau} base={base_count} anh_file={af_cuoi}")
    if sau != base_count:
        raise AssertionError(f"h: bucket lệch sau={sau} != base={base_count}")

    print()
    if loi:
        print(f"❌ FAIL {len(loi)} mục: {', '.join(loi)}"); sys.exit(1)
    print(f"✅ TẤT CẢ PASS — tải ảnh OK, không đè ảnh cũ, chặn file lạ, dọn sạch (bucket {sau}).")


if __name__ == "__main__":
    main()
