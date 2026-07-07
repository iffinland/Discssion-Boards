Agents Workflow Kit

Purpose

This folder contains a reusable workflow kit for starting and managing
new Qortal qApp projects with an AI agent.

The goal is to avoid rewriting the same instructions in every new
session. Instead of explaining the full process again, the user can
point the agent to the files in this folder.

Recommended File Order

For a brand new project, the agent should read files in this order:

1. a project-specific vision file such as
   `agents/my-real-app-vision.md`
2. `agents/master-workflow.md`

The master workflow then points the agent to the supporting files in the
correct order.

Files in This Folder

- `README.md`
  Short index for this folder and how to use it.

- `master-workflow.md`
  Top-level orchestration file. This is the main entrypoint for the
  agent after the project vision file.

- `project-vision-template.md`
  Template for writing a new project vision.

- `session-start-prompt.md`
  Copy-paste prompt for starting a new AI session.

- `qapp-framework-essentials.md`
  Compact guide for bootstrapping a new Qortal qApp with
  `create-qortal-app`.

- `qortal-runtime-performance-rules.md`
  Qortal-specific runtime, QDN readiness, routing, and performance
  rules.

- `qortal-to-qortium-porting-guide.md`
  Practical guide for converting an existing Qortal qApp into a
  Qortium-only app, including bridge changes, QDN publish rules,
  account detection, media uploads, cleanup rules, and current
  Qortium share-link limitations.

- `project-sync-backup-workflow.md`
  GitHub sync, backup, restore, and usage-guide workflow.

- `qapp-framework.md`
  Longer legacy reference file. Keep as source material, but prefer the
  essentials file for actual agent workflow.

Minimum Practical Setup for a New Project

Usually the user only needs to do these things:

1. copy this whole `agents` folder into the new project
2. create a new vision file based on `project-vision-template.md`
3. start a new AI session using `session-start-prompt.md`

Suggested Naming Convention

For project-specific vision files, use a clear name such as:

- `agents/my-real-app-vision.md`
- `agents/qtube-mobile-vision.md`
- `agents/qmusic-rebuild-vision.md`

Maintenance Advice

When a new recurring lesson appears, do not dump everything into one
giant file.

Instead:

- add product goals to the project vision file
- add bootstrap rules to `qapp-framework-essentials.md`
- add Qortal and QDN behavior rules to
  `qortal-runtime-performance-rules.md`
- add Qortal-to-Qortium migration lessons to
  `qortal-to-qortium-porting-guide.md`
- add repository, GitHub, backup, and restore rules to
  `project-sync-backup-workflow.md`
- update `master-workflow.md` only when the reading order or top-level
  process changes

Why This Structure Works

- the project vision changes every project
- the Qortal bootstrap process is mostly stable
- runtime and QDN behavior rules are reusable
- GitHub sync and backup logic are reusable
- the agent gets a cleaner context than from one oversized instruction
  file

Recommended Starter Prompt

```text
Read agents/my-real-app-vision.md first.
Then follow agents/master-workflow.md.
Communicate with me in Estonian, but write project files in English.
```

Optional Improvement

If a project develops its own recurring patterns, create one more file
for that project only, for example:

- `agents/project-specific-rules.md`

This is useful when one app has special publish logic, naming rules,
identifier conventions, or UI constraints that should not affect all
future projects.
