# S6 oracle: pypa/advisory-database (canonical) vs OSV.dev API copy (mirror). Run: python3 -I oracle_osv.py
import json, gzip, sys
import os
import importlib.util
spec=importlib.util.spec_from_file_location('o',os.path.join(os.path.dirname(os.path.abspath(__file__)),'oracle_s2.py')); O=importlib.util.module_from_spec(spec); spec.loader.exec_module(O)
ROOT=O.ROOT
osv=json.load(open(ROOT+'/data/s6_osv.json'))['records']
head=O.recs('2026-10-09')
cj=lambda v: json.dumps(v,sort_keys=True,ensure_ascii=True)
rows=[]; 
for i,m in sorted(osv.items()):
    c=head[i][1]
    ch=[]
    for k in sorted(set(c)|set(m)):
        if k=='id': continue
        if k not in m: ch.append((k,'missing-in-mirror'))
        elif k not in c: ch.append((k,'extra-in-mirror'))
        elif cj(c[k])!=cj(m[k]): ch.append((k,'different'))
    tc,tm=O.stamp_ms(c.get('modified')),O.stamp_ms(m.get('modified'))
    other=[x for x in ch if x[0]!='modified']
    hides = tc is not None and tc==tm and len(other)>0
    rows.append(dict(id=i,truth_changed=[list(x) for x in ch],truth_stampHidesDrift=hides,stamp_equal=(tc==tm),clean=(len(ch)==0)))
with open(ROOT+'/out/s6_truth.jsonl','w') as f:
    for r in rows: f.write(json.dumps(r)+'\n')
from collections import Counter
print('records',len(rows),'clean',sum(r['clean'] for r in rows),'hides',sum(r['truth_stampHidesDrift'] for r in rows))
print(Counter((f,c) for r in rows for f,c in r['truth_changed']).most_common(12))
json.dump({i:head[i][1] for i in osv},open(ROOT+'/data/s6_canon.json','w'))
