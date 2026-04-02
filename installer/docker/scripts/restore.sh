#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: ./scripts/restore.sh <memory|secrets> <backup-file> [quickstart|prod|local]"
  exit 1
fi

TARGET="$1"
BACKUP_FILE="$2"
MODE="${3:-prod}"

if [[ "${MODE}" != "quickstart" && "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Mode must be quickstart, prod, or local"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

case "${TARGET}" in
  memory)
    VOLUME="braindrive_memory"
    ;;
  secrets)
    VOLUME="braindrive_secrets"
    ;;
  *)
    echo "Target must be memory or secrets"
    exit 1
    ;;
esac

COMPOSE_FILE="compose.prod.yml"
if [[ "${MODE}" == "quickstart" ]]; then
  COMPOSE_FILE="compose.quickstart.yml"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

BACKUP_DIR="$(cd "$(dirname "${BACKUP_FILE}")" && pwd)"
BACKUP_NAME="$(basename "${BACKUP_FILE}")"

echo "Stopping stack before restore"
docker compose -f "${COMPOSE_FILE}" down

docker volume create "${VOLUME}" >/dev/null

docker run --rm \
  -v "${VOLUME}:/volume" \
  -v "${BACKUP_DIR}:/backup:ro" \
  alpine:3.20 \
  sh -c "rm -rf /volume/* /volume/.[!.]* /volume/..?* 2>/dev/null || true; tar -xzf /backup/${BACKUP_NAME} -C /volume"

echo "Starting stack after restore"
docker compose -f "${COMPOSE_FILE}" up -d

echo "Restore complete for ${VOLUME} from ${BACKUP_FILE}"
