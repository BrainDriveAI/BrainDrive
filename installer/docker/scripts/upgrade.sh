#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" ]]; then
  echo "Usage: ./scripts/upgrade.sh [local|prod|quickstart]"
  exit 1
fi

if [[ "${MODE}" == "quickstart" ]]; then
  echo "Mode 'quickstart' is deprecated and now aliases to 'local'." >&2
  MODE="local"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"
source "${SCRIPT_DIR}/browser-helper.sh"

DRY_RUN="${BRAINDRIVE_UPGRADE_DRY_RUN:-false}"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
}

configure_docker_platform() {
  if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
    return 0
  fi

  local configured_platform
  configured_platform="${BRAINDRIVE_DOCKER_PLATFORM:-$(trim_quotes "$(get_env_value BRAINDRIVE_DOCKER_PLATFORM)")}"
  if [[ -n "${configured_platform}" ]]; then
    export DOCKER_DEFAULT_PLATFORM="${configured_platform}"
    echo "Using Docker platform override: ${DOCKER_DEFAULT_PLATFORM}"
    return 0
  fi

  local host_os
  local host_arch
  host_os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  host_arch="$(uname -m 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  if [[ "${host_os}" == "darwin" && ( "${host_arch}" == "arm64" || "${host_arch}" == "aarch64" ) ]]; then
    export DOCKER_DEFAULT_PLATFORM="linux/amd64"
    echo "Apple Silicon detected; using linux/amd64 for BrainDrive prebuilt images."
    echo "Set BRAINDRIVE_DOCKER_PLATFORM to override this behavior."
  fi
}

trim_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  echo "${value}"
}

to_bool() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "${value}" in
    1|true|yes|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

get_current_service_image() {
  local compose_file="$1"
  local service="$2"

  local container_id
  container_id="$(docker compose -f "${compose_file}" ps -q "${service}" 2>/dev/null | head -n 1 || true)"
  if [[ -z "${container_id}" ]]; then
    echo ""
    return 0
  fi

  local configured_image
  configured_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}" 2>/dev/null || true)"
  echo "${configured_image}"
}

COSIGN_BIN=""

