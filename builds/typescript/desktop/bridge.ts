import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const STRIPPED_CLIENT_HEADERS = new Set([
  "forwarded",
  "x-actor-id",
  "x-actor-permissions",
  "x-actor-type",
  "x-auth-mode",
  "x-braindrive-browser-access",
  "x-braindrive-browser-client-id",
  "x-braindrive-browser-client-ip",
  "x-braindrive-desktop-token",
  "x-braindrive-internal-transport-token",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const RESPONSE_HEADER_DENYLIST = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);

const MAX_TAILSCALE_LOGIN_LENGTH = 320;

export type BridgeConfig = {
  host: string;
  port: number;
  webRoot: string;
  gatewayBaseUrl: URL;
  transportToken: string;
  mode: "lan" | "tailnet";
  externalProto: "http" | "https";
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const host = env.BRAINDRIVE_BROWSER_BRIDGE_HOST?.trim() || "127.0.0.1";
  const port = readPort(env.BRAINDRIVE_BROWSER_BRIDGE_PORT, 18088);
  const webRoot = env.BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT?.trim();
  const gatewayBaseUrlRaw = env.BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL?.trim();
  const transportToken = env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN?.trim();
  const modeRaw = env.BRAINDRIVE_BROWSER_BRIDGE_MODE?.trim().toLowerCase() || "lan";
  const externalProtoRaw =
    env.BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO?.trim().toLowerCase() || "http";

  if (!webRoot) {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT is required");
  }
  if (!gatewayBaseUrlRaw) {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL is required");
  }
  if (!transportToken) {
    throw new Error("BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN is required");
  }
  if (modeRaw !== "lan" && modeRaw !== "tailnet") {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_MODE must be lan or tailnet");
  }
  if (externalProtoRaw !== "http" && externalProtoRaw !== "https") {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO external protocol must be http or https");
  }
  // The desktop parent is the only trusted source for the tailnet listener and external scheme.
  if (modeRaw === "tailnet" && host !== "127.0.0.1") {
    throw new Error("Tailnet browser bridge host must be 127.0.0.1");
  }
  if (modeRaw === "tailnet" && externalProtoRaw !== "https") {
    throw new Error("Tailnet browser bridge external protocol must be https");
  }
  if (modeRaw === "lan" && externalProtoRaw !== "http") {
    throw new Error("LAN browser bridge external protocol must be http");
  }

  return {
    host,
    port,
    webRoot: path.resolve(webRoot),
    gatewayBaseUrl: new URL(gatewayBaseUrlRaw),
    transportToken,
    mode: modeRaw,
    externalProto: externalProtoRaw,
  };
}

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export function createServer(config: BridgeConfig): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(config, request, response).catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: "bridge_request_failed" }));
    });
  });
}

async function handleRequest(
  config: BridgeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  // Runtime liveness carries no browser identity and exposes no application data.
  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (config.mode === "tailnet") {
    try {
      normalizeTailscaleUserLogin(request.headers["tailscale-user-login"]);
    } catch (error) {
      const code = error instanceof TailnetIdentityError ? error.code : "tailnet_identity_invalid";
      response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: code }));
      return;
    }
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    await proxyApiRequest(config, request, response, requestUrl);
    return;
  }

  await serveStaticAsset(config.webRoot, request, requestUrl, response);
}

async function proxyApiRequest(
  config: BridgeConfig,
  clientRequest: http.IncomingMessage,
  clientResponse: http.ServerResponse,
  requestUrl: URL
): Promise<void> {
  const targetUrl = new URL(config.gatewayBaseUrl.toString());
  const apiPath = requestUrl.pathname.replace(/^\/api\/?/, "");
  targetUrl.pathname = joinUrlPath(targetUrl.pathname, apiPath);
  targetUrl.search = requestUrl.search;

  const headers = buildProxyHeaders(config, clientRequest);
  const requestOptions: http.RequestOptions = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    method: clientRequest.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers,
  };

  await new Promise<void>((resolve, reject) => {
    const upstream = (targetUrl.protocol === "https:" ? https : http).request(requestOptions, (upstreamResponse) => {
      const responseHeaders = filterResponseHeaders(upstreamResponse.headers);
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, responseHeaders);
      upstreamResponse.pipe(clientResponse);
      upstreamResponse.on("end", resolve);
      upstreamResponse.on("error", reject);
    });

    upstream.on("error", reject);
    clientRequest.pipe(upstream);
  });
}

