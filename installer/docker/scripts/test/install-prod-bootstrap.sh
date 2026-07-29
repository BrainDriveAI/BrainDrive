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
mkdir -p "${TEST_DOCKER_ROOT}/scripts" "${FAKE_BIN}"

cp "${DOCKER_ROOT}/.env.example" "${TEST_DOCKER_ROOT}/.env.example"
cp "${DOCKER_ROOT}/compose.prod.yml" "${TEST_DOCKER_ROOT}/compose.prod.yml"
cp "${DOCKER_ROOT}/scripts/install.sh" "${TEST_DOCKER_ROOT}/scripts/install.sh"
cp "${DOCKER_ROOT}/scripts/browser-helper.sh" "${TEST_DOCKER_ROOT}/scripts/browser-helper.sh"
cp "${DOCKER_ROOT}/scripts/auth-bootstrap.sh" "${TEST_DOCKER_ROOT}/scripts/auth-bootstrap.sh"
cp "${DOCKER_ROOT}/scripts/fetch-release-metadata.sh" "${TEST_DOCKER_ROOT}/scripts/fetch-release-metadata.sh"
cp "${DOCKER_ROOT}/scripts/release-resolution.sh" "${TEST_DOCKER_ROOT}/scripts/release-resolution.sh"
cp "${DOCKER_ROOT}/scripts/release-trust.sh" "${TEST_DOCKER_ROOT}/scripts/release-trust.sh"

awk '
  /^DOMAIN=/ { print "DOMAIN=prod.example.test"; next }
  /^BRAINDRIVE_APP_REF=/ {
    print "BRAINDRIVE_APP_REF=ghcr.io/braindriveai/braindrive-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    next
  }
  /^BRAINDRIVE_EDGE_REF=/ {
    print "BRAINDRIVE_EDGE_REF=ghcr.io/braindriveai/braindrive-edge@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    next
  }
  /^BRAINDRIVE_RELEASE_MANIFEST_URL=/ { print "BRAINDRIVE_RELEASE_MANIFEST_URL="; next }
  /^BRAINDRIVE_RELEASE_MANIFEST_SIG_URL=/ { print "BRAINDRIVE_RELEASE_MANIFEST_SIG_URL="; next }
  /^BRAINDRIVE_RELEASE_PUBLIC_KEY_URL=/ { print "BRAINDRIVE_RELEASE_PUBLIC_KEY_URL="; next }
  { print }
' "${TEST_DOCKER_ROOT}/.env.example" > "${TEST_DOCKER_ROOT}/.env.example.updated"
mv "${TEST_DOCKER_ROOT}/.env.example.updated" "${TEST_DOCKER_ROOT}/.env.example"

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${FAKE_BIN}/docker"
chmod +x "${FAKE_BIN}/docker"

OUTPUT_FILE="${TEMP_ROOT}/install-output.txt"
(
  cd "${TEST_DOCKER_ROOT}"
  PATH="${FAKE_BIN}:${PATH}" \
    DISPLAY="" \
    WAYLAND_DISPLAY="" \
    WSL_DISTRO_NAME="" \
    bash scripts/install.sh prod > "${OUTPUT_FILE}" 2>&1
)

BOOTSTRAP_TOKEN="$(sed -n 's/^PAA_AUTH_BOOTSTRAP_TOKEN=//p' "${TEST_DOCKER_ROOT}/.env" | head -n 1)"
if [[ ! "${BOOTSTRAP_TOKEN}" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
  echo "Production install did not persist a random 32-byte base64 bootstrap token." >&2
  exit 1
fi

if ! grep -q '^PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false$' "${TEST_DOCKER_ROOT}/.env"; then
  echo "Production install did not disable unrestricted first signup." >&2
  exit 1
fi

if grep -Fq "${BOOTSTRAP_TOKEN}" "${OUTPUT_FILE}"; then
  echo "Production install printed the bootstrap token." >&2
  exit 1
fi

if ! grep -Fq 'PAA_AUTH_BOOTSTRAP_TOKEN: ${PAA_AUTH_BOOTSTRAP_TOKEN:?' "${DOCKER_ROOT}/compose.prod.yml"; then
  echo "Production Compose does not require a bootstrap token." >&2
  exit 1
fi

if ! grep -Fq 'PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP: "false"' "${DOCKER_ROOT}/compose.prod.yml"; then
  echo "Production Compose does not fail closed for first signup." >&2
  exit 1
fi

if ! grep -q '^PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false$' "${DOCKER_ROOT}/.env.example"; then
  echo "The installer environment template does not default first signup to fail closed." >&2
  exit 1
fi

for lifecycle_script in install.sh start.sh upgrade.sh; do
  if ! grep -Fq 'source "${SCRIPT_DIR}/auth-bootstrap.sh"' "${DOCKER_ROOT}/scripts/${lifecycle_script}"; then
    echo "${lifecycle_script} does not load production first-signup protection." >&2
    exit 1
  fi
done

for lifecycle_script in install.ps1 start.ps1 upgrade.ps1; do
  if ! grep -Fq '. "$scriptDir/auth-bootstrap.ps1"' "${DOCKER_ROOT}/scripts/${lifecycle_script}"; then
    echo "${lifecycle_script} does not load production first-signup protection." >&2
    exit 1
  fi
  if ! grep -Fq 'Initialize-BrainDriveProdAuthBootstrap' "${DOCKER_ROOT}/scripts/${lifecycle_script}"; then
    echo "${lifecycle_script} does not initialize production first-signup protection." >&2
    exit 1
  fi
done

echo "Production bootstrap-token installer checks passed."
