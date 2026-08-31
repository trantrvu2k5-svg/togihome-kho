#!/usr/bin/env python3
# L-79f mục D — kiểm GTM trên sconcept.vn THẬT bằng Playwright. Mọi lượt src=KIEM-MAT-L79F.
#   Tiêm mã GTM (đổi src=gtm→KIEM-MAT-L79F để nhận diện dòng kiểm thử) qua addInitScript = giả lập GTM nạp.
#   ⚠ Worker /chat đang LIVE là bản L-79c (chưa đọc dd) → trên sổ live duong_dan/id_web NULL tới khi L-79g deploy.
#     Ta kiểm phần verify-được ở URL /chat (dd+ref) + mô phỏng RPC sau-deploy (tx→rollback) cho id_web=27.
import os, time, pathlib, subprocess, urllib.parse as up
from playwright.sync_api import sync_playwright

OPS = pathlib.Path(__file__).resolve().parent
SHOT = pathlib.Path.home() / "Downloads" / "l79f"; SHOT.mkdir(parents=True, exist_ok=True)
BASE = "https://sconcept.vn"
SP = BASE + "/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27"
WORKER = "togihome-chat.togihome-keo-lead.workers.dev/chat"

GTM = (OPS / "gtm_ref_chat.js").read_text().replace("&src=gtm", "&src=KIEM-MAT-L79F")

R = []
def note(t, ok, extra=""):
    R.append((t, ok)); print(("  ✅ " if ok else "  ❌ ") + t + (("  — " + extra) if extra else ""))
def lim(t, extra=""):
    print("  ⚠ HẠN CHẾ HARNESS: " + t + (("  — " + extra) if extra else ""))

# ── nối DB đọc sổ (đường owner qua psql của conn.mjs? dùng node cầu nhỏ) ──
def sql_scalar(q):
    r = subprocess.run(["node", "-e", f"""
import("./conn.mjs").then(async m=>{{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
const r=await c.query(`{q}`);console.log(JSON.stringify(r.rows));await c.end();}});
"""], cwd=OPS, capture_output=True, text=True)
    import json
    return json.loads(r.stdout.strip() or "[]")

