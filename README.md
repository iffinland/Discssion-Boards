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

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Run lint:

```bash
npm run lint
```

Run a TypeScript build check:

```bash
npx tsc -b
```

Create a production build:

```bash
npm run build
```

## Utility scripts

- `npm run backup:workspace`
- `npm run restore:workspace`
- `npm run test:richtext`

The backup and restore flow is documented in
[scripts/BACKUP-RESTORE.md](scripts/BACKUP-RESTORE.md).

## Current architecture notes

- `ForumProvider` owns forum data loading, thread loading, and cache warming.
- `forumSearchIndexService` provides persistent topic and thread indexes.
- `forumQdnService` handles QDN publish/read flows for topics, sub-topics, posts, and images.
- `forumRolesService` resolves the forum role registry from trusted QDN resources.

## Verification status

At the time of the latest verification pass:

- `npm run lint` passes
- `npx tsc -b` passes
- `npm run build` should be used as the final production verification step before release
