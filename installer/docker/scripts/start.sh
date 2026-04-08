#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/start.sh [quickstart|prod|local|dev]"
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

configure_docker_platform() {
  if [[ "${MODE}" != "quickstart" && "${MODE}" != "prod" ]]; then
    return 0
  fi

  local configured_platform
  configured_platform="${BRAINDRIVE_DOCKER_PLATFORM:-$(get_env_value BRAINDRIVE_DOCKER_PLATFORM | tr -d '"')}"
  if [[ -n "${configured_platform}" ]]; then
    export DOCKER_DEFAULT_PLATFORM="${configured_platform}"
    echo "Using Docker platform override: ${DOCKER_DEFAULT_PLATFORM}"
    return 0
  fi

  local host_os
  local host_arch
  host_os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  host_arch="$(uname -m 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  if [[ "${host_os}" == "darwin" && ( "${host_arch}" == "arm64" || "${host_arch}" == "aarch64" ) ]]; then
    export DOCKER_DEFAULT_PLATFORM="linux/amd64"
    echo "Apple Silicon detected; using linux/amd64 for BrainDrive prebuilt images."
    echo "Set BRAINDRIVE_DOCKER_PLATFORM to override this behavior."
  fi
}

COMPOSE_FILE="compose.quickstart.yml"
URL_HINT="http://127.0.0.1:8080"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
  URL_HINT="https://<DOMAIN>"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
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

if [[ "${MODE}" == "dev" ]]; then
  DEV_BIND_HOST="$(get_env_value BRAINDRIVE_DEV_BIND_HOST | tr -d '"')"
  DEV_PORT="$(get_env_value BRAINDRIVE_DEV_PORT | tr -d '"')"
  if [[ -z "${DEV_BIND_HOST}" ]]; then
    DEV_BIND_HOST="127.0.0.1"
  fi
  if [[ -z "${DEV_PORT}" ]]; then
    DEV_PORT="5073"
  fi

  if [[ "${DEV_BIND_HOST}" == "0.0.0.0" ]]; then
    URL_HINT="http://<this-machine-ip>:${DEV_PORT}"
  else
    URL_HINT="http://${DEV_BIND_HOST}:${DEV_PORT}"
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

configure_docker_platform

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

if [[ "${MODE}" == "dev" ]]; then
  docker volume create braindrive_memory >/dev/null
  docker volume create braindrive_secrets >/dev/null
fi

if ! docker compose -f "${COMPOSE_FILE}" up -d; then
  if [[ "${MODE}" == "prod" ]]; then
    echo "Prod start failed. If you are running locally, use: ./scripts/start.sh quickstart" >&2
  fi
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" ps

echo "Start complete. Open: ${URL_HINT}"
