#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: ./scripts/stop.sh [prod|local]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="compose.prod.yml"
if [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

docker compose -f "${COMPOSE_FILE}" stop
docker compose -f "${COMPOSE_FILE}" ps

echo "Stop complete for ${MODE} stack."
