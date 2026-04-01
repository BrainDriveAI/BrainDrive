#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/stop.sh [quickstart|prod|local|dev]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="compose.quickstart.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
fi

docker compose -f "${COMPOSE_FILE}" stop
docker compose -f "${COMPOSE_FILE}" ps

echo "Stop complete for ${MODE} stack."
