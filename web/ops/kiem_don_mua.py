#!/usr/bin/env python3
# WP-20 bước 3+5 — kiểm mắt prod màn Đơn mua (app Kho) bằng Playwright, dùng CÙNG profile robot.
#   Không đăng nhập tay: phiên phải sẵn trong ~/.togihome-demo-profile. Chưa có → DỪNG (in hướng dẫn).
#   Lỗi HARNESS in [harness]; lỗi APP in [app]. 3 ảnh vào ~/Downloads/wp20/.
import os, sys, time, json, pathlib, subprocess
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

URL = "https://togihome-kho.pages.dev/"
PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
OUT = pathlib.Path.home() / "Downloads" / "wp20"; OUT.mkdir(parents=True, exist_ok=True)
R = {"pass": 0, "fail": 0}; SO_DON = {"v": None}
def ok(n, v, note=""): print(("✅" if v else "❌") + " " + n + (("  — " + note) if note and not v else "")); R["pass" if v else "fail"] += 1
def shot(pg, name): f = OUT / name; pg.screenshot(path=str(f)); print("  📸", f.name)

def main(pw):
    ctx = pw.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True, viewport={"width": 1440, "height": 960})
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text[:140]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:140]))

    # 1 · đăng nhập sẵn?
    pg.goto(URL, wait_until="domcontentloaded"); time.sleep(6)
    authed = pg.evaluate("() => Object.keys(localStorage).some(k=>/sb-|supabase/i.test(k)) && !!document.querySelector('#nav-dm')")
    if not authed:
        print("⛔ [harness] Profile robot CHƯA có phiên app Kho — DỪNG (luật cấm tự đăng nhập).")
        print("   CEO seed phiên: chạy  python3 ops/wp20_login.py  (cửa sổ Chrome mở → CEO đăng nhập → Resume).")
        ctx.close(); return
    ok("1 · đã đăng nhập (nav Đơn mua hiện)", pg.locator('#nav-dm').is_visible())

    # 2 · sidebar Đơn mua trên Phiếu nhập
    order = pg.evaluate("""() => { const b=[...document.querySelectorAll('nav button[data-m]')].map(x=>x.dataset.m);
        return {dm: b.indexOf('dm'), nhap: b.indexOf('nhap')}; }""")
    ok("2 · 'Đơn mua' TRÊN 'Phiếu nhập kho'", order["dm"] >= 0 and order["dm"] < order["nhap"], json.dumps(order))
    pg.locator('#nav-dm').click(); time.sleep(1.5)

    # 3 · form mới
    pg.locator('#dm-moi-btn').click(); time.sleep(1.5)
    # NCC: chọn Gỗ Tản Viên nếu có
    ncc_sel = pg.locator('#dm-f-ncc2')
    ncc_opts = ncc_sel.evaluate("el => [...el.options].map(o=>o.textContent)")
    tv = next((o for o in ncc_opts if "Tản Viên" in o), None)
    if tv: ncc_sel.select_option(label=tv); print("  NCC:", tv)
    else: ncc_sel.select_option(index=0); print("  NCC (Tản Viên không có → đầu list):", ncc_opts[0] if ncc_opts else "?")
    can = pg.evaluate("() => { const d=new Date(Date.now()+7*864e5); return d.toISOString().slice(0,10); }")
    pg.fill('#dm-f-can', can); pg.fill('#dm-f-gc', "WP-20 kiểm mắt")
    # 2 dòng vật tư: GÕ TÌM → chọn gợi ý đầu, SL 10/5 (ô vật tư nay là input gõ tìm, không phải select)
    def set_dong(i, query, sl, shot_goi=False):
        inp = pg.locator(f'.d-vt[data-i="{i}"]'); inp.click(); inp.fill(''); inp.press_sequentially(query, delay=55); time.sleep(1)
        goi = pg.locator(f'.dm-goi[data-i="{i}"] .dm-goi-item')
        goi.first.wait_for(timeout=6000)
        if shot_goi: shot(pg, "wp20_form_moi_v2.png")   # ĐANG GÕ TÌM, có gợi ý
        goi.first.click(); time.sleep(0.6)              # onmousedown chọn → focus SL
        pg.locator(f'.d-sl[data-i="{i}"]').fill(str(sl))
    set_dong(0, "gỗ", 10, shot_goi=True)
    pg.locator('#dm-them-dong').click(); time.sleep(0.5); set_dong(1, "bản", 5); time.sleep(1)
    dvt0 = pg.locator('.d-dvt[data-i="0"]').inner_text()
    dg0 = pg.locator('.d-dg[data-i="0"]').input_value()
    tam = pg.locator('#dm-tam').inner_text()
    ok("3 · ĐVT tự điền + đơn giá gợi ý", dvt0.strip() != "" and dg0.strip() != "", f"dvt='{dvt0}' dongia='{dg0}'")
    print(f"  dòng1 ĐVT='{dvt0}' đơn giá gợi ý='{dg0}' · tạm tính='{tam}'")
    shot(pg, "wp20_form_dong.png")   # 2 dòng đã chọn: ĐVT + giá + tạm tính

    # 4 · lưu
    pg.locator('#dm-luu').click()   # → dm_tao (RPC) → dmXem chi tiết (RPC) — async qua remote, phải CHỜ h3
    try: pg.locator('#dm-ct h3').wait_for(state="visible", timeout=15000)
    except PWTimeout: pass
    time.sleep(0.6)
    so = pg.evaluate("() => { const h=document.querySelector('#dm-ct h3'); return h?h.textContent.trim():null; }")
    SO_DON["v"] = so
    ok("4 · tạo đơn → số DM-2026-NNNN", bool(so) and so.startswith("DM-2026-"), f"so_don={so}")
    print("  ➜ SỐ ĐƠN:", so)

    # 5 · chi tiết: bước 1 xanh, nút đúng
    time.sleep(1)
    steps_done = pg.locator('#dm-ct .dm-step.done').count()
    btns = pg.evaluate("""() => [...document.querySelectorAll('#dm-ct .dm-gate button')].map(b=>({t:b.textContent.trim(), mo:b.classList.contains('mo')||b.disabled}))""")
    sang = [b["t"] for b in btns if not b["mo"]]
    ok("5 · bước 1 xanh + nút Sửa/Gửi/Huỷ sáng", steps_done >= 1 and any("Sửa" in s for s in sang) and any("Gửi" in s for s in sang) and any("Huỷ" in s for s in sang), json.dumps(sang, ensure_ascii=False))
    shot(pg, "wp20_chi_tiet.png")

    # 6 · sửa dòng: SL dòng 2 → 6
    pg.get_by_role("button", name="Sửa dòng").click(); time.sleep(1.5)
    pg.locator('.d-sl[data-i="1"]').fill("6")
    pg.locator('#dm-luu-sua').click(); time.sleep(2)
    sl2 = pg.evaluate("() => { const rows=[...document.querySelectorAll('#dm-ct tbody tr')]; return rows[1]?rows[1].children[3].textContent.trim():null; }")
    ok("6 · sửa SL dòng 2 = 6", (sl2 or "").replace(".", "").replace(",", "") == "6", f"sl2={sl2}")

    # 7 · Gửi NCC
    pg.get_by_role("button", name="Gửi NCC").click(); time.sleep(2)
    tt7 = pg.evaluate("() => { const c=document.querySelector('#dm-ct .dm-tt'); return c?c.textContent.trim():null; }")
    ok("7 · Gửi NCC → chip 'Đã gửi'", (tt7 or "") == "Đã gửi", f"chip={tt7}")

    # 8 · NCC xác nhận (prompt ngày cần+3)
    can3 = pg.evaluate("() => { const d=new Date(Date.now()+10*864e5); return d.toISOString().slice(0,10); }")
    pg.once("dialog", lambda d: d.accept(can3))
    pg.get_by_role("button", name="NCC xác nhận").click(); time.sleep(2)
    tt8 = pg.evaluate("() => { const c=document.querySelector('#dm-ct .dm-tt'); return c?c.textContent.trim():null; }")
    late = pg.locator('#dm-ct .dm-late').count()
    ok("8 · xác nhận → chip 'NCC xác nhận' + hẹn trễ tô cảnh báo", (tt8 or "") == "NCC xác nhận" and late >= 1, f"chip={tt8} late={late}")

    # 9 · 'Đã nhận' sáng (KHÔNG bấm); Huỷ trống lý do → lỗi, không huỷ
    btns9 = pg.evaluate("""() => [...document.querySelectorAll('#dm-ct .dm-gate button')].map(b=>({t:b.textContent.trim(), mo:b.classList.contains('mo')||b.disabled}))""")
    danhan = next((b for b in btns9 if "Đã nhận" in b["t"]), None)
    ok("9 · nút 'Đã nhận (tạm — WP-21)' SÁNG (ceo), không bấm", danhan is not None and not danhan["mo"], json.dumps(btns9, ensure_ascii=False))
    pg.once("dialog", lambda d: d.accept(""))   # huỷ modal, để trống lý do
    pg.get_by_role("button", name="Huỷ đơn").click(); time.sleep(1.5)
    err9 = pg.locator('#dm-ct-err').inner_text()
    tt9 = pg.evaluate("() => { const c=document.querySelector('#dm-ct .dm-tt'); return c?c.textContent.trim():null; }")
    ok("9 · huỷ trống lý do → app báo lỗi, đơn KHÔNG huỷ", "lý do" in err9.lower() and tt9 == "NCC xác nhận", f"err='{err9}' chip={tt9}")

    # 10 · lọc + tìm + đếm + console
    pg.locator('#nav-dm').click(); time.sleep(1)
    pg.locator('#dm-chips .dm-chip[data-tt="xac_nhan"]').click(); time.sleep(1.5)
    thay_loc = pg.evaluate("(s) => [...document.querySelectorAll('#dm-ds tr[data-id] td b')].some(b=>b.textContent.trim()===s)", so)
    pg.fill('#dm-f-tim', so); time.sleep(1)
    thay_tim = pg.evaluate("(s) => [...document.querySelectorAll('#dm-ds tr[data-id] td b')].some(b=>b.textContent.trim()===s)", so)
    dem = pg.locator('#dm-dem').inner_text()
    ok("10 · lọc 'NCC xác nhận' + tìm số đơn đều thấy · đếm đang mở≥1", thay_loc and thay_tim and "đang mở" in dem, dem)
    ok("10 · console không lỗi JS", len(errs) == 0, "; ".join(errs[:3]))
    shot(pg, "wp20_danh_sach.png")

    print(f"\n⏱  robot: {R['pass']} pass / {R['fail']} fail · số đơn = {SO_DON['v']}")
    ctx.close()

if __name__ == "__main__":
    with sync_playwright() as pw: main(pw)
    # 11 · đối chiếu DB
    if SO_DON["v"]:
        print("\n── 11 · đối chiếu DB ──")
        r = subprocess.run(["node", str(pathlib.Path(__file__).with_name("kiem_don_mua_db.mjs")), SO_DON["v"]],
                           cwd=str(pathlib.Path(__file__).resolve().parents[1]), capture_output=True, text=True, timeout=60)
        print(r.stdout); print(r.stderr[:300] if r.stderr else "", end="")
    print(f"\n{'🟢 WP-20 robot XONG' if R['fail']==0 else '🔴 có bước ĐỎ'} — ảnh trong {OUT}")
