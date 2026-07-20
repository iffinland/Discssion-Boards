# Legacy V1 canonical-publisher migration review

Status: `REVIEW-REQUIRED` / Phase 1 remains blocked

Captured: 2026-07-20 from `https://ext-node.qortal.link` using QDN
`DOCUMENT` identifier-prefix searches with `limit=0` (unbounded). The complete
resource-envelope inventory is [legacy-fixture-inventory.json](./legacy-fixture-inventory.json).
The capture script is [build_legacy_fixture_inventory.py](../../tools/migration/build_legacy_fixture_inventory.py).

## Inventory totals

| Family | Resources | Logical IDs | Duplicate groups |
| --- | ---: | ---: | ---: |
| Topic (`qdbm-topic-`) | 39 | 20 | 18 |
| Thread/SubTopic (`qdbm-sub-`) | 62 | 49 | 11 |
| Post (`qdbm-post-`, including legacy and partitioned forms) | 212 | 169 | 20 |
| Total | 313 | 238 | 49 |

Every record preserves service, publisher, identifier, Core `created` and
`updated`, latest signature, Core status, logical ID, identifier family, and a
review status. Search envelopes were available for all 313 records in this
capture. Payload availability is intentionally separate: the Core envelope
does not prove that the payload is locally downloaded. The capture observed no
tombstone flag in the envelope metadata; payload-level tombstone inspection
and historical transaction retrieval remain required fixtures.

## Duplicate classification

The duplicate groups are the migration-review unit. Each group records all
publishers and the minimum Core-created candidate. The dataset marks every
duplicate as `REVIEW-REQUIRED`; no record is `APPROVED` automatically.

The generated maintainer package is
[legacy-canonical-publisher-review.json](./legacy-canonical-publisher-review.json).
Its deterministic envelope-only classification is:

| Status | Groups | Meaning |
| --- | ---: | --- |
| `AUTO-CANDIDATE` | 35 | Unique earliest same-family candidate; expedited human review still required |
| `REVIEW-REQUIRED` | 5 | Duplicate sequence or metadata needs payload and mutation-path review |
| `QUARANTINE` | 9 | Legacy/partitioned identifier conflict or four-or-more publishers |

`AUTO-CANDIDATE` is not approval. No entry has a canonical publisher filled in
as a human decision. The package contains one concise record for each of the
49 groups, including all resource metadata, candidate, confidence, mutation
explanation, immutable/embedded-field evidence state, availability ambiguity,
identifier conflicts, and an explicit manifest-decision template.

Known legitimate V1 mutation paths represented by the current source and to be
covered by fixtures are:

| Entity | Path | Expected publisher of later snapshot |
| --- | --- | --- |
| Topic | settings/admin update; SuperAdmin/SysOp order | acting admin/staff name |
| Thread | moderation, visibility, lock, pin, solved, pinned ordering | acting moderator/admin name |
| Post | author edit | author’s then-current name |
| Post | like/reaction, poll vote/close, staff pin, deletion/tombstone, tip sync | acting user/staff name |

Index and role resources are excluded from entity ownership candidacy. A later
publisher is therefore not presumed to be an unauthorized replacement merely
because it differs from the embedded creator.

## Counterexample search

The unbounded search did not itself expose first-transaction history or payload
creator fields, so it cannot establish a creator counterexample. No earliest
candidate was marked approved. The following counterexample classes remain
explicit review tests:

- omitted-page/omitted-prefix discovery changing the minimum candidate;
- unavailable earlier resource;
- equal or suspicious Core timestamps;
- embedded creator differing from publisher;
- legacy versus partitioned Post identifier disagreement;
- imported/copied content whose first publication is not creation;
- failed multi-resource creation where an index precedes the entity.

Each class requires a fixture with the full envelope set and, where possible,
the first arbitrary transaction and block evidence.

## Identity evidence boundary

Directly verifiable: the publisher name in the QDN resource key; Core
validation that the signer owned that registered name at publication
validation; Core resource `created`, `updated`, and latest signature.

Inferable: creation-before-mutation ordering, parent/time plausibility, and
agreement of immutable fields across copies.

Not available from the current search surface: first transaction signature,
creator public key, block sequence for each resource, and historical name
ownership after a name transfer. Current name lookup is not historical proof.

## Candidate decision

The current evidence supports only a constrained candidate: choose the minimum
Core `created` publisher across a complete, cutoff-bounded group, then require
entity-specific immutable-field agreement and transaction evidence for ties or
mismatches. Use a reviewed manifest and quarantine anything unresolved. This
is not yet an approved universal rule.

## Versioned migration manifest

The proposed review manifest is deterministic JSON:

```json
{
  "schema": "qortium.discussion-boards.migration-manifest/v1",
  "cutoff": { "height": 0, "timestamp": 0 },
  "entries": [{
    "entityType": "Topic|Thread|Post",
    "entityId": "...",
    "canonicalPublisher": "...",
    "candidateCreated": 0,
    "status": "AUTO-CANDIDATE|REVIEW-REQUIRED|QUARANTINE|APPROVED",
    "evidenceRef": "legacy-fixture-inventory.json#/duplicateGroups/Topic:...",
    "conflictingPublishers": ["..."],
    "reviewedBy": "",
    "reviewedAt": "",
    "reason": "",
    "notes": "",
    "supersedes": ""
  }]
}
```

Entries are immutable by version. A correction appends a new manifest version,
sets `supersedes` to the prior entry, records the reason and reviewer, and
never rewrites the fixture history. No entry may be `APPROVED` until the
maintainer review and first-transaction evidence requirements in
`docs/ARCHITECTURE-V2.md` are satisfied.

## Required next review

Maintainers must approve the migration cutoff, inspect payload fixtures for
all duplicate groups, retrieve first-transaction evidence for ambiguities,
and decide whether any imported/copied entity requires an explicit exception.
Until then, legacy content may be displayed read-only, but no V2 authority,
owner mutation, or automatic adoption may be granted.
