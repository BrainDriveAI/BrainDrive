#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash ./installer/docker/scripts/release-production.sh [options]

Prepares a production release from one clean, immutable, already-normalized
candidate. Version normalization is a separate non-publishing mutation step;
commit and review it before running publication.

Options:
  --package-version <yy.m.d[.n]> Release version (default: today's local date)
  --image-tag <tag>              Image/GitHub tag; must equal package version
  --channel <name>               Manifest channel (default: stable)
  --app-image <image>            App image repository
  --edge-image <image>           Edge image repository
  --cosign-key-path <path>       Authorized Cosign private key path
  --normalize-only               Update app, web, locks, Tauri, and bootstrap markers; then stop
  --dry-run                      Validate the clean candidate and print the ordered plan; no external mutation
  --skip-prebuild-check          Skip the TypeScript preflight (restricted exception)
  --skip-git-sync                Do not checkout/pull main
  --skip-docker-login            Use an existing authorized registry session
  --skip-latest-tag              Do not move mutable latest tags
  --help                         Show this help
EOF
}

require_cmd() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
}

log_step() {
  echo
  echo "=== $1 ==="
}

default_package_version() {
  local year month day
  year="$(date +%y)"
  month="$(date +%m)"
  day="$(date +%d)"
  echo "${year}.${month#0}.${day#0}"
}

assert_clean_candidate() {
  if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
    echo "Release operation requires a clean candidate; tracked and untracked changes are present." >&2
    exit 1
  fi
}

assert_candidate_unchanged() {
  assert_clean_candidate
  local current_revision
  current_revision="$(git rev-parse HEAD)"
  if [[ "${current_revision}" != "${CANDIDATE_REVISION}" ]]; then
    echo "Candidate revision changed from ${CANDIDATE_REVISION} to ${current_revision}; stop release." >&2
    exit 1
  fi
}

normalize_bootstrap_markers() {
  node - "${PACKAGE_VERSION}" <<'NODE'
const fs = require("fs");
const version = process.argv[2];
const targets = [
  ["installer/bootstrap/install.sh", /BOOTSTRAP_RELEASE_TAG_DEFAULT="[^"]+"/, `BOOTSTRAP_RELEASE_TAG_DEFAULT="${version}"`],
  ["installer/bootstrap/update.sh", /BOOTSTRAP_RELEASE_TAG_DEFAULT="[^"]+"/, `BOOTSTRAP_RELEASE_TAG_DEFAULT="${version}"`],
  ["installer/bootstrap/install.ps1", /\$bootstrapReleaseTagDefault = "[^"]+"/, `$bootstrapReleaseTagDefault = "${version}"`],
  ["installer/bootstrap/update.ps1", /\$bootstrapReleaseTagDefault = "[^"]+"/, `$bootstrapReleaseTagDefault = "${version}"`],
];
for (const [file, pattern, replacement] of targets) {
  const before = fs.readFileSync(file, "utf8");
  if (!pattern.test(before)) throw new Error(`Bootstrap release marker missing: ${file}`);
  fs.writeFileSync(file, before.replace(pattern, replacement));
}
NODE
}

check_bootstrap_markers() {
  node - "${PACKAGE_VERSION}" <<'NODE'
const fs = require("fs");
const version = process.argv[2];
const targets = [
  ["installer/bootstrap/install.sh", `BOOTSTRAP_RELEASE_TAG_DEFAULT="${version}"`],
  ["installer/bootstrap/update.sh", `BOOTSTRAP_RELEASE_TAG_DEFAULT="${version}"`],
  ["installer/bootstrap/install.ps1", `$bootstrapReleaseTagDefault = "${version}"`],
  ["installer/bootstrap/update.ps1", `$bootstrapReleaseTagDefault = "${version}"`],
];
for (const [file, expected] of targets) {
  if (!fs.readFileSync(file, "utf8").includes(expected)) {
    console.error(`${file} is not normalized to ${version}`);
    process.exitCode = 1;
  }
}
NODE
}

