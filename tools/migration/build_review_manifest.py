#!/usr/bin/env python3
"""Build maintainer-facing dispositions from the read-only V1 inventory."""
import json, sys
from pathlib import Path

def classify(group):
    pubs = {r["publisher"] for r in group}
    families = {r["identifierFamily"] for r in group}
    times = [r["coreCreated"] for r in group if r["coreCreated"] is not None]
    if "legacy" in families and "partitioned" in families:
        return "QUARANTINE", "legacy/partitioned identifier-family conflict requires cross-family equivalence proof"
    if len(pubs) >= 4:
        return "QUARANTINE", "four or more publishers; mutation sequence and creator cannot be inferred from envelopes"
    if len(pubs) == 2 and len(times) == len(group) and len(set(times)) == len(times):
        return "AUTO-CANDIDATE", "two same-family publishers with a unique earliest Core-created candidate; payload and first-transaction review still required"
    return "REVIEW-REQUIRED", "duplicate publisher sequence requires payload/immutable-field and mutation-path review"

def main(src, dst):
    data = json.loads(Path(src).read_text())
    entries, totals = [], {"AUTO-CANDIDATE": 0, "REVIEW-REQUIRED": 0, "QUARANTINE": 0}
    for key, group in sorted(data["duplicateGroups"].items()):
        entity_type, entity_id = key.split(":", 1)
        status, reason = classify(group); totals[status] += 1
        earliest = min(group, key=lambda r: (r["coreCreated"] is None, r["coreCreated"] or 0))
        entries.append({
            "entityType": entity_type, "entityId": entity_id,
            "publishers": sorted({r["publisher"] for r in group}),
            "resources": [{"publisher":r["publisher"],"identifier":r["identifier"],"identifierFamily":r["identifierFamily"],"coreCreated":r["coreCreated"],"coreUpdated":r["coreUpdated"],"latestSignature":r["latestSignature"],"availability":r["availability"],"coreStatus":r.get("coreStatus"),"tombstone":r["deletionOrTombstone"]} for r in sorted(group,key=lambda x:(x["coreCreated"] is None,x["coreCreated"] or 0))],
            "candidateCanonicalPublisher": earliest["publisher"], "candidateCreated": earliest["coreCreated"],
            "candidateReason": "minimum Core created metadata; later full snapshots are compatible with V1 mutation republication",
            "mutationPath": "inferable only from entity type; source paths include admin/moderation/reaction/vote/edit/delete/tip operations",
            "immutableFieldAgreement": "NOT-INSPECTED (payload enrichment required)",
            "embeddedCreatorAgreement": "NOT-INSPECTED (payload enrichment required)",
            "availabilityTombstoneAmbiguity": "Envelope present; payload/tombstone status requires enrichment",
            "identifierFamilyConflict": "legacy+partitioned conflict" if len({r["identifierFamily"] for r in group}) > 1 else "none observed",
            "confidence": "medium" if status == "AUTO-CANDIDATE" else "low",
            "status": status, "manualReviewReason": reason,
            "manifestDecision": {"schemaVersion":"qortium.discussion-boards.migration-manifest/v1","reviewVersion":"TBD","cutoff":{"height":None,"timestamp":None},"entityType":entity_type,"entityId":entity_id,"canonicalPublisher":None,"status":status,"evidenceRefs":["legacy-fixture-inventory.json#/duplicateGroups/"+key],"reviewedBy":"","reviewedAt":"","decisionReason":"","notes":""}
        })
    out = {"schemaVersion":"qortium.discussion-boards.maintainer-review/v1","capturedAt":data["capturedAt"],"sourceInventory":"legacy-fixture-inventory.json","classificationPolicy":"No APPROVED entries; AUTO-CANDIDATE is expedited review only. Cross-family and >=4-publisher groups are quarantined.","totals":totals,"entries":entries}
    Path(dst).write_text(json.dumps(out, indent=2, sort_keys=True)+"\n")
    print(json.dumps(totals, sort_keys=True))
if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
