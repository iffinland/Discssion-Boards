# Startup diagnostics and issue #15 findings

## Scope and reference point

This report covers the initial Discussion Boards structure load at repository
commit `e587c29` plus the issue #15 working-tree changes. Measurements were
read-only. No QDN resource was published, signed, or changed.

The checked Qortium reference revisions remain:

- Core: `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`
- Home: `a41e5f9678d7f20d7fb77a223c45fddc0096632e`

## Original loading view and lifecycle

The observed text originated in
`src/features/forum/hooks/useForumDataQuery.ts`, which set
`loadingStage = "Loading forum structure..."` immediately before awaiting
`forumSearchIndexService.loadTopicDirectoryIndex()`.

`src/pages/Home.tsx` rendered that value when both Topic and Thread arrays were
empty and `isAuthReady` was false. It cleared only after the index load, the
authoritative structure load (including legacy/V2 merge and moderation), and
the state update had completed. Errors also cleared it, but a single bridge
read could use a 120-second timeout and two retries; the index readiness
fallback could add another polling interval.

The original foreground sequence was:

```text
main.tsx
  -> DisplaySettingsProvider (asynchronous, non-blocking)
  -> ForumProvider / useForumDataQuery
     -> bridge probes
     -> GET_SELECTED_ACCOUNT
     -> role-registry discovery and payload load
     -> topic-directory index discovery
        -> fetch every publisher copy
        -> readiness polling/retries for unavailable copies
     -> authoritative Topic + Thread discovery/payload loading
     -> V2 authority merge
     -> moderation merge
     -> set Topics/Threads
     -> isAuthReady=true
  -> Home first useful render
```

The topic-directory index is derived and non-authoritative. On the successful
path its payload was discarded after it had blocked the authoritative load.

Other lifecycle findings:

- React StrictMode can mount the startup effect twice in development.
- Resolving account names changed an effect dependency and could cancel and
  restart bootstrap.
- the identity marker was written before structure completion, creating a
  possible cancelled-first-run/empty-second-run state;
- retry set the bridge probe to `0`, which did not retrigger when it was
  already `0`;
- account lookup failure prevented otherwise public structure reads;
- outstanding bridge requests are not abortable, although stale React effects
  ignored their results.

## Read-only endpoint measurements

The existing SSH tunnel exposes Qortium Core at `127.0.0.1:24891`. The
following read-only endpoints were used:

- `/admin/status`
- `/blocks/height`
- `/arbitrary/resources/search`
- `/arbitrary/resource/status/DOCUMENT/{name}/{identifier}`
- `/arbitrary/DOCUMENT/{name}/{identifier}`

No independently automatable HTTP or browser-debug endpoint for the running
Qortium Home AppImage was found. Port `6566` did not provide a usable HTTP
response. Embedded-Home timings therefore still require the in-app report.

Three search runs were measured through the tunnel:

| Operation                             | Results |    Run 1 |    Run 2 |    Run 3 | Startup role before fix |
| ------------------------------------- | ------: | -------: | -------: | -------: | ----------------------- |
| Role bootstrap (`qdbm-roles-default`) |       2 | 476.3 ms | 113.6 ms |  99.2 ms | blocking                |
| Role operations                       |       0 | 167.2 ms | 116.6 ms | 127.7 ms | blocking                |
| Topic directory (`qdbm-index-topics`) |       4 | 158.0 ms |  89.1 ms | 108.3 ms | blocking                |
| Legacy Topics (`qdbm-topic-`)         |      20 | 121.5 ms | 167.1 ms | 132.2 ms | blocking                |
| Legacy Threads (`qdbm-sub-`)          |      15 | 131.4 ms |  92.7 ms | 109.1 ms | blocking                |
| V2 Topics                             |       0 |  95.0 ms |  89.7 ms | 118.8 ms | blocking merge          |
| V2 Threads                            |       0 | 122.3 ms | 122.0 ms | 164.9 ms | blocking merge          |
| V2 Posts                              |       2 |  95.0 ms |  88.0 ms | 126.3 ms | not initial structure   |
| V2 owner edits                        |       0 | 102.0 ms | 110.0 ms | 144.6 ms | blocking merge          |
| V2 moderation                         |       0 | 126.9 ms | 101.4 ms | 120.1 ms | blocking merge          |

Every result set fit in one 100-item page. Discovery still uses complete
pagination rather than assuming that 100 results is globally sufficient.

Payload measurements with concurrency six:

| Payload group          | Available |        Measured completion |
| ---------------------- | --------: | -------------------------: |
| Topic-directory copies |    3 of 4 |                 3,182.8 ms |
| Legacy Topics          |  20 of 20 |                   476.2 ms |
| Legacy Threads         |  15 of 15 |                   336.9 ms |
| Role bootstrap         |    2 of 2 | 5,427.1 ms on one cold run |
| V2 Posts               |    2 of 2 |                   159.3 ms |

