# Forum Feature Module

## Current structure
- `components/ThreadPostCard.tsx`: thread post item UI and action wiring.
- `components/PostComposerModal.tsx`: modal composer for new posts and post replies.
- `components/ThreadComposer.tsx`: thread reply composer view.
- `hooks/useThreadActions.ts`: thread action and feedback orchestration.
- `hooks/useForumDataQuery.ts`: forum bootstrap/auth/QDN data query flow.
- `hooks/useThreadDataQuery.ts`: thread view data derivation (subtopic/posts/user map).
- `hooks/useForumCommands.ts`: forum create/update/delete/like command flow.
- `types.ts`: shared feature-level types (`ForumMutationResult`).

## Performance notes
- Initial home load fetches forum structure only (`topics`, `subTopics`).
- Thread posts are loaded on demand via `loadThreadPosts`.
- QDN resource readiness is gated in `src/services/qdn/qdnReadiness.ts`.
- Home and Thread use skeleton states during auth/resource loading.
- Thread post list uses incremental rendering with `IntersectionObserver`.
- Thread posts use local `offline-first` cache (`src/services/forum/threadPostCache.ts`).
- Background idle sync warms recent thread caches.
- Qortium account data is read through the `qdnRequest` bridge before QDN forum data is loaded.

## Rules
- Keep view-level components in `features/forum/components`.
- Keep QDN and ID logic in `src/services`.
- Keep app-wide context orchestration in `src/context/ForumContext.tsx`.

## Next recommended extraction
- `features/forum/hooks/useThreadActions.ts` for thread event handlers.
- `features/forum/components/ThreadComposer.tsx` for reply editor and submit flow.
- `features/forum/domain` for payload validation and DTO mapping.
