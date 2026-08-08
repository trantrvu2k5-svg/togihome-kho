# -*- coding: utf-8 -*-
# Trang GHÉP MÃ (nối kho.quy_doi). Đăng nhập ceo thật, chạm giao diện thật, gõ phím thật.
# Chạy ở 1280 + 390. Snapshot bảng quy_doi lúc đầu -> restore trước mỗi kích thước + cuối (VIỆC 7j).
#   a. số khối = số mo_ta_thiet_ke · b. 3 ô đếm khớp DB · c. chọn 1 ứng viên -> DB đúng
#   d. đổi sang ứng viên khác cùng mô tả -> cờ mặc định chuyển (cổng ràng buộc) · e. hệ số lưu + cảnh báo tính lại
#   f. Không ghép ghi chú trống -> báo yêu cầu (không lỗi thô); nhập lý do -> lưu KHONG_GHEP
#   g. 4 lọc đúng · h. không cuộn ngang 390 · i. vùng bấm >=48px, chữ >=14px · j. dọn sạch -> 96 dòng, 6 DA_DUYET
# Chạy: cd web && DEV_URL=... CEO_EMAIL=... CEO_PASS=... DB_* python3 tests/test_ghep_ma.py
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


def bao(t, ok, ct=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {t}{(' — ' + ct) if ct else ''}")
    if not ok:
        loi.append(t)


def dbjs(body):
    src = ("import pg from 'pg'; import { docConfig } from './ops/conn.mjs';"
           "const c=new pg.Client(await docConfig()); await c.connect();"
           "const q=async(s,a=[])=>(await c.query(s,a)).rows;"
           f"{body}"
           "await c.end(); process.exit(0);")
    out = subprocess.run(["node", "--input-type=module"], input=src, capture_output=True, text=True, cwd=WEB)
    if out.returncode != 0:
        print("LỖI DB:", out.stderr.strip()[:500]); sys.exit(2)
    return out.stdout.strip()


def db_json(body):
    return json.loads(dbjs(body).splitlines()[-1])


# tính 3 ô đếm kỳ vọng đúng như trang (active = dòng đầu sau sort la_mac_dinh desc, ma_kho asc; giá vốn từ v_ton_gia_von)
EXPECT_COUNTERS = """
const rows = await q(`select id,mo_ta_thiet_ke,ma_plugin,gia_plugin,ma_kho,he_so_quy_doi,la_mac_dinh,trang_thai
  from kho.quy_doi order by mo_ta_thiet_ke, la_mac_dinh desc, ma_kho asc nulls last`);
const gv = {}; for (const r of await q(`select v.ma, t.gia_von_bq from kho.ton t join kho.vat_tu v on v.id=t.vat_tu_id where t.gia_von_bq is not null`)) gv[r.ma]=Number(r.gia_von_bq);
const G={}; for (const r of rows){ (G[r.mo_ta_thiet_ke] ||= []).push(r); }
let total=0, chot=0, cbao=0;
for (const k in G){ total++; const rs=G[k];
  if (rs.some(r=>r.trang_thai==='DA_DUYET'||r.trang_thai==='KHONG_GHEP')) chot++;
  const act=rs[0]; const gp=rs[0].gia_plugin==null?null:Number(rs[0].gia_plugin);
  if (act.ma_kho && gp!=null){ const kk=gv[act.ma_kho];
    if (kk){ const eff=kk/(Number(act.he_so_quy_doi)||1); const lech=(gp-eff)/eff*100; if (Math.abs(lech)>20) cbao++; } }
}
console.log(JSON.stringify({total, chot, conlai: total-chot, cbao}));
"""


def snapshot():
    return db_json("const r=await q(`select id,ma_kho,he_so_quy_doi,muc_tin_cay,la_mac_dinh,trang_thai,ghi_chu,nguoi_duyet,duyet_luc from kho.quy_doi`); console.log(JSON.stringify(r));")


def restore(snap):
    body = ("const S=" + json.dumps(snap) + ";"
            "for (const r of S){ await c.query(`update kho.quy_doi set ma_kho=$2,he_so_quy_doi=$3,muc_tin_cay=$4,la_mac_dinh=$5,trang_thai=$6,ghi_chu=$7,nguoi_duyet=$8,duyet_luc=$9 where id=$1`,"
            "[r.id,r.ma_kho,r.he_so_quy_doi,r.muc_tin_cay,r.la_mac_dinh,r.trang_thai,r.ghi_chu,r.nguoi_duyet,r.duyet_luc]); }"
            "console.log('OK');")
    dbjs(body)


def main():
    if not PASS:
        print("THIẾU CEO_PASS — DỪNG."); sys.exit(2)
    snap = snapshot()
    try:
      with sync_playwright() as p:
        b = p.chromium.launch()
        for W in (1280, 390):
            hep = W < 820
            print(f"── {W}px ──")
            restore(snap)   # sạch trước mỗi kích thước
            pg = b.new_page(viewport={"width": W, "height": 1000})

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
                pg.wait_for_function("()=>{const e=document.querySelector('#gm-ds');return e && !/Đang tải/.test(e.textContent) && e.querySelectorAll('.khoi').length>0}", timeout=12000)

            login(); di_ghep()

            # a. số khối = số mo_ta
            n_mo_ta = int(db_json("const r=await q(`select count(distinct mo_ta_thiet_ke)::int n from kho.quy_doi`); console.log(JSON.stringify(r[0].n));"))
            n_khoi = pg.locator("#gm-ds .khoi").count()
            bao(f"a.{W} số khối = số mô tả", n_khoi == n_mo_ta, f"khối {n_khoi} · DB {n_mo_ta}")
            if n_khoi != n_mo_ta:
                raise AssertionError(f"a @{W}: {n_khoi} khối != {n_mo_ta} mô tả")

            # b. 3 ô đếm khớp DB
            exp = db_json(EXPECT_COUNTERS)
            got = {k: int(re.sub(r"\D", "", pg.inner_text("#gm-" + i) or "0"))
                   for k, i in [("chot", "chot"), ("conlai", "conlai"), ("cbao", "cbao")]}
            okb = got["chot"] == exp["chot"] and got["conlai"] == exp["conlai"] and got["cbao"] == exp["cbao"]
            bao(f"b.{W} 3 ô đếm khớp DB", okb, f"trang {got} · DB chot={exp['chot']} conlai={exp['conlai']} cbao={exp['cbao']}")
            if not okb:
                raise AssertionError(f"b @{W}: ô đếm lệch {got} vs {exp}")

            # g. lọc (trên trạng thái sạch)
            def vis():
                return pg.eval_on_selector_all("#gm-ds .khoi", "els=>els.filter(e=>e.style.display!=='none').length")
            khong_uv = int(db_json("const r=await q(`select count(*)::int n from (select mo_ta_thiet_ke from kho.quy_doi group by 1 having bool_and(ma_kho is null)) t`); console.log(JSON.stringify(r[0].n));"))
            pg.click('.gm-chip[data-f="tat_ca"]'); t_all = vis()
            pg.click('.gm-chip[data-f="chua_chot"]'); t_cc = vis()
            pg.click('.gm-chip[data-f="cbao"]'); t_cb = vis()
            pg.click('.gm-chip[data-f="khong_uv"]'); t_ku = vis()
            pg.click('.gm-chip[data-f="tat_ca"]')
            okg = t_all == exp["total"] and t_cc == exp["conlai"] and t_cb == exp["cbao"] and t_ku == khong_uv
            bao(f"g.{W} 4 lọc đúng", okg, f"all={t_all}/{exp['total']} chưa-chốt={t_cc}/{exp['conlai']} cbáo={t_cb}/{exp['cbao']} chưa-UV={t_ku}/{khong_uv}")
            if not okg:
                raise AssertionError(f"g @{W}: lọc sai")

            # h. không cuộn ngang (390)
            if hep:
                sc = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
                bao(f"h.{W} không cuộn ngang", sc <= cw, f"scrollW={sc} clientW={cw}")
                if sc > cw:
                    raise AssertionError(f"h @{W}: cuộn ngang {sc}>{cw}")

            # i. vùng bấm >=48px, chữ >=14px (trong #m-ghep)
            nho_btn = pg.evaluate("""()=>{const o=[];for(const el of document.querySelectorAll('#m-ghep button,#m-ghep .gm-chip,#m-ghep input')){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')continue;const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;if(r.height<48-0.01)o.push((el.id||el.textContent||el.className||el.tagName).trim().slice(0,20)+'='+Math.round(r.height))}return o}""")
            nho_chu = pg.evaluate("""()=>{const o=[];for(const el of document.querySelectorAll('#m-ghep *')){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')continue;let h=false;for(const nd of el.childNodes){if(nd.nodeType===3&&nd.textContent.trim()!==''){h=true;break}}if(!h)continue;const fs=parseFloat(s.fontSize);if(fs<14-0.01)o.push((el.className||el.tagName)+'='+fs.toFixed(1))}return o}""")
            bao(f"i.{W} vùng bấm>=48 & chữ>=14", len(nho_btn) == 0 and len(nho_chu) == 0, f"nút nhỏ={nho_btn[:5]} chữ nhỏ={nho_chu[:5]}")
            if nho_btn or nho_chu:
                raise AssertionError(f"i @{W}: nút<48 {nho_btn} · chữ<14 {nho_chu}")

            # ── c. chọn ứng viên BL-02 của mô tả CHUA_DUYET 'ban_le_gc_110' ──
            def chon(mo_ta, ma):
                sel = f'#gm-k-{mo_ta} .uv:has(.u-ma:text-is("{ma}")) button.nut'
                pg.click(sel)
                pg.wait_for_function(f"()=>{{const e=document.querySelector('#gm-k-{mo_ta}');return e && /ĐÃ DUYỆT/.test(e.textContent)}}", timeout=8000)
            chon('ban_le_gc_110', 'BL-02')
            dbc = db_json("const r=await q(`select ma_kho,la_mac_dinh,trang_thai from kho.quy_doi where mo_ta_thiet_ke='ban_le_gc_110' order by ma_kho`); console.log(JSON.stringify(r));")
            bl01 = next(x for x in dbc if x["ma_kho"] == "BL-01"); bl02 = next(x for x in dbc if x["ma_kho"] == "BL-02")
            okc = bl02["la_mac_dinh"] and bl02["trang_thai"] == "DA_DUYET" and (not bl01["la_mac_dinh"])
            bao(f"c.{W} chọn BL-02 -> DB đúng", okc, f"BL-02={bl02} BL-01_default={bl01['la_mac_dinh']}")
            if not okc:
                raise AssertionError(f"c @{W}: {dbc}")

            # ── d. đổi sang BL-01 (cổng ràng buộc 1-mặc-định) ──
            chon('ban_le_gc_110', 'BL-01')
            dbd = db_json("const r=await q(`select ma_kho,la_mac_dinh,trang_thai from kho.quy_doi where mo_ta_thiet_ke='ban_le_gc_110' order by ma_kho`); console.log(JSON.stringify(r));")
            e01 = next(x for x in dbd if x["ma_kho"] == "BL-01"); e02 = next(x for x in dbd if x["ma_kho"] == "BL-02")
            n_def = sum(1 for x in dbd if x["la_mac_dinh"])
            okd = e01["la_mac_dinh"] and e01["trang_thai"] == "DA_DUYET" and (not e02["la_mac_dinh"]) and n_def == 1
            bao(f"d.{W} đổi mặc định BL-02->BL-01 (đúng 1 mặc định)", okd, f"BL-01={e01} BL-02_default={e02['la_mac_dinh']} #default={n_def}")
            if not okd:
                raise AssertionError(f"d @{W}: {dbd}")

            # ── e. hệ số quy đổi -> lưu + cảnh báo tính lại ──
            cb_truoc = pg.inner_text("#gm-k-minifix_cam_cu .gm-cbao-slot")
            hs = pg.locator('#gm-k-minifix_cam_cu [data-hs]')
            hs.click(); pg.keyboard.press("Meta+A"); pg.keyboard.press("Delete"); hs.type("10"); pg.keyboard.press("Tab")
            pg.wait_for_timeout(600)
            hs_db = float(db_json("const r=await q(`select he_so_quy_doi h from kho.quy_doi where mo_ta_thiet_ke='minifix_cam_cu' and la_mac_dinh`); console.log(JSON.stringify(Number(r[0].h)));"))
            cb_sau = pg.inner_text("#gm-k-minifix_cam_cu .gm-cbao-slot")
            oke = abs(hs_db - 10) < 1e-9 and cb_truoc != cb_sau and cb_sau.strip() != ""
            bao(f"e.{W} hệ số lưu (={hs_db}) + cảnh báo tính lại", oke, f"DB he_so={hs_db} · cảnh báo đổi={cb_truoc!=cb_sau}")
            if not oke:
                raise AssertionError(f"e @{W}: he_so={hs_db} cb_truoc={cb_truoc!r} cb_sau={cb_sau!r}")

            # ── f. Không ghép: ghi chú trống -> báo yêu cầu; nhập lý do -> lưu KHONG_GHEP ──
            # xoá ô ghi chú (kích hoạt 'change' -> lưu). Đợi toast lưu-ghi-chú xong để nó KHÔNG đè toast sau.
            pg.fill('#gm-k-chot_do_dot_d5 [data-ghi]', "")
            try:
                pg.wait_for_function("()=>{const e=document.querySelector('#toast');return e&&/Đã lưu ghi chú/.test(e.textContent)}", timeout=3000)
            except Exception:
                pass
            pg.click('#gm-k-chot_do_dot_d5 .nut.bo')
            pg.wait_for_function("()=>{const e=document.querySelector('#toast');return e&&/lý do/i.test(e.textContent)}", timeout=5000)
            toast = pg.inner_text("#toast") if pg.locator("#toast").count() else ""
            tt_sau = db_json("const r=await q(`select trang_thai from kho.quy_doi where mo_ta_thiet_ke='chot_do_dot_d5'`); console.log(JSON.stringify(r[0].trang_thai));")
            okf1 = ("lý do" in toast.lower() or "LÝ DO" in toast) and tt_sau != "KHONG_GHEP"
            bao(f"f.{W} ghi chú trống -> báo yêu cầu (không lỗi thô)", okf1, f"toast={toast!r} tt={tt_sau}")
            if not okf1:
                raise AssertionError(f"f1 @{W}: toast={toast!r} tt={tt_sau}")
            pg.fill('#gm-k-chot_do_dot_d5 [data-ghi]', "Kho chưa nhập — CEO xác nhận không ghép")
            pg.click('#gm-k-chot_do_dot_d5 .nut.bo')
            pg.wait_for_function("()=>{const e=document.querySelector('#gm-k-chot_do_dot_d5');return e && /KHÔNG GHÉP/.test(e.textContent)}", timeout=8000)
            tt2 = db_json("const r=await q(`select trang_thai,ghi_chu,ma_kho from kho.quy_doi where mo_ta_thiet_ke='chot_do_dot_d5'`); console.log(JSON.stringify(r[0]));")
            okf2 = tt2["trang_thai"] == "KHONG_GHEP" and tt2["ma_kho"] is None and tt2["ghi_chu"]
            bao(f"f.{W} nhập lý do -> lưu KHONG_GHEP", okf2, f"{tt2}")
            if not okf2:
                raise AssertionError(f"f2 @{W}: {tt2}")

            pg.close()
        b.close()
    finally:
        restore(snap)   # LUÔN dọn sạch dù test lỗi giữa chừng (không để lại rác cho lần sau)

    # ── j. DỌN SẠCH + đối chiếu (đã restore ở finally) ──
    fin = db_json("const r=await q(`select (select count(*)::int from kho.quy_doi) n,(select count(*)::int from kho.quy_doi where trang_thai='DA_DUYET') d`); console.log(JSON.stringify(r[0]));")
    okj = fin["n"] == 96 and fin["d"] == 6
    bao(f"j. dọn sạch: {fin['n']} dòng · {fin['d']} DA_DUYET", okj, "cần 96 · 6")
    if not okj:
        raise AssertionError(f"j: quy_doi lệch {fin} (cần 96/6)")

    print("\n" + ("✅ TẤT CẢ PASS" if not loi else "❌ FAIL: " + ", ".join(loi)))
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
