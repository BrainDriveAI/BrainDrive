#!/usr/bin/env bash
set -euo pipefail

readonly GITLEAKS_VERSION="8.30.1"
readonly GITLEAKS_RELEASE_BASE_URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"
# SHA-256 of the official gitleaks_8.30.1_checksums.txt release asset:
# 061476c21adaf5441516f96f185c1a4706a83cd6329b9b38762271b3d4a52fae
readonly FINDINGS_EXIT_CODE=3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}/../.." rev-parse --show-toplevel)"
CONFIG_PATH="${REPO_ROOT}/.gitleaks.toml"
IGNORE_PATH="${REPO_ROOT}/.gitleaksignore"
RUN_DIR=""
SCANNER_BIN=""

usage() {
  cat <<'EOF'
Usage: tools/security/scan-secrets.sh --current|--history|--self-test

Modes:
  --current    Scan tracked and non-ignored candidate files in the worktree.
  --history    Scan every locally reachable branch, remote ref, and tag.
  --self-test  Prove current/deleted-history detection, redaction, and guards.

The scanner is pinned to Gitleaks 8.30.1. Set GITLEAKS_BIN to an existing
8.30.1 binary, or allow the script to download and checksum the official
Linux/macOS release archive into the user cache.
EOF
}

fail() {
  printf 'secret scan error: %s\n' "$1" >&2
  return 1
}

canonical_path() {
  node -e 'const fs = require("node:fs"); try { process.stdout.write(fs.realpathSync(process.argv[1])); } catch { process.exit(1); }' "$1"
}

cleanup() {
  if [[ -n "${RUN_DIR}" && -d "${RUN_DIR}" ]]; then
    rm -rf "${RUN_DIR}"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

sha256_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return 0
  fi
  fail "sha256sum or shasum is required"
}

archive_metadata() {
  local os_name
  local arch_name
  case "$(uname -s)" in
    Linux) os_name="linux" ;;
    Darwin) os_name="darwin" ;;
    *) fail "unsupported operating system for pinned Gitleaks download: $(uname -s)"; return 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch_name="x64" ;;
    arm64|aarch64) arch_name="arm64" ;;
    *) fail "unsupported architecture for pinned Gitleaks download: $(uname -m)"; return 1 ;;
  esac

  case "${os_name}_${arch_name}" in
    linux_x64)
      printf '%s %s\n' \
        "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
        "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
      ;;
    linux_arm64)
      printf '%s %s\n' \
        "gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz" \
        "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
      ;;
    darwin_x64)
      printf '%s %s\n' \
        "gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz" \
        "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
      ;;
    darwin_arm64)
      printf '%s %s\n' \
        "gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz" \
        "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
      ;;
  esac
}

checksum_matches() {
  local file_path="$1"
  local expected_checksum="$2"
  local actual_checksum
  actual_checksum="$(sha256_file "${file_path}")" || return 1
  [[ "${actual_checksum}" == "${expected_checksum}" ]]
}

scanner_version_matches() {
  local binary_path="$1"
  local actual_version
  [[ -x "${binary_path}" ]] || {
    fail "Gitleaks binary is not executable: ${binary_path}"
    return 1
  }
  actual_version="$("${binary_path}" version 2>/dev/null)" || {
    fail "unable to read Gitleaks version from ${binary_path}"
    return 1
  }
  if [[ "${actual_version}" != "${GITLEAKS_VERSION}" ]]; then
    fail "unsupported Gitleaks version ${actual_version}; expected ${GITLEAKS_VERSION}"
    return 1
  fi
}

