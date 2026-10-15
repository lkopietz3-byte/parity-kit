# Derives bench/data/i18n-<project>.json.gz from raw locale files (MIT and Apache-2.0 projects only).
# The facts per string (placeholder names, tag names, URLs) and the labels come from this script, which never
# calls the kit. Run: BENCH_RAW=<dir with excalidraw/ and jitsi/ checkouts> python3 -I build/i18n.py
import gzip, json, os, re, sys
RAW = os.environ['BENCH_RAW']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
PROJECTS = {
  'excalidraw': dict(dir=RAW+'/excalidraw/packages/excalidraw/locales', canon='en.json', style='i18next',
                     pick=lambda f: f.endswith('.json') and f not in ('en.json','languages.json','percentages.json'), loc=lambda f: f[:-5]),
  'jitsi': dict(dir=RAW+'/jitsi/lang', canon='main.json', style='i18next',
                pick=lambda f: f.startswith('main-') and f.endswith('.json'), loc=lambda f: f[5:-5]),
}
def flatten(o):
    out = {}
    def rec(v, p):
        if isinstance(v, dict):
            for k, x in v.items(): rec(x, (p + '.' + k) if p else k)
        else: out[p] = v
    rec(o, '')
    return out
def ph(s): return sorted(set(m.group(1) for m in re.finditer(r'\{\{\s*([^{}\s,]+)', s)))
def tags(s): return sorted(set(re.findall(r'</?([A-Za-z][A-Za-z0-9]*)', s)))
def urls(s): return sorted(re.findall(r'https?://[^\s"<>)\]}]+', s))
def facts(v):
    if not isinstance(v, str): return None
    return [ph(v), tags(v), urls(v)]
def enc(f): return 0 if f == [[], [], []] else f
for proj, c in PROJECTS.items():
    cf = flatten(json.load(open(os.path.join(c['dir'], c['canon']))))
    canon = {k: facts(v) for k, v in cf.items()}
    assert all(v is not None for v in canon.values()), proj
    locales = {}
    for f in sorted(os.listdir(c['dir'])):
        if not c['pick'](f): continue
        lf = flatten(json.load(open(os.path.join(c['dir'], f))))
        mirror = {}; truth = dict(missing=[], extra=[], drift=[])
        for k in sorted(set(cf) | set(lf)):
            if k not in lf: truth['missing'].append(k); continue
            b = facts(lf[k]); mirror[k] = enc(b)
            if k not in cf: truth['extra'].append(k); continue
            if b is None: raise SystemExit('non-string value in ' + f + ':' + k)
            if canon[k] != b: truth['drift'].append(k)
        locales[c['loc'](f)] = dict(mirror=mirror, truth=truth)
    data = dict(project=proj, fields=['ph', 'tags', 'urls'], canonical={k: enc(v) for k, v in canon.items()}, locales=locales)
    path = os.path.join(OUT, f'i18n-{proj}.json.gz')
    with gzip.GzipFile(path, 'wb', mtime=0) as fh: fh.write(json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    n = sum(len(set(cf) | set(l['mirror']) | set(l['truth']['missing'])) for l in locales.values())
    print(proj, 'locales', len(locales), 'canonical keys', len(cf), 'bytes', os.path.getsize(path))
