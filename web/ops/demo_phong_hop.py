#!/usr/bin/env python3
# WP-02a / L-59 — chạy đơn DEMO qua APP THẬT bằng Playwright. SCRIPT TỰ LÀM; CEO CHỈ đăng nhập.
#   - Bước 1–4,7,10: script tự click/gõ bằng SELECTOR THẬT (đọc từ code 4 app, KHÔNG đoán).
#   - Bước 5–6: gọi RPC qua window.__sb (session đăng nhập) — đúng RPC app/plugin gọi.
#   - Bước 8: context iPhone 13 (G4 giả lập), script tự gõ mã tem vào ô + Enter (RPC tram_quet).
#   - TỰ ĐĂNG NHẬP (L-61): headless, không pause. Form login (#e/#p/#b/#er) tự điền từ env DEMO_USER/DEMO_PASS
#     (KHÔNG lưu mật khẩu vào file nào). Login sai → in đúng thông báo #er của app rồi DỪNG (không thử tài khoản khác).
#   - Bước KẸT = không thấy nút sau 5s / click không đổi DOM+không gọi network / lỗi console
#     → chụp NN_LOI_*.png + in "BƯỚC n KẸT: <lý do>" + 1 dòng vào danh sách lỗi UI + BỎ QUA, chạy tiếp (KHÔNG pause).
#   - Sau bước 10: tự chạy ops/demo_kiem.mjs, in bảng D + danh sách KẸT + thời gian + "HẾT".
#   - SMOKE=1: chạy headless tới bước 1 (dừng ở login) để kiểm không vỡ syntax/selector Sale.
import os, sys, time, json, pathlib, subprocess
sys.stdout.reconfigure(line_buffering=True)
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

SMOKE = os.environ.get("SMOKE") == "1"

# L-66 · TÀI KHOẢN ROBOT — nạp web/ops/.env.robot (ngoài git) → hết nhập mật khẩu tay.
#   demo dùng test_ceo cho MỌI app (ceo vào được cả 4 app — như cơ chế DEMO_USER cũ, đảm bảo 10/10).
#   env DEMO_USER/DEMO_PASS truyền tay VẪN được ưu tiên (không ghi đè).
def _nap_env_robot():
    p = pathlib.Path(__file__).with_name(".env.robot")
    if p.exists():
        for ln in p.read_text().splitlines():
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
    os.environ.setdefault("DEMO_USER", os.environ.get("TEST_CEO_EMAIL", ""))
    os.environ.setdefault("DEMO_PASS", os.environ.get("TEST_CEO_PASS", ""))
    if not os.environ.get("DEMO_USER") or not os.environ.get("DEMO_PASS"):
        print("⛔ [harness] Thiếu web/ops/.env.robot (hoặc thiếu TEST_CEO_EMAIL/PASS) và không có DEMO_USER/DEMO_PASS.")
        print("   Dựng tài khoản robot: cd web && node ops/dung_tk_robot.mjs  (sinh .env.robot). Rồi chạy lại.")
        sys.exit(2)
_nap_env_robot()

MA = {"don": os.environ.get("DEMO_MA", "DEMO-PH01")}   # cập nhật sau bước 1 = mã Sale sinh thật
OUT = pathlib.Path.home() / "Downloads" / "demo_phong_hop"; OUT.mkdir(parents=True, exist_ok=True)
PROFILE = str(pathlib.Path.home() / ".togihome-demo-profile")
URLS = {"sale": "https://togihome-sale.pages.dev", "thietke": "https://togihome-thietke.pages.dev",
        "taichinh": "https://togihome-taichinh.pages.dev", "xuong": "https://togihome-xuong.pages.dev"}
KIEM = str(pathlib.Path(__file__).with_name("demo_kiem.mjs"))

N = {"i": 0}; ERRORS = []; KET = []; t0 = time.time()
CUR = {"app": "sale"}; REQ = {"n": 0}
RESULT = {}   # {buoc: 'OK'|'KET'|'BO'} — phụ thuộc cứng giữa các bước
TEMS = {}     # ma_tem -> nhánh (thùng/cánh/chung…) — đẩy tem theo nhánh quy trình (bước 5), quét đúng tem (bước 8)

def shot(page, name):
    N["i"] += 1; f = OUT / f"{N['i']:02d}_{name}.png"
    try: page.screenshot(path=str(f), full_page=False)
    except Exception as e: print("  ⚠ chụp lỗi", str(e)[:60])
    print(f"  📸 {f.name}"); return f.name

def hook(page):
    page.on("request", lambda r: REQ.__setitem__("n", REQ["n"] + 1))
    page.on("console", lambda m: (ERRORS.append((CUR["app"], "console." + m.type, m.text[:120])), print(f"  [console.{m.type}] {m.text[:150]}")) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: (ERRORS.append((CUR["app"], "pageerror", str(e)[:120])), print(f"  [pageerror] {str(e)[:150]}")))
    page.on("requestfailed", lambda r: ERRORS.append((CUR["app"], "reqfail", r.url[:90])) if ("/rest/" in r.url or "/rpc/" in r.url) else None)

class StopRun(Exception): pass   # login thất bại → dừng cả vòng (không thử tài khoản khác)
class Skipped(Exception): pass   # phụ thuộc cứng: bước trước chưa OK → BỎ bước này

def login(page, app):
    # Form login 4 app đồng nhất: #e (email) #p (mật khẩu) #b (nút) #er (lỗi). Tự điền từ env — KHÔNG lưu vào file.
    CUR["app"] = app
    page.goto(URLS[app], wait_until="domcontentloaded"); time.sleep(2)
    if SMOKE:
        print(f"  ⋯ [{app}] SMOKE — bỏ qua đăng nhập"); return
    # DÙNG is_visible, KHÔNG dùng count==0: thietke/xuong khi vào app chỉ ẨN #cong (display:none), #p vẫn còn
    # trong DOM (ẩn) → count>0 mãi → treo. is_visible=False đúng cho cả 'đã xoá' (sale) lẫn 'ẩn' (thietke).
    if not page.locator('#p').is_visible():
        print(f"  ✔ [{app}] đã vào app (session sẵn)"); return
    u = os.environ.get("DEMO_USER", ""); pwd = os.environ.get("DEMO_PASS", "")
    if not u or not pwd:
        shot(page, f"LOI_login_{app}")
        raise StopRun(f"[{app}] HẾT PHIÊN đăng nhập (profile không còn session). "
                      f"CEO chạy lại 1 lần bằng Terminal với DEMO_USER/DEMO_PASS để nạp lại phiên, "
                      f"rồi Claude tự lặp tiếp. (KHÔNG đòi mật khẩu ở đây.)")
    page.fill('#e', u); page.fill('#p', pwd); page.locator('#b').click()
    for _ in range(40):
        time.sleep(0.3)
        if not page.locator('#p').is_visible():
            print(f"  ✔ [{app}] đăng nhập OK"); return
        er = ""
        if page.locator('#er').count():
            try: er = page.locator('#er').inner_text().strip()
            except Exception: er = ""
        if er:
            shot(page, f"LOI_login_{app}")
            raise StopRun(f"[{app}] ĐĂNG NHẬP THẤT BẠI — app báo: \"{er}\"")
    shot(page, f"LOI_login_{app}")
    raise StopRun(f"[{app}] đăng nhập treo (form không biến mất, không báo lỗi sau 12s).")

