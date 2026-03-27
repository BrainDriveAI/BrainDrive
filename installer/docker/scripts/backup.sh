#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${1:-${ROOT_DIR}/backups}"

mkdir -p "${BACKUP_DIR}"
BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
STAMP="$(date +%Y%m%d_%H%M%S)"

backup_volume() {
  local volume="$1"
  local file_name="${volume}_${STAMP}.tar.gz"
  docker run --rm \
    -v "${volume}:/volume:ro" \
    -v "${BACKUP_DIR}:/backup" \
    alpine:3.20 \
    sh -c "cd /volume && tar -czf /backup/${file_name} ."
  echo "Created ${BACKUP_DIR}/${file_name}"
}

backup_volume "braindrive_memory"
backup_volume "braindrive_secrets"

echo "Backup complete: ${BACKUP_DIR}"
