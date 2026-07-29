#!/usr/bin/env bash

braindrive_auth_read_env_value() {
  local env_path="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "${env_path}" | head -n 1 || true)"
  printf '%s' "${line#*=}" | tr -d '"\r'
}

braindrive_auth_set_env_value() {
  local env_path="$1"
  local key="$2"
  local value="$3"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if grep -q -E "^${key}=" "${env_path}"; then
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^${key}=.*|${key}=${escaped}|" "${env_path}"
    else
      sed -i '' "s|^${key}=.*|${key}=${escaped}|" "${env_path}"
    fi
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${env_path}"
  fi
}

braindrive_generate_auth_bootstrap_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode(), end="")
PY
    return 0
  fi

  echo "Could not generate PAA_AUTH_BOOTSTRAP_TOKEN. Install openssl, node, or python3." >&2
  return 1
}

braindrive_initialize_prod_auth_bootstrap() {
  local env_path="${1:-.env}"
  if [[ ! -f "${env_path}" ]]; then
    echo "Production first-signup protection requires ${env_path}." >&2
    return 1
  fi

  local bootstrap_token="${PAA_AUTH_BOOTSTRAP_TOKEN:-}"
  if [[ -z "${bootstrap_token}" ]]; then
    bootstrap_token="$(braindrive_auth_read_env_value "${env_path}" "PAA_AUTH_BOOTSTRAP_TOKEN")"
  fi

  if [[ -z "${bootstrap_token}" ]]; then
    bootstrap_token="$(braindrive_generate_auth_bootstrap_token)"
    echo "Generated PAA_AUTH_BOOTSTRAP_TOKEN and wrote it to ${env_path}."
  fi

  braindrive_auth_set_env_value "${env_path}" "PAA_AUTH_BOOTSTRAP_TOKEN" "${bootstrap_token}"
  braindrive_auth_set_env_value "${env_path}" "PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP" "false"
  chmod 600 "${env_path}" 2>/dev/null || true

  export PAA_AUTH_BOOTSTRAP_TOKEN="${bootstrap_token}"
  export PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP="false"
}
