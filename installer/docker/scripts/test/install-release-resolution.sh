#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

TEST_DOCKER_ROOT="${TEMP_ROOT}/docker"
FAKE_BIN="${TEMP_ROOT}/bin"
FIXTURES="${TEMP_ROOT}/fixtures"
DOCKER_LOG="${TEMP_ROOT}/docker.log"
COSIGN_LOG="${TEMP_ROOT}/cosign.log"
EXPECTED_APP_REF="ghcr.io/braindriveai/braindrive-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
EXPECTED_EDGE_REF="ghcr.io/braindriveai/braindrive-edge@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

mkdir -p "${TEST_DOCKER_ROOT}/scripts" "${FAKE_BIN}" "${FIXTURES}"

cp "${DOCKER_ROOT}/.env.example" "${TEST_DOCKER_ROOT}/.env.example"
cp "${DOCKER_ROOT}/compose.local.yml" "${TEST_DOCKER_ROOT}/compose.local.yml"
cp "${DOCKER_ROOT}/scripts/install.sh" "${TEST_DOCKER_ROOT}/scripts/install.sh"
cp "${DOCKER_ROOT}/scripts/upgrade.sh" "${TEST_DOCKER_ROOT}/scripts/upgrade.sh"
cp "${DOCKER_ROOT}/scripts/browser-helper.sh" "${TEST_DOCKER_ROOT}/scripts/browser-helper.sh"
cp "${DOCKER_ROOT}/scripts/auth-bootstrap.sh" "${TEST_DOCKER_ROOT}/scripts/auth-bootstrap.sh"
cp "${DOCKER_ROOT}/scripts/fetch-release-metadata.sh" "${TEST_DOCKER_ROOT}/scripts/fetch-release-metadata.sh"
cp "${DOCKER_ROOT}/scripts/release-resolution.sh" "${TEST_DOCKER_ROOT}/scripts/release-resolution.sh"
cp "${DOCKER_ROOT}/scripts/release-trust.sh" "${TEST_DOCKER_ROOT}/scripts/release-trust.sh"

awk '
  /^BRAINDRIVE_RELEASE_MANIFEST_URL=/ {
    print "BRAINDRIVE_RELEASE_MANIFEST_URL=https://release.test/releases.json"
    next
  }
  /^BRAINDRIVE_RELEASE_MANIFEST_SIG_URL=/ {
    print "BRAINDRIVE_RELEASE_MANIFEST_SIG_URL=https://release.test/releases.json.sig"
    next
  }
  /^BRAINDRIVE_RELEASE_PUBLIC_KEY_URL=/ {
    print "BRAINDRIVE_RELEASE_PUBLIC_KEY_URL=https://release.test/cosign.pub"
    next
  }
  { print }
' "${TEST_DOCKER_ROOT}/.env.example" > "${TEST_DOCKER_ROOT}/.env.example.updated"
mv "${TEST_DOCKER_ROOT}/.env.example.updated" "${TEST_DOCKER_ROOT}/.env.example"

printf '%s\n' \
  '{' \
  '  "manifest_version": 1,' \
  '  "channels": { "stable": "v-test" },' \
  '  "releases": {' \
  "    \"v-test\": {" \
  "      \"app_image_digest\": \"${EXPECTED_APP_REF}\"," \
  "      \"edge_image_digest\": \"${EXPECTED_EDGE_REF}\"" \
  '    }' \
  '  }' \
  '}' > "${FIXTURES}/releases.json"
