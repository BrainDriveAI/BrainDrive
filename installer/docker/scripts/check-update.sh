#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-quickstart}"

if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" ]]; then
  echo "Usage: ./scripts/check-update.sh [quickstart|prod|local]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

STATE_FALLBACK_PATH="${ROOT_DIR}/release-cache/startup-update-state.json"
CONFIG_VOLUME_PATH="/data/memory/system/config/app-config.json"
STATE_VOLUME_PATH="/data/memory/system/updates/state.json"
MEMORY_VOLUME="braindrive_memory"
LOCK_DIR="${ROOT_DIR}/.runtime"
LOCK_PATH="${LOCK_DIR}/check-update.lock"

mkdir -p "${LOCK_DIR}"
if ! mkdir "${LOCK_PATH}" 2>/dev/null; then
  echo "Startup update check skipped: another check is already running."
  exit 0
fi
cleanup() {
  rmdir "${LOCK_PATH}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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

resolve_setting() {
  local runtime_value="$1"
  local config_value="$2"
  local env_file_value="$3"
  local default_value="$4"

  if [[ -n "${runtime_value}" ]]; then
    echo "${runtime_value}"
  elif [[ -n "${config_value}" ]]; then
    echo "${config_value}"
  elif [[ -n "${env_file_value}" ]]; then
    echo "${env_file_value}"
  else
    echo "${default_value}"
  fi
}

get_helper_image() {
  local app_ref
  local app_image
  local tag

  app_ref="$(trim_quotes "${BRAINDRIVE_APP_REF:-$(get_env_value BRAINDRIVE_APP_REF)}")"
  app_image="$(trim_quotes "${BRAINDRIVE_APP_IMAGE:-$(get_env_value BRAINDRIVE_APP_IMAGE)}")"
  tag="$(trim_quotes "${BRAINDRIVE_TAG:-$(get_env_value BRAINDRIVE_TAG)}")"

  if [[ -n "${app_ref}" ]]; then
    echo "${app_ref}"
    return 0
  fi
  if [[ -z "${app_image}" ]]; then
    app_image="ghcr.io/braindriveai/braindrive-app"
  fi
  if [[ -z "${tag}" ]]; then
    tag="latest"
  fi
  echo "${app_image}:${tag}"
}

read_volume_file() {
  local target_path="$1"

  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  if ! docker volume inspect "${MEMORY_VOLUME}" >/dev/null 2>&1; then
    return 1
  fi

  local helper_image
  helper_image="$(get_helper_image)"

  docker run --rm \
    -v "${MEMORY_VOLUME}:/data/memory" \
    --entrypoint /bin/sh \
    "${helper_image}" \
    -lc "cat \"${target_path}\" 2>/dev/null" 2>/dev/null
}

write_volume_file() {
  local target_path="$1"
  local payload="$2"

  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  if ! docker volume inspect "${MEMORY_VOLUME}" >/dev/null 2>&1; then
    return 1
  fi

  local helper_image
  helper_image="$(get_helper_image)"

  printf '%s' "${payload}" | docker run --rm -i \
    -v "${MEMORY_VOLUME}:/data/memory" \
    -e "TARGET_PATH=${target_path}" \
    --entrypoint /bin/sh \
    "${helper_image}" \
    -lc 'mkdir -p "$(dirname "$TARGET_PATH")" && cat > "$TARGET_PATH"' >/dev/null
}

parse_config_json() {
  local config_json="$1"
  if [[ -z "${config_json}" ]]; then
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    CONFIG_JSON_INPUT="${config_json}" python3 - <<'PY'
import json
import os
import sys

raw = (os.environ.get("CONFIG_JSON_INPUT") or "").strip()
if not raw:
  sys.exit(0)

try:
  data = json.loads(raw)
except Exception:
  sys.exit(0)

updates = data.get("updates") if isinstance(data, dict) else {}
if not isinstance(updates, dict):
  sys.exit(0)

def emit(key, value):
  if value is None:
    return
  if isinstance(value, bool):
    value = "true" if value else "false"
  elif isinstance(value, (int, float)):
    value = str(int(value))
  else:
    value = str(value)
  print(f"{key}={value}")

emit("CONFIG_UPDATES_ENABLED", updates.get("enabled"))
emit("CONFIG_STARTUP_CHECK", updates.get("startup_check"))
emit("CONFIG_POLICY", updates.get("policy"))
emit("CONFIG_FAIL_MODE", updates.get("fail_mode"))
emit("CONFIG_MIN_CHECK_INTERVAL", updates.get("min_check_interval_minutes"))

windowed = updates.get("windowed_apply")
if isinstance(windowed, dict):
  emit("CONFIG_WINDOW_ENABLED", windowed.get("enabled"))
  emit("CONFIG_WINDOW_TIMEZONE", windowed.get("timezone"))
  days = windowed.get("days")
  if isinstance(days, list):
    emit("CONFIG_WINDOW_DAYS", ",".join(str(x) for x in days))
  emit("CONFIG_WINDOW_START", windowed.get("start_time"))
  emit("CONFIG_WINDOW_END", windowed.get("end_time"))
PY
  fi
}

parse_state_json() {
  local state_json="$1"
  if [[ -z "${state_json}" ]]; then
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    STATE_JSON_INPUT="${state_json}" python3 - <<'PY'
import json
import os
import sys

raw = (os.environ.get("STATE_JSON_INPUT") or "").strip()
if not raw:
  sys.exit(0)

try:
  data = json.loads(raw)
except Exception:
  sys.exit(0)

if not isinstance(data, dict):
  sys.exit(0)

def emit(key, value):
  if value is None:
    return
  if isinstance(value, bool):
    value = "true" if value else "false"
  elif isinstance(value, (int, float)):
    value = str(int(value))
  else:
    value = str(value)
  print(f"{key}={value}")

emit("STATE_LAST_CHECKED_AT", data.get("last_checked_at"))
emit("STATE_LAST_CHECK_STATUS", data.get("last_check_status"))
emit("STATE_LAST_CHECK_ERROR", data.get("last_check_error"))
emit("STATE_LAST_AVAILABLE_VERSION", data.get("last_available_version"))
emit("STATE_LAST_APPLIED_VERSION", data.get("last_applied_version"))
emit("STATE_LAST_APPLIED_APP_REF", data.get("last_applied_app_ref"))
emit("STATE_LAST_APPLIED_EDGE_REF", data.get("last_applied_edge_ref"))
emit("STATE_PENDING_UPDATE", data.get("pending_update"))
emit("STATE_PENDING_REASON", data.get("pending_reason"))
emit("STATE_CONSECUTIVE_FAILURES", data.get("consecutive_failures"))
emit("STATE_NEXT_RETRY_AT", data.get("next_retry_at"))
PY
  fi
}

merge_config_defaults() {
  local config_json="$1"
  local enabled="$2"
  local startup_check="$3"
  local policy="$4"
  local fail_mode="$5"
  local min_interval="$6"
  local window_enabled="$7"
  local window_timezone="$8"
  local window_days="$9"
  local window_start="${10}"
  local window_end="${11}"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "${config_json}"
    return 0
  fi

  CONFIG_JSON_INPUT="${config_json}" \
  CFG_ENABLED="${enabled}" \
  CFG_STARTUP_CHECK="${startup_check}" \
  CFG_POLICY="${policy}" \
  CFG_FAIL_MODE="${fail_mode}" \
  CFG_MIN_INTERVAL="${min_interval}" \
  CFG_WINDOW_ENABLED="${window_enabled}" \
  CFG_WINDOW_TIMEZONE="${window_timezone}" \
  CFG_WINDOW_DAYS="${window_days}" \
  CFG_WINDOW_START="${window_start}" \
  CFG_WINDOW_END="${window_end}" \
  python3 - <<'PY'
import json
import os

raw = (os.environ.get("CONFIG_JSON_INPUT") or "").strip()
try:
  data = json.loads(raw) if raw else {}
except Exception:
  data = {}
if not isinstance(data, dict):
  data = {}

updates = data.get("updates")
if not isinstance(updates, dict):
  updates = {}

windowed = updates.get("windowed_apply")
if not isinstance(windowed, dict):
  windowed = {}

def as_bool(value, default):
  if value is None or value == "":
    return default
  return str(value).strip().lower() in {"1", "true", "yes", "on"}

def as_int(value, default):
  try:
    return int(value)
  except Exception:
    return default

if "enabled" not in updates:
  updates["enabled"] = as_bool(os.environ.get("CFG_ENABLED"), True)
if "startup_check" not in updates:
  updates["startup_check"] = as_bool(os.environ.get("CFG_STARTUP_CHECK"), True)
if "policy" not in updates:
  updates["policy"] = os.environ.get("CFG_POLICY") or "auto-apply"
if "fail_mode" not in updates:
  updates["fail_mode"] = os.environ.get("CFG_FAIL_MODE") or "fail-open"
if "min_check_interval_minutes" not in updates:
  updates["min_check_interval_minutes"] = as_int(os.environ.get("CFG_MIN_INTERVAL"), 60)

if "enabled" not in windowed:
  windowed["enabled"] = as_bool(os.environ.get("CFG_WINDOW_ENABLED"), False)
if "timezone" not in windowed:
  windowed["timezone"] = os.environ.get("CFG_WINDOW_TIMEZONE") or "UTC"
if "days" not in windowed:
  raw_days = os.environ.get("CFG_WINDOW_DAYS") or "Monday"
  windowed["days"] = [x.strip() for x in raw_days.split(",") if x.strip()]
if "start_time" not in windowed:
  windowed["start_time"] = os.environ.get("CFG_WINDOW_START") or "13:00"
if "end_time" not in windowed:
  windowed["end_time"] = os.environ.get("CFG_WINDOW_END") or "18:00"

updates["windowed_apply"] = windowed
data["updates"] = updates

print(json.dumps(data, indent=2))
PY
}

current_time_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

check_interval_gate() {
  local last_checked="$1"
  local next_retry_at="$2"
  local min_interval="$3"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "GATE_CHECK=true"
    echo "GATE_REASON=python-unavailable"
    return 0
  fi

  python3 - "$last_checked" "$next_retry_at" "$min_interval" <<'PY'
from datetime import datetime, timezone
import sys

def parse_iso(value):
  if not value:
    return None
  value = value.strip()
  if value.endswith("Z"):
    value = value[:-1] + "+00:00"
  try:
    return datetime.fromisoformat(value)
  except Exception:
    return None

last_checked = parse_iso(sys.argv[1])
next_retry = parse_iso(sys.argv[2])
try:
  min_interval = int(sys.argv[3])
except Exception:
  min_interval = 0

now = datetime.now(timezone.utc)

if next_retry and now < next_retry:
  print("GATE_CHECK=false")
  print("GATE_REASON=backoff")
  sys.exit(0)

if last_checked and min_interval > 0:
  elapsed_seconds = (now - last_checked).total_seconds()
  if elapsed_seconds < min_interval * 60:
    print("GATE_CHECK=false")
    print("GATE_REASON=min-interval")
    sys.exit(0)

print("GATE_CHECK=true")
print("GATE_REASON=ok")
PY
}

window_allows_apply() {
  local window_enabled="$1"
  local window_timezone="$2"
  local window_days="$3"
  local window_start="$4"
  local window_end="$5"

  if [[ "$(to_bool "${window_enabled}")" != "true" ]]; then
    echo "WINDOW_ALLOW=false"
    echo "WINDOW_REASON=disabled"
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "WINDOW_ALLOW=false"
    echo "WINDOW_REASON=python-unavailable"
    return 0
  fi

  python3 - "$window_timezone" "$window_days" "$window_start" "$window_end" <<'PY'
from datetime import datetime
import sys

try:
  from zoneinfo import ZoneInfo
except Exception:
  ZoneInfo = None

timezone_name, days_raw, start_time, end_time = sys.argv[1:5]

if not start_time or not end_time:
  print("WINDOW_ALLOW=false")
  print("WINDOW_REASON=missing-time")
  sys.exit(0)

if not timezone_name:
  timezone_name = "UTC"

try:
  tz = ZoneInfo(timezone_name) if ZoneInfo else None
except Exception:
  tz = None

now = datetime.now(tz) if tz else datetime.now()

days = [x.strip().lower() for x in days_raw.split(",") if x.strip()]
if days and now.strftime("%A").lower() not in days:
  print("WINDOW_ALLOW=false")
  print("WINDOW_REASON=day")
  sys.exit(0)

try:
  start_h, start_m = [int(x) for x in start_time.split(":", 1)]
  end_h, end_m = [int(x) for x in end_time.split(":", 1)]
except Exception:
  print("WINDOW_ALLOW=false")
  print("WINDOW_REASON=bad-time")
  sys.exit(0)

current_minutes = now.hour * 60 + now.minute
start_minutes = start_h * 60 + start_m
end_minutes = end_h * 60 + end_m

allowed = start_minutes <= current_minutes <= end_minutes
print(f"WINDOW_ALLOW={'true' if allowed else 'false'}")
print(f"WINDOW_REASON={'ok' if allowed else 'outside-window'}")
PY
}

compute_next_retry() {
  local failures="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    echo ""
    return 0
  fi

  python3 - "$failures" <<'PY'
from datetime import datetime, timedelta, timezone
import sys

try:
  failures = int(sys.argv[1])
except Exception:
  failures = 1

failures = max(1, failures)
delay_minutes = min(60, 15 * (2 ** (failures - 1)))
next_retry = datetime.now(timezone.utc) + timedelta(minutes=delay_minutes)
print(next_retry.replace(microsecond=0).isoformat().replace("+00:00", "Z"))
PY
}

write_state() {
  local status="$1"
  local error_message="$2"
  local pending_update="$3"
  local pending_reason="$4"
  local available_version="$5"
  local applied_version="$6"
  local applied_app_ref="$7"
  local applied_edge_ref="$8"
  local failures="$9"
  local next_retry="${10}"

  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  local payload
  payload="$(python3 - "$status" "$error_message" "$pending_update" "$pending_reason" "$available_version" "$applied_version" "$applied_app_ref" "$applied_edge_ref" "$failures" "$next_retry" <<'PY'
from datetime import datetime, timezone
import json
import sys

(
  status,
  error_message,
  pending_update,
  pending_reason,
  available_version,
  applied_version,
  applied_app_ref,
  applied_edge_ref,
  failures,
  next_retry,
) = sys.argv[1:]

try:
  failures_i = int(failures)
except Exception:
  failures_i = 0

doc = {
  "last_checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
  "last_check_status": status,
  "last_check_error": (error_message if error_message else None),
  "last_available_version": (available_version if available_version else None),
  "last_applied_version": (applied_version if applied_version else None),
  "last_applied_app_ref": (applied_app_ref if applied_app_ref else None),
  "last_applied_edge_ref": (applied_edge_ref if applied_edge_ref else None),
  "pending_update": pending_update.lower() == "true",
  "pending_reason": (pending_reason if pending_reason else None),
  "consecutive_failures": failures_i,
  "next_retry_at": (next_retry if next_retry else None),
}
print(json.dumps(doc, indent=2))
PY
)"

  if [[ -z "${payload}" ]]; then
    return 0
  fi

  if ! write_volume_file "${STATE_VOLUME_PATH}" "${payload}"; then
    mkdir -p "$(dirname "${STATE_FALLBACK_PATH}")"
    printf '%s\n' "${payload}" > "${STATE_FALLBACK_PATH}"
  fi
}

