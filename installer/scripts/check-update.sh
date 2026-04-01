#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -eq 0 ]]; then
  set -- quickstart
fi
exec bash "${SCRIPT_DIR}/../docker/scripts/check-update.sh" "$@"
