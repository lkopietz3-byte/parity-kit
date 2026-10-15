# Labels the fresh holdout BEFORE the kit is run on it. This script never imports or calls the kit.
#
# Three source families that run4 did not use. In each, one table is canonical and several published copies are mirrors:
#   http-status : IANA HTTP status code registry  vs  Node, Python, npm statuses (2 versions) and Go reason phrases
#   spdx        : SPDX license list v3.29.0       vs  npm spdx-license-list and spdx-license-ids
#   gitea       : Gitea en-US UI strings          vs  twelve translations (printf verbs, tag names, URLs)
# A label is one of: match, missing (in the canonical table, not in the mirror), extra (in the mirror only),
# drift (in both, a compared field differs by exact equality).
#
# Run: BENCH_HOLDOUT_RAW=<dir of raw downloads> python3 -I bench/holdout/label.py
import csv, gzip, hashlib, http, json, os, re, sys
RAW = os.environ['BENCH_HOLDOUT_RAW']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(OUT, exist_ok=True)

def label(canon, mirror, fields):
    """canon, mirror: id -> {field: value}. Exact equality on each field both sides are asked for."""
    t = dict(missing=[], extra=[], drift=[])
    for k, a in canon.items():
        b = mirror.get(k)
        if b is None: t['missing'].append(k)
        elif any(a.get(f, '\0') != b.get(f, '\0') for f in fields): t['drift'].append(k)
    for k in mirror:
        if k not in canon: t['extra'].append(k)
    return {x: sorted(v) for x, v in t.items()}

def write(name, obj):
    path = os.path.join(OUT, name)
    with gzip.GzipFile(path, 'wb', mtime=0) as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    print(name, os.path.getsize(path), 'bytes')

summary = {}

# ---- http-status -------------------------------------------------------------------------------
canon = {}
for row in csv.DictReader(open(os.path.join(RAW, 'iana-http.csv'), encoding='utf-8', newline='')):
    v, d = row['Value'].strip(), row['Description'].strip()
    if not v.isdigit(): continue              # ranges such as 105-199
    if d in ('Unassigned', '(Unused)'): continue
    canon[v] = {'phrase': d}
mirrors = {}
mirrors['node'] = {k: {'phrase': p} for k, p in json.load(open(os.path.join(RAW, 'node-status-codes.json')))['codes'].items()}
mirrors['python-3.9-http'] = {str(s.value): {'phrase': s.phrase} for s in http.HTTPStatus}
for v in ('1.5.0', '2.0.2'):
    mirrors[f'npm-statuses-{v}'] = {k: {'phrase': p} for k, p in json.load(open(os.path.join(RAW, f'npm/statuses-{v}/package/codes.json'))).items()}
go = open(os.path.join(RAW, 'go-status-go1.26.0.go'), encoding='utf-8').read()
consts = dict(re.findall(r'^\s+(Status\w+)\s+=\s+(\d+)', go, re.M))
texts = re.findall(r'case\s+(Status\w+):\s*\n\s*return\s+"([^"]*)"', go)
mirrors['go-1.26-net-http'] = {consts[n]: {'phrase': p} for n, p in texts}
labels = {m: label(canon, mir, ['phrase']) for m, mir in mirrors.items()}
write('http-status.json.gz', dict(fields=['phrase'], canonical=canon, mirrors=mirrors))
summary['http-status'] = {m: {k: len(v) for k, v in l.items()} for m, l in labels.items()}
summary['http-status']['canonical'] = len(canon)

