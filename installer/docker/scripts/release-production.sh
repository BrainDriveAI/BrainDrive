#!/usr/bin/env bash
set -euo pipefail

# Cosign passphrase note:
# - If COSIGN_KEY_PATH points to an encrypted key, cosign will prompt for the
#   passphrase during signing in interactive shells.
# - For unattended/non-interactive runs, set COSIGN_PASSWORD in the
#   environment before invoking this script.

usage() {
  cat <<'EOF'
Usage: ./installer/docker/scripts/release-production.sh [options]

Automates the Monday production release runbook:
1. Preflight checks and optional git sync/docker login
2. Bump package versions
3. Build and publish images
4. Move latest tags
5. Generate/sign/verify release manifest
6. Print GitHub Release publishing checklist

Options:
  --package-version <yy.m.d>   Release version (default: today's local date, e.g. 26.4.16)
  --image-tag <tag>            Image/GitHub tag (default: v<package-version>)
  --channel <name>             Release channel for manifest (default: stable)
  --app-image <image>          App image repo (default: ghcr.io/braindriveai/braindrive-app)
  --edge-image <image>         Edge image repo (default: ghcr.io/braindriveai/braindrive-edge)
  --cosign-key-path <path>     Cosign private key path (default: <repo>/cosign.key)
  --skip-git-sync              Skip 'git checkout main' and 'git pull --ff-only'
  --skip-docker-login          Skip 'docker login ghcr.io'
  --skip-latest-tag            Skip retagging and pushing :latest
  --help                       Show this help
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Required command not found: ${cmd}" >&2
    exit 1
  fi
}

log_step() {
  local label="$1"
  echo
  echo "=== ${label} ==="
}

default_package_version() {
  local year month day
  year="$(date +%y)"
  month="$(date +%m)"
  day="$(date +%d)"
  month="${month#0}"
  day="${day#0}"
  echo "${year}.${month}.${day}"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"

PACKAGE_VERSION="${PACKAGE_VERSION:-$(default_package_version)}"
IMAGE_TAG="${IMAGE_TAG:-}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-stable}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/braindriveai/braindrive-app}"
EDGE_IMAGE="${EDGE_IMAGE:-ghcr.io/braindriveai/braindrive-edge}"
COSIGN_KEY_PATH="${COSIGN_KEY_PATH:-${REPO_ROOT}/cosign.key}"
COSIGN_PUB_PATH="${COSIGN_PUB_PATH:-${REPO_ROOT}/cosign.pub}"
MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/releases.json}"
MANIFEST_SIG_PATH="${MANIFEST_SIG_PATH:-${REPO_ROOT}/releases.json.sig}"
SKIP_GIT_SYNC="false"
SKIP_DOCKER_LOGIN="false"
SKIP_LATEST_TAG="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-version)
      PACKAGE_VERSION="${2:-}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --channel)
      RELEASE_CHANNEL="${2:-}"
      shift 2
      ;;
    --app-image)
      APP_IMAGE="${2:-}"
      shift 2
      ;;
    --edge-image)
      EDGE_IMAGE="${2:-}"
      shift 2
      ;;
    --cosign-key-path)
      COSIGN_KEY_PATH="${2:-}"
      shift 2
      ;;
    --skip-git-sync)
      SKIP_GIT_SYNC="true"
      shift
      ;;
    --skip-docker-login)
      SKIP_DOCKER_LOGIN="true"
      shift
      ;;
    --skip-latest-tag)
      SKIP_LATEST_TAG="true"
      shift
      ;;
    --help|-h)
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

if [[ -z "${IMAGE_TAG}" ]]; then
  IMAGE_TAG="v${PACKAGE_VERSION}"
fi

if [[ "${IMAGE_TAG}" != "v${PACKAGE_VERSION}" ]]; then
  echo "Versioning rule violation: IMAGE_TAG must be exactly v${PACKAGE_VERSION}" >&2
  exit 1
fi

if [[ ! "${PACKAGE_VERSION}" =~ ^[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}$ ]]; then
  echo "PACKAGE_VERSION must look like YY.M.D (example: 26.4.16): ${PACKAGE_VERSION}" >&2
  exit 1
fi

cd "${REPO_ROOT}"

log_step "Release Inputs"
echo "REPO_ROOT=${REPO_ROOT}"
echo "PACKAGE_VERSION=${PACKAGE_VERSION}"
echo "IMAGE_TAG=${IMAGE_TAG}"
echo "RELEASE_CHANNEL=${RELEASE_CHANNEL}"
echo "APP_IMAGE=${APP_IMAGE}"
echo "EDGE_IMAGE=${EDGE_IMAGE}"
echo "COSIGN_KEY_PATH=${COSIGN_KEY_PATH}"

log_step "1. Preflight (maintainer machine)"
require_cmd git
require_cmd docker
require_cmd npm
require_cmd node
require_cmd cosign
require_cmd awk

if [[ "${SKIP_GIT_SYNC}" != "true" ]]; then
  git checkout main
  git pull --ff-only origin main
