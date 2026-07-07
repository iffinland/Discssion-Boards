# Backup and Restore Guide

This guide explains how to use the workspace backup and restore scripts.

## Location

- Backups are stored in `~/VS-Code-Projects/REACT-PROJECTS/_workspace_backups/Discussion_Boards`
- Backup filenames follow `discussion-boards-workspace-YYYY-MM-DD_HH-MM-SS.tar.gz`

## Create a backup

Run from the project root:

```bash
npm run backup:workspace
```

This command:

- creates a `.tar.gz` backup of the workspace
- adds a timestamp to the filename
- keeps the 3 newest backups
- removes older backups automatically

## Restore from a backup

Run from the project root:

```bash
npm run restore:workspace
```

Restore flow:

- the script shows a numbered list of available backups
- you choose the backup by number
- you confirm the action by typing `RESTORE`

## Important warning

Restore replaces workspace files with the selected backup contents.

- the script keeps the `.git` directory
- all other workspace files are replaced by the selected backup

## Run the scripts directly

If needed, you can also run:

```bash
bash scripts/backup-workspace.sh
bash scripts/restore-workspace.sh
```
