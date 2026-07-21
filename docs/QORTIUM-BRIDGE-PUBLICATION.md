# Qortium bridge and file publication

Status: **Issue #11 implementation contract**

This document records the bridge and file-publication behavior verified for
Discussion Boards. Qortium Home and Core are active projects, so their action
and endpoint details must be checked again before a later change relies on
them.

## Verified references

| Repository        | Verified commit                                                      |
| ----------------- | -------------------------------------------------------------------- |
| Discussion Boards | `7bcc0ded7c0bc1aac6a6f378c0c15eed50b000fa` (issue #12 worktree base) |
| Qortium Home      | `a41e5f9678d7f20d7fb77a223c45fddc0096632e`                           |
| Qortium Core      | `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`                           |

At this Home revision, desktop and Android Q-Apps receive a callable
`qdnRequest(payload)` function. Desktop exposes it in the Q-App window through
the preload bridge; Android injects a window function that forwards to its
parent. Discussion Boards therefore searches, in deterministic order:

1. `globalThis.qdnRequest`;
2. `window.qdnRequest`;
3. `window.parent.qdnRequest`;
4. `window.top.qdnRequest`.

Every object and property access is guarded. A property is accepted only when
it is callable. The resolver reports `AVAILABLE`, `UNAVAILABLE`, `MALFORMED`,
or `INACCESSIBLE`; it continues past a bad earlier candidate when a later
supported context is callable. No code evaluates an undeclared
`qdnRequest` identifier.

Outside Qortium Home, publishing, wallet, signing, and bridge-mediated
discovery fail with a controlled `BRIDGE_UNAVAILABLE` error and instructions
to open the app through Home. The app does not provide a fake signing bridge.
Static UI and already available compatibility content can remain readable;
known direct QDN resource URLs may remain usable where the browser/node permits
them. This is not a promise that bridge-mediated QDN discovery works in a
standalone local browser.

## Verified Home/Core publication capabilities

Home exposes `SELECT_QDN_PUBLISH_SOURCE` with `kind: "file"`. Success returns
`canceled: false`, `fileName`, `size`, optional `mimeType`, and a
`sourceToken`; cancellation returns `canceled: true`. The token can be passed
to a single `PUBLISH_QDN_RESOURCE` request instead of `data64`.

At the verified Home commit:

- tokens are bound to the Q-App session/context and resource URL;
- at most eight selected sources are retained;
- tokens expire after 30 minutes;
- successful publication releases the token;
- no separate Q-App token-release action is exposed;
- the Home write boundary limits selected/public streamed sources to 100 MiB;
- the successful response includes `accepted`, resource coordinates, and a
  transaction signature when available.

The current Core exposes streamed arbitrary-data upload endpoints with and
without an identifier. Core's general configured maximum defaults to 2 GiB;
the public-QDN default is 100 MiB. Stream processing uses bounded chunks. The
Home boundary is the effective product limit for this Q-App and must not be
inferred from Core's larger private-node maximum.

Home owns the token and its source. Discussion Boards never persists or
reuses a source token after a submit attempt. On platforms whose Home picker
internally materializes bytes (the current Android implementation can do so),
Home itself may still retain one in-memory source representation until token
release/expiry. The guarantee here is narrower and important: a large file is
not converted into ArrayBuffer + base64 + JSON copies inside the Discussion
Boards page or sent through the bridge as inline data.

## Size-aware transport

The application threshold is exactly 2 MiB (`2 * 1024 * 1024` bytes):

| File size                                        | Transport                                       |
| ------------------------------------------------ | ----------------------------------------------- |
| `0` through `2 MiB` inclusive                    | bounded ArrayBuffer-to-base64, sent as `data64` |
| greater than `2 MiB` through `100 MiB` inclusive | Home source selection and `sourceToken`         |
| greater than `100 MiB`                           | rejected with `FILE_TOO_LARGE`                  |

Two MiB matches the existing image and text-attachment limits and bounds the
temporary page-side base64 amplification. Existing ZIP attachments can be up
to 10 MiB and videos up to 100 MiB, so their larger cases use the token path.
No source-token failure falls back to inline conversion. Images remain capped
at 2 MiB and therefore use the bounded path after their existing type and
dimension checks.

For a token publication, Home asks the user to select the same file again.
Discussion Boards compares Home's sanitized filename, exact byte size, and
MIME type when both sides supply it. A mismatch is rejected before publish.
This prevents an editor preview/reference from being paired with a different
Home-selected source.

## Confirmation, retry, and recovery

Before publication, the app checks the exact service/name/identifier. It
records a versioned local recovery entry keyed by service, publisher, filename,
MIME type, size, and `lastModified`. The entry preserves the assigned QDN
identifier, resource metadata, transport, transaction signature when returned,
and one of these stages:

- `PREPARED`;
- `POSSIBLE_ALREADY_PUBLISHED`;
- `SUBMITTED`;
- `CONFIRMATION_UNAVAILABLE`;
- `CONFIRMED`.

The current session keeps an in-memory copy and the browser copy survives
reload. If durable browser storage is unavailable, the browser runtime refuses
to start publication with `RETRY_REQUIRED`; it does not accept a submit whose
ambiguous state could be forgotten on reload.

The `POSSIBLE_ALREADY_PUBLISHED` marker is written immediately before the
bridge publish call. After an accepted response, exact QDN discovery confirms
the resource. If confirmation is unavailable, the UI receives a controlled,
retryable error and does not attach optimistic state to a Post.

Selecting the same file again first checks the stored exact identifier. A
known completed resource is reused without another publication. If discovery
is unavailable, or if an earlier submit remains ambiguous even though exact
discovery is currently empty, no automatic publish occurs. The recovery state
retains the same identifier for explicit follow-up; it never allocates a new
logical resource. Source tokens are deliberately not persisted: they are
context-bound, expire, and may have been consumed.

File publication is separate from Topic/Thread/Post authority. A media upload
contains only its resource coordinates, filename, and one source (`data64` or
`sourceToken`). It cannot change Post content, owner, reactions, poll,
moderation, tips, or indexes. Linking a confirmed reference occurs later via
the existing V2 creation/owner-edit field policy. Legacy media identifiers and
tags remain readable without migration.

## Stable error taxonomy

Bridge errors are `BRIDGE_UNAVAILABLE`, `BRIDGE_MALFORMED`, and
`BRIDGE_INACCESSIBLE`; bridge timeout is `REQUEST_TIMEOUT`. Upload commands
also distinguish `USER_CANCELLED`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`,
`SOURCE_TOKEN_FAILED`, `SOURCE_FILE_MISMATCH`, `FILE_PREPARATION_FAILED`,
`PUBLICATION_REJECTED`, `PUBLICATION_FAILED`, `CONFIRMATION_UNAVAILABLE`,
`RETRY_REQUIRED`, and `POSSIBLE_ALREADY_PUBLISHED`.

Cancellation is reported as cancellation, not a system failure. Explicit
rejection clears a non-submitted recovery entry. Timeout/unknown publish
results retain recovery and are never blindly retried. A missing/malformed
bridge remains a bridge error and never silently becomes a successful or
emulated secure action.

## Manual memory and recovery stress test

Use current Qortium Home with DevTools open and a named test account. Use
disposable test resources, then inspect the Network request payloads and the
Discussion Boards page heap:

1. Publish a 1.9 MiB TXT/MD test file. Confirm one bounded `data64` request and
   successful reference insertion.
2. Publish files of exactly 2 MiB and 2 MiB + 1 byte. Confirm the first is
   inline and the second opens Home source selection and sends only a
   `sourceToken`.
3. Publish a 10 MiB ZIP and a 95-100 MiB MP4/WebM. Select the same file in the
   Home picker. Confirm no `data64` field or full-file base64 string appears in
   the Q-App page/bridge request and page memory does not show the former
   multi-copy amplification.
4. Cancel the browser picker, Home source picker, and Home publish approval in
   separate runs. Confirm the UI says canceled and no attachment/tag appears.
5. After Home accepts a disposable upload, temporarily make exact QDN search
   unavailable. Confirm `CONFIRMATION_UNAVAILABLE`, no optimistic Post link,
   and a recovery record under `qdb-qdn-file-publication-recovery-v1`.
6. Restore search and select the same file. Confirm the stored identifier is
   found/reused and no second publish action occurs. If exact search remains
   empty after an ambiguous submit, confirm the app retains recovery and does
   not automatically republish.
7. Open the app outside Home. Confirm static/read-only surfaces do not crash
   and a publish/wallet attempt reports `BRIDGE_UNAVAILABLE` without a raw
   `ReferenceError`.
8. Open Posts containing pre-issue-#11 image, attachment, and video references.
   Confirm their existing tags/references still render and no migration is
   requested.

Record Home/Core commits, platform, file sizes/types, transaction signatures,
identifier(s), heap observations, and cancellation/recovery outcomes with the
test evidence.