The four topic-directory publishers were `Raven`, `PolarBear`,
`iffi_vaba_mees`, and `Discussion_Boards`. The `Raven` search result reported
`DOWNLOADING`; its direct status was `MISSING_DATA`. Its first payload request
failed with HTTP 404 after 14.763 seconds; a later request failed after 3.182
seconds. The other three copies were readable in roughly 0.18–0.22 seconds.
The latest readable copy was newer than the unavailable copy.

With the app's bridge retry and readiness behavior, that one unavailable
derived copy could hold the exact loading stage for approximately 20–55
seconds depending on node cache state. In contrast, currently readable
authoritative Topic and Thread payload groups completed in about 0.8 seconds
combined after their searches.

After applying the READY-copy selection, the three resources that the derived
index loader would retain were measured again directly:

| Run | PolarBear | iffi_vaba_mees | Discussion_Boards | Slowest candidate |
| --- | --------: | -------------: | ----------------: | ----------------: |
| 1   |  169.6 ms |       169.1 ms |          174.9 ms |          174.9 ms |
| 2   |  356.1 ms |       182.9 ms |          171.7 ms |          356.1 ms |
| 3   |  176.4 ms |       223.8 ms |          178.1 ms |          223.8 ms |

The unavailable `Raven` copy was excluded from these post-change candidate
measurements. Since copies are fetched concurrently, the slowest candidate is
the relevant payload bound (plus the roughly 0.09–0.16 second search). These
are Core-path measurements, not embedded-Home first-render measurements.

## Root cause

`useForumDataQuery` awaited complete all-publisher loading of the legacy,
derived topic-directory index before starting authoritative forum discovery.
One unavailable duplicate index resource therefore held
`isAuthReady=false`, although three usable index copies and all authoritative
Topic/Thread resources were available. The index did not contribute to the
normal successful result.

## Narrow fix and new lifecycle

The authoritative structure request and the derived index refresh now start in
parallel. The authoritative result controls first render. The derived index:

- completes in the background;
- is retained only as a read-only fallback after authoritative failure;
- is awaited for at most five seconds on that fallback path;
- fetches only `READY` exact copies when at least one is available, recording
  skipped non-ready copies as partial diagnostics.

Identity and role work starts concurrently but no longer gates public structure
display. Identity failure enters guest read mode. Identity, role, and structure
startup waits are bounded at 8, 10, and 45 seconds respectively. Complete empty
discovery remains an honest empty state; partial discovery remains visibly
partial; authoritative failure uses a valid derived fallback or becomes an
error. A retry generation always starts a new run. Effect cleanup prevents an
older run from applying state.

```text
APP_START
  -> bridge probe
  -> BRIDGE_READY
  -> in parallel:
       identity (non-blocking for public display)
       roles (non-blocking for public display)
       derived topic directory (background)
       authoritative Topic/Thread/V2/moderation structure (foreground)
  -> first authoritative structure
  -> FIRST_STRUCTURE_AVAILABLE
  -> LOADING_STATE_FALSE
  -> FIRST_USEFUL_RENDER
  -> identity/roles update user capabilities when ready
  -> BACKGROUND_DISCOVERY_COMPLETE
```

Home display settings remain a separate non-blocking effect.

## In-app report

Open any Discussion Boards route with `debugStartup=1`, for example:

```text
?debugStartup=1
```

The parameter is preserved by initial Topic/Thread share redirects and legacy
hash normalization. A collapsed amber **Startup diagnostics** panel appears in
the lower-right corner. It is absent when the parameter is not exactly `1`.

The panel provides:

- elapsed time and current startup state;
- an ordered event and request timeline;
- request action, public QDN selectors, pagination, retry, duration, result
  count, and outcome;
- duplicate request groups and cumulative duplicate duration;
- error/timeout totals;
- **Copy diagnostics** and **Download JSON** actions.

The report is capped at 400 events. It never includes request bodies, post or
message content, authentication material, private keys, wallet secrets, or
signatures. Secret-like diagnostic detail is redacted defensively.

For owner validation, perform three cold opens, three warm/reopen opens, a
route refresh, and a direct Topic or Thread share open. Save each JSON report.
Compare `APP_START`, `FIRST_STRUCTURE_AVAILABLE`, `LOADING_STATE_FALSE`,
`FIRST_USEFUL_RENDER`, and `BACKGROUND_DISCOVERY_COMPLETE`. This is the needed
after-change embedded-Home measurement; local Core timings cannot substitute
for it.

## Expected performance and interpretation

The code-path blocker measured at 20–55 seconds is no longer on the foreground
success path. Under the measured node conditions, the authoritative search and
payload work supports the 3–5 second first-structure target, but this is an
inference from Core measurements, not a claimed embedded-Home result. The
owner report is authoritative for closure.

Duplicate request groups in development can include StrictMode effect mounts.
Production duplicates or a large gap between structure availability and useful
render should be treated as a regression and investigated from the recorded
request IDs and triggers.
