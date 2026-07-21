import json,sys
from pathlib import Path
a=json.loads(Path(sys.argv[1]).read_text()); b=json.loads(Path(sys.argv[2]).read_text()); extra={e['entityType']+':'+e['entityId']:e for e in b['entries']}
for e in a['entries']:
 k=e['entityType']+':'+e['entityId']
 if k in extra:
  e['enrichmentRef']='high-risk-payload-enrichment.json#/entries/'+str(list(extra).index(k))
  e['enrichmentSummary']={'payloadsAvailable':sum(r['payloadAvailability']=='available' for r in extra[k]['resources']),'payloadsUnavailable':sum(r['payloadAvailability']=='unavailable' for r in extra[k]['resources']),'latestTransactionsDirectlyVerified':sum(r.get('latestTransaction') is not None for r in extra[k]['resources']),'firstTransaction':'UNAVAILABLE','historicalNameOwnership':'UNAVAILABLE'}
Path(sys.argv[3]).write_text(json.dumps(a,indent=2,sort_keys=True)+'\n')
