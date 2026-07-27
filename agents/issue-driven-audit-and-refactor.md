# Issue-Driven Audit and Refactor

## Purpose

Define a reusable workflow for auditing an existing Qortium application and
turning findings into narrow, ordered, measurable implementation issues.

## Use when

Use for `ARCHITECTURE_AUDIT`, `SECURITY_DATA_INTEGRITY`,
`ISSUE_IMPLEMENTATION`, `TARGETED_BUGFIX`, or a multi-phase refactor.

## Do not use when

Do not use a broad audit as authorization to fix every finding. Do not combine
independent architecture, runtime, visual, dependency, and release work merely
for convenience.

## Prerequisites

- Exact repository, branch, commit, and working tree.
- Parent review issue or owner-defined audit scope.
- Access to current source, documentation, and applicable live deployment.

## Required inputs

- Product success criteria.
- Published QDN identity and known live resource.
- Current Home/Core revisions.
- Build/toolchain state.
- Compatibility and migration constraints.

## Workflow

### 1. Establish the baseline

Compare where available:

- repository source and current commit;
- local dependency install, tests, and build;
- package/dependency baseline;
- current docs and architecture;
- published artifact and live QDN behavior;
- current Home/Core source revisions.

MUST NOT assume repository source equals deployed code. Record unavailable
evidence.

### 2. Trace actual paths

For relevant features inspect:

- entity and operation model;
- reads/discovery/reduction;
- writes/publication;
- identity/authorization;
- UI commands;
- runtime state transitions;
- cache/index behavior;
- release metadata.

### 3. Separate findings

Classify at minimum:

- architecture;
- authorization/security;
- QDN data integrity;
- runtime/performance;
- UI/UX;
- Home integration;
- scaling;
- dependencies/tooling;
- release metadata;
- documentation.

### 4. Create a parent audit issue

The parent issue SHOULD summarize evidence, risks, dependency graph, and
priorities. It MUST distinguish verified defect, inference, unknown, and owner
decision.

### 5. Create narrow implementation issues

Each issue requires:

- one main problem;
- scope and out-of-scope sections;
- dependencies/prerequisites;
- measurable acceptance criteria;
- exact validation levels;
- owner/live validation requirement;
- completion and closure rule.

### 6. Order work

Default priority:

1. data corruption or authorization risk;
2. architectural prerequisites;
3. compatibility/migration;
4. critical owner-visible runtime blockers;
5. scaling;
6. Home integration;
7. dependencies/release hygiene;
8. optional visual polish.

An owner-reported user-visible blocker MUST be tracked explicitly; architecture
work does not prove it solved runtime behavior.

### 7. Implement one issue

Read parent, target, and prerequisite issues. Re-establish the baseline. Change
only the coherent in-scope slice. If a newly found blocker is safely fixable
within the same issue, fix and retest it; otherwise record a new issue rather
than silently expanding.

### 8. Close by evidence

Review every acceptance criterion against actual implementation. Keep feature
gates explicit. An issue requiring owner/live validation remains open until
confirmed.

## Mandatory rules

- One AI task SHOULD normally implement one issue.
- MUST NOT begin a later issue automatically.
- Major architecture changes require an approved design boundary.
- Compatibility MUST be preserved only when explicitly required and safe.
- Performance fixes require measured evidence before and after.
- Commit/push/issue mutation requires explicit owner authorization.

## Validation

- Run the exact issue-required tests plus project baseline checks.
- Review complete diff and working tree.
- Map each acceptance criterion to evidence.
- Record tests missing because the environment cannot supply them.

## Completion criteria

- Baseline and finding tracks are explicit.
- Issue scope is narrow and dependencies are ordered.
- Every acceptance criterion is satisfied or truthfully blocking.
- Required owner/live validation determines closure readiness.

## Related files

- [`01-TASK-CLASSIFICATION.md`](01-TASK-CLASSIFICATION.md)
- [`qortium-architecture-and-data-integrity.md`](qortium-architecture-and-data-integrity.md)
- [`runtime-diagnostics-and-performance.md`](runtime-diagnostics-and-performance.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
