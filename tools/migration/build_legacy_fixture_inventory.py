#!/usr/bin/env python3
"""Capture a reproducible, non-production V1 canonical-publisher fixture."""
import json, re, sys, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://ext-node.qortal.link/arbitrary/resources/search"
RESOURCE = "https://ext-node.qortal.link/arbitrary/{service}/{name}/{identifier}"
FAMILIES = (("Topic", "qdbm-topic-"), ("Thread", "qdbm-sub-"), ("Post", "qdbm-post-"))

def get_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)

def logical_id(identifier, prefix):
    value = identifier[len(prefix):]
    if prefix == "qdbm-post-":
        # V1 legacy is qdbm-post-{postId}; partitioned V1 is
        # qdbm-post-{threadPartition}-{postId}. ULID-like IDs contain `_`.
        m = re.search(r"(post_[a-z0-9]+_[a-z0-9]+)$", value)
        if m:
            return m.group(1), "partitioned" if value != m.group(1) else "legacy"
    return value, "native"

def main(out):
    captured = datetime.now(timezone.utc).isoformat()
    records, errors = [], []
    for entity_type, prefix in FAMILIES:
        query = urllib.parse.urlencode({"mode":"ALL", "limit":"0", "includestatus":"true", "includemetadata":"true", "service":"DOCUMENT", "identifier":prefix})
        resources, err = get_json(BASE + "?" + query)
        if err:
            errors.append({"family": entity_type, "error": err}); continue
        for r in resources or []:
            lid, family = logical_id(r.get("identifier", ""), prefix)
            # Search metadata is retained for every resource. Payload retrieval is
            # intentionally not required for the complete inventory: unavailable
            # payloads still have authoritative resource envelopes.
            status = r.get("status") or {}
            available = status.get("status") not in ("NOT_PUBLISHED", "MISSING")
            embedded, perr, tombstone = {}, None, False
            records.append({
                "entityType": entity_type, "logicalEntityId": lid, "identifierFamily": family,
                "service": r.get("service"), "publisher": r.get("name"), "identifier": r.get("identifier"),
                "coreCreated": r.get("created"), "coreUpdated": r.get("updated"), "latestSignature": r.get("latestSignature"),
                "availability": "available" if available else "unavailable",
                "coreStatus": status,
                "payloadError": perr, "deletionOrTombstone": tombstone,
                "embedded": embedded,
            })
    groups = defaultdict(list)
    for r in records: groups[(r["entityType"], r["logicalEntityId"])].append(r)
    duplicate = {f"{t}:{i}": v for (t, i), v in groups.items() if len({x["publisher"] for x in v}) > 1}
    for key, group in duplicate.items():
        for r in group:
            r["duplicateGroup"] = key
            r["earliestCandidate"] = min((x["coreCreated"] for x in group if x["coreCreated"] is not None), default=None) == r["coreCreated"]
            r["reviewStatus"] = "REVIEW-REQUIRED"
            r["reviewReason"] = "duplicate publisher; earliest Core-created resource is a candidate, not an approval"
    for r in records:
        if "reviewStatus" not in r: r["reviewStatus"] = "AUTO-CANDIDATE"
    summary = {
        "schema": "qortium.discussion-boards.legacy-fixture/v1",
        "capturedAt": captured, "source": {"node": "https://ext-node.qortal.link", "query": "DOCUMENT identifier prefix, limit=0 (unbounded)", "payloads": "best-effort read-only"},
        "completeness": {"search": "unbounded prefix queries completed", "payload": "some resources may be unavailable; envelopes are retained", "historicalTransactions": "not included; public search does not expose first transaction"},
        "counts": {"resources": len(records), "logicalEntities": len(groups), "duplicateGroups": len(duplicate), "unavailable": sum(r["availability"] == "unavailable" for r in records), "tombstones": sum(r["deletionOrTombstone"] for r in records)},
        "byEntityType": {t: {"resources": sum(r["entityType"] == t for r in records), "logicalEntities": len({r["logicalEntityId"] for r in records if r["entityType"] == t}), "duplicateGroups": sum(k.startswith(t+":") for k in duplicate)} for t, _ in FAMILIES},
        "records": records, "duplicateGroups": duplicate, "errors": errors,
    }
    Path(out).write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps(summary["counts"], sort_keys=True))

if __name__ == "__main__": main(sys.argv[1] if len(sys.argv) > 1 else "legacy-fixture-inventory.json")