release_failure() {
  local exit_code=$?
  echo >&2
  echo "Release stopped during: ${RELEASE_STAGE}." >&2
  echo "Failure recovery: do not move latest or create/push the Git tag. Inspect any versioned image refs already printed, preserve the clean source candidate, and resume only under the authorized release procedure." >&2
  exit "${exit_code}"
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
RELEASE_ASSET_DIR="${RELEASE_ASSET_DIR:-}"
SKIP_PREBUILD_CHECK=false
SKIP_GIT_SYNC=false
SKIP_DOCKER_LOGIN=false
SKIP_LATEST_TAG=false
NORMALIZE_ONLY=false
DRY_RUN=false
RELEASE_STAGE="argument validation"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-version) PACKAGE_VERSION="${2:-}"; shift 2 ;;
    --image-tag) IMAGE_TAG="${2:-}"; shift 2 ;;
    --channel) RELEASE_CHANNEL="${2:-}"; shift 2 ;;
    --app-image) APP_IMAGE="${2:-}"; shift 2 ;;
    --edge-image) EDGE_IMAGE="${2:-}"; shift 2 ;;
    --cosign-key-path) COSIGN_KEY_PATH="${2:-}"; shift 2 ;;
    --normalize-only) NORMALIZE_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --skip-prebuild-check) SKIP_PREBUILD_CHECK=true; shift ;;
    --skip-git-sync) SKIP_GIT_SYNC=true; shift ;;
    --skip-docker-login) SKIP_DOCKER_LOGIN=true; shift ;;
    --skip-latest-tag) SKIP_LATEST_TAG=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

IMAGE_TAG="${IMAGE_TAG:-${PACKAGE_VERSION}}"
if [[ "${IMAGE_TAG}" != "${PACKAGE_VERSION}" ]]; then
  echo "IMAGE_TAG must exactly equal PACKAGE_VERSION (${PACKAGE_VERSION})." >&2
  exit 1
fi
if [[ ! "${PACKAGE_VERSION}" =~ ^[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}(\.[0-9]+)?$ ]]; then
  echo "PACKAGE_VERSION must use YY.M.D or YY.M.D.N." >&2
  exit 1
fi
if [[ "${NORMALIZE_ONLY}" == true && "${DRY_RUN}" == true ]]; then
  echo "--normalize-only and --dry-run are mutually exclusive." >&2
  exit 1
fi

cd "${REPO_ROOT}"
require_cmd git
require_cmd node

if [[ "${NORMALIZE_ONLY}" == true ]]; then
  log_step "Normalize release source"
  assert_clean_candidate
  node installer/docker/scripts/normalize-release-version.mjs --write "${PACKAGE_VERSION}"
  normalize_bootstrap_markers
  echo "Normalization complete. Review and commit these source changes, then rerun the release helper from that clean immutable commit."
  exit 0
fi

log_step "Candidate selection"
assert_clean_candidate
if [[ "${SKIP_GIT_SYNC}" != true ]]; then
  git checkout main
  git pull --ff-only origin main
fi
assert_clean_candidate
CANDIDATE_REVISION="$(git rev-parse HEAD)"
export CANDIDATE_REVISION PACKAGE_VERSION IMAGE_TAG APP_IMAGE EDGE_IMAGE COSIGN_KEY_PATH

node installer/docker/scripts/normalize-release-version.mjs --check "${PACKAGE_VERSION}"
check_bootstrap_markers
assert_candidate_unchanged

echo "PACKAGE_VERSION=${PACKAGE_VERSION}"
echo "IMAGE_TAG=${IMAGE_TAG}"
echo "CANDIDATE_REVISION=${CANDIDATE_REVISION}"
echo "RELEASE_CHANNEL=${RELEASE_CHANNEL}"

if [[ "${DRY_RUN}" == true ]]; then
  cat <<'EOF'
Ordered release plan:
1. Run candidate preflight without changing tracked source.
2. Build and publish immutable versioned images.
3. Generate, sign, and verify the release manifest.
4. Archive installer/docker from CANDIDATE_REVISION and checksum all assets.
5. Move mutable latest image tags only after signature and asset verification.
6. Create the Git tag at CANDIDATE_REVISION and publish the verified assets manually.
Dry run complete; no Git checkout, pull, login, build, push, sign, tag, or publication occurred.
EOF
  exit 0
fi

require_cmd docker
require_cmd npm
require_cmd cosign
require_cmd awk
require_cmd gzip
trap release_failure ERR

RELEASE_STAGE="registry authentication"
if [[ "${SKIP_DOCKER_LOGIN}" != true ]]; then
  docker login ghcr.io
fi

