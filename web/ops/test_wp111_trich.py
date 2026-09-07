#!/usr/bin/env python3
# WP-111 D-2 — test cắn HAI VẾ cho khâu trích ?raw.
#   Ca1 (bệnh a): comment chứa `<script>` → extractor MỚI (DOMParser y runtime) ĐÚNG; regex CŨ SAI (chứng đỏ được).
#   Ca2 (bệnh b): `</script>` trong comment → CỔNG (wp111_trich_raw.py) phải ĐỎ.
#   + kiểm FILE THẬT: số khối regex-cũ == số khối DOMParser-mới (đổi trích không đổi kết quả trên bản sạch).
import re, subprocess, sys, pathlib, tempfile
from playwright.sync_api import sync_playwright

PASS, FAIL = [], []
def ok(t, c, chi=''): (PASS if c else FAIL).append(t); print(('  ✓ ' if c else '  ✗ FAIL ') + t + ('' if c else ' → ' + chi))

def regex_cu(html):   # khâu CŨ (matchAll) — dễ nuốt nhầm
    return [m.group(1) for m in re.finditer(r'<script>([\s\S]*?)</script>', html)]

def dom_moi(pg, html):   # khâu MỚI y src/sale.js (DOMParser, bỏ src)
    return pg.evaluate("(h)=>{const d=new DOMParser().parseFromString(h,'text/html');return [...d.querySelectorAll('script:not([src])')].map(s=>s.textContent);}", html)

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome', headless=True); pg = b.new_context().new_page()

    # ── Ca1 (bệnh a): comment chứa <script> giữa các khối inline ──
    h1 = '<head><!-- WP: chỉ trích <script> không-src --></head><body><script>var a=1</script><script src="x.js"></script><script>var b=2</script></body>'
    moi = dom_moi(pg, h1); cu = regex_cu(h1)
    print(f"  [Ca1] MỚI(DOMParser)={len(moi)} khối {moi} · CŨ(regex)={len(cu)} khối")
    ok('Ca1 MỚI trích ĐÚNG 2 khối, nội dung nguyên vẹn', moi == ['var a=1', 'var b=2'], str(moi))
    ok('Ca1 CŨ(regex) SAI (cắn được — regex nuốt nhầm comment)', cu != ['var a=1', 'var b=2'], str(cu))

    # ── kiểm FILE THẬT: cũ vs mới bằng nhau trên bản sạch ──
    real = pathlib.Path('public/togihome_sale.html').read_text()
    rmoi = dom_moi(pg, real); rcu = regex_cu(real)
    ok('FILE THẬT: số khối MỚI == CŨ (bản sạch, đổi trích không đổi kết quả)', len(rmoi) == len(rcu) == 2, f"mới={len(rmoi)} cũ={len(rcu)}")
    b.close()

# ── Ca2 (bệnh b): </script> trong comment → cổng phải ĐỎ ──
h2 = '<head><!-- hỏng </script> ở đây --></head><body><script>var a=1</script></body>'
tmp = pathlib.Path(tempfile.mkdtemp()) / 'ca2.html'; tmp.write_text(h2)
r = subprocess.run([sys.executable, 'ops/wp111_trich_raw.py', str(tmp)], capture_output=True, text=True)
print("  [Ca2] cổng trả:", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[:80], f"(exit {r.returncode})")
ok('Ca2 cổng ĐỎ đúng khi comment chứa </script> (exit≠0)', r.returncode != 0 and '</script>' in r.stdout)

print(f"\n═══ WP-111 D-2 trích: {len(PASS)} pass / {len(FAIL)} fail ═══")
sys.exit(1 if FAIL else 0)
