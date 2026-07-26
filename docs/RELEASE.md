# Discussion Boards release policy

Status: **Issue #14 release contract**

This document defines a non-publishing, reviewable path from source to a
Discussion Boards QDN artifact. Qortium Home and QAVS are evolving, so their
current contract must be re-verified before every production release.

## Authoritative QAVS reference

The current checked-out authority is:

| Reference                                                              | Commit                                     |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| Qortium Home repository                                                | `a41e5f9678d7f20d7fb77a223c45fddc0096632e` |
| `docs/APP_VERSIONING.md` and `electron/app-versioning.ts` introduction | `7e0bd53b972a01bdcd02b6e4cefae76e13e54169` |
| Qortium Core repository inspected with Home                            | `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` |

That implementation defines QAVS draft v1. The root `qortium-app.json`
contains:

- `version`, required, in `X.Y.Z` syntax;
- `name`, optional;
- unknown fields, ignored.

Home reads at most 16 KiB and uses only `version` for its compatibility badge.
There is no current manifest schema for identifiers, entry points,
permissions, licenses, repositories, icons, or capability declarations.
Discussion Boards therefore does not invent those fields. Its factual bridge
capability inventory remains in Architecture V2 and the issue-specific bridge
documents.

### Current capability inventory

The source audit found these bridge action families:

- QDN reads: `SEARCH_QDN_RESOURCES`, `FETCH_QDN_RESOURCE`,
  `GET_QDN_RESOURCE_STATUS`, and `GET_QDN_RESOURCE_URL`;
- QDN writes: `PUBLISH_QDN_RESOURCE`,
  legacy-compatible `PUBLISH_MULTIPLE_QDN_RESOURCES`, and
  `SELECT_QDN_PUBLISH_SOURCE`;
- account/name reads: `GET_SELECTED_ACCOUNT`, `GET_ACCOUNT_NAMES`,
  `GET_NAME_DATA`, and `GET_BALANCE`;
- native transaction requests: `CREATE_POLL`, `VOTE_ON_POLL`, `UPDATE_POLL`,
  and `SEND_COIN`;
- narrowly mediated Core reads: `FETCH_NODE_API`;
- Home integration: `GET_HOME_SETTINGS`, plus follow-list `GET_LIST` and
  `ADD_TO_LIST`.

These are code and approval boundaries, not persistent blanket permissions
granted by a manifest. The app does not claim encrypted/private-content
support. If QAVS later standardizes capability declarations, add only actions
re-verified in the then-current source and Home action catalogue.

## Version source of truth

`package.json` is the canonical version source. The same value must appear in:

- `package-lock.json` top-level and root package metadata;
- `qortium-app.json`;
- the UI through Vite's generated `__APP_VERSION__`;
- the expected release tag `v<package version>`;
- artifact and provenance filenames/fields.

`npm run verify:version` fails on disagreement. Vite also fails the build when
the package and manifest versions differ.

### QAVS versus application SemVer

The original issue proposed conventional application Semantic Versioning and
suggested `2.0.0-rc.1` for Architecture V2. The current authoritative QAVS
standard assigns a different meaning to those numbers:

- `X.Y` is the minimum Qortium platform level used by the app;
- `Z` is the app's free-running release counter;
- moving to a newer required platform level resets `Z` to zero;
- a prerelease suffix identifies an alpha, beta, or release candidate.

Discussion Boards uses the Home 1.5 display-settings bridge, so this release
candidate is `1.5.0-rc.1`. Advertising `2.0.0-rc.1` would incorrectly tell
Home and users that platform 2.0 is required.

The version string remains SemVer-compatible in syntax
(`MAJOR.MINOR.PATCH[-prerelease]`), but its QAVS meaning supersedes ordinary
application SemVer:

- QAVS `MAJOR.MINOR`: minimum platform compatibility;
- QAVS `PATCH`: backward-compatible app release counter;
- `rc.N`, `beta.N`, and `alpha.N`: reviewed prerelease maturity.

Architecture V2's incompatible state-model boundary remains expressed by
`schemaVersion: 2`, migration rules, and Architecture V2 release notes. It is
not encoded by falsely claiming a Qortium platform 2.x dependency. Internal
commits do not each require a version bump; a version changes when a build is
prepared for a distinct shared test or production release.

## Tags

Release tags exactly match the canonical version:

- `v1.5.0-rc.1` for this release candidate;
- `v1.5.0` for the corresponding production release if that exact QAVS
  version remains appropriate;
- later QAVS app releases increment the app counter, for example `v1.5.1`.

Never create a release tag until the clean source commit and artifact pass the
production checklist. Do not move or replace a published release tag.

Architecture/reference tags such as `v1-legacy-state-model` mark historical
state-model checkpoints. They:

- are not automatically releases;
- may intentionally use descriptive non-release names;
- do not imply a build, GitHub Release, or QDN deployment;
- must not be deleted or rewritten as part of release cleanup.

No local or remote tags or GitHub Releases existed at the issue #14 baseline.
The issue's `v1-legacy-state-model` name remains a documented future/reference
convention, not a tag silently created by this work.