extract_field() {
  local key="$1"
  local content="$2"
  echo "${content}" | awk -F= -v k="${key}" '$1==k {print substr($0, length(k)+2)}' | tail -n 1
}

CONFIG_JSON="$(read_volume_file "${CONFIG_VOLUME_PATH}" || true)"

DEFAULT_UPDATES_ENABLED_RAW="${BRAINDRIVE_UPDATES_ENABLED:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_ENABLED)")}"
if [[ -z "${DEFAULT_UPDATES_ENABLED_RAW}" ]]; then
  DEFAULT_UPDATES_ENABLED_RAW="true"
fi
DEFAULT_UPDATES_ENABLED="$(to_bool "${DEFAULT_UPDATES_ENABLED_RAW}")"

DEFAULT_STARTUP_CHECK_RAW="${BRAINDRIVE_STARTUP_UPDATE_CHECK:-$(trim_quotes "$(get_env_value BRAINDRIVE_STARTUP_UPDATE_CHECK)")}"
if [[ -z "${DEFAULT_STARTUP_CHECK_RAW}" ]]; then
  DEFAULT_STARTUP_CHECK_RAW="true"
fi
DEFAULT_STARTUP_CHECK="$(to_bool "${DEFAULT_STARTUP_CHECK_RAW}")"

