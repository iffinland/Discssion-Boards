# Git and Generated-File Hygiene

## Purpose

Protect owner work, keep generated output out of source history, and define safe
Git/GitHub boundaries for AI-assisted tasks.

## Use when

Use for every final diff review and for repository initialization, cleanup,
backup/restore, dependency output, artifact generation, or release preparation.

## Do not use when

Do not infer authorization to commit, push, force-update, delete owner
artifacts, or rewrite history.

## Prerequisites

- Exact repository, branch, remote, and owner request.
- Current `.gitignore` and formatter-ignore rules.
- Knowledge of project-generated and required tracked artifacts.

## Required inputs

- Baseline `git status --short --branch`.
- Intended changed-file list.
- Generated paths and release-artifact policy.
- Commit/push authorization, if any.

## Workflow

### 1. Establish and preserve baseline

Run:

```bash
git status --short --branch
git log -1 --oneline
```

Classify staged, unstaged, untracked, nested-repository, generated, and owner
files. MUST NOT overwrite unrelated changes.

### 2. Audit generated paths

Common generated paths include:

```text
.tmp-tests/
dist/
.release/
coverage/
node_modules/
.vite/
temporary build files
```

They MUST NOT be committed unless the project explicitly requires a specific
artifact. Verify `.gitignore` and `.prettierignore` where appropriate.

### 3. Check tracking, not only ignore rules

`.gitignore` does not untrack existing files. Check:

```bash
git ls-files <path>
```

When removal from tracking is intended, use the appropriate reviewed
`git rm --cached` workflow so local owner data can remain. Inspect the exact
deletions before commit.

### 4. Keep source and output separate

Edit source, tests, and configuration; rebuild output. Do not hand-edit build
output as authority. A release ZIP, checksum, local diagnostic report, or test
transpile MUST NOT be added merely because it exists.

### 5. Review the final diff

Run:

```bash
git status --short
git diff --check
git diff
git diff --cached
git ls-files .tmp-tests
```

Adapt paths to the project. Look for secrets, unintended deletions, generated
junk, formatting drift, submodule changes, and unrelated cleanup.

### 6. External Git/GitHub actions

Commit, push, branch creation/switching, pull requests, labels, issue closure,
tags, and releases require explicit owner intent. MUST NOT force push or rewrite
history without explicit authorization.

### 7. Backup/restore by request

Backup automation MAY be added when requested. Its destination, retention,
secret policy, overwrite protections, validation, and user documentation MUST
be project decisions, not hard-coded global preferences.

## Mandatory rules

- Generated files MUST NOT be committed by default.
- MUST NOT delete owner artifacts without an explicit task reason.
- MUST inspect deletions before any commit.
- MUST NOT commit/push/tag/release automatically.
- A working tree should be clean before issue closure, except clearly explained
  owner artifacts or intentionally uncommitted work awaiting review.

## Validation

- Ignore rules and `git ls-files` agree.
- No secret/environment files or generated output entered the intended diff.
- `git diff --check` passes.
- Final status matches the reported changed-file list.

## Completion criteria

- Owner work is preserved.
- Generated paths are ignored and untracked as intended.
- Diff contains only task scope.
- External Git/GitHub state matches explicit authority.

## Related files

- [`00-SESSION-START.md`](00-SESSION-START.md)
- [`qavs-versioning-and-release.md`](qavs-versioning-and-release.md)
- [`final-report-and-owner-handoff.md`](final-report-and-owner-handoff.md)
