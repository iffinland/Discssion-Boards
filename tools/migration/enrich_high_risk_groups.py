#!/usr/bin/env python3
"""Fetch payloads and latest-transaction evidence for the 14 high-risk groups."""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

NODE = "https://ext-node.qortal.link"
def get(url):
    try:
        req=urllib.request.Request(url,headers={"Accept":"application/json"})
        with urllib.request.urlopen(req,timeout=3) as r: return json.loads(r.read().decode()), None
    except Exception as e: return None, str(e)
def flatten(p):
    if not isinstance(p,dict): return {}
    out={}
    for k in ("id","type","status","updatedAt","createdAt","author","authorUserId","creator","createdByUserId","topicId","subTopicId","threadId","postId","parentId","parentPostId","content","title","description","visibility","locked","isLocked","pinned","solved","likes","likeCount","poll","pollId","votes","tips","deleted"):
        if k in p: out[k]=p[k]
    for v in p.values():
        if isinstance(v,dict): out.update({k:v[k] for k in ("id","createdAt","createdByUserId","author","authorUserId","parentId","topicId","subTopicId","threadId","postId","pinned","locked","solved","visibility","poll","votes","likes","deleted") if k in v})
    return out
def main(src,dst):
    d=json.loads(Path(src).read_text()); out=[]
    for e in d["entries"]:
        if e["status"]=="AUTO-CANDIDATE": continue
        resources=[]
        for r in e["resources"]:
            path=f"{NODE}/arbitrary/{urllib.parse.quote('DOCUMENT',safe='')}/{urllib.parse.quote(r['publisher'],safe='')}/{urllib.parse.quote(r['identifier'],safe='')}"
            payload,err=get(path)
            tx,txerr=get(f"{NODE}/transactions/signature/{urllib.parse.quote(r['latestSignature'],safe='')}") if r.get("latestSignature") else (None,"no signature")
            resources.append({**r,"payloadAvailability":"available" if payload is not None else "unavailable","payloadClaims":flatten(payload),"payloadError":err,"latestTransaction":({k:tx.get(k) for k in ('signature','timestamp','blockHeight','creatorAddress','fee','type')} if isinstance(tx,dict) else None),"transactionEvidence":"DIRECTLY VERIFIED latest transaction only" if tx else "UNAVAILABLE"})
        e2={k:v for k,v in e.items() if k not in ("resources",)}; e2["resources"]=resources
        e2["comparison"]={"immutableAgreement":"MANUAL COMPARISON REQUIRED","creatorAgreement":"MANUAL COMPARISON REQUIRED","mutationPath":"INFERRED from changed fields where present; not proof","historicalFirstTransaction":"UNAVAILABLE from current public surface","historicalNameOwnership":"UNAVAILABLE; current lookup is not historical"}
        out.append(e2)
    Path(dst).write_text(json.dumps({"schemaVersion":"qortium.discussion-boards.high-risk-enrichment/v1","source":"legacy-canonical-publisher-review.json","entries":out},indent=2,sort_keys=True)+"\n")
    print(len(out),sum(len(e['resources']) for e in out))
if __name__=='__main__': main(sys.argv[1],sys.argv[2])
