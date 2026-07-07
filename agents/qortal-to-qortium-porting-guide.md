Qortal to Qortium Porting Guide

Purpose

This file captures practical lessons learned while converting a Qortal
qApp into a Qortium app. It is intended for future AI agents so the next
Qortal-to-Qortium port does not start from zero.

The goal is not to describe Qortal or Qortium in general. The goal is to
document the concrete migration rules, failure modes, and working
patterns discovered during the Discussion Boards port.

Project Context

- Source app: a Qortal discussion board qApp.
- Target runtime: Qortium Home.
- Main bridge difference: Qortal `qortalRequest` patterns were replaced
  by Qortium `window.qdnRequest` based requests.
- Qortium app share links use the app QDN address with query parameters
  for in-app routing.

High-Level Porting Strategy

For a Qortal app that should become Qortium-only:

1. Remove Qortal-specific runtime wrappers that do not work in Qortium.
2. Replace Qortal bridge calls with Qortium bridge calls.
3. Rename Qortal service modules to Qortium service modules.
4. Remove Qortal fallback logic instead of keeping mixed runtime code.
5. Keep all QDN publish, fetch, and readiness logic in service files.
6. Test one small user-visible flow at a time inside Qortium Home.

Do not keep Qortal compatibility code unless the user explicitly wants a
dual-runtime app. Mixed runtime support makes the code harder to reason
about and can hide Qortium-specific bugs.

Bridge and Request Model

Qortal apps commonly use:

```ts
qortalRequest(...)
```

In Qortium Home, use a small wrapper around:

```ts
window.qdnRequest(...)
```

Recommended wrapper shape:

```ts
export const requestQortium = async <T>(payload: unknown): Promise<T> => {
  const qdnWindow = window as Window & {
    qdnRequest?: (payload: unknown) => Promise<T>;
  };

  if (typeof qdnWindow.qdnRequest !== 'function') {
    throw new Error('Qortium request bridge is not available.');
  }

  return qdnWindow.qdnRequest(payload);
};
```

Keep the wrapper in a service file such as:

```text
src/services/qortium/qortiumClient.ts
```

Then import that wrapper everywhere instead of touching `window.qdnRequest`
directly in UI components.

Important Migration Rule

Search the codebase for all of these:

```text
qortalRequest
requestQortal
services/qortal
qortal://
qapp-core
GlobalProvider
useAuth
useQortBalance
```

For a Qortium-only port, each of those should either be removed, renamed,
or replaced with a Qortium equivalent.

Account Detection

In this port, account detection worked after switching to Qortium
selected account access.

Expected pattern:

```ts
await requestQortium({
  action: 'GET_SELECTED_ACCOUNT',
});
```

The selected account can provide the active address and registered names.
The app should prefer the active Qortium name for QDN publishing because
QDN resources are published under a name.

Practical rule:

- Do not assume the wallet address alone is enough for publishing.
- Resolve and store the active Qortium name.
- Support accounts with multiple registered names.
- Keep username/name resolution in wallet or account service helpers.

Roles and SysOp

If the app has QDN-based role or admin logic, check the configured
primary SysOp address early.

For this Discussion Boards port, the active SysOp wallet address was:

```text
QN1XYwwmTzXemusDb9p7T1nKJEACLHGgaL
```

After that address was set, SysOp functionality opened correctly:

- creating main topics
- adding admins
- adding moderators
- enabling normal user posting flows

Do not assume old Qortal addresses or role registry resources are still
valid after migration.

QDN Services Used

The Discussion Boards app uses these QDN service types:

```text
DOCUMENT
IMAGE
FILE
VIDEO
```

Typical meaning:

- `DOCUMENT`: forum data such as topics, sub-topics, posts, indexes, and
  role registry documents.
- `IMAGE`: uploaded post images.
- `FILE`: generic attachments.
- `VIDEO`: uploaded videos.

Default namespace used by this app:

```text
qdbm
```

Example resource identifiers:

```text
qdbm-topic-<topicId>
qdbm-sub-<subTopicId>
qdbm-post-<threadPartition>-<postId>
qdbm-img-<imageId>
qdbm-att-<attachmentId>
qdbm-video-<videoId>
```

The post identifier is thread-scoped, not just post-scoped:

