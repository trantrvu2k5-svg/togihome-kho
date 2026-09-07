#!/usr/bin/env python3
# WP-111 D-2/D-3 — CỔNG trích ?raw (chạy TRƯỚC build MỖI app, qua prebuild:<app>).
#   Đối số:
#     <entry>.js  → BFS import cục bộ của app đó, gom mọi `*.html?raw` app THẬT SỰ dùng, quét (PER-APP).
#                   App không dùng ?raw → 0 file → XANH (không bị chặn vì app KHÁC có ?raw hỏng).
#     <file>.html → quét đúng file đó (test Ca2 gọi thẳng).
#     (không đối số) → dò TOÀN BỘ src/ (dùng cho `npm run cong:raw` rà tổng).
#   Mỗi file HTML: (a) comment chứa `<script`/`</script>` → ĐỎ file:dòng, THOÁT 2.
#                  (b) trích khối inline y RUNTIME (HTMLParser ~ DOMParser) · (c) node --check → đỏ THOÁT 1.
import sys, re, subprocess, tempfile, pathlib
from html.parser import HTMLParser

WEB = pathlib.Path(__file__).resolve().parents[1]
RE_IMP = re.compile(r"""(?:from|import)\s*['"]([^'"]+)['"]""")

def resolve_js(base, spec):
    p = (base.parent / spec)
    for c in (p, p.with_suffix('.js'), p.with_suffix('.mjs'), p / 'index.js'):
        if c.suffix in ('.js', '.mjs') and c.exists(): return c.resolve()
    return None

def raw_of_entry(entry):
    "BFS import cục bộ từ entry JS → tập .html?raw"
    seen, htmls, q = set(), [], [entry.resolve()]
    while q:
        js = q.pop()
        if js in seen or not js.exists(): continue
        seen.add(js)
        for spec in RE_IMP.findall(js.read_text()):
            if not spec.startswith('.'): continue           # bỏ npm package
            if spec.endswith('.html?raw'):
                h = (js.parent / spec[:-4]).resolve()
                if h.exists() and h not in htmls: htmls.append(h)
            elif '?' not in spec:
                r = resolve_js(js, spec)
                if r: q.append(r)
    return htmls

def all_raw_src():
    out = []
    for js in (WEB / 'src').rglob('*.js'):
        for m in re.finditer(r"""from ['"]([^'"]+\.html)\?raw['"]""", js.read_text()):
            p = (js.parent / m.group(1)).resolve()
            if p.exists() and p not in out: out.append(p)
    return out

class P(HTMLParser):
    def __init__(self): super().__init__(); self.blocks=[]; self._g=False; self._buf=''
    def handle_starttag(self, t, a):
        if t == 'script' and not dict(a).get('src'): self._g=True; self._buf=''
    def handle_endtag(self, t):
        if t == 'script' and self._g: self.blocks.append(self._buf); self._g=False
    def handle_data(self, d):
        if self._g: self._buf += d

def rel(f): return str(f.relative_to(WEB)) if str(f).startswith(str(WEB)) else str(f)

def quet(F):
    html = F.read_text()
    for m in re.finditer(r'<!--(.*?)-->', html, re.S):
        hit = '</script>' if '</script>' in m.group(1) else ('<script' if '<script' in m.group(1) else None)
        if hit:
            ln = html[:m.start()].count('\n') + 1
            print(f"  ✗ ĐỎ {rel(F)}:{ln} — HTML comment chứa `{hit}` → napApp() trích nhầm/gãy khối. Bỏ chữ thẻ khỏi comment rồi build lại.")
            sys.exit(2)
    p = P(); p.feed(html)
    tmp = pathlib.Path(tempfile.mkdtemp())
    for i, b in enumerate(p.blocks):
        f = tmp / f'blk{i}.js'; f.write_text(b)
        r = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ✗ ĐỎ {rel(F)} khối {i} node --check:\n{r.stderr[:300]}"); sys.exit(1)
    print(f"  ✓ {rel(F)}: {len(p.blocks)} khối inline, node --check SẠCH, 0 comment chứa thẻ script")

arg = sys.argv[1] if len(sys.argv) > 1 else None
if arg and arg.endswith('.html'):
    files = [pathlib.Path(arg).resolve()]
elif arg:                                   # entry .js → per-app
    files = raw_of_entry(pathlib.Path(arg).resolve())
else:
    files = all_raw_src()

if not files:
    who = f"app entry {arg}" if arg else "src/"
    print(f"  ✓ CỔNG ?raw: 0 file .html?raw ({who} không dùng ?raw) — cổng vẫn gác cho app tương lai")
    sys.exit(0)
print(f"  CỔNG ?raw quét {len(files)} file: {[rel(f) for f in files]}")
for F in files: quet(F)
sys.exit(0)