download_scanner() {
  local metadata
  local archive_name
  local expected_checksum
  local cache_base
  local cache_dir
  local archive_path
  local download_path
  local extracted_dir

  require_command curl
  require_command tar
  metadata="$(archive_metadata)" || return 1
  read -r archive_name expected_checksum <<<"${metadata}"

  if [[ -n "${GITLEAKS_CACHE_DIR:-}" ]]; then
    cache_base="${GITLEAKS_CACHE_DIR}"
  elif [[ -n "${XDG_CACHE_HOME:-}" ]]; then
    cache_base="${XDG_CACHE_HOME}/braindrive/security"
  elif [[ -n "${HOME:-}" ]]; then
    cache_base="${HOME}/.cache/braindrive/security"
  else
    fail "set GITLEAKS_CACHE_DIR or HOME so the verified scanner archive can be cached"
    return 1
  fi

  cache_dir="${cache_base}/gitleaks-${GITLEAKS_VERSION}"
  archive_path="${cache_dir}/${archive_name}"
  mkdir -p "${cache_dir}"

  if [[ ! -f "${archive_path}" ]]; then
    download_path="$(mktemp "${cache_dir}/.${archive_name}.XXXXXX")"
    if ! curl -fsSL "${GITLEAKS_RELEASE_BASE_URL}/${archive_name}" -o "${download_path}"; then
      rm -f "${download_path}"
      fail "failed to download pinned Gitleaks release archive"
      return 1
    fi
    if ! checksum_matches "${download_path}" "${expected_checksum}"; then
      rm -f "${download_path}"
      fail "downloaded Gitleaks archive checksum mismatch"
      return 1
    fi
    mv "${download_path}" "${archive_path}"
  fi

  if ! checksum_matches "${archive_path}" "${expected_checksum}"; then
    fail "cached Gitleaks archive checksum mismatch: ${archive_path}"
    return 1
  fi

  extracted_dir="${RUN_DIR}/gitleaks"
  mkdir -p "${extracted_dir}"
  tar -xzf "${archive_path}" -C "${extracted_dir}" gitleaks
  SCANNER_BIN="${extracted_dir}/gitleaks"
  scanner_version_matches "${SCANNER_BIN}"
}

resolve_scanner() {
  local discovered
  if [[ -n "${GITLEAKS_BIN:-}" ]]; then
    SCANNER_BIN="${GITLEAKS_BIN}"
    scanner_version_matches "${SCANNER_BIN}"
    return
  fi

  discovered="$(command -v gitleaks 2>/dev/null || true)"
  if [[ -n "${discovered}" ]]; then
    SCANNER_BIN="${discovered}"
    scanner_version_matches "${SCANNER_BIN}"
    return
  fi

  download_scanner
}

gitleaks_common_args() {
  GITLEAKS_ARGS=(
    --config "${CONFIG_PATH}"
    --no-banner
    --no-color
    --redact=100
    --exit-code "${FINDINGS_EXIT_CODE}"
    --report-format json
  )
  if [[ -f "${IGNORE_PATH}" ]]; then
    GITLEAKS_ARGS+=(--gitleaks-ignore-path "${IGNORE_PATH}")
  fi
}

