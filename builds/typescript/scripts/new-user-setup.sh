#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

LIBRARY_HOST_PATH=""
SECRETS_HOST_PATH=""
MEMORY_ROOT="./your-memory"
MASTER_KEY_B64="${PAA_SECRETS_MASTER_KEY_B64:-}"
MASTER_KEY_ID="${PAA_SECRETS_MASTER_KEY_ID:-owner-master-v1}"
SKIP_DOCKER=0
START_CLI=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/new-user-setup.sh [options]

Options:
  --library-path <path>    Host path for library/memory mount (default: <repo>/your-memory)
  --secrets-path <path>    Host path for encrypted vault files (default: ~/.config/paa/secrets)
  --memory-root <path>     Runtime memory root for local server mode (default: ./your-memory)
  --master-key-b64 <key>   Base64 32-byte master key (default: generate if missing)
  --master-key-id <id>     Master key id (default: owner-master-v1)
  --skip-docker            Skip docker compose startup
  --start-cli              Start interactive CLI at the end
  --help                   Show this help text

What this script does:
  1) Ensures .env has stable library/vault paths and master key values.
  2) Installs npm dependencies.
  3) Initializes secrets key material and prompts for OpenRouter API key.
  4) Initializes memory layout with secret_ref profile onboarding defaults.
  5) Starts Docker stack and verifies runtime health (unless --skip-docker).
USAGE
}

step() {
  printf '\n[%s] %s\n' "$(date +'%H:%M:%S')" "$1"
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

generate_master_key_b64() {
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
}

upsert_env_file() {
  local env_file="$1"
  local tmp_file
  tmp_file="$(mktemp)"

  if [[ -f "$env_file" ]]; then
    grep -Ev '^(PAA_LIBRARY_HOST_PATH|PAA_SECRETS_HOST_PATH|PAA_MEMORY_ROOT|PAA_SECRETS_MASTER_KEY_B64|PAA_SECRETS_MASTER_KEY_ID)=' "$env_file" > "$tmp_file" || true
    cp "$env_file" "${env_file}.bak.$(date +%Y%m%d%H%M%S)"
  fi

  {
    cat "$tmp_file"
    printf 'PAA_LIBRARY_HOST_PATH="%s"\n' "$(escape_env_value "$LIBRARY_HOST_PATH")"
    printf 'PAA_SECRETS_HOST_PATH="%s"\n' "$(escape_env_value "$SECRETS_HOST_PATH")"
    printf 'PAA_MEMORY_ROOT="%s"\n' "$(escape_env_value "$MEMORY_ROOT")"
    printf 'PAA_SECRETS_MASTER_KEY_B64="%s"\n' "$(escape_env_value "$MASTER_KEY_B64")"
    printf 'PAA_SECRETS_MASTER_KEY_ID="%s"\n' "$(escape_env_value "$MASTER_KEY_ID")"
  } > "$env_file"

  rm -f "$tmp_file"
}

wait_for_runtime_health() {
  local attempts=60
  local sleep_seconds=2
  for ((i = 1; i <= attempts; i += 1)); do
    if node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      echo "Runtime is healthy on http://127.0.0.1:8787/health"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

resolve_absolute_path() {
  local target="$1"
  node -e "const path=require('node:path'); console.log(path.resolve(process.argv[1], process.argv[2]));" "$ROOT_DIR" "$target"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --library-path)
      LIBRARY_HOST_PATH="$2"
      shift 2
      ;;
    --secrets-path)
      SECRETS_HOST_PATH="$2"
      shift 2
      ;;
    --memory-root)
      MEMORY_ROOT="$2"
      shift 2
      ;;
    --master-key-b64)
      MASTER_KEY_B64="$2"
      shift 2
      ;;
    --master-key-id)
      MASTER_KEY_ID="$2"
      shift 2
      ;;
    --skip-docker)
      SKIP_DOCKER=1
      shift
      ;;
    --start-cli)
      START_CLI=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd node
require_cmd npm
require_cmd docker
require_cmd sed

if [[ -z "$LIBRARY_HOST_PATH" ]]; then
  LIBRARY_HOST_PATH="${ROOT_DIR}/your-memory"
fi
if [[ -z "$SECRETS_HOST_PATH" ]]; then
  SECRETS_HOST_PATH="${HOME}/.config/paa/secrets"
fi
if [[ -z "$MASTER_KEY_B64" ]]; then
  MASTER_KEY_B64="$(generate_master_key_b64)"
  echo "Generated new master key for this setup run."
fi

step "Preparing directories and .env"
mkdir -p "$LIBRARY_HOST_PATH"
mkdir -p "$SECRETS_HOST_PATH"
upsert_env_file "${ROOT_DIR}/.env"

set -a
source <(sed 's/\r$//' "${ROOT_DIR}/.env")
set +a

step "Installing npm dependencies"
npm install

step "Initializing secrets key material"
npm run secrets -- init

step "Setting OpenRouter API key in encrypted vault"
echo "Paste your OpenRouter API key when prompted."
npm run secrets -- set provider/openrouter/api_key

step "Initializing memory layout (secret_ref profile)"
INIT_MEMORY_ROOT="$(resolve_absolute_path "$MEMORY_ROOT")"
INIT_LIBRARY_ROOT="$(resolve_absolute_path "$LIBRARY_HOST_PATH")"
npm run memory:init -- --memory-root "$INIT_MEMORY_ROOT" --profile openrouter-secret-ref --seed-default-projects
if [[ "$INIT_LIBRARY_ROOT" != "$INIT_MEMORY_ROOT" ]]; then
  npm run memory:init -- --memory-root "$INIT_LIBRARY_ROOT" --profile openrouter-secret-ref --seed-default-projects
fi

step "Checking secrets status"
npm run secrets -- status

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  step "Starting Docker stack"
  docker compose down || true
  docker compose up -d --build

  step "Waiting for runtime health"
  if ! wait_for_runtime_health; then
    echo "Runtime did not become healthy. Showing recent runtime logs:" >&2
    runtime_container_id="$(docker compose ps -q paa-runtime 2>/dev/null || true)"
    if [[ -n "${runtime_container_id}" ]]; then
      docker logs --tail 120 "${runtime_container_id}" || true
    else
      docker compose logs --tail 120 paa-runtime || true
    fi
    exit 1
  fi
fi

step "Setup complete"
echo "Next command: npm run dev:cli"
echo "Then prompt: Tell me a joke"

if [[ "$START_CLI" -eq 1 ]]; then
  npm run dev:cli
fi
