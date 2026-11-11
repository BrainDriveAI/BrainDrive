#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

FAKE_BIN="$TEMP_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
DOCKER
chmod +x "$FAKE_BIN/docker"

run_case() {
  local policy="$1"
  local case_root="$TEMP_ROOT/$policy"
  local config_root="$TEMP_ROOT/config-$policy"
  local calls="$TEMP_ROOT/calls-$policy"
  mkdir -p "$case_root/scripts"
  cp "$DOCKER_ROOT/scripts/uninstall.sh" "$case_root/scripts/uninstall.sh"
  cp "$DOCKER_ROOT/scripts/preserved-env.sh" "$case_root/scripts/preserved-env.sh"
  cp "$DOCKER_ROOT/compose.local.yml" "$case_root/compose.local.yml"
  printf 'OWNER_SETTING=preserve-me\n' > "$case_root/.env"

  DOCKER_CALLS="$calls" XDG_CONFIG_HOME="$config_root" PATH="$FAKE_BIN:$PATH" \
    bash "$case_root/scripts/uninstall.sh" local "--$policy-data" --yes

  if [[ -e "$case_root" ]]; then
    echo "Uninstall left its installer folder behind ($policy)." >&2
    exit 1
  fi

  if [[ "$policy" == keep ]]; then
    local saved="$config_root/braindrive/installer/docker.env"
    [[ -f "$saved" ]] || { echo 'Keep-data uninstall did not preserve .env.' >&2; exit 1; }
    [[ "$(stat -c '%a' "$saved")" == 600 ]] || { echo 'Preserved .env permissions are not 0600.' >&2; exit 1; }
    grep -qx 'OWNER_SETTING=preserve-me' "$saved"
    grep -q -- '--remove-orphans --rmi all$' "$calls"
    if grep -q -- '--volumes' "$calls"; then
      echo 'Keep-data uninstall removed Docker volumes.' >&2
      exit 1
    fi

    local reinstall="$TEMP_ROOT/reinstall"
    mkdir -p "$reinstall"
    XDG_CONFIG_HOME="$config_root" bash -c '. "$1"; braindrive_restore_env "$2/.env"; [[ "$BRAINDRIVE_ENV_RESTORED" == true ]]' _ \
      "$DOCKER_ROOT/scripts/preserved-env.sh" "$reinstall"
    cmp "$saved" "$reinstall/.env"
  else
    [[ ! -e "$config_root/braindrive/installer/docker.env" ]] || { echo 'Remove-data uninstall retained settings.' >&2; exit 1; }
    grep -q -- '--remove-orphans --rmi all --volumes$' "$calls"
  fi
}

run_case keep
run_case remove
printf '%s\n' 'Uninstall keep/remove data checks passed.'
