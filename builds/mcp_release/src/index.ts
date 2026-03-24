import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { prepareFirstPartyState } from "./first-party-tools.js";
import { defaultRequestContext, parseRequestContext, type RequestContext } from "./request-context.js";
import { createMcpServer } from "./server-factory.js";

type SessionState = {
  transport: StreamableHTTPServerTransport;
  context: RequestContext;
};

async function start(): Promise<void> {
  const config = loadConfig();
  await prepareFirstPartyState(config);

  const app = createMcpExpressApp({ host: config.host });
  const sessions: Record<string, SessionState> = {};

  app.get("/healthz", async (_req, res) => {
    res.status(200).json({
      ok: true,
      server_kind: config.serverKind,
      version: config.version,
      memory_root: config.memoryRoot,
    });
  });

  app.post("/mcp", async (req, res) => {
    const sessionId = readSessionId(req.headers["mcp-session-id"]);
    const requestContext = parseRequestContext(req.headers as Record<string, string | string[] | undefined>);

    try {
      if (sessionId && sessions[sessionId]) {
        const session = sessions[sessionId];
        session.context = requestContext;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions[initializedSessionId] = state;
          },
        });

        const state: SessionState = {
          transport,
          context: requestContext,
        };

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions[sid]) {
            delete sessions[sid];
          }
        };

        const server = createMcpServer(config, () => state.context ?? defaultRequestContext());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Missing or invalid MCP session ID",
        },
        id: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
      // eslint-disable-next-line no-console
      console.error(`[mcp-${config.serverKind}] POST /mcp failed: ${message}`);
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = readSessionId(req.headers["mcp-session-id"]);

    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    sessions[sessionId]!.context = parseRequestContext(req.headers as Record<string, string | string[] | undefined>);
    await sessions[sessionId]!.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = readSessionId(req.headers["mcp-session-id"]);

    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    sessions[sessionId]!.context = parseRequestContext(req.headers as Record<string, string | string[] | undefined>);
    await sessions[sessionId]!.transport.handleRequest(req, res);
  });

  app.listen(config.port, config.host, (error?: Error) => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to start mcp-${config.serverKind}: ${error.message}`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`mcp-${config.serverKind} listening on ${config.host}:${config.port}`);
  });

  process.on("SIGINT", async () => {
    const ids = Object.keys(sessions);
    for (const sessionId of ids) {
      try {
        await sessions[sessionId]!.transport.close();
        delete sessions[sessionId];
      } catch {
        // best effort
      }
    }
    process.exit(0);
  });
}

function readSessionId(candidate: string | string[] | undefined): string | undefined {
  if (Array.isArray(candidate)) {
    return candidate[0];
  }
  return candidate;
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : "mcp startup failure");
  process.exit(1);
});
