# Seeded injections of known stamp behaviors into real records; truth recomputed by the independent oracle. Run: python3 -I inj_plan.py
import json, random, datetime, copy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle_s2 as O
ROOT=O.ROOT
L0,L1='2026-09-09','2026-10-09'
B,A=O.recs(L0),O.recs(L1)
now_iso=O.man[L1]['committed']; now_ms=O.stamp_ms(now_iso)
rnd=random.Random(20261012)
elig=[i for i in sorted(B) if i in A and B[i][0]==A[i][0]]       # same blob => same content and same stamp
rnd.shuffle(elig)
used=set()
def take(n):
    out=[]
    for i in elig:
        if i in used: continue
        used.add(i); out.append(i)
        if len(out)==n: break
    return out
def fmt(ms, style='micro'):
    dt=datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S')+('.%06dZ'%(dt.microsecond))
def ms_of(i): return O.stamp_ms(B[i][1]['modified'])
variants={}
def mut(i,**kw):
    r=copy.deepcopy(A[i][1])
    for k,v in kw.items():
        if v is KeyError: r.pop(k,None)
        else: r[k]=v
    return r
# V1 stamp-only: random point between before stamp and now
v={}
for i in take(150):
    t0=ms_of(i); t=rnd.randint(t0+1000, now_ms-1000); v[i]=mut(i,modified=fmt(t))
variants['V1_stamp_only_later']=v
# V2 stamp + cosmetic details change (evidence by contract)
v={}
for i in take(100):
    t0=ms_of(i); t=rnd.randint(t0+1000, now_ms-1000); v[i]=mut(i,modified=fmt(t),details=A[i][1].get('details','')+' ')
variants['V2_stamp_plus_whitespace_details']=v
# V3 backward
v={}
for i in take(100):
    t0=ms_of(i); t=t0-rnd.randint(1000, 200*86400*1000); v[i]=mut(i,modified=fmt(t))
variants['V3_backward']=v
# V4 same instant, other notation
v={}
for i in take(100):
    t0=ms_of(i); dt=datetime.datetime.fromtimestamp(t0/1000,datetime.timezone.utc)
    kind=rnd.choice(['plus','minus','zeros'])
    base=A[i][1]['modified']
    if kind=='zeros': s=(base[:-1]+'000Z') if '.' in base else (base[:-1]+'.000Z')   # extra trailing fraction zeros (same instant)
    else:
        h=rnd.choice([1,2,5,8]); sign='+' if kind=='plus' else '-'
        loc=dt+datetime.timedelta(hours=h if sign=='+' else -h)
        s=loc.strftime('%Y-%m-%dT%H:%M:%S')+('.%06d'%loc.microsecond)+f'{sign}{h:02d}:00'
    v[i]=mut(i,modified=s)
variants['V4_same_instant_other_notation']=v
# V5 sub-millisecond move
v={}
for i in take(30):
    b=A[i][1]['modified']
    if '.' in b and b.endswith('Z') and len(b.split('.')[1])==7:   # 6 fraction digits + Z
        frac=b.split('.')[1][:-1]
        newf=frac[:3]+('999' if frac[3:]!='999' else '000')
        v[i]=mut(i,modified=b.split('.')[0]+'.'+newf+'Z')
variants['V5_submillisecond_move']=v
# V6 plus exactly 1 ms
v={}
for i in take(30):
    t0=ms_of(i); v[i]=mut(i,modified=fmt(t0+1000+1) if False else fmt((t0//1000)*1000+ (t0%1000)+1))
variants['V6_plus_one_ms']=v
# V7 future
v={}
for i in take(60):
    t=now_ms+rnd.randint(1000, 400*86400*1000); v[i]=mut(i,modified=fmt(t))
variants['V7_future']=v
# bulk boundary: pick a day with no real later-moves
real=O.pair_truth(L0,L1)
real_days={O.day(c['ta']) for c in real.values() if c['rel']=='later'}
d=datetime.date(2026,9,12)
while d.isoformat() in real_days: d+=datetime.timedelta(days=1)
D=d.isoformat()
def day_stamp(k): return f'{D}T{(k*7)%24:02d}:{(k*13)%60:02d}:{(k*17)%60:02d}.000000Z'
for n in (10,11,25):
    v={i:mut(i,modified=day_stamp(k)) for k,i in enumerate(take(n))}
    variants[f'V8_bulk_{n}_same_day']=v
v={}
for k,i in enumerate(take(15)): v[i]=mut(i,modified=day_stamp(k),details=A[i][1].get('details','')+' edited')
variants['V8_bulk_15_evidenced']=v
# V9 unparseable/odd stamps
odd=['2026-09-20 10:00:00Z','2026-09-20t10:00:00z','20260920','2026-09-20T10:00:00','2026-02-30','',' ','2026-09-20T10:00:00+0200','2026-09-20T24:00:00Z','2026-09-20T10:00:00.Z',1789000000000,None,'not a date','2026-9-2']
v={}
for k,i in enumerate(take(len(odd))): v[i]=mut(i,modified=odd[k])
variants['V9_odd_stamps']=v
v={i:mut(i,modified=KError) if False else mut(i,modified=KeyError) for i in take(10)}
variants['V9b_stamp_removed']=v
# V10 bare dates later than before (valid) and earlier
v={}
for i in take(40):
    t0=ms_of(i); t=rnd.randint(t0, now_ms)
    v[i]=mut(i,modified=datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).strftime('%Y-%m-%d'))
variants['V10_bare_dates']=v
out={'L0':L0,'L1':L1,'now':now_iso,'bulk_day':D,'variants':{}}
rows=[]
for name,ov in variants.items():
    T=O.pair_truth(L0,L1,A_override=ov)
    out['variants'][name]={'overrides':ov}
    cnt={}
    for i in ov:
        c=T[i]; fl=sorted(c['flags']); cnt[tuple(fl)]=cnt.get(tuple(fl),0)+1
        rows.append(dict(variant=name,id=i,src='synthetic',rel=c['rel'],truth=fl,new_stamp=ov[i].get('modified','<removed>') if isinstance(ov[i].get('modified','<removed>'),str) or ov[i].get('modified',1) is None else repr(ov[i].get('modified'))))
    # also: any real record whose truth changed due to injected bulk? not needed
    print(name,len(ov),{('/'.join(k) or 'none'):v for k,v in cnt.items()})
json.dump(out,open(ROOT+'/data/s2_inj_plan.json','w'))
with open(ROOT+'/out/s2_inj_truth.jsonl','w') as f:
    for r in rows: f.write(json.dumps(r)+'\n')
