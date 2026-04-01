#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" ]]; then
  echo "Usage: ./scripts/start.sh [quickstart|prod|local]"
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

COMPOSE_FILE="compose.quickstart.yml"
URL_HINT="http://127.0.0.1:8080"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
  URL_HINT="https://<DOMAIN>"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

if [[ "${MODE}" == "local" || "${MODE}" == "quickstart" ]]; then
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
    echo "If you meant quickstart mode, run: ./scripts/start.sh quickstart" >&2
    exit 1
  fi
fi

if [[ "${MODE}" == "quickstart" || "${MODE}" == "prod" ]]; then
  set +e
  bash "${SCRIPT_DIR}/check-update.sh" "${MODE}"
  CHECK_UPDATE_EXIT=$?
  set -e

  if [[ ${CHECK_UPDATE_EXIT} -eq 40 || ${CHECK_UPDATE_EXIT} -eq 50 ]]; then
    echo "Startup halted because update policy is fail-closed and update processing failed." >&2
    exit ${CHECK_UPDATE_EXIT}
  fi
fi

if ! docker compose -f "${COMPOSE_FILE}" up -d; then
  if [[ "${MODE}" == "prod" ]]; then
    echo "Prod start failed. If you are running locally, use: ./scripts/start.sh quickstart" >&2
  fi
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" ps

echo "Start complete. Open: ${URL_HINT}"
