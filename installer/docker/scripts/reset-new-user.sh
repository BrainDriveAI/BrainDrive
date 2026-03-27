#!/usr/bin/env bash
set -euo pipefail

ASSUME_YES=0
FRESH_CLONE=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/reset-new-user.sh [--yes] [--fresh-clone]

What it resets:
  - Stops/removes local test containers and network
  - Removes local test volumes (user account + memory + secrets)

Optional:
  --fresh-clone   Also remove installer/docker/.env and local images
  --yes           Skip interactive confirmation prompt
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      ASSUME_YES=1
      shift
      ;;
    --fresh-clone)
      FRESH_CLONE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command: docker" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required (docker compose)." >&2
  exit 1
fi

LOCAL_APP_IMAGE="${BRAINDRIVE_APP_IMAGE_LOCAL:-braindrive-app:local}"
LOCAL_EDGE_IMAGE="${BRAINDRIVE_EDGE_IMAGE_LOCAL:-braindrive-edge:local}"

echo "This will reset LOCAL new-user test state by running:"
echo "  docker compose -f compose.local.yml down -v --remove-orphans"
if [[ "${FRESH_CLONE}" -eq 1 ]]; then
  echo "And also:"
  echo "  remove installer/docker/.env"
  echo "  docker rmi ${LOCAL_APP_IMAGE} ${LOCAL_EDGE_IMAGE} (best effort)"
fi

if [[ "${ASSUME_YES}" -eq 0 ]]; then
  read -r -p "Are you sure? Type RESET to continue: " confirmation
  if [[ "${confirmation}" != "RESET" ]]; then
    echo "Reset cancelled."
    exit 0
  fi
fi

docker compose -f compose.local.yml down -v --remove-orphans || true

if [[ "${FRESH_CLONE}" -eq 1 ]]; then
  rm -f .env
  docker rmi "${LOCAL_APP_IMAGE}" "${LOCAL_EDGE_IMAGE}" >/dev/null 2>&1 || true
fi

echo "Reset complete."
