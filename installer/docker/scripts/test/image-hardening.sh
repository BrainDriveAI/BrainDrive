#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
DOCKERIGNORE="${REPO_ROOT}/.dockerignore"
APP_DOCKERFILE="${REPO_ROOT}/installer/docker/Dockerfile.app"

for ignore_pattern in '**/.env' '**/.paa-secrets'; do
  if ! grep -Fxq "${ignore_pattern}" "${DOCKERIGNORE}"; then
    echo ".dockerignore is missing ${ignore_pattern}." >&2
    exit 1
  fi
done

for package_root in /app/typescript /app/mcp_release; do
  if ! grep -Fq "npm --prefix ${package_root} prune --omit=dev" "${APP_DOCKERFILE}"; then
    echo "Final application image does not prune dev dependencies from ${package_root}." >&2
    exit 1
  fi
done

echo "Application image hardening checks passed."
