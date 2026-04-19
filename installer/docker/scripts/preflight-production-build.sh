#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./installer/docker/scripts/preflight-production-build.sh [options]

Validates Monday production release readiness by checking:
1. Node dependencies and TypeScript builds (app + web client)
2. Optional production Docker image builds (app + edge)

Options:
  --app-image <name>         App test image repo/name (default: braindrive-preflight-app)
  --edge-image <name>        Edge test image repo/name (default: braindrive-preflight-edge)
  --image-tag <tag>          Test image tag (default: preflight-<UTC timestamp>)
  --skip-npm-install         Skip npm ci and use current node_modules
  --skip-docker-build        Skip Docker image builds (run Node/TypeScript checks only)
  --help                     Show this help
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"

APP_IMAGE="${APP_IMAGE:-braindrive-preflight-app}"
EDGE_IMAGE="${EDGE_IMAGE:-braindrive-preflight-edge}"
IMAGE_TAG="${IMAGE_TAG:-preflight-$(date -u +%Y%m%d%H%M%S)}"
SKIP_NPM_INSTALL="false"
SKIP_DOCKER_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-image)
      APP_IMAGE="${2:-}"
      shift 2
      ;;
    --edge-image)
      EDGE_IMAGE="${2:-}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --skip-npm-install)
      SKIP_NPM_INSTALL="true"
      shift
      ;;
    --skip-docker-build)
      SKIP_DOCKER_BUILD="true"
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

if [[ -z "${APP_IMAGE}" || -z "${EDGE_IMAGE}" || -z "${IMAGE_TAG}" ]]; then
  echo "app-image, edge-image, and image-tag cannot be empty." >&2
  exit 1
fi

cd "${REPO_ROOT}"

log_step "Preflight Inputs"
echo "REPO_ROOT=${REPO_ROOT}"
echo "APP_IMAGE=${APP_IMAGE}"
echo "EDGE_IMAGE=${EDGE_IMAGE}"
echo "IMAGE_TAG=${IMAGE_TAG}"
echo "SKIP_NPM_INSTALL=${SKIP_NPM_INSTALL}"
echo "SKIP_DOCKER_BUILD=${SKIP_DOCKER_BUILD}"

require_cmd git
require_cmd npm
require_cmd node

if [[ "${SKIP_DOCKER_BUILD}" != "true" ]]; then
  require_cmd docker
fi

CURRENT_BRANCH="$(git branch --show-current || true)"
CURRENT_COMMIT="$(git rev-parse --short=12 HEAD)"
echo "Branch=${CURRENT_BRANCH:-detached} Commit=${CURRENT_COMMIT}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Warning: working tree has local changes. Release builds are safer from a clean tree."
fi

log_step "1. Install Node Dependencies"
if [[ "${SKIP_NPM_INSTALL}" == "true" ]]; then
  echo "Skipping npm ci."
else
  npm --prefix builds/typescript ci --no-audit --no-fund
  npm --prefix builds/typescript/client_web ci --no-audit --no-fund
fi

log_step "2. Validate TypeScript App Build"
npm --prefix builds/typescript run build

log_step "3. Validate TypeScript Web Build"
npm --prefix builds/typescript/client_web run typecheck
npm --prefix builds/typescript/client_web run build

if [[ "${SKIP_DOCKER_BUILD}" == "true" ]]; then
  log_step "4. Docker Builds"
  echo "Skipping Docker image builds."
else
  log_step "4. Validate Docker Production Image Builds"
  docker build -f installer/docker/Dockerfile.app -t "${APP_IMAGE}:${IMAGE_TAG}" .
  docker build -f installer/docker/Dockerfile.edge -t "${EDGE_IMAGE}:${IMAGE_TAG}" .
fi

echo
echo "Preflight production build checks passed."
echo "Recommended next step:"
echo "  ./installer/docker/scripts/release-production.sh"
