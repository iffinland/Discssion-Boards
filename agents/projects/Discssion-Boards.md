# Project — Discssion-Boards

## Purpose

Provide only Discussion Boards facts, commands, current state, constraints, and
authoritative project decisions. Global workflows remain in the parent
`agents/` guides.

## Use when

Read after `../00-SESSION-START.md` for work in this repository.

## Do not use when

Do not apply Discussion Boards identifiers, trust anchors, entities, routes,
versions, or migration decisions to another project.

## Prerequisites

- Repository: `iffinland/Discssion-Boards`
- Local path:
  `/home/iffi/VsCodec-Projects/Qortium/projects/Discssion-Boards`
- Primary branch: `main`

## Required inputs

- Exact GitHub issue or owner request.
- Current repository status/commit.
- Relevant project documentation under `docs/`.
- Current checked-out Home/Core source when platform behavior matters.

## Project identity

- Product name: Qortium Discussion Boards
- Package: `qortium-discussion-boards`
- QDN application publishing name: `Discussion_Boards`
- QDN application identifier: `discussion-boards`
- Default document/data namespace: `qdbm`
- Default service: `DOCUMENT`
- Media services: `IMAGE`, `FILE`, and `VIDEO` where the current feature uses
  them
- Project trust anchor/SysOp address:
  `QN1XYwwmTzXemusDb9p7T1nKJEACLHGgaL`

These facts MUST be rechecked in source/configuration before a release or
identity-sensitive migration.

## Current state

- Current version: `1.5.0-rc.1`
- Status: Architecture V2 release candidate
- QAVS manifest: `qortium-app.json`
- License: GPL-3.0-only
- Architecture: authoritative V2 entities plus independent operations and
  explicit legacy V1 read compatibility
- Completed GitHub issues: architecture review and design (#1–#2), phases
  #3–#14, and startup performance #15
- Current documentation workflow issue: #16

The current source includes:

- V2 Topic/Thread/Post creation and owner edits;
- independent reactions, native polls, moderation/roles, verified tips, and
  derived paginated indexes;
- restricted-access terminology that does not claim QDN confidentiality;
- typed Home bridge and large-file publication recovery;
- Home display settings/localization;
- bounded startup diagnostics activated with `?debugStartup=1`;
- QAVS/release metadata and deterministic release tooling.

## Architecture and compatibility decisions

- `docs/ARCHITECTURE-V2.md` is the project architecture source.
- V1 compatibility/display state remains separate from V2 authority.
- Derived indexes/caches MUST NOT establish ownership or override V2 entities.
- Automatic legacy adoption and canonical migration-manifest activation remain
  disabled unless a future approved issue changes them.
- Unresolved or quarantined legacy authority remains read-only for
  owner-sensitive operations.
- Public unencrypted QDN content is not confidential merely because UI access
  is restricted.

## Reference revisions

The last architecture/release verification recorded:

- Reference repositories: `../../github-clones/qortium-core` and
  `../../github-clones/qortium-home`
- Qortium Core:
  `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`
- Qortium Home:
  `a41e5f9678d7f20d7fb77a223c45fddc0096632e`

These commits are traceability points, not frozen capability targets. Before
every platform-dependent implementation phase, inspect the currently checked
out references and record the new verification.

## Workflow

1. Read the target issue and prerequisite issues.
2. Read only the matching global guides.
3. Inspect current source and relevant `docs/`.
4. Verify current Home/Core implementation for platform-dependent behavior.
5. Preserve Architecture V2 and legacy compatibility boundaries.
6. Run focused tests plus the complete project verification.
7. Perform required embedded/live validation before issue closure.

## Key commands

```bash
npm ci
npm run verify
npm run build
npm run test:startup
npm run format:check
npm run lint
git diff --check
```

Architecture suites are exposed as `test:architecture-v2*`. Bridge, Home
display, release metadata, and rich-text suites are also included in
`npm run verify`.

Release commands:

```bash
npm run release:dry-run
npm run release:artifact
```

They MUST be used only within approved release scope. Backup/restore commands
are `npm run backup:workspace` and `npm run restore:workspace`.

## Live validation

- Diagnostic gate: `?debugStartup=1`
- User-facing app address:
  `qdn://APP/Discussion_Boards/discussion-boards`
- Validate cold/warm start, refresh, direct Topic/Thread share routes,
  identity/name selection, authorized/unauthorized writes, display settings,
  clipboard, attachments, and applicable operation domains in embedded Home.
- QDN publication, transaction, moderation, release, and tag actions require
  explicit owner authorization.

## Known limitations and advisories

- Legacy data remains readable, but unresolved historical publisher authority
  is not automatically promoted to V2 authority.
- Current Core/Home capabilities evolve and must be re-verified.
- RC status does not imply stable promotion or current live deployment.
- Generated `.tmp-tests/`, `dist/`, `.release/`, caches, and release ZIPs are
  not source artifacts and must not be tracked by default.

## Mandatory rules

- MUST NOT weaken V2 authority to preserve a legacy write.
- MUST NOT let client timestamps, embedded authors, current name ownership
  alone, or derived indexes establish authority.
- MUST NOT begin the next GitHub issue automatically.
- MUST NOT publish, tag, release, commit, push, or close issues without owner
  authorization and completion evidence.

## Validation

Use `npm run verify` as the repository-wide automated baseline, then add the
validation levels required by the issue. Review `git status`, generated-file
tracking, and `git diff --check`.

## Completion criteria

- Target issue acceptance criteria pass.
- Architecture/compatibility boundaries remain intact.
- Required embedded/live validation is complete or status explicitly remains
  owner-live-validation-required.
- Final report lists exact Git and external-action state.

## Related files

- [`../00-SESSION-START.md`](../00-SESSION-START.md)
- [`../issue-driven-audit-and-refactor.md`](../issue-driven-audit-and-refactor.md)
- [`../live-qdn-validation.md`](../live-qdn-validation.md)
- [`../final-report-and-owner-handoff.md`](../final-report-and-owner-handoff.md)
- [`../../docs/ARCHITECTURE-V2.md`](../../docs/ARCHITECTURE-V2.md)
- [`../../docs/STARTUP-DIAGNOSTICS.md`](../../docs/STARTUP-DIAGNOSTICS.md)
- [`../../docs/RELEASE.md`](../../docs/RELEASE.md)
