# Architecture V2 release candidate notes

Version: `1.5.0-rc.1`  
Expected tag: `v1.5.0-rc.1`  
Status: **Draft — no GitHub Release or QDN deployment has been created**

This release candidate packages the implemented Architecture V2 state model
for maintainer and embedded-Qortium validation.

## Major changes

- Authoritative Topic, Thread, and Post creation and owner-edit operations.
- Publisher, current wallet binding, field-policy, and deterministic reducer
  validation.
- Separate authenticated reactions that cannot replace Post content.
- Native Qortium poll references, transactions, and Core-authoritative results.
- Independent moderation operations with trusted role authorization.
- Append-only persistent delegated-role operations rooted in the trusted
  legacy role bootstrap.
- Verified QORT tip references backed by confirmed Core transactions.
- Paginated QDN discovery, explicit partial/unavailable data, and rebuildable
  non-authoritative index fragments.
- Accurate public/restricted-UI/encrypted terminology and restricted-index
  minimization.
- Guarded Qortium bridge detection and source-token large-file publication.
- Qortium Home display settings, live updates, and English localization
  infrastructure.
- Reproducible Node/npm dependency, lint, formatting, and verification baseline.

## Integrity and migration

V1 compatibility data remains readable where safe. Architecture V2 does not
perform destructive migration and does not allow V1 snapshots, embedded
authors, client timestamps, current-name ownership alone, or derived indexes
to override V2 authority.

Automatic V1 adoption and canonical migration-manifest activation remain
disabled. `UNRESOLVED` and `QUARANTINED` legacy entities are compatibility
read-only and cannot inherit V2 owner authority. Human-reviewed mappings are
still required before automatic legacy authority migration.

## Compatibility

- QAVS minimum platform level: Qortium Home `1.5`.
- QDN application target expected from the reviewed deployment:
  `qdn://APP/Discussion_Boards/discussion-boards`.
- Local browser operation is read-only/limited; wallet, signing, publication,
  Home settings, and protected bridge actions require Qortium Home.
- Public unencrypted QDN content is never cryptographically private merely
  because the official UI restricts access.
- New file publication supports bounded inline payloads through 2 MiB and Home
  source tokens above 2 MiB through the verified 100 MiB Home limit.

## Known limitations and release gates

- The 49 duplicate V1 logical-entity mappings remain unapproved
  (`AUTO-CANDIDATE`, `REVIEW-REQUIRED`, or `QUARANTINE`, never automatically
  `APPROVED`).
- Historical name-to-wallet ownership and first-publication transactions are
  not reliably recoverable through the current public API.
- True encrypted discussions are not implemented.
- Full embedded Home routing/refresh, console, signing, native poll, tip, and
  large-file checks remain production release gates.
- The documented React Router advisory affects an unused unstable RSC path and
  remains pending an appropriate non-breaking upstream resolution.

## Release provenance template

Before sharing this candidate, replace these placeholders from generated
`.release/provenance.json`:

- source commit: `<commit>`;
- artifact filename: `<artifact>`;
- artifact bytes: `<bytes>`;
- artifact SHA-256: `<sha256>`;
- manual embedded checks: `<status>`;
- QDN deployment reference: `pending` until explicitly approved and published.

Corresponding source must be made available from the exact release tag, not
only the moving `main` branch.
