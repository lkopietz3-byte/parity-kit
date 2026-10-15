# S7 oracle for findHandTypedConstants, written from the README rules only. Run: python3 -I oracle_consts.py
import json, re, random, gzip, unicodedata
import os
ROOT=os.environ['BENCH_WORK']
st=json.load(gzip.open(ROOT+'/data/s2_blobs.json.gz','rt')); man=json.load(open(ROOT+'/data/s2_manifests.json'))
recs=[st[s] for p,s in man['2026-10-09']['files'].items() if p.endswith('.yaml')]
texts=[(r['id'],r.get('details') or '') for r in recs]
rnd=random.Random(20261012)
NUM=re.compile(r'[0-9]')
texts=[(i,t) for i,t in texts if re.search(r'[0-9]',t)]
sample=rnd.sample(texts,400)
REG=[('c1',1),('c10',10),('c2.5',2.5),('c0.5',0.5),('c100',100),('c1.2',1.2),('c3.1',3.1),('c1000',1000),('c8',8)]
# README rules -> candidate numeric tokens
TOK=re.compile(r'[0-9]+(?:,[0-9]{3}(?![0-9]))*(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?')
def is_wordch(ch): return ch!='' and (ch=='_' or ch.isalnum())
def tokens(t):
    out=[]; i=0
    # dotted runs (a.b.c...) are skipped whole
    skip=[(m.start(),m.end()) for m in re.finditer(r'[0-9]+(?:\.[0-9]+){2,}',t)]
    def in_skip(a,b): return any(s<=a and b<=e for s,e in skip)
    for m in TOK.finditer(t):
        a,b=m.start(),m.end(); s=m.group(0)
        if in_skip(a,b): continue
        before=t[a-1] if a>0 else ''; after=t[b] if b<len(t) else ''
        # zero padded
        intpart=s.split('.')[0].replace(',','')
        if len(intpart)>1 and intpart[0]=='0' : continue
        if is_wordch(before): continue          # letter/digit/underscore glued on the left
        if before=='.' and a>1 and t[a-2].isdigit(): continue   # part of a dotted run, e.g. 1.25 after "3."? handled above, extra guard
        if after=='_' : continue
        if after!='' and unicodedata.category(after)=='Nd' and not after.isascii(): continue
        if before!='' and unicodedata.category(before)=='Nd' and not before.isascii(): continue
        # sign
        neg=False
        if before=='-':
            pb=t[a-2] if a>1 else ''
            if not (is_wordch(pb) or pb in ')]}.\'"'): neg=True
        try: v=float(s.replace(',',''))
        except: continue
        out.append(dict(index=a,text=s,value=-v if neg else v))
    return out
rows=[]
for tid,t in sample:
    for tk in tokens(t):
        for cid,cv in REG:
            if tk['value']==cv and tk['value']>=0 and not (t[tk['index']-1:tk['index']]=='-' and tk['value']<0):
                rows.append(dict(tid=tid,const=cid,index=tk['index'],text=tk['text'],ctx=t[max(0,tk['index']-25):tk['index']+len(tk['text'])+25].replace('\n',' ')))
# Candidates the README rules exclude: every digit run whose value equals a registered constant and is not an oracle hit.
hit_keys={(r['tid'],r['const'],r['index']) for r in rows}
neg=[]
for tid,t in sample:
    for m in TOK.finditer(t):
        try: v=float(m.group(0).replace(',',''))
        except ValueError: continue
        for cid,cv in REG:
            if v==cv and (tid,cid,m.start()) not in hit_keys:
                neg.append(dict(tid=tid,const=cid,index=m.start(),text=m.group(0),ctx=t[max(0,m.start()-25):m.end()+25].replace('\n',' ')))
with open(ROOT+'/out/s7_oracle_negatives.jsonl','w') as f:
    for r in neg: f.write(json.dumps(r,ensure_ascii=False)+'\n')
print(len(neg),'excluded candidates')
json.dump(dict(reg=[{'id':c,'value':v} for c,v in REG],texts=[{'id':i,'text':t} for i,t in sample]),open(ROOT+'/data/s7_texts.json','w'))
with open(ROOT+'/out/s7_oracle.jsonl','w') as f:
    for r in rows: f.write(json.dumps(r,ensure_ascii=False)+'\n')
print(len(sample),'texts',len(rows),'oracle hits')