ensure_cosign() {
  if [[ -n "${COSIGN_BIN}" && -x "${COSIGN_BIN}" ]]; then
    return 0
  fi

  local configured_bin
  configured_bin="$(trim_quotes "${BRAINDRIVE_COSIGN_BIN:-$(get_env_value BRAINDRIVE_COSIGN_BIN)}")"
  if [[ -n "${configured_bin}" ]]; then
    if [[ "${configured_bin}" != /* ]]; then
      configured_bin="${ROOT_DIR}/${configured_bin}"
    fi
    if [[ -x "${configured_bin}" ]]; then
      COSIGN_BIN="${configured_bin}"
      return 0
    fi
    echo "Configured BRAINDRIVE_COSIGN_BIN not found or not executable: ${configured_bin}" >&2
    exit 1
  fi

  if command -v cosign >/dev/null 2>&1; then
    COSIGN_BIN="$(command -v cosign)"
    return 0
  fi

  local auto_install
  auto_install="$(trim_quotes "${BRAINDRIVE_AUTO_INSTALL_COSIGN:-$(get_env_value BRAINDRIVE_AUTO_INSTALL_COSIGN)}")"
  if [[ -z "${auto_install}" ]]; then
    auto_install="true"
  fi
  auto_install="$(to_bool "${auto_install}")"

  if [[ "${auto_install}" != "true" ]]; then
    echo "cosign is required for manifest signature verification." >&2
    echo "Install cosign manually or set BRAINDRIVE_AUTO_INSTALL_COSIGN=true." >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to auto-install cosign." >&2
    exit 1
  fi
  if ! command -v uname >/dev/null 2>&1; then
    echo "uname is required to auto-install cosign." >&2
    exit 1
  fi

  local os
  local arch
  local uname_s
  local uname_m
  uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
  uname_m="$(uname -m | tr '[:upper:]' '[:lower:]')"

  case "${uname_s}" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *)
      echo "Automatic cosign install is not supported on OS: ${uname_s}" >&2
      echo "Install cosign manually and retry." >&2
      exit 1
      ;;
  esac

  case "${uname_m}" in
    x86_64|amd64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Automatic cosign install is not supported on arch: ${uname_m}" >&2
      echo "Install cosign manually and retry." >&2
      exit 1
      ;;
  esac

  local version
  local bin_dir
  local url
  local target
  local tmp_target
  version="$(trim_quotes "${BRAINDRIVE_COSIGN_VERSION:-$(get_env_value BRAINDRIVE_COSIGN_VERSION)}")"
  bin_dir="$(trim_quotes "${BRAINDRIVE_COSIGN_BIN_DIR:-$(get_env_value BRAINDRIVE_COSIGN_BIN_DIR)}")"

  if [[ -z "${bin_dir}" ]]; then
    bin_dir="${HOME:-${ROOT_DIR}}/.local/bin"
  fi
  if [[ "${bin_dir}" != /* ]]; then
    bin_dir="${ROOT_DIR}/${bin_dir}"
  fi

  mkdir -p "${bin_dir}"
  target="${bin_dir}/cosign"
  tmp_target="${target}.tmp"

  if [[ -n "${version}" && "${version}" != "latest" ]]; then
    url="https://github.com/sigstore/cosign/releases/download/${version}/cosign-${os}-${arch}"
  else
    url="https://github.com/sigstore/cosign/releases/latest/download/cosign-${os}-${arch}"
  fi

  echo "cosign not found; downloading ${url}"
  curl -fsSL "${url}" -o "${tmp_target}"
  chmod +x "${tmp_target}"
  mv -f "${tmp_target}" "${target}"

  COSIGN_BIN="${target}"
}

parse_manifest_with_node() {
  local manifest_path="$1"
  local channel="$2"
  local release_version="$3"
  local _require_signature="$4"

  node - "$manifest_path" "$channel" "$release_version" "$_require_signature" <<'NODE'
const fs = require('node:fs');

const [manifestPath, channel, releaseVersion] = process.argv.slice(2);

try {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  const resolvedVersion = releaseVersion || (manifest.channels && manifest.channels[channel]);
  if (!resolvedVersion) {
    throw new Error(`Could not resolve release version for channel: ${channel}`);
  }

  const release = manifest.releases && manifest.releases[resolvedVersion];
  if (!release || typeof release !== 'object') {
    throw new Error(`Release entry not found: ${resolvedVersion}`);
  }

  const appRef = release.app_image_digest || release.app_image_ref || '';
  const edgeRef = release.edge_image_digest || release.edge_image_ref || '';
  if (!appRef || !edgeRef) {
    throw new Error(`Release ${resolvedVersion} is missing app/edge digest refs`);
  }

  process.stdout.write(`${appRef}\t${edgeRef}\t${resolvedVersion}`);
} catch (error) {
  console.error(`Manifest parse error: ${error.message}`);
  process.exit(1);
}
NODE
}

parse_manifest_with_python() {
  local manifest_path="$1"
  local channel="$2"
  local release_version="$3"
  local _require_signature="$4"

  python3 - "$manifest_path" "$channel" "$release_version" "$_require_signature" <<'PY'
import json
import sys

manifest_path, channel, release_version = sys.argv[1:4]

try:
  with open(manifest_path, "r", encoding="utf-8") as f:
    manifest = json.load(f)

  resolved_version = release_version or (manifest.get("channels") or {}).get(channel)
  if not resolved_version:
    raise ValueError(f"Could not resolve release version for channel: {channel}")

  release = (manifest.get("releases") or {}).get(resolved_version)
  if not isinstance(release, dict):
    raise ValueError(f"Release entry not found: {resolved_version}")

  app_ref = release.get("app_image_digest") or release.get("app_image_ref") or ""
  edge_ref = release.get("edge_image_digest") or release.get("edge_image_ref") or ""
  if not app_ref or not edge_ref:
    raise ValueError(f"Release {resolved_version} is missing app/edge digest refs")

  sys.stdout.write(f"{app_ref}\t{edge_ref}\t{resolved_version}")
except Exception as exc:
  print(f"Manifest parse error: {exc}", file=sys.stderr)
  sys.exit(1)
PY
}

resolve_manifest_refs() {
  local manifest_path="$1"
  local channel="$2"
  local release_version="$3"
  local require_signature="$4"

  if command -v node >/dev/null 2>&1; then
    parse_manifest_with_node "$manifest_path" "$channel" "$release_version" "$require_signature"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    parse_manifest_with_python "$manifest_path" "$channel" "$release_version" "$require_signature"
    return 0
  fi

  echo "Manifest resolution requires node or python3." >&2
  exit 1
}

resolve_path_in_root() {
  local path_value="$1"
  if [[ -z "${path_value}" ]]; then
    echo ""
    return 0
  fi
  if [[ "${path_value}" == /* ]]; then
    echo "${path_value}"
  else
    echo "${ROOT_DIR}/${path_value}"
  fi
}

verify_manifest_signature() {
  local manifest_path="$1"

  local signature_path
  local public_key_path
  signature_path="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST_SIG:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST_SIG)}")"
  public_key_path="$(trim_quotes "${BRAINDRIVE_RELEASE_PUBLIC_KEY:-$(get_env_value BRAINDRIVE_RELEASE_PUBLIC_KEY)}")"

  if [[ -z "${signature_path}" ]]; then
    signature_path="./release-cache/releases.json.sig"
  fi
  if [[ -z "${public_key_path}" ]]; then
    public_key_path="./release-cache/cosign.pub"
  fi

  signature_path="$(resolve_path_in_root "${signature_path}")"
  public_key_path="$(resolve_path_in_root "${public_key_path}")"

  if [[ ! -f "${signature_path}" ]]; then
    echo "Manifest signature file not found: ${signature_path}" >&2
    exit 1
  fi
  if [[ ! -f "${public_key_path}" ]]; then
    echo "Manifest public key file not found: ${public_key_path}" >&2
    exit 1
  fi

  ensure_cosign

  "${COSIGN_BIN}" verify-blob \
    --new-bundle-format=false \
    --insecure-ignore-tlog=true \
    --key "${public_key_path}" \
    --signature "${signature_path}" \
    "${manifest_path}" >/dev/null

  echo "Manifest signature verified with cosign."
}

resolve_prod_image_refs_from_manifest() {
  local existing_app_ref
  local existing_edge_ref
  existing_app_ref="$(trim_quotes "${BRAINDRIVE_APP_REF:-$(get_env_value BRAINDRIVE_APP_REF)}")"
  existing_edge_ref="$(trim_quotes "${BRAINDRIVE_EDGE_REF:-$(get_env_value BRAINDRIVE_EDGE_REF)}")"

  if [[ -n "${existing_app_ref}" && -n "${existing_edge_ref}" ]]; then
    return 0
  fi

  local manifest_path
  local manifest_path_is_explicit="true"
  manifest_path="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST)}")"
  if [[ -z "${manifest_path}" ]]; then
    manifest_path="./release-cache/releases.json"
    manifest_path_is_explicit="false"
  fi

  if [[ "${manifest_path}" != /* ]]; then
    manifest_path="${ROOT_DIR}/${manifest_path}"
  fi

  if [[ ! -f "${manifest_path}" ]]; then
    if [[ "${manifest_path_is_explicit}" == "false" ]]; then
      return 0
    fi
    echo "Release manifest file not found: ${manifest_path}" >&2
    exit 1
  fi

  local channel
  channel="$(trim_quotes "${BRAINDRIVE_RELEASE_CHANNEL:-$(get_env_value BRAINDRIVE_RELEASE_CHANNEL)}")"
  if [[ -z "${channel}" ]]; then
    channel="stable"
  fi

  local release_version
  release_version="$(trim_quotes "${BRAINDRIVE_RELEASE_VERSION:-$(get_env_value BRAINDRIVE_RELEASE_VERSION)}")"

  local require_signature
  require_signature="$(trim_quotes "${BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE:-$(get_env_value BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE)}")"
  if [[ -z "${require_signature}" ]]; then
    require_signature="true"
  fi
  require_signature="$(to_bool "${require_signature}")"

  if [[ "${require_signature}" == "true" ]]; then
    verify_manifest_signature "${manifest_path}"
  fi

  local resolved
  resolved="$(resolve_manifest_refs "${manifest_path}" "${channel}" "${release_version}" "${require_signature}")"

  local manifest_app_ref manifest_edge_ref resolved_version
  IFS=$'\t' read -r manifest_app_ref manifest_edge_ref resolved_version <<<"${resolved}"

  export BRAINDRIVE_APP_REF="${manifest_app_ref}"
  export BRAINDRIVE_EDGE_REF="${manifest_edge_ref}"

  if [[ -n "${resolved_version}" ]]; then
    export BRAINDRIVE_TAG="${resolved_version}"
  fi

  echo "Resolved release refs from manifest (${resolved_version:-unknown})"
}

validate_prod_image_refs() {
  local app_ref
  local edge_ref
  app_ref="$(trim_quotes "${BRAINDRIVE_APP_REF:-$(get_env_value BRAINDRIVE_APP_REF)}")"
  edge_ref="$(trim_quotes "${BRAINDRIVE_EDGE_REF:-$(get_env_value BRAINDRIVE_EDGE_REF)}")"

  if [[ -n "${app_ref}" && -z "${edge_ref}" ]]; then
    echo "BRAINDRIVE_APP_REF is set but BRAINDRIVE_EDGE_REF is missing." >&2
    echo "Set both refs or neither." >&2
    exit 1
  fi

  if [[ -n "${edge_ref}" && -z "${app_ref}" ]]; then
    echo "BRAINDRIVE_EDGE_REF is set but BRAINDRIVE_APP_REF is missing." >&2
    echo "Set both refs or neither." >&2
    exit 1
  fi

  if [[ -n "${app_ref}" && -n "${edge_ref}" ]]; then
    echo "Using digest/image refs from BRAINDRIVE_APP_REF and BRAINDRIVE_EDGE_REF."
  else
    echo "Using BRAINDRIVE_APP_IMAGE/BRAINDRIVE_EDGE_IMAGE with BRAINDRIVE_TAG."
  fi
}

COMPOSE_FILE="compose.local.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
fi

run_quickstart_migration_once() {
  if [[ "${MODE}" != "local" ]]; then
    return 0
  fi

  local runtime_dir marker_file legacy_ids
  runtime_dir="${ROOT_DIR}/.runtime"
  marker_file="${runtime_dir}/quickstart-migration-v1.done"
  mkdir -p "${runtime_dir}"

  if [[ -f "${marker_file}" ]]; then
    return 0
  fi

  echo "Migration note: 'quickstart' has been replaced by 'local'."
  legacy_ids="$(docker compose -f compose.quickstart.yml ps -q 2>/dev/null || true)"
  if [[ -n "${legacy_ids}" ]]; then
    echo "Found running legacy quickstart containers; stopping them to avoid port conflicts."
    docker compose -f compose.quickstart.yml down --remove-orphans >/dev/null 2>&1 || true
  fi

  {
    echo "migrated_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "reason=quickstart-renamed-to-local"
  } > "${marker_file}"
}

configure_docker_platform
run_quickstart_migration_once

bash "${SCRIPT_DIR}/fetch-release-metadata.sh"
resolve_prod_image_refs_from_manifest
validate_prod_image_refs

local_app_ref="$(trim_quotes "${BRAINDRIVE_APP_REF:-$(get_env_value BRAINDRIVE_APP_REF)}")"
local_edge_ref="$(trim_quotes "${BRAINDRIVE_EDGE_REF:-$(get_env_value BRAINDRIVE_EDGE_REF)}")"
local_app_image="$(trim_quotes "${BRAINDRIVE_APP_IMAGE:-$(get_env_value BRAINDRIVE_APP_IMAGE)}")"
local_edge_image="$(trim_quotes "${BRAINDRIVE_EDGE_IMAGE:-$(get_env_value BRAINDRIVE_EDGE_IMAGE)}")"
local_tag="$(trim_quotes "${BRAINDRIVE_TAG:-$(get_env_value BRAINDRIVE_TAG)}")"

if [[ -z "${local_tag}" ]]; then
  local_tag="latest"
fi

if [[ -z "${local_app_image}" ]]; then
  local_app_image="ghcr.io/braindriveai/braindrive-app"
fi
if [[ -z "${local_edge_image}" ]]; then
  local_edge_image="ghcr.io/braindriveai/braindrive-edge"
fi

target_app_image="${local_app_ref:-${local_app_image}:${local_tag}}"
target_edge_image="${local_edge_ref:-${local_edge_image}:${local_tag}}"

if [[ "$(to_bool "${DRY_RUN}")" == "true" ]]; then
  current_app_image="$(get_current_service_image "${COMPOSE_FILE}" "app")"
  current_edge_image="$(get_current_service_image "${COMPOSE_FILE}" "edge")"

  if [[ -z "${current_app_image}" ]]; then
    current_app_image="$(trim_quotes "${BRAINDRIVE_LAST_APPLIED_APP_REF:-}")"
  fi
  if [[ -z "${current_edge_image}" ]]; then
    current_edge_image="$(trim_quotes "${BRAINDRIVE_LAST_APPLIED_EDGE_REF:-}")"
  fi

  update_available="false"
  if [[ -z "${current_app_image}" || -z "${current_edge_image}" ]]; then
    update_available="true"
  elif [[ "${current_app_image}" != "${target_app_image}" || "${current_edge_image}" != "${target_edge_image}" ]]; then
    update_available="true"
  fi

  echo "CHECK_MODE=dry-run"
  echo "CHECK_TARGET_APP_REF=${target_app_image}"
  echo "CHECK_TARGET_EDGE_REF=${target_edge_image}"
  echo "CHECK_CURRENT_APP_REF=${current_app_image}"
  echo "CHECK_CURRENT_EDGE_REF=${current_edge_image}"
  echo "CHECK_RESOLVED_VERSION=${local_tag}"
  echo "CHECK_UPDATE_AVAILABLE=${update_available}"

  if [[ "${update_available}" == "true" ]]; then
    exit 10
  fi
  exit 0
fi

docker compose -f "${COMPOSE_FILE}" pull
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

docker compose -f "${COMPOSE_FILE}" ps
braindrive_print_access_info_and_open "${MODE}" "Upgrade complete."
