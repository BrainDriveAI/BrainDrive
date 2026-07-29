#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

FAKE_BIN="${TEMP_ROOT}/bin"
FIXTURES="${TEMP_ROOT}/fixtures"
SOURCE_ROOT="${TEMP_ROOT}/source/braindrive-installer-26.7.23"
INSTALL_ROOT="${TEMP_ROOT}/install"
RUN_LOG="${TEMP_ROOT}/run.log"
ARCHIVE_NAME="braindrive-installer-26.7.23.tar.gz"

mkdir -p "${FAKE_BIN}" "${FIXTURES}" "${SOURCE_ROOT}/installer/docker/scripts"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${TEST_BOOTSTRAP_RUN_LOG}"' \
  > "${SOURCE_ROOT}/installer/docker/scripts/install.sh"
chmod +x "${SOURCE_ROOT}/installer/docker/scripts/install.sh"

tar -czf "${FIXTURES}/${ARCHIVE_NAME}" -C "${TEMP_ROOT}/source" "$(basename "${SOURCE_ROOT}")"
ARCHIVE_SHA256="$(sha256sum "${FIXTURES}/${ARCHIVE_NAME}" | awk '{print $1}')"
printf '%s  %s\n' "${ARCHIVE_SHA256}" "${ARCHIVE_NAME}" > "${FIXTURES}/SHA256SUMS"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'url=""' \
  'output=""' \
  'while (($#)); do' \
  '  case "$1" in' \
  '    -o) output="$2"; shift 2 ;;' \
  '    -*) shift ;;' \
  '    *) url="$1"; shift ;;' \
  '  esac' \
  'done' \
  'cp "${TEST_BOOTSTRAP_FIXTURES}/$(basename "${url}")" "${output}"' \
  > "${FAKE_BIN}/curl"
chmod +x "${FAKE_BIN}/curl"

run_bootstrap() {
  PATH="${FAKE_BIN}:${PATH}" \
    BRAINDRIVE_BOOTSTRAP_RELEASE_TAG="26.7.23" \
    BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME="${ARCHIVE_NAME}" \
    BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL="https://release.test/${ARCHIVE_NAME}" \
    BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL="https://release.test/SHA256SUMS" \
    BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH=true \
    BRAINDRIVE_INSTALL_ROOT="${INSTALL_ROOT}" \
    TEST_BOOTSTRAP_FIXTURES="${FIXTURES}" \
    TEST_BOOTSTRAP_RUN_LOG="${RUN_LOG}" \
    bash "${BOOTSTRAP_ROOT}/install.sh" local >/dev/null 2>&1
}

run_bootstrap

if [[ ! -s "${RUN_LOG}" ]]; then
  echo "Verified bootstrap archive did not run the installer." >&2
  exit 1
fi

rm -rf "${INSTALL_ROOT}"
: > "${RUN_LOG}"
printf '%064d  %s\n' 0 "${ARCHIVE_NAME}" > "${FIXTURES}/SHA256SUMS"

if run_bootstrap; then
  echo "Bootstrap accepted an installer archive with a mismatched SHA-256." >&2
  exit 1
fi

if [[ -s "${RUN_LOG}" ]]; then
  echo "Bootstrap ran installer code after archive verification failed." >&2
  exit 1
fi

for bootstrap_script in install.sh update.sh install.ps1 update.ps1; do
  if grep -Fq 'BOOTSTRAP_REF:-main' "${BOOTSTRAP_ROOT}/${bootstrap_script}" ||
     grep -Fq 'else { "main" }' "${BOOTSTRAP_ROOT}/${bootstrap_script}"; then
    echo "${bootstrap_script} still defaults to unpinned main." >&2
    exit 1
  fi
  if ! grep -Fq 'SHA256SUMS' "${BOOTSTRAP_ROOT}/${bootstrap_script}"; then
    echo "${bootstrap_script} does not require release archive checksums." >&2
    exit 1
  fi
done

for trust_file in \
  "${BOOTSTRAP_ROOT}/install.sh" \
  "${BOOTSTRAP_ROOT}/update.sh" \
  "${BOOTSTRAP_ROOT}/install.ps1" \
  "${BOOTSTRAP_ROOT}/update.ps1" \
  "${BOOTSTRAP_ROOT}/../docker/scripts/release-trust.sh" \
  "${BOOTSTRAP_ROOT}/../docker/scripts/release-trust.ps1"; do
  for fingerprint_chunk in c92a784b e74b30f8 e754e302 5a11a7c6 9b44d620 c8f0e213 31b46e17 72b179b6; do
    if ! grep -Fq "${fingerprint_chunk}" "${trust_file}"; then
      echo "${trust_file} does not embed the reviewed release-key fingerprint." >&2
      exit 1
    fi
  done
done

RELEASE_SCRIPT="${BOOTSTRAP_ROOT}/../docker/scripts/release-production.sh"
if ! grep -Fq 'braindrive-installer-${IMAGE_TAG}.tar.gz' "${RELEASE_SCRIPT}" ||
   ! grep -Fq 'SHA256SUMS' "${RELEASE_SCRIPT}"; then
  echo "Production release flow does not build checksummed bootstrap assets." >&2
  exit 1
fi

echo "Bootstrap archive integrity checks passed."