copy_current_candidates() {
  local source_root="$1"
  local snapshot_root="$2"
  local canonical_root
  local relative_path
  local source_path
  local resolved_path
  local destination_path
  local manifest_path="${RUN_DIR}/current-files.manifest"

  canonical_root="$(canonical_path "${source_root}")" || {
    fail "current scan root could not be resolved"
    return 1
  }

  if git -C "${source_root}" ls-files --stage | awk '$1 == "160000" { found=1 } END { exit(found ? 0 : 1) }'; then
    fail "current scan does not support tracked submodules"
    return 1
  fi
  if ! git -C "${source_root}" \
    ls-files --cached --others --exclude-standard --deduplicate -z >"${manifest_path}"; then
    fail "unable to enumerate current tracked and non-ignored files"
    return 1
  fi

  while IFS= read -r -d '' relative_path; do
    source_path="${source_root}/${relative_path}"
    destination_path="${snapshot_root}/${relative_path}"
    if ! resolved_path="$(canonical_path "$(dirname "${source_path}")")"; then
      continue
    fi
    case "${resolved_path}" in
      "${canonical_root}"|"${canonical_root}"/*) ;;
      *) fail "current scan candidate escaped repository root"; return 1 ;;
    esac
    if [[ ! -f "${source_path}" && ! -L "${source_path}" ]]; then
      continue
    fi
    if [[ ! -L "${source_path}" ]]; then
      resolved_path="$(canonical_path "${source_path}")" || {
        fail "current scan candidate could not be resolved"
        return 1
      }
      case "${resolved_path}" in
        "${canonical_root}"|"${canonical_root}"/*) ;;
        *) fail "current scan candidate escaped repository root"; return 1 ;;
      esac
    fi
    mkdir -p "$(dirname "${destination_path}")"
    if [[ -L "${source_path}" ]]; then
      readlink "${source_path}" >"${destination_path}"
    else
      cp -P "${source_path}" "${destination_path}"
    fi
  done <"${manifest_path}"
}

run_current_scan() {
  local source_root="$1"
  local report_path="$2"
  local log_path="$3"
  local snapshot_root="${RUN_DIR}/current-snapshot"

  mkdir -p "${snapshot_root}"
  copy_current_candidates "${source_root}" "${snapshot_root}" || return 1
  gitleaks_common_args
  (
    cd "${snapshot_root}"
    "${SCANNER_BIN}" dir . \
      "${GITLEAKS_ARGS[@]}" \
      --report-path "${report_path}"
  ) >"${log_path}" 2>&1
}

history_repository_supported() {
  local source_root="$1"
  local shallow
  shallow="$(git -C "${source_root}" rev-parse --is-shallow-repository 2>/dev/null)" || {
    fail "history scan target is not a Git repository"
    return 1
  }
  if [[ "${shallow}" != "false" ]]; then
    fail "history scan requires a non-shallow clone with all intended refs fetched"
    return 1
  fi
  if [[ -z "$(git -C "${source_root}" for-each-ref --format='%(refname)' refs/heads refs/remotes refs/tags)" ]]; then
    fail "history scan found no reachable branches, remote refs, or tags"
    return 1
  fi
}

run_history_scan() {
  local source_root="$1"
  local report_path="$2"
  local log_path="$3"

  gitleaks_common_args
  "${SCANNER_BIN}" git "${source_root}" \
    "${GITLEAKS_ARGS[@]}" \
    --log-opts="--all --full-history" \
    --report-path "${report_path}" >"${log_path}" 2>&1
}

report_count() {
  local report_path="$1"
  node -e '
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(rows)) process.exit(2);
process.stdout.write(String(rows.length));
' "${report_path}"
}

print_sanitized_findings() {
  local report_path="$1"
  local strip_prefix="${2:-}"
  REPORT_PATH="${report_path}" STRIP_PREFIX="${strip_prefix}" node <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.env.REPORT_PATH, "utf8"));
if (!Array.isArray(rows)) {
  throw new Error("Gitleaks report is not a JSON array");
}
for (const row of rows) {
  let path = String(row.File ?? "unknown");
  const prefix = process.env.STRIP_PREFIX;
  if (prefix && path.startsWith(prefix)) {
    path = path.slice(prefix.length).replace(/^[/\\]+/, "");
  }
  const fingerprint = String(row.Fingerprint ?? `${path}:${row.RuleID ?? "unknown"}`);
  const fingerprintHash = crypto
    .createHash("sha256")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 16);
  const commit = String(row.Commit ?? "").trim() || "worktree";
  process.stdout.write(
    `finding rule=${row.RuleID ?? "unknown"} path=${JSON.stringify(path)} ` +
    `commit=${commit} fingerprint=sha256:${fingerprintHash} ` +
    "disposition=unreviewed reviewer=required status=open\n",
  );
}
NODE
}

print_scanner_error() {
  local status="$1"
  local log_path="$2"
  printf 'secret scan error: Gitleaks exited with status %s; no finding data was emitted\n' "${status}" >&2
  if [[ -s "${log_path}" ]]; then
    sed -E \
      -e 's/([Ss]ecret|[Pp]assword|[Tt]oken|[Kk]ey)[=:][^[:space:]]+/\1=[REDACTED]/g' \
      -e 's/(Authorization:)[[:space:]]*[^[:space:]]+/\1 [REDACTED]/Ig' \
      "${log_path}" >&2
  fi
}

execute_scan() {
  local mode="$1"
  local source_root="$2"
  local report_path="${RUN_DIR}/${mode}-report.json"
  local log_path="${RUN_DIR}/${mode}-scan.log"
  local scan_status
  local findings
  local config_hash
  local ref_count=""
  local strip_prefix=""

  if [[ "${mode}" == "history" ]]; then
    history_repository_supported "${source_root}" || return 1
  fi

  set +e
  if [[ "${mode}" == "current" ]]; then
    run_current_scan "${source_root}" "${report_path}" "${log_path}"
    scan_status=$?
    strip_prefix="./"
  else
    run_history_scan "${source_root}" "${report_path}" "${log_path}"
    scan_status=$?
    ref_count="$(
      git -C "${source_root}" for-each-ref \
        --format='%(refname)' refs/heads refs/remotes refs/tags | wc -l | tr -d ' '
    )"
  fi
  set -e

  if [[ "${scan_status}" -ne 0 && "${scan_status}" -ne "${FINDINGS_EXIT_CODE}" ]]; then
    print_scanner_error "${scan_status}" "${log_path}"
    return "${scan_status}"
  fi
  if [[ ! -s "${report_path}" ]]; then
    fail "Gitleaks did not produce a readable JSON report"
    return 1
  fi
  findings="$(report_count "${report_path}")" || {
    fail "Gitleaks produced an invalid JSON report"
    return 1
  }
  config_hash="$(sha256_file "${CONFIG_PATH}")"

  if [[ "${mode}" == "current" ]]; then
    printf 'secret_scan mode=current scanner=gitleaks-%s config_sha256=%s scope=tracked-and-nonignored-worktree findings=%s\n' \
      "${GITLEAKS_VERSION}" "${config_hash}" "${findings}"
  else
    printf 'secret_scan mode=history scanner=gitleaks-%s config_sha256=%s scope=all-reachable-refs refs=%s findings=%s\n' \
      "${GITLEAKS_VERSION}" "${config_hash}" "${ref_count}" "${findings}"
  fi

  if [[ "${findings}" -gt 0 ]]; then
    print_sanitized_findings "${report_path}" "${strip_prefix}"
    return "${FINDINGS_EXIT_CODE}"
  fi
  if [[ "${scan_status}" -ne 0 ]]; then
    fail "Gitleaks returned a findings exit code with an empty report"
    return 1
  fi
}

assert_ignore_contract() {
  local expected_paths=(
    "builds/typescript/.paa-secrets.backup-2026-05-22"
    "builds/typescript/your-memory.backup-2026-05-22"
    "builds/typescript/your-memory-auth-reset-backup-20260513-123235"
    "builds/typescript/your-memory.auth-preserve-20260513-133934"
    "builds/typescript/your-memory.old-data-backup-20260513-133934"
  )
  local source_paths=(
    "builds/typescript/secrets"
    "builds/typescript/memory/starter-pack"
  )
  local path
  local provenance

  for path in "${expected_paths[@]}"; do
    provenance="$(git -C "${REPO_ROOT}" check-ignore -v --no-index "${path}")" || {
      fail "self-test expected an ignore rule for ${path}"
      return 1
    }
    if [[ "${provenance}" != .gitignore:* ]]; then
      fail "self-test expected root .gitignore provenance for ${path}"
      return 1
    fi
  done

  for path in "${source_paths[@]}"; do
    if git -C "${REPO_ROOT}" check-ignore -q --no-index "${path}"; then
      fail "self-test found tracked product source ignored: ${path}"
      return 1
    fi
  done
}

assert_exact_ignore_fingerprints() {
  if [[ ! -f "${IGNORE_PATH}" ]]; then
    return 0
  fi
  IGNORE_PATH="${IGNORE_PATH}" node <<'NODE'
const fs = require("node:fs");
const lines = fs
  .readFileSync(process.env.IGNORE_PATH, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.length > 0);
for (const line of lines) {
  if (/[*?\[\]]/.test(line)) {
    throw new Error("wildcards are not allowed in .gitleaksignore");
  }
  const parts = line.split(":");
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error("every .gitleaksignore line must be an exact fingerprint");
  }
  if (parts.length === 4 && !/^[0-9a-f]{40}$/.test(parts[0])) {
    throw new Error("historical fingerprints must start with a full commit");
  }
  const path = parts.length === 4 ? parts[1] : parts[0];
  const rule = parts.length === 4 ? parts[2] : parts[1];
  const lineNumber = parts.length === 4 ? parts[3] : parts[2];
  if (!path || !/^[a-z0-9-]+$/.test(rule) || !/^[1-9][0-9]*$/.test(lineNumber)) {
    throw new Error("invalid exact fingerprint in .gitleaksignore");
  }
}
NODE
}

assert_report_redacted() {
  local report_path="$1"
  local log_path="$2"
  shift 2
  local canary
  for canary in "$@"; do
    if grep -Fq "${canary}" "${report_path}" || grep -Fq "${canary}" "${log_path}"; then
      fail "self-test detected an unredacted canary in scanner output"
      return 1
    fi
  done
}

run_self_test() {
  local fixture_root="${RUN_DIR}/self-test-repo"
  local shallow_origin="${RUN_DIR}/shallow-origin"
  local shallow_clone="${RUN_DIR}/shallow-clone"
  local current_report="${RUN_DIR}/self-current.json"
  local current_log="${RUN_DIR}/self-current.log"
  local history_report="${RUN_DIR}/self-history.json"
  local history_log="${RUN_DIR}/self-history.log"
  local wrong_scanner="${RUN_DIR}/wrong-gitleaks"
  local bad_archive="${RUN_DIR}/bad-archive"
  local outside_root="${RUN_DIR}/outside-current-root"
  local escape_snapshot="${RUN_DIR}/escape-snapshot"
  local escape_log="${RUN_DIR}/escape-current.log"
  local current_canary
  local history_canary
  local labeled_canary
  local status

  current_canary="$(printf '%s%s' 'AK' 'IAA2B3C4D5E6F7G2H3')"
  history_canary="$(printf '%s%s' 'AK' 'IAH7G6F5E4D3C2B7A6')"
  labeled_canary="$(printf '%s%s' 'temporary-' 'runtime-key-2468')"

  assert_ignore_contract
  assert_exact_ignore_fingerprints

  printf 'not a scanner archive\n' >"${bad_archive}"
  if checksum_matches "${bad_archive}" "0000000000000000000000000000000000000000000000000000000000000000"; then
    fail "self-test checksum mismatch was not rejected"
    return 1
  fi

  printf '#!/usr/bin/env bash\nprintf "8.29.0\\n"\n' >"${wrong_scanner}"
  chmod 700 "${wrong_scanner}"
  if scanner_version_matches "${wrong_scanner}" >/dev/null 2>&1; then
    fail "self-test unsupported scanner version was not rejected"
    return 1
  fi

  git init -q "${fixture_root}"
  git -C "${fixture_root}" config user.email "security-canary@example.invalid"
  git -C "${fixture_root}" config user.name "BrainDrive security canary"
  printf 'historical_fixture = "%s"\n' "${history_canary}" >"${fixture_root}/deleted-canary.txt"
  git -C "${fixture_root}" add deleted-canary.txt
  git -C "${fixture_root}" commit -q -m "add ephemeral history canary"
  git -C "${fixture_root}" rm -q deleted-canary.txt
  git -C "${fixture_root}" commit -q -m "remove ephemeral history canary"
  {
    printf 'current_fixture = "%s"\n' "${current_canary}"
    printf 'Secret Access Key: "%s"\n' "${labeled_canary}"
  } >"${fixture_root}/current-canary.txt"
  git -C "${fixture_root}" add current-canary.txt
  mkdir -p "${fixture_root}/tracked-directory"
  printf 'inside\n' >"${fixture_root}/tracked-directory/file.txt"
  git -C "${fixture_root}" add tracked-directory/file.txt
  git -C "${fixture_root}" commit -q -m "add ephemeral current canary"

  set +e
  run_current_scan "${fixture_root}" "${current_report}" "${current_log}"
  status=$?
  set -e
  if [[ "${status}" -ne "${FINDINGS_EXIT_CODE}" ]]; then
    fail "self-test current canary was not detected"
    return 1
  fi
  if [[ "$(report_count "${current_report}")" -lt 1 ]]; then
    fail "self-test current report did not contain a finding"
    return 1
  fi
  if ! node -e '
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(rows.some((row) => row.RuleID === "braindrive-labeled-secret-access-key") ? 0 : 1);
' "${current_report}"; then
    fail "self-test repository-specific labeled-key canary was not detected"
    return 1
  fi
  assert_report_redacted \
    "${current_report}" "${current_log}" \
    "${current_canary}" "${history_canary}" "${labeled_canary}"

  mkdir -p "${outside_root}"
  printf '%s\n' "${current_canary}" >"${outside_root}/file.txt"
  rm "${fixture_root}/tracked-directory/file.txt"
  rmdir "${fixture_root}/tracked-directory"
  ln -s "${outside_root}" "${fixture_root}/tracked-directory"
  if copy_current_candidates "${fixture_root}" "${escape_snapshot}" >"${escape_log}" 2>&1; then
    fail "self-test ancestor symlink escape was not rejected"
    return 1
  fi
  if grep -Fq "${current_canary}" "${escape_log}"; then
    fail "self-test ancestor symlink guard exposed outside content"
    return 1
  fi
  unlink "${fixture_root}/tracked-directory"
  git -C "${fixture_root}" checkout -q -- tracked-directory/file.txt

  set +e
  run_history_scan "${fixture_root}" "${history_report}" "${history_log}"
  status=$?
  set -e
  if [[ "${status}" -ne "${FINDINGS_EXIT_CODE}" ]]; then
    fail "self-test historical canary was not detected"
    return 1
  fi
  if ! node -e '
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(rows.some((row) => row.File === "deleted-canary.txt") ? 0 : 1);
' "${history_report}"; then
    fail "self-test deleted historical content was not reported"
    return 1
  fi
  assert_report_redacted \
    "${history_report}" "${history_log}" \
    "${current_canary}" "${history_canary}" "${labeled_canary}"

  git init -q "${shallow_origin}"
  git -C "${shallow_origin}" config user.email "security-canary@example.invalid"
  git -C "${shallow_origin}" config user.name "BrainDrive security canary"
  printf 'one\n' >"${shallow_origin}/state.txt"
  git -C "${shallow_origin}" add state.txt
  git -C "${shallow_origin}" commit -q -m "first"
  printf 'two\n' >"${shallow_origin}/state.txt"
  git -C "${shallow_origin}" commit -qam "second"
  git clone -q --depth 1 "file://${shallow_origin}" "${shallow_clone}"
  if history_repository_supported "${shallow_clone}" >/dev/null 2>&1; then
    fail "self-test shallow history was not rejected"
    return 1
  fi

  printf 'secret_scan self_test=pass current_canary=detected history_deleted_canary=detected custom_rule_canary=detected redaction=pass checksum_guard=pass version_guard=pass shallow_guard=pass containment_guard=pass exception_scope=pass\n'
}

main() {
  local mode="${1:-}"
  if [[ $# -ne 1 ]]; then
    usage >&2
    return 2
  fi

  case "${mode}" in
    --current|--history|--self-test) ;;
    -h|--help)
      usage
      return 0
      ;;
    *)
      usage >&2
      return 2
      ;;
  esac

  require_command git
  require_command node
  [[ -f "${CONFIG_PATH}" ]] || {
    fail "missing scanner configuration: ${CONFIG_PATH}"
    return 1
  }

  umask 077
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/braindrive-secret-scan.XXXXXX")"
  resolve_scanner

  case "${mode}" in
    --current) execute_scan "current" "${REPO_ROOT}" ;;
    --history) execute_scan "history" "${REPO_ROOT}" ;;
    --self-test) run_self_test ;;
  esac
}

main "$@"
