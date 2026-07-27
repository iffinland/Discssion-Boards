# Runtime Diagnostics and Performance

## Purpose

Diagnose user-visible loading, responsiveness, duplicate initialization, and
state-transition failures with measurements before applying a narrow fix.

## Use when

Use for startup delays, stuck loading, slow routes, excessive bridge/QDN calls,
stale results, or runtime behavior that architecture/build tests did not catch.

## Do not use when

Do not begin with speculative refactoring. Do not rely exclusively on console
logs or F12. Do not claim improvement from code inspection alone.

## Prerequisites

- Reproducible user-visible symptom.
- Exact loading/error UI and state owner.
- Access to relevant local, Core/API, and embedded/live environments.

## Required inputs

- Start and success definitions.
- Current call graph and state transitions.
- Request actions/endpoints and QDN selectors.
- Cold/warm/route-refresh scenarios.
- Security restrictions on diagnostic data.

## Core rule

```text
MEASURE FIRST. FIX SECOND.
```

## Workflow

### 1. Locate the exact UI

Identify:

- component and provider/context;
- state or derived condition that enables it;
- every success/error/cancel path that clears it;
- every awaited dependency;
- empty versus loading ambiguity.

### 2. Map startup/runtime milestones

Use relevant milestones such as:

```text
APP_START
BRIDGE_READY
HOME_SETTINGS_READY
IDENTITY_READY
STRUCTURE_DISCOVERY_START
FIRST_STRUCTURE_AVAILABLE
LOADING_STATE_FALSE
FIRST_USEFUL_RENDER
BACKGROUND_DISCOVERY_COMPLETE
```

State which work is sequential, parallel, blocking, background, retried,
duplicated, cancelled, or dependent on Home events/identity/routes.

### 3. Instrument safely

Record where applicable:

- monotonic elapsed time and duration;
- event/request ID;
- caller and trigger;
- endpoint or bridge action;
- public service/name/identifier;
- offset, limit, pages, and result count;
- retry number;
- success, partial, empty, timeout, cancellation, or error.

Diagnostics MUST NOT include private keys, wallet secrets, signatures,
credentials, private content, unrestricted payloads, or authentication
material.

### 4. Provide no-console access

When Home developer tools are unavailable, use an opt-in mechanism such as:

```text
?debugStartup=1
```

It MUST be disabled by default, bounded in memory, route-safe, redacted,
copyable/downloadable, and never published to QDN.

### 5. Audit duplication and stale work

Check React StrictMode, unstable effect dependencies, provider remounts, Home
events, identity changes, route normalization, retries, multiple consumers,
and older promise completion. Group normalized duplicate requests and report
cumulative duration.

### 6. Audit loading-state correctness

Verify:

- all terminal paths clear loading;
- timeouts are bounded;
- partial validated data can render where safe;
- complete empty differs from unavailable;
- derived/background enrichment does not block authoritative first render;
- stale generations cannot overwrite newer state;
- retry always creates a new attempt;
- cancellation is explicit or late results are ignored.

### 7. Measure environments separately

Do not merge Vite, Core API, embedded Home, and deployed-QDN timings into one
claim. Use a common navigation/start origin for before/after user metrics.

### 8. State root cause before behavior change

Name the exact blocking operation, incorrect state rule, duplicates, and
before timing. Then implement the smallest evidence-backed fix.

### 9. Verify before and after

Run repeated cold, warm, refresh, direct-route, partial, empty, error, timeout,
cancel, stale, identity-change, Home-event, and background-error scenarios.

## Mandatory rules

> A derived index, cache, directory, or enrichment task must not block
> authoritative data from producing the first useful render unless the derived
> resource is genuinely required for correctness.

- Shell display SHOULD be under one second where normal conditions permit.
- First useful data SHOULD target roughly 3–5 seconds where normal node
  conditions permit.
- MUST NOT hide a loading indicator while no honest usable/error state exists.
- MUST NOT weaken authority or restricted-access rules for speed.
- Before/after evidence MUST identify the environment measured.

## Validation

- Focused automated lifecycle and diagnostic tests.
- Duplicate and stale-generation tests.
- Local debug-gate and route tests.
- Read-only Core/API timings.
- Embedded Home and live QDN measurements when required.

## Completion criteria

- Root cause is demonstrated by call graph and timing.
- No indefinite loading path remains.
- The narrow fix passes lifecycle/security tests.
- Before/after results are measured in required environments.
- Owner live validation remains explicit when not performed.

## Related files

- [`qortium-home-and-bridge.md`](qortium-home-and-bridge.md)
- [`qdn-publication-discovery-and-scaling.md`](qdn-publication-discovery-and-scaling.md)
- [`live-qdn-validation.md`](live-qdn-validation.md)
