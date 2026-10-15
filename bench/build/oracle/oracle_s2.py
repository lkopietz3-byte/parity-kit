# Independent oracle for S2 (real history pairs). Python reimplementation of the documented contract; written without looking at kit output.
# Run: python3 -I oracle_s2.py
import json, gzip, re, datetime
from collections import Counter, defaultdict
import os
ROOT=os.environ['BENCH_WORK']
st=json.load(gzip.open(ROOT+'/data/s2_blobs.json.gz','rt'))
man=json.load(open(ROOT+'/data/s2_manifests.json'))
STAMP=re.compile(r'^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?(Z|[+-][0-9]{2}:[0-9]{2})$')
BARE=re.compile(r'^([0-9]{4})-([0-9]{2})-([0-9]{2})$')
def is_bare(v): return isinstance(v,str) and BARE.match(v) is not None
def stamp_ms(v):
    """strict RFC3339 subset per README: returns epoch ms (fraction truncated to ms) or None. A bare date is midnight UTC."""
    if not isinstance(v,str): return None
    mb=BARE.match(v)
    if mb:
        try: return int(datetime.datetime(int(mb.group(1)),int(mb.group(2)),int(mb.group(3)),tzinfo=datetime.timezone.utc).timestamp())*1000
        except ValueError: return None
    m=STAMP.match(v)
    if not m: return None
    y,mo,d,h,mi,s,fr,z=m.groups()
    try:
        base=datetime.datetime(int(y),int(mo),int(d),int(h),int(mi),int(s or 0),tzinfo=datetime.timezone.utc)
    except ValueError: return None
    off=0
    if z!='Z':
        if int(z[1:3])>23 or int(z[4:6])>59: return None
        sign=1 if z[0]=='+' else -1; off=sign*(int(z[1:3])*60+int(z[4:6]))
    ms=int((fr or '0').ljust(3,'0')[:3])
    return int(base.timestamp())*1000+ms-off*60000
def recs(label):
    files=man[label]['files']; out={}
    for p,sha in files.items():
        if not p.endswith('.yaml'): continue
        r=st[sha]; out[r['id']]=(sha,r)
    return out
def classify(b,a,now_ms):
    """b,a = (sha,record) or None. returns dict of flags (set) + label"""
    if b is None: return dict(rel='added',flags=set())
    if a is None: return dict(rel='removed',flags=set())
    sb,rb=b; sa,ra=a
    tb,ta=stamp_ms(rb.get('modified')),stamp_ms(ra.get('modified'))
    ev=sorted(k for k in set(rb)|set(ra) if k not in ('modified','id') and rb.get(k,'\0MISSING')!=ra.get(k,'\0MISSING'))
    flags=set()
    if ta is None or tb is None: flags.add('unknown'); rel='unparseable'
    else:
        if ta>tb: rel='later'
        elif ta<tb: rel='earlier'; flags.add('backward')
        else: rel='same'
        if rel=='later' and not ev: flags.add('stampOnly')
        if now_ms is not None and ((ta-14*3600*1000>now_ms) if is_bare(ra.get('modified')) else (ta>now_ms)): flags.add('future')
    return dict(rel=rel,flags=flags,evidence=ev,ta=ta,tb=tb)
def day(ms): return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc).strftime('%Y-%m-%d')
def pair_truth(l0,l1,thr=10,A_override=None):
    B,A=recs(l0),recs(l1)
    if A_override:
        for i,r in A_override.items(): A[i]=('mut',r)
    now_ms=stamp_ms(man[l1]['committed'].replace('Z','Z'))
    out={}
    groups=defaultdict(list)
    for i in set(B)|set(A):
        c=classify(B.get(i),A.get(i),now_ms); out[i]=c
        if c['rel']=='later': groups[day(c['ta'])].append(i)
    for d,ids in groups.items():
        if len(ids)>thr:
            for i in ids: out[i]['flags'].add('bulkBump'); out[i]['bulkday']=d
    return out
if __name__=='__main__':
    labels=sorted(man)
    pairs=[]
    daily=[l for l in labels if l>='2026-07-01']
    for x,y in zip(daily,daily[1:]): pairs.append((x,y,'daily'))
    for l in ('2026-10-08','2026-10-02','2026-09-09','2026-07-11','2026-04-12','2026-01-12'): pairs.append((l,'2026-10-09','horizon'))
    rows=[]; summ=[]
    for l0,l1,kind in pairs:
        if man[l0]['commit']==man[l1]['commit']:
            summ.append(dict(pair=f'{l0}>{l1}',kind=kind,same_commit=True)); continue
        T=pair_truth(l0,l1)
        cnt=Counter(); fl=Counter()
        for i,c in T.items():
            cnt[c['rel']]+=1
            for f in c['flags']: fl[f]+=1
            interesting = c['rel'] in ('added','removed') or c['flags'] or c['rel'] in ('later','earlier') or c.get('evidence')
            if interesting:
                rows.append(dict(pair=f'{l0}>{l1}',kind=kind,id=i,src='real',rel=c['rel'],truth=sorted(c['flags']),evidence=c.get('evidence',[]),bulkday=c.get('bulkday')))
        summ.append(dict(pair=f'{l0}>{l1}',kind=kind,same_commit=False,records=len(T),rel=dict(cnt),flags=dict(fl)))
    json.dump(summ,open(ROOT+'/out/s2_real_oracle_summary.json','w'))
    with open(ROOT+'/out/s2_real_truth.jsonl','w') as f:
        for r in rows: f.write(json.dumps(r)+'\n')
    tot=Counter()
    for s in summ:
        for k,v in (s.get('flags') or {}).items(): tot[k]+=v
    print(len(pairs),'pairs; interesting rows',len(rows)); print('flag totals',dict(tot))
    print([ (s['pair'],s['flags']) for s in summ if s.get('flags') and ('stampOnly' in s['flags'] or 'bulkBump' in s['flags'] or 'future' in s['flags'])][:12])
