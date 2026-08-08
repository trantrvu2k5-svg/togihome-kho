# -*- coding: utf-8 -*-
# DANH SÁCH PHIẾU ĐÃ LẬP + NÚT HUỶ PHIẾU — nối app thật, đăng nhập ceo thật, chạy ở 390px và 1280px.
# MỌI MỐC ĐỌC TỪ CSDL LÚC CHẠY — không viết cứng. Test TỰ TẠO phiếu thử rồi thao tác trên chính nó.
#   Chuẩn bị: chụp baseline (phiếu·vật tư·tổng tồn) + tự tạo mã THU-NGHIEM- + phiếu nhập QUA GIAO DIỆN, ghi sổ.
#   a. số dòng danh sách nhập == số phiếu NK/HN thật từ DB (bằng 0 -> RAISE "DANH SÁCH TRỐNG")
#   b. mở phiếu THỬ (theo MÃ, không theo vị trí) -> panel: số dòng + tổng SL đúng với DB
#   c. panel phiếu thử ghi_so có nút Huỷ phiếu
#   d. lý do rỗng -> nút Xác nhận KHÔNG bấm được; gõ bật, xoá khoá lại
#   e. HUỶ THẬT phiếu thử QUA GIAO DIỆN -> phiếu ngược HN, phiếu gốc ĐÃ HUỶ, tồn mã thử về 0
#   f. DỌN SẠCH -> mọi mốc == baseline đã chụp lúc đầu (lệch -> RAISE)
#   g. (390px) không cuộn ngang trên hai trang phiếu
#   h. (390px) vùng bấm được TRONG danh sách phiếu + panel ≥44px
# GHI CHÚ PHẠM VI h: chỉ soi phần tử lô này THÊM (#ds-* + #the) — form phiếu-nháp có sẵn dùng input
#   nhỏ hơn 44px (ngoài phạm vi, test bố cục điện thoại có sẵn cũng không soi cỡ ở đó).
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... DB_* python3 tests/test_ds_phieu.py
import os
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DEV_URL", "http://localhost:5180/")
EMAIL = os.environ.get("CEO_EMAIL", "ceo@togihome.local")
PASS = os.environ.get("CEO_PASS", "")
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loi = []


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def _node(src):
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB_DIR)
    if out.returncode != 0:
        print("LỖI DB:", out.stderr.strip()[:500]); sys.exit(2)
    return out.stdout.strip()


def db_one(sql):
    return _node("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
                 "const c=new pg.Client(await docConfig()); await c.connect();"
                 f"const r=await c.query(`{sql}`); console.log(r.rows[0]?String(Object.values(r.rows[0])[0]):''); "
                 "await c.end(); process.exit(0);").splitlines()[-1] if True else ""


def db_exec(sql):
    _node("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
          "const c=new pg.Client(await docConfig()); await c.connect();"
          f"await c.query(`{sql}`); console.log('OK'); await c.end(); process.exit(0);")


def don_thu_nghiem():
    # xoá mọi rác THU-NGHIEM-DSPH-* còn sót từ lần chạy trước (đúng thứ tự FK)
    db_exec(
        "do $$ declare v uuid; begin "
        "for v in select id from kho.vat_tu where ma like 'THU-NGHIEM-DSPH-%' loop "
        "  delete from kho.giao_dich where vat_tu_id=v; "
        "  delete from kho.lo_nhap where vat_tu_id=v; "
        "  delete from kho.phieu where id in (select phieu_id from kho.phieu_dong where vat_tu_id=v); "
        "  delete from kho.ton where vat_tu_id=v; "
        "  delete from kho.vat_tu where id=v; "
        "end loop; end $$;")


