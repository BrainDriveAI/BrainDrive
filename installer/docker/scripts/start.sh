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
source "${SCRIPT_DIR}/browser-helper.sh"

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
  if [[ "${MODE}" != "quickstart" && "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
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
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
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

if [[ "${MODE}" == "quickstart" || "${MODE}" == "prod" || "${MODE}" == "local" ]]; then
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

braindrive_print_access_info_and_open "${MODE}" "Start complete."
