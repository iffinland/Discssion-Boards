# Qortium Discussion Boards

Qortium Discussion Boards is a Qortium Q-App for managing forum-style conversations on QDN.
It supports main topics, sub-topics, thread replies, role-based moderation, image attachments,
and Qortium-native account detection through the `qdnRequest` bridge.

## What the app does

- Loads forum structure from QDN resources.
- Loads thread posts on demand instead of pulling the full post set on first render.
- Uses persistent thread search indexes and local cache to reduce repeated QDN reads.
- Supports forum roles backed by a QDN role registry.
- Runs inside Qortium Home with relative asset paths and QDN readiness handling.

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
- Thread content should prefer thread-scoped indexes and caches before broader fallback scans.

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

## Utility scripts

- `npm run backup:workspace`
- `npm run restore:workspace`
- `npm run test:richtext`
- `npm run verify`

The backup and restore flow is documented in
[scripts/BACKUP-RESTORE.md](scripts/BACKUP-RESTORE.md).
Dependency, advisory, and routing maintenance decisions are recorded in
[docs/DEPENDENCY-BASELINE.md](docs/DEPENDENCY-BASELINE.md).

## Current architecture notes

- `ForumProvider` owns forum data loading, thread loading, and cache warming.
- `forumSearchIndexService` provides persistent topic and thread indexes.
- `forumQdnService` handles QDN publish/read flows for topics, sub-topics, posts, and images.
- `forumRolesService` resolves the forum role registry from trusted QDN resources.

## Verification status

At the time of the latest verification pass:

- `npm run lint` passes
- `npm run format:check` passes
- all Architecture V2 and Qortium integration suites pass
- `npm run build` should be used as the final production verification step before release
