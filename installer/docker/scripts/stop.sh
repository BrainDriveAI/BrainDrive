#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"
QUICKSTART_ALIAS_USED="false"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/stop.sh [local|prod|dev|quickstart]"
  exit 1
fi

if [[ "${MODE}" == "quickstart" ]]; then
  echo "Mode 'quickstart' is deprecated and now aliases to 'local'." >&2
  MODE="local"
  QUICKSTART_ALIAS_USED="true"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="compose.local.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
fi

docker compose -f "${COMPOSE_FILE}" stop
if [[ "${QUICKSTART_ALIAS_USED}" == "true" ]]; then
  docker compose -f compose.quickstart.yml stop >/dev/null 2>&1 || true
fi
docker compose -f "${COMPOSE_FILE}" ps

echo "Stop complete for ${MODE} stack."
