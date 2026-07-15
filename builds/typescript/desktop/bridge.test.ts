import { createHmac } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  buildProxyHeaders,
  createServer,
  normalizeTailscaleUserLogin,
  readConfig,
} from "./bridge.js";

const REQUIRED_ENV = {
  BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT: "/tmp/braindrive-web",
  BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL: "http://127.0.0.1:8787",
  BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN: "transport-secret",
} satisfies NodeJS.ProcessEnv;

function bridgeRequest(
  headers: IncomingMessage["headers"] = {},
  remoteAddress = "::ffff:192.168.1.25"
): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

async function listenOnLoopback(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestBridge(
  port: number,
  pathname: string,
  headers: http.OutgoingHttpHeaders = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

describe("desktop browser bridge transport", () => {
  it("preserves the existing LAN configuration defaults", () => {
    const config = readConfig({ ...REQUIRED_ENV });

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 18088,
      mode: "lan",
      externalProto: "http",
      transportToken: "transport-secret",
    });
  });

  it("accepts only the loopback tailnet HTTPS configuration", () => {
    const config = readConfig({
      ...REQUIRED_ENV,
      BRAINDRIVE_BROWSER_BRIDGE_HOST: "127.0.0.1",
      BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
      BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
    });

    expect(config).toMatchObject({
      host: "127.0.0.1",
      mode: "tailnet",
      externalProto: "https",
    });
  });

  it.each([
    [{ BRAINDRIVE_BROWSER_BRIDGE_MODE: "remote" }, "MODE"],
    [{ BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "ftp" }, "external protocol"],
    [{ BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https" }, "must be http"],
    [
      {
        BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
        BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "http",
      },
      "https",
    ],
    [
      {
        BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
        BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
        BRAINDRIVE_BROWSER_BRIDGE_HOST: "0.0.0.0",
      },
      "127.0.0.1",
    ],
  ])("rejects invalid bridge configuration %j", (overrides, message) => {
    expect(() => readConfig({ ...REQUIRED_ENV, ...overrides })).toThrow(message);
  });

  it("leaves LAN forwarding behavior unchanged and removes spoofed metadata", () => {
    const config = readConfig({ ...REQUIRED_ENV });
    const headers = buildProxyHeaders(
      config,
      bridgeRequest({
        host: "desktop.local:18088",
        accept: "application/json",
        forwarded: "for=203.0.113.10",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.10",
        "x-actor-id": "spoofed-owner",
        "x-braindrive-browser-access": "1",
        "x-braindrive-browser-client-ip": "203.0.113.10",
        "x-braindrive-browser-client-id": `tailnet:${"a".repeat(64)}`,
        "x-braindrive-internal-transport-token": "spoofed-token",
      })
    );

    expect(headers).toMatchObject({
      accept: "application/json",
      host: "127.0.0.1:8787",
      "x-braindrive-internal-transport-token": "transport-secret",
      "x-braindrive-browser-access": "1",
      "x-braindrive-browser-client-ip": "192.168.1.25",
      "x-forwarded-for": "192.168.1.25",
      "x-forwarded-proto": "http",
      "x-forwarded-host": "desktop.local:18088",
    });
    expect(headers["x-braindrive-browser-client-id"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["x-actor-id"]).toBeUndefined();
  });

  it("derives a stable, normalized, per-login tailnet client ID", () => {
    const config = readConfig({
      ...REQUIRED_ENV,
      BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
      BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
    });
    const first = buildProxyHeaders(
      config,
      bridgeRequest({ host: "owner.tailnet.ts.net", "tailscale-user-login": " Alice@Example.COM " })
    );
    const repeated = buildProxyHeaders(
      config,
      bridgeRequest({ host: "owner.tailnet.ts.net", "tailscale-user-login": "alice@example.com" })
    );
    const different = buildProxyHeaders(
      config,
      bridgeRequest({ host: "owner.tailnet.ts.net", "tailscale-user-login": "bob@example.com" })
    );
    const expected = createHmac("sha256", "transport-secret")
      .update("alice@example.com", "utf8")
      .digest("hex");

    expect(first["x-braindrive-browser-client-id"]).toBe(`tailnet:${expected}`);
    expect(repeated["x-braindrive-browser-client-id"]).toBe(first["x-braindrive-browser-client-id"]);
    expect(different["x-braindrive-browser-client-id"]).not.toBe(first["x-braindrive-browser-client-id"]);
    expect(first["x-forwarded-proto"]).toBe("https");
    expect(first["x-braindrive-browser-client-ip"]).toBeUndefined();
    expect(first["x-forwarded-for"]).toBeUndefined();
  });

  it("strips every raw Tailscale, proxy, actor, and BrainDrive transport header", () => {
    const config = readConfig({
      ...REQUIRED_ENV,
      BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
      BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
    });
    const headers = buildProxyHeaders(
      config,
      bridgeRequest({
        "tailscale-user-login": "alice@example.com",
        "tailscale-user-name": "Alice Secret",
        "tailscale-user-profile-pic": "https://example.invalid/secret.png",
        "tailscale-capability": "admin",
        forwarded: "for=203.0.113.10",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "spoofed.example",
        "x-forwarded-proto": "http",
        "x-real-ip": "203.0.113.10",
        "x-actor-id": "spoofed-owner",
        "x-actor-type": "owner",
        "x-auth-mode": "local-owner",
        "x-actor-permissions": "{}",
        "x-braindrive-desktop-token": "spoofed-desktop",
        "x-braindrive-internal-transport-token": "spoofed-internal",
        "x-braindrive-browser-access": "0",
        "x-braindrive-browser-client-ip": "203.0.113.10",
        "x-braindrive-browser-client-id": `tailnet:${"b".repeat(64)}`,
      })
    );

    expect(Object.keys(headers).some((name) => name.startsWith("tailscale-"))).toBe(false);
    expect(headers.forwarded).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["x-actor-id"]).toBeUndefined();
    expect(headers["x-braindrive-desktop-token"]).toBeUndefined();
    expect(headers["x-braindrive-internal-transport-token"]).toBe("transport-secret");
    expect(headers["x-braindrive-browser-access"]).toBe("1");
    expect(headers["x-forwarded-proto"]).toBe("https");
  });

  it.each([
    undefined,
    ["alice@example.com"],
    "",
    "tagged-device",
    "alice\r\n@example.com",
    "a".repeat(321),
    "=?UTF-8?Q?alice=40example.com?=",
    "álîçé@example.com",
  ])("rejects an unsupported tailnet identity value %j", (value) => {
    expect(() => normalizeTailscaleUserLogin(value)).toThrow(/tailnet identity/i);
  });

  it("rejects identity-less tailnet traffic while keeping the local health check available", async () => {
    const config = readConfig({
      ...REQUIRED_ENV,
      BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
      BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
    });
    const server = createServer(config);
    const port = await listenOnLoopback(server);

    try {
      const healthResponse = await requestBridge(port, "/healthz");
      expect(healthResponse.statusCode).toBe(200);
      expect(JSON.parse(healthResponse.body)).toEqual({ status: "ok" });

      const missingIdentityResponse = await requestBridge(port, "/api/health");
      expect(missingIdentityResponse.statusCode).toBe(403);
      expect(JSON.parse(missingIdentityResponse.body)).toEqual({ error: "tailnet_identity_required" });
    } finally {
      await closeServer(server);
    }
  });

  it("returns a generic upstream failure without emitting tailnet identity or digest", async () => {
    const unusedPortProbe = http.createServer();
    const unusedPort = await listenOnLoopback(unusedPortProbe);
    await closeServer(unusedPortProbe);
    const config = readConfig({
      ...REQUIRED_ENV,
      BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL: `http://127.0.0.1:${unusedPort}`,
      BRAINDRIVE_BROWSER_BRIDGE_MODE: "tailnet",
      BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "https",
    });
    const server = createServer(config);
    const port = await listenOnLoopback(server);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await requestBridge(port, "/api/health", {
        "tailscale-user-login": "canary-user@example.com",
      });
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ error: "bridge_request_failed" });

      const logged = consoleError.mock.calls.flat().join(" ");
      expect(logged).not.toContain("canary-user@example.com");
      expect(logged).not.toMatch(/tailnet:[0-9a-f]{64}/);
    } finally {
      consoleError.mockRestore();
      await closeServer(server);
    }
  });
});