printf '%s\n' 'test-signature' > "${FIXTURES}/releases.json.sig"
printf '%s\n' \
  '-----BEGIN PUBLIC KEY-----' \
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhJpakKTINeJSF/o4v5ExNEyDvYBL' \
  '5aNuYIaV8RhQOXvXBMNNhg8BvnAH/Vd5d6hkA29ishxCHudrmCwiGlHbJg==' \
  '-----END PUBLIC KEY-----' \
  > "${FIXTURES}/cosign.pub"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'url=""' \
  'output=""' \
  'while (($#)); do' \
  '  case "$1" in' \
  '    -o)' \
  '      output="$2"' \
  '      shift 2' \
  '      ;;' \
  '    -*) shift ;;' \
  '    *) url="$1"; shift ;;' \
  '  esac' \
  'done' \
  'cp "${TEST_RELEASE_FIXTURES}/$(basename "${url}")" "${output}"' \
  > "${FAKE_BIN}/curl"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${TEST_COSIGN_LOG}"' \
  'exit "${TEST_COSIGN_EXIT:-0}"' \
  > "${FAKE_BIN}/cosign"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${TEST_DOCKER_LOG}"' \
  'if [[ "$*" == "compose version" ]]; then' \
  '  exit 0' \
  'fi' \
  'if [[ "$*" == *" pull" ]]; then' \
  '  [[ "${BRAINDRIVE_APP_REF:-}" == "${TEST_EXPECTED_APP_REF}" ]]' \
  '  [[ "${BRAINDRIVE_EDGE_REF:-}" == "${TEST_EXPECTED_EDGE_REF}" ]]' \
  'fi' \
  'exit 0' \
  > "${FAKE_BIN}/docker"

chmod +x "${FAKE_BIN}/curl" "${FAKE_BIN}/cosign" "${FAKE_BIN}/docker"

OUTPUT_FILE="${TEMP_ROOT}/install-output.txt"
(
  cd "${TEST_DOCKER_ROOT}"
  PATH="${FAKE_BIN}:${PATH}" \
    DISPLAY="" \
    WAYLAND_DISPLAY="" \
    WSL_DISTRO_NAME="" \
    TEST_RELEASE_FIXTURES="${FIXTURES}" \
    TEST_COSIGN_LOG="${COSIGN_LOG}" \
    TEST_DOCKER_LOG="${DOCKER_LOG}" \
    TEST_EXPECTED_APP_REF="${EXPECTED_APP_REF}" \
    TEST_EXPECTED_EDGE_REF="${EXPECTED_EDGE_REF}" \
    bash scripts/install.sh local > "${OUTPUT_FILE}" 2>&1
)

if ! grep -Fq 'verify-blob' "${COSIGN_LOG}"; then
  echo "First install did not verify the release manifest with cosign." >&2
  exit 1
fi

if ! grep -Fq 'compose -f compose.local.yml pull' "${DOCKER_LOG}"; then
  echo "First install did not pull the release images." >&2
  exit 1
fi

if ! grep -Fq 'Resolved release refs from manifest (v-test)' "${OUTPUT_FILE}"; then
  echo "First install did not resolve image refs from the signed release manifest." >&2
  exit 1
fi

ENV_MODE="$(stat -c '%a' "${TEST_DOCKER_ROOT}/.env" 2>/dev/null || stat -f '%Lp' "${TEST_DOCKER_ROOT}/.env")"
if [[ "${ENV_MODE}" != "600" ]]; then
  echo "First install left .env with permissions ${ENV_MODE}; expected 600." >&2
  exit 1
fi

: > "${DOCKER_LOG}"
: > "${COSIGN_LOG}"
(
  cd "${TEST_DOCKER_ROOT}"
  PATH="${FAKE_BIN}:${PATH}" \
    DISPLAY="" \
    WAYLAND_DISPLAY="" \
    WSL_DISTRO_NAME="" \
    TEST_RELEASE_FIXTURES="${FIXTURES}" \
    TEST_COSIGN_LOG="${COSIGN_LOG}" \
    TEST_DOCKER_LOG="${DOCKER_LOG}" \
    TEST_EXPECTED_APP_REF="${EXPECTED_APP_REF}" \
    TEST_EXPECTED_EDGE_REF="${EXPECTED_EDGE_REF}" \
    bash scripts/upgrade.sh local > "${OUTPUT_FILE}" 2>&1
)

if ! grep -Fq 'verify-blob' "${COSIGN_LOG}" || ! grep -Fq 'compose -f compose.local.yml pull' "${DOCKER_LOG}"; then
  echo "Upgrade did not use the shared signed release-resolution path." >&2
  exit 1
fi

rm -f "${TEST_DOCKER_ROOT}/.env"
rm -rf "${TEST_DOCKER_ROOT}/release-cache"
: > "${DOCKER_LOG}"
: > "${COSIGN_LOG}"
cp "${FIXTURES}/cosign.pub" "${FIXTURES}/cosign.pub.trusted"
printf '%s\n' 'tampered-public-key' > "${FIXTURES}/cosign.pub"

if (
  cd "${TEST_DOCKER_ROOT}"
  PATH="${FAKE_BIN}:${PATH}" \
    DISPLAY="" \
    WAYLAND_DISPLAY="" \
    WSL_DISTRO_NAME="" \
    TEST_RELEASE_FIXTURES="${FIXTURES}" \
    TEST_COSIGN_LOG="${COSIGN_LOG}" \
    TEST_DOCKER_LOG="${DOCKER_LOG}" \
    TEST_EXPECTED_APP_REF="${EXPECTED_APP_REF}" \
    TEST_EXPECTED_EDGE_REF="${EXPECTED_EDGE_REF}" \
    bash scripts/install.sh local > "${OUTPUT_FILE}" 2>&1
); then
  echo "First install accepted a release public key with the wrong fingerprint." >&2
  exit 1
fi

if [[ -s "${COSIGN_LOG}" ]] || grep -Fq ' pull' "${DOCKER_LOG}"; then
  echo "First install used untrusted release metadata after key verification failed." >&2
  exit 1
fi

mv "${FIXTURES}/cosign.pub.trusted" "${FIXTURES}/cosign.pub"
rm -f "${TEST_DOCKER_ROOT}/.env"
rm -rf "${TEST_DOCKER_ROOT}/release-cache"
: > "${DOCKER_LOG}"
: > "${COSIGN_LOG}"

if (
  cd "${TEST_DOCKER_ROOT}"
  PATH="${FAKE_BIN}:${PATH}" \
    DISPLAY="" \
    WAYLAND_DISPLAY="" \
    WSL_DISTRO_NAME="" \
    TEST_RELEASE_FIXTURES="${FIXTURES}" \
    TEST_COSIGN_LOG="${COSIGN_LOG}" \
    TEST_COSIGN_EXIT=1 \
    TEST_DOCKER_LOG="${DOCKER_LOG}" \
    TEST_EXPECTED_APP_REF="${EXPECTED_APP_REF}" \
    TEST_EXPECTED_EDGE_REF="${EXPECTED_EDGE_REF}" \
    bash scripts/install.sh local > "${OUTPUT_FILE}" 2>&1
); then
  echo "First install continued after release-manifest verification failed." >&2
  exit 1
fi

if grep -Fq ' pull' "${DOCKER_LOG}"; then
  echo "First install pulled images after release-manifest verification failed." >&2
  exit 1
fi

for lifecycle_script in install.sh upgrade.sh; do
  if ! grep -Fq 'source "${SCRIPT_DIR}/release-resolution.sh"' "${DOCKER_ROOT}/scripts/${lifecycle_script}"; then
    echo "${lifecycle_script} does not load shared release resolution." >&2
    exit 1
  fi
done

for lifecycle_script in install.ps1 upgrade.ps1; do
  if ! grep -Fq '. "$scriptDir/release-resolution.ps1"' "${DOCKER_ROOT}/scripts/${lifecycle_script}"; then
    echo "${lifecycle_script} does not load shared release resolution." >&2
    exit 1
  fi
done

echo "First-install release resolution checks passed."
