import { createServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { MCP_MODERN_PROTOCOL_VERSION } from "../../app-platform/contracts/constants.js";
import { SdkMcpPeer } from "./sdk-peer.js";

describe("Milestone 2 official SDK peer", () => {
  it("keeps one pinned modern connection for discovery, reads, and calls", async () => {
    const eras: string[] = [];
    const handler = createMcpHandler(({ era }) => {
      eras.push(era);
      const server = new McpServer({ name: "m2-sdk-peer", version: "1.0.0" });
      server.registerTool("fixture.echo", {
        description: "Echo a fixture value",
        inputSchema: z.object({ value: z.string() }),
      }, async ({ value }) => ({
        content: [{ type: "text", text: value }],
        structuredContent: { value },
      }));
      server.registerResource("fixture", "fixture://status", {
        mimeType: "text/plain",
      }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "ready" }],
      }));
      return server;
    });
    const http = createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("M2 SDK peer did not bind a task-owned port");
    const peer = new SdkMcpPeer({ url: `http://127.0.0.1:${address.port}/mcp` });

    try {
      const negotiated = await peer.connect({ timeoutMs: 5_000 });
      expect(negotiated).toMatchObject({
        protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
        era: "modern",
        serverInfo: { name: "m2-sdk-peer", version: "1.0.0" },
      });
      expect((await peer.listTools({ timeoutMs: 5_000 }) as { tools: { name: string }[] }).tools).toEqual([
        expect.objectContaining({ name: "fixture.echo" }),
      ]);
      expect((await peer.listResources({ timeoutMs: 5_000 }) as { resources: { uri: string }[] }).resources[0]?.uri).toBe("fixture://status");
      expect(await peer.listResourceTemplates({ timeoutMs: 5_000 })).toMatchObject({ resourceTemplates: [] });
      expect(await peer.readResource({ uri: "fixture://status" }, { timeoutMs: 5_000 })).toMatchObject({
        contents: [{ uri: "fixture://status", text: "ready" }],
      });
      expect(await peer.callTool({ name: "fixture.echo", arguments: { value: "persistent" } }, { timeoutMs: 5_000 })).toMatchObject({
        structuredContent: { value: "persistent" },
      });
      expect(new Set(eras)).toEqual(new Set(["modern"]));
    } finally {
      await peer.close();
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("fails closed instead of following transport redirects", async () => {
    const http = createServer((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:9/redirected" }).end();
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("M2 redirect fixture did not bind a task-owned port");
    const peer = new SdkMcpPeer({ url: `http://127.0.0.1:${address.port}/mcp` });
    try {
      await expect(peer.connect({ timeoutMs: 5_000 })).rejects.toMatchObject({ code: "resource_redirect_denied" });
    } finally {
      await peer.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    }
  });
});
