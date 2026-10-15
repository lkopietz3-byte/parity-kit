# Seeded mutations of a real mirror (python39 html5 table) with labels by construction + independent diff. Run: python3 -I synth_entities.py
import json, random, unicodedata
import os
ROOT=os.environ['BENCH_WORK']
maps=json.load(open(ROOT+'/data/s3/s3_maps.json'))
canon=maps['canon']; base=dict(maps['python39-html5'])
rnd=random.Random(20261012)
keys=sorted(base)
plan={}   # key -> kind
mir=dict(base)
pool=rnd.sample(keys,len(keys))
def take(n): 
    out=[]
    while len(out)<n:
        k=pool.pop()
        if k not in plan: out.append(k)
    return out
vals=sorted(set(base.values()))
for k in take(100):
    new=rnd.choice(vals)
    while new==base[k]: new=rnd.choice(vals)
    mir[k]=new; plan[k]='value-swap'
for k in take(25): mir[k]=base[k]+'​'; plan[k]='zero-width-suffix'
for k in take(25): mir[k]=base[k]+' '; plan[k]='trailing-space'
nfd=0
for k in pool[::-1]:
    if k in plan: continue
    d=unicodedata.normalize('NFD',base[k])
    if d!=base[k] and nfd<25: mir[k]=d; plan[k]='nfd-equivalent'; nfd+=1
for k in take(50): del mir[k]; plan[k]='deleted'
extras=[]
for i in range(50):
    k=f'&Bogus{i};'; mir[k]='X'; plan[k]='added'
for k in take(30):
    if not k.startswith('&A') and not k.startswith('&a'): 
        pass
cyr=[k for k in take(600) if k[1] in 'AaEeOoCcpPxX'][:30]
for k in cyr:
    nk='&'+{'A':'А','a':'а','E':'Е','e':'е','O':'О','o':'о','C':'С','c':'с','P':'Р','p':'р','X':'Х','x':'х'}[k[1]]+k[2:]
    if k in mir:
        mir[nk]=mir.pop(k); plan[k]='homoglyph-renamed-from'; plan[nk]='homoglyph-renamed-to'
truth=[]
for k in sorted(set(canon)|set(mir)):
    if k not in mir: t='missing'
    elif k not in canon: t='extra'
    else: t='match' if canon[k]==mir[k] else 'differ'
    truth.append(dict(id=f'synth/{k}',key=k,truth=t,kind=plan.get(k,'untouched')))
json.dump(dict(canon=canon,mirror=mir),open(ROOT+'/data/s3/s3_synth_maps.json','w'),ensure_ascii=True)
with open(ROOT+'/out/s3_synth_truth.jsonl','w') as f:
    for t in truth: f.write(json.dumps(t,ensure_ascii=True)+'\n')
from collections import Counter
print(Counter((t['kind'],t['truth']) for t in truth if t['kind']!='untouched'), Counter(t['truth'] for t in truth if t['kind']=='untouched'))
