#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

FAKE_BIN="${TEMP_ROOT}/bin"
INSTALL_BIN="${TEMP_ROOT}/installed"
mkdir -p "${FAKE_BIN}" "${INSTALL_BIN}"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'output=""' \
  'while (($#)); do' \
  '  case "$1" in' \
  '    -o) output="$2"; shift 2 ;;' \
  '    *) shift ;;' \
  '  esac' \
  'done' \
  'printf "%s\n" "tampered-cosign-binary" > "${output}"' \
  > "${FAKE_BIN}/curl"
chmod +x "${FAKE_BIN}/curl"

if (
  PATH="${FAKE_BIN}:/usr/bin:/bin"
  HOME="${TEMP_ROOT}/home"
  ROOT_DIR="${TEMP_ROOT}"
  BRAINDRIVE_AUTO_INSTALL_COSIGN=true
  BRAINDRIVE_COSIGN_VERSION=v3.0.6
  BRAINDRIVE_COSIGN_BIN_DIR="${INSTALL_BIN}"
  get_env_value() {
    echo ""
  }
  source "${DOCKER_ROOT}/scripts/release-resolution.sh"
  ensure_cosign
) >"${TEMP_ROOT}/cosign-install-output.txt" 2>&1; then
  echo "Cosign auto-install accepted a binary with a mismatched SHA-256." >&2
  exit 1
fi

if [[ -e "${INSTALL_BIN}/cosign" ]]; then
  echo "Cosign auto-install retained an unverified binary." >&2
  exit 1
fi

for integrity_helper in release-trust.sh release-trust.ps1; do
  if ! grep -Fq 'v3.0.6' "${DOCKER_ROOT}/scripts/${integrity_helper}"; then
    echo "${integrity_helper} does not pin the cosign auto-install version." >&2
    exit 1
  fi
done

echo "Cosign auto-install integrity checks passed."