def click_chat_url(reqs):
    for u in reqs:
        if WORKER in u: return u
    return None

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 420, "height": 860})
    ctx.add_init_script(GTM)
    pg = ctx.new_page()
    reqs = []
    pg.on("request", lambda r: reqs.append(r.url))

    base0 = sql_scalar("select coalesce(max(stt),0)::int mx, count(*)::int n from kho.click_chat")[0]
    print(f"\n── baseline sổ: count={base0['n']} · max_stt={base0['mx']} ──")

    def mo_fab_o(url):
        pg.goto(url, wait_until="networkidle", timeout=60000); time.sleep(2)
        # bấm FAB nhiều lần tới khi có link zalo VISIBLE (cụm bung ra sau animation)
        for _ in range(4):
            if pg.locator("a[href*='zalo.me']:visible").count(): break
            for sel in ["[class*=contact]", "text=Bạn cần tư vấn", "[class*=float]", "[class*=fixed]", "[class*=support]"]:
                try:
                    loc = pg.locator(sel).first
                    if loc.count() and loc.is_visible(): loc.click(timeout=2000); time.sleep(1); break
                except Exception: pass
            time.sleep(1)
        time.sleep(1)
    def mo_fab(): mo_fab_o(SP)

    def bam_visible(sel):
        # 1) click thường  2) force (nền gif động → Playwright coi 'not stable')  3) toạ độ tâm nút
        loc = pg.locator(sel + ":visible").first
        if not loc.count(): return False
        try: loc.scroll_into_view_if_needed(timeout=2000)
        except Exception: pass
        for how in ("thường", "force", "toạ độ"):
            try:
                if how == "thường": loc.click(timeout=3000)
                elif how == "force": loc.click(timeout=3000, force=True)
                else:
                    bb = loc.bounding_box()
                    if not bb: return False
                    pg.mouse.click(bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2)
                return True
            except Exception as e:
                last = str(e)[:50]
        print("   bấm hụt", sel, "—", last); return False

    # bấm theo RECT THẬT: tìm <a href> chứa substr, có kích thước render > 2px, cuộn giữa màn, click chuột tâm.
    #   Bỏ qua bộ lọc :visible của Playwright (rớt oan trên nút nền gif động), chỉ cần nút thật có mặt.
    def bam_href(substr):
        box = pg.evaluate("""(s)=>{
          const as=[...document.querySelectorAll('a[href]')].filter(a=>((a.getAttribute('href')||'').includes(s)));
          for(const a of as){ const r=a.getBoundingClientRect();
            if(r.width>2&&r.height>2){ a.scrollIntoView({block:'center'});
              const r2=a.getBoundingClientRect(); return {x:r2.x+r2.width/2, y:r2.y+r2.height/2}; } }
          return null; }""", substr)
        if not box: print("   bam_href: không thấy <a> render chứa", substr); return False
        try: pg.mouse.click(box["x"], box["y"]); return True
        except Exception as e: print("   bam_href click hụt", substr, "—", str(e)[:50]); return False

    # bấm bằng element.click() trên đúng <a> của site — kích hoạt ĐÚNG handler GTM thật (document capture).
    #   Dùng cho nút nằm trong popup FAB mà con trỏ Playwright không mở ổn định (nút Messenger). Có nêu rõ ở báo cáo.
    def bam_js(substr, avoid=None):
        return pg.evaluate("""([s,av])=>{
          const as=[...document.querySelectorAll('a[href]')].filter(a=>{const h=a.getAttribute('href')||'';
            return h.includes(s) && (!av || !h.includes(av));});
          if(!as.length) return false; as[0].click(); return true;
        }""", [substr, avoid])

    # ── CA 1: trang SP, bấm Zalo ──
    print("\n=== CA 1: SP …27 · bấm Zalo ===")
    reqs.clear(); mo_fab()
    if not bam_visible("a.zalo-button") and not bam_visible("a[href*='zalo.me']"): bam_href("zalo.me")
    time.sleep(3); pg.screenshot(path=str(SHOT / "D1_zalo.png"))
    cu = click_chat_url(reqs); final1 = pg.url
    print(f"   /chat URL: {cu}")
    print(f"   URL cuối:  {final1}")
    q = up.parse_qs(up.urlparse(cu).query) if cu else {}
    ref1 = (q.get('ref', [''])[0])
    note("1a. /chat có kenh=zalo", q.get('kenh', [''])[0] == 'zalo', cu or "")
    note("1b. ref dạng w-27-<nonce6>", bool(ref1) and ref1.startswith('w-27-') and len(ref1) == len('w-27-')+6, ref1)
    note("1c. dd = /san-pham/…27", up.unquote(q.get('dd', [''])[0]).endswith("thanh-lich.27"), up.unquote(q.get('dd',[''])[0]))
    note("1d. URL cuối là Zalo thật", "zalo.me" in final1, final1)

    # ── CA 2: trang SP, bấm "Tùy chỉnh" (Messenger) ──
    print("\n=== CA 2: SP …27 · bấm 'Tùy chỉnh' (Messenger) ===")
    reqs.clear(); mo_fab()
    okm = bam_js("m.me")
    if not okm: print("   bam_js m.me: không thấy anchor")
    time.sleep(3); pg.screenshot(path=str(SHOT / "D2_messenger.png"))
    cu2 = click_chat_url(reqs); final2 = pg.url
    print(f"   /chat URL: {cu2}")
    print(f"   URL cuối:  {final2}")
    q2 = up.parse_qs(up.urlparse(cu2).query) if cu2 else {}
    ref2 = q2.get('ref', [''])[0]
    note("2a. /chat có kenh=messenger", q2.get('kenh', [''])[0] == 'messenger', cu2 or "")
    note("2b. ref w-27-<nonce>", ref2.startswith('w-27-'), ref2)
    # xác minh đích m.me mang ?ref nguyên vẹn: curl /chat không theo redirect
    loc2 = ""
    if cu2:
        cr = subprocess.run(["curl", "-s", "-D", "-", "-o", "/dev/null", "--tlsv1.2", "--max-time", "15", cu2],
                            capture_output=True, text=True)
        for ln in cr.stdout.splitlines():
            if ln.lower().startswith("location:"): loc2 = ln.split(":", 1)[1].strip()
    note("2c. đích m.me/576847645509797?ref=w-27-… nguyên vẹn", ("m.me/576847645509797" in loc2 and ("ref="+ref2) in loc2), loc2)

    # ── CA 3: trang chủ, bấm Zalo ──
    print("\n=== CA 3: trang chủ / · bấm Zalo ===")
    reqs.clear(); mo_fab_o(BASE + "/")
    if not bam_js("zalo.me"): print("   bam_js zalo.me (home): không thấy anchor")
    time.sleep(3)
    cu3 = click_chat_url(reqs)
    q3 = up.parse_qs(up.urlparse(cu3).query) if cu3 else {}
    ref3 = q3.get('ref', [''])[0]
    print(f"   /chat URL: {cu3}")
    note("3a. ref w-0-<nonce> (id_web 0 ở trang chủ)", ref3.startswith('w-0-'), ref3)
    note("3b. dd = /", up.unquote(q3.get('dd', [''])[0]) == '/', up.unquote(q3.get('dd',[''])[0]))

    # ── CA 4: bấm LINK SẢN PHẨM bình thường → KHÔNG chuyển /chat, sổ KHÔNG tăng ──
    print("\n=== CA 4: bấm link sản phẩm thường → không /chat ===")
    mid = sql_scalar("select count(*)::int n from kho.click_chat")[0]['n']
    reqs.clear()
    pg.goto(BASE + "/", wait_until="networkidle", timeout=60000); time.sleep(2)
    got_chat = False; navd = ""
    # bấm MỘT <a> nội bộ KHÔNG phải chat (đây là "link thường") qua element.click() → GTM phải BỎ QUA
    href_th = pg.evaluate("""()=>{const bad=/zalo|m\\.me|messenger|ig\\.me|tel:|^#|^javascript/i;
      const a=[...document.querySelectorAll('a[href]')].find(a=>{const h=a.getAttribute('href')||'';
        return h && !bad.test(h) && (h.startsWith('/')||h.startsWith('http')) && !h.includes('/chat');});
      if(!a) return null; const h=a.href; a.click(); return h;}""")
    time.sleep(3); navd = pg.url
    print(f"   link thường bấm: {href_th}  → URL sau: {navd}")
    got_chat = any(WORKER in u for u in reqs)
    time.sleep(2)
    aft4 = sql_scalar("select count(*)::int n from kho.click_chat")[0]['n']
    note("4a. đi tới trang sản phẩm, KHÔNG rẽ /chat", (not got_chat) and ("/san-pham/" in navd), navd)
    note("4b. sổ KHÔNG tăng khi bấm link thường", aft4 == mid, f"{mid}→{aft4}")

    # ── CA 5: hai lần bấm Zalo → hai nonce KHÁC ──
    print("\n=== CA 5: hai lần bấm Zalo → nonce khác nhau ===")
    nonces = []
    for i in range(2):
        reqs.clear(); mo_fab()
        if not bam_visible("a.zalo-button") and not bam_visible("a[href*='zalo.me']"): bam_href("zalo.me")
        time.sleep(2)
        cu5 = click_chat_url(reqs)
        q5 = up.parse_qs(up.urlparse(cu5).query) if cu5 else {}
        nonces.append(q5.get('ref', [''])[0])
    print(f"   ref lần 1: {nonces[0]}\n   ref lần 2: {nonces[1]}")
    note("5. hai nonce KHÁC nhau", bool(nonces[0]) and nonces[0] != nonces[1], f"{nonces}")

    b.close()

