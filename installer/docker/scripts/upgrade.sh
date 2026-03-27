#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: ./scripts/upgrade.sh [prod|local]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="compose.prod.yml"
if [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

if [[ "${MODE}" == "local" ]]; then
  docker compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans
else
  docker compose -f "${COMPOSE_FILE}" pull
  docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans
fi

docker compose -f "${COMPOSE_FILE}" ps