DEFAULT_POLICY="$(echo "${BRAINDRIVE_UPDATES_POLICY:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_POLICY)")}" | tr '[:upper:]' '[:lower:]')"
if [[ -z "${DEFAULT_POLICY}" ]]; then
  DEFAULT_POLICY="auto-apply"
fi
DEFAULT_FAIL_MODE="$(echo "${BRAINDRIVE_UPDATES_FAIL_MODE:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_FAIL_MODE)")}" | tr '[:upper:]' '[:lower:]')"
if [[ -z "${DEFAULT_FAIL_MODE}" ]]; then
  DEFAULT_FAIL_MODE="fail-open"
fi
DEFAULT_MIN_CHECK_INTERVAL="${BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES)")}"
if [[ -z "${DEFAULT_MIN_CHECK_INTERVAL}" ]]; then
  DEFAULT_MIN_CHECK_INTERVAL="60"
fi
DEFAULT_WINDOW_ENABLED_RAW="${BRAINDRIVE_UPDATES_WINDOW_ENABLED:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_ENABLED)")}"
if [[ -z "${DEFAULT_WINDOW_ENABLED_RAW}" ]]; then
  DEFAULT_WINDOW_ENABLED_RAW="false"
fi
DEFAULT_WINDOW_ENABLED="$(to_bool "${DEFAULT_WINDOW_ENABLED_RAW}")"
DEFAULT_WINDOW_TIMEZONE="${BRAINDRIVE_UPDATES_WINDOW_TIMEZONE:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_TIMEZONE)")}"
if [[ -z "${DEFAULT_WINDOW_TIMEZONE}" ]]; then
  DEFAULT_WINDOW_TIMEZONE="UTC"
