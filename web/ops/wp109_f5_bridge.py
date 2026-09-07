# wp109_f5_bridge.py — BƯỚC 5 WP-109 D-1: mã DB HIỆN LÊN MÀN (bridge) · F5 khớp · món/nhật ký qua SELECT · 0 console đỏ.
# Chạy: python3 ops/wp109_f5_bridge.py   (test_sale lên đơn thật; dọn đơn DEMO cuối bằng pg trực tiếp).
import os, re, time, pathlib, json
from playwright.sync_api import sync_playwright, TimeoutError as PWT
for ln in pathlib.Path('ops/.env.robot').read_text().splitlines():
    ln = ln.strip()
    if ln and not ln.startswith('#') and '=' in ln:
        k, v = ln.split('=', 1); os.environ.setdefault(k.strip(), v.strip())
APEX = "https://togihome-sale.pages.dev"

def login(pg):
    pg.goto(APEX, wait_until="domcontentloaded"); time.sleep(2)
    if pg.locator('#p').is_visible():
        pg.fill('#e', os.environ['TEST_SALE_EMAIL']); pg.fill('#p', os.environ['TEST_SALE_PASS']); pg.locator('#b').click()
        for _ in range(40):
            time.sleep(0.3)
            if not pg.locator('#p').is_visible(): break
    pg.get_by_text("Sổ đơn hàng", exact=True).first.wait_for(timeout=20000)

def dien_luu(pg):
    try: pg.get_by_text("Sổ đơn hàng", exact=True).first.click(timeout=4000); time.sleep(1)
    except PWT: pass
    pg.get_by_role("button", name="+ Lên đơn", exact=True).click(timeout=6000)
    pg.get_by_placeholder("0903 792 333").wait_for(timeout=6000)
    pg.get_by_placeholder("Chị Lan").fill("DEMO WP109")
    pg.get_by_placeholder("0903 792 333").fill("0900109002")
    pg.get_by_placeholder("Số nhà, đường, phường, quận").fill("DEMO WP109 F5 bridge")
    pg.get_by_placeholder("Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm").first.fill("Tủ áo 2 cánh (DEMO WP109 F5)")
    pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill("9000000")
    for _r in range(2):
        sels = pg.locator('select')
        for i in range(sels.count()):
            s = sels.nth(i)
            try:
                if s.is_visible() and (s.input_value() or "") == "": s.select_option(index=1); time.sleep(0.2)
            except Exception: pass
    assert pg.get_by_role("button", name="Lưu đơn", exact=True).is_visible(), "[HARNESS] không thấy nút Lưu đơn"
    pg.get_by_role("button", name="Lưu đơn", exact=True).click()

def ma_tren_man(pg):
    "mã T{tháng}-NNN đang hiện trên danh sách (tối đa vài giây chờ bridge vá)"
    for _ in range(20):
        try:
            txt = pg.locator("body").inner_text(timeout=2000)
            m = re.findall(r"T\d+-\d{3}", txt)
            if m: return sorted(set(m))
        except Exception: pass
        pg.wait_for_timeout(300)
    return []

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-extensions"])
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    loi = []
    pg.on("console", lambda m: loi.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: loi.append("PAGEERROR " + str(e)))
    login(pg)
    dien_luu(pg)
    time.sleep(3)   # chờ chuỗi ghi + bridge vá mã
    ma_lac_quan = ma_tren_man(pg)   # (1) bridge: mã DB hiện lên màn NGAY sau lưu (chưa F5)
    # (2) SELECT đối chiếu: đơn + món + nhật ký
    q = pg.evaluate("""async()=>{
      const s=window.__sb;
      const {data:don}=await s.from('don_hang').select('id,ma_don,ten_khach').ilike('ten_khach','DEMO WP109%');
      const out=[];
      for(const d of (don||[])){
        const {count:cm}=await s.from('don_hang_mon').select('id',{count:'exact',head:true}).eq('don_id',d.id);
        const {count:cl}=await s.from('don_hang_nhat_ky').select('id',{count:'exact',head:true}).eq('don_id',d.id);
        out.push({ma:d.ma_don, mon:cm, nhat_ky:cl});
      }
      return out;
    }""")
    # (3) F5 khớp
    pg.reload(wait_until="domcontentloaded")
    pg.get_by_text("Sổ đơn hàng", exact=True).first.wait_for(timeout=20000)
    time.sleep(2)
    ma_sau_f5 = ma_tren_man(pg)
    b.close()

sel_ma = sorted(set(r["ma"] for r in q))
ok_bridge = any(m in ma_lac_quan for m in sel_ma) if sel_ma else False
ok_don = len(q) == 1
ok_mon = all(r["mon"] == 1 for r in q) and len(q) >= 1
ok_ls = all((r["nhat_ky"] or 0) >= 1 for r in q) and len(q) >= 1
ok_f5 = any(m in ma_sau_f5 for m in sel_ma) if sel_ma else False
ok_console = len(loi) == 0
print(f"(1) BRIDGE — mã DB hiện lên màn NGAY sau Lưu (chưa F5): màn={ma_lac_quan} · SELECT={sel_ma} → {'ĐẠT' if ok_bridge else 'KHÔNG'}")
print(f"(2) SELECT — {len(q)} đơn DEMO · chi tiết {q} → đơn {'1 ✓' if ok_don else 'KHÁC ✗'} · món {'=1 ✓' if ok_mon else '✗'} · nhật ký {'≥1 ✓' if ok_ls else '✗'}")
print(f"(3) F5 — mã sau reload: {ma_sau_f5} → {'KHỚP ✓' if ok_f5 else 'KHÔNG ✗'}")
print(f"(4) CONSOLE đỏ: {len(loi)} {'(SẠCH ✓)' if ok_console else '✗ ' + str(loi[:3])}")
print(f"\n═══ BƯỚC 5 phụ: bridge {'ĐẠT' if ok_bridge else 'HỎNG'} · đơn/món/nhật ký {'ĐẠT' if (ok_don and ok_mon and ok_ls) else 'HỎNG'} · F5 {'ĐẠT' if ok_f5 else 'HỎNG'} · console {'SẠCH' if ok_console else 'ĐỎ'} ═══")
