# Qortium Home and Bridge Integration

## Purpose

Guide safe integration with the current Qortium Home runtime and injected
bridge without freezing today's implementation as a permanent contract.

## Use when

Use for bridge detection, identity, publishing, approval/signing, display
settings, embedded routing, sharing, clipboard behavior, or Home-specific
runtime failures.

## Do not use when

Do not infer a bridge action from Core capability. Do not treat browser preview
as Home validation. Do not place direct bridge calls in UI components.

## Prerequisites

- Current checked-out Qortium Home source and commit.
- Current Core source for the underlying operation.
- Current application bridge wrapper and runtime environment.

## Required inputs

- Desired read/write operation.
- Exact identity/publishing-name need.
- Expected approval/signing boundary.
- Required timeout, retry, and recovery semantics.
- Routing/share/display requirements.

## Workflow

### 1. Verify the contract

Search current Home source for the action dispatcher, accepted fields,
validation, approval UI, signing, Core request, and returned shape. Then verify
the underlying Core behavior. Record the checked commits.

Core capability does not imply Home bridge capability.

### 2. Centralize a typed wrapper

Use one service boundary that:

- detects callable bridge locations safely;
- accepts typed action payloads;
- validates error/empty response forms;
- applies action-appropriate timeout and retry policy;
- emits safe diagnostics;
- distinguishes reads from writes.

UI components SHOULD call domain services, not the injected bridge.

### 3. Handle bridge availability

Support explicit unavailable, malformed, inaccessible, waiting, ready, timeout,
and error states. Direct references to undeclared globals MUST NOT crash app
startup. Late or stale responses MUST be ignored with cancellation or
generation tokens.

### 4. Handle account and names

Verify selected-account behavior, registered names, multiple-name selection,
wallet/address binding, and the active publishing name. A wallet address alone
MAY be insufficient for QDN publication. Current name ownership MUST NOT prove
historical ownership.

### 5. Protect writes

Write actions MUST preserve Home approval/signing boundaries. Never retry an
ambiguous write automatically when that could duplicate a transaction or
publication. Persist safe recovery data where a user-approved submission may
have succeeded but confirmation is incomplete.

### 6. Integrate display settings

Verify current fields/events for language, theme, accent, text size, and style.
Display-setting failure SHOULD fall back without blocking authoritative public
data. A slower initial response MUST NOT overwrite a newer live Home event.

### 7. Integrate embedded routing and sharing

Verify the runtime base and supported app-link form from current Home source.
Preserve approved share query parameters during normalization and internal
redirects. Distinguish a user-facing app share from a raw QDN resource link.

### 8. Support clipboard limitations

Use the current supported clipboard path and a safe DOM selection fallback when
embedded permission behavior requires it. Provide visible success/failure
feedback for owner-facing diagnostic or share flows.

## Mandatory rules

- Bridge actions and fields MUST be re-verified before implementation.
- Read retries MUST be bounded.
- Ambiguous writes MUST NOT be blindly replayed.
- Diagnostics MUST NOT include credentials, secrets, signatures, or private
  content.
- Home integration MUST NOT block unrelated public data without a correctness
  requirement.

## Validation

- Mock typed bridge success, malformed, empty, rejection, timeout, and late
  response.
- Test no-bridge local runtime.
- Test multiple registered names and name selection.
- Test display event races and embedded route/query preservation.
- Validate approval/signing and clipboard behavior in embedded Home.

## Completion criteria

- The wrapper matches current verified Home behavior.
- UI contains no direct unmanaged bridge calls.
- Identity and write boundaries are explicit.
- Local/no-bridge and embedded-Home scenarios pass at required levels.

## Related files

- [`qdn-publication-discovery-and-scaling.md`](qdn-publication-discovery-and-scaling.md)
- [`runtime-diagnostics-and-performance.md`](runtime-diagnostics-and-performance.md)
- [`live-qdn-validation.md`](live-qdn-validation.md)