fi
DEFAULT_WINDOW_DAYS="${BRAINDRIVE_UPDATES_WINDOW_DAYS:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_DAYS)")}"
if [[ -z "${DEFAULT_WINDOW_DAYS}" ]]; then
  DEFAULT_WINDOW_DAYS="Monday"
fi
DEFAULT_WINDOW_START="${BRAINDRIVE_UPDATES_WINDOW_START:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_START)")}"
if [[ -z "${DEFAULT_WINDOW_START}" ]]; then
  DEFAULT_WINDOW_START="13:00"
fi
DEFAULT_WINDOW_END="${BRAINDRIVE_UPDATES_WINDOW_END:-$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_END)")}"
if [[ -z "${DEFAULT_WINDOW_END}" ]]; then
  DEFAULT_WINDOW_END="18:00"
fi

MERGED_CONFIG_JSON="$(merge_config_defaults \
  "${CONFIG_JSON}" \
  "${DEFAULT_UPDATES_ENABLED}" \
  "${DEFAULT_STARTUP_CHECK}" \
  "${DEFAULT_POLICY}" \
  "${DEFAULT_FAIL_MODE}" \
  "${DEFAULT_MIN_CHECK_INTERVAL}" \
  "${DEFAULT_WINDOW_ENABLED}" \
  "${DEFAULT_WINDOW_TIMEZONE}" \
  "${DEFAULT_WINDOW_DAYS}" \
  "${DEFAULT_WINDOW_START}" \
  "${DEFAULT_WINDOW_END}")"