def moc():
    ph = db_one("select count(*)::int from kho.phieu")
    vt = db_one("select count(*)::int from kho.vat_tu")
    gt = db_one("select round(sum(so_luong*gia_von_bq)) from kho.ton")
    return ph, vt, gt


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    don_thu_nghiem()   # sạch trước khi bắt đầu
    n_ma = db_one("select count(*)::int from kho.vat_tu")   # số mã đọc DB (thay số cứng)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for W in (390, 1280):
            hep = W < 820
            print(f"── {W}px ──")
            pg = b.new_page(viewport={"width": W, "height": 900})

            def login():
                pg.goto(URL, wait_until="networkidle")
                pg.fill("#lg-email", EMAIL); pg.fill("#lg-pass", PASS); pg.click("#lg-btn")
                pg.wait_for_selector("#login", state="hidden", timeout=15000)
                pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='" + n_ma + "'}", timeout=12000)

            def di_toi(m):
                if hep:
                    pg.click(".mb-menu"); pg.wait_for_selector("nav.mo", timeout=4000)
                pg.click(f'nav button[data-m="{m}"]'); pg.wait_for_selector(f"#m-{m}.on", timeout=8000)
                if hep:
                    pg.wait_for_selector("nav:not(.mo)", timeout=4000)
                pg.wait_for_timeout(250)

            login()
            base = moc()   # chụp mốc THẬT lúc đầu (phiếu, vật tư, tổng tồn) -> so lại sau khi dọn. KHÔNG số cứng.

            # ── VIỆC 2: tự tạo mã + phiếu nhập thử (CẤM mượn phiếu có sẵn) ──
            ma = f"THU-NGHIEM-DSPH-{W}-{os.getpid()}"
            db_exec(f"insert into kho.vat_tu(ma,ten,loai) values('{ma}','Thử DS phiếu {W}','pk'); "
                    f"insert into kho.ton(vat_tu_id,kho_id,so_luong) select v.id,k.id,0 from kho.vat_tu v, kho.kho k where v.ma='{ma}' and k.la_mac_dinh;")
            vid = db_one(f"select id from kho.vat_tu where ma='{ma}'")
            pg.reload(wait_until="networkidle")   # nạp lại KHO để dropdown có mã thử (phiên còn hạn -> tự vào)
            n_ma_after = str(int(base[1]) + 1)    # số mã sau khi chèn = baseline + 1 (đọc DB, không số cứng)
            pg.wait_for_function("()=>{const e=document.querySelector('#k-ma');return e&&e.textContent.replace(/\\D/g,'')==='" + n_ma_after + "'}", timeout=12000)
            di_toi("nhap")
            pg.wait_for_function("()=>{const e=document.querySelector('#ds-nhap');return e && !/Đang tải/.test(e.textContent)}", timeout=10000)
            truoc = pg.locator("#ds-nhap .dsp-row").count()   # số dòng danh sách TRƯỚC khi ghi sổ (đọc màn hình)
            # lập phiếu nhập thử: chọn mã thử, SL 5, đơn giá 1000, Ghi sổ
            pg.wait_for_selector("#ph-nhap tbody tr", timeout=8000)
            r0 = pg.locator("#ph-nhap tbody tr").first
            r0.locator("select").select_option(value=ma)
            r0.locator('input[type="number"]').fill("5")
            gia = r0.locator('input:not([type="number"])')
            gia.click(); pg.keyboard.press("Meta+A"); pg.keyboard.press("Delete"); gia.type("1000"); gia.blur()
            pg.once("dialog", lambda d: d.dismiss())
            pg.locator("#ph-nhap button.chinh:has-text('Ghi sổ')").click()
            pg.wait_for_function("()=>document.querySelectorAll('#ds-nhap .dsp-row').length===" + str(truoc + 1), timeout=10000)
            so_nk = db_one(f"select so_phieu from kho.phieu p where exists(select 1 from kho.phieu_dong d where d.phieu_id=p.id and d.vat_tu_id='{vid}') and p.loai='nhap' order by p.tao_luc desc limit 1")

            # mở phiếu THEO MÃ (không theo vị trí dòng)
            def mo_phieu(so):
                row = f'#ds-nhap .dsp-row:has(.dsp-so:text-is("{so}"))'
                pg.wait_for_selector(row, timeout=8000)
                pg.locator(row).click()
                pg.wait_for_selector("#the.on #xem-dong", timeout=8000)

            # a. số dòng danh sách nhập == số phiếu THẬT (NK/HN) đọc từ DB
            na = pg.locator("#ds-nhap .dsp-row").count()
            db_ph = int(db_one("select count(*)::int from kho.phieu where so_phieu like 'NK-%' or so_phieu like 'HN-%'"))
            bao(f"a.{W} danh sách nhập = {db_ph} phiếu (DB)", na == db_ph, f"màn hình {na} · DB {db_ph}")
            if na == 0:
                raise AssertionError("DANH SÁCH TRỐNG")
            if na != db_ph:
                raise AssertionError(f"a: danh sách {na} != DB {db_ph}")

            # b. mở phiếu THỬ -> panel, số dòng + tổng SL đúng DB
            mo_phieu(so_nk)
            n_dong = pg.locator("#xem-dong tbody tr").count()
            sl_panel = sum(int(re.sub(r"\D", "", c) or 0)
                           for c in pg.locator("#xem-dong tbody tr td:nth-child(3)").all_text_contents())
            db_dong = int(db_one(f"select count(*)::int from kho.phieu_dong d join kho.phieu p on p.id=d.phieu_id where p.so_phieu='{so_nk}'"))
            db_sl = int(float(db_one(f"select coalesce(sum(d.so_luong),0) from kho.phieu_dong d join kho.phieu p on p.id=d.phieu_id where p.so_phieu='{so_nk}'")))
            bao(f"b.{W} panel {so_nk} số dòng+SL đúng DB", n_dong == db_dong and sl_panel == db_sl, f"panel dòng={n_dong} SL={sl_panel} · DB dòng={db_dong} SL={db_sl}")
            if not (n_dong == db_dong and sl_panel == db_sl):
                raise AssertionError(f"b: panel {so_nk} lệch DB (dòng {n_dong}/{db_dong}, SL {sl_panel}/{db_sl})")

            # c. phiếu thử ghi_so có nút Huỷ
            co_huy = pg.locator("#the.on #xem-huy").count() == 1
            bao(f"c.{W} phiếu ghi_so có nút Huỷ", co_huy)
            if not co_huy:
                raise AssertionError("c: không có nút Huỷ phiếu")

            # d. lý do rỗng -> Xác nhận khoá; gõ bật, xoá khoá lại (chưa huỷ)
            pg.click("#xem-huy"); pg.wait_for_selector("#huy-ok", timeout=6000)
            dis = pg.locator("#huy-ok").is_disabled()
            bao(f"d.{W} lý do rỗng -> Xác nhận khoá", dis)
            if not dis:
                raise AssertionError("d: nút Xác nhận bấm được khi lý do rỗng")
            pg.fill("#huy-lydo", "abc"); b1 = pg.locator("#huy-ok").is_disabled()
            pg.fill("#huy-lydo", ""); b2 = pg.locator("#huy-ok").is_disabled()
            bao(f"d2.{W} nhập lý do bật nút, xoá lại khoá", (not b1) and b2)
            if not ((not b1) and b2):
                raise AssertionError("d2: nút bật/khoá theo lý do sai")
            pg.locator("#the.on button:has-text('Không huỷ')").click()
            pg.wait_for_selector("#xem-dong", timeout=6000)

            # e. HUỶ THẬT phiếu thử (theo mã) -> HN + gốc ĐÃ HUỶ + tồn 0
            pg.click("#xem-huy"); pg.wait_for_selector("#huy-ok", timeout=6000)
            pg.fill("#huy-lydo", "Test tự động — huỷ phiếu thử")
            pg.click("#huy-ok")
            pg.wait_for_function("()=>{const h=document.querySelector('#the.on .the-dau h3');return h && /ĐÃ HUỶ/.test(h.textContent)}", timeout=10000)
            goc_huy = db_one(f"select trang_thai from kho.phieu where so_phieu='{so_nk}'") == "da_huy"
            so_hn = db_one(f"select so_phieu from kho.phieu where phieu_goc_id=(select id from kho.phieu where so_phieu='{so_nk}')")
            ton0 = int(float(db_one(f"select so_luong from kho.ton where vat_tu_id='{vid}'")))
            co_hn_dom = pg.evaluate("()=>[...document.querySelectorAll('#ds-nhap .dsp-so')].some(e=>/^HN-/.test(e.textContent))")
            ok_e = so_hn.startswith("HN-") and goc_huy and ton0 == 0 and co_hn_dom
            bao(f"e.{W} huỷ thật: HN + gốc ĐÃ HUỶ + tồn 0", ok_e, f"HN={so_hn} gốc_huỷ={goc_huy} tồn={ton0} HN_trên_ds={co_hn_dom}")
            if not ok_e:
                raise AssertionError(f"e: luồng huỷ sai (HN={so_hn}, gốc_huỷ={goc_huy}, tồn={ton0}, HN_ds={co_hn_dom})")
            pg.keyboard.press("Escape"); pg.wait_for_selector("#the.on", state="hidden", timeout=5000)

            # ── f. DỌN SẠCH + so mốc với BASELINE đã chụp lúc đầu (không số cứng) ──
            db_exec(
                f"delete from kho.giao_dich where vat_tu_id='{vid}'; "
                f"delete from kho.lo_nhap where vat_tu_id='{vid}'; "
                f"delete from kho.phieu where id in (select phieu_id from kho.phieu_dong where vat_tu_id='{vid}'); "
                f"delete from kho.ton where vat_tu_id='{vid}'; "
                f"delete from kho.vat_tu where id='{vid}';")
            gio = moc()
            ok_f = gio == base
            bao(f"f.{W} dọn sạch: mốc == baseline (phiếu·vật tư·tồn) {base}", ok_f, f"giờ={gio} baseline={base}")
            if not ok_f:
                raise AssertionError(f"f: SAU DỌN lệch baseline — giờ={gio} != {base}")

            if hep:
                # g. không cuộn ngang trên 2 trang phiếu
                for m in ("nhap", "xuat"):
                    di_toi(m)
                    pg.wait_for_function(f"()=>{{const e=document.querySelector('#ds-{m}');return e && !/Đang tải/.test(e.textContent)}}", timeout=8000)
                    sc = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
                    bao(f"g.{W} {m} không cuộn ngang", sc <= cw, f"scrollW={sc} clientW={cw}")
                    if sc > cw:
                        raise AssertionError(f"g: {m} @{W}px cuộn ngang ({sc}>{cw})")
                # h. vùng bấm trong danh sách phiếu + panel ≥44px
                di_toi("nhap")
                pg.wait_for_selector("#ds-nhap .dsp-row", timeout=8000)
                pg.locator("#ds-nhap .dsp-row").first.click()
                pg.wait_for_selector("#the.on #xem-dong", timeout=6000)
                nho = pg.evaluate("""() => {
                  const out=[]; const areas=[document.querySelector('#ds-nhap'), document.querySelector('#the')];
                  for(const root of areas){ if(!root) continue;
                    for(const el of root.querySelectorAll('button, a, input, [onclick]')){
                      const s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden') continue;
                      const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
                      if(r.height<44) out.push((el.id||el.textContent||el.className||el.tagName).trim().slice(0,20)+'='+Math.round(r.height));
                    }} return out; }""")
                bao(f"h.{W} vùng bấm (ds+panel) ≥44px", len(nho) == 0, ', '.join(nho[:8]))
                if nho:
                    raise AssertionError(f"h: nút nhỏ @{W}: {nho}")
                pg.keyboard.press("Escape")

            pg.close()
        b.close()
    don_thu_nghiem()   # chốt: không để rác
    print(f"\n{'✅ TẤT CẢ PASS' if not loi else '❌ FAIL: ' + ', '.join(loi)}")
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
