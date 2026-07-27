# Qortium Architecture and Data Integrity

## Purpose

Define reusable rules for authority, identity, deterministic shared-state
reduction, independent operations, access boundaries, and compatibility.

## Use when

Use for architecture design/audit, security and data-integrity work, shared
mutable QDN state, moderation/roles, or migrations.

## Do not use when

Do not use architecture reasoning as a substitute for runtime measurement, UI
validation, or current Home/Core source inspection.

## Prerequisites

- Product entity and operation inventory.
- Current application read/write paths.
- Current checked-out Home/Core sources.
- Known compatibility and migration requirements.

## Required inputs

- Entity types and immutable IDs.
- Publisher, name, wallet/address, and actor evidence.
- Mutation and moderation requirements.
- Trusted QDN metadata available to reducers.
- Legacy formats and current live-data patterns.

## Workflow

### 1. Establish authority

For every entity determine:

- creator and authoritative publisher;
- required name/wallet binding;
- immutable fields;
- owner-edit fields;
- moderator/admin fields;
- forbidden cross-domain fields;
- transfer rules, if any;
- deletion/tombstone behavior.

MUST NOT infer authority from embedded `author`, `owner`, `actor`, `wallet`,
client `updatedAt`, latest publisher, or derived indexes alone.

### 2. Separate entities from operations

Represent actions independently when they have different actors, ordering, or
authorization: edits, reactions, votes, moderation, tips, roles, deletion, and
access changes. An operation MUST NOT replace an authoritative entity snapshot
unless replacement is the explicit validated model.

### 3. Define trusted envelopes

Separate application payload claims from trusted resource metadata such as
service, publisher/name, identifier, Core creation/update time, and transaction
evidence where available. Payload data MUST NOT overwrite trusted metadata.

### 4. Validate identity and permissions

Validate:

1. resource publisher matches claimed publisher;
2. wallet/name binding where the current platform exposes adequate evidence;
3. actor owns the target or has a trusted delegated role;
4. operation fields satisfy a field-level policy;
5. parent references exist and are plausible.

Current ownership MUST NOT be substituted for historical ownership without
explicit evidence.

### 5. Order deterministically

Use trusted QDN/Core metadata and deterministic tie-breakers. Client timestamps
MAY be content metadata but MUST NOT be sole authority or ordering. Define
duplicate idempotency and conflicting-operation handling.

### 6. Reduce fail-closed

Recommended pipeline:

```text
raw discovery
-> trusted metadata validation
-> strict envelope parsing
-> identity/authority validation
-> deterministic ordering
-> entity creation reduction
-> independent operation reduction
-> diagnostics/quarantine
-> derived view/index generation
```

Malformed, forged, conflicting, unavailable, unauthorized, or missing-target
records require stable rejection/quarantine codes. Authority-sensitive paths
MUST fail closed. Safe legacy reads MAY fail open through an explicitly
non-authoritative compatibility adapter.

### 7. Keep derived state non-authoritative

Indexes, directories, caches, counts, snapshots, and search hints:

- MUST be derived and validated;
- MUST NOT establish ownership or replace entities;
- SHOULD be rebuildable;
- MUST expose stale, partial, and unavailable states;
- MUST NOT unnecessarily block first useful authoritative render.

### 8. Define access truthfully

UI visibility or wallet allowlists are authorization boundaries, not
confidentiality. Only encryption plus a viable key model can support a
confidentiality claim.

### 9. Design compatibility and migration

Define:

- strict legacy readers and canonical normalization;
- provenance on normalized records;
- precedence between legacy and new state;
- migration/adoption evidence;
- explicit approval or manifest boundaries;
- quarantine for unresolved authority;
- rollback/correction strategy.

MUST NOT auto-adopt unresolved legacy authority from embedded author or
timestamps.

## Mandatory rules

- Decentralized MUST NOT mean unvalidated.
- Unrelated publishers MUST NOT replace authoritative state.
- Operation domains MUST NOT mutate each other's fields.
- Partial discovery MUST NOT grant authority based on incomplete evidence.
- Reference commits are traceability points, not permanent capability targets.

## Validation

Test at minimum:

- forged creator/actor;
- unrelated publisher;
- future client timestamp;
- duplicate and conflicting records;
- missing target or parent;
- field-policy violations;
- partial/unavailable discovery;
- deterministic input-order permutations;
- legacy snapshots and indexes attempting to override authority;
- current ownership incorrectly offered as historical proof.

## Completion criteria

- Every entity and operation has explicit authority and field policy.
- Ordering, duplicate, tombstone, partial-data, and quarantine rules are
  deterministic.
- Legacy compatibility cannot grant unverified new authority.
- Tests demonstrate the failure boundaries.

## Related files

- [`qdn-publication-discovery-and-scaling.md`](qdn-publication-discovery-and-scaling.md)
- [`issue-driven-audit-and-refactor.md`](issue-driven-audit-and-refactor.md)
- [`live-qdn-validation.md`](live-qdn-validation.md)
