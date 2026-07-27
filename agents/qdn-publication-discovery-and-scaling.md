# QDN Publication, Discovery, and Scaling

## Purpose

Define safe resource identity, publication, discovery, readiness, pagination,
reduction, caching, and large-content behavior.

## Use when

Use for QDN entities/operations, identifier design, search, indexes, caches,
readiness, partial data, publication verification, or scaling.

## Do not use when

Do not treat search results or indexes as authoritative. Do not assign current
endpoint/bridge fields without current Core/Home verification.

## Prerequisites

- Entity and operation authority model.
- Current Core QDN API and Home publication implementation.
- Expected dataset size and access classification.

## Required inputs

- Service, publisher/name, namespace, identifier families.
- Immutable logical IDs and partition keys.
- Expected update/operation volume.
- Resource and file sizes.
- Required completeness and recovery semantics.

## Workflow

### 1. Design resource identity

Define exact service/name/identifier and validate platform length/character
constraints. Use collision-resistant immutable IDs. Partition by stable domain
keys where required; do not depend on payload timestamps for identity.

### 2. Bind publisher authority

Validate discovered publisher/name against the entity or operation policy.
Unrelated publishers MUST NOT replace authoritative state simply by using a
matching identifier or later timestamp.

### 3. Validate payloads

Use strict versioned envelopes. Reject mixed, malformed, oversized, wrong-type,
wrong-parent, or identifier/body-inconsistent resources with stable
diagnostics.

### 4. Discover completely but safely

Use paginated prefix search with:

- explicit page size;
- page and total-resource budgets;
- repeated-page detection;
- deduplication;
- deterministic sorting;
- bounded retries/backoff;
- partial/unavailable outcomes.

A fixed unpaginated cap MUST NOT be reported as complete discovery.

### 5. Fetch with bounded concurrency

Limit concurrent content loads. Preserve per-resource availability. A valid
partial set SHOULD remain readable where safe; incomplete authority evidence
MUST fail closed for mutations.

### 6. Handle readiness and missing data

Distinguish known-not-ready, building/downloading, ready, missing, malformed,
timeout, and unavailable. Readiness polling and build triggers MUST be bounded.
Missing-resource quarantine/caches MUST expire or be invalidatable.

### 7. Reduce deterministically

Order by trusted QDN/Core metadata and deterministic tie-breakers. Define
duplicate, idempotency, conflict, tombstone, and correction rules. Arbitrary
client timestamps MUST NOT be sole conflict authority.

### 8. Keep indexes and caches derived

Indexes/caches:

- MUST NOT establish authority;
- SHOULD contain bounded locator/search hints rather than complete authority;
- MUST be validated against current entities;
- SHOULD be rebuildable and partitioned;
- MUST expose stale/partial/unavailable status;
- MAY use last-known-good state only with explicit provenance.

Derived refresh MUST NOT block first useful authoritative render unless needed
for correctness.

### 9. Publish safely

Separate:

- bounded small inline JSON/content;
- current verified large-file source token or file-path transport.

Large in-browser base64 MUST NOT be recommended without memory, bridge, and
verified platform analysis. Verify exact service/name/identifier after
publication. Treat accepted-but-unconfirmed writes as recoverable, not safely
repeatable.

### 10. Plan scale tests

Test more than one page, publisher floods, duplicate pages, large partitions,
unavailable resources, partial partitions, cache invalidation, and concurrency
limits.

## Mandatory rules

- Whole-board snapshots SHOULD NOT be rewritten for independent operations.
- Indexes MUST NOT override entities.
- Search completeness MUST be explicit.
- Read and write retries require different safety policies.
- Exact current platform fields MUST be verified, not copied from historical
  guidance.

## Validation

- Pagination boundary, multi-page, loop, retry, budget, and partial tests.
- Publisher/identifier/body consistency tests.
- Deterministic reduction across input permutations.
- Ready, unavailable, missing, stale-cache, and last-known-good tests.
- Post-publication exact-resource verification and ambiguous-write recovery.
- Memory/path tests for the largest supported file.

## Completion criteria

- Resource and authority identities are explicit.
- Discovery is bounded, paginated, deterministic, and honest about partiality.
- Derived state cannot establish authority.
- Publication and recovery are safe for both small and large resources.

## Related files

- [`qortium-architecture-and-data-integrity.md`](qortium-architecture-and-data-integrity.md)
- [`qortium-home-and-bridge.md`](qortium-home-and-bridge.md)
- [`runtime-diagnostics-and-performance.md`](runtime-diagnostics-and-performance.md)
