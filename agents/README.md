# Qortium Development Knowledge Base

## Purpose

This directory is the operational knowledge base for AI-assisted Qortium
development. It supports new applications, existing-application audits,
issue-driven implementation, runtime diagnosis, QDN design, Home integration,
live validation, and releases.

## Use when

Start every substantial repository task with
[`00-SESSION-START.md`](00-SESSION-START.md). Use this README when reviewing the
guide architecture or the issue #16 migration.

## Do not use when

This README is not a task router and does not define a platform API. Do not load
every guide by default. Do not use removed Qortal material as current Qortium
guidance.

## Prerequisites

- Exact repository and local path.
- Current branch and working-tree state.

## Required inputs

- Owner request or GitHub issue.
- Current checked-out Qortium Home/Core sources when platform behavior matters.
- The matching project file, if one exists.

## Original file inventory and migration

| Original file                         | Original purpose                                        | Relevance and problems                                                                                                                                    | Scope           | Action and destination                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                           | Index for a reusable Qortal qApp kit                    | Routed new work through Qortal bootstrapping and missing files; duplicated the master workflow                                                            | Global          | **Rewrite** as this Qortium-native catalog and migration record                                                                                       |
| `master-workflow.md`                  | Orchestrate new Qortal projects                         | Assumed `create-qortal-app`, `GlobalProvider`, Qortal URLs, mandatory GitHub sync, and Estonian communication; did not support audits or focused issues   | Global          | **Merge/rewrite** into `00-SESSION-START.md`, `01-TASK-CLASSIFICATION.md`, and the focused guides; remove                                             |
| `project-sync-backup-workflow.md`     | GitHub initialization plus a specific backup convention | Useful Git safety fragments mixed with owner-specific paths, retention, language, and automatic commit/push behavior                                      | Mixed           | **Split** reusable Git/generated-file rules into `git-generated-files-and-hygiene.md`; retain project commands only in the project file; remove       |
| `project-vision-template.md`          | Product template for new Qortal qApps                   | Product questions remain useful, but Qortal identity and old reading order are obsolete                                                                   | Global          | **Merge/rewrite** product discovery into `qortium-native-app-workflow.md`; remove                                                                     |
| `qapp-framework-essentials.md`        | Bootstrap with `create-qortal-app` and qapp-core        | Qortal-only runtime, framework, routing, and bridge assumptions conflict with the approved Qortium-native strategy                                        | Global obsolete | **Remove**; replacement is `qortium-native-app-workflow.md`                                                                                           |
| `qortal-runtime-performance-rules.md` | Qortal/QDN readiness and UX advice                      | Some general readiness and fallback lessons remain useful; authority sources and runtime assumptions are stale                                            | Global mixed    | **Split/rewrite** into `runtime-diagnostics-and-performance.md`, `qdn-publication-discovery-and-scaling.md`, and `qortium-home-and-bridge.md`; remove |
| `qortal-to-qortium-porting-guide.md`  | Convert Discussion Boards from Qortal to Qortium        | Overfit to one project; recommended porting, blanket base64, version reset, and frozen bridge behavior; embedded project secrets/facts in global guidance | Mixed obsolete  | **Split** verified reusable lessons into current guides, isolate project facts in `projects/Discssion-Boards.md`, and **remove** porting workflow     |

No original file is archived. Historical Qortal instructions have no active
operational value and would remain discoverable by agents if retained here.
Git history is the historical record.

## Final guide tree

```text
agents/
├── README.md
├── 00-SESSION-START.md
├── 01-TASK-CLASSIFICATION.md
├── qortium-native-app-workflow.md
├── qortium-architecture-and-data-integrity.md
├── qortium-home-and-bridge.md
├── qdn-publication-discovery-and-scaling.md
├── issue-driven-audit-and-refactor.md
├── runtime-diagnostics-and-performance.md
├── live-qdn-validation.md
├── qavs-versioning-and-release.md
├── git-generated-files-and-hygiene.md
├── final-report-and-owner-handoff.md
└── projects/
    └── Discssion-Boards.md
```

## Dependency map

```text
00-SESSION-START
  -> 01-TASK-CLASSIFICATION
  -> matching project file
  -> one or more task guides

qortium-native-app-workflow
  -> qortium-architecture-and-data-integrity
  -> qortium-home-and-bridge
  -> qdn-publication-discovery-and-scaling

issue-driven-audit-and-refactor
  -> architecture guide and/or runtime guide

runtime-diagnostics-and-performance
  -> live-qdn-validation

qavs-versioning-and-release
  -> live-qdn-validation
  -> git-generated-files-and-hygiene

every substantial task
  -> final-report-and-owner-handoff
```

## Mandatory rules

- Qortium Home and Core behavior MUST be verified from their current checked-out
  sources before implementation depends on it.
- Project-specific facts MUST stay under `projects/`.
- One task SHOULD normally implement one issue.
- Agents MUST NOT commit, push, tag, release, or publish without explicit owner
  authorization.
- Obsolete Qortal-to-Qortium porting MUST NOT be used as the default new-app
  workflow.

## Workflow

1. Enter through `00-SESSION-START.md`.
2. Classify the task.
3. Read the matching project file and only the routed domain guides.
4. Verify current authoritative sources.
5. Validate and report through the handoff guide.

## Validation

- Validate all relative Markdown links.
- Search this directory for obsolete active Qortal assumptions.
- Run repository formatting, lint, and `git diff --check`.
- Confirm generated output is not tracked.

## Completion criteria

This knowledge base is usable when an agent can begin either a brand-new
Qortium-native application or an audit of another existing application without
Discussion Boards context or Qortal bootstrap assumptions.

## Related files

- [`00-SESSION-START.md`](00-SESSION-START.md)
- [`01-TASK-CLASSIFICATION.md`](01-TASK-CLASSIFICATION.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
