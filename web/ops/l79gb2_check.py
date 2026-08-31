#!/usr/bin/env python3
# L-79g-B2 buoc 4 — kiem ban GTM ASCII chay y het ban cu. src=KIEM-MAT-L79GB2.
#   Worker /chat da deploy ban doc dd (buoc A2) -> sổ phai co duong_dan + id_web=27 o ca 1.
import time, pathlib, subprocess, json, urllib.parse as up
from playwright.sync_api import sync_playwright

OPS = pathlib.Path(__file__).resolve().parent
BASE = "https://sconcept.vn"
SP = BASE + "/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27"
WORKER = "togihome-chat.togihome-keo-lead.workers.dev/chat"
GTM = (OPS / "gtm_ref_chat.js").read_text().replace("&src=gtm", "&src=KIEM-MAT-L79GB2")

def sql(q, args=None):
    a = json.dumps(args or [])
    r = subprocess.run(["node", "-e", f"""
import("./conn.mjs").then(async m=>{{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
const r=await c.query({json.dumps(q)}, {a});console.log(JSON.stringify(r.rows));await c.end();}});
"""], cwd=OPS, capture_output=True, text=True)
    return json.loads(r.stdout.strip() or "[]")

R=[]
def note(t,ok,ex=""): R.append(ok); print(("  OK  " if ok else "  FAIL")+" "+t+(("  -- "+ex) if ex else ""))

with sync_playwright() as p:
    b=p.chromium.launch(headless=True); ctx=b.new_context(viewport={"width":420,"height":860})
    ctx.add_init_script(GTM); pg=ctx.new_page(); reqs=[]; pg.on("request", lambda r: reqs.append(r.url))
    def chat_url(): return next((u for u in reqs if WORKER in u), None)
    def mo_fab(url):
        pg.goto(url, wait_until="networkidle", timeout=60000); time.sleep(2)
        for _ in range(4):
            if pg.locator("a[href*='zalo.me']:visible").count(): break
            for s in ["[class*=contact]","text=Ban can tu van","[class*=float]","[class*=fixed]"]:
                try:
                    l=pg.locator(s).first
                    if l.count() and l.is_visible(): l.click(timeout=2000); time.sleep(1); break
                except Exception: pass
            time.sleep(1)
        time.sleep(1)
    def bam_js(substr, avoid=None):
        return pg.evaluate("""([s,av])=>{const as=[...document.querySelectorAll('a[href]')].filter(a=>{const h=a.getAttribute('href')||'';return h.includes(s)&&(!av||!h.includes(av));});if(!as.length)return false;as[0].click();return true;}""",[substr,avoid])

    base = sql("select count(*)::int n from kho.click_chat")[0]["n"]
    print(f"baseline count={base}")

    # CA1: SP -> Zalo 0908386258
    print("\n=== CA1: SP -> Zalo (0908386258) ===")
    reqs.clear(); mo_fab(SP); bam_js("zalo.me/0908386258"); time.sleep(3)
    cu=chat_url(); q=up.parse_qs(up.urlparse(cu).query) if cu else {}
    ref1=q.get("ref",[""])[0]
    note("1a. re /chat kenh=zalo, dd=/san-pham/..27", q.get("kenh",[""])[0]=="zalo" and up.unquote(q.get("dd",[""])[0]).endswith("thanh-lich.27"), cu or "")
    time.sleep(2)
    row = sql("select duong_dan,id_web,kenh,ref_hop_le from kho.click_chat where ref_web=$1 order by stt desc limit 1",[ref1]) if ref1 else []
    if row:
        r=row[0]; note("1b. so co duong_dan + id_web=27", r["id_web"]==27 and (r["duong_dan"] or "").endswith("thanh-lich.27"), json.dumps(r))
    else: note("1b. so co duong_dan + id_web=27", False, "khong thay dong ref="+ref1)

    # CA2: banner Zalo 0966773095 -> KHONG re /chat
    print("\n=== CA2: banner Zalo 0966773095 -> khong re ===")
    n0=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    reqs.clear(); pg.goto(SP, wait_until="networkidle", timeout=60000); time.sleep(2)
    okb=bam_js("zalo.me/0966773095", avoid="0908386258"); time.sleep(3)
    got=any(WORKER in u for u in reqs); n1=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    note("2a. banner 0966773095 KHONG re /chat", okb and (not got), f"click={okb} chat={got}")
    note("2b. so KHONG tang", n1==n0, f"{n0}->{n1}")

    # CA3: link san pham thuong -> KHONG re
    print("\n=== CA3: link thuong -> khong re ===")
    n0=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    reqs.clear(); pg.goto(BASE+"/", wait_until="networkidle", timeout=60000); time.sleep(2)
    href=pg.evaluate("""()=>{const bad=/zalo|m\\.me|messenger|ig\\.me|tel:|^#|^javascript/i;const a=[...document.querySelectorAll('a[href]')].find(a=>{const h=a.getAttribute('href')||'';return h&&!bad.test(h)&&(h.startsWith('/')||h.startsWith('http'))&&!h.includes('/chat');});if(!a)return null;const h=a.href;a.click();return h;}""")
    time.sleep(3); got=any(WORKER in u for u in reqs); n1=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    note("3a. link thuong ("+str(href)+") KHONG re /chat", (not got), f"chat={got}")
    note("3b. so KHONG tang", n1==n0, f"{n0}->{n1}")
    b.close()

# stt sinh trong lenh nay
rows = sql("select stt,kenh,ref_web,duong_dan,id_web from kho.click_chat where nguon_trang=$1 order by stt",["KIEM-MAT-L79GB2"])
print("\n-- dong sinh trong L-79g-B2 --")
for x in rows: print(f"   stt={x['stt']} · {x['kenh']} · ref={x['ref_web']} · dd={x['duong_dan']} · id_web={x['id_web']}")
print(f"   -> {len(rows)} dong · stt = {', '.join(str(x['stt']) for x in rows)}")
tot = sql("select count(*)::int n from kho.click_chat")[0]["n"]
print(f"\ncount(*) click_chat = {tot}")
print(f"\n=== {sum(R)}/{len(R)} OK ===")
