Master Workflow for New Qortal qApp Projects

Purpose

This file is the top-level orchestration guide for AI agents working on
new Qortal qApp projects for this user. It defines the reading order,
behavior, and expected execution flow.

User Preferences

- Communicate with the user in Estonian.
- Write project files, code comments, commit messages, and reusable
  documentation in English unless the user explicitly requests
  otherwise.
- Do not make broad product assumptions without checking the project
  vision file first.

Read Order

For a new project, read files in this exact order:

1. a project-specific vision file, for example:
   `agents/my-new-app-vision.md`
2. `agents/qapp-framework-essentials.md`
3. `agents/qortal-runtime-performance-rules.md`
4. `agents/project-sync-backup-workflow.md`

Why This Order Matters

- The vision file explains what to build.
- The qApp framework guide explains how to bootstrap a valid Qortal app.
- The runtime and performance guide explains how Qortal constraints
  affect architecture and UX.
- The sync and backup workflow explains how to finish the repository
  setup properly.

Execution Workflow

The agent should generally work in this order:

1. read and summarize the project vision internally
2. bootstrap the app with the Qortal workflow
3. verify `AppWrapper.tsx`, `publicSalt`, and `appName`
4. verify `vite.config.*` and set `base: './'` when needed
5. apply Qortal runtime and QDN loading rules
6. implement the first usable product version
7. set up git, GitHub sync, backup, restore, and local usage docs
8. verify the workflow end to end

Mandatory Checks for New Qortal Projects

Before considering the setup correct, the agent should verify:

- the project was created using the intended Qortal starter flow
- the template selection was correct
- `GlobalProvider` is configured correctly
- the app name is intentionally chosen
- `base: './'` is set when required for Qortal hosting
- assets do not depend on root-based absolute paths
- QDN resource flows account for non-instant readiness
- mobile behavior has not been ignored
- GitHub sync is complete or any authentication blocker is clearly
  stated
- backup and restore scripts exist when requested

Qortal-Specific Design Rules

- Prefer Qortal-native logic over generic web2 assumptions.
- Design for slow or progressive QDN readiness.
- Avoid brittle UI flows that assume data appears instantly.
- Add explicit fallback states instead of silent failure.
- Prefer stable service abstractions for Qortal and QDN interactions.

When to Consult Official Sources

The agent should consult official Qortal sources when:

- a Qortal API action is uncertain
- QDN resource status or publish behavior matters
- starter workflow details may have changed
- there is any doubt about qapp-core or supported APIs

Preferred official sources:

- `https://qortal.dev/docs/extension`
- `https://qortal.dev/devs`
- `https://api.qortal.org/api-documentation/`
- `https://github.com/Qortal/qapp-core`

Suggested Prompt for the User

The user can start a new project session with a prompt like:

`Read agents/my-new-app-vision.md first. Then follow agents/master-workflow.md. Communicate with me in Estonian, but write project files in English.`

Maintenance Rule

When recurring new lessons appear, add them to the appropriate file:

- vision concerns go into the project vision file
- bootstrap concerns go into `qapp-framework-essentials.md`
- Qortal runtime/performance concerns go into
  `qortal-runtime-performance-rules.md`
- repository and backup concerns go into
  `project-sync-backup-workflow.md`

This keeps the system modular and avoids turning one file into an
unusable wall of text.
