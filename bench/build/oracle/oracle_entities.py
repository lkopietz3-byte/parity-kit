# Independent oracle for S3. Run: python3 -I oracle_entities.py
import json, html.entities
import os
ROOT=os.environ['BENCH_WORK']
D=ROOT+'/data/s3/'
w=json.load(open(D+'whatwg-entities.json'))
canon={k:v['characters'] for k,v in w.items()}          # ids like '&AElig;' and '&AElig'
py={'&'+k:v for k,v in html.entities.html5.items()}      # python 3.9 stdlib table, same id form
e2=json.load(open(D+'pkg-entities-2.2.0/package/lib/maps/entities.json'))
m2={'&'+k+';':v for k,v in e2.items()}                    # npm entities 2.2.0: names without & or ;
import re
def sem_less(path): return {'&'+k+';':v for k,v in json.load(open(path)).items()}
m1=sem_less(D+'pkg-entities-1.1.2/package/maps/entities.json')
m0=sem_less(D+'pkg-entities-1.0.0/package/maps/entities.json')
t=open(D+'pkg-html5-entities-1.0.0/package/index.js').read()
h5={'&'+k:v for k,v in json.loads(t.split('=',1)[1].strip().rstrip(';')).items()}
t=open(D+'pkg-character-entities-2.0.2/package/index.js').read(); ce={}
for line in t.split('\n'):
    m=re.match(r"^  (\w+): (?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"),?$",line)
    if m:
        val=m.group(2) if m.group(2) is not None else m.group(3)
        if '\\' in val: val=val.encode('utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8')
        ce['&'+m.group(1)+';']=val
out=[]
for mname,mir in (('python39-html5',py),('npm-entities-2.2.0',m2),('npm-entities-1.1.2',m1),('npm-entities-1.0.0',m0),('npm-html5-entities-1.0.0',h5),('npm-character-entities-2.0.2',ce)):
    for k in sorted(set(canon)|set(mir)):
        if k not in mir: t='missing'
        elif k not in canon: t='extra'
        else: t='match' if canon[k]==mir[k] else 'differ'
        out.append(dict(id=f'{mname}/{k}',mirror=mname,key=k,truth=t,canon=canon.get(k),mir=mir.get(k)))
with open(ROOT+'/out/s3_truth.jsonl','w') as f:
    for o in out: f.write(json.dumps(o,ensure_ascii=True)+'\n')
from collections import Counter
print(Counter((o['mirror'],o['truth']) for o in out))
json.dump({'canon':canon,'python39-html5':py,'npm-entities-2.2.0':m2,'npm-entities-1.1.2':m1,'npm-entities-1.0.0':m0,'npm-html5-entities-1.0.0':h5,'npm-character-entities-2.0.2':ce},open(D+'s3_maps.json','w'),ensure_ascii=True)
