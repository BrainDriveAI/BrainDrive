#!/usr/bin/env bash

braindrive_persistent_env_path() {
  local config_home="${XDG_CONFIG_HOME:-${HOME:-}/.config}"
  printf '%s\n' "${config_home%/}/braindrive/installer/docker.env"
}

braindrive_preserve_env() {
  local source_file="$1"
  local target_file
  target_file="$(braindrive_persistent_env_path)"

  if [[ ! -f "$source_file" ]]; then
    return 0
  fi

  if [[ -e "$target_file" ]]; then
    if [[ ! -f "$target_file" || ! -f "$source_file" ]] || ! cmp -s "$target_file" "$source_file"; then
      echo "Saved BrainDrive settings already exist and differ; resolve them before uninstalling." >&2
      return 1
    fi
    return 0
  fi

  mkdir -p "$(dirname "$target_file")"
  chmod 700 "$(dirname "$target_file")"
  install -m 600 "$source_file" "$target_file"
}

BRAINDRIVE_ENV_RESTORED=false

braindrive_restore_env() {
  local target_file="$1"
  local source_file
  source_file="$(braindrive_persistent_env_path)"

  if [[ -e "$target_file" || ! -f "$source_file" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$target_file")"
  install -m 600 "$source_file" "$target_file"
  BRAINDRIVE_ENV_RESTORED=true
  echo "Restored saved BrainDrive settings."
}

braindrive_forget_env() {
  local source_file
  source_file="$(braindrive_persistent_env_path)"
  rm -f "$source_file"
}