export function buildProxyHeaders(
  config: BridgeConfig,
  request: http.IncomingMessage
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      STRIPPED_CLIENT_HEADERS.has(lowerName) ||
      lowerName.startsWith("tailscale-")
    ) {
      continue;
    }
    headers[name] = value;
  }

  headers.host = config.gatewayBaseUrl.host;
  headers["x-braindrive-internal-transport-token"] = config.transportToken;
  headers["x-braindrive-browser-access"] = "1";
  headers["x-forwarded-proto"] = config.externalProto;

  if (config.mode === "tailnet") {
    const normalizedLogin = normalizeTailscaleUserLogin(request.headers["tailscale-user-login"]);
    const digest = createHmac("sha256", config.transportToken)
      .update(normalizedLogin, "utf8")
      .digest("hex");
    headers["x-braindrive-browser-client-id"] = `tailnet:${digest}`;
  } else {
    const clientIp = normalizeRemoteAddress(request.socket.remoteAddress);
    headers["x-braindrive-browser-client-ip"] = clientIp;
    headers["x-forwarded-for"] = clientIp;
  }

  const forwardedHost = firstHeaderValue(request.headers.host);
  if (forwardedHost && forwardedHost.length <= 255 && !/[\r\n]/.test(forwardedHost)) {
    headers["x-forwarded-host"] = forwardedHost;
  }

  return headers;
}

class TailnetIdentityError extends Error {
  constructor(readonly code: "tailnet_identity_required" | "tailnet_identity_invalid") {
    super(code === "tailnet_identity_required" ? "Tailnet identity is required" : "Tailnet identity is invalid");
    this.name = "TailnetIdentityError";
  }
}

export function normalizeTailscaleUserLogin(value: string | string[] | undefined): string {
  if (value === undefined) {
    throw new TailnetIdentityError("tailnet_identity_required");
  }
  if (Array.isArray(value) || value.length === 0 || value.length > MAX_TAILSCALE_LOGIN_LENGTH) {
    throw new TailnetIdentityError("tailnet_identity_invalid");
  }
  if (/[^\x20-\x7e]/.test(value) || /[\r\n]/.test(value) || /=\?.*\?=/i.test(value)) {
    throw new TailnetIdentityError("tailnet_identity_invalid");
  }

  const normalized = value.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (
    normalized.length === 0 ||
    normalized.length > MAX_TAILSCALE_LOGIN_LENGTH ||
    /\s/.test(normalized) ||
    atIndex <= 0 ||
    atIndex !== normalized.lastIndexOf("@") ||
    atIndex === normalized.length - 1
  ) {
    throw new TailnetIdentityError("tailnet_identity_invalid");
  }

  return normalized;
}

function filterResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const filtered: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!RESPONSE_HEADER_DENYLIST.has(name.toLowerCase())) {
      filtered[name] = value;
    }
  }
  return filtered;
}

async function serveStaticAsset(
  webRoot: string,
  request: http.IncomingMessage,
  requestUrl: URL,
  response: http.ServerResponse
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const candidatePath = resolveStaticPath(webRoot, requestUrl.pathname);
  const filePath = candidatePath && (await isFile(candidatePath)) ? candidatePath : path.join(webRoot, "index.html");

  if (!(await isFile(filePath))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stat = await fs.promises.stat(filePath);
  response.writeHead(200, {
    "content-length": stat.size,
    "content-type": contentTypeFor(filePath),
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function resolveStaticPath(webRoot: string, pathname: string): string | null {
  let decodedPath = "/";
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalizedPath = decodedPath.replace(/\\/g, "/");
  const resolved = path.resolve(webRoot, `.${normalizedPath}`);
  const relative = path.relative(webRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function joinUrlPath(basePath: string, apiPath: string): string {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedApi = apiPath.startsWith("/") ? apiPath.slice(1) : apiPath;
  if (!normalizedApi) {
    return normalizedBase || "/";
  }
  return `${normalizedBase}/${normalizedApi}`;
}

function normalizeRemoteAddress(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function main(): void {
  const config = readConfig();
  const server = createServer(config);

  server.listen(config.port, config.host, () => {
    console.log(
      `BrainDrive browser bridge listening at http://${config.host}:${config.port} (${config.mode}/${config.externalProto}) -> ${config.gatewayBaseUrl.toString()}`
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
