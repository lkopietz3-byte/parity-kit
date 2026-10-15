# Edge stamps for auditReviewStamps: labels from the README rules, computed by the independent oracle. Writes cases for the Node runner.
import json, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import oracle_s2 as O
NOW='2026-10-09T22:09:21Z'
before='2026-06-01T00:00:00Z'
cases=['2026-10-09T22:09:21Z','2026-10-09T22:09:22Z','2026-10-09T22:09:21.001Z','2026-10-09T22:09:21.0009Z','2026-10-09','2026-10-10','2026-10-11','2026-10-10T00:00:00+14:00','2026-10-10T00:00:01+14:00','2026-10-09T10:00:00-12:00','2026-10-09T22:09:21+00:00','2026-10-09T22:09:21-00:00',
 '2026-10-09T23:09:21+01:00','2026-10-09T22:09','2026-10-09T22:09Z','2026-10-09T22:09:21.123456789Z','2026-10-09T22:09:21.1234567890Z','2026-02-29','2024-02-29','2026-02-28','0001-01-01','9999-12-31','2026-10-09T24:00:00Z','2026-10-09T22:09:60Z','2026-10-09 22:09:21Z','2026-10-09t22:09:21z','2026-10-09T22:09:21','20261009','2026-10-09T22:09:21+0200','2026-10-09T22:09:21+25:00','2026-10-09T22:09:21+05:60','2026-06-01T00:00:00Z','2026-06-01','2026-05-31T23:59:59.999Z','2026-06-01T00:00:00.0009Z','2026-06-01T00:00:00.001Z','2026-06-01T02:00:00+02:00','2026-06-01T00:00:00+02:00','２０２６-06-02','2026-06-02 ']
rows=[]
Bm={'id':'a','modified':before,'v':1}
for c in cases:
    A={'id':'a','modified':c,'v':1}
    res=O.classify(('x',Bm),('y',A),O.stamp_ms(NOW))
    rows.append(dict(case=c,truth=sorted(res['flags']),rel=res['rel']))
json.dump(dict(now=NOW,before=before,rows=rows),open(O.ROOT+'/data/s2_edge_cases.json','w'),ensure_ascii=False)
print(len(rows))
