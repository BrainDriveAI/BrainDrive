#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"
SINCE_WINDOW="${2:-24h}"
OUTPUT_DIR="${3:-}"

if [[ "${MODE}" != "quickstart" && "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "dev" ]]; then
  echo "Usage: ./scripts/support-bundle.sh [quickstart|prod|local|dev] [since-window] [output-dir]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="${ROOT_DIR}/support-bundles"
fi

if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
elif [[ "${MODE}" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
else
  COMPOSE_FILE="compose.quickstart.yml"
fi

TIMESTAMP_UTC="$(date -u +%Y%m%d_%H%M%S)"
BUNDLE_NAME="support-bundle-${MODE}-${TIMESTAMP_UTC}"
STAGING_DIR="$(mktemp -d)"
BUNDLE_DIR="${STAGING_DIR}/${BUNDLE_NAME}"
mkdir -p "${BUNDLE_DIR}/logs" "${BUNDLE_DIR}/metadata" "${BUNDLE_DIR}/health" "${BUNDLE_DIR}/memory"

cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

WARNINGS_FILE="${BUNDLE_DIR}/metadata/warnings.txt"

capture_command() {
  local output_file="$1"
  shift
  if "$@" >"${output_file}" 2>&1; then
    return 0
  fi

  echo "Command failed: $*" >> "${WARNINGS_FILE}"
  return 0
}

append_warning() {
  local warning_message="$1"
  echo "${warning_message}" >> "${WARNINGS_FILE}"
}

cat > "${BUNDLE_DIR}/metadata/runtime-metadata.json" <<EOF
{
  "generated_at_utc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "mode": "${MODE}",
  "compose_file": "${COMPOSE_FILE}",
  "since_window": "${SINCE_WINDOW}"
}
EOF

capture_command "${BUNDLE_DIR}/metadata/docker-version.txt" docker version
capture_command "${BUNDLE_DIR}/metadata/docker-compose-version.txt" docker compose version
capture_command "${BUNDLE_DIR}/metadata/compose-ps.txt" docker compose -f "${COMPOSE_FILE}" ps
capture_command "${BUNDLE_DIR}/metadata/compose-config-services.txt" docker compose -f "${COMPOSE_FILE}" config --services
capture_command "${BUNDLE_DIR}/metadata/compose-config-rendered.txt" docker compose -f "${COMPOSE_FILE}" config

SERVICES=()
while IFS= read -r service_name; do
  if [[ -n "${service_name}" ]]; then
    SERVICES+=("${service_name}")
  fi
done < <(docker compose -f "${COMPOSE_FILE}" config --services 2>/dev/null || true)

if [[ ${#SERVICES[@]} -eq 0 ]]; then
  if [[ "${MODE}" == "dev" ]]; then
    SERVICES=("app" "web")
  else
    SERVICES=("app" "edge")
  fi
  append_warning "Unable to resolve services from compose config; using fallback list for mode ${MODE}"
fi

for service in "${SERVICES[@]}"; do
  capture_command "${BUNDLE_DIR}/logs/${service}.log" docker compose -f "${COMPOSE_FILE}" logs --no-color --timestamps --since "${SINCE_WINDOW}" "${service}"
done

if [[ "${BRAINDRIVE_SUPPORT_BUNDLE_SKIP_HEALTH:-false}" != "true" ]]; then
  if command -v curl >/dev/null 2>&1; then
    if ! curl -fsS --max-time 8 "http://127.0.0.1:8787/health" > "${BUNDLE_DIR}/health/gateway-health.json" 2>"${BUNDLE_DIR}/health/gateway-health.error.log"; then
      append_warning "Health snapshot failed: http://127.0.0.1:8787/health"
    fi

    if ! curl -fsS --max-time 8 "http://127.0.0.1:8080/health" > "${BUNDLE_DIR}/health/edge-health.json" 2>"${BUNDLE_DIR}/health/edge-health.error.log"; then
      append_warning "Health snapshot failed: http://127.0.0.1:8080/health"
    fi

    if [[ "${MODE}" == "prod" ]]; then
      DOMAIN_VALUE=""
      if [[ -f ".env" ]]; then
        DOMAIN_VALUE="$(grep -E "^DOMAIN=" .env | head -n 1 | cut -d "=" -f2- | tr -d '"')"
      fi
      if [[ -n "${DOMAIN_VALUE}" && "${DOMAIN_VALUE}" != "app.example.com" ]]; then
        if ! curl -fsS --max-time 8 "https://${DOMAIN_VALUE}/health" > "${BUNDLE_DIR}/health/public-health.json" 2>"${BUNDLE_DIR}/health/public-health.error.log"; then
          append_warning "Health snapshot failed: https://${DOMAIN_VALUE}/health"
        fi
      fi
    fi
  else
    append_warning "curl is not available; skipping health endpoint snapshots"
  fi
fi

if ! docker run --rm \
  -v "braindrive_memory:/memory:ro" \
  -v "${BUNDLE_DIR}:/bundle" \
  alpine:3.20 \
  sh -lc "mkdir -p /bundle/memory && if [ -d /memory/diagnostics/audit ]; then cp -a /memory/diagnostics/audit /bundle/memory/ && chmod -R a+rwX /bundle/memory/audit || true; else echo 'No persisted audit logs found under /memory/diagnostics/audit' > /bundle/memory/audit-missing.txt; fi" \
  > "${BUNDLE_DIR}/metadata/memory-audit-copy.log" 2>&1; then
  append_warning "Unable to read persisted audit JSONL files from braindrive_memory volume"
fi

redact_file() {
  local file_path="$1"
  local tmp_file="${file_path}.tmp"

  if command -v perl >/dev/null 2>&1; then
    perl -0pe '
      s/Bearer\s+[A-Za-z0-9._-]{8,}/Bearer [REDACTED]/gi;
      s/\bsk-[A-Za-z0-9_-]{8,}\b/[REDACTED]/g;
      s/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)(\"[^\"]*\"|[^,\s}]+)/$1[REDACTED]/gi;
      s/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/[REDACTED]/g;
    ' "${file_path}" > "${tmp_file}"
  else
    sed -E \
      -e 's/Bearer[[:space:]]+[A-Za-z0-9._-]{8,}/Bearer [REDACTED]/g' \
      -e 's/sk-[A-Za-z0-9_-]{8,}/[REDACTED]/g' \
      -e 's/(api[_-]?key[[:space:]]*[:=][[:space:]]*)[^",[:space:]}]+/\1[REDACTED]/g' \
      -e 's/(token[[:space:]]*[:=][[:space:]]*)[^",[:space:]}]+/\1[REDACTED]/g' \
      -e 's/(password[[:space:]]*[:=][[:space:]]*)[^",[:space:]}]+/\1[REDACTED]/g' \
      -e 's/(secret[[:space:]]*[:=][[:space:]]*)[^",[:space:]}]+/\1[REDACTED]/g' \
      "${file_path}" > "${tmp_file}"
  fi

  mv "${tmp_file}" "${file_path}"
}

while IFS= read -r -d '' text_file; do
  redact_file "${text_file}"
done < <(find "${BUNDLE_DIR}" -type f \( -name "*.log" -o -name "*.txt" -o -name "*.json" -o -name "*.jsonl" -o -name "*.md" \) -print0)

mkdir -p "${OUTPUT_DIR}"
ARCHIVE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
tar -czf "${ARCHIVE_PATH}" -C "${STAGING_DIR}" "${BUNDLE_NAME}"

echo "Support bundle created: ${ARCHIVE_PATH}"
