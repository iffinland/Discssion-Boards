# Qortium Discussion Boards

Qortium Discussion Boards is a Qortium Q-App for managing forum-style conversations on QDN.
It supports topics, threads, replies, authenticated reactions, Qortium-native polls,
role-authorized moderation, verified QORT tips, media/attachments, and Qortium-native account
detection through the `qdnRequest` bridge.

Current release status: **Architecture V2 release candidate `1.5.0-rc.1`**.
The version follows the current Qortium App Versioning Standard (QAVS): `1.5`
is the minimum Qortium platform level used by the app, and the remaining
version identifies this app release.

## What the app does

- Reduces authoritative Architecture V2 Topic, Thread, and Post records
  deterministically from trusted QDN metadata.
- Keeps legacy V1 forum content readable without allowing ambiguous legacy
  publishers to inherit V2 authority.
- Stores reactions, moderation, roles, and verified tip references as
  independent operations rather than mutable whole-Post snapshots.
- Uses native Qortium polls and Core-authoritative poll results.
- Uses paginated discovery and rebuildable, non-authoritative index fragments.
- Runs inside Qortium Home with relative assets, display settings,
  localization, wallet approval, and QDN readiness handling.

Architecture and migration details are in
[docs/ARCHITECTURE-V2.md](docs/ARCHITECTURE-V2.md).

## Stack

- React 19
- TypeScript
- Vite
- React Router
- ESLint + Prettier

## Project structure

```text
src/
  components/          Shared UI building blocks
  context/             App-wide forum state orchestration
  features/forum/      Forum feature hooks and feature-level components
  hooks/               Small app-facing hooks
  pages/               Route-level screens
  services/forum/      Search, rich text, cache, and ID helpers
  services/qdn/        QDN reads, writes, readiness, indexes, and roles
  services/qortium/    Qortium bridge and wallet helpers
```

## Qortium-specific rules

- Vite build base is set to `./` for Qortium QDN compatibility.
- Static assets must stay relative-path friendly.
- QDN resources are treated as asynchronous and may require readiness polling.
- Derived indexes and caches never establish entity or operation authority.
- Content described as restricted is still public and unencrypted on QDN.
- Signing, wallet access, native transactions, Home settings, and QDN
  publication require the injected Qortium Home bridge.
- Local browser development is limited/read-only where data is already
  available; it does not emulate secure bridge actions.
- New files through 2 MiB may use bounded inline publication. Larger accepted
  files through the currently verified 100 MiB Home limit use Home source
  tokens rather than page-side base64.

## Environment variables

See [.env.example](.env.example).

- `VITE_QORTIUM_QDN_SERVICE`: primary QDN service for forum data.
- `VITE_QORTIUM_QDN_IMAGE_SERVICE`: QDN service used for uploaded images.
- `VITE_QORTIUM_QDN_IDENTIFIER`: namespace prefix used for forum resources.

## Development

The verified development baseline is Node.js 24.18.0 and npm 12.0.1. Use the
repository `.nvmrc` and the npm version declared by `packageManager`; other
runtime lines are not part of the tested support claim.

Install the exact locked dependency graph:

```bash
nvm use
npm ci
```

Start the dev server:

```bash
npm run dev
```

Run lint:

```bash
npm run lint
```

Check repository formatting:

```bash
npm run format:check
```

Create a production build:

```bash
npm run build
```

Run the complete deterministic verification sequence:

```bash
npm run verify
```

Validate QAVS and version metadata independently:

```bash
npm run validate:manifest
npm run verify:version
```

The checked-in [qortium-app.json](qortium-app.json) is the current draft-v1
QAVS manifest. The authoritative version source is `package.json`; validation
requires the package, lockfile, manifest, build-injected UI value, and expected
release tag to remain synchronized.

## Utility scripts

- `npm run backup:workspace`
- `npm run restore:workspace`
- `npm run test:richtext`
- `npm run verify`
- `npm run validate:manifest`
- `npm run verify:version`
- `npm run release:dry-run`

The backup and restore flow is documented in
[scripts/BACKUP-RESTORE.md](scripts/BACKUP-RESTORE.md).
Dependency, advisory, and routing maintenance decisions are recorded in
[docs/DEPENDENCY-BASELINE.md](docs/DEPENDENCY-BASELINE.md).
Release tags, artifacts, provenance, source availability, embedded Home checks,
and the non-publishing dry run are documented in
[docs/RELEASE.md](docs/RELEASE.md). Draft Architecture V2 candidate notes are
in
[docs/releases/ARCHITECTURE-V2-RC1.md](docs/releases/ARCHITECTURE-V2-RC1.md).

## QDN deployment and source

The architecture review identified the existing app target as:

```text
qdn://APP/Discussion_Boards/discussion-boards
```

No production QDN publication is performed by repository build or verification
commands. Every approved deployment must identify the exact source commit and
release tag, artifact SHA-256, and resulting QDN transaction/resource
reference. Source repository:
[github.com/iffinland/Discssion-Boards](https://github.com/iffinland/Discssion-Boards).

## Verification status

At the time of the latest verification pass:

- `npm run lint` passes
- `npm run format:check` passes
- all Architecture V2 and Qortium integration suites pass
- `npm run build` should be used as the final production verification step before release

## License

Copyright © 2026 iffinland.

Discussion Boards is free software licensed under the
[GNU General Public License v3.0 only](LICENSE), SPDX identifier
`GPL-3.0-only`. It comes with absolutely no warranty. Third-party component
attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
