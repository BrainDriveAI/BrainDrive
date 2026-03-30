#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: ./scripts/start.sh [prod|local]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
}

COMPOSE_FILE="compose.prod.yml"
URL_HINT="https://<DOMAIN>"
if [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

if [[ "${MODE}" == "local" ]]; then
  LOCAL_BIND_HOST="$(get_env_value BRAINDRIVE_LOCAL_BIND_HOST | tr -d '"')"
  if [[ -z "${LOCAL_BIND_HOST}" ]]; then
    LOCAL_BIND_HOST="127.0.0.1"
  fi

  if [[ "${LOCAL_BIND_HOST}" == "0.0.0.0" ]]; then
    URL_HINT="http://<this-machine-ip>:8080"
  else
    URL_HINT="http://${LOCAL_BIND_HOST}:8080"
  fi
fi

if [[ "${MODE}" == "prod" ]]; then
  DOMAIN_VALUE="$(get_env_value DOMAIN | tr -d '"')"
  if [[ -z "${DOMAIN_VALUE}" || "${DOMAIN_VALUE}" == "app.example.com" ]]; then
    echo "Prod start requires installer/docker/.env with a real DOMAIN." >&2
    echo "If you meant local mode, run: ./scripts/start.sh local" >&2
    exit 1
  fi
fi

if ! docker compose -f "${COMPOSE_FILE}" up -d; then
  if [[ "${MODE}" == "prod" ]]; then
    echo "Prod start failed. If you are running locally, use: ./scripts/start.sh local" >&2
  fi
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" ps

echo "Start complete. Open: ${URL_HINT}"
