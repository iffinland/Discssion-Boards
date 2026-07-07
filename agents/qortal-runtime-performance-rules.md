Qortal Runtime and Performance Rules

Purpose

This file captures practical Qortal-specific runtime rules, rendering
rules, and performance guidance for AI agents building Qortal qApps.
It should be read before major UI or data-loading decisions are made.

Core Runtime Model

- The app runs inside the Qortal environment, not a normal web2
  deployment model.
- Do not assume a centralized backend exists.
- Prefer Qortal-native flows and local-node-backed flows.
- Treat QDN access as asynchronous and stateful, not instant.

Path and Build Rules

- Use relative asset paths whenever possible.
- Avoid absolute root-based paths such as `/assets/...`.
- In Vite projects, ensure `base: './'` unless there is a proven reason
  to do otherwise.
- If a Qortal app renders a blank page on first load, check the build
  base first.

Preferred Data Access Pattern

When interacting with Qortal from a qApp:

- prefer `qortalRequest()` for supported actions
- use direct API calls only when appropriate and stable for the use case
- keep Qortal-specific network assumptions local to service/helper files

QDN Loading Rule

Do not treat a published QDN resource as instantly displayable.
The first load can be slow because the node may need to discover peers,
download chunks, and build the resource.

Use a readiness flow:

1. request the resource status
2. if status is `PUBLISHED`, `DOWNLOADING`, `DOWNLOADED`, or `BUILDING`,
   trigger build once when appropriate
3. show progress or a calm loading state
4. only render or fetch the final resource URL when status is `READY`

Relevant official action:

- `GET_QDN_RESOURCE_STATUS`

Relevant official endpoint:

- `/arbitrary/resource/status/{service}/{name}/{identifier}`

Useful Status Handling Guidance

- `READY`: safe to render or fetch normally
- `PUBLISHED`: known but not ready yet
- `DOWNLOADING`: fetching chunks
- `DOWNLOADED`: local data is present but build may still be needed
- `BUILDING`: assembly is in progress

The agent should build UI around these states instead of showing a
broken or blank result.

Performance Priorities

For Qortal apps, the agent should optimize first for perceived speed and
failure recovery, not only raw bundle metrics.

High-priority tactics:

- keep the first screen small and fast
- lazy-load heavy media and non-critical sections
- split large bundles where practical
- avoid rendering large QDN-driven lists all at once
- fetch metadata earlier than heavy content
- cache where safe, but always handle stale or missing QDN data
- add graceful fallback states for slow or unavailable resources

Mobile and UX Rules

- mobile usability is not optional
- assume the app may be used on smaller screens
- keep actions clear and reduce technical error language
- provide calm fallback text for waiting, building, and temporary
  unavailability
- avoid infinite “hanging” states without explanation

Publish and Verification Rules

Publishing should not be treated as complete just because a publish call
returned successfully.

The agent should, where possible:

- verify the publish result
- confirm the resource can be found again
- add retry-safe logic or user guidance if QDN propagation is still in
  progress
- avoid instantly assuming the new resource is fully ready everywhere

Suggested Architectural Pattern

Prefer separation like this:

- `src/services` or `src/lib/qortal` for Qortal and QDN interaction
- `src/hooks` for view-oriented loading and polling logic
- `src/components` for UI only
- central helpers for resource status checks and retry decisions

Official Reference Sources

Prefer these sources first when the agent needs more detail:

- Q-App docs: `https://qortal.dev/docs/extension`
- Developer overview: `https://qortal.dev/devs`
- API docs: `https://api.qortal.org/api-documentation/`
- qapp-core: `https://github.com/Qortal/qapp-core`

Agent Decision Rule

If the agent is unsure whether a loading, routing, or data issue is
caused by ordinary web assumptions, it should re-check these Qortal
rules before making architectural changes.
