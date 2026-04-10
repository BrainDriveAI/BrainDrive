#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/install.sh [quickstart|prod|local|dev]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"
source "${SCRIPT_DIR}/browser-helper.sh"

COMPOSE_FILE="compose.quickstart.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
fi

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

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

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped="$value"
  escaped="${escaped//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if grep -q -E "^${key}=" .env; then
    # GNU sed supports `-i`; BSD/macOS sed requires `-i ''`.
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^${key}=.*|${key}=${escaped}|" .env
    else
      sed -i '' "s|^${key}=.*|${key}=${escaped}|" .env
    fi
  else
    printf '%s=%s\n' "${key}" "${value}" >> .env
  fi
}

generate_master_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
    return 0
  fi

  echo "Could not generate PAA_SECRETS_MASTER_KEY_B64. Install openssl, node, or python3." >&2
  exit 1
}

require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required (docker compose)." >&2
  exit 1
fi

if [[ -f .env ]]; then
  echo "Install stopped: .env already exists at ${ROOT_DIR}/.env" >&2
  echo "This installer is first-run only to protect existing account/secrets state." >&2
  echo "Use one of these instead:" >&2
  echo "  - start:   ./scripts/start.sh ${MODE}" >&2
  echo "  - upgrade: ./scripts/upgrade.sh ${MODE}" >&2
  echo "  - reset:   ./scripts/reset-new-user.sh --fresh-clone" >&2
  exit 1
fi

cp .env.example .env
echo "Created .env from .env.example"

MASTER_KEY="$(get_env_value PAA_SECRETS_MASTER_KEY_B64 | tr -d '"')"
if [[ -z "${MASTER_KEY}" ]]; then
  MASTER_KEY="$(generate_master_key)"
  set_env_value "PAA_SECRETS_MASTER_KEY_B64" "${MASTER_KEY}"
  echo "Generated PAA_SECRETS_MASTER_KEY_B64 and wrote it to .env"
fi

if [[ "${MODE}" == "prod" ]]; then
  DOMAIN_VALUE="$(get_env_value DOMAIN | tr -d '"')"
  if [[ -z "${DOMAIN_VALUE}" || "${DOMAIN_VALUE}" == "app.example.com" ]]; then
    echo "Please set DOMAIN in .env to your real DNS hostname before prod install." >&2
    exit 1
  fi

  APP_REF_VALUE="$(get_env_value BRAINDRIVE_APP_REF | tr -d '"')"
  EDGE_REF_VALUE="$(get_env_value BRAINDRIVE_EDGE_REF | tr -d '"')"
  if [[ -n "${APP_REF_VALUE}" && -z "${EDGE_REF_VALUE}" ]]; then
    echo "BRAINDRIVE_APP_REF is set but BRAINDRIVE_EDGE_REF is missing." >&2
    echo "Set both refs or neither." >&2
    exit 1
  fi
  if [[ -n "${EDGE_REF_VALUE}" && -z "${APP_REF_VALUE}" ]]; then
    echo "BRAINDRIVE_EDGE_REF is set but BRAINDRIVE_APP_REF is missing." >&2
    echo "Set both refs or neither." >&2
    exit 1
  fi
fi

configure_docker_platform

if [[ "${MODE}" == "dev" ]]; then
  docker volume create braindrive_memory >/dev/null
  docker volume create braindrive_secrets >/dev/null
  echo "Building and starting developer stack using ${COMPOSE_FILE}"
  docker compose -f "${COMPOSE_FILE}" up -d --build
else
  echo "Pulling images using ${COMPOSE_FILE}"
  docker compose -f "${COMPOSE_FILE}" pull
  echo "Starting stack"
  docker compose -f "${COMPOSE_FILE}" up -d
fi

echo "Current service status"
docker compose -f "${COMPOSE_FILE}" ps

braindrive_print_access_info_and_open "${MODE}" "Install complete."