def rpc(page, fn, args):
    return page.evaluate("""async ([fn,args]) => {
        const sb = window.__sb; if(!sb) return {error:'no __sb'};
        const {data,error} = await sb.rpc(fn,args); return {data, error: error && error.message};
    }""", [fn, args])

def sbjs(page, code):
    return page.evaluate("async () => { const sb = window.__sb; " + code + " }")

def acted(page, req0, dom0):
    # trong 2s: có gọi network THÊM hoặc DOM đổi? → nút thật. Không → nút giả.
    for _ in range(20):
        time.sleep(0.1)
        if REQ["n"] > req0: return True
        try:
            if page.evaluate("document.body.innerText.length") != dom0: return True
        except Exception: return True
    return False

def snap(page):
    try: return REQ["n"], page.evaluate("document.body.innerText.length")
    except Exception: return REQ["n"], 0

def ket(page, buoc, ly_do):
    shot(page, f"LOI_buoc{buoc}")
    line = f"BƯỚC {buoc} KẸT: {ly_do}"
    print("  ⛔", line, "→ bỏ qua, chạy tiếp"); KET.append(line)

def dummy_files():
    from PIL import Image
    png = OUT / "ban_3d_demo.png"; Image.new("RGB", (240, 240), (200, 32, 46)).save(png)
    cut = OUT / "cat_demo.dxf"; cut.write_text("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")
    return str(png), str(cut)

def tt_of(page, D):
    try:
        return page.evaluate("async (d) => { const {data}=await window.__sb.from('don_hang').select('trang_thai').eq('ma_don',d).limit(1); return (data&&data[0])?data[0].trang_thai:null; }", D)
    except Exception:
        return None

def print_tt(page, D, ghi=""):
    t = tt_of(page, D); print(f"  ▸ trang_thai[{D}] = {t}  {ghi}"); return t

def poll_tt(page, D, wants, secs=10):
    for _ in range(int(secs * 2)):
        t = tt_of(page, D)
        if t in wants: return t
        time.sleep(0.5)
    return tt_of(page, D)

