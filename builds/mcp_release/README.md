# MCP Release Servers (C1)

This package ships the first-party MCP servers required by `builds/typescript`.

## Server Kinds

1. `memory`:
   1. `memory_read`
   2. `memory_write`
   3. `memory_edit`
   4. `memory_delete`
   5. `memory_list`
   6. `memory_search`
   7. `memory_history`
   8. `memory_export`
2. `auth`:
   1. `auth_whoami`
   2. `auth_check`
   3. `auth_export`
3. `project`:
   1. `project_list`

## Local Development

```bash
npm install
npm run dev
```

Environment variables:

1. `SERVER_KIND` (`memory|auth|project`)
2. `HOST` (default `0.0.0.0`)
3. `PORT` (defaults by server kind)
4. `MEMORY_ROOT` (default `/data/memory`)

## Build And Test

```bash
npm run build
npm test
```

## Docker Compose

```bash
docker compose -f docker-compose.yml up -d --build
```

Shutdown:

```bash
docker compose -f docker-compose.yml down -v
```