if [[ -n "${MERGED_CONFIG_JSON}" ]]; then
  if write_volume_file "${CONFIG_VOLUME_PATH}" "${MERGED_CONFIG_JSON}"; then
    CONFIG_JSON="${MERGED_CONFIG_JSON}"
  fi
fi

if [[ -n "${CONFIG_JSON}" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "${key:-}" ]] && continue
    case "${key}" in
      CONFIG_UPDATES_ENABLED) CONFIG_UPDATES_ENABLED="${value}" ;;
      CONFIG_STARTUP_CHECK) CONFIG_STARTUP_CHECK="${value}" ;;
      CONFIG_POLICY) CONFIG_POLICY="${value}" ;;
      CONFIG_FAIL_MODE) CONFIG_FAIL_MODE="${value}" ;;
      CONFIG_MIN_CHECK_INTERVAL) CONFIG_MIN_CHECK_INTERVAL="${value}" ;;
      CONFIG_WINDOW_ENABLED) CONFIG_WINDOW_ENABLED="${value}" ;;
      CONFIG_WINDOW_TIMEZONE) CONFIG_WINDOW_TIMEZONE="${value}" ;;
      CONFIG_WINDOW_DAYS) CONFIG_WINDOW_DAYS="${value}" ;;
      CONFIG_WINDOW_START) CONFIG_WINDOW_START="${value}" ;;
      CONFIG_WINDOW_END) CONFIG_WINDOW_END="${value}" ;;
    esac
  done < <(parse_config_json "${CONFIG_JSON}")
