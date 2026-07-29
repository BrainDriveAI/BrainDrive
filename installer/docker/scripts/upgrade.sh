#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: ./scripts/upgrade.sh [local|prod]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"
source "${SCRIPT_DIR}/browser-helper.sh"
source "${SCRIPT_DIR}/auth-bootstrap.sh"

DRY_RUN="${BRAINDRIVE_UPGRADE_DRY_RUN:-false}"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
}

source "${SCRIPT_DIR}/release-resolution.sh"

configure_docker_platform() {
  if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
    return 0
  fi

  local configured_platform
  configured_platform="${BRAINDRIVE_DOCKER_PLATFORM:-$(trim_quotes "$(get_env_value BRAINDRIVE_DOCKER_PLATFORM)")}"
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

get_current_service_image() {
  local compose_file="$1"
  local service="$2"

  local container_id
  container_id="$(docker compose -f "${compose_file}" ps -q "${service}" 2>/dev/null | head -n 1 || true)"
  if [[ -z "${container_id}" ]]; then
    echo ""
    return 0
  fi

  local configured_image
  configured_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}" 2>/dev/null || true)"
  echo "${configured_image}"
}

COMPOSE_FILE="compose.local.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
fi

configure_docker_platform

bash "${SCRIPT_DIR}/fetch-release-metadata.sh"
resolve_prod_image_refs_from_manifest
validate_prod_image_refs

local_app_ref="$(trim_quotes "${BRAINDRIVE_APP_REF:-$(get_env_value BRAINDRIVE_APP_REF)}")"
local_edge_ref="$(trim_quotes "${BRAINDRIVE_EDGE_REF:-$(get_env_value BRAINDRIVE_EDGE_REF)}")"
local_app_image="$(trim_quotes "${BRAINDRIVE_APP_IMAGE:-$(get_env_value BRAINDRIVE_APP_IMAGE)}")"
local_edge_image="$(trim_quotes "${BRAINDRIVE_EDGE_IMAGE:-$(get_env_value BRAINDRIVE_EDGE_IMAGE)}")"
local_tag="$(trim_quotes "${BRAINDRIVE_TAG:-$(get_env_value BRAINDRIVE_TAG)}")"

if [[ -z "${local_tag}" ]]; then
  local_tag="latest"
fi

if [[ -z "${local_app_image}" ]]; then
  local_app_image="ghcr.io/braindriveai/braindrive-app"
fi
if [[ -z "${local_edge_image}" ]]; then
  local_edge_image="ghcr.io/braindriveai/braindrive-edge"
fi

target_app_image="${local_app_ref:-${local_app_image}:${local_tag}}"
target_edge_image="${local_edge_ref:-${local_edge_image}:${local_tag}}"

if [[ "$(to_bool "${DRY_RUN}")" == "true" ]]; then
  current_app_image="$(get_current_service_image "${COMPOSE_FILE}" "app")"
  current_edge_image="$(get_current_service_image "${COMPOSE_FILE}" "edge")"

  if [[ -z "${current_app_image}" ]]; then
    current_app_image="$(trim_quotes "${BRAINDRIVE_LAST_APPLIED_APP_REF:-}")"
  fi
  if [[ -z "${current_edge_image}" ]]; then
    current_edge_image="$(trim_quotes "${BRAINDRIVE_LAST_APPLIED_EDGE_REF:-}")"
  fi

  update_available="false"
  if [[ -z "${current_app_image}" || -z "${current_edge_image}" ]]; then
    update_available="true"
  elif [[ "${current_app_image}" != "${target_app_image}" || "${current_edge_image}" != "${target_edge_image}" ]]; then
    update_available="true"
  fi

  echo "CHECK_MODE=dry-run"
  echo "CHECK_TARGET_APP_REF=${target_app_image}"
  echo "CHECK_TARGET_EDGE_REF=${target_edge_image}"
  echo "CHECK_CURRENT_APP_REF=${current_app_image}"
  echo "CHECK_CURRENT_EDGE_REF=${current_edge_image}"
  echo "CHECK_RESOLVED_VERSION=${local_tag}"
  echo "CHECK_UPDATE_AVAILABLE=${update_available}"

  if [[ "${update_available}" == "true" ]]; then
    exit 10
  fi
  exit 0
fi

if [[ "${MODE}" == "prod" ]]; then
  braindrive_initialize_prod_auth_bootstrap ".env"
fi

docker compose -f "${COMPOSE_FILE}" pull
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

docker compose -f "${COMPOSE_FILE}" ps
braindrive_print_access_info_and_open "${MODE}" "Upgrade complete."
