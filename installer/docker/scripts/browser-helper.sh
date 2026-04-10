#!/usr/bin/env bash

braindrive_get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}" | tr -d '"\r'
}

braindrive_resolve_url_hint() {
  local mode="$1"

  if [[ "${mode}" == "prod" ]]; then
    local domain_value
    domain_value="${DOMAIN:-$(braindrive_get_env_value DOMAIN)}"
    if [[ -n "${domain_value}" && "${domain_value}" != "app.example.com" ]]; then
      echo "https://${domain_value}"
    else
      echo "https://<DOMAIN>"
    fi
    return 0
  fi

  if [[ "${mode}" == "dev" ]]; then
    local dev_bind_host dev_port
    dev_bind_host="${BRAINDRIVE_DEV_BIND_HOST:-$(braindrive_get_env_value BRAINDRIVE_DEV_BIND_HOST)}"
    dev_port="${BRAINDRIVE_DEV_PORT:-$(braindrive_get_env_value BRAINDRIVE_DEV_PORT)}"
    if [[ -z "${dev_bind_host}" ]]; then
      dev_bind_host="127.0.0.1"
    fi
    if [[ -z "${dev_port}" ]]; then
      dev_port="5073"
    fi

    if [[ "${dev_bind_host}" == "0.0.0.0" ]]; then
      echo "http://127.0.0.1:${dev_port}"
    else
      echo "http://${dev_bind_host}:${dev_port}"
    fi
    return 0
  fi

  local local_bind_host
  local_bind_host="${BRAINDRIVE_LOCAL_BIND_HOST:-$(braindrive_get_env_value BRAINDRIVE_LOCAL_BIND_HOST)}"
  if [[ -z "${local_bind_host}" ]]; then
    local_bind_host="127.0.0.1"
  fi

  if [[ "${local_bind_host}" == "0.0.0.0" ]]; then
    echo "http://127.0.0.1:8080"
  else
    echo "http://${local_bind_host}:8080"
  fi
}

braindrive_print_lan_hint_if_needed() {
  local mode="$1"
  if [[ "${mode}" == "prod" ]]; then
    return 0
  fi

  if [[ "${mode}" == "dev" ]]; then
    local dev_bind_host dev_port
    dev_bind_host="${BRAINDRIVE_DEV_BIND_HOST:-$(braindrive_get_env_value BRAINDRIVE_DEV_BIND_HOST)}"
    dev_port="${BRAINDRIVE_DEV_PORT:-$(braindrive_get_env_value BRAINDRIVE_DEV_PORT)}"
    if [[ -z "${dev_port}" ]]; then
      dev_port="5073"
    fi
    if [[ "${dev_bind_host}" == "0.0.0.0" ]]; then
      echo "LAN hint: use http://<this-machine-ip>:${dev_port} from another device."
    fi
    return 0
  fi

  local local_bind_host
  local_bind_host="${BRAINDRIVE_LOCAL_BIND_HOST:-$(braindrive_get_env_value BRAINDRIVE_LOCAL_BIND_HOST)}"
  if [[ "${local_bind_host}" == "0.0.0.0" ]]; then
    echo "LAN hint: use http://<this-machine-ip>:8080 from another device."
  fi
}

braindrive_open_url_in_browser() {
  local url="$1"

  if [[ "${url}" == *"<"* || "${url}" == *">"* ]]; then
    echo "Auto-open skipped because the URL uses a placeholder host."
    return 0
  fi

  if command -v wslview >/dev/null 2>&1; then
    (wslview "${url}" >/dev/null 2>&1 &) || true
    echo "Attempted to open the URL in your default browser."
    return 0
  fi

  local host_os
  host_os="$(uname -s 2>/dev/null || true)"
  if [[ "${host_os}" == "Darwin" && "$(command -v open || true)" != "" ]]; then
    (open "${url}" >/dev/null 2>&1 &) || true
    echo "Attempted to open the URL in your default browser."
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" || -n "${WSL_DISTRO_NAME:-}" ]]; then
      (xdg-open "${url}" >/dev/null 2>&1 &) || true
      echo "Attempted to open the URL in your default browser."
    else
      echo "Auto-open skipped because no graphical session was detected."
    fi
    return 0
  fi

  echo "Auto-open unavailable on this host. Use the URL above in your browser."
}

braindrive_print_access_info_and_open() {
  local mode="$1"
  local prefix="${2:-BrainDrive is running.}"
  local url_hint
  url_hint="$(braindrive_resolve_url_hint "${mode}")"

  echo "${prefix} BrainDrive is available at: ${url_hint}"
  braindrive_print_lan_hint_if_needed "${mode}"
  echo "If your browser did not open automatically, paste this URL into your browser."
  braindrive_open_url_in_browser "${url_hint}"
}
