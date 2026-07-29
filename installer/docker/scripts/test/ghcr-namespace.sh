#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
CANONICAL_NAMESPACE="ghcr.io/braindriveai"
LEGACY_NAMESPACE="ghcr.io/braindrive""-ai"

cd "${REPO_ROOT}"

if matches="$(git grep -n -F "${LEGACY_NAMESPACE}/" -- .)"; then
  echo "Found non-canonical GHCR namespace references:" >&2
  printf '%s\n' "${matches}" >&2
  exit 1
fi

expected_defaults=(
  "installer/docker/.env.example|${CANONICAL_NAMESPACE}/braindrive-app"
  "installer/docker/.env.example|${CANONICAL_NAMESPACE}/braindrive-edge"
  "installer/docker/compose.local.yml|${CANONICAL_NAMESPACE}/braindrive-app"
  "installer/docker/compose.local.yml|${CANONICAL_NAMESPACE}/braindrive-edge"
  "installer/docker/compose.prod.yml|${CANONICAL_NAMESPACE}/braindrive-app"
  "installer/docker/compose.prod.yml|${CANONICAL_NAMESPACE}/braindrive-edge"
  "installer/docker/scripts/build-release-images.sh|${CANONICAL_NAMESPACE}"
  "installer/docker/scripts/build-release-images.ps1|${CANONICAL_NAMESPACE}"
  "installer/docker/scripts/publish-release-images.sh|${CANONICAL_NAMESPACE}"
  "installer/docker/scripts/publish-release-images.ps1|${CANONICAL_NAMESPACE}"
  "installer/docker/scripts/release-production.sh|${CANONICAL_NAMESPACE}/braindrive-app"
  "installer/docker/scripts/release-production.sh|${CANONICAL_NAMESPACE}/braindrive-edge"
)

for expected_default in "${expected_defaults[@]}"; do
  file_path="${expected_default%%|*}"
  expected_value="${expected_default#*|}"
  if ! grep -Fq "${expected_value}" "${file_path}"; then
    echo "${file_path} does not use the canonical GHCR namespace." >&2
    exit 1
  fi
done

echo "Canonical GHCR namespace checks passed."