fi

UPDATES_ENABLED="$(to_bool "$(resolve_setting "${BRAINDRIVE_UPDATES_ENABLED:-}" "${CONFIG_UPDATES_ENABLED:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_ENABLED)")" "true")")"
STARTUP_CHECK_ENABLED="$(to_bool "$(resolve_setting "${BRAINDRIVE_STARTUP_UPDATE_CHECK:-}" "${CONFIG_STARTUP_CHECK:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_STARTUP_UPDATE_CHECK)")" "true")")"
UPDATES_POLICY="$(echo "$(resolve_setting "${BRAINDRIVE_UPDATES_POLICY:-}" "${CONFIG_POLICY:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_POLICY)")" "auto-apply")" | tr '[:upper:]' '[:lower:]')"
UPDATES_FAIL_MODE="$(echo "$(resolve_setting "${BRAINDRIVE_UPDATES_FAIL_MODE:-}" "${CONFIG_FAIL_MODE:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_FAIL_MODE)")" "fail-open")" | tr '[:upper:]' '[:lower:]')"
MIN_CHECK_INTERVAL="$(resolve_setting "${BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES:-}" "${CONFIG_MIN_CHECK_INTERVAL:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES)")" "60")"

WINDOW_ENABLED="$(to_bool "$(resolve_setting "${BRAINDRIVE_UPDATES_WINDOW_ENABLED:-}" "${CONFIG_WINDOW_ENABLED:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_ENABLED)")" "false")")"
WINDOW_TIMEZONE="$(resolve_setting "${BRAINDRIVE_UPDATES_WINDOW_TIMEZONE:-}" "${CONFIG_WINDOW_TIMEZONE:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_TIMEZONE)")" "UTC")"
WINDOW_DAYS="$(resolve_setting "${BRAINDRIVE_UPDATES_WINDOW_DAYS:-}" "${CONFIG_WINDOW_DAYS:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_DAYS)")" "Monday")"
WINDOW_START="$(resolve_setting "${BRAINDRIVE_UPDATES_WINDOW_START:-}" "${CONFIG_WINDOW_START:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_START)")" "13:00")"
WINDOW_END="$(resolve_setting "${BRAINDRIVE_UPDATES_WINDOW_END:-}" "${CONFIG_WINDOW_END:-}" "$(trim_quotes "$(get_env_value BRAINDRIVE_UPDATES_WINDOW_END)")" "18:00")"

if [[ "${UPDATES_ENABLED}" != "true" || "${STARTUP_CHECK_ENABLED}" != "true" || "${UPDATES_POLICY}" == "disabled" ]]; then
  echo "Startup update check disabled by policy."
  exit 0
fi

STATE_JSON="$(read_volume_file "${STATE_VOLUME_PATH}" || true)"
if [[ -z "${STATE_JSON}" && -f "${STATE_FALLBACK_PATH}" ]]; then
  STATE_JSON="$(cat "${STATE_FALLBACK_PATH}")"
fi

STATE_LAST_CHECKED_AT=""
STATE_LAST_CHECK_STATUS=""
STATE_LAST_CHECK_ERROR=""
STATE_LAST_AVAILABLE_VERSION=""
STATE_LAST_APPLIED_VERSION=""
STATE_LAST_APPLIED_APP_REF=""
STATE_LAST_APPLIED_EDGE_REF=""
STATE_PENDING_UPDATE="false"
STATE_PENDING_REASON=""
STATE_CONSECUTIVE_FAILURES="0"
STATE_NEXT_RETRY_AT=""