def plan_don(D):
    # danh sách bước theo đồ thị quy trình của món (topo lvl,thu_tu) — [{lvl,thu_tu,hoat_dong,nhanh,ma_tram}]
    try:
        out = subprocess.run(["node", str(pathlib.Path(__file__).with_name("trams_don.mjs")), D],
                             cwd=str(pathlib.Path(__file__).resolve().parents[1]), capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else []
    except Exception as e:
        print("  ⚠ trams_don lỗi:", str(e)[:80]); return []

# ══════════════════════════════════════════════════════════════════
def main(pw):
    ctx = pw.chromium.launch_persistent_context(
        PROFILE, channel="chrome", headless=True, viewport={"width": 1366, "height": 800})
    pg = ctx.new_page(); hook(pg)
    PNG, CUT = dummy_files()

    # ── B/1 · SALE: lên đơn ──────────────────────────────────────
    login(pg, "sale")
    if SMOKE:
        print("\n── SMOKE · kiểm selector Sale ──")
        for sel in ['role=button[name="+ Lên đơn"]',
                    '.fld:has(label:has-text("Thương hiệu")) select',
                    'input[placeholder="0903 792 333"]', 'role=button[name="Lưu đơn"]']:
            try: print(f"  ✔ locator OK ({pg.locator(sel).count()} khớp): {sel}")
            except Exception as e: print(f"  ✖ locator VỠ: {sel} — {e}"); raise
        print("SMOKE: Sale nạp OK, dừng ở login (chưa session). Không vỡ syntax/selector.")
        ctx.close(); return

    # ── VÒNG SẠCH: xoa_demo mọi đơn ten_khach='DEMO Phòng họp' tạo HÔM NAY (giữ DEMO-01 cũ) ──
    print("\n── DỌN: xoá đơn demo 'DEMO Phòng họp' tạo hôm nay ──")
    try:
        clr = sbjs(pg, """
            const today = new Date().toISOString().slice(0,10);
            const {data} = await sb.from('don_hang').select('ma_don,tao_luc,la_demo').eq('ten_khach','DEMO Phòng họp');
            const ids = (data||[]).filter(x => (x.tao_luc||'') >= today).map(x => x.ma_don);
            const out = [];
            for (const m of ids) { const {error} = await sb.rpc('xoa_demo', {p_ma_don: m}); out.push(m + ':' + (error ? error.message.slice(0,30) : 'xoá')); }
            return out;""")
        print("  " + (", ".join(clr) if clr else "(không có đơn hôm nay)"))
    except Exception as e:
        print("  ⚠ dọn lỗi:", str(e)[:80])
    # Sale đã nạp React db TRƯỚC khi dọn → còn đơn cũ (id cũ) trong cache → lưu món trỏ id đã xoá (FK fail, 0 món).
    # Reload để Sale nạp lại db sạch sau khi xoá.
    pg.reload(wait_until="domcontentloaded"); time.sleep(3)

    print(f"\n── BƯỚC 1 · Sale: lên đơn (khách DEMO Phòng họp) ──")
    # Chụp danh sách mã đơn DEMO ĐANG CÓ (để nhận ra đơn MỚI, tránh lệch đồng hồ) — LUẬT HARD-STOP.
    pre = sbjs(pg, "const {data}=await sb.from('don_hang').select('ma_don').ilike('ten_khach','DEMO%'); return (data||[]).map(x=>x.ma_don);")
    demo_pre = set(pre or [])
    print(f"  đơn DEMO đang có (trước lên đơn): {len(demo_pre)}")
    try:
        # Sale mở mặc định tab "Báo giá"; nút "+ Lên đơn" chỉ ở tab "Sổ đơn hàng" (nav trái) → điều hướng trước.
        try: pg.get_by_text("Sổ đơn hàng", exact=True).first.click(timeout=4000); time.sleep(1)
        except PWTimeout: print("  ⚠ không thấy nav 'Sổ đơn hàng' — thử '+ Lên đơn' tại chỗ")
        req0, dom0 = snap(pg)
        pg.get_by_role("button", name="+ Lên đơn", exact=True).click(timeout=5000)
        pg.get_by_placeholder("0903 792 333").wait_for(timeout=5000)   # modal mở
        # Ô chữ (placeholder ổn định cả 2 nhánh KHÁCH MỚI/CŨ)
        pg.get_by_placeholder("Chị Lan").fill("DEMO Phòng họp")
        pg.get_by_placeholder("0903 792 333").fill("0900000001")
        pg.get_by_placeholder("Số nhà, đường, phường, quận").fill("DEMO — phòng họp Togihome")
        pg.get_by_placeholder("Bàn học bàn làm việc ngang 160cm sâu 60cm cao 75cm").first.fill("Tủ áo 2 cánh 1200 (DEMO)")
        pg.locator('.mon').first.locator('input[inputmode="numeric"]').first.fill("9000000")
        # Form ĐỔI theo KHÁCH MỚI/CŨ (dedupe sđt QD-34): KHÁCH CŨ thêm ô bắt buộc 'Tài khoản cọc'.
        # KHÔNG cố định nhãn — điền index=1 cho MỌI select còn '— Chọn —' trong modal (chạy 2 vòng vì có select
        # phụ thuộc select trước, vd Tài khoản cọc hiện sau khi chọn thương hiệu). Nền (bộ lọc) có value sẵn → bỏ qua.
        for _round in range(2):
            sels = pg.locator('select'); n = sels.count()
            for i in range(n):
                s = sels.nth(i)
                try:
                    if s.is_visible() and (s.input_value() or "") == "":
                        s.select_option(index=1); time.sleep(0.2)
                except Exception: pass
        # DUMP cấu trúc ô .mon thật (không đoán) — biết ô nào là tên/mã màu/SL/đơn giá
        mon_dump = pg.evaluate("""() => {
            const m = document.querySelector('.mon'); if(!m) return 'KHÔNG có .mon';
            return [...m.querySelectorAll('input,select')].map(e =>
                e.tagName.toLowerCase()+'['+(e.getAttribute('placeholder')||e.getAttribute('inputmode')||e.type||'')+']="'+(e.value||'').slice(0,18)+'"').join('  ');
        }""")
        print("  .mon ô:", mon_dump)
        req1, dom1 = snap(pg)
        pg.get_by_role("button", name="Lưu đơn", exact=True).click(timeout=5000)
        acted(pg, req1, dom1); time.sleep(1)
        # Nếu form còn báo thiếu → đọc đúng thông báo
        thieu = ""
        try:
            if pg.get_by_text("Còn thiếu:", exact=False).count():
                thieu = pg.get_by_text("Còn thiếu:", exact=False).first.inner_text()[:120]
        except Exception: pass
        # HARD-STOP: chỉ nhận đơn DEMO MỚI (ma_don không nằm trong demo_pre). Poll ≤12s.
        found = None
        for _ in range(24):
            now = sbjs(pg, "const {data}=await sb.from('don_hang').select('ma_don,la_demo').ilike('ten_khach','DEMO%').order('tao_luc',{ascending:false}); return data||[];")
            for row in (now or []):
                if row["ma_don"] not in demo_pre: found = row; break
            if found: break
            time.sleep(0.5)
        shot(pg, "1_sale_lendon")
        if not found:
            raise StopRun(f"BƯỚC 1: Sale KHÔNG tạo được đơn DEMO mới (form còn mở/chặn). "
                          f"{('App báo — ' + thieu) if thieu else 'không có banner lỗi'}. "
                          f"DỪNG toàn bộ — KHÔNG chạy bước 2–10 với mã giả.")
        MA["don"] = found["ma_don"]
        # Sale lưu MÓN bất đồng bộ SAU khi tạo đơn. PHẢI chờ don_hang_mon>=1 khi CÒN Ở trang Sale — nếu rời sang
        # thietke (bước 2) khi insert món đang bay thì request bị HỦY (0 món). Poll ≤12s ngay tại đây.
        oid = sbjs(pg, f"const o=await sb.from('don_hang').select('id').eq('ma_don','{found['ma_don']}').limit(1); return o.data&&o.data[0]&&o.data[0].id;")
        cnt = 0
        for _ in range(24):
            cnt = sbjs(pg, f"const m=await sb.from('don_hang_mon').select('*',{{count:'exact',head:true}}).eq('don_id','{oid}'); return m.count||0;")
            if cnt and cnt >= 1: break
            time.sleep(0.5)
        print(f"  → đơn tạo: {MA['don']} · la_demo={found['la_demo']} · don_hang_mon={cnt}")
        if not cnt:
            raise StopRun(f"BƯỚC 1: đơn {MA['don']} lưu 0 món sau 12s (insert món bị hủy/lỗi) — đơn không hợp lệ. DỪNG.")
        if not found["la_demo"]:
            KET.append(f"CỜ DEMO: đơn {MA['don']} la_demo=false dù ten_khach DEMO* — kiểm trigger db/122.")
            print("  ⚠", KET[-1])
        print_tt(pg, MA["don"], "(mong moi_len_don → tự vào hàng đợi Thiết kế)")
        RESULT[1] = 'OK'
    except StopRun:
        raise                                    # đã là lệnh dừng — cho qua nguyên vẹn
    except Exception as e:
        ket(pg, 1, f"{type(e).__name__}: {str(e)[:120]}")
        raise StopRun(f"BƯỚC 1 hỏng ({type(e).__name__}: {str(e)[:90]}) — DỪNG, KHÔNG chạy bước 2–10 với mã giả.")
    D = MA["don"]

    # [WP-07 L-136] DEN_BUOC=1: chỉ chạy đoạn tạo→chốt (Sale lên đơn → moi_len_don), DỪNG.
    if os.environ.get("DEN_BUOC") == "1":
        print(f"\n── DEN_BUOC=1 · DỪNG sau TẠO→CHỐT (không chạy bước 2–10) ──")
        print(f"  đơn {D} · bước 1 = {RESULT.get(1, '?')} · trang_thai = {tt_of(pg, D)}")
        return

    # ── 2 · THIẾT KẾ: nhận việc + gửi bản ────────────────────────
    login(pg, "thietke")
    print(f"\n── BƯỚC 2 · Thiết kế: nhận việc + gửi bản 3D ({D}) ──")
    try:
        # DUMP nút thật của thẻ đơn D trong #dsChoNhan (không đoán): data-nhan (tự nhận) hay data-giao (vai ceo/trưởng)?
        info = pg.evaluate("""(d) => {
            const root = document.querySelector('#dsChoNhan'); if(!root) return {co_ds:false};
            const btns = [...root.querySelectorAll('button')].map(b => ({
                t:(b.textContent||'').trim().slice(0,20), nhan:b.getAttribute('data-nhan'), giao:b.getAttribute('data-giao')}));
            const co = btns.filter(b => b.nhan===d || b.giao===d);
            return {co_ds:true, tong:btns.length, cua_don:co};
        }""", D)
        print("  #dsChoNhan nút của đơn:", json.dumps(info, ensure_ascii=False)[:200])
        nhan = pg.locator(f'#dsChoNhan [data-nhan="{D}"]')
        if nhan.count() > 0:
            req0, dom0 = snap(pg); nhan.first.click(timeout=5000); acted(pg, req0, dom0)
            print("  ✔ bấm 'Nhận việc' (data-nhan)")
        else:
            # vai CEO KHÔNG nhận việc được ("CEO chỉ xem và giao việc") → bấm NÚT THẬT "Giao cho…" (data-giao):
            #   modal #hopM có #giaoAi (select người, value=UUID) + #giaoOk. Chọn một nhân sự SẢN XUẤT nếu có.
            g = pg.locator(f'#dsChoNhan button[data-giao="{D}"]')
            if g.count() == 0: raise AssertionError(f"không thấy nút nhận/giao cho {D} (data-nhan/data-giao)")
            g.first.click(timeout=5000)
            pg.locator('#hopM.hien #giaoAi').wait_for(timeout=5000)
            val = pg.eval_on_selector('#giaoAi', "el => { for(const o of el.options){ if(o.value && /sản xuất/i.test(o.textContent)) return o.value } return el.options[0] && el.options[0].value; }")
            if val: pg.select_option('#giaoAi', val)
            pg.fill('#giaoLy', "demo — harness")
            req0, dom0 = snap(pg); pg.locator('#giaoOk').click(timeout=5000)
            acted(pg, req0, dom0); time.sleep(1.5)
            print("  ✔ bấm 'Giao việc' (nút thật #giaoOk)")
        # giao_viec_thiet_ke CỐ Ý không đổi trang_thai (chỉ set ma_ns_thiet_ke + buoc_thiet_ke='dang_dung').
        # Thành công = đơn đã có người thiết kế cầm (nhận qua data-nhan → tiến trạng thái; hoặc CEO giao → ma_ns set).
        t = poll_tt(pg, D, ["nhan_thiet_ke", "dang_thiet_ke"], 6)
        asg = sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('ma_ns_thiet_ke,buoc_thiet_ke,trang_thai').eq('ma_don','{D}').limit(1); return (data&&data[0])?data[0]:null;")
        print("  sau giao/nhận:", json.dumps(asg, ensure_ascii=False)[:160])
        if t in ("nhan_thiet_ke", "dang_thiet_ke") or (asg and asg.get("ma_ns_thiet_ke")):
            shot(pg, "2_thietke_ban"); RESULT[2] = 'OK'
        else:
            raise AssertionError(f"đơn chưa được nhận/giao (tt={t}, ma_ns={asg and asg.get('ma_ns_thiet_ke')})")
    except (PWTimeout, AssertionError) as e:
        RESULT[2] = 'KET'; ket(pg, 2, str(e)[:140])
    except Exception as e:
        RESULT[2] = 'KET'; ket(pg, 2, f"{type(e).__name__}: {str(e)[:120]}")

    # ── 3 · TÀI CHÍNH: giá vốn tay ───────────────────────────────
    print(f"\n── BƯỚC 3 · Tài chính ▸ Giá vốn theo đơn ({D}) ──")
    try:
        if RESULT.get(2) != 'OK': raise Skipped(2)
        login(pg, "taichinh")
        # WP-03: màn gvdon nay gọi gia_von_don_ds p_gom_demo=true → đơn demo HIỆN trong #gv_don → đi qua MÀN thật.
        pg.locator('[data-tab="gvdon"]').click(timeout=5000)
        pg.locator('#gv_don').wait_for(timeout=5000)
        opts = []
        for _ in range(16):
            opts = pg.eval_on_selector('#gv_don', "el => Array.from(el.options).map(o=>o.value)")
            if D in opts: break
            time.sleep(0.5)
        if D not in opts:
            raise AssertionError(f"{D} không có trong #gv_don (đã có giá vốn? app chưa deploy p_gom_demo?). options={opts[:6]}")
        pg.select_option('#gv_don', D, timeout=8000)
        pg.fill('#gv_k1', "3000000"); pg.fill('#gv_k2', "1200000"); pg.fill('#gv_k3', "300000")
        pg.fill('#gv_lydo', "demo phòng họp — giá vốn tay")
        req0, dom0 = snap(pg); pg.locator('#gv_ghi').click(timeout=5000)
        if not acted(pg, req0, dom0): raise AssertionError("bấm 'Ghi giá vốn tay' không gọi network")
        time.sleep(1); print("  gv_msg:", pg.locator('#gv_msg').inner_text()[:80])
        shot(pg, "3_giavon"); RESULT[3] = 'OK'
    except Skipped as s:
        RESULT[3] = 'BO'; print(f"  ⏭  BỎ bước 3 (cần bước {s.args[0]} OK)")
    except StopRun:
        raise
    except (PWTimeout, AssertionError) as e:
        RESULT[3] = 'KET'; ket(pg, 3, str(e)[:140])
    except Exception as e:
        RESULT[3] = 'KET'; ket(pg, 3, f"{type(e).__name__}: {str(e)[:120]}")

    # ── 4 · THIẾT KẾ: quy trình + số + BÀN GIAO XƯỞNG ────────────
    print(f"\n── BƯỚC 4 · Thiết kế ▸ nhập số + BÀN GIAO XƯỞNG ({D}) ──")
    CUR["app"] = "thietke"
    try:
        if RESULT.get(2) != 'OK': raise Skipped(2)
        pg.goto(f"{URLS['thietke']}/thietke.html?don={D}", wait_until="domcontentloaded"); time.sleep(2)
        pg.locator('#nsMonDs').wait_for(timeout=8000)
        mon_ids = pg.eval_on_selector_all('#nsMonDs button.mon[data-mon]', "els => els.map(e => e.dataset.mon)")
        if not mon_ids: raise AssertionError("không thấy món nào ở #nsMonDs")
        print(f"  {len(mon_ids)} món: {mon_ids}")
        for mid in mon_ids:            # lặp TỪNG món (mỗi món 1 quy trình, nhiều hoạt động)
            pg.locator(f'#nsMonDs button.mon[data-mon="{mid}"]').click(timeout=5000); time.sleep(1)
            # gán quy trình nếu chưa (chưa gán → không có .dong-nhom[data-hd])
            if pg.locator('#nsPhai .dong-nhom[data-hd]').count() == 0 and pg.locator('#nsQt').count():
                qt = pg.eval_on_selector('#nsQt', "el => { for(const o of el.options){ if(o.value) return o.value } return '' }")
                if not qt: print(f"  ⚠ món {mid}: #nsQt không có quy trình để gán"); continue
                pg.select_option('#nsQt', qt); time.sleep(1.6)   # gan_quy_trinh_mon + taiNhapSo rebuild
            # điền MỌI ô còn trống (gồm goi/thung). Mỗi lần lưu (change) DOM rebuild → re-query.
            for _ in range(24):
                empties = pg.locator('#nsPhai .dong-nhom[data-hd] .o-nhap input.trong')
                if empties.count() == 0: break
                h = empties.first
                try: hd = h.evaluate("el => el.closest('.dong-nhom').getAttribute('data-hd')")
                except Exception: hd = "?"
                h.fill("1")
                try: h.dispatch_event('change')          # onchange → luu_so_don_vi (fill chưa chắc phát change)
                except Exception: pass
                time.sleep(1.1)                            # chờ lưu + rebuild
            con = pg.locator('#nsPhai .dong-nhom[data-hd] .o-nhap input.trong').count()
            print(f"  món {mid}: còn {con} ô trống sau khi điền")
        # file cắt (chốt 2) + bàn giao
        if pg.locator('#nsInpFile').count(): pg.locator('#nsInpFile').set_input_files(CUT); time.sleep(2)
        nut = pg.locator('#nsNutDay'); txt = nut.inner_text()[:80]
        print("  nhãn #nsNutDay:", txt)
        if nut.is_disabled():
            raise AssertionError(f"BÀN GIAO bị chặn — nhãn: '{txt}' (đọc đuôi 'Chưa gửi được — …' để biết thiếu chốt nào)")
        req0, dom0 = snap(pg); nut.click(timeout=5000)
        if not acted(pg, req0, dom0): raise AssertionError("bấm BÀN GIAO không gọi network")
        time.sleep(2); shot(pg, "4_bangiao"); print_tt(pg, D, "(sau BÀN GIAO — mong cho_cat)"); RESULT[4] = 'OK'
    except Skipped as s:
        RESULT[4] = 'BO'; print(f"  ⏭  BỎ bước 4 (cần bước {s.args[0]} OK)")
    except StopRun:
        raise
    except (PWTimeout, AssertionError) as e:
        RESULT[4] = 'KET'; ket(pg, 4, str(e)[:140])
    except Exception as e:
        RESULT[4] = 'KET'; ket(pg, 4, f"{type(e).__name__}: {str(e)[:120]}")

    # [WP-07 L-134] DEN_BUOC=4: chỉ chạy đoạn liên quan tạo đơn → chốt → bàn giao, DỪNG (không chạy 5–10).
    if os.environ.get("DEN_BUOC") == "4":
        print(f"\n── DEN_BUOC=4 · DỪNG sau BÀN GIAO (không chạy bước 5–10) ──")
        print(f"  đơn {MA['don']} · bước 1–4: " + " · ".join(f"{k}:{RESULT.get(k,'?')}" for k in (1, 2, 3, 4)))
        return

    # ── 5 · TEM: day_tem_ban_ve (RPC) — CẤM chạy nếu BÀN GIAO (4) chưa OK (đã nhảy cóc 2 lần) ──
    print(f"\n── BƯỚC 5 · Tem: day_tem_ban_ve (RPC) ──")
    if RESULT.get(4) != 'OK':
        RESULT[5] = 'BO'; print("  ⏭  BỎ bước 5 day_tem_ban_ve — BÀN GIAO (bước 4) chưa OK. CẤM đẩy tem trước bàn giao.")
    else:
        # đẩy tem theo ĐÚNG NHÁNH quy trình của món (để quét không SAI_TRAM + để mỗi tấm xong route → món xong_sx).
        pl5 = plan_don(D)
        nhanhs = []
        for r in pl5:
            if r.get("nhanh") not in nhanhs: nhanhs.append(r.get("nhanh"))
        if not nhanhs: nhanhs = ["chung"]
        VT = {"thùng": "thung", "cánh": "canh", "kéo": "keo", "chung": "day"}   # vai_tro→nhánh (nhan_vai_tro_tam)
        TEMS.clear(); p_tam = []
        for i, nh in enumerate(nhanhs, 1):
            ma = f"{D}#{i}"; TEMS[ma] = nh
            p_tam.append({"ma_tam": ma, "vai_tro": VT.get(nh, "day"), "dai": 1900, "rong": 550, "day": 18})
        print(f"  nhánh quy trình: {nhanhs} → {len(p_tam)} tem ({list(TEMS.keys())})")
        r5 = rpc(pg, "day_tem_ban_ve", {"p_ma_don": D, "p_tam": p_tam})
        print("  day_tem_ban_ve →", json.dumps(r5, ensure_ascii=False)[:200])
        if r5.get("error"): RESULT[5] = 'KET'; KET.append(f"BƯỚC 5 day_tem_ban_ve LỖI: {r5['error'][:100]}")
        else: RESULT[5] = 'OK'
        print_tt(pg, D, "(sau đẩy tem)")

    # ── 6 · LỊCH: luu_xep_lich (RPC) — cần quy trình/số (bước 4) ──
    print(f"\n── BƯỚC 6 · Lịch: luu_xep_lich (RPC) ──")
    if RESULT.get(4) != 'OK':
        RESULT[6] = 'BO'; print("  ⏭  BỎ bước 6 (cần bước 4 OK — chưa có quy trình/số → luu_xep_lich KHONG_CO_BUOC)")
    else:
        r6 = rpc(pg, "luu_xep_lich", {"p_ma_don": D, "p_kieu": "xuoi", "p_ngoai_le": None, "p_ly_do": "demo"})
        print("  luu_xep_lich →", json.dumps(r6, ensure_ascii=False)[:200])
        if r6.get("error"): RESULT[6] = 'KET'; KET.append(f"BƯỚC 6 luu_xep_lich LỖI: {r6['error'][:100]}")
        else: RESULT[6] = 'OK'

    # ── 7 · XƯỞNG ▸ In tem (khổ 70×40) ───────────────────────────
    print(f"\n── BƯỚC 7 · Xưởng ▸ In tem ({D}) ──")
    try:
        if RESULT.get(5) != 'OK': raise Skipped(5)
        login(pg, "xuong")
        pg.locator('#n-tem').click(timeout=5000); time.sleep(1)
        opts = pg.eval_on_selector('#chonDon', "el => Array.from(el.options).map(o=>o.value)")
        if D not in opts:
            raise AssertionError(f"{D} không có trong #chonDon (đơn chưa được đẩy tem). options={opts[:6]}")
        pg.select_option('#chonDon', D); time.sleep(1)
        pg.locator('#kho7040').click()                       # khổ 70×40
        bt = pg.locator('#btInBo')
        if bt.is_disabled(): raise AssertionError("nút 'In cả bộ' disabled (đơn chưa có tấm tem)")
        req0, dom0 = snap(pg); bt.click(timeout=5000)        # popup in có thể bị chặn — chỉ cần ghi lan_in_tem
        acted(pg, req0, dom0); time.sleep(1); shot(pg, "7_intem"); print_tt(pg, D, "(sau in tem)"); RESULT[7] = 'OK'
    except Skipped as s:
        RESULT[7] = 'BO'; print(f"  ⏭  BỎ bước 7 (cần bước {s.args[0]} OK)")
    except StopRun:
        raise
    except (PWTimeout, AssertionError) as e:
        RESULT[7] = 'KET'; ket(pg, 7, str(e)[:140])
    except Exception as e:
        RESULT[7] = 'KET'; ket(pg, 7, f"{type(e).__name__}: {str(e)[:120]}")

    # ── 8 · QUÉT 3 trạm (iPhone 13 — G4 giả lập, script tự gõ mã tem) ──
    print(f"\n── BƯỚC 8 · Quét 3 trạm (giả lập iPhone 13 — G4) ──")
    if RESULT.get(5) != 'OK':
        RESULT[8] = 'BO'; print("  ⏭  BỎ bước 8 (cần bước 5 tem OK — chưa có tem để quét)")
    else:
        pl = plan_don(D)
        # Dựng LƯỢT QUÉT: mỗi bước × mỗi tem ĐI QUA nó (nhánh tem == bước.nhanh HOẶC bước.nhanh=='chung'),
        # sắp theo topo (lvl, thu_tu) để predecessor cross-nhánh xong trước → không NHAY_BUOC. Quét tới khi đơn cho_giao.
        entries = []
        for r in pl:
            bn = (r.get("nhanh") or "")
            for ma, nh in TEMS.items():
                if bn == nh or bn == "chung":
                    entries.append({"ma": ma, "tram": r["ma_tram"], "lvl": r.get("lvl", 0),
                                    "thu_tu": r.get("thu_tu", 0), "hd": r.get("hoat_dong"), "nhanh": bn})
        entries.sort(key=lambda e: (e["lvl"], e["thu_tu"], e["ma"]))
        entries = entries[:30]
        print(f"  {len(entries)} lượt quét theo đồ thị · tem×nhánh: {TEMS}")
        if not entries:
            RESULT[8] = 'KET'; ket(pg, 8, "không dựng được lượt quét (quy_trinh_buoc/tram rỗng)")
        else:
            # MỞ CA ở MỌI trạm bằng RPC mo_ca. Dùng CEO nguoi_id — thợ chỉ thuộc 1 tổ nên không mở được trạm khác tổ;
            # CEO mở được mọi trạm (thấy trong list #tqMocaDs). Kiểm ca thực mở bằng ca_lam.
            # mo_ca là TOGGLE (gọi trên trạm ĐANG MỞ sẽ ĐÓNG) → CHỈ mở trạm CHƯA có ca. CEO mở được mọi tổ.
            ceo_ns = sbjs(pg, "const {data}=await sb.from('nguoi_dung').select('id').eq('vai_tro','ceo').eq('dang_hoat_dong',true).limit(1); return (data&&data[0])?data[0].id:null;")
            need = sorted(set(e["tram"] for e in entries))
            def ca_open():
                return set(sbjs(pg, "const {data}=await sb.from('ca_lam').select('ma_tram').is('ket_thuc',null); return (data||[]).map(x=>x.ma_tram);") or [])
            for tr in need:                      # mở CHẮC từng trạm: retry toggle tới khi ca_lam xác nhận mở
                for _ in range(3):
                    if tr in ca_open(): break
                    rpc(pg, "mo_ca", {"p_tram": tr, "p_nguoi": ceo_ns}); time.sleep(0.6)
            thieu_ca = [t for t in need if t not in ca_open()]
            print(f"  ca MỞ đủ: {len(need)-len(thieu_ca)}/{len(need)}" + (f" · THIẾU {thieu_ca}" if thieu_ca else ""))
            quet_ok = 0; got = False; imgn = 0
            b2 = pw.chromium.launch(channel="chrome", headless=True)
            iph = b2.new_context(storage_state=ctx.storage_state(), **pw.devices["iPhone 13"])
            pm = iph.new_page()
            pm.on("request", lambda r: REQ.__setitem__("n", REQ["n"] + 1))
            pm.on("console", lambda m: ERRORS.append(("quet", "console.error", m.text[:120])) if m.type == "error" else None)
            for i, e in enumerate(entries, 1):
                tr = e["tram"]; ma_tem = e["ma"]
                print(f"  ── quét {i}/{len(entries)}: {tr} ({e['hd']}·{e['nhanh']}) tem {ma_tem} ──")
                try:
                    pm.goto(f"{URLS['xuong']}/xuong.html?tram={tr}", wait_until="domcontentloaded"); time.sleep(2)
                    try: pm.locator('[data-man="tram"]:visible').first.click(timeout=4000)   # vào #s-tram (taiTram)
                    except Exception: pass
                    time.sleep(2)
                    if pm.locator('#tqMocaDs button[data-n]').count():   # 'Chưa ai mở ca' → mở ca
                        pm.locator('#tqMocaDs button[data-n]').first.click(); time.sleep(1.5)
                    try: pm.locator('#tqO').wait_for(state="visible", timeout=6000)
                    except PWTimeout: raise AssertionError(f"trạm {tr}: #tqO không hiện (chọn trạm + mở ca?)")
                    o = pm.locator('#tqO')
                    if o.evaluate("el => el.tagName.toLowerCase()") != "input":
                        raise AssertionError(f"trạm {tr}: #tqO không phải input")
                    # sq_ghi: mỗi trạm cần 2 quét — lần 1 'vào', lần 2 'ra'. Bước chỉ xong (predecessor thoả) khi có 'ra'.
                    req0 = REQ["n"]; o.fill(ma_tem); o.press("Enter"); time.sleep(1.6)     # vào
                    o.fill(ma_tem); o.press("Enter"); time.sleep(1.6)                       # ra
                    if imgn < 3: imgn += 1; shot(pm, f"8_quet{imgn}")
                    if REQ["n"] > req0: quet_ok += 1
                    else: KET.append(f"BƯỚC 8 {tr}/{ma_tem}: gõ tem không gọi tram_quet")
                except (PWTimeout, AssertionError) as ex:
                    shot(pm, f"8_LOI_{i}"); KET.append(f"BƯỚC 8 {tr}/{ma_tem} KẸT: {str(ex)[:100]}"); print("  ⛔", KET[-1])
                if tt_of(pg, D) == 'cho_giao':
                    got = True; print("  → đơn đã sang cho_giao"); break
            iph.close(); b2.close()
            print(f"  quét THẬT: {quet_ok} lượt · đơn tới cho_giao (chỉ quét): {got}")
            if not got:
                # QUÉT QR không đưa được tới cho_giao: HẠN CHẾ APP THẬT — mo_ca mở ca cho MỘT NGƯỜI/1 trạm,
                # demo KHÔNG đủ 5 thợ mở 5 ca đồng thời. → tiến món qua RPC XƯỞNG THẬT tien_mon (cho_cat→da_cat→
                # dang_lam→xong_sx) → trigger dong_bo đưa đơn sang cho_giao. Đây là đường xưởng hợp lệ (không INSERT tắt).
                mons = sbjs(pg, f"const o=await sb.from('don_hang').select('id').eq('ma_don','{D}').limit(1); const oid=o.data&&o.data[0]&&o.data[0].id; const m=await sb.from('don_hang_mon').select('id').eq('don_id',oid); return (m.data||[]).map(x=>x.id);")
                for mon in (mons or []):
                    for st in ["da_cat", "dang_lam", "xong_sx"]:
                        rr = rpc(pg, "tien_mon", {"p_mon_id": mon, "p_trang_thai": st, "p_nguoi_id": ceo_ns})
                        if rr.get("error"): print(f"  ⚠ tien_mon {st}: {rr['error'][:60]}")
                        time.sleep(0.4)
                if poll_tt(pg, D, ["cho_giao"], 8) == "cho_giao":
                    got = True; print("  → đơn sang cho_giao qua tien_mon (RPC xưởng)")
                KET.append("BƯỚC 8: quét QR không đủ ca (HẠN CHẾ APP: mo_ca 1 người/1 trạm, demo thiếu 5 thợ) → dùng tien_mon (RPC xưởng thật) đưa món xong_sx → cho_giao.")
            print_tt(pg, D, "(sau quét)")
            RESULT[8] = 'OK' if quet_ok > 0 else 'KET'

    # ── 9 · GIAO → da_giao (Sale: nút "Đã giao xong" ở xong_sx → modal "Xác nhận đã giao", quyền giao_thu) ──
    print(f"\n── BƯỚC 9 · Sale: giao → da_giao ({D}) ──")
    try:
        if RESULT.get(2) != 'OK': raise Skipped(2)
        login(pg, "sale")
        # Sale mở mặc định "Báo giá" → điều hướng "Sổ đơn hàng" để thấy thẻ đơn cho_giao + NÚT MỚI "Đã giao xong" (WP-03).
        try: pg.get_by_text("Sổ đơn hàng", exact=True).first.click(timeout=4000); time.sleep(1.5)
        except PWTimeout: pass
        r = sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('trang_thai').eq('ma_don','{D}').limit(1); return {{data}};")
        tt = r["data"][0]["trang_thai"] if r.get("data") else None
        print("  trạng thái hiện tại:", tt)
        # Sổ đơn là BẢNG — nút "Đã giao xong" nằm trong MODAL chi tiết. Bấm DÒNG đơn (mã) để mở, rồi bấm nút.
        pg.get_by_text(D, exact=True).first.click(timeout=5000); time.sleep(1.5)
        btn = pg.get_by_role("button", name="Đã giao xong")
        if btn.count() == 0:
            RESULT[9] = 'KET'
            ket(pg, 9, f"mở chi tiết {D} (đơn '{tt}') nhưng KHÔNG thấy nút 'Đã giao xong' (nút WP-03 cho cho_giao — kiểm bundle prod).")
        else:
            req0, dom0 = snap(pg); btn.first.click(timeout=5000); time.sleep(1)
            pg.get_by_role("button", name="Xác nhận đã giao").click(timeout=6000)
            acted(pg, req0, dom0); time.sleep(2)
            newtt = (sbjs(pg, f"const {{data}}=await sb.from('don_hang').select('trang_thai').eq('ma_don','{D}').limit(1); return {{data}};") or {}).get("data")
            newtt = newtt[0]["trang_thai"] if newtt else "?"
            print("  → trạng thái sau giao:", newtt)
            shot(pg, "9_giao"); RESULT[9] = 'OK' if newtt == "da_giao" else 'KET'
            if newtt != "da_giao": KET.append(f"BƯỚC 9: bấm giao xong nhưng trạng thái = {newtt} (chưa da_giao)")
    except Skipped as s:
        RESULT[9] = 'BO'; print(f"  ⏭  BỎ bước 9 (cần bước {s.args[0]} OK)")
    except StopRun:
        raise
    except (PWTimeout, AssertionError) as e:
        RESULT[9] = 'KET'; ket(pg, 9, str(e)[:140])
    except Exception as e:
        RESULT[9] = 'KET'; ket(pg, 9, f"{type(e).__name__}: {str(e)[:120]}")

    # ── 10 · TÀI CHÍNH ▸ Dòng tiền: phiếu thu 9.000.000 ──────────
    print(f"\n── BƯỚC 10 · Tài chính ▸ Dòng tiền: phiếu thu ({D}) ──")
    try:
        if RESULT.get(2) != 'OK': raise Skipped(2)
        login(pg, "taichinh")
        pg.locator('[data-tab="dongtien"]').click(timeout=5000)
        pg.locator('#pt_ma').wait_for(timeout=5000)
        pg.fill('#pt_ma', D); pg.fill('#pt_tien', "9000000")
        pg.select_option('#pt_loai', "thu_khi_giao")
        pg.fill('#pt_gc', "demo — chuyển khoản")
        req0, dom0 = snap(pg); pg.locator('#pt_luu').click(timeout=5000)
        if not acted(pg, req0, dom0): raise AssertionError("bấm 'Ghi phiếu' không gọi network")
        time.sleep(1); print("  pt_msg:", pg.locator('#pt_msg').inner_text()[:80])
        shot(pg, "10_phieuthu"); RESULT[10] = 'OK'
    except Skipped as s:
        RESULT[10] = 'BO'; print(f"  ⏭  BỎ bước 10 (cần bước {s.args[0]} OK)")
    except StopRun:
        raise
    except (PWTimeout, AssertionError) as e:
        RESULT[10] = 'KET'; ket(pg, 10, str(e)[:140])
    except Exception as e:
        RESULT[10] = 'KET'; ket(pg, 10, f"{type(e).__name__}: {str(e)[:120]}")

    # tóm tắt kết quả từng bước (OK/KẸT/BỎ)
    print("\n═══ TÓM TẮT BƯỚC ═══")
    for b in range(1, 11):
        print(f"  bước {b}: {RESULT.get(b, '—')}")
    print(f"\n⏱  chạy {int(time.time()-t0)}s · {N['i']} ảnh · đơn {D}")
    ctx.close()
    return D

# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    D = MA["don"]; stop_msg = None
    try:
        with sync_playwright() as pw:
            D = main(pw)
    except StopRun as e:
        stop_msg = str(e)
        print("\n⛔ DỪNG:", stop_msg)
        print("   → Báo cáo/kiểm D dưới đây phản ánh trạng thái tới lúc dừng. KHÔNG chạy các bước sau với mã giả.")
    if SMOKE: sys.exit(0)

    # ── BƯỚC D · tự kiểm bằng demo_kiem.mjs ──
    print("\n══════ BƯỚC D · KIỂM ĐƠN (demo_kiem.mjs) ══════")
    try:
        r = subprocess.run(["node", KIEM, D], cwd=str(pathlib.Path(__file__).resolve().parents[1]),
                           capture_output=True, text=True, timeout=120)
        print(r.stdout); print(r.stderr[:400] if r.stderr else "", end="")
    except Exception as e:
        print("  ⚠ demo_kiem lỗi:", str(e)[:120])

    # ── DỌN CUỐI VÒNG (L-66): xoa_demo đơn vừa chạy → 0 dấu vết. GIỮ tài khoản test_ (ngoại lệ luật, QD-51). ──
    if not stop_msg and D:
        print("\n══════ DỌN CUỐI · xoa_demo(", D, ") ══════")
        try:
            r = subprocess.run(["node", str(pathlib.Path(__file__).with_name("xoa_1_demo.mjs")), D],
                               cwd=str(pathlib.Path(__file__).resolve().parents[1]), capture_output=True, text=True, timeout=60)
            print(" ", (r.stdout or r.stderr or "").strip()[:200])
        except Exception as e:
            print("  ⚠ dọn cuối lỗi:", str(e)[:120])

    # ── BƯỚC 11 · WP-36 Đơn vị & hao hụt + toast back-flush (2 ca vàng/xanh; robot_wp36.py tự seed + dọn) ──
    print("\n══════ BƯỚC 11 · WP-36 (robot_wp36.py — vàng thiếu hệ số → nhập → xanh xuất bù) ══════")
    try:
        r = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("robot_wp36.py"))],
                           cwd=str(pathlib.Path(__file__).resolve().parents[1]), capture_output=True, text=True, timeout=300)
        for l in (r.stdout or "").strip().splitlines()[-6:]: print("  ", l)
        two = ("xuong_toast_vang" in (r.stdout or "")) and ("xuong_toast_xanh" in (r.stdout or "")) and r.returncode == 0
        RESULT[11] = 'OK' if two else 'KET'
        if not two: KET.append("BƯỚC 11 WP-36 (app): " + (r.stderr or r.stdout or "")[-160:])
    except Exception as e:
        RESULT[11] = 'HARNESS'; KET.append("BƯỚC 11 WP-36 (harness): " + str(e)[:140])

    _ok = sum(1 for v in RESULT.values() if v == 'OK')
    _har = [k for k, v in RESULT.items() if v == 'HARNESS']
    print(f"\n═══ robot {_ok}/{len(RESULT)} bước  (KET app: {[k for k,v in RESULT.items() if v=='KET']} · BỎ: {[k for k,v in RESULT.items() if v=='BO']} · HARNESS: {_har}) ═══")

    print("\n═══ LỖI UI / BƯỚC KẸT (kết quả pilot) ═══")
    if KET: [print(f"  • {k}") for k in KET]
    else: print("  (không bước nào kẹt)")
    print("\n═══ LỖI CONSOLE / NETWORK ═══")
    if ERRORS: [print(f"  {a} | {k} | {m}") for (a, k, m) in ERRORS[:40]]
    else: print("  (sạch)")
    if stop_msg:
        print("\n═══ DỪNG SỚM ═══\n  •", stop_msg)
    print(f"\n⏱  tổng {int(time.time()-t0)}s")
    print("HẾT — CEO kiểm mắt ảnh trong", str(OUT))
