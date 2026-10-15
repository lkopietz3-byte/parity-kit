# Extract OSV advisory records from pypa/advisory-database history into a blob store + per-snapshot manifests.
# Run: ../venv/bin/python -I extract_s2.py   (untrusted YAML parsed with a SafeLoader that does not resolve timestamps)
import subprocess, json, gzip, sys, os, datetime
import yaml
import os
ROOT=os.environ['BENCH_WORK']
REPO=ROOT+'/data/pypa-advisory'
Base = getattr(yaml,'CSafeLoader',yaml.SafeLoader)
print('loader', Base.__name__)
class L(Base): pass
L.yaml_implicit_resolvers = {k:[(t,r) for (t,r) in v if t!='tag:yaml.org,2002:timestamp'] for k,v in Base.yaml_implicit_resolvers.items()}
def git(*a, inp=None):
    return subprocess.run(['git','-C',REPO,*a],capture_output=True,check=True,input=inp).stdout
# daily snapshot commits: last commit on or before 23:59:59 UTC of each day, Jul 1 .. Oct 9
log = git('log','--format=%H %cI %ct','main' if False else 'HEAD').decode().split('\n')
commits=[(l.split()[0], l.split()[1], int(l.split()[2])) for l in log if l]
def last_before(ts):
    for h,iso,t in commits:
        if t<=ts: return (h,iso,t)
days=[]
d=datetime.date(2026,7,1)
while d<=datetime.date(2026,10,9):
    end=int(datetime.datetime(d.year,d.month,d.day,23,59,59,tzinfo=datetime.timezone.utc).timestamp())
    days.append((d.isoformat(), last_before(end)))
    d+=datetime.timedelta(days=1)
extra=[('2026-04-12',last_before(int(datetime.datetime(2026,4,12,23,59,59,tzinfo=datetime.timezone.utc).timestamp()))),
       ('2026-01-12',last_before(int(datetime.datetime(2026,1,12,23,59,59,tzinfo=datetime.timezone.utc).timestamp())))]
allsnaps=extra+days
store={}; manifests={}
def parse_blob(sha):
    raw=git('cat-file','blob',sha)
    return yaml.load(raw.decode('utf-8'), Loader=L)
# batch read blobs
def read_many(shas):
    p=subprocess.run(['git','-C',REPO,'cat-file','--batch'],input=('\n'.join(shas)+'\n').encode(),capture_output=True,check=True)
    out={}; buf=p.stdout; i=0
    for s in shas:
        j=buf.index(b'\n',i); hdr=buf[i:j].split(); n=int(hdr[2]); out[s]=buf[j+1:j+1+n]; i=j+1+n+1
    return out
seen_commit={}
for label,(h,iso,t) in allsnaps:
    if h in seen_commit: manifests[label]=dict(commit=h,committed=iso,files=seen_commit[h]); continue
    tree=git('ls-tree','-r',h,'--','vulns').decode().split('\n')
    files={}
    new=[]
    for l in tree:
        if not l: continue
        meta,path=l.split('\t'); sha=meta.split()[2]
        files[path]=sha
        if sha not in store and sha not in new: new.append(sha)
    raws=read_many(new) if new else {}
    for s,raw in raws.items():
        try: store[s]=yaml.load(raw.decode('utf-8'),Loader=L)
        except Exception as e: store[s]={'__parse_error__':str(e)[:200]}
    seen_commit[h]=files
    manifests[label]=dict(commit=h,committed=iso,files=files)
    print(label,h[:8],iso,len(files),'new blobs',len(new),flush=True)
json.dump(manifests,open(ROOT+'/data/s2_manifests.json','w'))
with gzip.open(ROOT+'/data/s2_blobs.json.gz','wt',compresslevel=6) as f: json.dump(store,f)
print('blobs',len(store))
