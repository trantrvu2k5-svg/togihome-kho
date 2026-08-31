#!/usr/bin/env python3
# L-79h muc C — kiem GTM qua DUONG TAI THAT: chen <script src=.../gtm.js> SAU khi DOM san (nhu GTM All Pages),
#   qua Trusted Types policy (sconcept.vn bat require-trusted-types-for 'script'). KHONG tiem ma truc tiep.
#   gtm.js phuc vu tu Worker hardcode &src=gtm -> nhan dien dong kiem thu bang ref_web (nonce), liet ke stt.
import time, pathlib, subprocess, json, urllib.parse as up
from playwright.sync_api import sync_playwright

OPS = pathlib.Path(__file__).resolve().parent
BASE = "https://sconcept.vn"
SP = BASE + "/san-pham/sofa-bed-sophia-concept-sb19-phong-cach-toi-gian-thanh-lich.27"
WORKER = "togihome-chat.togihome-keo-lead.workers.dev/chat"
GTMSRC = "https://togihome-chat.togihome-keo-lead.workers.dev/gtm.js"
# tiem <script src> qua TT policy (giong cach GTM lam), goi SAU khi DOM san
INJECT = ("(function(){var url='%s';var su=url;"
          "if(window.trustedTypes&&trustedTypes.createPolicy){var pol=trustedTypes.createPolicy('togi-l79h-'+Math.floor(Math.random()*1e6),{createScriptURL:function(s){return s;}});su=pol.createScriptURL(url);}"
          "var s=document.createElement('script');s.src=su;s.async=true;document.head.appendChild(s);})();") % GTMSRC

def sql(q, args=None):
    r = subprocess.run(["node","-e",f"""
import("./conn.mjs").then(async m=>{{const pg=(await import("pg")).default;const c=new pg.Client(await m.docConfig());await c.connect();
const r=await c.query({json.dumps(q)}, {json.dumps(args or [])});console.log(JSON.stringify(r.rows));await c.end();}});
"""], cwd=OPS, capture_output=True, text=True)
    return json.loads(r.stdout.strip() or "[]")

R=[]
def note(t,ok,ex=""): R.append(ok); print(("  OK  " if ok else "  FAIL")+" "+t+(("  -- "+ex) if ex else ""))

with sync_playwright() as p:
    b=p.chromium.launch(headless=True); ctx=b.new_context(viewport={"width":420,"height":860})
    pg=ctx.new_page(); reqs=[]; pg.on("request", lambda r: reqs.append(r.url))
    def chat_url(): return next((u for u in reqs if WORKER in u), None)
    def load(url):   # goto + tiem <script src> that + cho attach
        pg.goto(url, wait_until="domcontentloaded", timeout=60000); time.sleep(3)
        pg.evaluate(INJECT); time.sleep(4)   # cho gtm.js tai + thuc thi + gan listener
    def bam(substr, avoid=None):
        return pg.evaluate("""([s,av])=>{var as=[...document.querySelectorAll('a[href]')].filter(a=>{var h=a.getAttribute('href')||'';return h.includes(s)&&(!av||!h.includes(av));});if(!as.length)return false;as[0].click();return true;}""",[substr,avoid])

    base = sql("select count(*)::int n from kho.click_chat")[0]["n"]
    print(f"baseline count={base}")
    refs=[]

    print("\n=== CA1: SP -> Zalo (qua <script src> that) ===")
    reqs.clear(); load(SP)
    note("0. gtm.js TAI tu Worker", any("gtm.js" in u for u in reqs), GTMSRC)
    bam("zalo.me/0908386258"); time.sleep(3)
    cu=chat_url(); q=up.parse_qs(up.urlparse(cu).query) if cu else {}
    ref1=q.get("ref",[""])[0]; refs.append(ref1)
    note("1a. re /chat kenh=zalo dd=/san-pham/..27", q.get("kenh",[""])[0]=="zalo" and up.unquote(q.get("dd",[""])[0]).endswith("thanh-lich.27"), cu or "")
    time.sleep(2)
    row=sql("select duong_dan,id_web,ref_hop_le,nguon_trang from kho.click_chat where ref_web=$1 order by stt desc limit 1",[ref1]) if ref1 else []
    if row:
        r=row[0]; note("1b. so co duong_dan + id_web=27 (src=gtm)", r["id_web"]==27 and (r["duong_dan"] or "").endswith("thanh-lich.27"), json.dumps(r))
    else: note("1b. so co duong_dan + id_web=27", False, "khong thay ref="+str(ref1))

    print("\n=== CA2: banner 0966773095 -> khong re ===")
    n0=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    reqs.clear(); load(SP)
    okb=bam("zalo.me/0966773095", avoid="0908386258"); time.sleep(3)
    n1=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    note("2. banner 0966773095 KHONG re, so khong tang", okb and n1==n0 and not chat_url(), f"click={okb} {n0}->{n1}")

    print("\n=== CA3: link thuong -> khong re ===")
    n0=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    reqs.clear(); load(BASE+"/")
    href=pg.evaluate("""()=>{var bad=/zalo|m\\.me|messenger|ig\\.me|tel:|^#|^javascript/i;var a=[...document.querySelectorAll('a[href]')].find(a=>{var h=a.getAttribute('href')||'';return h&&!bad.test(h)&&(h.startsWith('/')||h.startsWith('http'))&&!h.includes('/chat');});if(!a)return null;var h=a.href;a.click();return h;}""")
    time.sleep(3); got=bool(chat_url()); n1=sql("select count(*)::int n from kho.click_chat")[0]["n"]
    note("3. link thuong ("+str(href)+") KHONG re, so khong tang", (not got) and n1==n0, f"chat={got} {n0}->{n1}")
    b.close()

rows=[]
for rf in refs:
    if rf: rows += sql("select stt,kenh,ref_web,duong_dan,id_web,nguon_trang from kho.click_chat where ref_web=$1",[rf])
print("\n-- dong sinh trong L-79h (nhan theo ref) --")
for x in rows: print(f"   stt={x['stt']} · {x['kenh']} · ref={x['ref_web']} · dd={x['duong_dan']} · id_web={x['id_web']} · nguon={x['nguon_trang']}")
print(f"   -> {len(rows)} dong · stt = {', '.join(str(x['stt']) for x in rows)}")
tot=sql("select count(*)::int n from kho.click_chat")[0]["n"]
print(f"\ncount(*) click_chat = {tot}")
print(f"\n=== {sum(R)}/{len(R)} OK ===")
