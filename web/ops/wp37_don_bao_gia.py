#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# ROBOT WP-37 (prod) — Sale tạo ĐƠN BÁO GIÁ demo qua MÀN THẬT (KHÔNG INSERT tắt).
#
# MỤC ĐÍCH: dựng 1 đơn trang_thai='bao_gia' (la_demo auto) để CEO mở SketchUp →
#   chọn đơn → dựng hình → đẩy BOM + giá vốn ở MỐC DỰ KIẾN (WP-37 tầng 2b/2c).
#
# LUẬT: mọi thao tác tạo đơn đi qua UI Sale thật (click + gõ), KHÔNG gọi INSERT/RPC
#   tạo đơn tắt. Verify (đọc) dùng conn.mjs (owner) cho khỏi vướng RLS.
#   DEMO — số của đơn này là [TẠM], CẤM dùng làm năng lực thật (WP-02a). Nghiệm thu
#   xong xoá bằng sb.rpc('xoa_demo', {p_ma_don}).
#
# CHẠY:  cd web && python3 ops/wp37_don_bao_gia.py
# CẦN:   web/ops/.env.robot (TEST_SALE_EMAIL / TEST_SALE_PASS) · playwright chromium · node+conn.mjs
#
# B2: chạy 1 vòng; TÁCH lỗi harness (selector/timeout của robot) vs lỗi app (banner
#   "Còn thiếu" / trang_thai sai). KẸT 2 lần LIÊN TIẾP → DỪNG (06 §1c).
# ─────────────────────────────────────────────────────────────────────────────
import os, sys, time, json, pathlib, subprocess, datetime

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    print("⛔ [harness] Thiếu Playwright. Cài: pip install --user playwright && python3 -m playwright install chromium")
    sys.exit(2)

OPS = pathlib.Path(__file__).resolve().parent
URL = "https://togihome-sale.pages.dev"
NGAY = datetime.date.today().isoformat()          # KHÔNG có Date.now trong tay CEO — mốc từ máy chạy robot
# [L-123] ma_don do APP SALE (client) TỰ CẤP dải "T<tháng>-<seq>" (padStart 3) — form KHÔNG có ô mã để
#   người/robot sửa. Vậy tiền tố "DEMO-" của WP-02a KHÔNG áp được vào ma_don qua UI. Nhận diện + dọn đơn
#   demo đi bằng CỜ la_demo (auto theo ten_khach DEMO*) + xoa_demo(p_ma_don) — GIỐNG demo_phong_hop.py.
#   ĐỪNG "vá" mã thành DEMO-: đó là đổi cơ chế cấp số, ngoài phạm vi WP-37 (xem PHÁT SINH L-123).
TEN_KHACH = f"DEMO-BG-{NGAY}"                      # ten_khach DEMO* → la_demo auto (trigger db/122)
SDT = "0937" + NGAY.replace("-", "")[2:]           # sđt mới → khách MỚI (né dedupe QD-34 thêm ô cọc)
MON = [("Tủ áo 4 cánh", "12000000"),   # (tên đọc được, giá bán > 0)
       ("Kệ tivi",       "6500000")]
PH_TEN = 'input[placeholder="Tủ áo 3 cánh…"]'   # ô tên món (form báo giá db/092)
PH_GIA = 'input[placeholder="để trống được"]'   # ô đơn giá (báo giá cho để trống — ta điền > 0)

def nap_env():
    p = OPS / ".env.robot"
    if not p.exists():
        print("⛔ [harness] Thiếu web/ops/.env.robot (TEST_SALE_EMAIL/PASS)."); sys.exit(2)
    for ln in p.read_text().splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
nap_env()
EMAIL, PASS = os.environ.get("TEST_SALE_EMAIL", ""), os.environ.get("TEST_SALE_PASS", "")
if not EMAIL or not PASS:
    print("⛔ [harness] .env.robot thiếu TEST_SALE_EMAIL / TEST_SALE_PASS."); sys.exit(2)

STUCK = {"lien_tiep": 0}
def het_kien_nhan():
    STUCK["lien_tiep"] += 1
    if STUCK["lien_tiep"] >= 2:
        print("⛔ [harness] KẸT 2 lần LIÊN TIẾP → DỪNG (06 §1c)."); return True
    return False
def qua_buoc():
    STUCK["lien_tiep"] = 0