```text
qdbm-post-<partition derived from subTopicId>-<postId>
```

This matters when trying to find or verify a post in QDN Explorer.

Publishing JSON Resources

Forum content is published as JSON-like payloads under `DOCUMENT`.

Typical payload shape:

```ts
{
  version: 1,
  type: 'post',
  status: 'active',
  updatedAt: Date.now(),
  post,
}
```

Similar payloads are used for:

```text
topic
subtopic
post
```

Recommended workflow after publish:

1. Publish the QDN resource.
2. Fetch it again by `service + name + identifier`.
3. Confirm the expected `type`.
4. Retry briefly because QDN readiness can lag behind publish return.

Do not treat a returned publish call as proof that the resource is ready
for normal reads.

Images and Attachments

The first broken media flow in this port produced this error:

```text
Validation of IMAGE failed: INVALID_FILE_COUNT
```

The cause was publishing file data in a form Qortium Home did not accept
for that service.

Working pattern:

- Convert the selected file to base64.
- Send `data64`.
- Include `filename`.
- Do not rely on passing a raw `File` object through the bridge.

Recommended publish payload shape:

```ts
await requestQortium({
  action: 'PUBLISH_QDN_RESOURCE',
  service: 'IMAGE',
  name,
  identifier,
  data64,
  filename: file.name,
});
```

Use the same base64 + filename pattern for:

```text
IMAGE
FILE
VIDEO
```

Video Uploads

Video upload support was added using the same QDN publish model:

- accept a local video file from the user
- validate type and size in the app
- publish to QDN service `VIDEO`
- generate an internal rich-text tag after publish
- render it lazily so the video is not downloaded with the page

Accepted video MIME types used in this port:

```text
video/mp4
video/webm
video/ogg
```

Size limit used in this port:

```text
100 MB
```

The app should not eagerly load videos while rendering a thread. It
should show a preview/placeholder and only fetch the QDN video when the
user opens or plays it.

Rich Text Media Tags

This app uses internal tags for embedded QDN media instead of raw HTML.

Image tag pattern:

```text
[imgqdn]name|identifier|filename[/imgqdn]
```

Video tag pattern:

```text
[videoqdn]source|name|identifier|title[/videoqdn]
```

Keep parsing, sanitizing, encoding, and rendering in service/helper files
instead of scattering string manipulation throughout UI components.

QDN Readiness

QDN resources may not be ready immediately after publishing.

Recommended pattern:

- check resource status
- retry briefly
- keep missing-resource quarantine/cache logic for known failures
- show calm UI feedback instead of raw technical errors

The app should treat QDN as eventually available, not instantly
available.

Build and Routing Rules

For Vite apps in Qortium/QDN style runtime:

```ts
base: './'
```

Keep assets relative. Avoid absolute root paths unless the runtime is
confirmed to support them.

Version Reset Rule

When forking a Qortal app into a new Qortium fork, reset app versions to
an initial version instead of keeping old Qortal production numbers.

For this port:

```text
0.1.0
```

This was applied to:

```text
package.json
package-lock.json
visible app footer/version text
```

Qortal Cleanup Rule

When the user wants a clean Qortium fork:

- remove Qortal imports
- rename service folders from `qortal` to `qortium`
- remove qapp-core if it is not used
- remove `GlobalProvider` if the app now uses direct Qortium services
- remove `qortal://` references
- remove Qortal fallback branches

Recommended naming examples:

```text
src/services/qortal/qortalClient.ts
-> src/services/qortium/qortiumClient.ts

requestQortal(...)
-> requestQortium(...)

services/qortal/walletService
-> services/qortium/walletService
```

Share Links

This is important.

Qortium Home supports app share links when the app address is used as
the base and the in-app target is passed with query parameters.

Working base format:

```text
qdn://APP/<appName>/<appIdentifier>
```

Working Discussion Boards share examples:

```text
qdn://APP/Discussion_Boards/qdbm?topic=<topicId>
qdn://APP/Discussion_Boards/qdbm?thread=<threadId>
qdn://APP/Discussion_Boards/qdbm?thread=<threadId>&post=<postId>
```

Do not put the React route after the app identifier as a path segment.
Use query parameters and let the app redirect internally after startup.

