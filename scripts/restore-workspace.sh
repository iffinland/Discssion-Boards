#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${HOME}/VS-Code-Projects/REACT-PROJECTS/_workspace_backups/Discussion_Boards"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "Backup directory not found: ${BACKUP_DIR}"
  exit 1
fi

mapfile -t backups < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'discussion-boards-workspace-*.tar.gz' | sort -r)

if ((${#backups[@]} == 0)); then
  echo "No backups found in: ${BACKUP_DIR}"
  exit 1
fi

echo "Available backups:"
for i in "${!backups[@]}"; do
  printf "%d) %s\n" "$((i + 1))" "$(basename "${backups[$i]}")"
done

read -r -p "Choose backup number to restore: " selection

if ! [[ "${selection}" =~ ^[0-9]+$ ]]; then
  echo "Invalid selection."
  exit 1
fi

if ((selection < 1 || selection > ${#backups[@]})); then
  echo "Selection out of range."
  exit 1
fi

selected_backup="${backups[$((selection - 1))]}"

echo "Selected: $(basename "${selected_backup}")"
echo "This will replace workspace files in: ${WORKSPACE_DIR}"
read -r -p "Type RESTORE to continue: " confirmation

if [[ "${confirmation}" != "RESTORE" ]]; then
  echo "Restore cancelled."
  exit 0
fi

find "${WORKSPACE_DIR}" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
tar -xzf "${selected_backup}" -C "${WORKSPACE_DIR}"

echo "Restore completed from: ${selected_backup}"