# ── mô phỏng Worker-SAU-deploy (chưa deploy được ở lệnh này): RPC nhận dd → id_web=27, tx→ROLLBACK ──
print("\n=== MÔ PHỎNG Worker sau L-79g deploy (RPC trực tiếp, tx→rollback, KHÔNG để lại dòng) ===")
sim = subprocess.run(["node", "-e", """
import("./conn.mjs").then(async m=>{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
await c.query('begin');
const id=(await c.query(`select kho.ghi_click_chat('w-27-abc123','zalo','https://zalo.me/x','KIEM-MAT-L79F',null,'/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27') id`)).rows[0].id;
const r=(await c.query('select duong_dan,id_web,kenh,ref_web,ref_hop_le from kho.click_chat where id=$1',[id])).rows[0];
console.log(JSON.stringify(r));
await c.query('rollback'); await c.end();});
"""], cwd=OPS, capture_output=True, text=True)
print("   " + (sim.stdout.strip() or sim.stderr.strip()))

# ── liệt kê dòng sinh trong lệnh này ──
print("\n── dòng sổ sinh trong L-79f (src=KIEM-MAT-L79F) ──")
import json
rows = subprocess.run(["node", "-e", """
import("./conn.mjs").then(async m=>{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
const r=await c.query(`select stt,kenh,ref_web,ref_hop_le,duong_dan,id_web,nguon_trang from kho.click_chat where nguon_trang='KIEM-MAT-L79F' order by stt`);
console.log(JSON.stringify(r.rows));await c.end();});
"""], cwd=OPS, capture_output=True, text=True)
data = json.loads(rows.stdout.strip() or "[]")
for x in data:
    print(f"   stt={x['stt']} · {x['kenh']:9} · ref={x['ref_web']} · hop_le={x['ref_hop_le']} · dd={x['duong_dan']} · id_web={x['id_web']}")
print(f"   → {len(data)} dòng · stt = {', '.join(str(x['stt']) for x in data)}")
tot = subprocess.run(["node", "-e", """
import("./conn.mjs").then(async m=>{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
const r=await c.query('select count(*)::int n from kho.click_chat');console.log(r.rows[0].n);await c.end();});
"""], cwd=OPS, capture_output=True, text=True)
print(f"\nSELECT count(*) FROM kho.click_chat = {tot.stdout.strip()}")

print("\n── TỔNG KẾT CA ──")
ok = sum(1 for _, v in R if v); print(f"   {ok}/{len(R)} khẳng định pass")
for t, v in R:
    if not v: print("   ❌ " + t)
