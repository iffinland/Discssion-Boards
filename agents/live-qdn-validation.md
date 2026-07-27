# Live QDN Validation

## Purpose

Define distinct validation levels so static checks, local preview, Core
measurements, embedded Home, and deployed live QDN are never treated as
interchangeable evidence.

## Use when

Use to plan validation for any runtime, bridge, publication, identity, release,
or owner-visible issue.

## Do not use when

Do not perform writes, publication, moderation, or transactions unless the
owner explicitly authorized the exact live action.

## Prerequisites

- Exact build/commit and intended QDN resource.
- Test identities and safety boundaries.
- Owner-approved live-write scope where needed.
- Diagnostic and rollback/recovery plan.

## Required inputs

- Acceptance criteria mapped to validation levels.
- Cold/warm/refresh/direct-route matrix.
- Read-only versus write operations.
- Expected service/name/identifier and version.

## Validation levels

### Level 1 — static and automated

Typical commands:

```bash
npm ci
npm run verify
npm run build
git diff --check
```

Use scripts actually present. This validates types/tests/build, not live
runtime.

### Level 2 — local runtime

Validate Vite preview, routes, bridge-unavailable behavior, diagnostic gates,
mocked services, error states, and local UI interaction.

### Level 3 — Core/API

Use read-only Core endpoints to validate QDN search/fetch/readiness, response
timings, pagination, resource availability, and exact identifiers. Record node,
cutoff, page counts, and environment without exposing credentials.

### Level 4 — embedded Qortium Home

Validate actual bridge injection, selected identity/name, display settings,
approval/signing prompts, embedded base routing, share links, clipboard,
loading behavior, and Home-specific limitations.

### Level 5 — deployed live QDN

Validate the exact deployed resource:

- cold and warm start;
- refresh and direct route/share;
- create/read/update;
- authorized and unauthorized paths;
- moderation, roles, polls, reactions, tips where relevant;
- attachments and large-file flow;
- owner-visible success criteria.

## Workflow

1. Map each acceptance criterion to one or more levels.
2. Establish the exact source commit/build/artifact.
3. Run lower levels before live writes.
4. Use read-only checks by default.
5. Obtain explicit authority for publication/transactions.
6. Record every run separately with environment and outcome.
7. Distinguish inference from direct observation.
8. Preserve owner-exported reports as evidence when Home is not automatable.

## Mandatory rules

- Automated tests do not substitute for embedded Home.
- Vite preview does not substitute for live QDN.
- Core/API timing does not prove embedded first render.
- A release artifact does not prove deployment.
- MUST NOT claim live validation that was not performed.
- An issue requiring live validation MUST remain open until the owner performs
  and confirms the required live check.

## Validation

Review the evidence table for missing levels, mismatched versions, unsafe
actions, or ambiguous outcomes. Confirm the deployed resource is traceable to
the tested source/artifact.

## Completion criteria

- Required levels passed against the intended build.
- Results identify environment and exact run.
- Live writes stayed inside explicit authority.
- Remaining owner validation is named and controls issue closure.

## Related files

- [`runtime-diagnostics-and-performance.md`](runtime-diagnostics-and-performance.md)
- [`qortium-home-and-bridge.md`](qortium-home-and-bridge.md)
- [`qavs-versioning-and-release.md`](qavs-versioning-and-release.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
