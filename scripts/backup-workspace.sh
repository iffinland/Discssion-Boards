#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${HOME}/VS-Code-Projects/REACT-PROJECTS/_workspace_backups/Discussion_Boards"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="${BACKUP_DIR}/discussion-boards-workspace-${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

tar -czf "${BACKUP_FILE}" -C "${WORKSPACE_DIR}" .
echo "Backup created: ${BACKUP_FILE}"

mapfile -t backups < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'discussion-boards-workspace-*.tar.gz' | sort -r)

if ((${#backups[@]} > 3)); then
  for old_backup in "${backups[@]:3}"; do
    rm -f "${old_backup}"
    echo "Removed old backup: ${old_backup}"
  done
fi

echo "Kept ${#backups[@]} backup snapshot(s), max retained: 3."
