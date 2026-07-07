Project Sync, Backup, and Restore Workflow

Purpose

This file is a reusable agent instruction for setting up a new project
with:

- full local Git initialization
- GitHub sync against an existing empty or near-empty repository
- a minimal backup workflow
- a restore workflow
- npm scripts for backup and restore
- a local usage guide stored inside the project

Communication Preference

- Communicate with the user in Estonian.
- Write project files, documentation for the repository, code comments,
  commit messages, and reusable agent instructions in English unless the
  user explicitly asks for Estonian content.
- If the user gives requirements in Estonian, translate them into
  precise English before writing project-facing files.

Primary Goal

When the user asks for GitHub sync plus backup/restore setup for a new
project, the agent should complete the whole workflow with minimal
follow-up:

1. inspect the project
2. initialize git if needed
3. connect the correct GitHub remote
4. add practical ignore rules
5. create backup and restore scripts
6. expose them through npm scripts
7. add a usage guide
8. test the scripts when possible
9. complete the initial commit and sync

What the User Typically Wants

- A fully synced GitHub repository for the current workspace.
- A small but restorable backup, not a full clone of all generated files.
- Backup output stored outside the project in a fixed folder under the
  user home directory.
- Timestamped backup archives.
- Automatic retention of only the latest 3 backups.
- A restore script that can rebuild the project from backup into a clean
  directory.
- An Estonian usage guide for backup and restore placed in the `scripts`
  directory.

Standard Backup Location Pattern

Use this destination pattern unless the user asks for a different one:

`~/VS-Code-Projects/_workspace_backups/<Project-Display-Name>`

Example:

`~/VS-Code-Projects/_workspace_backups/Video-Bridge`

Recommended File Names

Create these files when implementing the workflow:

- `scripts/backup-workspace.sh`
- `scripts/restore-workspace.sh`
- `scripts/KASUTUSJUHEND.md`

Recommended npm Scripts

Add these to `package.json`:

- `"backup": "bash scripts/backup-workspace.sh"`
- `"restore": "bash scripts/restore-workspace.sh"`

Backup Strategy

The backup should be minimal but fully practical for rebuilding the
project later.

Include:

- source code
- configuration files
- package manifests such as `package.json` and lockfiles
- environment files that are needed for a practical restore, if the user
  expects the restored project to work immediately

Exclude:

- `.git`
- `node_modules`
- build output such as `dist`, `dist-ssr`
- caches such as `.vite`
- coverage directories
- logs
- other generated artifacts not required to reconstruct the project

Git Ignore Baseline

At minimum, consider ignoring:

- `node_modules`
- `dist`
- `dist-ssr`
- `.vite`
- `.env`
- `.env.production`
- `server/.env`
- local tool files such as `.codex` when relevant

Be careful not to ignore example env files such as:

- `.env.example`
- `.env.production.example`
- `server/.env.example`

Backup Script Requirements

The backup script should:

1. resolve the project root dynamically
2. resolve the backup directory under the user home folder
3. generate a full timestamp such as `YYYY-MM-DD_HH-MM-SS`
4. create a compressed archive such as `.tar.gz`
5. exclude generated and unnecessary files
6. keep only the latest 3 matching backups
7. print the created archive path

Restore Script Requirements

The restore script should:

1. locate the latest backup automatically
2. restore into the current project directory by default
3. optionally accept a target directory argument
4. refuse to overwrite a non-empty directory, except allowing a `.git`
   directory to exist
5. extract the backup contents into the target directory
6. tell the user to run `npm install` afterward

Usage Guide Requirements

Write the usage guide in Estonian and place it in:

`scripts/KASUTUSJUHEND.md`

It should explain:

- `npm run backup`
- `npm run restore`
- what is included in the backup
- what is excluded
- where backups are stored
- timestamp behavior
- retention of the latest 3 backups
- how to restore into a clean directory
- the need to run `npm install` after restore

GitHub Sync Workflow

When the project is not yet a git repository:

1. run `git init -b main`
2. add the GitHub remote:
   `git remote add origin <repo-url>`
3. stage files
4. create the initial commit

When the remote repository is empty, a direct push is usually enough.

When the remote repository contains an initial file already, such as a
README created manually or by the agent, the local and remote histories
may be unrelated. In that case:

1. run `git fetch origin`
2. merge the remote history into local main with:
   `git merge origin/main --allow-unrelated-histories`
3. resolve conflicts if any
4. push again with:
   `git push -u origin main`

Important Git Rule

If push fails with:

`Updates were rejected because the remote contains work that you do not have locally`

the likely fix is not a force push. The safer default is:

1. `git fetch origin`
2. `git merge origin/main --allow-unrelated-histories`
3. `git push -u origin main`

Authentication Notes

If `git push` fails because of missing authentication:

- check whether HTTPS credentials are configured
- check whether SSH keys are configured
- do not assume GitHub CLI is installed
- explain clearly whether the failure is due to HTTPS auth or SSH auth

Expected Verification

Before closing the task, verify at least:

- backup and restore scripts pass `bash -n`
- npm scripts exist in `package.json`
- backup archive creation works if permissions allow writing to the
  destination directory
- `git remote -v` shows the expected repository
- `git status --short --branch` is clean or clearly explained

Preferred Final Output to the User

The final response should be concise and should state:

- what was created or changed
- where the backup is stored
- whether backup creation was tested
- whether GitHub sync is fully complete
- any remaining manual step, especially authentication if push could not
  be completed automatically

Agent Behavior

- Do not stop at a plan if the workspace allows implementation.
- Prefer actually creating the scripts and wiring npm commands.
- Prefer fixing git history problems directly instead of only describing
  them.
- Keep the user-facing response in Estonian.
- Keep repository-facing text in English unless asked otherwise.
