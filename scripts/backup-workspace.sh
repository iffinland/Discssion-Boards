#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${HOME}/VS-Code-Projects/_workspace_backups/QORTIUM"
RETENTION_COUNT="${BACKUP_RETENTION:-3}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="${BACKUP_DIR}/discussion-boards-workspace-${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

if ! [[ "${RETENTION_COUNT}" =~ ^[0-9]+$ ]]; then
  echo "Invalid BACKUP_RETENTION value: ${RETENTION_COUNT}" >&2
  exit 1
fi

if (( RETENTION_COUNT < 1 )); then
  RETENTION_COUNT=1
fi

tar -czf "${BACKUP_FILE}" -C "${WORKSPACE_DIR}" .
echo "Backup created: ${BACKUP_FILE}"

mapfile -t backups < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'discussion-boards-workspace-*.tar.gz' | sort -r)

if ((${#backups[@]} > RETENTION_COUNT)); then
  for old_backup in "${backups[@]:RETENTION_COUNT}"; do
    rm -f "${old_backup}"
    echo "Removed old backup: ${old_backup}"
  done
fi

echo "Kept ${#backups[@]} backup snapshot(s), max retained: ${RETENTION_COUNT}."