if [[ -n "${STATE_JSON}" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "${key:-}" ]] && continue
    case "${key}" in
      STATE_LAST_CHECKED_AT) STATE_LAST_CHECKED_AT="${value}" ;;
      STATE_LAST_CHECK_STATUS) STATE_LAST_CHECK_STATUS="${value}" ;;
      STATE_LAST_CHECK_ERROR) STATE_LAST_CHECK_ERROR="${value}" ;;
      STATE_LAST_AVAILABLE_VERSION) STATE_LAST_AVAILABLE_VERSION="${value}" ;;
      STATE_LAST_APPLIED_VERSION) STATE_LAST_APPLIED_VERSION="${value}" ;;
      STATE_LAST_APPLIED_APP_REF) STATE_LAST_APPLIED_APP_REF="${value}" ;;
      STATE_LAST_APPLIED_EDGE_REF) STATE_LAST_APPLIED_EDGE_REF="${value}" ;;
      STATE_PENDING_UPDATE) STATE_PENDING_UPDATE="${value}" ;;
      STATE_PENDING_REASON) STATE_PENDING_REASON="${value}" ;;
      STATE_CONSECUTIVE_FAILURES) STATE_CONSECUTIVE_FAILURES="${value}" ;;
      STATE_NEXT_RETRY_AT) STATE_NEXT_RETRY_AT="${value}" ;;
    esac
  done < <(parse_state_json "${STATE_JSON}")
fi

GATE_CHECK="true"
GATE_REASON="ok"
while IFS='=' read -r key value; do
  case "${key}" in
    GATE_CHECK) GATE_CHECK="${value}" ;;
    GATE_REASON) GATE_REASON="${value}" ;;
  esac
done < <(check_interval_gate "${STATE_LAST_CHECKED_AT}" "${STATE_NEXT_RETRY_AT}" "${MIN_CHECK_INTERVAL}")

if [[ "${GATE_CHECK}" != "true" ]]; then
  echo "Startup update check deferred (${GATE_REASON})."
  exit 0
fi

echo "Startup update check: policy=${UPDATES_POLICY}, mode=${MODE}"

set +e
DRY_RUN_OUTPUT="$({
  BRAINDRIVE_UPGRADE_DRY_RUN=true \
  BRAINDRIVE_LAST_APPLIED_APP_REF="${STATE_LAST_APPLIED_APP_REF}" \
  BRAINDRIVE_LAST_APPLIED_EDGE_REF="${STATE_LAST_APPLIED_EDGE_REF}" \
  bash "${SCRIPT_DIR}/upgrade.sh" "${MODE}"
} 2>&1)"
DRY_RUN_EXIT=$?
set -e

if [[ -n "${DRY_RUN_OUTPUT}" ]]; then
  printf '%s\n' "${DRY_RUN_OUTPUT}"
fi

if [[ ${DRY_RUN_EXIT} -ne 0 && ${DRY_RUN_EXIT} -ne 10 ]]; then
  STATE_CONSECUTIVE_FAILURES=$((STATE_CONSECUTIVE_FAILURES + 1))
  NEXT_RETRY="$(compute_next_retry "${STATE_CONSECUTIVE_FAILURES}")"
  write_state "error" "dry-run-upgrade-check-failed" "false" "check-failed" "" "${STATE_LAST_APPLIED_VERSION}" "${STATE_LAST_APPLIED_APP_REF}" "${STATE_LAST_APPLIED_EDGE_REF}" "${STATE_CONSECUTIVE_FAILURES}" "${NEXT_RETRY}"
  if [[ "${UPDATES_FAIL_MODE}" == "fail-closed" ]]; then
    echo "Startup update check failed in fail-closed mode."
    exit 40
  fi
  echo "Startup update check failed; continuing because fail-open mode is active."
  exit 0
fi

