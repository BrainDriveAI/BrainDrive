#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODE="${1:-${BRAINDRIVE_MIGRATION_MODE:-dev}}"
BASE_URL="${2:-${BRAINDRIVE_MIGRATION_BASE_URL:-}}"

STAMP="$(date +%Y%m%d_%H%M%S)"
TMP_ARCHIVE="${ROOT_DIR}/backups/migration-smoke-${STAMP}.tar.gz"
mkdir -p "$(dirname "${TMP_ARCHIVE}")"

if [[ -n "${BASE_URL}" ]]; then
  BRAINDRIVE_MIGRATION_MODE="${MODE}" BRAINDRIVE_MIGRATION_BASE_URL="${BASE_URL}" \
    "${SCRIPT_DIR}/migration-export.sh" "${TMP_ARCHIVE}" "${BASE_URL}"
  BRAINDRIVE_MIGRATION_MODE="${MODE}" BRAINDRIVE_MIGRATION_BASE_URL="${BASE_URL}" \
    "${SCRIPT_DIR}/migration-import.sh" "${TMP_ARCHIVE}" "${BASE_URL}"
else
  BRAINDRIVE_MIGRATION_MODE="${MODE}" "${SCRIPT_DIR}/migration-export.sh" "${TMP_ARCHIVE}"
  BRAINDRIVE_MIGRATION_MODE="${MODE}" "${SCRIPT_DIR}/migration-import.sh" "${TMP_ARCHIVE}"
fi

echo "Migration smoke test passed: ${TMP_ARCHIVE}"