else
  echo "Skipping git sync."
fi

if [[ "${SKIP_DOCKER_LOGIN}" != "true" ]]; then
  docker login ghcr.io
else
  echo "Skipping docker login."
fi

log_step "2. Set release variables"
export PACKAGE_VERSION IMAGE_TAG APP_IMAGE EDGE_IMAGE COSIGN_KEY_PATH

log_step "3. Bump package versions"
npm --prefix builds/typescript version "${PACKAGE_VERSION}" --no-git-tag-version
npm --prefix builds/typescript/client_web version "${PACKAGE_VERSION}" --no-git-tag-version

CORE_VERSION="$(node -p 'require("./builds/typescript/package.json").version')"
WEB_VERSION="$(node -p 'require("./builds/typescript/client_web/package.json").version')"
echo "builds/typescript/package.json version=${CORE_VERSION}"
echo "builds/typescript/client_web/package.json version=${WEB_VERSION}"
if [[ "${CORE_VERSION}" != "${PACKAGE_VERSION}" || "${WEB_VERSION}" != "${PACKAGE_VERSION}" ]]; then
  echo "Version bump mismatch. Stop release." >&2
  exit 1
fi

log_step "4. Build and publish images"
APP_IMAGE="${APP_IMAGE}" EDGE_IMAGE="${EDGE_IMAGE}" \
  bash ./installer/docker/scripts/build-release-images.sh "${IMAGE_TAG}"

PUBLISH_OUT="$(
  APP_IMAGE="${APP_IMAGE}" EDGE_IMAGE="${EDGE_IMAGE}" \
    bash ./installer/docker/scripts/publish-release-images.sh "${IMAGE_TAG}"
)"
echo "${PUBLISH_OUT}"

APP_REF="$(echo "${PUBLISH_OUT}" | awk -F= '/^APP_REF=/{print $2}' | tail -n 1)"
EDGE_REF="$(echo "${PUBLISH_OUT}" | awk -F= '/^EDGE_REF=/{print $2}' | tail -n 1)"
echo "APP_REF=${APP_REF}"
echo "EDGE_REF=${EDGE_REF}"

if [[ -z "${APP_REF}" || -z "${EDGE_REF}" ]]; then
  echo "Publish failed: APP_REF or EDGE_REF is empty. Stop release." >&2
  exit 1
fi

log_step "5. Move latest tags"
if [[ "${SKIP_LATEST_TAG}" != "true" ]]; then
  docker tag "${APP_IMAGE}:${IMAGE_TAG}" "${APP_IMAGE}:latest"
  docker tag "${EDGE_IMAGE}:${IMAGE_TAG}" "${EDGE_IMAGE}:latest"
  docker push "${APP_IMAGE}:latest"
  docker push "${EDGE_IMAGE}:latest"
else
  echo "Skipping latest tag move."
fi

log_step "6. Generate, sign, and verify release manifest"
if [[ ! -f "${COSIGN_KEY_PATH}" ]]; then
  echo "Cosign private key not found: ${COSIGN_KEY_PATH}" >&2
  exit 1
fi

if [[ ! -f "${COSIGN_PUB_PATH}" ]]; then
  cosign public-key --key "${COSIGN_KEY_PATH}" > "${COSIGN_PUB_PATH}"
  echo "Generated ${COSIGN_PUB_PATH}"
fi

bash ./installer/docker/scripts/generate-release-manifest.sh \
  "${PACKAGE_VERSION}" \
  "${APP_REF}" \
  "${EDGE_REF}" \
  "${RELEASE_CHANNEL}" \
  "${MANIFEST_PATH}"

bash ./installer/docker/scripts/sign-release-manifest.sh \
  "${MANIFEST_PATH}" \
  "${MANIFEST_SIG_PATH}"

bash ./installer/docker/scripts/verify-release-manifest.sh \
  "${MANIFEST_PATH}" \
  "${MANIFEST_SIG_PATH}" \
  "${COSIGN_PUB_PATH}"

node -e '
const fs = require("fs");
const pkgVersion = process.argv[1];
const channel = process.argv[2];
const manifestPath = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest.channels || manifest.channels[channel] !== pkgVersion) {
  console.error(`Manifest channel mismatch: channels.${channel} must equal ${pkgVersion}`);
  process.exit(1);
}
if (!manifest.releases || !manifest.releases[pkgVersion]) {
  console.error(`Manifest releases missing key: ${pkgVersion}`);
  process.exit(1);
}
' "${PACKAGE_VERSION}" "${RELEASE_CHANNEL}" "${MANIFEST_PATH}"

log_step "7. Publish GitHub Release assets (manual)"
echo "Create release tag: ${IMAGE_TAG}"
echo "Upload assets:"
echo "  1. releases.json"
echo "  2. releases.json.sig"
echo "  3. cosign.pub"
echo "URL:"
echo "  https://github.com/BrainDriveAI/BrainDrive/releases/new"

echo
echo "Release prep complete."