Recommended helper behavior:

1. Build the app base address from Qortium runtime globals:
   `window._qdnService`, `window._qdnName`, `window._qdnIdentifier`.
2. If runtime globals are missing, parse `/render/<service>/<name>/<identifier>`.
3. If both are missing, fall back to the app defaults.
4. Append `?topic=...`, `?thread=...`, or `?thread=...&post=...`.
5. On app startup, read those query params and navigate to the internal
   React route.

Example startup redirect behavior:

```text
?topic=<topicId>
-> /topic/<topicId>

?thread=<threadId>
-> /thread/<threadId>

?thread=<threadId>&post=<postId>
-> /thread/<threadId>?post=<postId>
```

The thread page can then use the existing `post` query parameter to
highlight or scroll to the shared post.

Clipboard behavior should prefer the textarea copy fallback first,
because embedded Qortium app frames may expose browser clipboard APIs
without allowing writes consistently.

Useful copy order:

1. `textarea + document.execCommand('copy')`
2. `navigator.clipboard.writeText`
3. retry textarea fallback

Direct resource style:

```text
qdn://DOCUMENT/<name>/<identifier>
```

This opens the raw QDN resource page, for example:

```text
This resource is ready to download.
Service: DOCUMENT
Name: iffi_vaba_mees
Identifier: qdbm-post-...
```

That is technically the correct QDN document, but it is not the desired
forum UX because it does not open the post inside the forum app.

Current rule:

- Use `qdn://APP/<appName>/<appIdentifier>?...` for user-facing share
  links.
- Do not use raw `DOCUMENT` resource links as user-facing forum share
  links.
- Do not use path-style app links such as
  `qdn://APP/<appName>/<appIdentifier>/thread/<threadId>` unless Qortium
  explicitly documents support for them.

Recommended Porting Checklist

Use this checklist when starting another Qortal-to-Qortium app port.

1. Read the project and identify all Qortal runtime dependencies.
2. Decide whether the target is Qortium-only or dual runtime.
3. If Qortium-only, remove qapp-core and Qortal fallback code.
4. Create or update `src/services/qortium/qortiumClient.ts`.
5. Replace `qortalRequest` or `requestQortal` with `requestQortium`.
6. Implement `GET_SELECTED_ACCOUNT` based account detection.
7. Verify active Qortium name resolution.
8. Check all role/admin/sysop constants and registry resources.
9. Convert QDN publish calls to Qortium-compatible payloads.
10. For files, images, attachments, and videos, use `data64 + filename`.
11. Verify every publish by reading the resource back.
12. Keep QDN readiness and retry logic.
13. Reset app version to the new fork's initial version.
14. Check `vite.config` for `base: './'`.
15. Remove old `qortal://` and HTTP-based share link generation.
16. Rebuild share links as `qdn://APP/<appName>/<appIdentifier>?...`
    links and add an app startup redirect for the query parameters.
17. Run build and focused tests.
18. Test inside Qortium Home with at least two accounts.

Testing Lessons

Do not rely only on local browser tests.

For Qortium ports, test inside Qortium Home:

- account detection
- switching between accounts
- multiple registered names
- role-based UI
- creating admin-only resources
- normal user posting
- image upload
- attachment upload
- video upload
- QDN resource visibility in QDN Explorer
- reload behavior after publish

Useful validation commands for this React/Vite project:

```text
npm run build
npm run test:richtext
```

Agent Behavior Rules

When a future agent reads this file, it should:

- prefer direct code inspection over assumptions
- keep Qortium-specific code in `src/services/qortium`
- keep QDN service logic in `src/services/qdn`
- remove old Qortal compatibility code when the user wants a clean
  Qortium fork
- use app-address query-param deep links for share buttons
- document every newly discovered Qortium runtime rule back into this
  file or a project-specific agent file

Open Unknowns

The following are not yet confirmed and should not be guessed:

- whether path-style app links such as
  `qdn://APP/<appName>/<appIdentifier>/thread/<threadId>` are supported
  now or planned later
- whether raw QDN resource links can carry app route metadata
- whether Qortium Home will expose a clipboard/share bridge API beyond
  browser clipboard APIs

If any of these are answered by Qortium developers, update this file
before porting the next app.
