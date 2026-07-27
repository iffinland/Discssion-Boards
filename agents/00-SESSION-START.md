# Qortium Development Session Start

## Purpose

This is the mandatory router for every AI development session. It establishes
scope, authority, baseline, required guides, validation, and stop conditions
before implementation.

## Use when

Use first for every repository task, including new applications, audits,
bugfixes, runtime work, documentation, maintenance, and releases.

## Do not use when

Do not treat this file as a substitute for the selected task guide, project
source, issue, or current Home/Core source. Do not load all guides merely
because they exist.

## Prerequisites

- Access to the target repository and its Git history.
- The owner request and, when applicable, the exact GitHub issue.
- Access to any project file under `projects/`.

## Required inputs

Determine and record:

1. exact repository and remote;
2. exact local path;
3. exact branch;
4. current commit;
5. working-tree state, including staged, unstaged, untracked, and generated
   files;
6. task class;
7. owner request or issue number;
8. matching project file;
9. required global guides;
10. authoritative Home/Core repositories required;
11. validation level required.

## Mandatory baseline

Before editing, run:

```bash
git status --short --branch
git log -1 --oneline
```

Then run project-specific baseline commands when relevant. A JavaScript project
with a lockfile will commonly require:

```bash
npm ci
npm run
```

MUST NOT discard owner changes. If unexpected changes overlap the task, stop
and report the conflict. Generated or owner-created files MUST NOT be deleted
merely to obtain a clean status.

## Task classification

Select one primary class and any necessary secondary classes:

- `NEW_QORTIUM_APP`
- `PRODUCT_DISCOVERY`
- `ARCHITECTURE_AUDIT`
- `SECURITY_DATA_INTEGRITY`
- `ISSUE_IMPLEMENTATION`
- `TARGETED_BUGFIX`
- `RUNTIME_PERFORMANCE`
- `UI_VISUAL`
- `QDN_PUBLICATION`
- `HOME_BRIDGE_INTEGRATION`
- `LIVE_VALIDATION`
- `RELEASE_PREPARATION`
- `MAINTENANCE`
- `DOCUMENTATION`

Read [`01-TASK-CLASSIFICATION.md`](01-TASK-CLASSIFICATION.md) when the class is
not obvious or the request mixes tracks.

## Routing table

| Task class                | Required guide(s)                                                                                                 | Add when relevant                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NEW_QORTIUM_APP`         | [native-app workflow](qortium-native-app-workflow.md), [architecture](qortium-architecture-and-data-integrity.md) | Home/bridge, QDN, live validation                                                          |
| `PRODUCT_DISCOVERY`       | [classification](01-TASK-CLASSIFICATION.md), [native-app workflow](qortium-native-app-workflow.md)                | Project file                                                                               |
| `ARCHITECTURE_AUDIT`      | [audit/refactor](issue-driven-audit-and-refactor.md), [architecture](qortium-architecture-and-data-integrity.md)  | QDN, Home/bridge                                                                           |
| `SECURITY_DATA_INTEGRITY` | [architecture](qortium-architecture-and-data-integrity.md)                                                        | QDN, audit/refactor                                                                        |
| `ISSUE_IMPLEMENTATION`    | [audit/refactor](issue-driven-audit-and-refactor.md)                                                              | Domain guide named by issue                                                                |
| `TARGETED_BUGFIX`         | [audit/refactor](issue-driven-audit-and-refactor.md)                                                              | [Runtime guide](runtime-diagnostics-and-performance.md) for user-visible timing/state bugs |
| `RUNTIME_PERFORMANCE`     | [runtime guide](runtime-diagnostics-and-performance.md)                                                           | Live validation                                                                            |
| `UI_VISUAL`               | [classification](01-TASK-CLASSIFICATION.md) and project UI conventions                                            | Live validation for interactions                                                           |
| `QDN_PUBLICATION`         | [QDN guide](qdn-publication-discovery-and-scaling.md)                                                             | Home/bridge, live validation                                                               |
| `HOME_BRIDGE_INTEGRATION` | [Home/bridge guide](qortium-home-and-bridge.md)                                                                   | QDN, live validation                                                                       |
| `LIVE_VALIDATION`         | [live-validation guide](live-qdn-validation.md)                                                                   | Project file                                                                               |
| `RELEASE_PREPARATION`     | [QAVS/release](qavs-versioning-and-release.md), [Git hygiene](git-generated-files-and-hygiene.md)                 | Live validation                                                                            |
| `MAINTENANCE`             | [Git hygiene](git-generated-files-and-hygiene.md)                                                                 | QAVS/release for version/dependency work                                                   |
| `DOCUMENTATION`           | Relevant domain guide only                                                                                        | [Final handoff](final-report-and-owner-handoff.md)                                         |

Every substantial task also reads
[`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md) before
reporting.

## Authoritative source order

For current Qortium behavior, use:

1. current checked-out Qortium Home source;
2. current checked-out Qortium Core source;
3. current application source and verified runtime behavior;
4. issue findings and measured evidence;
5. documented owner decisions.

Reference commit hashes SHOULD be recorded for traceability. They MUST NOT be
treated as permanently frozen capability targets. Re-verify implementation
details before each platform-dependent phase.

MUST NOT invent bridge actions, Core endpoints, QAVS fields, publication
payloads, version semantics, identity behavior, or Home runtime contracts.

## Workflow

1. Establish the baseline and preserve existing changes.
2. Classify the task.
3. Read only the matching project file and routed guides.
4. Read the exact issue, prerequisites, relevant source, and current
   authoritative platform sources.
5. Separate verified fact, inference, and unknown.
6. Define scope, out-of-scope work, acceptance criteria, risks, and validation.
7. For a major architecture change, present the plan and obtain approval before
   production implementation.
8. Implement the smallest coherent change.
9. Validate at the required levels.
10. Review the full diff and final working tree.
11. Report with a truthful completion status.

## Mandatory rules

- One task SHOULD normally implement one issue.
- MUST NOT silently begin another issue.
- MUST NOT commit, push, tag, release, deploy, publish, or sign unless the owner
  explicitly requests it.
- MUST NOT close an issue before all completion requirements and mandatory owner
  validation are satisfied.
- MUST NOT treat architecture tests as proof of runtime UX.
- MUST NOT treat local preview as embedded Home or live QDN validation.
- MUST NOT recommend copying and progressively converting an old Qortal
  codebase for a new Qortium application. Extract requirements, design
  Qortium-native architecture, build cleanly, and migrate only validated needs.

## Validation

Select the required levels from
[`live-qdn-validation.md`](live-qdn-validation.md). Always include:

```bash
git status --short
git diff --check
```

Use only scripts actually defined by the project.

## Completion criteria

- Scope and task class are explicit.
- Necessary sources and guides were read; irrelevant guides were not.
- Baseline and validation are recorded.
- Unknown platform behavior is either verified or clearly blocking.
- Final status matches the evidence and remaining owner work.

## Related files

- [`01-TASK-CLASSIFICATION.md`](01-TASK-CLASSIFICATION.md)
- [`README.md`](README.md)
- [`live-qdn-validation.md`](live-qdn-validation.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