RELEASE_STAGE="candidate preflight"
assert_candidate_unchanged
if [[ "${SKIP_PREBUILD_CHECK}" != true ]]; then
  bash ./installer/docker/scripts/preflight-production-build.sh --skip-docker-build
fi

RELEASE_STAGE="versioned image build and publication"
assert_candidate_unchanged
bash ./installer/docker/scripts/build-release-images.sh "${IMAGE_TAG}"
PUBLISH_OUT="$(bash ./installer/docker/scripts/publish-release-images.sh "${IMAGE_TAG}")"
echo "${PUBLISH_OUT}"
APP_REF="$(echo "${PUBLISH_OUT}" | awk -F= '/^APP_REF=/{print $2}' | tail -n 1)"
EDGE_REF="$(echo "${PUBLISH_OUT}" | awk -F= '/^EDGE_REF=/{print $2}' | tail -n 1)"
if [[ -z "${APP_REF}" || -z "${EDGE_REF}" ]]; then
  echo "Versioned image publication did not return both immutable digest references." >&2
  exit 1
fi

RELEASE_ASSET_DIR="${RELEASE_ASSET_DIR:-${REPO_ROOT}/dist/release/${IMAGE_TAG}}"
MANIFEST_PATH="${MANIFEST_PATH:-${RELEASE_ASSET_DIR}/releases.json}"
MANIFEST_SIG_PATH="${MANIFEST_SIG_PATH:-${RELEASE_ASSET_DIR}/releases.json.sig}"
mkdir -p "${RELEASE_ASSET_DIR}"

RELEASE_STAGE="manifest generation, signing, and verification"
bash ./installer/docker/scripts/generate-release-manifest.sh \
  "${PACKAGE_VERSION}" "${APP_REF}" "${EDGE_REF}" "${RELEASE_CHANNEL}" "${MANIFEST_PATH}"
bash ./installer/docker/scripts/sign-release-manifest.sh "${MANIFEST_PATH}" "${MANIFEST_SIG_PATH}"
bash ./installer/docker/scripts/verify-release-manifest.sh \
  "${MANIFEST_PATH}" "${MANIFEST_SIG_PATH}" "${COSIGN_PUB_PATH}"

RELEASE_STAGE="candidate archive and checksums"
INSTALLER_ARCHIVE_NAME="braindrive-installer-${IMAGE_TAG}.tar.gz"
INSTALLER_ARCHIVE_PATH="${RELEASE_ASSET_DIR}/${INSTALLER_ARCHIVE_NAME}"
SHA256SUMS_PATH="${RELEASE_ASSET_DIR}/SHA256SUMS"
git archive \
  --format=tar \
  --prefix="braindrive-installer-${IMAGE_TAG}/" \
  "${CANDIDATE_REVISION}" \
  installer/docker | gzip -n > "${INSTALLER_ARCHIVE_PATH}"
cp "${COSIGN_PUB_PATH}" "${RELEASE_ASSET_DIR}/cosign.pub"

sha256_for_release_asset() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

: > "${SHA256SUMS_PATH}"
for asset_name in "${INSTALLER_ARCHIVE_NAME}" releases.json releases.json.sig cosign.pub; do
  printf '%s  %s\n' \
    "$(sha256_for_release_asset "${RELEASE_ASSET_DIR}/${asset_name}")" \
    "${asset_name}" >> "${SHA256SUMS_PATH}"
done

RELEASE_STAGE="mutable latest image tags"
if [[ "${SKIP_LATEST_TAG}" != true ]]; then
  docker tag "${APP_IMAGE}:${IMAGE_TAG}" "${APP_IMAGE}:latest"
  docker tag "${EDGE_IMAGE}:${IMAGE_TAG}" "${EDGE_IMAGE}:latest"
  docker push "${APP_IMAGE}:latest"
  docker push "${EDGE_IMAGE}:latest"
fi

trap - ERR
log_step "Manual Git tag and GitHub publication boundary"
echo "Verified source candidate: ${CANDIDATE_REVISION}"
echo "Authorized release maintainer may now create tag ${IMAGE_TAG} at exactly ${CANDIDATE_REVISION}."
echo "Upload ${INSTALLER_ARCHIVE_NAME}, SHA256SUMS, releases.json, releases.json.sig, and cosign.pub."
echo "No Git tag or GitHub release was created by this helper."