# ---- spdx ----------------------------------------------------------------------------------------
lic = json.load(open(os.path.join(RAW, 'spdx-licenses-v3.29.0.json'), encoding='utf-8'))['licenses']
canon = {x['licenseId']: dict(name=x['name'], osi=x['isOsiApproved'], deprecated=x['isDeprecatedLicenseId']) for x in lic}
full = json.load(open(os.path.join(RAW, 'npm/spdx-license-list-6.12.0/package/spdx-full.json'), encoding='utf-8'))
ids = json.load(open(os.path.join(RAW, 'npm/spdx-license-ids-3.0.24/package/index.json')))
dep = json.load(open(os.path.join(RAW, 'npm/spdx-license-ids-3.0.24/package/deprecated.json')))
mirrors = {
    'npm-spdx-license-list-6.12.0': {k: dict(name=v['name'], osi=v['osiApproved']) for k, v in full.items()},
    'npm-spdx-license-ids-3.0.24': {**{k: dict(deprecated=False) for k in ids}, **{k: dict(deprecated=True) for k in dep}},
}
fields = {'npm-spdx-license-list-6.12.0': ['name', 'osi'], 'npm-spdx-license-ids-3.0.24': ['deprecated']}
labels.update({m: label(canon, mir, fields[m]) for m, mir in mirrors.items()})
write('spdx.json.gz', dict(fields=fields, canonical=canon, mirrors=mirrors))
summary['spdx'] = {m: {k: len(v) for k, v in labels[m].items()} for m in mirrors}
summary['spdx']['canonical'] = len(canon)

# ---- gitea -----------------------------------------------------------------------------------------
def parse_ini(path):
    out = {}; section = ''
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line.strip() or line.lstrip()[0] in ';#': continue
        m = re.match(r'^\[([^\]]*)\]\s*$', line)
        if m: section = m.group(1); continue
        if '=' not in line: continue
        k, v = line.split('=', 1)
        out[(section + '.' if section else '') + k.strip()] = v.strip()
    return out
VERB = re.compile(r'%(?:\[\d+\])?[+\-# 0]*[0-9]*(?:\.[0-9]+)?[a-zA-Z]')
def facts(v):
    return dict(verbs=sorted(VERB.findall(v)), tags=sorted(set(re.findall(r'</?([A-Za-z][A-Za-z0-9]*)', v))), urls=sorted(re.findall(r'https?://[^\s"<>)\]}]+', v)))
src = parse_ini(os.path.join(RAW, 'gitea/locale_en-US.ini'))
canon = {k: facts(v) for k, v in src.items()}
locs = {}
for l in ('de-DE', 'fr-FR', 'ja-JP', 'es-ES', 'pt-BR', 'ru-RU', 'zh-CN', 'tr-TR', 'it-IT', 'pl-PL', 'nl-NL', 'sv-SE'):
    locs[l] = {k: facts(v) for k, v in parse_ini(os.path.join(RAW, f'gitea/locale_{l}.ini')).items()}
fields = ['verbs', 'tags', 'urls']
gl = {l: label(canon, m, fields) for l, m in locs.items()}
write('gitea.json.gz', dict(fields=fields, canonical=canon, mirrors=locs))
summary['gitea'] = {l: {k: len(v) for k, v in gl[l].items()} for l in locs}
summary['gitea']['canonical'] = len(canon)
labels.update({f'gitea/{l}': v for l, v in gl.items()})
# labels are keyed by family/mirror so one file covers everything
final = {}
for m in ('node', 'python-3.9-http', 'npm-statuses-1.5.0', 'npm-statuses-2.0.2', 'go-1.26-net-http'): final[f'http-status/{m}'] = labels[m]
for m in ('npm-spdx-license-list-6.12.0', 'npm-spdx-license-ids-3.0.24'): final[f'spdx/{m}'] = labels[m]
for l in locs: final[f'gitea/{l}'] = labels[f'gitea/{l}']
with open(os.path.join(OUT, 'labels.json'), 'w', encoding='utf-8') as fh: json.dump(final, fh, ensure_ascii=False, sort_keys=True, indent=0)
total = 0
for fam, d in summary.items():
    n = 0
    for m, c in d.items():
        if m == 'canonical': continue
        n += c['missing'] + c['extra'] + c['drift']
    print(fam, 'canonical', d['canonical'], 'problem labels', n)
print(json.dumps(summary, indent=0)[:3000])
