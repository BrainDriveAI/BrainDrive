#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: ./scripts/upgrade.sh [prod|local]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
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
    echo "BRAINDRIVE_RELEASE_MANIFEST_SIG is required when BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE=true." >&2
    exit 1
  fi
  if [[ -z "${public_key_path}" ]]; then
    echo "BRAINDRIVE_RELEASE_PUBLIC_KEY is required when BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE=true." >&2
    exit 1
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

  if ! command -v cosign >/dev/null 2>&1; then
    echo "cosign is required for manifest signature verification." >&2
    exit 1
  fi

  cosign verify-blob \
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
  manifest_path="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST)}")"
  if [[ -z "${manifest_path}" ]]; then
    return 0
  fi

  if [[ "${manifest_path}" != /* ]]; then
    manifest_path="${ROOT_DIR}/${manifest_path}"
  fi

  if [[ ! -f "${manifest_path}" ]]; then
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

COMPOSE_FILE="compose.prod.yml"
if [[ "${MODE}" == "local" ]]; then
  COMPOSE_FILE="compose.local.yml"
fi

if [[ "${MODE}" == "local" ]]; then
  docker compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans
else
  resolve_prod_image_refs_from_manifest
  validate_prod_image_refs
  docker compose -f "${COMPOSE_FILE}" pull
  docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans
fi

docker compose -f "${COMPOSE_FILE}" ps
