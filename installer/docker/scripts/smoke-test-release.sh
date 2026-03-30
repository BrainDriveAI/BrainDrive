#!/usr/bin/env bash
set -euo pipefail

# Smoke test a deployed release endpoint.
# Usage: ./scripts/smoke-test-release.sh https://app.example.com

BASE_URL="${1:-}"
if [[ -z "${BASE_URL}" ]]; then
  echo "Usage: $0 <base-url>"
  exit 1
fi

curl -fsS "${BASE_URL}/health" >/dev/null

echo "Health check passed for ${BASE_URL}"
echo "Add auth + message roundtrip checks for production gate completeness."