def sql(q, args=None):
    """Đọc DB bằng owner (conn.mjs) — verify không vướng RLS. KHÔNG ghi."""
    payload = {"q": q, "args": args or []}
    js = ("import pg from 'pg'; import {docConfig} from './conn.mjs';"
          "const {q,args}=JSON.parse(process.argv[1]);"
          "const c=new pg.Client(await docConfig()); await c.connect();"
          "const r=await c.query(q,args); console.log(JSON.stringify(r.rows)); await c.end();")
    r = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(payload)],
                       cwd=str(OPS), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("sql lỗi: " + (r.stderr or r.stdout)[:200])
    return json.loads((r.stdout.strip() or "[]").splitlines()[-1])

def dump_form(pg):
    return pg.evaluate("""() => {
        const root = document.querySelector('.ovl, .mdl') || document.body;
        const inp = [...root.querySelectorAll('input,textarea')].map(e =>
            (e.tagName.toLowerCase())+'[ph="'+(e.getAttribute('placeholder')||'')+'" im="'+(e.getAttribute('inputmode')||'')+'"]');
        const sel = [...root.querySelectorAll('select')].map(e => 'select(val="'+(e.value||'')+'")');
        const btn = [...root.querySelectorAll('button')].map(e => (e.textContent||'').trim().slice(0,18)).filter(Boolean);
        return {inp, sel, btn};
    }""")

