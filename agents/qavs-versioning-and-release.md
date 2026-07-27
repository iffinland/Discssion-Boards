# QAVS, Versioning, and Release

## Purpose

Define the evidence and authorization required to move from
implementation-complete to release candidate, stable release, GitHub release,
and live QDN deployment.

## Use when

Use for `RELEASE_PREPARATION`, QAVS metadata, version changes, deterministic
artifacts, tags, GitHub Releases, or deployment records.

## Do not use when

Do not use release work to bypass unresolved runtime/live validation. Do not
assign manifest fields or version semantics from memory.

## Prerequisites

- Implementation and required migrations complete.
- Required automated and live validation status known.
- Current QAVS authority/specification and project release policy.
- Explicit owner authorization for external writes.

## Required inputs

- Authoritative version source.
- Package/lock/manifest/UI version surfaces.
- RC or stable intent and current platform compatibility.
- License and third-party notices.
- Exact source commit and artifact contents.
- Intended tag, GitHub release, QDN service/name/identifier.

## Workflow

### 1. Separate states

Record independently:

- implementation complete;
- automated validation complete;
- owner live validation complete;
- release candidate ready;
- stable promotion ready;
- artifact created;
- tag/GitHub Release created;
- QDN deployed.

### 2. Verify current QAVS rules

Inspect the current authoritative QAVS specification/validator and checked-out
platform sources where applicable. Do not assume conventional SemVer meaning
when QAVS versioning expresses platform compatibility.

### 3. Synchronize version authority

Identify one authority and synchronize package, lockfile, manifest, visible UI,
release notes, and artifact metadata. Validate that no stale alternative
version remains.

### 4. Validate legal metadata

Confirm explicit license, included license file, third-party notices, and source
link/provenance requirements.

### 5. Build deterministically

Run the clean verified build. Create a root-content artifact in the required
format, exclude generated/test/cache/secrets, and record checksum, source
commit, expected tag, and build commands.

### 6. Distinguish RC and stable

- A live build MAY remain an RC.
- Stable promotion requires a new synchronized build when version/metadata
  changes.
- Stable status MUST NOT be inferred from successful upload.

### 7. Publish only with authority

Tag, push, GitHub pre-release/release, and QDN deployment are independent
external writes. Each requires explicit owner approval. Record the resulting
URLs, identifiers, hashes, and deployment verification.

## Mandatory rules

- Release work MUST NOT replace runtime validation.
- MUST NOT create a tag, release, artifact, transaction, or QDN publication
  without requested scope.
- MUST NOT commit a release ZIP merely because it exists.
- Artifact provenance MUST identify source and version.
- Deployed behavior MUST be validated separately from artifact construction.

## Validation

- Clean install, full verify, and production build.
- Manifest/QAVS and version synchronization checks.
- Artifact file-list, root layout, reproducibility, and checksum.
- Git diff/status and generated-file audit.
- Embedded/live validation required by the release plan.

## Completion criteria

- Release state and RC/stable meaning are explicit.
- Version and metadata are synchronized and validated.
- Artifact is reproducible and traceable.
- External actions occurred only with approval and are recorded.
- Required live checks pass before stable closure.

## Related files

- [`live-qdn-validation.md`](live-qdn-validation.md)
- [`git-generated-files-and-hygiene.md`](git-generated-files-and-hygiene.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
