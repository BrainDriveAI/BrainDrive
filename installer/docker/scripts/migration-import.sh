#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: ./scripts/migration-import.sh <archive-file> [base-url]"
  exit 1
fi

ARCHIVE_FILE="$1"
if [[ ! -f "${ARCHIVE_FILE}" ]]; then
  echo "Migration archive not found: ${ARCHIVE_FILE}" >&2
  exit 1
fi

MODE="${BRAINDRIVE_MIGRATION_MODE:-local}"
if [[ "${MODE}" == "quickstart" ]]; then
  MODE="local"
fi
BASE_URL_DEFAULT="http://127.0.0.1:8080"
if [[ "${MODE}" == "dev" ]]; then
  BASE_URL_DEFAULT="http://127.0.0.1:5073"
fi
BASE_URL="${2:-${BRAINDRIVE_MIGRATION_BASE_URL:-${BASE_URL_DEFAULT}}}"

PERMISSIONS_JSON='{"memory_access":true,"tool_access":true,"system_actions":true,"delegation":true,"approval_authority":true,"administration":true}'
ACCESS_TOKEN="${BRAINDRIVE_MIGRATION_ACCESS_TOKEN:-}"

if [[ -z "${ACCESS_TOKEN}" && -n "${BRAINDRIVE_MIGRATION_IDENTIFIER:-}" && -n "${BRAINDRIVE_MIGRATION_PASSWORD:-}" ]]; then
  login_payload="$(printf '{"identifier":"%s","password":"%s"}' "${BRAINDRIVE_MIGRATION_IDENTIFIER}" "${BRAINDRIVE_MIGRATION_PASSWORD}")"
  login_response="$(
    curl -fsS \
      -X POST \
      -H "content-type: application/json" \
      --data "${login_payload}" \
      "${BASE_URL}/api/auth/login"
  )"
  ACCESS_TOKEN="$(
    printf '%s' "${login_response}" | node -e "let raw='';process.stdin.on('data',d=>raw+=d).on('end',()=>{try{const p=JSON.parse(raw);if(typeof p.access_token!=='string'||p.access_token.length===0){process.exit(1);}process.stdout.write(p.access_token);}catch{process.exit(1);}});"
  )"
fi

headers=(-H "content-type: application/gzip")
if [[ -n "${ACCESS_TOKEN}" ]]; then
  headers+=(-H "authorization: Bearer ${ACCESS_TOKEN}")
else
  headers+=(
    -H "x-actor-id: owner"
    -H "x-actor-type: owner"
    -H "x-auth-mode: local-owner"
    -H "x-actor-permissions: ${PERMISSIONS_JSON}"
  )
fi

response="$(
  curl -fsS \
    -X POST \
    "${headers[@]}" \
    --data-binary "@${ARCHIVE_FILE}" \
    "${BASE_URL}/api/migration/import"
)"

echo "${response}" | node -e "let raw='';process.stdin.on('data',d=>raw+=d).on('end',()=>{try{const payload=JSON.parse(raw);process.stdout.write(JSON.stringify(payload,null,2)+'\n');}catch{process.stdout.write(raw+'\n');}});"
