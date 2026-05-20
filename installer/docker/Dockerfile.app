# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build-runtime
WORKDIR /src/builds/typescript
COPY builds/typescript/package.json builds/typescript/package-lock.json builds/typescript/tsconfig.json ./
RUN npm ci
COPY builds/typescript/ ./
RUN npm run build

FROM node:22-bookworm-slim AS build-mcp
WORKDIR /src/builds/mcp_release
COPY builds/mcp_release/package.json builds/mcp_release/package-lock.json builds/mcp_release/tsconfig.json ./
RUN npm ci
COPY builds/mcp_release/ ./
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init git \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    BRAINDRIVE_BIND_ADDRESS=0.0.0.0 \
    BRAINDRIVE_PORT=8787 \
    BRAINDRIVE_TRUST_PROXY=true \
    HOST=0.0.0.0 \
    PORT=8787 \
    MCP_SERVERS_FILE=mcp/servers.full-mcp.json \
    PAA_MEMORY_ROOT=/data/memory \
    PAA_SECRETS_HOME=/run/paa-secrets \
    PAA_STARTER_PACK_DIR=/app/typescript/memory/starter-pack

WORKDIR /app

COPY --from=build-runtime /src/builds/typescript/package.json /src/builds/typescript/package-lock.json /app/typescript/
COPY --from=build-runtime /src/builds/typescript/node_modules /app/typescript/node_modules
COPY --from=build-runtime /src/builds/typescript/dist /app/typescript/dist
COPY --from=build-runtime /src/builds/typescript/config.json /app/typescript/config.json
COPY --from=build-runtime /src/builds/typescript/adapters /app/typescript/adapters
COPY --from=build-runtime /src/builds/typescript/mcp /app/typescript/mcp
COPY --from=build-runtime /src/builds/typescript/memory/starter-pack /app/typescript/memory/starter-pack

COPY --from=build-mcp /src/builds/mcp_release/package.json /src/builds/mcp_release/package-lock.json /app/mcp_release/
COPY --from=build-mcp /src/builds/mcp_release/node_modules /app/mcp_release/node_modules
COPY --from=build-mcp /src/builds/mcp_release/dist /app/mcp_release/dist

COPY installer/docker/entrypoint.sh /usr/local/bin/braindrive-entrypoint.sh
RUN chmod +x /usr/local/bin/braindrive-entrypoint.sh \
  && addgroup --system --gid 10001 braindrive \
  && adduser --system --uid 10001 --ingroup braindrive braindrive \
  && mkdir -p /data/memory /run/paa-secrets \
  && chown -R braindrive:braindrive /app /data/memory /run/paa-secrets

USER braindrive

EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/braindrive-entrypoint.sh"]