def main(pw):
    br = pw.chromium.launch(headless=True)
    pg = br.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("dialog", lambda d: (errs.append("dialog:" + d.message[:80]), d.accept()))

    # ── LOGIN test_sale ─────────────────────────────────────────────
    pg.goto(URL, wait_until="networkidle")
    pg.fill("#e", EMAIL); pg.fill("#p", PASS); pg.click("#b")
    try:
        pg.wait_for_selector("text=Sổ đơn hàng", timeout=20000)
    except PWTimeout:
        er = pg.locator("#er").inner_text().strip() if pg.locator("#er").count() else ""
        print(f"⛔ [app] Đăng nhập sale thất bại: {er or '(không banner)'}"); br.close(); return
    print(f"✔ Đăng nhập test_sale ({EMAIL}) OK · ngày {NGAY}")
    qua_buoc()

    # ── MỞ form BÁO GIÁ (nút '+ Báo giá mới') ───────────────────────
    try:
        pg.get_by_role("button", name="Báo giá").first.click()
        pg.wait_for_selector("text=Danh sách báo giá", timeout=15000)
        pg.click("button.bg-nut-them")
        pg.wait_for_selector('.ovl h4:has-text("Báo giá mới"), .mdl h4:has-text("Báo giá mới")', timeout=10000)
    except PWTimeout:
        print("⛔ [harness] Không mở được form 'Báo giá mới' (selector bg-nut-them đổi?)")
        if het_kien_nhan(): br.close(); return
        br.close(); return
    print("✔ Mở form BÁO GIÁ mới")
    print("  form:", json.dumps(dump_form(pg), ensure_ascii=False)[:300])
    qua_buoc()

    # ── ĐIỀN khách + 2 món (giá > 0) ────────────────────────────────
    try:
        pg.locator('.ovl input[placeholder="Chị Lan"], .mdl input[placeholder="Chị Lan"]').first.fill(TEN_KHACH)
        pg.locator('.ovl input[placeholder="0903 792 333"], .mdl input[placeholder="0903 792 333"]').first.fill(SDT)
        # Form báo giá bắt đầu 1 dòng món → bấm "+ Thêm món" 1 lần = đủ 2 dòng.
        pg.locator('.ovl, .mdl').get_by_role("button", name="Thêm món").first.click()
        ten = pg.locator(PH_TEN); gia = pg.locator(PH_GIA)
        ten.nth(1).wait_for(timeout=6000)   # chờ đủ 2 dòng món
        for i, (t, g) in enumerate(MON):
            ten.nth(i).fill(t); gia.nth(i).fill(g)
        # select còn '— Chọn —' (nguồn khách / thương hiệu) → điền index=1, 2 vòng (select phụ thuộc)
        for _round in range(2):
            sels = pg.locator('.ovl select, .mdl select')
            for i in range(sels.count()):
                s = sels.nth(i)
                try:
                    if s.is_visible() and (s.input_value() or "") == "":
                        s.select_option(index=1); pg.wait_for_timeout(150)
                except Exception:
                    pass
    except Exception as e:
        print(f"⛔ [harness] Điền form lỗi: {type(e).__name__}: {str(e)[:110]}")
        if het_kien_nhan(): br.close(); return
        br.close(); return
    print(f"✔ Điền khách '{TEN_KHACH}' + 2 món: {MON[0][0]} / {MON[1][0]}")
    qua_buoc()

    # ── LƯU báo giá ─────────────────────────────────────────────────
    pre = set(r["ma_don"] for r in sql(
        "select ma_don from kho.don_hang where ten_khach=$1", [TEN_KHACH]))
    try:
        pg.locator('.ovl, .mdl').get_by_role("button", name="Lưu báo giá").first.click()
    except Exception as e:
        print(f"⛔ [harness] Không bấm được 'Lưu báo giá': {str(e)[:100]}"); br.close(); return
    pg.wait_for_timeout(1200)
    thieu = ""
    try:
        n = pg.get_by_text("Còn thiếu", exact=False)
        if n.count(): thieu = n.first.inner_text()[:140]
    except Exception:
        pass

    # HARD-STOP: chỉ nhận đơn MỚI (ma_don ∉ pre). Poll ≤15s.
    found = None
    for _ in range(30):
        rows = sql("select ma_don, trang_thai, la_demo from kho.don_hang where ten_khach=$1 order by tao_luc desc", [TEN_KHACH])
        for r in rows:
            if r["ma_don"] not in pre:
                found = r; break
        if found: break
        time.sleep(0.5)
    if not found:
        print(f"⛔ [app] Sale KHÔNG tạo được đơn báo giá mới. "
              f"{('App báo — ' + thieu) if thieu else 'không banner lỗi'}. DỪNG (không có mã giả).")
        br.close(); return
    MA = found["ma_don"]
    print(f"✔ Lưu báo giá OK → ma_don={MA} · trang_thai={found['trang_thai']} · la_demo={found['la_demo']}")
    qua_buoc()

    # ── B3 · VERIFY (owner SELECT) ──────────────────────────────────
    oid = sql("select id from kho.don_hang where ma_don=$1", [MA])[0]["id"]
    som = 0
    for _ in range(20):   # món lưu bất đồng bộ sau khi tạo đơn
        som = sql("select count(*)::int n from kho.don_hang_mon where don_id=$1", [oid])[0]["n"]
        if som >= 2: break
        time.sleep(0.5)
    v = {
        "trang_thai": found["trang_thai"],
        "la_demo": found["la_demo"],
        "don_hang_mon": som,
        "don_hang_mon_bom": sql("select count(*)::int n from kho.don_hang_mon_bom b join kho.don_hang_mon m on m.id=b.mon_id where m.don_id=$1", [oid])[0]["n"],
        "giu_cho": sql("select count(*)::int n from kho.giu_cho g join kho.don_hang_mon m on m.id=g.don_hang_mon_id where m.don_id=$1", [oid])[0]["n"],
        "tem": sql("select count(*)::int n from kho.tem_ban_ve where ma_don=$1", [MA])[0]["n"],
    }
    mong = {"trang_thai": "bao_gia", "la_demo": True, "don_hang_mon": 2,
            "don_hang_mon_bom": 0, "giu_cho": 0, "tem": 0}
    print("\n── B3 · VERIFY (mong vs thật) ──")
    het = 0
    for k, mv in mong.items():
        good = v[k] == mv
        het += 0 if good else 1
        print(f"  {'✅' if good else '❌'} {k}: {v[k]}" + ("" if good else f"  (mong {mv})"))
    ma_gia = [e for e in errs if "oneOfType" not in e]
    if ma_gia:
        print("  ⚠ [app] lỗi trang MỚI (ngoài nợ oneOfType):", " · ".join(ma_gia)[:160])

    # ── B4 · KHỐI 4 DÒNG CHO CEO ────────────────────────────────────
    print("\n" + "═" * 62)
    print("KHỐI CHO CEO (WP-37 · nghiệm thu đẩy BOM+giá vốn mốc DỰ KIẾN):")
    print(f"  1) Đơn báo giá: {MA}  (khách {TEN_KHACH})")
    print(f"  2) Mở SketchUp (đã khởi động lại) → chọn đơn này → dựng hình → đẩy BOM + giá vốn.")
    print(f"  3) Dấu ĐÚNG cần thấy: badge 'Báo giá' · dải nhắc 'số DỰ KIẾN' · nút đẩy tem XÁM (khoá).")
    print(f"  4) Đẩy xong: dán lại ảnh cửa sổ đẩy + mã đơn {MA} để nghiệm thu.")
    print("═" * 62)
    print("\n[TẠM] Đây là đơn DEMO — số của nó KHÔNG phải năng lực thật (WP-02a).")
    print(f"      Nghiệm thu xong xoá: sb.rpc('xoa_demo', {{p_ma_don:'{MA}'}})  (hoặc chạy lại robot tạo đơn mới).")
    print(f"\n{'🟢' if het == 0 else '🔴'} wp37_don_bao_gia: verify {6 - het}/6 khớp"
          + (f"  · {het} lệch — xem ❌ ở trên" if het else ""))
    br.close()

with sync_playwright() as pw:
    main(pw)