CHECK_TARGET_APP_REF="$(extract_field "CHECK_TARGET_APP_REF" "${DRY_RUN_OUTPUT}")"
CHECK_TARGET_EDGE_REF="$(extract_field "CHECK_TARGET_EDGE_REF" "${DRY_RUN_OUTPUT}")"
CHECK_RESOLVED_VERSION="$(extract_field "CHECK_RESOLVED_VERSION" "${DRY_RUN_OUTPUT}")"
CHECK_UPDATE_AVAILABLE="$(extract_field "CHECK_UPDATE_AVAILABLE" "${DRY_RUN_OUTPUT}")"
CHECK_UPDATE_AVAILABLE="$(to_bool "${CHECK_UPDATE_AVAILABLE}")"
if [[ ${DRY_RUN_EXIT} -eq 10 ]]; then
  CHECK_UPDATE_AVAILABLE="true"
fi

if [[ "${CHECK_UPDATE_AVAILABLE}" != "true" ]]; then
  write_state "ok" "" "false" "" "${CHECK_RESOLVED_VERSION}" "${CHECK_RESOLVED_VERSION}" "${CHECK_TARGET_APP_REF}" "${CHECK_TARGET_EDGE_REF}" "0" ""
  echo "Startup update check complete: no update available."
  exit 0
fi

if [[ "${UPDATES_POLICY}" == "check-only" ]]; then
  write_state "ok" "" "true" "check-only" "${CHECK_RESOLVED_VERSION}" "${STATE_LAST_APPLIED_VERSION}" "${STATE_LAST_APPLIED_APP_REF}" "${STATE_LAST_APPLIED_EDGE_REF}" "0" ""
  echo "Update available but deferred (check-only policy)."
  exit 10
fi

if [[ "${UPDATES_POLICY}" == "windowed-apply" ]]; then
  WINDOW_ALLOW="false"
  WINDOW_REASON="outside-window"
  while IFS='=' read -r key value; do
    case "${key}" in
      WINDOW_ALLOW) WINDOW_ALLOW="${value}" ;;
      WINDOW_REASON) WINDOW_REASON="${value}" ;;
    esac
  done < <(window_allows_apply "${WINDOW_ENABLED}" "${WINDOW_TIMEZONE}" "${WINDOW_DAYS}" "${WINDOW_START}" "${WINDOW_END}")

  if [[ "${WINDOW_ALLOW}" != "true" ]]; then
    write_state "ok" "" "true" "${WINDOW_REASON}" "${CHECK_RESOLVED_VERSION}" "${STATE_LAST_APPLIED_VERSION}" "${STATE_LAST_APPLIED_APP_REF}" "${STATE_LAST_APPLIED_EDGE_REF}" "0" ""
    echo "Update available but outside allowed apply window (${WINDOW_REASON})."
    exit 10
  fi
fi

echo "Applying update before startup..."
set +e
APPLY_OUTPUT="$(bash "${SCRIPT_DIR}/upgrade.sh" "${MODE}" 2>&1)"
APPLY_EXIT=$?
set -e

if [[ -n "${APPLY_OUTPUT}" ]]; then
  printf '%s\n' "${APPLY_OUTPUT}"
fi

if [[ ${APPLY_EXIT} -ne 0 ]]; then
  STATE_CONSECUTIVE_FAILURES=$((STATE_CONSECUTIVE_FAILURES + 1))
  NEXT_RETRY="$(compute_next_retry "${STATE_CONSECUTIVE_FAILURES}")"
  write_state "error" "update-apply-failed" "true" "apply-failed" "${CHECK_RESOLVED_VERSION}" "${STATE_LAST_APPLIED_VERSION}" "${STATE_LAST_APPLIED_APP_REF}" "${STATE_LAST_APPLIED_EDGE_REF}" "${STATE_CONSECUTIVE_FAILURES}" "${NEXT_RETRY}"
  if [[ "${UPDATES_FAIL_MODE}" == "fail-closed" ]]; then
    echo "Auto-apply failed in fail-closed mode."
    exit 50
  fi
  echo "Auto-apply failed; continuing because fail-open mode is active."
  exit 0
fi

write_state "ok" "" "false" "" "${CHECK_RESOLVED_VERSION}" "${CHECK_RESOLVED_VERSION}" "${CHECK_TARGET_APP_REF}" "${CHECK_TARGET_EDGE_REF}" "0" ""
echo "Startup update applied successfully."
exit 20
