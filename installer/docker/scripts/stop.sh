#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/stop.sh [local|prod|dev]"
  exit 1
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
docker compose -f "${COMPOSE_FILE}" ps

echo "Stop complete for ${MODE} stack."
