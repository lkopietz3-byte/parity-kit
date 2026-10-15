# Labels for the option variants (valueFields, ignoreFields) of the stamp audit, on the six horizon pairs.
# Evidence = any other field that differs, restricted or reduced by the variant. Run: BENCH_WORK=<dir> python3 -I opts_truth.py
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle_s2 as O
from collections import defaultdict
def evidence(rb, ra, mode):
    keys = set(rb) | set(ra)
    if mode == 'valueFields_details_summary': cons = {'details', 'summary', 'references'}
    elif mode == 'ignoreFields_affected': cons = {k for k in keys if k not in ('modified', 'id', 'affected')}
    else: cons = {k for k in keys if k not in ('modified', 'id', 'affected', 'aliases')}
    return [k for k in cons if rb.get(k, '\0M') != ra.get(k, '\0M')]
rows = []
for l0 in ('2026-10-08', '2026-10-02', '2026-09-09', '2026-07-11', '2026-04-12', '2026-01-12'):
    l1 = '2026-10-09'; B, A = O.recs(l0), O.recs(l1)
    for mode in ('valueFields_details_summary', 'ignoreFields_affected', 'ignoreFields_affected_aliases'):
        groups = defaultdict(list); flags = defaultdict(list)
        for i in set(B) & set(A):
            tb, ta = O.stamp_ms(B[i][1]['modified']), O.stamp_ms(A[i][1]['modified'])
            if ta > tb:
                groups[O.day(ta)].append(i)
                if not evidence(B[i][1], A[i][1], mode): flags[i].append('stampOnly')
        for d, ids in groups.items():
            if len(ids) > 10:
                for i in ids: flags[i].append('bulkBump')
        for i, fl in flags.items(): rows.append(dict(pair=f'{l0}>{l1}', variant=mode, id=i, truth=sorted(fl)))
with open(O.ROOT + '/out/s2_opts_truth.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r) + '\n')
print(len(rows), 'rows')
