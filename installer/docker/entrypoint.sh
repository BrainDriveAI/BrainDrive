#!/usr/bin/env bash
set -euo pipefail

: "${PAA_MEMORY_ROOT:=/data/memory}"
: "${PAA_SECRETS_HOME:=/run/paa-secrets}"
: "${HOST:=0.0.0.0}"
: "${PORT:=8787}"
: "${MCP_MEMORY_PORT:=8911}"
: "${MCP_AUTH_PORT:=8912}"
: "${MCP_PROJECT_PORT:=8913}"

mkdir -p "${PAA_MEMORY_ROOT}" "${PAA_SECRETS_HOME}"

pids=()

start_mcp() {
  local kind="$1"
  local port="$2"
  SERVER_KIND="${kind}" HOST="127.0.0.1" PORT="${port}" MEMORY_ROOT="${PAA_MEMORY_ROOT}" \
    node /app/mcp_release/dist/src/index.js &
  pids+=("$!")
}

wait_for_mcp() {
  local port="$1"
  local attempts=45
  local delay=1
  for ((i=1; i<=attempts; i+=1)); do
    if node -e "fetch('http://127.0.0.1:${port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

cleanup() {
  for pid in "${pids[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
  wait || true
}

trap cleanup EXIT INT TERM

start_mcp memory "${MCP_MEMORY_PORT}"
start_mcp auth "${MCP_AUTH_PORT}"
start_mcp project "${MCP_PROJECT_PORT}"

wait_for_mcp "${MCP_MEMORY_PORT}" || { echo "mcp-memory failed health check" >&2; exit 1; }
wait_for_mcp "${MCP_AUTH_PORT}" || { echo "mcp-auth failed health check" >&2; exit 1; }
wait_for_mcp "${MCP_PROJECT_PORT}" || { echo "mcp-project failed health check" >&2; exit 1; }

cd /app/typescript
node dist/gateway/server.js &
gateway_pid="$!"
pids+=("${gateway_pid}")

wait "${gateway_pid}"