## GitHub Releases

Create a GitHub Release for:

- a production version;
- a meaningful prerelease shared outside the maintainer's local environment.

Do not create one for every commit. A GitHub Release must use the already
validated tag and attach or identify the exact verified artifact. Release
notes include:

- major behavior and integrity changes;
- compatibility and migration behavior;
- known limitations and manual-check status;
- source commit and tag;
- artifact filename, byte size, and SHA-256;
- QDN service, publisher, identifier, and resource/transaction reference after
  publication.

## QDN deployment identity

Architecture review issue #1 identified the reviewed deployment as:

```text
qdn://APP/Discussion_Boards/discussion-boards
```

That is the expected deployment target, not permission to publish. Before a
release, verify the current owner-controlled publisher name and deployment
history again. Republishing the same `APP` publisher/identifier updates that
QDN resource; it must not change the source/artifact provenance record.

After publication, record the actual QDN transaction signature or resource
reference in the GitHub Release notes and retained deployment provenance.
Until publication it remains `null`/pending.

## Source availability

Every distributed QDN build must point recipients to:

```text
https://github.com/iffinland/Discssion-Boards/tree/<exact-release-tag>
```

The tag resolves the exact corresponding source, build scripts, manifest,
license, and notices. A moving `main` branch is useful for current development
but is not the sole source reference for a versioned deployment.

## Production checklist

### Source and environment

- [ ] Working tree is clean.
- [ ] Correct release branch is checked out.
- [ ] Expected source commit was reviewed.
- [ ] Current Core/Home/QAVS behavior was re-verified and commits recorded.
- [ ] `node --version` is `v24.18.0`.
- [ ] `npm --version` is `12.0.1`.
- [ ] No API key, wallet file, seed, private key, recovery/cache data, or local
      `.env` file is present in source or release output.

### Install and verification

- [ ] Remove the prior `node_modules` tree through the normal clean install
      path and run `npm ci`.
- [ ] Run `npm run verify`.
- [ ] Run `npm run validate:manifest`.
- [ ] Run `npm run verify:version`.
- [ ] Review the documented `npm audit --omit=dev` result.
- [ ] Run `git diff --check`.

### Build and artifact

- [ ] Run `npm run release:artifact` from a clean tree.
- [ ] Confirm `index.html`, `qortium-app.json`, `LICENSE`, and
      `THIRD_PARTY_NOTICES.md` are at the ZIP root.
- [ ] Confirm JS/CSS chunks and required static assets are present.
- [ ] Confirm there is no extra `dist/` directory level.
- [ ] Confirm no ZIP is nested inside itself.
- [ ] Confirm no source maps, `node_modules`, `.env`, secret material, recovery
      data, absolute local paths, or unrelated development files are present.
- [ ] Verify the generated `.sha256` against the artifact.
- [ ] Review `.release/provenance.json`, including clean state, source commit,
      version, expected tag, artifact checksum/size, and pending QDN reference.

### Embedded Qortium checks

- [ ] Load the app through current Qortium Home.
- [ ] Verify Home, Topic, and Thread navigation.
- [ ] Verify browser back/forward.
- [ ] Refresh on routed Topic and Thread pages under the injected QDN base.
- [ ] Verify legacy hash and `?topic=`, `?thread=`, and `?post=` redirects.
- [ ] Exercise lazy-chunk recovery/`RouteRefreshNotice`.
- [ ] Check the console for new warnings or errors.
- [ ] Verify signing/publication approval flows with a disposable test resource.
- [ ] Repeat the large-file source-token memory/recovery procedure from
      `docs/QORTIUM-BRIDGE-PUBLICATION.md`.

### Tag, release, and deployment

- [ ] Prepare and review release notes.
- [ ] Create the release tag only after every preceding production check.
- [ ] Create the GitHub Release from that exact tag.
- [ ] Attach or identify the exact checksummed artifact.
- [ ] Publish that verified artifact to the approved QDN target.
- [ ] Reload the deployed resource through Home and repeat the smoke checks.
- [ ] Record the deployment transaction/resource reference in provenance and
      release notes.
- [ ] Confirm source tag, release, artifact checksum, and QDN resource form one
      continuous provenance chain.

## Non-publishing dry run

From the documented Node/npm environment:

```bash
npm ci
npm run release:dry-run
```

The dry run runs repository verification, validates metadata, builds the
artifact, checks its root/safety properties, writes SHA-256 and provenance,
and verifies that the expected release tag does not exist. It neither creates
a Git tag or GitHub Release nor invokes QDN publication.

Because issue work is uncommitted during review, dry-run provenance may record
`dirty: true`; such an artifact is review-only and must never be published.
`npm run release:artifact` without the dry-run allowance fails on a dirty tree.

## Reproducibility claims

- The locked Node/npm development and `npm ci` baseline is reproducible.
- Artifact layout, filenames, file ordering, normalized ZIP metadata, checksum,
  and provenance fields are deterministic or traceable by tooling.
- A build is not claimed byte-for-byte reproducible across operating systems,
  zip implementations, or future tool versions unless two independent builds
  have demonstrated that property.
