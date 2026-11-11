#!/usr/bin/env bash
set -euo pipefail

MODE="${BRAINDRIVE_INSTALL_MODE:-local}"
DATA_POLICY=""
CONFIRM="false"

usage() {
  echo "Usage: ./scripts/uninstall.sh [local|prod|dev] [--keep-data|--remove-data] [--yes]"
}

if [[ "${1:-}" == "local" || "${1:-}" == "prod" || "${1:-}" == "dev" ]]; then
  MODE="$1"
  shift
fi

while (($#)); do
  case "$1" in
    --keep-data)
      [[ -z "$DATA_POLICY" || "$DATA_POLICY" == "keep" ]] || { usage >&2; exit 2; }
      DATA_POLICY="keep"
      ;;
    --remove-data)
      [[ -z "$DATA_POLICY" || "$DATA_POLICY" == "remove" ]] || { usage >&2; exit 2; }
      DATA_POLICY="remove"
      ;;
    --yes)
      CONFIRM="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$MODE" != "prod" && "$MODE" != "local" && "$MODE" != "dev" ]]; then
  usage >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/preserved-env.sh"

COMPOSE_FILE="compose.local.yml"
if [[ "$MODE" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
elif [[ "$MODE" == "dev" ]]; then
  COMPOSE_FILE="compose.dev.yml"
fi

if [[ -z "$DATA_POLICY" ]]; then
  echo "Keep BrainDrive memory, secrets, and settings for a later install? [Y/n]"
  read -r choice
  case "${choice,,}" in
    ""|y|yes) DATA_POLICY="keep" ;;
    n|no) DATA_POLICY="remove" ;;
    *) echo "Choose yes or no." >&2; exit 2 ;;
  esac
fi

echo "This will remove BrainDrive containers, images, and the installer folder: ${ROOT_DIR}"
if [[ "$DATA_POLICY" == "keep" ]]; then
  echo "Memory, secrets, and settings volumes will be kept. Installer settings will be saved for a later install."
else
  echo "Memory, secrets, settings, and the saved installer settings will be removed."
fi

if [[ "$CONFIRM" != "true" ]]; then
  echo "Type UNINSTALL to continue:"
  read -r confirmation
  [[ "$confirmation" == "UNINSTALL" ]] || { echo "Uninstall cancelled."; exit 1; }
fi

command -v docker >/dev/null 2>&1 || { echo "Docker is required to uninstall this installation." >&2; exit 1; }
if [[ "$DATA_POLICY" == "keep" ]]; then
  braindrive_preserve_env "${ROOT_DIR}/.env"
fi

down_args=(compose -f "$COMPOSE_FILE" down --remove-orphans --rmi all)
if [[ "$DATA_POLICY" == "remove" ]]; then
  down_args+=(--volumes)
fi
docker "${down_args[@]}"

if [[ "$DATA_POLICY" == "remove" ]]; then
  braindrive_forget_env
fi

cd "${ROOT_DIR}/.."
rm -rf -- "$ROOT_DIR"
echo "BrainDrive ${MODE} installation removed."
